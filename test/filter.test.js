import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatFilter } from '../src/filter.js';

const msg = (text, user = 'Zosia') => ({ channel: 'polish_team', user, text });
test('strips URLs, collapses spam and bounds Unicode text', () => {
  const filter = new ChatFilter();
  assert.equal(filter.accept(msg('wow https://example.com www.test.org test.net/path aaaaaaa')).text, 'wow aaa');
  assert.equal([...filter.clean('😀🎮'.repeat(110))].length, 200);
  assert.equal(filter.accept(msg('https://example.com')), null);
});
test('drops commands, configurable bots and normalized blocklist matches', () => {
  const filter = new ChatFilter({ blocklist: ['żółw'], bots: ['custombot'] });
  assert.equal(filter.accept(msg(' !play')), null);
  assert.equal(filter.accept(msg('hello', 'CustomBot')), null);
  assert.equal(filter.accept(msg('ZOLW')), null);
  filter.addWord('BAD');
  assert.equal(filter.accept(msg('bąd')), null);
  assert.ok(filter.accept(msg('welcome')));
  assert.equal(new ChatFilter().accept(msg('hello', 'NightBot')), null);
});
test('rate limit is per viewer and expires', () => {
  let time = 0;
  const filter = new ChatFilter({ now: () => time, perUser: 1, windowMs: 100 });
  assert.ok(filter.accept(msg('one')));
  assert.equal(filter.accept(msg('two', 'zosia')), null);
  assert.ok(filter.accept(msg('other', 'Sam')));
  time = 101;
  assert.ok(filter.accept(msg('three')));
});