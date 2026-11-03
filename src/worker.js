// Signal Support Desk Challenge — Cloudflare Worker
// Serves the assessment page from ./public and stores finished results in Workers KV.
// Bindings (see wrangler.toml): ASSETS (static files), RESULTS (KV). Secret: ASSESSOR_PIN.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const isAssessor = (req, env) =>
  !!env.ASSESSOR_PIN && req.headers.get("x-assessor-pin") === env.ASSESSOR_PIN;

async function saveResult(req, env) {
  if (!env.RESULTS) return json({ error: "storage_not_set_up" }, 500);
  const text = await req.text();
  if (text.length > 200000) return json({ error: "too_large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
  if (!body || !body.raw || !Array.isArray(body.raw.set)) return json({ error: "bad_result" }, 400);
  const finishedAt = Number(body.finishedAt) || Date.now();
  // Keys sort newest first.
  const id = `${String(9999999999999 - finishedAt).padStart(13, "0")}-${crypto.randomUUID().slice(0, 8)}`;
  const meta = {
    name: String(body.name || "").slice(0, 80),
    total: Math.round(Number(body.total) || 0),
    finishedAt,
    flags: Number(body.flags) || 0,
    traps: String(body.traps || "").slice(0, 10),
  };
  await env.RESULTS.put("r:" + id, JSON.stringify({ raw: body.raw, code: String(body.code || "") }), { metadata: meta });
  return json({ ok: true, id });
}

async function readResults(req, env, url) {
  if (!isAssessor(req, env)) return json({ error: "forbidden" }, 403);
  if (!env.RESULTS) return json({ error: "storage_not_set_up" }, 500);
  const rest = url.pathname.slice("/api/results".length).replace(/^\//, "");
  if (rest) {
    const v = await env.RESULTS.get("r:" + decodeURIComponent(rest));
    return v ? json(JSON.parse(v)) : json({ error: "not_found" }, 404);
  }
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const results = [];
  let cursor;
  do {
    const page = await env.RESULTS.list({ prefix: "r:", cursor });
    for (const k of page.keys) {
      const m = k.metadata || {};
      if (q && !(m.name || "").toLowerCase().includes(q)) continue;
      results.push({ id: k.name.slice(2), ...m });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ results });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/results" && req.method === "POST") return saveResult(req, env);
    if (url.pathname.startsWith("/api/results") && req.method === "GET") return readResults(req, env, url);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    const res = await env.ASSETS.fetch(req);
    const out = new Response(res.body, res);
    out.headers.set("x-robots-tag", "noindex, nofollow");
    out.headers.set("referrer-policy", "no-referrer");
    out.headers.set("cache-control", "no-store");
    return out;
  },
};
