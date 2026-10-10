// Sync manager: one scrape at a time, user-initiated, never retried automatically.
import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { all, one } from './queries.js';
import { normalizeResult } from '../shared/normalize.js';
import { mergeScrape } from './merge.js';
import { log } from './log.js';

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scraper/worker.js');
export const SCRAPE_TIMEOUT_MS = 6 * 60 * 1000;
export const MIN_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_SYNC_MONTHS = 6;
const OVERLAP_DAYS = 45; // re-read recent weeks so pending items get resolved

// Library error type -> connection status. Credential errors are never retried automatically.
export function statusForError(errorType) {
  switch (errorType) {
    case 'INVALID_PASSWORD':
    case 'CHANGE_PASSWORD':
    case 'ACCOUNT_BLOCKED':
      return 'needs_attention';
    case 'TWO_FACTOR_RETRIEVER_MISSING':
      return 'otp_required';
    default:
      return 'error';
  }
}

export const credentialAad = connectionId => `balancer:credentials:${connectionId}`;

// Default runner: forks scraper/worker.js. Output of the child is discarded (it may contain page text).
export function forkRunner(job, onProgress) {
  return new Promise(resolve => {
    const child = fork(WORKER, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' });
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      // Let the worker close its browser (a killed worker would leave Chromium holding the profile)
      try { child.send({ type: 'abort' }); } catch { /* already gone */ }
      setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 15_000).unref();
      finish({ success: false, errorType: 'TIMEOUT' });
    }, SCRAPE_TIMEOUT_MS);
    child.on('message', msg => {
      if (msg?.type === 'progress') onProgress(msg.stage);
      if (msg?.type === 'result') finish(msg.result);
    });
    // Exit without a result: the process was killed (Android memory pressure) or crashed
    child.on('exit', (code, signal) => finish({ success: false, errorType: 'WORKER_EXIT', errorMessage: `exit code=${code} signal=${signal}` }));
    child.on('error', e => finish({ success: false, errorType: 'WORKER_ERROR', errorMessage: `${e.name}: ${e.message}` }));
    child.send(job);
  });
}

// Errors that come from our own process or Chromium, not from bank pages: safe to log in short form
const LOCAL_ERRORS = new Set(['LAUNCH_ERROR', 'WORKER_ERROR', 'WORKER_EXIT']);

export class SyncManager {
  #vault;
  #runner;
  #now;
  #profilesDir;
  #minIntervalMs;
  #queue = [];
  #running = null; // { connectionId, stage, startedAt }
  #lastAttempt = new Map();
  #results = new Map(); // connectionId -> { at, ok, status, stats }

  constructor({ vault, profilesDir, runner = forkRunner, now = Date.now, minIntervalMs = MIN_INTERVAL_MS }) {
    this.#vault = vault;
    this.#runner = runner;
    this.#now = now;
    this.#profilesDir = profilesDir;
    this.#minIntervalMs = minIntervalMs;
  }

  status() {
    return {
      running: this.#running ? { ...this.#running } : null,
      queued: [...this.#queue],
      results: Object.fromEntries(this.#results),
    };
  }

  // Returns which connections were queued and why others were skipped
  request(ids) {
    const db = this.#vault.db;
    const queued = [];
    const skipped = [];
    for (const id of ids) {
      const conn = one(db, 'SELECT id, status, last_sync_at FROM connections WHERE id = ?', [id]);
      if (!conn) { skipped.push({ id, reason: 'not_found' }); continue; }
      if (conn.status === 'needs_attention') { skipped.push({ id, reason: 'needs_attention' }); continue; }
      if (this.#running?.connectionId === id || this.#queue.includes(id)) { skipped.push({ id, reason: 'already_running' }); continue; }
      const last = this.#lastAttempt.get(id);
      if (last && this.#now() - last < this.#minIntervalMs) {
        skipped.push({ id, reason: 'too_soon', retryAfterSec: Math.ceil((this.#minIntervalMs - (this.#now() - last)) / 1000) });
        continue;
      }
      this.#queue.push(id);
      queued.push(id);
    }
    if (queued.length && !this.#running) this.#drain();
    return { queued, skipped };
  }

  async idle() {
    while (this.#running || this.#queue.length) await new Promise(r => setTimeout(r, 10));
  }

  // New credentials: the user may try again right away
  forgetAttempt(id) {
    this.#lastAttempt.delete(id);
    this.#results.delete(id);
  }

  // Forget the per-session state when the vault locks
  reset() {
    this.#queue = [];
    this.#results.clear();
  }

  async #drain() {
    while (this.#queue.length) {
      const id = this.#queue.shift();
      if (!this.#vault.unlocked) break;
      await this.#syncOne(id);
    }
  }

  async #syncOne(connectionId) {
    const vault = this.#vault;
    const db = vault.db;
    const conn = one(db, 'SELECT * FROM connections WHERE id = ?', [connectionId]);
    if (!conn) return;
    this.#running = { connectionId, stage: 'STARTING', startedAt: new Date(this.#now()).toISOString() };
    this.#lastAttempt.set(connectionId, this.#now());
    db.run("UPDATE connections SET status = 'syncing', status_detail = NULL WHERE id = ?", [connectionId]);
    vault.save();

    const todayDay = new Date(this.#now()).toISOString().slice(0, 10);
    const start = conn.last_sync_at
      ? new Date(new Date(conn.last_sync_at).getTime() - OVERLAP_DAYS * 86400000)
      : new Date(new Date(this.#now()).setMonth(new Date(this.#now()).getMonth() - FIRST_SYNC_MONTHS));
    const startDay = start.toISOString().slice(0, 10);

    let result;
    try {
      // Decrypted only here, in memory, for the duration of this scrape
      const credentials = JSON.parse(vault.openField(conn.credentials, credentialAad(connectionId)));
      const profileDir = path.join(this.#profilesDir, connectionId.replace(/[^a-z0-9-]/gi, ''));
      result = await this.#runner({ provider: conn.provider, credentials, startDate: start.toISOString(), profileDir }, stage => {
        if (this.#running) this.#running.stage = stage;
      });
    } catch (e) {
      result = { success: false, errorType: 'WORKER_ERROR' };
      log('error', `sync ${conn.provider}: could not start (${e.name})`);
    }

    this.#running = null;
    if (!vault.unlocked) return; // locked meanwhile: drop the result, nothing is written

    if (result.success) {
      try {
        const normalized = normalizeResult({ connectionId, kind: conn.kind, result, today: todayDay });
        const stats = mergeScrape(db, { connectionId, displayName: conn.display_name, normalized, startDay });
        db.run("UPDATE connections SET status = 'ok', status_detail = NULL, last_sync_at = ? WHERE id = ?", [new Date(this.#now()).toISOString(), connectionId]);
        vault.save();
        this.#results.set(connectionId, { at: new Date(this.#now()).toISOString(), ok: true, status: 'ok', stats });
        log('info', `sync ${conn.provider}: ok (+${stats.added} new, ${stats.updated} updated, ${stats.pendingResolved} pending resolved)`);
        return;
      } catch (e) {
        result = { success: false, errorType: 'MERGE_ERROR' };
        log('error', `sync ${conn.provider}: merge failed (${e.message})`);
      }
    }
    const status = statusForError(result.errorType);
    db.run('UPDATE connections SET status = ?, status_detail = ? WHERE id = ?', [status, String(result.errorType || 'GENERIC').slice(0, 40), connectionId]);
    vault.save();
    this.#results.set(connectionId, { at: new Date(this.#now()).toISOString(), ok: false, status, errorType: result.errorType || 'GENERIC' });
    // The library's message may contain page text, so by default only its error type is logged.
    // Local errors (browser/worker) are logged in short form; BALANCER_SCRAPER_DEBUG=1 also logs the
    // library's message for the rest. log() masks digits.
    const showMessage = result.errorMessage && (LOCAL_ERRORS.has(result.errorType) || process.env.BALANCER_SCRAPER_DEBUG === '1');
    const debug = showMessage ? `: ${String(result.errorMessage).slice(0, 200)}` : '';
    log('warn', `sync ${conn.provider}: failed (${result.errorType || 'GENERIC'})${debug}`);
  }
}

export function removeProfile(profilesDir, connectionId) {
  const dir = path.join(profilesDir, connectionId.replace(/[^a-z0-9-]/gi, ''));
  fs.rmSync(dir, { recursive: true, force: true });
}

export function connectionsList(db) {
  return all(db, `SELECT c.id, c.kind, c.provider, c.display_name AS name, c.status, c.status_detail AS statusDetail,
    c.last_sync_at AS lastSyncAt, c.created_at AS createdAt,
    (SELECT COUNT(*) FROM accounts a WHERE a.connection_id = c.id) AS accountCount
    FROM connections c ORDER BY c.kind, c.created_at`);
}
