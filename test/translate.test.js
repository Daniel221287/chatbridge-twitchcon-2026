import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, detectLanguage } from '../src/translate.js';
import { createBridge } from '../src/server.js';
import { connectEvents, post } from '../support/helpers.js';

async function mockOllama(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    requests.push({ path: req.url, body: JSON.parse(data) });
    handler(res, requests.at(-1).body);
  });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { endpoint: 'http://127.0.0.1:' + server.address().port, requests };
}
const answer = (res, text, sourceLang = 'pl') => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: { content: JSON.stringify({ sourceLang, text }) } }));
};
const message = (text = 'dawaj, chopie!') => ({ text, user: 'Zosia' });

test('Ollama request disables thinking/streaming, requests JSON, and caches translations', async (t) => {
  const mock = await mockOllama(t, (res) => answer(res, 'Come on, mate!'));
  const translate = createTranslator({ endpoint: mock.endpoint });
  assert.deepEqual(await translate(message(), 'en'), { sourceLang: 'pl', text: 'Come on, mate!', translated: true });
  assert.equal((await translate(message(), 'en')).cached, true);
  assert.equal(mock.requests.length, 1);
  const { path, body } = mock.requests[0];
  assert.equal(path, '/api/chat');
  assert.equal(body.model, 'qwen3:8b');
  assert.equal(body.think, false);
  assert.equal(body.stream, false);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.format, 'json');
});

test('confident same-language messages skip Ollama; uncertain messages go to model', async (t) => {
  const mock = await mockOllama(t, (res) => answer(res, 'unchanged', 'en'));
  const translate = createTranslator({ endpoint: mock.endpoint });
  assert.equal((await translate(message('Hello, good luck!'), 'en')).skipped, true);
  assert.equal((await translate(message('Dzięki! Gramy razem!'), 'pl')).skipped, true);
  assert.equal(mock.requests.length, 0);
  const result = await translate(message('xyz'), 'en');
  assert.equal(result.text, 'xyz');
  assert.equal(result.skipped, true);
  assert.equal(mock.requests.length, 1);
  assert.equal(detectLanguage('xyz'), 'und');
});

test('protects mentions, sender usernames and Twitch emotes', async (t) => {
  const mock = await mockOllama(t, (res, body) => {
    const input = JSON.parse(body.messages[1].content).text;
    assert.ok(!input.includes('@Sam'));
    assert.ok(!input.includes('Kappa'));
    assert.ok(!input.includes('Zosia'));
    answer(res, input.replace('Dobra robota', 'Good job'));
  });
  const translate = createTranslator({ endpoint: mock.endpoint });
  const result = await translate({ ...message('Dobra robota @Sam Zosia Kappa CustomEmote'), emoteTokens: ['CustomEmote'] }, 'en');
  assert.equal(result.text, 'Good job @Sam Zosia Kappa CustomEmote');
  assert.equal(result.translated, true);
});

test('missing protected tokens fails back to original', async (t) => {
  const mock = await mockOllama(t, (res) => answer(res, 'Good job'));
  const translate = createTranslator({ endpoint: mock.endpoint });
  const input = message('Dobra robota @Sam Kappa');
  assert.equal((await translate(input, 'en')).text, input.text);
  assert.equal((await translate(input, 'en')).translated, false);
});

test('timeout returns marked original and is not cached', async (t) => {
  const mock = await mockOllama(t, () => {});
  const translate = createTranslator({ endpoint: mock.endpoint, timeoutMs: 80 });
  const result = await translate(message(), 'en');
  assert.equal(result.reason, 'timeout');
  assert.equal(result.text, 'dawaj, chopie!');
  assert.equal(result.translated, false);
  await translate(message(), 'en');
  assert.equal(mock.requests.length, 2);
});

test('invalid JSON, missing model and unavailable service fall back safely', async (t) => {
  const mock = await mockOllama(t, (res) => res.end('not json'));
  const translate = createTranslator({ endpoint: mock.endpoint });
  assert.equal((await translate(message(), 'en')).reason, 'unavailable');
  const bad = await mockOllama(t, (res) => { res.writeHead(404); res.end('missing model'); });
  assert.equal((await createTranslator({ endpoint: bad.endpoint })(message(), 'en')).translated, false);
  const unreachable = createTranslator({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await unreachable(message(), 'en')).reason, 'unavailable');
  assert.throws(() => createTranslator({ endpoint: 'https://example.com' }), /local/);
});

test('cache is bounded and keyed by target language', async (t) => {
  const mock = await mockOllama(t, (res) => answer(res, 'translated'));
  const translate = createTranslator({ endpoint: mock.endpoint, cacheSize: 1 });
  await translate(message(), 'en');
  await translate(message('Ale akcja!'), 'en');
  assert.equal((await translate(message(), 'en')).cached, undefined);
  await translate(message(), 'de');
  assert.equal(mock.requests.length, 4);
});

test('end-to-end: injected Polish chat A arrives translated on overlay B', async (t) => {
  const mock = await mockOllama(t, (res) => answer(res, 'Come on, mate!'));
  const app = createBridge({ translate: createTranslator({ endpoint: mock.endpoint }) });
  t.after(() => app.close());
  const base = await app.listen(0);
  const events = await connectEvents(base);
  t.after(() => events.close());
  const next = events.next();
  await post(base, '/inject', { channel: 'polish_team', user: 'Zosia', text: 'dawaj, chopie!' });
  const received = await next;
  assert.equal(received.text, 'Come on, mate!');
  assert.equal(received.original, 'dawaj, chopie!');
  assert.equal(received.sourceLang, 'pl');
  assert.equal(received.for, 'B');
  assert.equal(received.translated, true);
});