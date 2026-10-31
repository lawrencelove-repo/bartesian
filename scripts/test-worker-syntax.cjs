/**
 * Static checks for Worker auth/routing invariants and mutation exports.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const workerSrc = fs.readFileSync(path.join(root, "worker/index.js"), "utf8");
const mutationsSrc = fs.readFileSync(path.join(root, "worker/mutations.js"), "utf8");

execFileSync(process.execPath, ["--check", path.join(root, "worker/index.js")], {
  stdio: "inherit",
});
execFileSync(process.execPath, ["--check", path.join(root, "worker/mutations.js")], {
  stdio: "inherit",
});
execFileSync(process.execPath, ["--check", path.join(root, "js/db.js")], { stdio: "inherit" });

const required = [
  ["/login", "canonical login path"],
  ["bartesian_session", "session cookie name"],
  ["AUTHORIZED_EMAILS", "configurable authorized emails"],
  ["/api/snapshot", "snapshot endpoint"],
  ["/api/mutate", "mutation endpoint"],
  ['Response.redirect(new URL("/login"', "login redirect without .html"],
];

let failed = 0;
for (const [needle, label] of required) {
  if (!workerSrc.includes(needle)) {
    console.error("FAIL worker missing", label, "(" + needle + ")");
    failed++;
  } else {
    console.log("OK", label);
  }
}

if (workerSrc.includes('Response.redirect(new URL("/login.html"')) {
  console.error("FAIL worker redirects to /login.html (redirect-loop risk)");
  failed++;
}

if (!mutationsSrc.includes("export async function applyMutation")) {
  console.error("FAIL mutations.js missing applyMutation export");
  failed++;
}
if (!mutationsSrc.includes("export async function loadSnapshot")) {
  console.error("FAIL mutations.js missing loadSnapshot export");
  failed++;
}
if (!mutationsSrc.includes("SNAPSHOT_TABLES")) {
  console.error("FAIL mutations.js missing SNAPSHOT_TABLES");
  failed++;
}

const dbSrc = fs.readFileSync(path.join(root, "js/db.js"), "utf8");
if (!dbSrc.includes("BARTESIAN_CLOUDFLARE")) {
  console.error("FAIL db.js missing BARTESIAN_CLOUDFLARE cloud mode");
  failed++;
}
if (!dbSrc.includes("cloudMutate")) {
  console.error("FAIL db.js missing cloudMutate helper");
  failed++;
}
if (!dbSrc.includes("reloadRemote")) {
  console.error("FAIL db.js missing reloadRemote helper");
  failed++;
}

if (failed) {
  console.error(failed + " worker checks failed");
  process.exit(1);
}
console.log("Worker syntax/invariant checks passed");
