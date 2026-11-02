import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createBridge } from '../src/server.js';
import { IrcClient } from '../src/irc.js';
import { createTranslator } from '../src/translate.js';

// Opt-in live acceptance, never part of the offline test suite. No chat is sent.
const { values } = parseArgs({ options: {
  a: { type: 'string' }, b: { type: 'string' },
  model: { type: 'string', default: 'qwen3:8b' },
  seconds: { type: 'string', default: '45' }, out: { type: 'string' }
} });
assert.match(values.a || '', /^[a-z0-9_]{1,25}$/i, 'Provide --a CHANNEL');
assert.match(values.b || '', /^[a-z0-9_]{1,25}$/i, 'Provide --b CHANNEL');
const seconds = Number(values.seconds);
assert.ok(Number.isInteger(seconds) && seconds >= 5 && seconds <= 120, '--seconds must be 5..120');
const channels = { A: values.a.toLowerCase(), B: values.b.toLowerCase() };
const translate = createTranslator({ model: values.model });
const receipt = {
  at: new Date().toISOString(), model: values.model, channels, observationSeconds: seconds,
  modelChecks: [], liveReceived: { A: 0, B: 0 }, liveAccepted: { A: 0, B: 0 },
  overlayMessages: { A: 0, B: 0 }, overlayTranslated: { A: 0, B: 0 },
  ircStates: [], chatSentToTwitch: false, persistedLiveChat: false,
  status: 'UNVERIFIED', errors: []
};
const app = createBridge({ a: channels.A, b: channels.B, translate });
const irc = new IrcClient(Object.values(channels));
const streams = [];
const acceptedIds = new Map();
let liveStarted = false;

function subscribe(base, side) {
  return new Promise((resolve, reject) => {
    const request = http.get(base + '/events?for=' + side, (response) => {
      if (response.statusCode !== 200) { response.destroy(); reject(new Error('SSE rejected')); return; }
      request.setTimeout(0);
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(frame)?.[1];
          const payload = /^data: (.+)$/m.exec(frame)?.[1];
          if (event === 'message' && payload && liveStarted) {
            const message = JSON.parse(payload);
            const accepted = acceptedIds.get(message.id);
            if (!accepted || accepted.for !== side || accepted.channel !== message.channel) {
              receipt.errors.push('An overlay message was not correlated to accepted live IRC');
              continue;
            }
            receipt.overlayMessages[side]++;
            if (message.translated) receipt.overlayTranslated[side]++;
          }
        }
        resolve();
      });
      response.on('error', (error) => {
        if (liveStarted) receipt.errors.push('SSE ' + side + ': ' + error.message);
        reject(error);
      });
      response.on('end', () => {
        if (liveStarted) receipt.errors.push('SSE ' + side + ' ended during observation');
      });
      streams.push(response);
    });
    request.setTimeout(5000, () => request.destroy(new Error('SSE startup timeout')));
    request.on('error', reject);
    streams.push(request);
  });
}

try {
  // These are controlled local phrases, explicitly separate from real Twitch traffic.
  for (const [text, targetLang, sourceLang] of [
    ['Dzięki! Gramy razem!', 'en', 'pl'],
    ['That jump was incredible!', 'pl', 'en']
  ]) {
    const start = performance.now();
    const result = await translate({ user: 'AcceptanceViewer', text }, targetLang);
    receipt.modelChecks.push({ input: text, targetLang, ...result, ms: Math.round(performance.now() - start) });
    assert.equal(result.translated, true, 'Real local model did not translate the controlled phrase');
    assert.equal(result.sourceLang, sourceLang, 'Unexpected language classification');
  }
  const base = await app.listen(0);
  await Promise.all(['A', 'B'].map((side) => subscribe(base, side)));
  irc.on('status', (status) => { receipt.ircStates.push(status); app.setStatus(status); });
  irc.on('message', (message) => {
    const source = message.channel === channels.A ? 'A' : 'B';
    receipt.liveReceived[source]++;
    try {
      const result = app.inject(message);
      if (result.accepted) {
        receipt.liveAccepted[source]++;
        acceptedIds.set(result.id, { for: result.for, channel: message.channel });
      }
    }
    catch { receipt.errors.push('A live message was rejected as invalid'); }
  });
  liveStarted = true;
  irc.start();
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  const socket = irc.socket;
  const closed = new Promise((resolve) => {
    if (!socket || socket.readyState === 3) return resolve(true);
    const timer = setTimeout(() => resolve(false), 3000);
    socket.addEventListener('close', () => { clearTimeout(timer); resolve(true); }, { once: true });
  });
  irc.stop();
  receipt.ircClosed = await closed;
  // Drop only waiting items, then let the in-flight translations finish within their 8s timeout.
  Object.values(app.queues).forEach((queue) => queue.clear());
  await Promise.all(Object.values(app.queues).map((queue) => queue.idle()));
  receipt.ircConnected = receipt.ircStates.includes('connected');
  receipt.bothChannelsReceived = Object.values(receipt.liveReceived).every((n) => n > 0);
  receipt.bothOverlaysReceived = Object.values(receipt.overlayMessages).every((n) => n > 0);
  receipt.realLiveTranslation = Object.values(receipt.overlayTranslated).some((n) => n > 0);
  receipt.status = receipt.ircConnected && receipt.bothChannelsReceived &&
    receipt.bothOverlaysReceived && receipt.realLiveTranslation && receipt.ircClosed &&
    !receipt.errors.length ? 'PASS' : 'PARTIAL';
} catch (error) {
  receipt.errors.push(error.message);
  receipt.status = 'FAIL';
} finally {
  liveStarted = false;
  if (!irc.stopped) irc.stop();
  streams.forEach((stream) => stream.destroy());
  await app.close();
  receipt.finishedAt = new Date().toISOString();
  receipt.localServerClosed = !app.server.listening;
  if (values.out) await writeFile(values.out, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status !== 'PASS') process.exitCode = 1;
}
