import http from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/server.js';
import { connectEvents, post } from '../support/helpers.js';

async function setup(t, options = {}) {
  const app = createBridge(options);
  t.after(() => app.close());
  const base = await app.listen(0);
  const events = await connectEvents(base);
  t.after(() => events.close());
  return { app, base, events };
}
const input = (text, user = 'Zosia', channel = 'polish_team') => ({ channel, user, text });
const stats = async (base) => (await fetch(base + '/stats')).json();
const gate = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('pause/resume isolates directions and queues work for the paused overlay', async (t) => {
  const { app, base, events } = await setup(t);
  assert.equal((await post(base, '/control', { action: 'pause', for: 'B' })).status, 200);
  await post(base, '/inject', input('dawaj, chopie!'));
  await post(base, '/inject', input('Hello, good luck!', 'Sam', 'english_team'));
  await app.queues.A.idle();
  const paused = await stats(base);
  assert.equal(paused.directions.B.queued, 1);
  assert.equal(paused.directions.B.paused, true);
  assert.equal(paused.directions.A.done, 1);
  assert.equal(events.events.filter((e) => e.name === 'message').length, 0);
  const next = events.next();
  await post(base, '/control', { action: 'resume', for: 'B' });
  assert.equal((await next).text, 'dawaj, chopie!');
});

test('hide removes a shown message and clear empties recent history and overlays', async (t) => {
  const { app, base, events } = await setup(t);
  const next = events.next();
  app.inject(input('dawaj, chopie!'));
  const message = await next;
  const hidden = events.next('hide');
  await post(base, '/control', { action: 'hide', id: message.id });
  assert.equal((await hidden).id, message.id);
  assert.equal((await stats(base)).recent.B.length, 0);
  const clear = events.next('clear');
  await post(base, '/control', { action: 'clear' });
  await clear;
  assert.equal((await stats(base)).recent.A.length, 0);
});

test('clear discards queued and in-flight translations but permits new messages', async (t) => {
  const started = gate(); const release = gate();
  t.after(release.resolve);
  const { app, base, events } = await setup(t, {
    translate: async (message) => { started.resolve(); await release.promise; return { text: message.text, sourceLang: 'pl', translated: true }; }
  });
  app.inject(input('old one'));
  await started.promise;
  app.inject(input('old two', 'Marek'));
  await post(base, '/control', { action: 'clear', for: 'B' });
  release.resolve();
  await app.queues.B.idle();
  assert.equal(events.events.filter((e) => e.name === 'message').length, 0);
  assert.equal((await stats(base)).directions.B.queued, 0);
  const next = events.next();
  app.inject(input('new message', 'Ola'));
  assert.equal((await next).text, 'new message');
});

test('pause prevents an already-running translation from appearing', async (t) => {
  const started = gate(); const release = gate();
  t.after(release.resolve);
  const { app, base, events } = await setup(t, {
    translate: async (message) => { started.resolve(); await release.promise; return { text: message.text, sourceLang: 'pl' }; }
  });
  app.inject(input('pending'));
  await started.promise;
  await post(base, '/control', { action: 'pause', for: 'B' });
  release.resolve();
  await app.queues.B.idle();
  assert.equal(events.events.filter((e) => e.name === 'message').length, 0);
  assert.equal((await stats(base)).directions.B.moderated, 1);
});

test('blocklist hides existing matches and drops normalized future matches', async (t) => {
  const { app, base, events } = await setup(t);
  const next = events.next();
  app.inject(input('Toxic phrase'));
  await next;
  const hide = events.next('hide');
  await post(base, '/control', { action: 'block', word: 'tóxic' });
  await hide;
  assert.equal((await stats(base)).recent.B.length, 0);
  const response = await post(base, '/inject', input('TOXIC phrase', 'Marek'));
  assert.equal((await response.json()).accepted, false);
});

test('new blocks apply to in-flight source text and translated output', async (t) => {
  const started = gate(); const release = gate();
  t.after(release.resolve);
  const { app, base, events } = await setup(t, {
    translate: async () => { started.resolve(); await release.promise; return { text: 'freshword', sourceLang: 'pl', translated: true }; }
  });
  app.inject(input('harmless'));
  await started.promise;
  await post(base, '/control', { action: 'block', word: 'freshword' });
  release.resolve();
  await app.queues.B.idle();
  assert.equal(events.events.filter((e) => e.name === 'message').length, 0);
});

test('translated output is cleaned before display and translator errors show marked originals', async (t) => {
  let fail = false;
  const { app, events } = await setup(t, {
    translate: async () => {
      if (fail) throw new Error('offline');
      return { text: 'hello https://example.com aaaaaaa', sourceLang: 'pl', translated: true };
    }
  });
  let next = events.next();
  app.inject(input('first'));
  assert.equal((await next).text, 'hello aaa');
  fail = true;
  next = events.next();
  app.inject(input('second'));
  const result = await next;
  assert.equal(result.text, 'second');
  assert.equal(result.translated, false);
  assert.equal(result.reason, 'unavailable');
});

test('anonymized SSE replaces author names with stable viewer numbers', async (t) => {
  const { app, base } = await setup(t);
  const anonymous = await connectEvents(base, 'B&anonymize=1');
  t.after(() => anonymous.close());
  let next = anonymous.next();
  app.inject(input('first'));
  const first = await next;
  assert.equal(first.user, 'viewer #1');
  next = anonymous.next();
  app.inject(input('second'));
  assert.equal((await next).user, first.user);
  next = anonymous.next();
  app.inject(input('third', 'Sam'));
  assert.equal((await next).user, 'viewer #2');
});

test('panel, stats, validation and local-origin protections work offline', async (t) => {
  const { base } = await setup(t);
  const panel = await fetch(base + '/panel');
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /The human has the last word/);
  assert.match(panel.headers.get('content-security-policy'), /default-src 'none'/);
  for (const body of [{ action: 'oops' }, { action: 'pause', for: 'C' }, { action: 'block', word: '' }, { action: 'clear', for: 'C' }, { action: 'hide' }]) {
    assert.equal((await post(base, '/control', body)).status, 400);
  }
  assert.equal((await post(base, '/control', { action: 'clear' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await fetch(base + '/inject', { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await fetch(base + '/overlay?for=C')).status, 400);
  assert.equal((await post(base, '/inject', input('x'.repeat(17_000)))).status, 400);
  const rejected = await new Promise((resolve, reject) => {
    const request = http.get(base + '/stats', { headers: { Host: 'evil.example' } }, (response) => {
      response.resume(); response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
  });
  assert.equal(rejected, 403);
});

test('recent message history is bounded and queues close while paused', async (t) => {
  const { app, base } = await setup(t, { filterOptions: { perUser: 100 } });
  for (let index = 0; index < 55; index++) {
    app.inject(input('message ' + index));
    await app.queues.B.idle();
  }
  assert.equal((await stats(base)).recent.B.length, 50);
  await post(base, '/control', { action: 'pause', for: 'B' });
  app.inject(input('waiting'));
  await app.close();
  assert.equal(app.queues.B.stats().queued, 0);
  assert.equal(app.inject(input('after close')).accepted, false);
});