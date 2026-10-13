import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SlotkitClient, SlotkitError, retryAfterSeconds } from '../src/slotkit-client.mjs';
import { Store } from '../src/store.mjs';
const success = id => ({ status: 201, envelope: { data: { id }, meta: { request_id: 'req_synthetic' } } });
test('operation survives restart and recovers lost response using same key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'slotkit-demo-test-')); const path = join(dir,'demo.sqlite');
  let store = new Store(path); const op = randomUUID(); let firstKey;
  try {
    await assert.rejects(store.mutate('customer',op,'/v1/bookings',{start_at:'future'},async (p, opts)=> { firstKey=opts.idempotencyKey; throw new SlotkitError(503,{code:'outcome_unknown'}); }));
    store.close(); store = new Store(path);
    const recovered = await store.mutate('customer',op,'/v1/bookings',{start_at:'future'},async (p,opts)=> { assert.equal(opts.idempotencyKey,firstKey);return success('bkg_synthetic'); });
    assert.equal(recovered.envelope.data.id,'bkg_synthetic');
    assert.equal(store.owns('customer','bkg_synthetic'),true);
    assert.equal(store.owns('other','bkg_synthetic'),false);
    assert.deepEqual(await store.mutate('customer',op,'/v1/bookings',{start_at:'future'},()=>{throw Error('Must not repeat');}),recovered);
    await assert.rejects(store.mutate('customer',op,'/v1/bookings',{start_at:'changed'},()=>{}),e=>e.code==='operation_conflict');
  } finally {store.close();rmSync(dir,{recursive:true});}
});
test('concurrent submissions call upstream once; canonical field order matches', async()=>{
  const store=new Store(':memory:'),id=randomUUID();let resolve,calls=0;
  const gate=new Promise(r=>resolve=r);
  const send=async()=>{calls++;await gate;return success('bkg_concurrent');};
  const a=store.mutate('customer',id,'/v1/bookings',{b:2,a:1},send);
  const b=store.mutate('customer',id,'/v1/bookings',{a:1,b:2},send);
  resolve();assert.deepEqual(await a,await b);assert.equal(calls,1);store.close();
});
test('honors retry delay, freezes semantic failures, blocks expired uncertain operation',async()=>{
  const store=new Store(':memory:'),id=randomUUID();
  await assert.rejects(store.mutate('s',id,'/v1/bookings',{},async()=>{throw new SlotkitError(429,{code:'rate_limited'},60);}),e=>e.retryAfter===60);
  await assert.rejects(store.mutate('s',id,'/v1/bookings',{},()=>{}),e=>e.code==='retry_later');
  store.db.prepare('UPDATE operations SET created=?,retry_at=0').run(Date.now()-24*3600000);
  await assert.rejects(store.mutate('s',id,'/v1/bookings',{},()=>{}),e=>e.code==='reconciliation_required');
  const failure=await store.mutate('s',randomUUID(),'/v1/bookings',{},async()=>{throw new SlotkitError(409,{code:'slot_no_longer_available',request_id:'req_known'});});
  assert.equal(failure.status,409);assert.equal(failure.envelope.error.request_id,'req_known');store.close();
});
test('client preserves API errors, request IDs, both Retry-After formats and safe transport',async()=>{
  assert.equal(retryAfterSeconds('3'),3);assert.equal(retryAfterSeconds('Tue, 13 Oct 2026 00:00:10 GMT',Date.parse('2026-10-13T00:00:00Z')),10);
  assert.throws(()=>new SlotkitClient({baseUrl:'http://remote.example',apiKey:'synthetic'}));
  const client=new SlotkitClient({baseUrl:'http://127.0.0.1:8000',apiKey:'synthetic',fetchImpl:async(url,opts)=>{
    assert.equal(opts.redirect,'error');return new Response(JSON.stringify({error:{code:'rate_limited',request_id:'req_limit',details:[]}}),{status:429,headers:{'Retry-After':'5'}});
  }});
  await assert.rejects(client.request('/v1/bookings'),e=>e.code==='rate_limited'&&e.requestId==='req_limit'&&e.retryAfter===5);
  await assert.rejects(client.request('/v1/bookings',{method:'POST',body:{}}),/idempotency/);
});
test('cursor pagination retains opaque cursor and handles empty page',async()=>{
  let calls=0;const cursor='opaque+/=?';
  const c=new SlotkitClient({baseUrl:'http://127.0.0.1:8000',apiKey:'synthetic',fetchImpl:async(url)=>{
    calls++;if(calls===2)assert.equal(new URL(url).searchParams.get('cursor'),cursor);
    return new Response(JSON.stringify({data:calls===1?[{id:'evt_one'}]:[],meta:{request_id:'req_page',next_cursor:calls===1?cursor:null}}));
  }});
  assert.deepEqual(await c.listEventTypes(),[{id:'evt_one'}]);assert.equal(calls,2);
});
