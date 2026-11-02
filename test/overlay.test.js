import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { overlayHarness } from '../support/overlay-harness.js';

const html = await readFile(new URL('../public/overlay.html', import.meta.url), 'utf8');
const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
const message = { id: '1', user: 'viewer #1', text: 'Come on, mate!', original: 'dawaj, chopie!', sourceLang: 'pl', translated: true };

test('overlay renders flags, translated and original text safely and limits cards', () => {
  const page = overlayHarness(script, '?for=B&anonymize=1&max=1');
  assert.equal(page.source.url, '/events?for=B&anonymize=1');
  page.source.dispatch('message', message);
  assert.equal(page.list.children[0].children[0].children[0].textContent, '🇵🇱');
  assert.equal(page.list.children[0].children[1].textContent, 'Come on, mate!');
  assert.equal(page.list.children[0].children[2].textContent, 'dawaj, chopie!');
  page.source.dispatch('message', { ...message, id: '2', text: '<img src=x onerror=alert(1)>' });
  assert.equal(page.list.children.length, 1);
  assert.equal(page.list.children[0].children[1].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(page.list.children[0].children[1].children.length, 0);
  assert.equal(page.timers.size, 1);
});

test('overlay handles hide, clear, reconnect, expiry, and shuts down event stream', () => {
  const page = overlayHarness(script, '?for=A&fade=2');
  page.source.dispatch('message', message);
  page.source.dispatch('hide', { id: '1' });
  assert.equal(page.list.children.length, 0);
  page.source.dispatch('message', message);
  page.source.dispatch('clear', {});
  assert.equal(page.timers.size, 0);
  page.source.dispatch('message', message);
  page.runTimers();
  assert.equal(page.list.children[0].className, 'leaving');
  page.runTimers();
  assert.equal(page.list.children.length, 0);
  page.source.dispatch('message', message);
  page.source.dispatch('error');
  assert.equal(page.list.children.length, 0);
  assert.equal(page.connection.dataset.state, 'reconnecting');
  page.handlers.get('pagehide')();
  assert.equal(page.source.closed, true);
});

test('overlay labels demo and untranslated messages honestly', () => {
  const page = overlayHarness(script);
  page.source.dispatch('message', { ...message, demo: true });
  assert.equal(page.list.children[0].children[0].children.at(-1).textContent, 'demo phrasebook');
  page.source.dispatch('message', { ...message, translated: false });
  assert.equal(page.list.children[1].children[0].children.at(-1).textContent, 'not translated');
  page.source.dispatch('status', { status: 'demo' });
  assert.match(page.connection.textContent, /scripted/);
});

test('panel inline JavaScript has valid syntax and no unsafe HTML insertion', async () => {
  const panel = await readFile(new URL('../public/panel.html', import.meta.url), 'utf8');
  const source = /<script>([\s\S]*?)<\/script>/.exec(panel)[1];
  assert.doesNotThrow(() => new Function(source));
  assert.doesNotMatch(source + script, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(panel + html, /https?:\/\/|<script\s+src|@import/);
});