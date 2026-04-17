# Changelog

## v2026.4.17-alpha

- Added initial claw-beam shared-development prototype scaffold.
- Upgraded the prototype into a bounded local encrypted send/receive POC.
- Added local bundle encryption, decryption, integrity verification, and inspect flow.
- Added one-time-like receive semantics with consumption tracking and default bundle removal.
- Added CLI error handling so wrong codes return a clean user-facing message.
- Added explicit accept step and transfer-state tracking (`awaiting-accept` -> `accepted` -> `consumed`).
- Added tests for encrypted round-trip, wrong-code rejection, consume behavior, accept gating, and CLI flow.
