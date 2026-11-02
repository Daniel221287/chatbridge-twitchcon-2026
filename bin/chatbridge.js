#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createBridge } from '../src/server.js';
import { IrcClient } from '../src/irc.js';
import { startDemo } from '../src/demo.js';
import { createTranslator, createDemoTranslator } from '../src/translate.js';

async function main() {
  let config = {};
  try { config = JSON.parse(await readFile(new URL('../chatbridge.config.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Config must be an object');
  const keys = { a: 'a', b: 'b', 'a-lang': 'aLang', 'b-lang': 'bLang', model: 'model', port: 'port' };
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--demo') { config.demo = true; continue; }
    if (flag === '--help') {
      console.log('ChatBridge: --a CHANNEL --a-lang pl --b CHANNEL --b-lang en [--model qwen3:8b] [--port 8787] [--demo]');
      return;
    }
    const key = keys[flag.slice(2)];
    if (!flag.startsWith('--') || !key || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) {
      throw new Error('Unknown option or missing value: ' + flag);
    }
    config[key] = process.argv[++i];
  }
  if (!config.demo && (!config.a || !config.b)) throw new Error('Live mode requires --a and --b (or config channels)');
  const { a = 'polish_team', b = 'english_team' } = config;
  const port = Number(config.port ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  const translate = config.demo ? createDemoTranslator() : createTranslator({ model: config.model, endpoint: config.ollamaUrl });
  const app = createBridge({ ...config, a, b, translate, mode: config.demo ? 'demo' : 'live' });
  const url = await app.listen(port);
  console.log('ChatBridge · ' + (config.demo ? 'DEMO / scripted phrasebook (no model needed)' : 'LIVE / local Ollama'));
  console.log('Overlay A: ' + url + '/overlay?for=A');
  console.log('Overlay B: ' + url + '/overlay?for=B');
  console.log('Panel:     ' + url + '/panel');
  let irc;
  let stopDemo;
  if (config.demo) stopDemo = startDemo(app.inject, { a, b });
  else {
    irc = new IrcClient([a, b]);
    irc.on('message', (message) => app.inject(message));
    irc.on('status', (status) => app.setStatus(status));
    irc.start();
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    stopDemo?.();
    irc?.stop();
    await app.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error) => { console.error('ChatBridge: ' + error.message); process.exitCode = 1; });