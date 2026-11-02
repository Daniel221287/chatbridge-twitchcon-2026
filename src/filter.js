export const DEFAULT_BOTS = ['nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot'];
export const DEFAULT_BLOCKLIST = ['idiot', 'idiota', 'debil', 'fuck', 'kurwa'];
export const normalize = (text) => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

export class ChatFilter {
  constructor({ bots = DEFAULT_BOTS, blocklist = DEFAULT_BLOCKLIST, maxChars = 200,
    perUser = 3, windowMs = 10_000, now = Date.now } = {}) {
    this.bots = new Set(bots.map(normalize));
    this.blocklist = new Set(blocklist.map(normalize).filter(Boolean));
    this.maxChars = maxChars;
    this.perUser = perUser;
    this.windowMs = windowMs;
    this.now = now;
    this.users = new Map();
    this.dropped = 0;
  }

  addWord(word) {
    const normalized = normalize(word.trim());
    if (normalized) this.blocklist.add(normalized);
  }

  clean(text) {
    return [...text
      .replace(/(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/:?#]\S*)?/gi, '')
      .replace(/(.)\1{3,}/gu, '$1$1$1')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ').trim()].slice(0, this.maxChars).join('');
  }

  blocked(text) {
    const normalized = normalize(text);
    return [...this.blocklist].some((word) => normalized.includes(word));
  }

  accept(message) {
    const text = this.clean(message.text);
    const key = normalize(message.user);
    if (!text || text.startsWith('!') || this.bots.has(key) || this.blocked(message.text)) {
      this.dropped++;
      return null;
    }
    const time = this.now();
    const recent = (this.users.get(key) || []).filter((ts) => time - ts < this.windowMs);
    if (recent.length >= this.perUser) {
      this.dropped++;
      return null;
    }
    // Bound rate-limit state even when many unique viewers join.
    if (!this.users.has(key) && this.users.size >= 5000) this.users.delete(this.users.keys().next().value);
    this.users.set(key, [...recent, time]);
    return { ...message, text };
  }
}