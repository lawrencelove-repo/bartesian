const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "dist");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const name of ["index.html", "css", "js", "images", "assets", "public-login", "data"]) {
  const src = path.join(root, name);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, name), { recursive: true });
}

// Deliberately omit sw.js and remove its registration from the Cloudflare build.
const indexPath = path.join(out, "index.html");
let index = fs.readFileSync(indexPath, "utf8");
index = index.replace(
  '    <script src="js/db.js"></script>',
  '    <script>window.BARTESIAN_CLOUDFLARE = true;</script>\n    <script src="js/db.js"></script>'
);
index = index.replace(
  /    <script>\s*if \("serviceWorker" in navigator\) \{[\s\S]*?\}\s*<\/script>/,
  '    <script>if ("serviceWorker" in navigator) navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));</script>'
);
fs.writeFileSync(indexPath, index);

fs.copyFileSync(path.join(out, "public-login", "login.html"), path.join(out, "login.html"));
fs.copyFileSync(path.join(out, "public-login", "login.js"), path.join(out, "login.js"));

console.log("Built curated Worker assets in dist/");
