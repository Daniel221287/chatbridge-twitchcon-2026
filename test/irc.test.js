import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { IrcClient, parseLine } from '../src/irc.js';

class FakeSocket extends EventEmitter {
  static sockets = [];
  constructor(url) { super(); this.url = url; this.sent = []; FakeSocket.sockets.push(this); }
  addEventListener(name, fn) { this.on(name, fn); }
  send(value) { this.sent.push(value); }
  close() { this.emit('close'); }
}

test('parses Twitch tags, chat fixtures, emotes and timestamps', async () => {
  const lines = (await readFile(new URL('fixtures/twitch.txt', import.meta.url), 'utf8')).trim().split(/\r?\n/);
  const message = parseLine(lines[0]).message;
  assert.equal(message.channel, 'polish_team');
  assert.equal(message.user, 'Zosia');
  assert.equal(message.color, '#1E90FF');
  assert.equal(message.id, 'fixture-pl');
  assert.equal(message.text, 'dawaj, chopie! Kappa');
  assert.deepEqual(message.emoteTokens, ['Kappa']);
  assert.equal(message.ts, 1793200000000);
  assert.equal(parseLine(lines[1]).message.badges, 'moderator/1');
  assert.equal(parseLine('@x=hello\\sworld\\:ok\\\\ :server NOTICE :hi').tags.x, 'hello world;ok\\');
  assert.equal(parseLine(''), null);
});

test('anonymous handshake, PING/PONG and incoming chat are read-only', async (t) => {
  const client = new IrcClient(['polish_team', 'english_team'], { WebSocketImpl: FakeSocket });
  t.after(() => client.stop());
  client.start();
  const socket = FakeSocket.sockets.at(-1);
  socket.emit('open');
  assert.match(socket.sent[2], /^NICK justinfan\d+\r\n$/);
  assert.equal(socket.sent[3], 'JOIN #polish_team,#english_team\r\n');
  socket.emit('message', { data: 'PING :tmi.twitch.tv\r\n' });
  assert.equal(socket.sent.at(-1), 'PONG :tmi.twitch.tv\r\n');
  const line = (await readFile(new URL('fixtures/twitch.txt', import.meta.url), 'utf8')).split(/\r?\n/)[0];
  const received = once(client, 'message');
  socket.emit('message', { data: line + '\r\n' });
  assert.equal((await received)[0].text, 'dawaj, chopie! Kappa');
  assert.ok(socket.sent.every((line) => /^(CAP|PASS|NICK|JOIN|PONG) /.test(line)));
});

test('reconnects with bounded backoff and stop cancels retries', async () => {
  const client = new IrcClient(['polish_team'], { WebSocketImpl: FakeSocket, retryMs: 1, maxRetryMs: 2 });
  client.start();
  const first = FakeSocket.sockets.at(-1);
  const connecting = once(client, 'status');
  first.close();
  assert.equal((await connecting)[0], 'reconnecting');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.notEqual(FakeSocket.sockets.at(-1), first);
  client.stop();
  const count = FakeSocket.sockets.length;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(FakeSocket.sockets.length, count);
  assert.throws(() => new IrcClient(['bad\r\nJOIN #x']), /Invalid/);
});