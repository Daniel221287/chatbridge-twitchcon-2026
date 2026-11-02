import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/server.js';
import { connectEvents, post } from '../support/helpers.js';

test('injection broadcasts only to the other community over SSE', async (t) => {
  const app = createBridge();
  t.after(() => app.close());
  const base = await app.listen(0);
  const a = await connectEvents(base, 'A');
  const b = await connectEvents(base, 'B');
  t.after(() => { a.close(); b.close(); });
  const next = b.next();
  const response = await post(base, '/inject', { channel: 'polish_team', user: 'Zosia', text: 'dawaj, chopie!' });
  assert.equal(response.status, 200);
  const message = await next;
  assert.equal(message.for, 'B');
  assert.equal(message.original, 'dawaj, chopie!');
  assert.equal(a.events.filter((e) => e.name === 'message').length, 0);
  assert.equal((await fetch(base + '/overlay?for=B&anonymize=1')).status, 200);
});
test('rejects unknown channels, invalid SSE side, cross-origin writes and bad requests', async (t) => {
  const app = createBridge();
  t.after(() => app.close());
  const base = await app.listen(0);
  assert.equal((await post(base, '/inject', { channel: 'other', user: 'x', text: 'hi' })).status, 400);
  assert.equal((await fetch(base + '/events?for=C')).status, 400);
  assert.equal((await post(base, '/inject', {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post(base, '/inject', {})).status, 400);
  assert.equal((await fetch(base + '/absent')).status, 404);
});