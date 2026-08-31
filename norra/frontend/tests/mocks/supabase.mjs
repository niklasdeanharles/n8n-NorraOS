import { createServer } from 'node:http';

/**
 * Just enough PostgREST to run the voice routes against.
 *
 * Not a database: an in-memory store that understands the handful of verbs and
 * filters these routes actually use. It exists so the test exercises the real
 * route code -- signature check, branching, TwiML -- instead of a mock of it.
 */
const db = {
  phone_numbers: [],
  conversations: [],
  calls: [],
  messages: [],
  tickets: [],
  agents: [],
  organizations: [],
  users: [],
  tool_calls_log: [],
  agent_test_cases: [],
  agent_test_runs: [],
  audit_log: [],
};

/**
 * The signed-in user for `/auth/v1/user`, or null for an anonymous run.
 *
 * GoTrue validates the access token server-side, so `getUser()` always goes
 * over the wire — which is what lets a test drive an authenticated route
 * without a real Supabase project. Set it through `reset()`.
 */
let authUser = null;

let seq = 1;
const uuid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, '0')}`;

/**
 * Column defaults, mirroring the migrations. Without them a route that relies
 * on `not null default 0` reads undefined and quietly computes NaN — which is
 * exactly what production would not do.
 */
const DEFAULTS = {
  agent_test_cases: { expect_contains: [], expect_absent: [], expect_tool: null },
  agent_test_runs: { failures: [], tools_used: [] },
  tool_calls_log: { status: 'success', input: {}, output: null },
  calls: { status: 'ringing', direction: 'inbound', turn_count: 0, started_at: () => new Date().toISOString() },
  // csat: null, not omitted -- a real nullable column with no value set
  // still comes back as null in the row, never as a missing key.
  conversations: { status: 'open', channel: 'web', csat: null },
  messages: { content: '' },
  tickets: { status: 'open', priority: 'normal' },
};

function withDefaults(table, row) {
  const defaults = DEFAULTS[table] ?? {};
  const filled = { ...row };
  for (const [key, value] of Object.entries(defaults)) {
    if (filled[key] === undefined) filled[key] = typeof value === 'function' ? value() : value;
  }
  return filled;
}

function matches(row, filters) {
  return filters.every(([col, op, value]) => {
    if (op === 'eq') return String(row[col]) === value;
    if (op === 'in') return value.replace(/[()]/g, '').split(',').includes(String(row[col]));
    return true;
  });
}

function parseFilters(url) {
  const filters = [];
  for (const [key, raw] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const [op, ...rest] = raw.split('.');
    filters.push([key, op, rest.join('.')]);
  }
  return filters;
}

export function reset(seed, user = null) {
  for (const key of Object.keys(db)) db[key] = [];
  Object.assign(db, seed);
  authUser = user;
  seq = 1000;
}

/** Swaps the signed-in user mid-scenario, e.g. to check an admin-only route. */
export function setUser(user) {
  authUser = user;
}

export const store = db;

export function start(port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // GoTrue, not PostgREST. `currentActor()` starts here, so every
    // authenticated route in the app depends on this answer.
    if (url.pathname.startsWith('/auth/v1/user')) {
      res.writeHead(authUser ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify(
          authUser ?? { code: 401, error_code: 'session_missing', msg: 'Auth session missing!' },
        ),
      );
    }

    const table = url.pathname.replace('/rest/v1/', '');
    const rows = db[table];
    // PostgREST returns a bare object rather than an array when the client asks
    // for one, which is what `.single()` and `.maybeSingle()` rely on.
    const wantsObject = (req.headers.accept ?? '').includes('vnd.pgrst.object+json');
    // `{ count: 'exact', head: true }` sends a HEAD request with this Prefer
    // header and reads the total back from Content-Range, never from a body —
    // a HEAD response has none. Getting this wrong doesn't error, it just
    // makes every count read as null, which is worse: the caller silently
    // treats an over-limit conversation as brand new.
    const wantsCount = /count=exact/.test(req.headers.prefer ?? '');
    const send = (status, body) => {
      const headers = { 'content-type': 'application/json' };
      if (wantsCount && Array.isArray(body)) headers['content-range'] = `0-0/${body.length}`;
      if (req.method === 'HEAD') {
        res.writeHead(status, headers);
        return res.end();
      }
      if (wantsObject && Array.isArray(body)) {
        if (body.length === 1) {
          res.writeHead(status, headers);
          return res.end(JSON.stringify(body[0]));
        }
        res.writeHead(406, headers);
        return res.end(JSON.stringify({
          code: 'PGRST116',
          message: `JSON object requested, multiple (or no) rows returned`,
          details: `Results contain ${body.length} rows`,
        }));
      }
      res.writeHead(status, headers);
      res.end(JSON.stringify(body));
    };
    if (!rows) return send(404, { message: `unknown table ${table}` });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const filters = parseFilters(url);
    if (process.env.MOCK_DEBUG) console.error('[mock]', req.method, table, JSON.stringify(filters));

    if (req.method === 'GET' || req.method === 'HEAD') {
      let found = rows.filter((row) => matches(row, filters));
      const limit = url.searchParams.get('limit');
      if (limit) found = found.slice(0, Number(limit));
      return send(200, found);
    }

    if (req.method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body];
      const conflict = url.searchParams.get('on_conflict');
      const written = incoming.map((item) => {
        if (conflict) {
          const keys = conflict.split(',');
          const existing = rows.find((row) => keys.every((k) => row[k] === item[k]));
          if (existing) return Object.assign(existing, item);
        }
        const row = withDefaults(table, { id: uuid(), created_at: new Date().toISOString(), ...item });
        rows.push(row);
        return row;
      });
      return send(201, written);
    }

    if (req.method === 'PATCH') {
      const updated = rows.filter((row) => matches(row, filters)).map((row) => Object.assign(row, body));
      return send(200, updated);
    }

    if (req.method === 'DELETE') {
      const removed = rows.filter((row) => matches(row, filters));
      // Cascades are the database's job in production; here they have to be
      // spelled out, or a deleted scratch conversation leaves its messages and
      // tool calls behind and the next case inherits them.
      for (const row of removed) {
        for (const child of ['messages', 'tool_calls_log', 'calls']) {
          db[child] = db[child].filter((c) => c.conversation_id !== row.id);
        }
      }
      db[table] = rows.filter((row) => !removed.includes(row));
      return send(200, removed);
    }

    return send(405, { message: 'not supported' });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
