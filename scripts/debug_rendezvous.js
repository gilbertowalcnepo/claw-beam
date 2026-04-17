import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(".");
const cliPath = path.join(repoRoot, "bin", "claw-beam.js");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claw-beam-rdv-cli-"));
const filePath = path.join(tempDir, "artifact.txt");
const rendezvousDir = path.join(tempDir, "mailbox");
fs.writeFileSync(filePath, "beam payload for cli\n", "utf-8");

const send = spawnSync("node", [cliPath, "send-rendezvous", filePath, rendezvousDir], { cwd: tempDir, encoding: "utf-8" });
console.log(JSON.stringify({ step: "send", status: send.status, stdout: send.stdout, stderr: send.stderr }, null, 2));
if (send.status !== 0) process.exit(send.status ?? 1);
const offer = send.stdout.match(/offer published: ([a-f0-9]{16})/);
const code = send.stdout.match(/beam code: (\d{1,2}-[a-z]+-[a-z]+)/);
const accept = spawnSync("node", [cliPath, "accept-offer", rendezvousDir, offer[1], code[1], "per"], { cwd: tempDir, encoding: "utf-8" });
console.log(JSON.stringify({ step: "accept", status: accept.status, stdout: accept.stdout, stderr: accept.stderr }, null, 2));
const receive = spawnSync("node", [cliPath, "receive-offer", rendezvousDir, offer[1], code[1], "--keep-bundle"], { cwd: tempDir, encoding: "utf-8" });
console.log(JSON.stringify({ step: "receive", status: receive.status, stdout: receive.stdout, stderr: receive.stderr }, null, 2));
