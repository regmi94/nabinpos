# NabinPOS — Security & Bug Fix Notes (July 2026)

## How deployment changes now

Previously Netlify just served `index.html` directly. Now there's a tiny build step:

1. In Netlify: **Site settings → Environment variables**, add:
   - `SUPABASE_URL` = `https://cqepdjgaigwhxilxhnzs.supabase.co`
   - `SUPABASE_ANON_KEY` = (your anon key from Supabase → Project Settings → API)
2. Push `index.html`, `build.js`, `netlify.toml` to your repo. Netlify will run `node build.js`
   automatically (no npm install needed — it only uses Node's built-in `crypto`/`fs`) and publish
   the `dist/` folder it generates.
3. To test locally before pushing:
   ```
   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... node build.js
   ```
   then open `dist/index.html` in a browser.

**Important:** don't open the raw `index.html` directly anymore (e.g. double-clicking the file) —
it now contains placeholders (`__SUPABASE_URL__` etc.) that only get filled in by `build.js`. If
you ever do open it directly, it'll show a clear console error instead of failing silently.

## The 6 fixes

**1. Supabase keys → env vars.** Moved out of source into `SUPABASE_URL`/`SUPABASE_ANON_KEY`,
injected at build time. Honest caveat: Supabase's anon key is *designed* to be public — every
browser tab uses the same one, and your actual protection is Row Level Security (RLS) policies,
not hiding this key. Moving it to env vars is still good hygiene (keeps it out of git diffs, lets
you point a staging copy at a different Supabase project without touching code) but it isn't
hiding a secret the way it would for a server API key.

**2. CSP hardening.** `build.js` now computes a real SHA-256 hash of your actual `<script>`/`<style>`
content and allowlists exactly that, instead of blanket `'unsafe-inline'` on `script-src`/`style-src`.
This blocks anything trying to inject a *new* `<script>` or `<style>` tag. I couldn't fully remove
`'unsafe-inline'` everywhere, though — the app renders its whole UI via `onclick="…"` and `style="…"`
attributes (thousands of them, built dynamically), and CSP hashes don't cover attributes, only
`<script>`/`<style>` tags. So `script-src-attr`/`style-src-attr` still allow inline attributes.
Closing that gap fully would mean rewriting the UI away from onclick-attribute rendering to
`addEventListener` — a much bigger project I didn't want to silently half-do here. Since the app
already escapes user input via `esc()`/`sanitizeInput()` before it reaches any template, this is a
reasonable interim posture, not a full fix.

**3. Password hashing.** Local account passwords (used for login, the app-lock screen, and
Admin-Verify on void/refund approvals) were stored and compared in plaintext in `localStorage` —
anyone with brief access to the device's browser devtools could read every staff password. Now
they're stored as PBKDF2-SHA256 hashes (100,000 iterations, random salt per user). Existing
plaintext passwords upgrade automatically the first time the app loads after this update — no
action needed, staff keep their current passwords. The Supabase Auth (cloud) password is untouched
by this — that's already handled server-side by Supabase. The biometric fingerprint login still
needs the actual password once (to log into Supabase), but that's kept only in memory during the
session and in the existing AES-GCM encrypted cache — never in plaintext in `localStorage`.

**4. Rate comparison bug.** The "Last Buy Rate" field in Add Product never actually filled in —
the function that was supposed to look it up (`autoFillLastRate`) existed but was never connected
to the product-name field. Fixed the wiring, so the rate-difference indicator now works when adding
a new product purchase rate. Also removed a second, entirely dead copy of this feature that
targeted an element that didn't exist anywhere in the page.

**5. Null checks in `computeItemLedger`.** If a product was deleted, this function returned `null`
outright — which silently erased that product's entire stock history from the Stock Audit /
Item Inventory Sheet reports. It now falls back to a reconstructed record from stock-movement
history when the product itself is gone, so historic data survives deletion.

**6. Returns for deleted products.** If you deleted a product from Inventory and a customer later
returned an item from a bill referencing it, the return was silently dropped — no refund record,
no audit trail, even though you'd have physically refunded the customer. Fixed: the return now
always logs the refund and customer balance correctly; only the stock-quantity adjustment is
skipped (since there's no product record left to adjust), and you get a clear warning when that
happens.
