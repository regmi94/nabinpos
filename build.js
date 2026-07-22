#!/usr/bin/env node
// NabinPOS build step (runs automatically on Netlify — see netlify.toml).
//
// What it does, and why:
// 1) Reads SUPABASE_URL / SUPABASE_ANON_KEY from environment variables (set in Netlify's
//    Site settings → Environment variables) and substitutes them into index.html, instead of
//    those values being hardcoded in the source file that sits in git history.
//    Note on the anon key specifically: Supabase's anon key is *designed* to be public — it's
//    the same key every browser tab uses, and your data is protected by Row Level Security (RLS)
//    policies, not by hiding this key. Moving it out of source control is still worth doing
//    (lets you use a different Supabase project for a staging copy without editing code, keeps
//    the URL/key out of git diffs/PRs, etc.) — but it is not a secret in the way a server API
//    key would be, and no purely static site can fully hide a value the browser must send anyway.
// 2) Computes a SHA-256 hash of the actual inline <script> and <style> blocks in index.html and
//    writes a Content-Security-Policy that allowlists exactly that script/style content instead
//    of blanket 'unsafe-inline' — so a CSP bypass or injected <script>/<style> tag from anywhere
//    else won't execute. This step re-runs on every deploy, so you never have to hand-maintain a
//    hash when you edit the code.
//    Inline onclick="…" / style="…" attributes (used throughout the UI) still need
//    script-src-attr/style-src-attr 'unsafe-inline' — CSP hashes don't cover attributes, only
//    <script>/<style> tags. Removing that too would require rewriting the whole app away from
//    onclick-attribute rendering to addEventListener, which is a much larger follow-up project,
//    not something to silently half-do here. Given the app already escapes all user-controlled
//    strings via esc()/sanitizeInput() before they reach templates, this is a reasonable
//    middle ground: it blocks arbitrary <script>/<style> injection while being honest that
//    attribute-handler injection risk still depends on that escaping discipline holding everywhere.
//
// Local testing without Netlify: `SUPABASE_URL=... SUPABASE_ANON_KEY=... node build.js`

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SRC = path.join(__dirname, "index.html");
const OUT_DIR = path.join(__dirname, "dist");
const OUT = path.join(OUT_DIR, "index.html");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("❌ Missing SUPABASE_URL / SUPABASE_ANON_KEY environment variables.");
  console.error("   Set them in Netlify: Site settings → Environment variables.");
  process.exit(1);
}

let html = fs.readFileSync(SRC, "utf8");

// 1) Inject Supabase config
html = html.split("__SUPABASE_URL__").join(SUPABASE_URL);
html = html.split("__SUPABASE_ANON_KEY__").join(SUPABASE_ANON_KEY);
const projectRef = SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0];
html = html.split("__SUPABASE_PROJECT_REF__").join(projectRef);

// 2) Compute CSP hashes for the real inline <script>/<style> blocks (top-level document only —
//    popup windows opened via window.open()+document.write() for print previews/receipts are
//    separate documents not covered by this page's CSP meta tag, so they're intentionally excluded).
function sha256Base64(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("base64");
}

const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => `'sha256-${sha256Base64(m[1])}'`
);
const styleHashes = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(
  (m) => `'sha256-${sha256Base64(m[1])}'`
);

if (scriptHashes.length === 0) {
  console.error("❌ No <script> blocks found to hash — aborting so we don't ship a CSP that blocks the app.");
  process.exit(1);
}

const csp = [
  `default-src 'self'`,
  `script-src 'self' ${scriptHashes.join(" ")} https://unpkg.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
  `script-src-attr 'unsafe-inline'`, // onclick="…" etc. — see note above
  `style-src 'self' ${styleHashes.join(" ")}`,
  `style-src-attr 'unsafe-inline'`, // style="…" attributes — used throughout the UI
  `img-src 'self' data: https:`,
  `font-src 'self' data:`,
  `connect-src 'self' ${SUPABASE_URL} ${SUPABASE_URL.replace(/^https:/, "wss:")}`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'self'`,
  `form-action 'self'`,
].join("; ") + ";";

html = html.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="${csp}">`
);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html, "utf8");
console.log(`✅ Built ${OUT}`);
console.log(`   Supabase project: ${projectRef}`);
console.log(`   CSP script-src hashes: ${scriptHashes.length}, style-src hashes: ${styleHashes.length}`);
