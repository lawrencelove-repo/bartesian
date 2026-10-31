/**
 * Validate generated D1 seed SQL against expected inventory counts.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const seedPath = path.join(root, "seeds/bartesian_seed.sql");
const summaryPath = path.join(root, "seeds/bartesian_seed_summary.json");

if (!fs.existsSync(seedPath)) {
  execFileSync(process.execPath, [path.join(root, "scripts/generate-d1-seed.cjs")], {
    cwd: root,
    stdio: "inherit",
  });
}

const sql = fs.readFileSync(seedPath, "utf8");
const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));

function countInserts(table) {
  const re = new RegExp("INSERT INTO " + table + "\\b", "g");
  return (sql.match(re) || []).length;
}

const checks = [
  ["people", summary.people, 1],
  ["cocktails", summary.cocktails, 50],
  ["packs", summary.packs, 1],
  ["rimmers", summary.rimmers, 1],
  ["barcodes", summary.barcodes, 1],
  ["activity_log", summary.activity, 1],
];

let failed = 0;
for (const [table, expected, min] of checks) {
  const n = countInserts(table);
  if (n !== expected) {
    console.error("FAIL", table, "insert count", n, "expected", expected);
    failed++;
  } else if (expected < min) {
    console.error("FAIL", table, "count below minimum", expected, "<", min);
    failed++;
  } else {
    console.log("OK", table, n);
  }
}

if (!sql.includes("seed_imported_at")) {
  console.error("FAIL missing seed_imported_at marker");
  failed++;
}
if (/RESEND_API_KEY|AUTH_SECRET|CLOUDFLARE_API_TOKEN/.test(sql)) {
  console.error("FAIL seed SQL appears to contain secrets");
  failed++;
}

if (failed) {
  console.error(failed + " seed checks failed");
  process.exit(1);
}
console.log("Seed validation passed:", summary);
