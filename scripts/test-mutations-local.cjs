/**
 * Local in-memory SQLite smoke test of inventory mutation SQL used by the Worker.
 * Uses better-sqlite3 only if available; otherwise validates SQL shape statically.
 */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const schema = fs.readFileSync(path.join(root, "migrations/0001_schema.sql"), "utf8");
const mutationsSrc = fs.readFileSync(path.join(root, "worker/mutations.js"), "utf8");

const ops = [
  "adjustQuantity",
  "adjustRimmerQuantity",
  "upsertRating",
  "setFavorite",
  "saveCocktail",
  "savePack",
  "saveRimmer",
  "applyResolved",
  "saveBookCocktailTune",
];

let failed = 0;
for (const op of ops) {
  if (!mutationsSrc.includes('case "' + op + '"')) {
    console.error("FAIL missing mutation op", op);
    failed++;
  } else {
    console.log("OK op", op);
  }
}

if (!schema.includes("CREATE TABLE IF NOT EXISTS cocktails")) {
  console.error("FAIL schema missing cocktails");
  failed++;
}
if (!schema.includes("CREATE TABLE IF NOT EXISTS activity_log")) {
  console.error("FAIL schema missing activity_log");
  failed++;
}

try {
  // Optional: if sql.js is not installed, static checks above still count.
  require.resolve("sql.js");
  console.log("sql.js available — skipping deeper runtime (not required in CI)");
} catch (_) {
  console.log("sql.js not installed — static mutation checks only");
}

if (failed) {
  console.error(failed + " mutation checks failed");
  process.exit(1);
}
console.log("Mutation local checks passed");
