'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   AURA-LIE — local server (CommonJS)
   Updated 2026-10-25. Groq models: llama-3.1 is dead. Use gpt-oss / qwen3.8.
   Tavily: uses Authorization header (body api_key is deprecated).
   ═══════════════════════════════════════════════════════════════════════════ */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HERE = __dirname;
const INDEX_PATH = path.join(HERE, 'index.html');
const ENV_PATH = path.join(HERE, '.env');

const B = '\x1b[1m'; const C = '\x1b[36m'; const G = '\x1b[32m'; const Y = '\x1b[33m'; const R = '\x1b[31m'; const X = '\x1b[0m';

function banner(text, color) {
  const line = '═'.repeat(66);
  console.log('');
  console.log(B + color + line + X);
  console.log(B + color + '  ' + text + X);
  console.log(B + color + line + X);
}

banner('AURA-LIE server · starting up', C);
console.log('  working dir: ' + HERE);
console.log('  node:        ' + process.version);
console.log('  platform:    ' + process.platform + ' ' + process.arch);

if (typeof fetch !== 'function') { console.error(B + R + '\n✖ FATAL: global fetch is not available.' + X); process.exit(1); }
if (!fs.existsSync(INDEX_PATH)) { console.error(B + R + '\n✖ FATAL: index.html missing next to server.cjs.' + X); process.exit(1); }
console.log('  index.html:  found (' + fs.statSync(INDEX_PATH).size + ' bytes)');

/* ─── .env loader ─────────────────────────────────────────────────────── */
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) {
    console.log('  .env:        ' + Y + 'MISSING' + X + '  →  Copy-Item docs\\env.example .env');
    return {};
  }
  const out = {};
  const text = fs.readFileSync(ENV_PATH, 'utf8');
  let lineCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith('#')) continue;
    lineCount++;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  const nonEmpty = Object.keys(out).filter(k => out[k] !== '').length;
  console.log('  .env:        found (' + nonEmpty + ' non-empty value' + (nonEmpty === 1 ? '' : 's') + ', ' + lineCount + ' lines)');
  return out;
}

const ENV = Object.assign({}, process.env, loadEnv());

/* ─── Providers — 2026 model IDs ─────────────────────────────────────── */
const PROVIDERS = {
  groq: {
    label: 'Groq', envKey: 'GROQ_API_KEY', type: 'openai',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'groq/compound'],
    defaultModel: 'openai/gpt-oss-120b'
  },
  gemini: {
    label: 'Gemini', envKey: 'GEMINI_API_KEY', type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash'
  },
  cerebras: {
    label: 'Cerebras', envKey: 'CEREBRAS_API_KEY', type: 'openai',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    models: ['llama3.1-8b', 'llama3.1-70b'],
    defaultModel: 'llama3.1-70b'
  },
  mistral: {
    label: 'Mistral', envKey: 'MISTRAL_API_KEY', type: 'openai',
    url: 'https://api.mistral.ai/v1/chat/completions',
    models: ['mistral-small-latest', 'mistral-large-latest'],
    defaultModel: 'mistral-small-latest'
  },
  nvidia: {
    label: 'NVIDIA NIM', envKey: 'NVIDIA_API_KEY', type: 'openai',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    models: ['meta/llama-3.3-70b-instruct'],
    defaultModel: 'meta/llama-3.3-70b-instruct'
  },
  openrouter: {
    label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', type: 'openai',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['meta-llama/llama-3.3-70b-instruct:free', 'google/gemini-2.0-flash-exp:free'],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    extraHeaders: { 'HTTP-Referer': 'http://localhost:8787', 'X-Title': 'Aura-lie' }
  }
};

function configuredProviders() {
  const out = [];
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (ENV[p.envKey] && String(ENV[p.envKey]).trim().length > 0) {
      out.push({ name, label: p.label, models: p.models, defaultModel: p.defaultModel });
    }
  }
  return out;
}

function pickProvider(name) {
  if (name && PROVIDERS[name] && ENV[PROVIDERS[name].envKey]) return name;
  const pref = String(ENV.PREFERRED_PROVIDER || '').toLowerCase().trim();
  if (pref && PROVIDERS[pref] && ENV[PROVIDERS[pref].envKey]) return pref;
  for (const k of Object.keys(PROVIDERS)) if (ENV[PROVIDERS[k].envKey]) return k;
  return null;
}

const cfg = configuredProviders();
console.log('  providers:   ' + (cfg.length ? G + cfg.map(p => p.label).join(', ') + X : Y + 'NONE — add GROQ_API_KEY to .env' + X));

/* ─── Streaming ───────────────────────────────────────────────────────── */
async function* streamOpenAI(provider, key, model, messages) {
  const p = PROVIDERS[provider];
  const res = await fetch(p.url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, p.extraHeaders || {}),
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.7 })
  });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(p.label + ' ' + res.status + ' — ' + b.slice(0, 300));
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const j = JSON.parse(payload);
          const d = j.choices && j.choices[0] && j.choices[0].delta;
          if (!d) continue;
          if (d.reasoning || d.reasoning_content) yield { type: 'reasoning', text: d.reasoning || d.reasoning_content };
          if (d.content) yield { type: 'text', text: d.content };
        } catch (_) {}
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

async function* streamGemini(key, model, messages) {
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = { contents };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const url = PROVIDERS.gemini.baseUrl + '/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse&key=' + encodeURIComponent(key);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error('Gemini ' + res.status + ' — ' + b.slice(0, 300)); }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim(); if (!payload) continue;
        try {
          const j = JSON.parse(payload);
          const parts = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
          if (!parts) continue;
          for (const pt of parts) if (pt.text) yield { type: 'text', text: pt.text };
        } catch (_) {}
      }
    }
  } finally { reader.cancel().catch(() => {}); }
}

async function* streamProvider(provider, model, messages) {
  const p = PROVIDERS[provider], key = ENV[p.envKey];
  if (!key) throw new Error(p.label + ' not configured — add ' + p.envKey + ' to .env');
  const m = model || p.defaultModel;
  if (p.type === 'gemini') yield* streamGemini(key, m, messages);
  else yield* streamOpenAI(provider, key, m, messages);
}

/* ─── Search ──────────────────────────────────────────────────────────── */
function safeDomain(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } }

async function wiki(q) {
  try {
    const res = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&srlimit=4&format=json&origin=*');
    if (!res.ok) return [];
    const d = await res.json();
    return (d.query && d.query.search || []).map(r => ({ title: r.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(r.title), snippet: (r.snippet || '').replace(/<[^>]+>/g, ''), domain: 'en.wikipedia.org', tier: 3 }));
  } catch (_) { return []; }
}

async function tavily(q) {
  const key = ENV.TAVILY_API_KEY; if (!key) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ query: q, max_results: 4, include_answer: false })
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.content || '', domain: safeDomain(r.url), tier: 2 }));
  } catch (_) { return []; }
}

async function exa(q) {
  const key = ENV.EXA_API_KEY; if (!key) return [];
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key },
      body: JSON.stringify({ query: q, numResults: 4, contents: { text: { maxCharacters: 400 } } })
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.results || []).map(r => ({ title: r.title, url: r.url, snippet: r.text || '', domain: safeDomain(r.url), tier: 2 }));
  } catch (_) { return []; }
}

async function serper(q) {
  const key = ENV.SERPER_API_KEY; if (!key) return [];
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q, num: 4 })
    });
    if (!res.ok) return [];
    const d = await res.json();
    return (d.organic || []).map(r => ({ title: r.title, url: r.link, snippet: r.snippet || '', domain: safeDomain(r.link), tier: 2 }));
  } catch (_) { return []; }
}

/* ─── HTTP ────────────────────────────────────────────────────────────── */
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { const c = []; req.on('data', x => c.push(x)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); req.on('error', reject); }); }

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url || '/', 'http://localhost');
  const p = u.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(INDEX_PATH, 'utf8')); }
    catch (e) { res.writeHead(500); res.end('index.html missing: ' + e.message); }
    return;
  }
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true, providers: configuredProviders().length });
  if (req.method === 'GET' && p === '/api/status') return send(res, 200, { providers: configuredProviders(), preferred: pickProvider(null), search: { wikipedia: true, tavily: !!ENV.TAVILY_API_KEY, exa: !!ENV.EXA_API_KEY, serper: !!ENV.SERPER_API_KEY } });

  if (req.method === 'POST' && p === '/api/chat') {
    let body; try { body = JSON.parse(await readBody(req)); } catch (_) { return send(res, 400, { error: 'bad JSON' }); }
    if (!Array.isArray(body.messages) || !body.messages.length) return send(res, 400, { error: 'messages required' });
    const provider = pickProvider(body.provider);
    if (!provider) return send(res, 503, { error: 'no_provider', message: 'Add GROQ_API_KEY (or any provider key) to .env, then stop (Ctrl+C) and restart: node server.cjs' });
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    const write = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
    try { for await (const ev of streamProvider(provider, body.model, body.messages)) write(ev); write({ type: 'done', provider }); }
    catch (e) { console.error(R + 'provider error: ' + e.message + X); write({ type: 'error', message: String(e.message || e) }); }
    finally { res.end(); }
    return;
  }

  if (req.method === 'POST' && p === '/api/search') {
    let body; try { body = JSON.parse(await readBody(req)); } catch (_) { return send(res, 400, { error: 'bad JSON' }); }
    const q = String(body.query || '').trim();
    if (!q) return send(res, 400, { error: 'query required' });
    const out = [], seen = new Set();
    const push = arr => { for (const r of arr) if (r && r.url && !seen.has(r.url)) { seen.add(r.url); out.push(r); } };
    push(await wiki(q));
    if (ENV.TAVILY_API_KEY) push(await tavily(q));
    if (ENV.EXA_API_KEY) push(await exa(q));
    if (ENV.SERPER_API_KEY) push(await serper(q));
    return send(res, 200, { results: out.slice(0, 8) });
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found: ' + p);
});

const PORT = parseInt(ENV.PORT || '8787', 10);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(B + R + '\n✖ Port ' + PORT + ' is already in use.' + X);
    console.error('  Another server is holding it. Fix:');
    console.error('    netstat -ano | findstr :' + PORT);
    console.error('    taskkill /PID <the-pid-number> /F');
    console.error('  OR pick a different port: add "PORT=8899" to .env');
    process.exit(1);
  }
  if (err.code === 'EACCES') { console.error(B + R + '\n✖ Permission denied on port ' + PORT + '.' + X); console.error('  Add "PORT=8899" to .env, then restart.'); process.exit(1); }
  console.error(B + R + '\n✖ Server error: ' + err.message + X);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const provs = configuredProviders();
  banner('✓ SERVER RUNNING — open this URL in your browser:', G);
  console.log(B + C + '       http://localhost:' + PORT + X);
  console.log(B + G + '═'.repeat(66) + X);
  console.log('');
  if (!provs.length) {
    console.log(B + Y + '  ⚠ No provider keys configured.' + X);
    console.log('  The page will load but chat will return "no_provider".');
    console.log('  Fix: open .env in Notepad, add ONE line:');
    console.log('');
    console.log(B + C + '    GROQ_API_KEY=gsk_your_real_key_from_console_groq_com' + X);
    console.log('');
    console.log('  Save .env, then press Ctrl+C here and re-run: node server.cjs');
  } else {
    console.log('  providers: ' + G + provs.map(p => p.label).join(', ') + X);
  }
  console.log('  search:    ' + ['wikipedia', ENV.TAVILY_API_KEY ? 'tavily' : null, ENV.EXA_API_KEY ? 'exa' : null, ENV.SERPER_API_KEY ? 'serper' : null].filter(Boolean).join(', '));
  console.log('  keys live in .env — the browser never sees them.');
  console.log('');
  console.log(B + Y + '  ▸ Leave this terminal OPEN while you use the browser.' + X);
  console.log(B + Y + '  ▸ Closing this terminal = ERR_CONNECTION_REFUSED.' + X);
  console.log(B + Y + '  ▸ Press Ctrl+C here only when you want to stop the server.' + X);
  console.log('');
});