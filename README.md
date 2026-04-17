# claw-beam

claw-beam is a shared-development prototype for a secure, one-time file transfer tool with a fun OpenClaw-flavored identity.

## Current state

This is a **bounded proof of concept**.

It is more real than the initial metadata-only scaffold:
- local encrypted beam bundle creation
- code-derived decryption for receive flow
- integrity verification after decrypt
- simple CLI for send, receive, and inspect

It is still **not** a final wormhole-equivalent secure transport.
There is no live rendezvous server, no blind relay, and no PAKE yet.

## Current POC behavior

- `claw-beam send <file>`
  - reads a local file
  - generates a one-time beam code
  - encrypts the file into a local JSON bundle
  - writes the bundle to `.out/<filename>.beam.json`
- `claw-beam receive <bundle.json> <code>`
  - decrypts the bundle using the beam code
  - verifies integrity with SHA-256
  - writes the recovered file to `.out/<filename>`
- `claw-beam inspect <bundle.json>`
  - prints human-readable metadata summary

## Important security warning

This is still a **prototype**.

What it proves:
- naming and UX shape
- local encrypted handoff bundle flow
- code-derived payload decryption
- future transition path to a real protocol

What it does **not** prove yet:
- online rendezvous security
- relay blindness in practice
- PAKE-backed resistance to code exposure
- transport/session replay protections
- full protocol hardening

Do not use this POC for high-sensitivity production secrets.

## Product goal

claw-beam should eventually support:
- short one-time transfer codes
- sender/receiver rendezvous
- PAKE-style shared secret establishment
- end-to-end encrypted metadata and payload transfer
- blind relay support
- single-use expiration and integrity verification

## Proposed future commands

- `claw-beam send ./file.zip`
- `claw-beam receive`
- `claw-beam inspect ./bundle.json`
- `claw-beam relay`
- `claw-beam mailbox`

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
- `src/claw-beam.js` - POC implementation
- `docs/PROTOCOL_SKETCH.md` - future protocol notes
- `test/claw-beam.test.js` - unit tests

## Development note

This repo lives in shared development because the current task is product/protocol prototyping, not production rollout.
