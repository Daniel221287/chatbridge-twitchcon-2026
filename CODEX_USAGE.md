# Built with OpenAI Codex

Main build session: `01a181fb-1cc4-78b2-857b-871e6d391c8e`.

The project was started on 28 October 2026 during the Codex x TwitchCon
submission period. Daniel supplied the idea: help Polish and English speaking
co-streaming communities understand one another without posting bot replies.

Codex implemented the anonymous receive-only Twitch IRC connection, parsing,
filters, bounded directional queues, local Ollama translation, HTTP/SSE bridge,
two overlays, moderation desk, offline demo, documentation and automated tests.
The implementation milestones are recorded in the original local repository:
`7e1bbf4` (pipeline), `2bf8cd3` (translation), and `47e1928` (moderation and UI).

The finalization session added a separate opt-in live acceptance check. It reads
real public Twitch chat and measures messages reaching both HTTP SSE streams.
It stores aggregate counts and controlled local translation examples rather
than public viewers' chat text. Offline scripted demo output is not live proof.

The main build session ID above belongs in the Devpost form. The repository
does not include raw Codex conversations, local agent instructions or private
workstation coordination records.
