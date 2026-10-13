import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { SlotkitClient, SlotkitError } from './slotkit-client.mjs';
import { Store } from './store.mjs';
export function createDemo({ client, store, eventTypeId, origin, date }) {
  const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  return createServer(async (request, response) => {
    const reply = (status, data, extra = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
      response.end(JSON.stringify(data));
    };
    try {
      if (request.headers.host !== new URL(origin).host) return reply(403, { error: { code: 'invalid_host', message: 'Invalid host.' } });
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && files.has(url.pathname)) {
        const [file, type] = files.get(url.pathname);
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
        return response.end(await readFile(new URL('../public/' + file, import.meta.url)));
      }
      if (!url.pathname.startsWith('/api/')) return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
      const token = request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('demo_session='))?.slice(13);
      const session = store.session(token);
      if (session.token) response.setHeader('Set-Cookie', `demo_session=${session.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${origin.startsWith('https:') ? '; Secure' : ''}`);
      if (request.method === 'GET') {
        if (url.pathname === '/api/config') return reply(200, { eventTypeId, date, timezone: 'UTC' });
        if (url.pathname === '/api/event') {
          const events = await client.listEventTypes();
          const event = events.find(x => x.id === eventTypeId);
          if (!event) throw new SlotkitError(404, { code: 'not_found', message: 'Configured Event Type is unavailable.' });
          return reply(200, { data: { id: event.id, name: event.name, duration_minutes: event.duration_minutes, bookable: event.bookable, unavailable_reason: event.unavailable_reason } });
        }
        if (url.pathname === '/api/slots') {
          const from = url.searchParams.get('date'), timezone = url.searchParams.get('timezone') ?? 'UTC';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '')) throw new SlotkitError(400, { code: 'invalid_date', message: 'Choose a date.' });
          // One local calendar day: API date bounds are inclusive.
          const result = await client.slots(eventTypeId, from, from, timezone);
          return reply(result.status, result.envelope);
        }
        if (url.pathname === '/api/bookings') {
          const bookings = await Promise.all(store.bookingIds(session.id).map(async id => (await client.booking(id)).envelope.data));
          return reply(200, { data: bookings });
        }
      }
      if (request.method !== 'POST') return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
      if (request.headers.origin !== origin || request.headers['content-type']?.split(';')[0] !== 'application/json') return reply(403, { error: { code: 'invalid_origin', message: 'Submit from this application.' } });
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (Buffer.byteLength(raw) > 16384) throw new SlotkitError(413, { code: 'request_too_large', message: 'Request too large.' }); }
      let input;
      try { input = JSON.parse(raw); } catch { throw new SlotkitError(400, { code: 'invalid_request', message: 'Send JSON.' }); }
      let path, body;
      if (url.pathname === '/api/bookings') {
        path = '/v1/bookings';
        body = { event_type_id: eventTypeId, start_at: input.start_at, guest: { name: input.guest?.name, email: input.guest?.email, timezone: input.guest?.timezone } };
      } else {
        const action = url.pathname.match(/^\/api\/bookings\/(bkg_[a-zA-Z0-9]+)\/(cancel|reschedule)$/);
        if (!action || !store.owns(session.id, action[1])) throw new SlotkitError(404, { code: 'not_found', message: 'Booking not found.' });
        path = `/v1/bookings/${action[1]}/${action[2]}`;
        body = action[2] === 'cancel' ? { expected_version: input.expected_version } : { start_at: input.start_at, expected_version: input.expected_version };
      }
      const result = await store.mutate(session.id, input.operation_id ?? '', path, body, client.request.bind(client));
      reply(result.status, result.envelope);
    } catch (error) {
      if (error instanceof SlotkitError) return reply(error.status, { error: { code: error.code, message: error.message, request_id: error.requestId, details: error.details } }, error.retryAfter === null ? {} : { 'Retry-After': String(error.retryAfter) });
      reply(500, { error: { code: 'internal_error', message: 'Demo request failed.' } });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.env.DEMO_ORIGIN ?? 'http://127.0.0.1:3000';
  const date = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const store = new Store(fileURLToPath(new URL('../data/demo.sqlite', import.meta.url)));
  const client = new SlotkitClient({ baseUrl: process.env.SLOTKIT_BASE_URL, apiKey: process.env.SLOTKIT_API_KEY });
  const server = createDemo({ client, store, eventTypeId: process.env.SLOTKIT_EVENT_TYPE_ID, origin, date });
  server.listen(Number(process.env.DEMO_PORT ?? 3000), '127.0.0.1', () => console.log(`Booking demo: ${origin}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
