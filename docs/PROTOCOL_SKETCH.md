# claw-beam protocol sketch

## Goal
Create a secure one-time file transfer flow with wormhole-like UX and OpenClaw-friendly naming.

## Current POC state
The current proof of concept is local-only and bundle-based:
- sender encrypts a file into a local beam bundle
- receiver explicitly accepts the bundle
- receiver decrypts it with the beam code
- integrity is checked after decrypt
- bundle is marked consumed and removed by default after receive

This validates the CLI shape and transfer-state model, but it is not yet a network protocol.

## Target experience
1. sender runs `claw-beam send ./artifact.zip`
2. sender receives a short code such as `7-neon-comet`
3. receiver gets the bundle, runs `claw-beam accept ./artifact.zip.beam.json per`
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
1. replace raw code-to-scrypt flow with PAKE-backed session establishment
2. split metadata channel from encrypted payload channel
3. add mailbox-style rendezvous for acceptance exchange
4. add blind relay
5. add verifier phrase and session transcript checks
