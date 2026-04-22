/**
 * claw-beam ngrok tunnel integration
 *
 * Provides ephemeral ngrok tunnels for the rendezvous server, making
 * the sender reachable from any network without exposing a public IP
 * or requiring port forwarding.
 *
 * Security model:
 * - The ngrok tunnel URL is only carried inside the PAKE-encrypted token.
 *   Anyone who discovers the URL can only reach the encrypted rendezvous
 *   endpoint — they still need the beam code to decrypt the file.
 * - Tunnels are created per-transfer and destroyed immediately after.
 * - The rendezvous server itself enforces consume-once semantics.
 *
 * Requirements:
 * - ngrok binary installed and in PATH (or NGROK_PATH env set)
 * - ngrok auth token configured (run `ngrok config add-authtoken <token>`)
 *   or set NGROK_AUTHTOKEN env variable
 */

import { spawn } from "node:child_process";
import http from "node:http";

/**
 * Start an ngrok tunnel for a local HTTP server.
 *
 * @param {number} localPort - The local port the rendezvous server is listening on.
 * @param {object} [options]
 * @param {string} [options.region] - ngrok region (us, eu, au, ap, sa, jp, in)
 * @param {string} [options.authToken] - ngrok auth token (overrides NGROK_AUTHTOKEN env)
 * @param {number} [options.timeout=15000] - ms to wait for ngrok tunnel to establish
 * @returns {Promise<{publicUrl: string, ngrokProcess: import("node:child_process").ChildProcess, close: () => Promise<void>}>}
 */
export async function startNgrokTunnel(localPort, options = {}) {
  const {
    region = process.env.NGROK_REGION || "us",
    authToken = process.env.NGROK_AUTHTOKEN || null,
    timeout = 15000,
  } = options;

  if (!localPort || localPort <= 0) {
    throw new Error(`Invalid local port: ${localPort}`);
  }

  // Try to use pyngrok (Python) first — more reliable programmatic control
  try {
    const result = await startNgrokTunnelViaPyngrok(localPort, { region, authToken, timeout });
    return result;
  } catch (pyngrokError) {
    // Fall back to direct ngrok binary if pyngrok fails
    // (e.g., ngrok not installed, auth not configured)
  }

  // Fallback: start ngrok binary directly
  return startNgrokTunnelViaBinary(localPort, { region, authToken, timeout });
}

/**
 * Start an ngrok tunnel using pyngrok (Python subprocess).
 * This is the preferred method — pyngrok manages the ngrok process lifecycle
 * and provides the public URL via the ngrok API.
 */
async function startNgrokTunnelViaPyngrok(localPort, options = {}) {
  const { region, authToken, timeout = 15000 } = options;

  // Use Python/pyngrok to start the tunnel and get the public URL
  const pythonScript = `
import json
import sys
import os

try:
    from pyngrok import ngrok as pyngrok_ngrok
    from pyngrok.conf import PyngrokConfig

    # Configure auth token if provided
    if os.environ.get("NGROK_AUTHTOKEN"):
        pyngrok_ngrok.set_auth_token(os.environ["NGROK_AUTHTOKEN"])

    # Kill any existing ngrok processes to avoid conflicts
    try:
        pyngrok_ngrok.kill()
    except Exception:
        pass

    # Start the tunnel
    tunnel = pyngrok_ngrok.connect(${localPort}, "http", region="${region || "us"}")

    # Output the public URL
    result = {"public_url": tunnel.public_url, "tunnel_name": tunnel.name}
    print(json.dumps(result))
except ImportError:
    print(json.dumps({"error": "pyngrok not installed"}), file=sys.stderr)
    sys.exit(2)
except Exception as e:
    print(json.dumps({"error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`ngrok tunnel establishment timed out after ${timeout}ms`));
    }, timeout);

    const proc = spawn("python3", ["-c", pythonScript], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(authToken ? { NGROK_AUTHTOKEN: authToken } : {}),
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        const errorDetail = stderr.trim() || `exit code ${code}`;
        reject(new Error(`pyngrok tunnel failed: ${errorDetail}`));
        return;
      }

      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) {
          reject(new Error(`pyngrok tunnel error: ${result.error}`));
          return;
        }

        const publicUrl = result.public_url;
        if (!publicUrl) {
          reject(new Error("pyngrok returned no public URL"));
          return;
        }

        resolve({
          publicUrl,
          ngrokProcess: null, // pyngrok manages the process
          close: async () => {
            try {
              const { execSync } = await import("node:child_process");
              execSync(`python3 -c "from pyngrok import ngrok; ngrok.disconnect('${publicUrl}'); ngrok.kill()"`, {
                stdio: "pipe",
                timeout: 5000,
              });
            } catch {
              // Best-effort cleanup — ngrok process will die on its own
            }
          },
        });
      } catch (parseError) {
        reject(new Error(`Failed to parse pyngrok output: ${stdout.trim()}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to start pyngrok: ${err.message}`));
    });
  });
}

/**
 * Start an ngrok tunnel using the ngrok binary directly.
 * This is a fallback when pyngrok is not available.
 * It parses the ngrok API to get the public URL.
 */
async function startNgrokTunnelViaBinary(localPort, options = {}) {
  const { region, authToken, timeout = 15000 } = options;

  const ngrokPath = process.env.NGROK_PATH || "ngrok";

  // Start ngrok with the API interface
  const ngrokProc = spawn(ngrokPath, [
    "http",
    "--log=stdout",
    "--log-format=json",
    ...(region ? [`--region=${region}`] : []),
    "--bind-tls=true",
    String(localPort),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(authToken ? { NGROK_AUTHTOKEN: authToken } : {}),
    },
  });

  // Wait for ngrok to start and query its API for the tunnel URL
  const tunnelUrl = await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`ngrok binary tunnel timed out after ${timeout}ms`));
    }, timeout);

    let started = false;

    ngrokProc.stdout.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.msg && entry.msg.includes("started tunnel")) {
            started = true;
          }
        } catch {
          // Not all lines are JSON
        }
      }
    });

    // Poll the ngrok API to get the tunnel URL
    const pollApi = async (attempts = 0) => {
      if (attempts > 30) {
        clearTimeout(timeoutId);
        reject(new Error("Could not get ngrok tunnel URL after 30 attempts"));
        return;
      }

      try {
        const url = await new Promise((res, rej) => {
          const req = http.get("http://127.0.0.1:4040/api/tunnels", (resp) => {
            let data = "";
            resp.on("data", (chunk) => { data += chunk; });
            resp.on("end", () => {
              try {
                const tunnels = JSON.parse(data);
                if (tunnels.tunnels && tunnels.tunnels.length > 0) {
                  const httpTunnel = tunnels.tunnels.find(t => t.proto === "https" || t.proto === "http");
                  if (httpTunnel) {
                    res(httpTunnel.public_url);
                    return;
                  }
                }
                rej(new Error("no tunnel found"));
              } catch {
                rej(new Error("invalid API response"));
              }
            });
          });
          req.on("error", rej);
          req.setTimeout(2000, () => { req.destroy(); rej(new Error("API timeout")); });
        });
        clearTimeout(timeoutId);
        resolve(url);
      } catch {
        setTimeout(() => pollApi(attempts + 1), 500);
      }
    };

    // Start polling after a brief delay for ngrok to initialize
    setTimeout(() => pollApi(), 1000);
  });

  return {
    publicUrl: tunnelUrl,
    ngrokProcess: ngrokProc,
    close: async () => {
      return new Promise((resolve) => {
        ngrokProc.kill("SIGTERM");
        const killTimeout = setTimeout(() => {
          ngrokProc.kill("SIGKILL");
          resolve();
        }, 3000);
        ngrokProc.on("close", () => {
          clearTimeout(killTimeout);
          resolve();
        });
      });
    },
  };
}

/**
 * Check if ngrok is available (either pyngrok or binary).
 * @returns {Promise<{available: boolean, method: string|null, error: string|null}>}
 */
export async function checkNgrokAvailable() {
  // Check pyngrok first
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn("python3", ["-c", "from pyngrok import ngrok; print('ok')"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      let stdout = "";
      proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
      proc.on("close", (code) => {
        if (code === 0 && stdout.trim() === "ok") {
          resolve(true);
        } else {
          reject(new Error("pyngrok not functional"));
        }
      });
      proc.on("error", reject);
    });
    if (result) return { available: true, method: "pyngrok", error: null };
  } catch {}

  // Check ngrok binary
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(process.env.NGROK_PATH || "ngrok", ["version"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      proc.on("close", (code) => {
        if (code === 0) resolve(true);
        else reject(new Error("ngrok not found"));
      });
      proc.on("error", reject);
    });
    if (result) return { available: true, method: "binary", error: null };
  } catch {}

  return { available: false, method: null, error: "Neither pyngrok nor ngrok binary found. Install pyngrok (pip install pyngrok) or ngrok (https://ngrok.com/download)." };
}