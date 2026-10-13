import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { SlotkitError } from './slotkit-client.mjs';
export const digest = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export class Store {
  constructor(path) {
    if (path !== ':memory:') { mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); }
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (session TEXT, id TEXT, hash TEXT NOT NULL, path TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, retry_at INTEGER NOT NULL DEFAULT 0, result TEXT, PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, session TEXT NOT NULL);`);
    this.running = new Map();
  }
  session(token) {
    const id = token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : null;
    if (id && this.db.prepare('SELECT id FROM sessions WHERE id=? AND expires>?').get(id, Date.now())) return { id, token: null };
    const fresh = randomBytes(32).toString('hex'), hash = digest(fresh);
    this.db.prepare('INSERT INTO sessions VALUES (?,?)').run(hash, Date.now() + 86400000);
    return { id: hash, token: fresh };
  }
  owns(session, id) { return Boolean(this.db.prepare('SELECT id FROM bookings WHERE id=? AND session=?').get(id, session)); }
  bookingIds(session) { return this.db.prepare('SELECT id FROM bookings WHERE session=?').all(session).map(row => row.id); }
  async mutate(session, id, path, body, send) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new SlotkitError(400, { code: 'invalid_operation', message: 'Operation must be a UUID.' });
    const key = `${session}:${id}`, serialized = JSON.stringify(canonical(body)), hash = digest(path + '\n' + serialized);
    let op = this.db.prepare('SELECT * FROM operations WHERE session=? AND id=?').get(session, id);
    if (op && op.hash !== hash) throw new SlotkitError(409, { code: 'operation_conflict', message: 'A retry must keep its original action and payload.' });
    if (op?.state === 'done') return JSON.parse(op.result);
    if (op && Date.now() - op.created >= 23 * 3600000) throw new SlotkitError(409, { code: 'reconciliation_required', message: 'Retry window expired. Reconcile the original operation before creating another.' });
    if (op?.retry_at > Date.now()) throw new SlotkitError(429, { code: 'retry_later', message: 'Wait before retrying this operation.' }, Math.ceil((op.retry_at - Date.now()) / 1000));
    if (this.running.has(key)) return this.running.get(key);
    if (!op) this.db.prepare("INSERT INTO operations (session,id,hash,path,body,state,created) VALUES (?,?,?,?,?,'uncertain',?)").run(session, id, hash, path, serialized, Date.now());
    const promise = this.perform(key, session, id, path, JSON.parse(serialized), send);
    this.running.set(key, promise);
    try { return await promise; } finally { this.running.delete(key); }
  }
  async perform(key, session, id, path, body, send) {
    let result;
    try { result = await send(path, { method: 'POST', body, idempotencyKey: digest(key) }); }
    catch (error) {
      if (!(error instanceof SlotkitError)) throw error;
      if (error.status === 429 || error.status >= 500) {
        this.db.prepare('UPDATE operations SET retry_at=? WHERE session=? AND id=?').run(Date.now() + (error.retryAfter ?? 0) * 1000, session, id);
        throw error;
      }
      result = { status: error.status, envelope: { error: { code: error.code, message: error.message, request_id: error.requestId, details: error.details } } };
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (path === '/v1/bookings' && result.status === 201) this.db.prepare('INSERT OR IGNORE INTO bookings VALUES (?,?)').run(result.envelope.data.id, session);
      this.db.prepare("UPDATE operations SET state='done',result=? WHERE session=? AND id=?").run(JSON.stringify(result), session, id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return result;
  }
  close() { this.db.close(); }
}
