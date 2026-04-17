# claw-beam

claw-beam is a shared-development prototype for a secure, one-time file transfer tool with a fun OpenClaw-flavored identity.

## Current state

This is a **bounded proof of concept**.

It now includes:
- local encrypted beam bundle creation
- explicit receiver accept step before receive
- real SPAKE2-backed session establishment
- PAKE-derived payload-key wrapping
- local rendezvous mailbox stub for offer publish, accept, inspect, and receive
- integrity verification after decrypt
- bundle consumption tracking
- optional bundle deletion on receive
- simple CLI for send, accept, receive, inspect, and rendezvous-backed offer flow

It is still **not** a final wormhole-equivalent secure transport.
There is no networked rendezvous server yet, no blind relay, and no chunked transfer yet. The current rendezvous path is a local mailbox stub that models the future seam.

## Current POC behavior

- `claw-beam send <file>`
  - reads a local file
  - generates a one-time beam code
  - creates a random payload key
  - runs a bounded local SPAKE2 exchange derived from the code
  - encrypts the payload with the payload key
  - wraps the payload key with a PAKE-derived wrap key
  - stores a verifier-gated recovery wrap plus PAKE transcript artifacts in the bundle
  - writes the bundle to `.out/<filename>.beam.json`
  - prints the beam code to the sender, but stores only a masked code hint in the bundle
  - leaves transfer state at `awaiting-accept`
- `claw-beam accept <bundle.json> <code> [receiver-label]`
  - derives the PAKE verifier from the code and verifies it against bundle state
  - recovers the stored PAKE shared secret through a verifier-gated wrap
  - unwraps the payload key from the PAKE bootstrap wrap
  - re-wraps the payload key into an accepted-session key using verifier-derived session material + accept nonce
  - records explicit receiver acceptance
  - moves transfer state to `accepted`
- `claw-beam receive <bundle.json> <code>`
  - requires the bundle to have been accepted first
  - derives the PAKE verifier from the code and verifies it against bundle state
  - derives the accepted-session unwrap key from verifier-derived session material and accept nonce
  - decrypts the payload using the recovered payload key
  - verifies integrity with SHA-256
  - marks the bundle consumed and sets handshake state to completed
  - removes the bundle by default after successful receive
- `claw-beam receive <bundle.json> <code> --keep-bundle`
  - same as above, but preserves the bundle for inspection
- `claw-beam inspect <bundle.json>`
  - prints human-readable metadata summary
- `claw-beam send-rendezvous <file> <rendezvous-dir>`
  - writes a normal bundle locally
  - publishes an offer into a local mailbox-style rendezvous directory
  - returns an offer id plus the beam code
- `claw-beam accept-offer <rendezvous-dir> <offer-id> <code> [receiver-label]`
  - accepts an offer directly from the mailbox stub
  - updates offer receipt state to accepted
- `claw-beam receive-offer <rendezvous-dir> <offer-id> <code>`
  - receives directly from the mailbox stub
  - updates offer receipt state to consumed
- `claw-beam inspect-offer <rendezvous-dir> <offer-id>`
  - prints human-readable rendezvous receipt and bundle summary

## Important security warning

This is still a **prototype**.

What it proves:
- naming and UX shape
- local encrypted handoff bundle flow
- real SPAKE2-backed session establishment in the prototype
- payload encryption separated from the raw beam code
- bundle no longer stores the raw beam code
- one-time-like consumption behavior in local artifacts
- future transition path to a real protocol

What it does **not** prove yet:
- online rendezvous security
- relay blindness in practice
- audited PAKE implementation suitability for production use
- transport/session replay protections across distributed peers
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
