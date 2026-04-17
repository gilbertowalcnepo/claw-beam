# claw-beam protocol sketch

## Goal
Create a secure one-time file transfer flow with wormhole-like UX and OpenClaw-friendly naming.

## Target experience
1. sender runs `claw-beam send ./artifact.zip`
2. sender receives a short code such as `7-neon-comet`
3. receiver runs `claw-beam receive`
4. receiver enters the code
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

## Non-goals for prototype alpha
- no production relay
- no NAT traversal
- no persistent daemon
- no live secrets
- no final wire protocol commitment

## Prototype alpha deliverable
A metadata-only envelope that helps validate:
- CLI naming
- file packaging shape
- offer structure
- future transition points for secure transport
