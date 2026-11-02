// A tiny DOM fixture exercises the real inline overlay script without a browser dependency.
export function overlayHarness(script, search = '?for=B') {
  class Element {
    constructor(tag) {
      this.tag = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} };
      this.classList = { add: (value) => { this.className = value; } };
    }
    append(...children) {
      for (const child of children) { child.parent = this; this.children.push(child); }
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    }
    setAttribute(key, value) { this[key] = value; }
    get firstElementChild() { return this.children[0]; }
  }
  const list = new Element('main'); const connection = new Element('div');
  const document = {
    querySelector: (selector) => selector === '#messages' ? list : connection,
    createElement: (tag) => new Element(tag),
    documentElement: new Element('html')
  };
  let source;
  class EventSource {
    constructor(url) { this.url = url; this.handlers = new Map(); source = this; }
    addEventListener(name, handler) { this.handlers.set(name, handler); }
    dispatch(name, data) { this.handlers.get(name)?.({ data: JSON.stringify(data) }); }
    close() { this.closed = true; }
  }
  let timerId = 0;
  const timers = new Map();
  const setTimer = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  const clearTimer = (id) => timers.delete(id);
  const handlers = new Map();
  const window = { addEventListener: (event, handler) => handlers.set(event, handler) };
  new Function('document', 'location', 'EventSource', 'URLSearchParams', 'setTimeout', 'clearTimeout', 'window', script)(
    document, { search }, EventSource, URLSearchParams, setTimer, clearTimer, window
  );
  return { list, connection, source, timers, handlers,
    runTimers() { const current = [...timers.values()]; timers.clear(); current.forEach(({ callback }) => callback()); }
  };
}