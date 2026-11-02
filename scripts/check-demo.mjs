import assert from 'node:assert/strict';
import { connectEvents, post } from '../support/helpers.js';

const base = process.argv[2];
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const clients = [];
try {
  const a = await connectEvents(base, 'A'); clients.push(a);
  const b = await connectEvents(base, 'B'); clients.push(b);
  const [messageA, messageB] = await Promise.all([a.next('message', 6000), b.next('message', 6000)]);
  assert.equal(messageA.demo, true);
  assert.equal(messageB.demo, true);
  assert.equal(messageA.translated, true);
  assert.equal(messageB.translated, true);
  assert.equal(messageA.sourceLang, 'en');
  assert.equal(messageB.sourceLang, 'pl');
  console.log('DEMO CHECK: scripted chat received on both overlay SSE streams');

  const next = b.next();
  const injected = await post(base, '/inject', { channel: 'polish_team', user: 'AcceptanceViewer', text: 'dawaj, chopie!' });
  assert.equal(injected.status, 200);
  const result = await next;
  assert.equal(result.text, 'Come on, mate!');
  assert.equal(result.original, 'dawaj, chopie!');
  console.log('DEMO CHECK: dawaj, chopie! -> Come on, mate! (pl, destination B)');

  assert.equal((await fetch(base + '/panel')).status, 200);
  assert.equal((await fetch(base + '/overlay?for=B&anonymize=1')).status, 200);
  for (const action of ['pause', 'resume']) {
    assert.equal((await post(base, '/control', { action, for: 'B' })).status, 200);
  }
  const hidden = b.next('hide');
  await post(base, '/control', { action: 'hide', id: result.id });
  assert.equal((await hidden).id, result.id);
  const cleared = b.next('clear');
  await post(base, '/control', { action: 'clear' });
  await cleared;
  console.log('DEMO CHECK: panel, overlay, pause/resume, hide and clear passed');
} finally {
  clients.forEach((client) => client.close());
}