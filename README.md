# claw-beam

Secure one-time file transfer prototype — wormhole-like UX with SPAKE2 PAKE.

> ⚠️ **This is a prototype.** Not production-hardened. No blind relay, no distributed consume-proof, no transport replay protection, no audited PAKE suitability. See Security below.

## Quick start

### Send a file

```bash
claw-beam send --filepath secret.txt
```

This starts a temporary rendezvous server, encrypts your file, and prints a **beam token**:

```
✉ beam sent
  file: secret.txt (42 bytes)
  token: eyJiYXNlVXJsIjoiaHR0cDovLzEyNy4wLjAuMTo0...
  rendezvous: http://127.0.0.1:41921
  offer: 5528de5312d39c74
  code: 39-lumen-comet

Share the token with the receiver. They run:
  claw-beam receive --token eyJiYXNlVXJsIjoiaHR0cDovLzEyNy4wLjAuMTo0...

Server is running. Press Ctrl+C when transfer is complete.
```

### Receive a file

```bash
claw-beam receive --token <token>
```

Or specify an output directory:

```bash
claw-beam receive --token <token> --filespath ./downloads
```

Output:
```
✅ beam received
  file: secret.txt
  size: 42 bytes
  sha256: a1b2c3...
  path: ./downloads/secret.txt
```

### That's it.

**Sender**: `send --filepath <file>` → share the token  
**Receiver**: `receive --token <token>` → file appears

The token carries everything: server URL, offer ID, and the PAKE-derived session code. No manual steps in between.

## Install

```bash
# From source
git clone <repo-url>
cd claw-beam
npm install

# Run directly
node bin/claw-beam.js send --filepath myfile.txt
```

### Quick test (local)

```bash
bash scripts/quick-e2e.sh
```

This runs a full end-to-end test: rendezvous server, send, accept, receive, and the simplified send/receive flow.

## How it works

1. **Sender** runs `send --filepath <file>`. claw-beam:
   - Encrypts the file with a random payload key (AES-256-GCM)
   - Derives a session key via SPAKE2 PAKE from a human-readable beam code
   - Wraps the payload key with the PAKE-derived session key
   - Starts a local HTTP rendezvous server
   - Auto-accepts the offer so the receiver can immediately receive
   - Prints a single token encoding the server URL, offer ID, and beam code

2. **Receiver** runs `receive --token <token>`. claw-beam:
   - Decodes the token to get the server URL, offer ID, and beam code
   - Derives the same PAKE session key from the beam code
   - Unwraps the payload key, decrypts the file
   - Writes the file to disk and verifies SHA-256 integrity

The PAKE ensures that only someone with the beam code (or the token) can decrypt the file. The rendezvous server never sees plaintext.

## Token format

Tokens are URL-safe base64-encoded JSON:

```json
{
  "baseUrl": "http://127.0.0.1:41921",
  "offerId": "5528de5312d39c74",
  "code": "39-lumen-comet"
}
```

Decode a token:
```bash
claw-beam decode-token <token>
```

## Legacy commands

The simplified `send`/`receive` commands above handle the full flow automatically. For manual or multi-step flows, these legacy commands are still available:

```bash
# Start a rendezvous server manually
claw-beam serve-rendezvous [store-dir] [port]

# Send via HTTP rendezvous (requires separate accept step)
claw-beam send-http <file> <base-url>
claw-beam accept-http <base-url> <offer-id> <code> [receiver-label]
claw-beam receive-http <base-url> <offer-id> <code> [--keep-bundle]

# Send via local mailbox
claw-beam send-rendezvous <file> <rendezvous-dir>
claw-beam accept-offer <rendezvous-dir> <offer-id> <code> [receiver-label]
claw-beam receive-offer <rendezvous-dir> <offer-id> <code> [--keep-bundle]

# Raw bundle operations (no rendezvous)
claw-beam send <file>              # create bundle + print code
claw-beam accept <bundle> <code>   # accept a bundle
claw-beam receive <bundle> <code>   # receive from accepted bundle
```

## Security

**This is a prototype.** It demonstrates the UX and cryptographic spine, but:

- No blind relay — the rendezvous server can observe metadata
- No distributed consume-proof — a single server trusts consume-once semantics
- No transport or session replay protection
- SPAKE2 usage has not been audited for this application
- No NAT traversal — receiver must reach the sender's rendezvous server
- No chunked/streaming — entire file is loaded into memory

Use for experiments and prototyping only. Do not transfer sensitive production data.

## Development

```bash
# Run tests
node --test

# Run quick e2e
bash scripts/quick-e2e.sh

# Debug the simple flow
node scripts/debug_simple.js
```

## License

MIT