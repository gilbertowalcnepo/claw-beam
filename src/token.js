// claw-beam token encoding/decoding
// A token bundles all information needed to receive a file:
//   baseUrl, offerId, beamCode
// Encoded as URL-safe base64 for easy copy-paste.

export function encodeToken({ baseUrl, offerId, code }) {
  const payload = JSON.stringify({ baseUrl, offerId, code });
  return Buffer.from(payload, "utf-8").toString("base64url");
}

export function decodeToken(token) {
  let payload;
  try {
    payload = Buffer.from(token, "base64url").toString("utf-8");
  } catch {
    throw new Error("Invalid token: not valid base64url.");
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("Invalid token: not valid JSON payload.");
  }
  if (!parsed.baseUrl || !parsed.offerId || !parsed.code) {
    throw new Error("Invalid token: missing required fields (baseUrl, offerId, code).");
  }
  return parsed;
}