import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DirectionQueue } from '../src/queue.js';

test('bounded FIFO drops oldest waiting item and runs one worker', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = [];
  let active = 0;
  const queue = new DirectionQueue(async (value) => {
    active++;
    assert.equal(active, 1);
    if (value === 1) await gate;
    seen.push(value);
    active--;
  }, { maxLength: 2 });
  [1, 2, 3, 4].forEach((value) => queue.push(value));
  assert.equal(queue.stats().queued, 2);
  assert.equal(queue.stats().dropped, 1);
  release();
  await queue.idle();
  assert.deepEqual(seen, [1, 3, 4]);
  assert.equal(queue.stats().done, 3);
  await queue.close();
});

test('worker failure is counted and later work continues', async () => {
  const queue = new DirectionQueue(async (value) => { if (value === 1) throw new Error('fixture'); });
  queue.push(1); queue.push(2);
  await queue.idle();
  assert.equal(queue.stats().failed, 1);
  assert.equal(queue.stats().done, 1);
  await queue.close();
});

test('clearing a paused queue releases idle waiters and drops waiting work', { timeout: 1000 }, async () => {
  let called = false;
  const queue = new DirectionQueue(async () => { called = true; });
  queue.pause(true);
  queue.push(1);
  const idle = queue.idle();
  queue.clear();
  await idle;
  assert.equal(called, false);
  assert.equal(queue.stats().dropped, 1);
  await queue.close();
});