import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ChatFilter } from './filter.js';
import { DirectionQueue } from './queue.js';

const pages = new URL('../public/', import.meta.url);
const sides = ['A', 'B'];

export function createBridge({
  a = 'polish_team', b = 'english_team', aLang = 'pl', bLang = 'en',
  translate = async (message) => ({ text: message.text, sourceLang: 'und', translated: false }),
  filterOptions, queueLength = 30, mode = 'live'
} = {}) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b || [a, b].some((v) => !/^[a-z0-9_]{1,25}$/.test(v))) throw new Error('Two different valid channels are required');
  if ([aLang, bLang].some((v) => typeof v !== 'string' || !/^[a-z]{2}$/.test(v))) throw new Error('Languages must be lowercase two-letter codes');
  const filter = new ChatFilter(filterOptions);
  const clients = { A: new Set(), B: new Set() };
  const recent = { A: [], B: [] };
  const generations = { A: 0, B: 0 };
  const moderated = { A: 0, B: 0 };
  const pseudonyms = new Map();
  let viewerNumber = 0;
  let status = mode === 'demo' ? 'demo' : 'connecting';
  let closed = false;

  const privateMessage = (message) => {
    const key = message.user.toLowerCase();
    if (!pseudonyms.has(key)) {
      if (pseudonyms.size >= 5000) pseudonyms.delete(pseudonyms.keys().next().value);
      pseudonyms.set(key, 'viewer #' + ++viewerNumber);
    }
    return { ...message, user: pseudonyms.get(key) };
  };
  const send = (side, event, data) => {
    for (const client of clients[side]) {
      const { response, anonymize } = client;
      // A slow OBS client must not grow an unbounded memory buffer.
      if (response.writableLength > 64 * 1024) { response.destroy(); continue; }
      const payload = event === 'message' && anonymize ? privateMessage(data) : data;
      response.write('event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n');
    }
  };
  const queues = Object.fromEntries(sides.map((side) => [side, new DirectionQueue(async ({ message, generation }) => {
    if (filter.blocked(message.text)) { moderated[side]++; return; }
    let result;
    try { result = await translate(message, side === 'A' ? aLang : bLang); }
    catch { result = { text: message.text, sourceLang: 'und', translated: false, reason: 'unavailable' }; }
    // Re-check after async work: a moderator may have cleared, paused, or blocked meanwhile.
    if (closed || generation !== generations[side] || queues[side].paused ||
        filter.blocked(message.text) || filter.blocked(result.text)) {
      moderated[side]++;
      return;
    }
    const text = filter.clean(result.text);
    if (!text) { moderated[side]++; return; }
    const shown = {
      id: message.id, channel: message.channel, user: message.user,
      color: /^#[a-f0-9]{6}$/i.test(message.color || '') ? message.color : '',
      text, original: message.text, sourceLang: result.sourceLang,
      translated: Boolean(result.translated), skipped: Boolean(result.skipped),
      reason: result.reason, demo: Boolean(result.demo), ts: message.ts, for: side
    };
    recent[side].push(shown);
    if (recent[side].length > 50) recent[side].shift();
    send(side, 'message', shown);
  }, { maxLength: queueLength })]));

  const inject = (message) => {
    if (closed) return { accepted: false, reason: 'closed' };
    if (!message || typeof message.channel !== 'string' || typeof message.user !== 'string' ||
        typeof message.text !== 'string' || !/^[\p{L}\p{N}_]{1,25}$/u.test(message.user) ||
        message.text.length > 5000) throw new Error('Expected channel, user and text (up to 5000 characters)');
    const channel = message.channel.toLowerCase().replace(/^#/, '');
    const side = channel === a ? 'B' : channel === b ? 'A' : null;
    if (!side) throw new Error('Unknown channel');
    const clean = filter.accept({
      channel, user: message.user, text: message.text,
      id: typeof message.id === 'string' && /^[a-z0-9-]{1,80}$/i.test(message.id) ? message.id : randomUUID(),
      ts: Number.isFinite(message.ts) ? message.ts : Date.now(),
      color: typeof message.color === 'string' ? message.color : '',
      emoteTokens: Array.isArray(message.emoteTokens)
        ? message.emoteTokens.filter((v) => typeof v === 'string' && v.length < 100).slice(0, 100) : []
    });
    if (clean) queues[side].push({ message: clean, generation: generations[side] });
    return { accepted: Boolean(clean), for: side, id: clean?.id };
  };

  const clear = (side) => {
    generations[side]++;
    queues[side].clear();
    recent[side] = [];
    send(side, 'clear', {});
  };
  const control = (data) => {
    if (!data || typeof data !== 'object') throw new Error('Expected a control action');
    const { action, for: side } = data;
    if (action === 'pause' || action === 'resume') {
      if (!sides.includes(side)) throw new Error('for must be A or B');
      queues[side].pause(action === 'pause');
    } else if (action === 'clear') {
      if (side !== undefined && !sides.includes(side)) throw new Error('for must be A or B');
      (side ? [side] : sides).forEach(clear);
    } else if (action === 'hide') {
      if (typeof data.id !== 'string' || data.id.length > 80) throw new Error('Expected a message id');
      for (const destination of sides) {
        recent[destination] = recent[destination].filter((message) => message.id !== data.id);
        send(destination, 'hide', { id: data.id });
      }
    } else if (action === 'block') {
      if (typeof data.word !== 'string' || !data.word.trim() || data.word.length > 60) throw new Error('Expected a word (1–60 characters)');
      if (filter.blocklist.size >= 500) throw new Error('Blocklist is full');
      filter.addWord(data.word);
      for (const destination of sides) {
        for (const message of recent[destination]) {
          if (filter.blocked(message.original) || filter.blocked(message.text)) send(destination, 'hide', { id: message.id });
        }
        recent[destination] = recent[destination].filter((message) =>
          !filter.blocked(message.original) && !filter.blocked(message.text));
      }
    } else throw new Error('Unknown control action');
    return { ok: true };
  };
  const stats = () => ({
    status, mode, channels: { A: a, B: b }, languages: { A: aLang, B: bLang },
    filtered: filter.dropped, blocklist: [...filter.blocklist],
    directions: Object.fromEntries(sides.map((side) => [side, { ...queues[side].stats(), moderated: moderated[side] }])),
    recent
  });

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    try {
      // Loopback binding plus exact Host validation prevents DNS-rebinding origins.
      const port = server.address()?.port;
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(request.headers.host)) {
        return json(response, 403, { error: 'Host rejected; use the printed loopback URL' });
      }
      if (!request.url.startsWith('/') || request.url.startsWith('//')) throw new Error('Invalid path');
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/events') {
        const side = url.searchParams.get('for');
        if (!sides.includes(side)) return json(response, 400, { error: 'for must be A or B' });
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        response.write('event: status\ndata: ' + JSON.stringify({ status }) + '\n\n');
        const client = { response, anonymize: url.searchParams.get('anonymize') === '1' };
        clients[side].add(client);
        response.on('close', () => clients[side].delete(client));
        return;
      }
      if (request.method === 'GET' && ['/overlay', '/panel', '/'].includes(url.pathname)) {
        if (url.pathname === '/overlay' && !sides.includes(url.searchParams.get('for'))) {
          return json(response, 400, { error: 'for must be A or B' });
        }
        const html = await readFile(new URL(url.pathname === '/overlay' ? 'overlay.html' : 'panel.html', pages), 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return response.end(html);
      }
      if (request.method === 'GET' && url.pathname === '/stats') return json(response, 200, stats());
      if (request.method === 'POST' && ['/inject', '/control'].includes(url.pathname)) {
        if (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host) {
          return json(response, 403, { error: 'Origin rejected' });
        }
        const data = await readJson(request);
        return json(response, 200, url.pathname === '/inject' ? inject(data) : control(data));
      }
      json(response, 404, { error: 'Not found' });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) json(response, error.status || 400, { error: error.message });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  const heartbeat = setInterval(() => {
    for (const side of sides) for (const { response } of clients[side]) {
      if (response.writableLength > 64 * 1024) response.destroy();
      else response.write(': heartbeat\n\n');
    }
  }, 15_000);
  heartbeat.unref();

  return {
    server, inject, queues, filter,
    setStatus(value) { status = value; for (const side of sides) send(side, 'status', { status }); },
    async listen(port = 8787) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      return 'http://127.0.0.1:' + server.address().port;
    },
    async close() {
      closed = true;
      clearInterval(heartbeat);
      for (const side of sides) for (const { response } of clients[side]) response.end();
      const closing = new Promise((resolve, reject) => {
        server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
        server.closeAllConnections();
      });
      await Promise.all([closing, ...Object.values(queues).map((queue) => queue.close())]);
    }
  };
}

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new Error('Content-Type must be application/json');
  }
  let body = '';
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw new Error('Request too large');
    body += chunk;
  }
  return JSON.parse(body);
}