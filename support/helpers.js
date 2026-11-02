import http from 'node:http';

export async function connectEvents(base, side = 'B') {
  const events = [];
  const waiters = [];
  let response;
  const request = http.get(base + '/events?for=' + side);
  const ready = new Promise((resolve, reject) => {
    request.on('error', reject);
    request.on('response', (incoming) => {
      response = incoming;
      if (incoming.statusCode !== 200) return reject(new Error('SSE rejected'));
      let buffer = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (data) => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const name = /^event: (.+)$/m.exec(frame)?.[1];
          const payload = /^data: (.+)$/m.exec(frame)?.[1];
          if (!name || !payload) continue;
          const event = { name, data: JSON.parse(payload) };
          events.push(event);
          for (const waiter of [...waiters]) if (waiter.name === name) {
            waiters.splice(waiters.indexOf(waiter), 1);
            clearTimeout(waiter.timer); waiter.resolve(event.data);
          }
        }
        resolve();
      });
      incoming.on('error', () => {});
    });
  });
  await ready;
  return {
    events,
    next(name = 'message', timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const waiter = { name, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error('Timed out waiting for ' + name));
        }, timeoutMs) };
        waiters.push(waiter);
      });
    },
    close() {
      for (const waiter of waiters) clearTimeout(waiter.timer);
      request.destroy(); response?.destroy();
    }
  };
}

export async function post(base, route, body, headers = {}) {
  return fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
  });
}