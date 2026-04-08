#!/usr/bin/env node
/**
 * waimaianalyze credits API
 * Node + SQLite, zero HTTP framework, ~150 lines.
 *
 * Endpoints (mounted under /waimaianalyze/api/ via Apache mod_proxy):
 *   GET  /api/health
 *   GET  /api/credits?browser_id=xxx
 *   POST /api/credits/consume        body: { browser_id }
 *   POST /api/credits/claim-share    body: { browser_id }
 *   POST /api/credits/grant-on-scan  body: { scanner_id, referrer_id }
 *
 * The Node process listens on 127.0.0.1:$PORT and is fronted by Apache,
 * which strips the /waimaianalyze prefix before proxying. A defensive
 * strip is also applied here so both routing modes work.
 */
const http = require('http');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'waimai.db');
const INITIAL_CREDITS = 1;
const SHARE_REWARD = 2;
const CLAIM_RATE_LIMIT_MS = 10 * 60 * 1000;  // one claim per 10 minutes
const CLAIM_DAILY_LIMIT = 5;                 // max 5 shares/day
const DAY_MS = 24 * 60 * 60 * 1000;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    browser_id  TEXT PRIMARY KEY,
    credits     INTEGER NOT NULL DEFAULT 1,
    referred_by TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    browser_id  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    delta       INTEGER NOT NULL,
    ref         TEXT,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_browser_time
    ON events(browser_id, event_type, created_at);
`);

const q = {
  getAccount: db.prepare('SELECT browser_id, credits, referred_by FROM accounts WHERE browser_id = ?'),
  insertAccount: db.prepare('INSERT INTO accounts (browser_id, credits, referred_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
  updateCredits: db.prepare('UPDATE accounts SET credits = ?, updated_at = ? WHERE browser_id = ?'),
  addEvent: db.prepare('INSERT INTO events (browser_id, event_type, delta, ref, created_at) VALUES (?, ?, ?, ?, ?)'),
  countClaimsSince: db.prepare("SELECT COUNT(*) AS cnt FROM events WHERE browser_id = ? AND event_type = 'claim_share' AND created_at > ?"),
};

function ensureAccount(browserId, referrerId) {
  const row = q.getAccount.get(browserId);
  if (row) return row;
  const now = Date.now();
  q.insertAccount.run(browserId, INITIAL_CREDITS, referrerId || null, now, now);
  q.addEvent.run(browserId, 'init', INITIAL_CREDITS, referrerId || null, now);
  return q.getAccount.get(browserId);
}

const BROWSER_ID_RE = /^b_[a-z0-9]{4,40}$/i;
const validId = (x) => typeof x === 'string' && BROWSER_ID_RE.test(x);

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 4096) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const routes = {
  'GET /api/health': () => ({ ok: true, t: Date.now() }),

  'GET /api/credits': (_req, url) => {
    const id = url.searchParams.get('browser_id');
    if (!validId(id)) return { _status: 400, error: 'invalid browser_id' };
    const row = ensureAccount(id);
    return { browser_id: row.browser_id, credits: row.credits, referred_by: row.referred_by };
  },

  'POST /api/credits/consume': async (req) => {
    const body = await readJson(req);
    if (!validId(body.browser_id)) return { _status: 400, error: 'invalid browser_id' };
    const row = ensureAccount(body.browser_id);
    if (row.credits < 1) {
      return { _status: 402, ok: false, credits: row.credits, reason: 'insufficient' };
    }
    const now = Date.now();
    const next = row.credits - 1;
    q.updateCredits.run(next, now, body.browser_id);
    q.addEvent.run(body.browser_id, 'consume', -1, null, now);
    return { ok: true, credits: next };
  },

  'POST /api/credits/claim-share': async (req) => {
    const body = await readJson(req);
    if (!validId(body.browser_id)) return { _status: 400, error: 'invalid browser_id' };
    const row = ensureAccount(body.browser_id);
    const now = Date.now();
    const recentCnt = q.countClaimsSince.get(body.browser_id, now - CLAIM_RATE_LIMIT_MS).cnt;
    if (recentCnt > 0) return { _status: 429, ok: false, credits: row.credits, reason: 'rate_limited' };
    const dailyCnt = q.countClaimsSince.get(body.browser_id, now - DAY_MS).cnt;
    if (dailyCnt >= CLAIM_DAILY_LIMIT) return { _status: 429, ok: false, credits: row.credits, reason: 'daily_limit' };
    const next = row.credits + SHARE_REWARD;
    q.updateCredits.run(next, now, body.browser_id);
    q.addEvent.run(body.browser_id, 'claim_share', SHARE_REWARD, null, now);
    return { ok: true, credits: next, granted: SHARE_REWARD };
  },

  'POST /api/credits/grant-on-scan': async (req) => {
    const body = await readJson(req);
    if (!validId(body.scanner_id) || !validId(body.referrer_id)) return { _status: 400, error: 'invalid id' };
    if (body.scanner_id === body.referrer_id) return { _status: 400, error: 'self_ref' };
    const scannerExisted = q.getAccount.get(body.scanner_id);
    if (scannerExisted) {
      return { ok: true, already_seen: true, scanner_credits: scannerExisted.credits };
    }
    const now = Date.now();
    q.insertAccount.run(body.scanner_id, INITIAL_CREDITS, body.referrer_id, now, now);
    q.addEvent.run(body.scanner_id, 'init', INITIAL_CREDITS, body.referrer_id, now);
    const referrer = ensureAccount(body.referrer_id);
    const nextRef = referrer.credits + SHARE_REWARD;
    q.updateCredits.run(nextRef, now, body.referrer_id);
    q.addEvent.run(body.referrer_id, 'grant_on_scan', SHARE_REWARD, body.scanner_id, now);
    return { ok: true, scanner_credits: INITIAL_CREDITS, referrer_credits: nextRef };
  },
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    // Apache strips /waimaianalyze before proxying, but strip defensively too.
    const pathname = url.pathname.replace(/^\/waimaianalyze/, '') || '/';
    const handler = routes[`${req.method} ${pathname}`];
    if (!handler) return send(res, 404, { error: 'not found', path: pathname });
    const result = await handler(req, url);
    const status = result._status || 200;
    delete result._status;
    send(res, status, result);
  } catch (err) {
    console.error('[err]', err);
    send(res, 500, { error: err.message || 'internal' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[waimaianalyze-api] listening on 127.0.0.1:${PORT}, db=${DB_PATH}`);
});

const shutdown = (sig) => { console.log(`[waimaianalyze-api] ${sig}, closing`); server.close(); db.close(); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
