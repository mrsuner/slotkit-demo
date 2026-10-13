if (process.env.SLOTKIT_BASE_URL !== 'http://127.0.0.1:8000') throw new Error('This synthetic verification is restricted to the local Slotkit server');
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { SlotkitClient } from '../src/slotkit-client.mjs';
const origin = process.env.DEMO_ORIGIN;
const fixture = JSON.parse(await readFile(new URL('../data/fixture.json', import.meta.url)));
const full = new SlotkitClient({ baseUrl: process.env.SLOTKIT_BASE_URL, apiKey: process.env.SLOTKIT_API_KEY });
const limited = new SlotkitClient({ baseUrl: process.env.SLOTKIT_BASE_URL, apiKey: fixture.limited_api_key });
const invalid = new SlotkitClient({ baseUrl: process.env.SLOTKIT_BASE_URL, apiKey: 'invalid-synthetic-key' });
async function failure(promise, status, code) { await assert.rejects(promise, e => e.status === status && e.code === code); }
let cookie = '';
async function demo(path, body, ownCookie = cookie, ownOrigin = origin) {
  const r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Cookie: ownCookie, ...(body ? { Origin: ownOrigin, 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.headers.get('set-cookie') && !cookie) cookie = r.headers.get('set-cookie').split(';')[0];
  return { status: r.status, envelope: await r.json() };
}
await demo('/api/config');
await failure(invalid.request('/v1/event-types'),401,'invalid_api_key');
await failure(limited.slots(fixture.event_type_id, fixture.date, fixture.date, 'UTC'),403,'insufficient_scope');
const page1 = await full.request('/v1/event-types?limit=1');
assert.equal(page1.envelope.data.length,1);
assert.ok(page1.envelope.meta.next_cursor);
const page2 = await full.request(`/v1/event-types?${new URLSearchParams({limit:'1',cursor:page1.envelope.meta.next_cursor})}`);
assert.notEqual(page1.envelope.data[0].id,page2.envelope.data[0].id);
const foreign = JSON.parse(await readFile(new URL('../data/foreign-fixture.json', import.meta.url)));
await failure(full.request(`/v1/event-types/${foreign.event_type_id}`),404,'resource_not_found');
await failure(full.request('/v1/event-types/evt_nonexistent'),404,'resource_not_found');
console.log('PASS real HTTP authentication, denied scope, cross-Tenant safe 404, opaque cursor pagination');
const slots = (await demo(`/api/slots?date=${fixture.date}&timezone=UTC`)).envelope.data;
assert.ok(slots.length >= 3);
const operation = { operation_id: randomUUID(), start_at: slots[0].start_at, guest: { name:'Synthetic Demo Guest', email:`demo-${randomUUID()}@slotkit.invalid`, timezone:'UTC' } };
const first = await demo('/api/bookings',operation);
assert.equal(first.status,201,JSON.stringify(first.envelope));
const id = first.envelope.data.id;
try {
  const replay = await demo('/api/bookings',operation);
  assert.equal(replay.status,201); assert.equal(replay.envelope.data.id,id);
  assert.equal((await demo('/api/bookings')).envelope.data.filter(b=>b.id===id).length,1);
  assert.equal((await demo('/api/bookings',{...operation,start_at:slots[1].start_at})).status,409);
  assert.equal((await demo(`/api/bookings/${id}/cancel`,{operation_id:randomUUID(),expected_version:1},'')).status,404);
  assert.equal((await demo(`/api/bookings/${id}/cancel`,{operation_id:randomUUID(),expected_version:1},cookie,'https://invalid.example')).status,403);
  const bookPath='/v1/bookings';
  await failure(full.request(bookPath,{method:'POST',body:{event_type_id:fixture.event_type_id,start_at:slots[0].start_at,guest:operation.guest},idempotencyKey:randomUUID()}),409,'slot_no_longer_available');
  const conflictKey=randomUUID(), directBody={event_type_id:fixture.event_type_id,start_at:slots[2].start_at,guest:operation.guest};
  const direct = await full.request(bookPath,{method:'POST',body:directBody,idempotencyKey:conflictKey});
  try {
    assert.equal((await full.request(bookPath,{method:'POST',body:directBody,idempotencyKey:conflictKey})).envelope.data.id,direct.envelope.data.id);
    await failure(full.request(bookPath,{method:'POST',body:{...directBody,start_at:slots[3].start_at},idempotencyKey:conflictKey}),409,'idempotency_conflict');
  } finally { await full.request(`/v1/bookings/${direct.envelope.data.id}/cancel`,{method:'POST',body:{},idempotencyKey:randomUUID()}); }
  const stale = await demo(`/api/bookings/${id}/reschedule`,{operation_id:randomUUID(),start_at:slots[1].start_at,expected_version:99});
  assert.equal(stale.status,409);assert.equal(stale.envelope.error.code,'booking_version_conflict');
  const current=(await full.booking(id)).envelope.data;
  const moved=await demo(`/api/bookings/${id}/reschedule`,{operation_id:randomUUID(),start_at:slots[1].start_at,expected_version:current.version});
  assert.equal(moved.status,200);assert.equal(moved.envelope.data.start_at,slots[1].start_at);
  console.log('PASS real HTTP creation/replay/conflict, session ownership, CSRF, taken Slot, stale version, reschedule');
} finally {
  const latest=(await full.booking(id)).envelope.data;
  const cancelled=await demo(`/api/bookings/${id}/cancel`,{operation_id:randomUUID(),expected_version:latest.version});
  assert.equal(cancelled.status,200);assert.equal(cancelled.envelope.data.status,'cancelled');
  assert.equal((await full.booking(id)).envelope.data.status,'cancelled');
}
const anonymous=(await demo('/api/bookings',undefined,'')).envelope.data;
assert.equal(anonymous.length,0);
console.log('PASS real HTTP cancellation and separate browser session isolation; synthetic Bookings cancelled');

const flag = new URL('../data/calendar-unavailable', import.meta.url);
execFileSync('php', [fileURLToPath(new URL('./invalidate-calendar.php',import.meta.url))]);
await writeFile(flag, 'synthetic-fault', { mode: 0o600 });
try {
  const nextDate = new Date(Date.parse(fixture.date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  await failure(full.slots(fixture.event_type_id, fixture.date, nextDate, 'UTC'),503,'availability_temporarily_unavailable');
  console.log('PASS real HTTP 503 failure envelope with simulated unavailable Google adapter');
} finally {
  await unlink(flag);
  execFileSync('php', [fileURLToPath(new URL('./invalidate-calendar.php',import.meta.url))]);
  await full.slots(fixture.event_type_id, fixture.date, fixture.date, 'UTC');
}
