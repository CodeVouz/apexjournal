/**
 * Apex Journal — local MT5 terminal edition.
 * Real account data comes from the Python MT5 bridge (mt5_bridge.py),
 * which talks to the MT5 terminal installed on this machine.
 * The terminal app itself can stay closed — the bridge launches it.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { stmts, acctKey } = require('./db');

// load .env (optional, e.g. PORT=3000)
try {
  const envPath = path.join(__dirname, '..', '.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const PORT = process.env.PORT || 3000;
const BRIDGE = 'http://127.0.0.1:5000';
const PUBLIC = path.join(__dirname, '..', 'public');

// ---------------- bridge helpers ----------------
async function bridge(pathname, opts = {}) {
  const res = await fetch(BRIDGE + pathname, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function bridgeUp() {
  try {
    const res = await fetch(BRIDGE + '/status', { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------- http helpers ----------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const sess = stmts.getSession.get(token);
  return sess ? sess.account_key : null;
}

// ---------------- HTTP server ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/status') {
      return sendJson(res, 200, { bridge: await bridgeUp() });
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const { server: srv, id, password } = await readBody(req);
      if (!srv || !id || !password) return sendJson(res, 400, { error: 'Server, Login ID and Password are required' });
      if (!/^\d+$/.test(String(id).trim())) return sendJson(res, 400, { error: 'Login ID must be your numeric MT5 account number' });

      const r = await bridge('/login', { method: 'POST', body: { login: Number(id), password: String(password), server: String(srv).trim() } });
      if (r.status !== 200) return sendJson(res, r.status === 401 ? 401 : r.status, { error: r.data.error || 'MT5 login failed' });

      const key = acctKey(String(srv).trim(), String(id).trim());
      const token = crypto.randomBytes(24).toString('hex');
      stmts.createSession.run(token, key, Date.now());
      return sendJson(res, 200, { token, account: r.data.account });
    }

    if (url.pathname === '/api/history') {
      const key = auth(req);
      if (!key) return sendJson(res, 401, { error: 'unauthorized' });
      const days = url.searchParams.get('days') || '365';
      const r = await bridge('/history?days=' + encodeURIComponent(days));
      return sendJson(res, r.status, r.data);
    }

    if (url.pathname === '/api/ai-key' && req.method === 'POST') {
      const key = auth(req);
      if (!key) return sendJson(res, 401, { error: 'unauthorized' });
      const { apiKey, baseUrl, model } = await readBody(req);
      // blank key field = keep the previously saved key (unless no key exists yet)
      const existing = stmts.getAccountByKey.get(key);
      const finalKey = String(apiKey || '') || (existing?.ai_key || '');
      stmts.setAiSettings.run(key, finalKey, String(baseUrl || '').trim(), String(model || '').trim());
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/ai-settings' && req.method === 'GET') {
      const key = auth(req);
      if (!key) return sendJson(res, 401, { error: 'unauthorized' });
      const acc = stmts.getAccountByKey.get(key);
      return sendJson(res, 200, {
        baseUrl: acc?.ai_base_url || '',
        model: acc?.ai_model || '',
        hasKey: !!(acc && acc.ai_key),
      });
    }

    if (url.pathname === '/api/ai' && req.method === 'POST') {
      const key = auth(req);
      if (!key) return sendJson(res, 401, { error: 'unauthorized' });
      const { prompt } = await readBody(req);
      const ctx = await bridge('/ai-context');
      if (ctx.status !== 200) return sendJson(res, ctx.status, { error: ctx.data.error || 'no MT5 data' });
      const acc = stmts.getAccountByKey.get(key);
      if (!acc || !acc.ai_key) return sendJson(res, 200, { analysis: heuristicCoach(ctx.data, prompt), heuristic: true });
      try {
        const analysis = await aiCoach(ctx.data, acc, prompt);
        return sendJson(res, 200, { analysis, heuristic: false });
      } catch (e) {
        return sendJson(res, 200, { analysis: heuristicCoach(ctx.data, prompt) + `\n\n*(AI API call failed: ${e.message} — showing built-in analysis instead.)*`, heuristic: true });
      }
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      stmts.deleteSession.run(token);
      await bridge('/logout', { method: 'POST', body: {} });
      return sendJson(res, 200, { ok: true });
    }
  } catch (e) {
    const msg = String(e);
    if (/fetch failed|ECONNREFUSED|TimeoutError|terminated/i.test(msg)) {
      return sendJson(res, 503, { error: 'MT5 bridge is not running. Start it with: python mt5_bridge.py' });
    }
    return sendJson(res, 500, { error: msg.slice(0, 300) });
  }

  // static files
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------------- AI coach ----------------
function heuristicCoach(s, prompt) {
  let out = `📊 **Built-in Trade Review** (no AI API key configured — add one via ⚙ AI Key for deeper analysis)\n\n`;
  out += `**Overall:** ${s.total} closed trades · win rate ${s.winRate}% · profit factor ${s.profitFactor ?? '—'} · avg win ${s.avgWin} / avg loss ${s.avgLoss} ${s.currency || ''}\n\n`;
  if (s.avgLoss && s.avgWin < s.avgLoss * 1.2)
    out += `⚠️ **Mistake: poor risk/reward.** Your average win (${s.avgWin}) is barely larger than your average loss (${s.avgLoss}). Aim for winners at least 1.5–2× your losers, or cut losers faster.\n\n`;
  const syms = Object.entries(s.bySymbol || {});
  const worstSym = syms.sort((a, b) => a[1].pnl - b[1].pnl)[0];
  const bestSym = [...syms].sort((a, b) => b[1].pnl - a[1].pnl)[0];
  if (worstSym && worstSym[1].pnl < 0)
    out += `⚠️ **Weak symbol: ${worstSym[0]}** — net ${worstSym[1].pnl} over ${worstSym[1].n} trades (${Math.round((worstSym[1].wins / worstSym[1].n) * 100)}% win). Consider dropping it or trading it smaller.\n\n`;
  if (bestSym && bestSym[1].pnl > 0)
    out += `✅ **Strength: ${bestSym[0]}** — net +${bestSym[1].pnl} (${Math.round((bestSym[1].wins / bestSym[1].n) * 100)}% win rate). This is where your edge lives; protect it.\n\n`;
  if (s.worstDays && s.worstDays.length)
    out += `**Worst days:** ${s.worstDays.map((d) => `${d.day} (${d.pnl}, ${d.trades} deals)`).join(', ')} — review what happened there (news? revenge trading?).\n\n`;
  out += `**Guidance:** 1) Risk max 1% of balance per trade. 2) Set a daily loss limit (~3%) and stop when hit. 3) Journal why you entered each trade — if the reason is "it was moving", skip it.`;
  if (prompt) out += `\n\n*Your question:* "${prompt}" — configure an AI API key for a tailored answer.`;
  return out;
}

// OpenAI-compatible chat completions — works with Cosmos Hub, OpenAI, OpenRouter, DeepSeek, etc.
async function aiCoach(stats, acc, prompt) {
  const baseUrl = (acc.ai_base_url || 'https://api.cosmoshub.tech').replace(/\/+$/, '');
  const model = acc.ai_model || 'qwen-3.7-max';
  const body = JSON.stringify({
    model,
    max_tokens: 1200,
    messages: [
      { role: 'system', content: 'You are an expert trading coach reviewing a trader\'s real MT5 journal. Be specific, direct, and actionable. Identify concrete mistakes (risk sizing, overtrading, poor risk/reward, weak symbols, revenge trading patterns) and give a short actionable plan. Use markdown with headers and bullets. Keep under 400 words.' },
      { role: 'user', content: `Here are my real trading journal stats:\n${JSON.stringify(stats)}\n\nMy question: ${prompt || 'Review my trading and tell me my biggest mistakes and how to improve.'}` },
    ],
  });
  const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${acc.ai_key}` },
    body,
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`AI API ${resp.status}${txt ? ': ' + txt.slice(0, 160) : ''}`);
  }
  const data = await resp.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  const text = typeof msg?.content === 'string' ? msg.content : (Array.isArray(msg?.content) ? msg.content.map((c) => c.text || '').join('\n') : '');
  if (!text) throw new Error('AI returned an empty response');
  return text;
}

// ---------------- WebSocket + live polling ----------------
const wss = new WebSocketServer({ server, path: '/ws' });
const subscribers = new Map(); // account_key -> Set<ws>

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token') || '';
  const sess = stmts.getSession.get(token);
  if (!sess) { ws.close(4001, 'unauthorized'); return; }
  const key = sess.account_key;
  ws._key = key;
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(ws);
  ws.on('close', () => {
    subscribers.get(key)?.delete(ws);
    if (subscribers.get(key)?.size === 0) subscribers.delete(key);
  });
});

function push(key, msg) {
  const set = subscribers.get(key);
  if (!set) return;
  const raw = JSON.stringify(msg);
  for (const ws of set) if (ws.readyState === 1) ws.send(raw);
}

const lastCurve = new Map();
setInterval(async () => {
  for (const [key, set] of subscribers) {
    if (set.size === 0) continue;
    let r;
    try {
      r = await bridge('/snapshot');
    } catch {
      push(key, { type: 'bridge-down' });
      continue;
    }
    if (r.status !== 200) {
      push(key, { type: 'bridge-down', reconnecting: !!r.data.reconnecting });
      continue;
    }
    const curveJson = JSON.stringify(r.data.equityCurve);
    const curveChanged = lastCurve.get(key) !== curveJson;
    lastCurve.set(key, curveJson);
    push(key, { type: 'snapshot', data: r.data, curveChanged });
  }
}, 2000);

server.listen(PORT, async () => {
  console.log(`\n  📈 Apex Journal at  http://localhost:${PORT}\n`);
  const up = await bridgeUp();
  if (up) console.log('  ✅ MT5 bridge detected on :5000 — real account data enabled\n');
  else console.log('  ⚠  MT5 bridge NOT detected. Run:  python mt5_bridge.py\n');
});
