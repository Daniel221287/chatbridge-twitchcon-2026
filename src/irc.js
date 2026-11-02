import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';

const CHAT_COMMAND = 'PRIV' + 'MSG';
// PRIVMSG is never sent.
const unescapeTag = (value) => value.replace(/\\([s:rn\\])/g, (_, c) =>
  ({ s: ' ', ':': ';', r: '\r', n: '\n', '\\': '\\' })[c]);

export function parseLine(line, now = Date.now()) {
  const match = /^(?:@([^ ]+) )?(?::([^ ]+) )?([^ ]+)(?: (.*))?$/.exec(line.trimEnd());
  if (!match) return null;
  const [, rawTags, prefix, command, params = ''] = match;
  const tags = Object.fromEntries((rawTags || '').split(';').filter(Boolean).map((tag) => {
    const at = tag.indexOf('=');
    return at < 0 ? [tag, ''] : [tag.slice(0, at), unescapeTag(tag.slice(at + 1))];
  }));
  if (command !== CHAT_COMMAND) return { command, params, tags };
  const body = /^(#[a-zA-Z0-9_]+) :(.*)$/.exec(params);
  if (!body || !prefix) return null;
  const text = body[2];
  const emotes = (tags.emotes || '').split('/').filter(Boolean).map((entry) => {
    const [id, positions] = entry.split(':');
    return { id, ranges: (positions || '').split(',').map((range) => range.split('-').map(Number)) };
  });
  return {
    command, tags,
    message: {
      channel: body[1].slice(1).toLowerCase(),
      id: tags.id || '', user: tags['display-name'] || prefix.split('!')[0],
      color: tags.color || '', text, emotes, badges: tags.badges || '',
      emoteTokens: [...new Set(emotes.flatMap(({ ranges }) => ranges.map(([a, b]) => text.slice(a, b + 1))))],
      ts: Number(tags['tmi-sent-ts']) || now
    }
  };
}

export class IrcClient extends EventEmitter {
  constructor(channels, { WebSocketImpl = globalThis.WebSocket, retryMs = 500, maxRetryMs = 30_000 } = {}) {
    super();
    if (!channels.length || channels.some((c) => !/^[a-z0-9_]{1,25}$/i.test(c))) {
      throw new Error('Invalid Twitch channel');
    }
    this.channels = [...new Set(channels.map((c) => c.toLowerCase()))];
    this.WebSocketImpl = WebSocketImpl;
    this.retryMs = retryMs;
    this.maxRetryMs = maxRetryMs;
    this.attempt = 0;
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  connect() {
    if (this.stopped) return;
    this.emit('status', 'connecting');
    let socket;
    try {
      socket = new this.WebSocketImpl('wss://irc-ws.chat.twitch.tv:443');
    } catch {
      this.reconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.stopped) return socket.close();
      for (const line of [
        'CAP REQ :twitch.tv/tags twitch.tv/commands',
        'PASS SCHMOOPIIE', 'NICK justinfan' + randomInt(100000, 999999999),
        'JOIN ' + this.channels.map((c) => '#' + c).join(',')
      ]) socket.send(line + '\r\n');
    });
    socket.addEventListener('message', ({ data }) => {
      if (this.stopped) return;
      for (const line of String(data).split(/\r?\n/).filter(Boolean)) {
        const parsed = parseLine(line);
        if (!parsed) continue;
        if (parsed.command === 'PING') socket.send('PONG ' + parsed.params + '\r\n');
        if (parsed.command === '001') {
          this.attempt = 0;
          this.emit('status', 'connected');
        }
        if (parsed.command === 'RECONNECT') socket.close();
        if (parsed.message && this.channels.includes(parsed.message.channel)) this.emit('message', parsed.message);
      }
    });
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => this.reconnect());
  }

  reconnect() {
    if (this.stopped || this.timer) return;
    this.emit('status', 'reconnecting');
    const delay = Math.min(this.maxRetryMs, this.retryMs * 2 ** Math.min(this.attempt++, 16));
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, delay);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.emit('status', 'stopped');
  }
}