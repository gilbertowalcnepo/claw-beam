# claw-beam

claw-beam is a shared-development prototype for a secure, one-time file transfer tool with a fun OpenClaw-flavored identity.

## Current state

This is a **bounded proof of concept**.

It now includes:
- local encrypted beam bundle creation
- explicit receiver accept step before receive
- session-wrapped payload key flow
- explicit handshake metadata and transcript state
- code-derived bootstrap and accepted-session key wrapping
- integrity verification after decrypt
- bundle consumption tracking
- optional bundle deletion on receive
- simple CLI for send, accept, receive, and inspect

It is still **not** a final wormhole-equivalent secure transport.
There is no live rendezvous server, no blind relay, and no PAKE yet.

## Current POC behavior

- `claw-beam send <file>`
  - reads a local file
  - generates a one-time beam code
  - creates a random payload key
  - encrypts the payload with that payload key
  - wraps the payload key with a code-derived bootstrap key
  - writes sender-side handshake metadata and transcript state into the bundle
  - writes the bundle to `.out/<filename>.beam.json`
  - prints the beam code to the sender, but stores only a masked code hint in the bundle
  - leaves transfer state at `awaiting-accept`
- `claw-beam accept <bundle.json> <code> [receiver-label]`
  - verifies the code can unwrap the bootstrap-wrapped payload key
  - re-wraps the payload key into an accepted-session key using sender nonce + accept nonce
  - records explicit receiver acceptance
  - records receiver-side handshake commitment and updates the transcript hash
  - moves transfer state to `accepted`
- `claw-beam receive <bundle.json> <code>`
  - requires the bundle to have been accepted first
  - requires handshake state to be complete enough for receive
  - derives the accepted-session unwrap key from the code and session nonces
  - decrypts the payload using the recovered payload key
  - verifies integrity with SHA-256
  - marks the bundle consumed and sets handshake state to completed
  - removes the bundle by default after successful receive
- `claw-beam receive <bundle.json> <code> --keep-bundle`
  - same as above, but preserves the bundle for inspection
- `claw-beam inspect <bundle.json>`
  - prints human-readable metadata summary

## Important security warning

This is still a **prototype**.

What it proves:
- naming and UX shape
- local encrypted handoff bundle flow
- explicit sender/receiver acceptance state
- explicit handshake/transcript seam for future PAKE integration
- payload encryption separated from the raw beam code
- bundle no longer stores the raw beam code
- one-time-like consumption behavior in local artifacts
- future transition path to a real protocol

What it does **not** prove yet:
- online rendezvous security
- relay blindness in practice
- PAKE-backed resistance to code exposure
- transport/session replay protections
- distributed one-time enforcement across peers
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
- `claw-beam accept ./bundle.json CODE per`
- `claw-beam receive ./bundle.json CODE`
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
- `test/cli.test.js` - CLI regression tests

## Development note

This repo lives in shared development because the current task is product/protocol prototyping, not production rollout.
