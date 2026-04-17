# Changelog

## v2026.4.17-alpha

- Added initial claw-beam shared-development prototype scaffold.
- Upgraded the prototype into a bounded local encrypted send/receive POC.
- Added local bundle encryption, decryption, integrity verification, and inspect flow.
- Added one-time-like receive semantics with consumption tracking and default bundle removal.
- Added CLI error handling so wrong codes return a clean user-facing message.
- Added explicit accept step and transfer-state tracking (`awaiting-accept` -> `accepted` -> `consumed`).
- Reworked the bundle flow so the raw beam code is no longer stored in the bundle.
- Added session-wrapped payload-key flow: bootstrap key wrap at send, accepted-session re-wrap at accept, accepted-session unwrap at receive.
- Added explicit handshake metadata and transcript state so PAKE can replace the current synthetic commitments later without reshaping the whole flow.
- Added tests for masked code hints, accept-time code verification, session wrap transitions, handshake status transitions, transcript updates, and CLI flow.
