# Live verification, 2 November 2026

The Twitch connection and bridge were exercised against real public chat.
This is distinct from the offline demo and the offline unit suite.

## Verified transport run

At 15:27 UTC, an explicit 45 second observation used channels `youngmulti`
and `forsen` and the existing local model `qwen3.5:4b`.

| Measurement | Channel A / overlay A | Channel B / overlay B |
| --- | ---: | ---: |
| Twitch messages received from source channel | 3 | 489 |
| Messages accepted from source channel | 3 | 444 |
| Messages delivered to destination overlay SSE | 23 | 3 |
| SSE messages marked translated | 22 | 3 |

Overlay A receives channel B, and overlay B receives channel A. Queue limits and
the observation window account for the difference between accepted and displayed
counts. No chat messages were posted to Twitch. Viewers' text was not persisted.
The server and subscriptions were stopped after the check.

## Quality and evidence limits

The run established real message transport and local model invocation. It did
not establish correct translation quality. The two controlled phrases, tested
separately from Twitch traffic, produced incorrect wording with `qwen3.5:4b`.
The smaller installed `qwen3.5:0.8b` also misclassified Polish. Neither result is
a recommended translation configuration. The original `qwen3:8b` default still
needs a real quality check on the recording computer.

The first larger-model attempt timed out during cold startup. Load an existing
model before testing, for example `ollama run qwen3:8b`, then exit the interactive
prompt with `/bye`. This does not install or download a model. If that model is
not already installed, select an existing model explicitly or install one yourself.
The bridge retains its eight second per-message fallback to a marked original.

The live acceptance script was subsequently tightened to correlate accepted IRC
IDs with SSE messages, disable its startup-only SSE timeout after connection,
wait for active translation completion, and check actual WebSocket closure.
Those final checker changes passed syntax inspection; a new full live run is
required before claiming their runtime acceptance.

## Repeatable checks

```sh
node --test
node scripts/check-live.mjs --a YOUR_POLISH_CHANNEL --b YOUR_ENGLISH_CHANNEL --model qwen3:8b --seconds 45 --out live-result.json
```

The opt-in live check has no fake Twitch socket. It stores aggregate counts,
controlled local phrases and status, never viewer chat. It fails or returns a
partial result if one channel stays silent, a model fails, no translated live
message reaches the SSE stream, or a connection cannot be verified closed.

The check does not verify rendering in a browser, OBS capture, a YouTube upload
or Devpost submission. These require their own visible or provider readback.
