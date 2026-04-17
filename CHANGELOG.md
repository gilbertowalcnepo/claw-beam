# Changelog

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
