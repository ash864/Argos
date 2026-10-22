import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.ARGOS_MODEL || 'claude-sonnet-5-5';
const ACCESS_CODE = process.env.ARGOS_ACCESS_CODE; // optional: protects your key if the server is public
const SYSTEM = `You are Argos, a friendly, capable AI assistant in a mobile chat app. Keep answers clear and concise, since the user is reading on a phone. Use short paragraphs, lists and code blocks when helpful.`;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error('Request too large');
  }
  return JSON.parse(data || '{}');
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

async function demoReply(res) {
  const text = "Hi, I'm Argos running in **demo mode**, because no `ANTHROPIC_API_KEY` is set on the server.\n\nSet it and restart to chat with the real model:\n\n```\nANTHROPIC_API_KEY=sk-ant-... npm start\n```";
  for (const word of text.split(/(?<=\s)/)) {
    sse(res, { text: word });
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function chat(req, res) {
  let body;
  try { body = await readBody(req); } catch { res.writeHead(400).end('Bad request'); return; }
  if (ACCESS_CODE && req.headers['x-access-code'] !== ACCESS_CODE) {
    res.writeHead(401).end('Invalid access code');
    return;
  }
  const messages = (body.messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content)
    .slice(-40);
  if (!messages.length) { res.writeHead(400).end('No messages'); return; }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const abort = new AbortController();
  res.on('close', () => abort.abort());

  try {
    if (!API_KEY) { await demoReply(res); return; }
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: abort.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4096, stream: true, system: SYSTEM, messages }),
    });
    if (!upstream.ok) {
      sse(res, { error: `API error ${upstream.status}: ${(await upstream.text()).slice(0, 300)}` });
      return;
    }
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of upstream.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') sse(res, { text: ev.delta.text });
          else if (ev.type === 'error') sse(res, { error: ev.error?.message || 'Upstream error' });
        } catch { /* ignore keep-alive / partial lines */ }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') sse(res, { error: err.message });
  } finally {
    sse(res, { done: true });
    res.end();
  }
}

async function serveStatic(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  const rel = normalize(path === '/' ? '/index.html' : path);
  if (rel.includes('..')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' }).end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') return chat(req, res);
  if (req.method === 'GET' && req.url === '/api/config') {
    return void res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ needsCode: Boolean(ACCESS_CODE), demo: !API_KEY }));
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405).end();
}).listen(PORT, () => console.log(`Argos running on http://localhost:${PORT}${API_KEY ? '' : '  (demo mode: set ANTHROPIC_API_KEY)'}`));
