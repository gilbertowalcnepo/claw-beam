# claw-beam protocol sketch

## Goal
Create a secure one-time file transfer flow with wormhole-like UX and OpenClaw-friendly naming.

## Current POC state
The current proof of concept is local-only and bundle-based:
- sender encrypts payload with a random payload key
- sender runs a bounded local SPAKE2 exchange derived from the human code
- sender wraps the payload key with a PAKE-derived wrap key
- sender stores a verifier-gated recovery wrap and PAKE transcript artifacts in the bundle
- receiver explicitly accepts the bundle with the code
- acceptance derives the PAKE verifier from the code and verifies bundle state
- acceptance re-wraps the payload key into an accepted-session key
- receiver decrypts the payload using the accepted-session wrap
- integrity is checked after decrypt
- bundle is marked consumed and removed by default after receive

This validates the CLI shape and a more realistic transfer-state model, but it is not yet a network protocol.

## What changed in this step
This prototype now uses a real SPAKE2-based shared secret instead of synthetic commitments or direct code-derived wrapping.
Because SPAKE2 transcripts are randomized, the local bundle model uses verifier-gated recovery for the stored PAKE secret instead of pretending the transcript can be deterministically replayed later.
That keeps the prototype honest while moving the core cryptography much closer to the intended final design.

## Target experience
1. sender runs `claw-beam send ./artifact.zip`
2. sender receives a short code such as `7-neon-comet`
3. receiver gets the bundle, runs `claw-beam accept ./artifact.zip.beam.json 7-neon-comet per`
4. receiver runs `claw-beam receive ./artifact.zip.beam.json 7-neon-comet`
5. both peers derive a shared session key without exposing the code to the relay as reusable plaintext material
6. encrypted metadata and payload move directly or through a blind relay
7. transfer expires and cannot be resumed by code reuse

## Intended security properties
- single-use code
- short expiration
- end-to-end encrypted transfer
- relay cannot read payload
- integrity protection on metadata and payload chunks
- optional human verifier phrase

## Suggested components
- mailbox service for rendezvous and offer exchange
- relay service for blind payload forwarding
- CLI and future UI wrappers

## Cryptographic direction
- PAKE: SPAKE2 or CPace
- key schedule: HKDF-SHA256
- transport framing: Noise or libsodium secretstream
- chunk integrity: authenticated transport frames instead of ad-hoc hashes only

## Non-goals for current POC
- no production relay
- no NAT traversal
- no persistent daemon
- no live mailbox service
- no final wire protocol commitment
- no distributed consume-proof yet

## Recommended next build order
1. replace the current whole-bundle HTTP mailbox handoff with exchanged rendezvous PAKE messages over the same transport
2. split metadata channel from encrypted payload channel over the rendezvous flow
3. add blind relay
4. add verifier phrase and session transcript checks
5. add chunked payload streaming instead of whole-file bundle encryption
6. add distributed consume enforcement or replay-resistant session closure
