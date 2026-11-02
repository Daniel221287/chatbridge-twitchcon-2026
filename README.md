# ChatBridge

**Two chats. One team.** A Polish streamer and an English-speaking streamer share a
game, but their communities speak different languages. ChatBridge brings the other
community's chat onto each stream as a translated OBS browser source.

Built in **OpenAI Codex** for the **Codex x TwitchCon** hackathon. Node.js 24 built-ins
only. No npm install, Twitch account, tokens, paid APIs, fonts or CDNs.

## 60-second setup

Requires Node.js 24. From this directory:

```sh
node bin/chatbridge.js --demo
```

Open the printed **panel URL**: http://127.0.0.1:8787/panel.
Open **overlay B**: http://127.0.0.1:8787/overlay?for=B.

Within a second, Zosia's "dawaj, chopie!" becomes **"Come on, mate!"**, with 🇵🇱 and
the original underneath. The script alternates communities every 1.8 seconds.
Demo is fully offline: a clearly labeled eight-phrase translation script replaces
Ollama; it does not measure model quality or latency. Custom demo text appears as a
marked original. Stop with **Ctrl+C**.

For real chat, have a local Ollama server running with a downloaded model, then:

```sh
node bin/chatbridge.js --a polish_channel --a-lang pl --b english_channel --b-lang en --model qwen3:8b
```

Ollama must listen at http://127.0.0.1:11434. Model installation is a separate,
user-managed prerequisite; ChatBridge never downloads models or installs services.
A smaller existing model such as llama3.2:3b can reduce RAM needs. If Ollama is
unavailable or exceeds eight seconds, the original appears with **not translated**.

CLI options: --a, --b, --a-lang, --b-lang, --model, --port, --demo, --help.
Default port: 8787. Live mode requires both channel names explicitly.
Two-letter lowercase language codes are accepted; local skip detection covers PL/EN.

Optional: copy chatbridge.config.example.json to chatbridge.config.json in this
repository and edit it. CLI values override that file. Queue size, bots, blocklist,
per-user limits and the local Ollama URL are configurable there. No config is written
by the app. The real config is gitignored.

## OBS browser sources

1. Start ChatBridge and leave the terminal running.
2. In OBS, add a **Browser** source, width 680, height 900.
3. On stream A use http://127.0.0.1:8787/overlay?for=A.
   On stream B use http://127.0.0.1:8787/overlay?for=B.
4. Place it above gameplay. The page background is transparent; dark cards retain contrast.
5. Optional URL settings: &anonymize=1&max=8&fade=20.
   max is 1–30 visible cards; fade is seconds (1–600).
6. Clear overlays from the panel before recording a fresh take.

Both OBS browser sources must reach the computer running ChatBridge. The server
binds to 127.0.0.1 only; it does not expose a remote overlay or open firewall ports.

## Streamer desk

The panel has independent pause/resume controls for each destination, queue and
latency stats, drop counts, connection status, local test injection, hide, clear
and session blocklist updates. **The human has the last word.**

- **Pause** holds waiting work in a bounded queue and suppresses in-flight output
  if it completes while paused. **Resume** drains the waiting queue.
- **Hide** removes a recently shown message from both overlays.
- **Clear** removes cards, waiting work and pending display from before the action.
- **Block** removes matching recent messages and checks waiting and in-flight
  results before display. Blocklist changes last until restart.
- The panel retains at most 50 messages per destination in memory. Older cards
  expire after the overlay's configured fade time.
- Stats poll every 1.5 seconds. Latency includes queue wait and translation.
  "done" means processed queue jobs; moderated jobs can also contribute to it.
  Queue overflow/clear drops, moderation drops and input filter drops are separate.

## Architecture

```text
Twitch A + B (anonymous WebSocket, receive only)   Offline demo / local injection
                     |                                      |
                     +-------------------+------------------+
                                         v
                           safety filter + per-user limit
                                         |
                          +--------------+--------------+
                          v                             v
                    FIFO A → B                     FIFO B → A
                  30 waiting slots               30 waiting slots
                          |                             |
                  local Ollama → EN              local Ollama → PL
                    or marked original             or marked original
                          |                             |
                          +--- moderation re-check -----+
                          |                             |
                       SSE → B                       SSE → A
                          |                             |
                  OBS overlay B                  OBS overlay A

                     Local streamer panel → pause / hide / clear / block
```

src/irc.js handles anonymous login, tag parsing, keepalive and bounded exponential
reconnect; src/filter.js strips URLs and spam and applies moderation; src/queue.js
serializes each direction; src/translate.js handles Ollama, placeholders and LRU
cache; src/server.js owns routing, moderation and SSE; src/demo.js provides sample
chat; bin/chatbridge.js owns configuration, startup and shutdown. public/ contains
the self-contained overlay and panel.

## Privacy and safety

- Receive-only anonymous Twitch login. Only capability negotiation, anonymous
  login, joins and heartbeat responses are sent. No Twitch tokens or secrets.
- Chat is never written to disk by default. Runtime history and cache are bounded
  in memory and disappear on exit. Console output contains startup URLs, not chat.
- anonymize=1 replaces author nicknames with stable viewer numbers on that SSE
  connection. **Mentions and message content can still identify people.** This is
  a recording convenience, not a promise of full anonymization. The local panel
  shows the real names for moderation.
- Both input and translated output are filtered. Defaults drop commands, known
  bots, a small PL/EN insult list, URLs, character spam and bursts above three
  messages per viewer per ten seconds. The cleaned text is capped at 200 code points.
- Rendering uses textContent, never HTML from viewers or the model.
- HTTP is loopback-only with Host/origin checks, JSON-only mutations and no CORS.
  Any program or person on the same computer can access the panel; it has no login.
- Source chat is sent only to local Ollama, never to a paid translation service.
- A disconnected overlay clears stale cards so missed moderation events do not
  leave messages visible when it reconnects. SSE has no chat history replay.

## Limits

Local model speed depends on hardware and model warm-up. Eight seconds is a
fallback bound, not a one-second latency promise. Each direction runs one translation
at a time; busy chats lose the oldest waiting messages after 30 slots.

Translation may be wrong, and moderation is a small normalized substring blocklist,
not a comprehensive safety classifier. False positives and missed obfuscations are
possible. Language skip detection is conservative and limited to common PL/EN chat;
other messages go to the model. Mixed-language text may be misclassified.

Mentions, the sender name and known Twitch emotes are protected with placeholders;
unknown third-party emotes or bare names of other viewers may be translated. Missing
or damaged protected tokens cause a marked-original fallback. Twitch emotes render
as text, without third-party image requests.

Demo uses scripted translations. Live Twitch and a real model require a separate
manual connectivity/quality check; the automated suite is offline. UI tests exercise
overlay logic with a small DOM fixture; OBS layout still needs a visual check.

## Verification

```sh
npm test
```

Uses node --test. Twitch uses fake WebSockets; Ollama uses local node:http mocks
bound to ephemeral port 0. All test servers and timers close. No external network,
dependencies or credentials are required.

For a short CLI-level demo acceptance check where local PowerShell script execution is permitted:

```powershell
powershell -NoProfile -File scripts/check-demo.ps1
```

It starts the real --demo CLI on an ephemeral port, checks printed URLs, both SSE
directions, translated phrases and panel controls, then stops the child process.
Logs are temporary files inside this repository and are removed after the check.
On a machine that blocks .ps1 files, the same terminal commands can be run directly;
no execution-policy changes are needed. See ACCEPTANCE.md for this build's evidence.

## Design decisions

- A/B in overlay URLs always identify the destination streamer: A chat feeds B's overlay.
- Independent single-worker queues bound memory and avoid one community starving the other.
- Drop-oldest overload favors fresh live reactions over increasingly stale chat.
- Ollama requests use think:false, stream:false, temperature:0 and JSON output.
  A 256-entry in-memory LRU cache holds successful results; failures are never cached.
- Confident same-language phrases skip Ollama; model detection handles uncertain input.
- Validated random placeholders protect known names, mentions and emotes.
- Demo has an explicit offline phrasebook so first-run recording needs no model download.
- Moderation is checked after async translation, and a clear advances a generation
  counter so pending results cannot repopulate cleared overlays.
- Slow SSE consumers disconnect above 64 KiB buffered output.
- Server-side pseudonyms keep raw author fields out of anonymized SSE events.
- Everything, including evidence, stays inside this repository. Repository-only
  scope takes precedence over global tools, TEAM and external skill files.

## License

MIT. See LICENSE.