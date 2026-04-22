# Changelog

## v2026.4.22.1

- **README overhaul**: comprehensive documentation update for public release — ngrok tunnel usage, programmatic API reference, token format docs (including HTTPS URLs), security notes, and updated development section.
- **Git history cleanup**: all commit authors neutralized to `Claw Beam <claw-beam@users.noreply.github.com>`. No personal paths or identities remain in tracked source.
- **Git config**: local repo author set to neutral identity for future commits.
- **GitHub release v2026.4.22**: release notes updated to include README changes.

## v2026.4.22

- **ngrok tunnel integration**: `claw-beam send --filepath <file> --ngrok` starts an ephemeral ngrok tunnel so the sender does not need a public IP or port forwarding. The receiver gets the ngrok HTTPS URL inside the PAKE-encrypted token and connects outbound to it.
- **Security model preserved**: ngrok only sees encrypted rendezvous traffic. The token carrying the ngrok URL is PAKE-encrypted, so discovering the URL alone does not compromise the transfer. Tunnels auto-destroy on completion or timeout.
- **pyngrok preferred**: Uses pyngrok (Python) for programmatic tunnel control when available, falls back to the ngrok binary via API polling.
- **`sendSimple` ngrok option**: Programmatic API gains `{ ngrok: true, ngrokRegion, ngrokAuthToken }` options.
- **CLI flags**: `--ngrok`, `--ngrok-region <region>`, `--ngrok-authtoken <token>`.
- **`localUrl` in result**: `sendSimple` now returns `localUrl` alongside `baseUrl`, so callers can distinguish the local server address from the public tunnel URL.
- **`checkNgrokAvailable()`**: New exported function to probe whether ngrok (pyngrok or binary) is installed and functional.
- **41 tests passing**: 31 previous + 10 new ngrok-tunnel tests (module structure, availability detection, error handling, token HTTPS URL round-trip, regression).

## v2026.4.19

- **Simplified two-command UX**: `claw-beam send --filepath <file>` prints a single token; `claw-beam receive --token <token>` fetches and writes the file. No manual accept step needed.
- **Token format**: base64url(JSON) encoding `{ baseUrl, offerId, code }` — copy-paste friendly, self-contained.
- **sendSimple / receiveSimple APIs**: programmatic interface for the simplified flow (auto-publish + auto-accept on sender, single-step receive on receiver).
- **Cross-platform**: Pure JavaScript, no native addons. Works on Linux, macOS, and Windows with Node 18+.
- **Backward compatible**: Legacy positional commands (`send <file>`, `accept <bundle> <code>`, `receive <bundle> <code>`, `send-http`, `accept-http`, etc.) still work.
- **Error handling**: Clean, stable error messages for malformed tokens, wrong codes, and corrupted bundles.
- **Package metadata**: Added `engines`, `files`, `keywords`, and MIT license to `package.json` for proper npm packaging.
- **Quick-start script**: `scripts/quick-e2e.sh` runs both legacy and simplified flows end-to-end.
- **31 tests passing**: 21 existing + 10 new simple-flow tests.

## v2026.4.17-alpha

- Added initial claw-beam shared-development prototype scaffold.
- Upgraded the prototype into a bounded local encrypted send/receive POC.
- Added local bundle encryption, decryption, integrity verification, and inspect flow.
- Added one-time-like receive semantics with consumption tracking and default bundle removal.
- Added CLI error handling so wrong codes return a clean user-facing message.
- Added explicit accept step and transfer-state tracking (`awaiting-accept` -> `accepted` -> `consumed`).
- Reworked the bundle flow so the raw beam code is no longer stored in the bundle.
- Added session-wrapped payload-key flow.
- Added handshake metadata and transcript seam.
- Replaced the synthetic commitment/session-wrap path with a real SPAKE2-backed session establishment.
- Added verifier-gated PAKE secret recovery for the local bundle model and accepted-session re-wraps derived from verified code material.
- Added tests for PAKE-backed bundle creation, accept/receive transitions, wrong-code rejection, and CLI flow.
- Added a local rendezvous mailbox stub with published offer ids, receipt tracking, inspect flow, and CLI offer commands.
- Added a tiny HTTP rendezvous server plus HTTP publish, inspect, accept, and receive flows validated through tests and CLI.
- Refined HTTP rendezvous so the published offer bundle remains immutable after publish, while accept and consume update separate mutable rendezvous state.
- Added explicit HTTP handshake event transport so accept and consume progression is recorded as server-side rendezvous events, not only implied by final state.
