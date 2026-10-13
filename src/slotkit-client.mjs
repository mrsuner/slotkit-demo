// Server-only raw HTTP helper. Operation persistence belongs to your application.
export class SlotkitError extends Error {
  constructor(status, error, retryAfter = null) {
    super(error.message ?? 'Slotkit request failed');
    this.status = status;
    this.code = error.code ?? 'upstream_error';
    this.requestId = error.request_id ?? null;
    this.details = Array.isArray(error.details) ? error.details : [];
    this.retryAfter = retryAfter;
  }
}
export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - now) / 1000)) : null;
}
export class SlotkitClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch, timeoutMs = 10000 }) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS outside local development');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an origin as SLOTKIT_BASE_URL');
    if (!apiKey) throw new Error('SLOTKIT_API_KEY is required');
    this.baseUrl = url.origin; this.apiKey = apiKey; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async request(path, { method = 'GET', body, idempotencyKey } = {}) {
    if (!path.startsWith('/v1/') || path.includes('://') || path.includes('..')) throw new Error('Invalid Public API path');
    if (method !== 'GET' && !idempotencyKey) throw new Error('Persist an idempotency key before mutation');
    const headers = { Accept: 'application/json', Authorization: `Bearer ${this.apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error' });
    } catch {
      throw new SlotkitError(503, { code: 'outcome_unknown', message: 'Connection interrupted. Retry the same operation without changing its request.' });
    }
    let envelope;
    try { envelope = await response.json(); }
    catch { throw new SlotkitError(503, { code: 'outcome_unknown', message: 'Unreadable upstream response. Retry the same operation.' }); }
    if (!response.ok) throw new SlotkitError(response.status, envelope.error ?? {}, retryAfterSeconds(response.headers.get('Retry-After')));
    if (!envelope.meta?.request_id || !('data' in envelope)) throw new SlotkitError(503, { code: 'outcome_unknown', message: 'Unexpected upstream response. Retry the same operation.' });
    return { status: response.status, envelope };
  }
  async listEventTypes() {
    const result = []; let cursor = null;
    do {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const { envelope } = await this.request(`/v1/event-types?${query}`);
      result.push(...envelope.data); cursor = envelope.meta.next_cursor;
    } while (cursor);
    return result;
  }
  slots(id, from, to, timezone) {
    return this.request(`/v1/event-types/${encodeURIComponent(id)}/slots?${new URLSearchParams({ from, to, timezone })}`);
  }
  booking(id) { return this.request(`/v1/bookings/${encodeURIComponent(id)}`); }
}
