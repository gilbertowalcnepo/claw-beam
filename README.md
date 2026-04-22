# claw-beam

Secure one-time file transfer — wormhole-like UX with SPAKE2 PAKE.

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

### Send without a public IP (ngrok tunnel)

If the sender is behind NAT and has no public IP, use ngrok to create an ephemeral tunnel:

```bash
claw-beam send --filepath secret.txt --ngrok
```

The token will carry an `https://xxx.ngrok.io` URL instead of `127.0.0.1`. The receiver still just runs `receive --token <token>` — no config change needed.

```bash
# With options:
claw-beam send --filepath secret.txt --ngrok --ngrok-region eu --ngrok-authtoken <token>
```

**Prerequisites:** Install pyngrok (`pip install pyngrok`) or the ngrok binary (`https://ngrok.com/download`). Configure your ngrok auth token first (`ngrok config add-authtoken <token>` or set `NGROK_AUTHTOKEN`).

**Security:** The ngrok URL is inside the PAKE-encrypted token. ngrok only sees encrypted rendezvous traffic. Tunnels auto-destroy on completion or timeout.

### That's it.

**Sender**: `send --filepath <file>` → share the token  
**Receiver**: `receive --token <token>` → file appears

The token carries everything: server URL (or ngrok URL), offer ID, and the PAKE-derived session code. No manual steps in between.

## Install

```bash
# From source
git clone https://github.com/gilbertowalcnepo/claw-beam.git
cd claw-beam
npm install

# Run directly
node bin/claw-beam.js send --filepath myfile.txt
```

### Quick test (local)

```bash
node --test
bash scripts/quick-e2e.sh
```

## How it works

### Direct transfer (default)

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

### Ngrok tunnel transfer (`--ngrok`)

1. **Sender** runs `send --filepath <file> --ngrok`. claw-beam:
   - Starts the local rendezvous server as usual
   - Opens an ephemeral ngrok HTTPS tunnel to the local server
   - Verifies the tunnel is reachable before proceeding
   - Embeds the ngrok public URL in the token (instead of localhost)
   - The token remains PAKE-encrypted — ngrok never sees plaintext

2. **Receiver** runs `receive --token <token>`. The flow is identical:
   - The token contains the ngrok URL, so the receiver connects outbound to it
   - No port forwarding, no public IP, no config change needed

The PAKE ensures that only someone with the beam code (or the token) can decrypt the file. The rendezvous server never sees plaintext. ngrok only forwards encrypted bytes.

## Token format

Tokens are URL-safe base64-encoded JSON:

```json
{
  "baseUrl": "http://127.0.0.1:41921",
  "offerId": "5528de5312d39c74",
  "code": "39-lumen-comet"
}
```

When `--ngrok` is used, `baseUrl` is an HTTPS ngrok URL instead:

```json
{
  "baseUrl": "https://a1b2c3d4.ngrok.io",
  "offerId": "5528de5312d39c74",
  "code": "39-lumen-comet"
}
```

Decode a token:
```bash
claw-beam decode-token <token>
```

## Programmatic API

```js
import { sendSimple, receiveSimple, encodeToken, decodeToken, checkNgrokAvailable } from "./src/simple.js";

// Send locally
const result = await sendSimple("./secret.txt");
console.log("Token:", result.token);
console.log("Local URL:", result.localUrl);

// Send via ngrok tunnel
const result = await sendSimple("./secret.txt", { ngrok: true });
console.log("Token:", result.token);
console.log("Public URL:", result.baseUrl);
console.log("Local URL:", result.localUrl);
// result.ngrokTunnel is available for manual lifecycle control

// Receive
const received = await receiveSimple(result.token, "./downloads");
console.log("File:", received.fileName, received.sizeBytes, "bytes");
console.log("SHA-256:", received.sha256);

// Check ngrok availability
const check = await checkNgrokAvailable();
console.log("ngrok available:", check.available, check.method);
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
- No chunked/streaming — entire file is loaded into memory
- ngrok tunnels are ephemeral and auto-destroyed, but ngrok LLC can observe connection metadata (not content)
- Tokens are bearer secrets — anyone with the token can receive the file

Use for experiments and prototyping only. Do not transfer sensitive production data.

## Development

```bash
# Run tests (41 tests)
node --test

# Run quick e2e
bash scripts/quick-e2e.sh

# Debug the simple flow
node scripts/debug_simple.js

# Check ngrok availability
node -e "import('./src/ngrok-tunnel.js').then(m => m.checkNgrokAvailable().then(c => console.log(c)))"
```

## License

MIT