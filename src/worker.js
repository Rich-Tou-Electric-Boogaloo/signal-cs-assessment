// Signal Support Desk Challenge — Cloudflare Worker
// Serves the assessment page from ./public and stores finished results in Workers KV.
// Bindings (see wrangler.toml): ASSETS (static files), RESULTS (KV). Secret: ASSESSOR_PIN.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const configuredPin = env => String(env.ASSESSOR_PIN ?? "").trim();
const isAssessor = (req, env) =>
  !!configuredPin(env) && String(req.headers.get("x-assessor-pin") || "").trim() === configuredPin(env);

// Safe status check: says whether things are set up, never reveals the PIN.
function health(env) {
  const raw = env.ASSESSOR_PIN;
  return json({
    ok: true,
    pinSet: !!configuredPin(env),
    pinHadExtraSpaces: typeof raw === "string" && raw !== raw.trim(),
    resultsStoreConnected: !!env.RESULTS,
  });
}

function cleanParts(p) {
  if (!p || typeof p !== "object") return null;
  const n = k => Math.round((Number(p[k]) || 0) * 10) / 10;
  return { prio: n("prio"), acc: n("acc"), judg: n("judg"), adapt: n("adapt") };
}

// Mark or unmark a saved result as part of the team benchmark (assessor only).
async function setBenchmark(req, env, id) {
  if (!configuredPin(env)) return json({ error: "pin_not_set" }, 403);
  if (!isAssessor(req, env)) return json({ error: "forbidden" }, 403);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const key = "r:" + id;
  const { value, metadata } = await env.RESULTS.getWithMetadata(key);
  if (value == null) return json({ error: "not_found" }, 404);
  const meta = { ...(metadata || {}), bench: !!body.on };
  if (body.parts) meta.parts = cleanParts(body.parts);
  if (body.total != null) meta.total = Math.round(Number(body.total) || 0);
  if (body.proof !== undefined) meta.proof = body.proof == null ? null : String(body.proof).slice(0, 40);
  await env.RESULTS.put(key, value, { metadata: meta });
  return json({ ok: true });
}

// Every saved result in full, for download (assessor only).
async function exportAll(req, env) {
  if (!configuredPin(env)) return json({ error: "pin_not_set" }, 403);
  if (!isAssessor(req, env)) return json({ error: "forbidden" }, 403);
  const out = [];
  let cursor;
  do {
    const page = await env.RESULTS.list({ prefix: "r:", cursor });
    for (const k of page.keys) {
      const v = await env.RESULTS.get(k.name);
      if (v) out.push({ id: k.name.slice(2), meta: k.metadata || {}, ...JSON.parse(v) });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ exportedAt: new Date().toISOString(), count: out.length, results: out });
}

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
    integ: body.integ == null ? null : Number(body.integ) || 0,
    parts: cleanParts(body.parts),
    proof: body.proof == null ? null : String(body.proof).slice(0, 40),
  };
  await env.RESULTS.put("r:" + id, JSON.stringify({ raw: body.raw, code: String(body.code || "") }), { metadata: meta });
  return json({ ok: true, id });
}

async function readResults(req, env, url) {
  if (!configuredPin(env)) return json({ error: "pin_not_set" }, 403);
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
    if (url.pathname === "/api/health") return health(env);
    if (url.pathname === "/api/results" && req.method === "POST") return saveResult(req, env);
    if (url.pathname === "/api/export" && req.method === "GET") { if (!env.RESULTS) return json({ error: "storage_not_set_up" }, 500); return exportAll(req, env); }
    const bm = url.pathname.match(/^\/api\/results\/([^/]+)\/benchmark$/);
    if (bm && req.method === "POST") { if (!env.RESULTS) return json({ error: "storage_not_set_up" }, 500); return setBenchmark(req, env, decodeURIComponent(bm[1])); }
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
