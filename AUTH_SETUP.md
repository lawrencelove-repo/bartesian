# Bartesian one-time-code authentication

Private household inventory. Access is gated by email OTP (same pattern as Recipes).

## Behavior

- Visitor clicks **Send access code** on `/login`.
- Server emails a **6-digit** code to the first address in `AUTHORIZED_EMAILS`.
- Code lifetime: **10 minutes**. Newest request invalidates earlier codes.
- Verification allows **5 attempts** per code.
- Successful login sets an **HttpOnly Secure** `bartesian_session` cookie for **30 days**.
- Login requests are rate-limited to **5 per IP per hour** (hashed IP in D1).
- Logout revokes the server session and clears the cookie.

## Configuration

1. Create Resend API key. For initial testing, `EMAIL_FROM=onboarding@resend.dev` is allowed only to Resend’s test constraints; production needs a verified sending domain.
2. Set Worker secrets (never commit):
   - `RESEND_API_KEY`
   - `AUTH_SECRET` (cryptographically random, ≥32 bytes)
3. Set Worker vars in `wrangler.jsonc` (or dashboard):
   - `EMAIL_FROM`
   - `AUTHORIZED_EMAILS` (comma-separated; codes send to the first entry). Initial testing value: `lawrencelove@gmail.com` (required when `EMAIL_FROM` is `onboarding@resend.dev`)
4. Apply D1 migrations `0001_schema.sql` and `0002_auth.sql` before relying on auth.
5. Import seed (`seeds/bartesian_seed.sql`) once into an empty database.

## Client notes

- Cloudflare builds set `window.BARTESIAN_CLOUDFLARE = true`.
- Unauthenticated HTML requests redirect to `/login` (canonical path).
- Service worker registration is removed from the Cloudflare build.

## Limitations

- Auth protects the Worker deployment only — the GitHub repository and any remaining GitHub Pages site are separate.
- Database-backed rate limits are a baseline; add Cloudflare WAF/rate limiting for stronger production protection.
