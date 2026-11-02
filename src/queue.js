export class DirectionQueue {
  constructor(worker, { maxLength = 30, now = Date.now } = {}) {
    if (!Number.isInteger(maxLength) || maxLength < 1) throw new Error('Invalid queue length');
    this.worker = worker;
    this.maxLength = maxLength;
    this.now = now;
    this.items = [];
    this.running = false;
    this.paused = false;
    this.closed = false;
    this.done = 0;
    this.dropped = 0;
    this.failed = 0;
    this.latency = 0;
    this.idleWaiters = [];
  }

  push(value) {
    if (this.closed) return;
    if (this.items.length >= this.maxLength) { this.items.shift(); this.dropped++; }
    this.items.push({ value, at: this.now() });
    void this.drain();
  }

  async drain() {
    if (this.running || this.closed || this.paused) return;
    this.running = true;
    try {
      while (this.items.length && !this.closed && !this.paused) {
        const { value, at } = this.items.shift();
        try { await this.worker(value); this.done++; }
        catch { this.failed++; }
        this.latency += this.now() - at;
      }
    } finally {
      this.running = false;
      if (!this.items.length || this.closed) this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  pause(value) { this.paused = value; if (!value) void this.drain(); }
  clear() {
    this.dropped += this.items.length;
    this.items = [];
    if (!this.running) this.idleWaiters.splice(0).forEach((resolve) => resolve());
  }
  async idle() {
    if (!this.running && !this.items.length) return;
    await new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  async close() { this.closed = true; this.clear(); if (this.running) await this.idle(); }
  stats() {
    return {
      queued: this.items.length, active: this.running, paused: this.paused,
      done: this.done, dropped: this.dropped, failed: this.failed,
      avgLatencyMs: Math.round(this.latency / (this.done + this.failed || 1))
    };
  }
}