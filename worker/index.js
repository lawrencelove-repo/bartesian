import { applyMutation, loadSnapshot } from "./mutations.js";

const COOKIE = "bartesian_session";
const encoder = new TextEncoder();
const json = (value, status = 200, headers = {}) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });

const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const randomToken = (n = 32) => {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return bytesToHex(b);
};

async function digest(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function cookieValue(request) {
  const raw = request.headers.get("Cookie") || "";
  const match = raw.match(/(?:^|;\s*)bartesian_session=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || "";
}

const sessionCookie = (token, age) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;

function authorizedEmails(env) {
  return String(env.AUTHORIZED_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function authorized(request, env, now) {
  const token = cookieValue(request);
  if (!token) return false;
  const hash = await digest(env.AUTH_SECRET, "session:" + token);
  const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
    .bind(hash)
    .first();
  return !!row && row.expires_at > now;
}

async function sendCode(env, code, to) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Email provider not configured");
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: "Your Bartesian access code",
      text:
        "Your Bartesian sign-in code is " +
        code +
        ". It expires in 10 minutes. If you did not request it, ignore this message.",
    }),
  });
  if (!result.ok) throw new Error("Email delivery failed");
}

async function readBody(request) {
  if (Number(request.headers.get("content-length") || 0) > 512000) throw new Error("Invalid request");
  return request.json().catch(() => ({}));
}

function isLoginAsset(path) {
  return path === "/login" || path === "/login.html" || path === "/login.js";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const now = Date.now();

    if (!env.DB || !env.AUTH_SECRET) {
      return json({ error: "Authentication service not configured" }, 503);
    }

    try {
      if (path === "/api/health" && request.method === "GET") {
        const row = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ status: row?.ok === 1 ? "ok" : "error", app: "bartesian" });
      }

      if (path === "/api/auth/request" && request.method === "POST") {
        const emails = authorizedEmails(env);
        if (!emails.length) return json({ error: "Authorized emails are not configured" }, 503);
        const to = emails[0];
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await digest(env.AUTH_SECRET, "ip:" + ip);
        const recent = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM login_requests WHERE ip_hash = ? AND created_at > ?"
        )
          .bind(ipHash, now - 3600000)
          .first();
        if ((recent?.n || 0) >= 5) return json({ error: "Too many requests. Try again later." }, 429);
        await env.DB.prepare("INSERT INTO login_requests (ip_hash, created_at) VALUES (?, ?)")
          .bind(ipHash, now)
          .run();
        const raw = new Uint32Array(1);
        crypto.getRandomValues(raw);
        const code = String(raw[0] % 1000000).padStart(6, "0");
        const hash = await digest(env.AUTH_SECRET, "code:" + code);
        await env.DB.prepare(
          `INSERT INTO login_codes (id, code_hash, expires_at, attempts, consumed_at)
           VALUES ('fixed', ?, ?, 0, NULL)
           ON CONFLICT(id) DO UPDATE SET
             code_hash = excluded.code_hash,
             expires_at = excluded.expires_at,
             attempts = 0,
             consumed_at = NULL`
        )
          .bind(hash, now + 600000)
          .run();
        try {
          await sendCode(env, code, to);
        } catch (_) {
          return json({ error: "Email delivery is not configured or failed" }, 503);
        }
        return json({ ok: true });
      }

      if (path === "/api/auth/verify" && request.method === "POST") {
        const body = await readBody(request);
        const code = String(body.code || "");
        if (!/^\d{6}$/.test(code)) return json({ error: "Invalid or expired code" }, 400);
        const row = await env.DB.prepare(
          "SELECT code_hash, expires_at, attempts, consumed_at FROM login_codes WHERE id = 'fixed'"
        ).first();
        if (!row || row.expires_at <= now || row.consumed_at || row.attempts >= 5) {
          return json({ error: "Invalid or expired code" }, 401);
        }
        const increment = await env.DB.prepare(
          `UPDATE login_codes SET attempts = attempts + 1
           WHERE id = 'fixed' AND attempts < 5 AND consumed_at IS NULL AND expires_at > ?`
        )
          .bind(now)
          .run();
        if (!increment.meta?.changes) return json({ error: "Invalid or expired code" }, 401);
        const hash = await digest(env.AUTH_SECRET, "code:" + code);
        if (hash !== row.code_hash) return json({ error: "Invalid or expired code" }, 401);
        const consumed = await env.DB.prepare(
          `UPDATE login_codes SET consumed_at = ?
           WHERE id = 'fixed' AND code_hash = ? AND consumed_at IS NULL AND expires_at > ?`
        )
          .bind(now, hash, now)
          .run();
        if (!consumed.meta?.changes) return json({ error: "Invalid or expired code" }, 401);
        const token = randomToken();
        const tokenHash = await digest(env.AUTH_SECRET, "session:" + token);
        const duration = 30 * 24 * 60 * 60 * 1000;
        await env.DB.prepare(
          "INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)"
        )
          .bind(tokenHash, now + duration, now)
          .run();
        return json({ ok: true }, 200, {
          "Set-Cookie": sessionCookie(token, Math.floor(duration / 1000)),
        });
      }

      if (path === "/api/auth/logout" && request.method === "POST") {
        const token = cookieValue(request);
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
            .bind(await digest(env.AUTH_SECRET, "session:" + token))
            .run();
        }
        return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
      }

      const loggedIn = await authorized(request, env, now);
      if (path === "/api/auth/me" && request.method === "GET") {
        return json({ authenticated: loggedIn });
      }

      if (path === "/api/snapshot" && request.method === "GET" && loggedIn) {
        const tables = await loadSnapshot(env.DB);
        return json({ tables });
      }

      if (path === "/api/mutate" && request.method === "POST" && loggedIn) {
        const body = await readBody(request);
        try {
          const result = await applyMutation(env.DB, body);
          return json(result || { ok: true });
        } catch (error) {
          const message = error && error.message ? error.message : "Mutation failed";
          const status = /required|not found|already|Invalid|Unknown/i.test(message) ? 400 : 500;
          return json({ error: message }, status);
        }
      }

      if (path.startsWith("/api/")) {
        return json({ error: loggedIn ? "Not found" : "Unauthorized" }, loggedIn ? 404 : 401);
      }

      if (!loggedIn) {
        if (isLoginAsset(path)) {
          // Serve canonical /login without .html to avoid Cloudflare asset redirect loops.
          if (path === "/login" || path === "/login.html") {
            const loginReq = new Request(new URL("/login.html", url), request);
            return env.ASSETS.fetch(loginReq);
          }
          return env.ASSETS.fetch(request);
        }
        if (
          path === "/" ||
          path === "/index.html" ||
          request.headers.get("Accept")?.includes("text/html")
        ) {
          return Response.redirect(new URL("/login", url), 302);
        }
        return json({ error: "Unauthorized" }, 401);
      }

      if (
        path.startsWith("/worker/") ||
        path.startsWith("/migrations/") ||
        path.startsWith("/scripts/") ||
        path.startsWith("/.github/") ||
        path.startsWith("/public-login/") ||
        ["/wrangler.jsonc", "/package.json", "/CLOUDFLARE_MIGRATION.md", "/AUTH_SETUP.md"].includes(
          path
        )
      ) {
        return json({ error: "Not found" }, 404);
      }
      if (path === "/sw.js") return json({ error: "Not found" }, 404);
      return env.ASSETS.fetch(request);
    } catch (_) {
      return json({ error: "Request could not be completed" }, 500);
    }
  },
};
