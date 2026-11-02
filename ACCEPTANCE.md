# ChatBridge acceptance evidence

Verified locally on 2026-10-28 with Node v24.19.0 and npm 11.17.0.
All task-authored files and temporary logs stayed inside this repository.
No TEAM files, other projects, remote machines or remote Git operations were used.

## Milestone verification

- M1: npm test — 11 tests passed, 0 failed. Commit 7e1bbf4.
- M2: npm test — 19 tests passed, 0 failed. Commit 2bf8cd3.
- M3: npm test — 34 tests passed, 0 failed, 0 skipped, 0 cancelled.
  Includes pause/resume isolation, hide/clear/block, in-flight moderation races,
  anonymized SSE, local HTTP protections, bounded history and overlay DOM behavior.

All Twitch connections in tests are fake WebSockets. Ollama tests use ephemeral
loopback node:http mock servers. No live Twitch or real model was contacted.

## Real CLI demo smoke check

Started node bin/chatbridge.js --demo --port 0 as a hidden child process, with
temporary startup logs inside this repository. Observed:

    ChatBridge · DEMO / scripted phrasebook (no model needed)
    Overlay A: http://127.0.0.1:26988/overlay?for=A
    Overlay B: http://127.0.0.1:26988/overlay?for=B
    Panel:     http://127.0.0.1:26988/panel
    DEMO CHECK: scripted chat received on both overlay SSE streams
    DEMO CHECK: dawaj, chopie! -> Come on, mate! (pl, destination B)
    DEMO CHECK: panel, overlay, pause/resume, hide and clear passed
    DEMO CHECK: child stopped; HasExited=True

The parent stopped and waited for the child in finally, then deleted both logs.
Port 0 deliberately selected an ephemeral port; ordinary demo startup defaults to 8787.
scripts/check-demo.mjs contains the HTTP/SSE assertions.

The machine's execution policy rejected direct .ps1 execution. The equivalent
explicit PowerShell terminal commands succeeded. No execution policy was changed.

## Dependencies, send safety and cleanup

Observed automated inspection output:

    DEPENDENCY CHECK: runtime=0 dev=0 optional=0 peer=0; no node_modules or lockfile
    SEND-SAFETY CHECK: only executable-code literal is the never-sent comment at src/irc.js:5
    FIXTURE CHECK: raw incoming IRC lines exist only in test/fixtures/twitch.txt
    CLEANUP CHECK: no demo check logs remain

The source scan covered .js, .mjs, .html and .ps1 under src, bin, public, test,
support and scripts. The incoming chat command appears verbatim in the raw .txt
fixtures, the original brief/rules, and the never-sent comment, not in executable
send paths. The fake-socket test asserts every outgoing frame begins with one of
CAP, PASS, NICK, JOIN or PONG.

git diff --check passed. No dependencies were installed. No application chat logs
were written. Every application HTTP test server uses port 0 and is closed.

## Manual checks still needed

Live Twitch connectivity, real Ollama quality/latency, and visual layout in OBS
remain unverified. Demo translations are a labeled fixed phrasebook, not model
output. Anonymization hides author fields; message text and mentions remain visible.