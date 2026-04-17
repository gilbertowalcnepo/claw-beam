# claw-beam

claw-beam is a shared-development prototype for a secure, one-time file transfer tool with a fun OpenClaw-flavored identity.

## Current state

This is **prototype scaffolding only**.

It does **not** yet implement a production-secure wormhole-equivalent transport.
Instead, this first pass establishes:
- repo layout
- product direction
- CLI surface
- threat-model framing
- a local prototype flow for metadata-only beam offers

## Product goal

claw-beam should eventually support:
- short one-time transfer codes
- sender/receiver rendezvous
- PAKE-style shared secret establishment
- end-to-end encrypted metadata and payload transfer
- blind relay support
- single-use expiration and integrity verification

## Prototype v0 boundary

The initial prototype is intentionally small:
- local CLI only
- no network service yet
- no real cryptographic transport yet
- writes/reads a local "beam offer" envelope for design validation
- demonstrates naming, UX shape, and artifact structure

## Proposed future commands

- `claw-beam send ./file.zip`
- `claw-beam receive`
- `claw-beam inspect ./offer.json`
- `claw-beam relay`
- `claw-beam mailbox`

## Prototype commands available now

- `claw-beam send <file>`
  - creates a local beam offer metadata file
- `claw-beam inspect <offer.json>`
  - prints the offer contents in human-readable form

## Security note

This prototype is **not secure for real secret transfer yet**.
Do not use it for credentials, private files, or sensitive operator material until the actual secure protocol exists.

## Design direction

Recommended secure design for a future real version:
- PAKE: SPAKE2 or CPace
- key derivation: HKDF-SHA256
- transport encryption: Noise or libsodium AEAD/secretstream
- relay blindness by default
- short-lived single-use codes
- verifier phrase for human confirmation

## Files of interest

- `bin/claw-beam.js` - CLI entrypoint
- `src/claw-beam.js` - prototype implementation
- `docs/PROTOCOL_SKETCH.md` - future protocol notes
- `test/claw-beam.test.js` - basic CLI-free unit tests

## Development note

This repo lives in shared development because the current task is product/protocol prototyping, not production rollout.
