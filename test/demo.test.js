import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/server.js';
import { startDemo } from '../src/demo.js';
import { connectEvents } from '../support/helpers.js';

test('offline scripted demo reaches overlay through the shared pipeline', async (t) => {
  const app = createBridge({ mode: 'demo' });
  t.after(() => app.close());
  const base = await app.listen(0);
  const events = await connectEvents(base);
  t.after(() => events.close());
  const next = events.next();
  const stop = startDemo(app.inject, { a: 'polish_team', b: 'english_team', intervalMs: 1000 });
  t.after(stop);
  assert.equal((await next).original, 'dawaj, chopie!');
  assert.equal(events.events[0].data.status, 'demo');
});