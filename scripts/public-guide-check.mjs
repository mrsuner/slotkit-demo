if (process.env.SLOTKIT_BASE_URL !== 'http://127.0.0.1:8000') throw new Error('This synthetic verification is restricted to the local Slotkit server');
// Customer-side smoke: only public website resources and supplied server configuration.
// No Slotkit source, SDK package, database, Administration API, or fixture imports.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const website = 'http://127.0.0.1:4321';
const source = await fetch(website + '/examples/slotkit-client.mjs');
assert.equal(source.status,200);
await writeFile(new URL('../data/public-client.mjs',import.meta.url),await source.text(),{mode:0o600});
const spec = await (await fetch(website + '/api/openapi.yaml')).text();
for(const path of ['/v1/event-types','/v1/bookings','/v1/bookings/{booking}/reschedule','/v1/bookings/{booking}/cancel'])assert.ok(spec.includes(path));
const { SlotkitClient } = await import('../data/public-client.mjs');
const client = new SlotkitClient({baseUrl:process.env.SLOTKIT_BASE_URL,apiKey:process.env.SLOTKIT_API_KEY});
const events = await client.listEventTypes();
const event = events.find(x=>x.id===process.env.SLOTKIT_EVENT_TYPE_ID && x.bookable);
assert.ok(event);
const date = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const slots = (await client.slots(event.id,date,date,'UTC')).envelope.data;
assert.ok(slots.length>=2);
const directory = new URL('../data/public-guide-'+randomUUID()+'/',import.meta.url);
await mkdir(directory,{mode:0o700});
async function mutate(action,path,payload){
  const operation={idempotencyKey:randomUUID(),path,payload,createdAt:new Date().toISOString()};
  const file=new URL(action+'.json',directory);
  await writeFile(file,JSON.stringify(operation),{mode:0o600});
  const result=await client.request(path,{method:'POST',body:operation.payload,idempotencyKey:operation.idempotencyKey});
  await writeFile(file,JSON.stringify({...operation,result}),{mode:0o600});
  return result;
}
const created = await mutate('create','/v1/bookings',{event_type_id:event.id,start_at:slots[0].start_at,guest:{name:'Public Guide Guest',email:'public-guide@slotkit.invalid',timezone:'UTC'}});
assert.equal(created.status,201);
const id=created.envelope.data.id;
try{
  const current=(await client.booking(id)).envelope.data;
  const moved=await mutate('reschedule',`/v1/bookings/${id}/reschedule`,{start_at:slots[1].start_at,expected_version:current.version});
  assert.equal(moved.status,200);assert.equal(moved.envelope.data.start_at,slots[1].start_at);
}finally{
  const current=(await client.booking(id)).envelope.data;
  const cancelled=await mutate('cancel',`/v1/bookings/${id}/cancel`,{expected_version:current.version});
  assert.equal(cancelled.status,200);assert.equal(cancelled.envelope.data.status,'cancelled');
}
console.log('PASS public website-only consumer: downloaded helper + OpenAPI -> discover, list Slots, create, read, reschedule, cancel. Operations persisted before sending.');
