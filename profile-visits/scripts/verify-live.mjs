// Public smoke test: deliberately adds 12 image requests to the counters.
import assert from "node:assert/strict";

const base = new URL(process.argv[2] ?? "https://github-profile-visits.criticalroots.workers.dev");
const periods = ["today", "week", "month", "total"];
const labels = ["Visits Today", "Visits This Week", "Visits This Month", "Visits Total"];
const get = (path, options = {}) => fetch(new URL(path, base), { ...options, signal: AbortSignal.timeout(20000) });
async function count(period) {
  const response = await get(`/badges/${period}.json`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /application\/json/);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  const badge = await response.json();
  assert.equal(badge.schemaVersion, 1);
  return Number(badge.message);
}
const before = await Promise.all(periods.map(count));
for (const path of ["/visit.svg", ...periods.map((p) => `/badges/${p}.json`)]) {
  const response = await get(path, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
}
assert.equal((await get("/visit.svg", { method: "POST" })).status, 405);
assert.equal((await get("/unknown")).status, 404);
assert.deepEqual(await Promise.all(periods.map(count)), before);

const requests = 12;
await Promise.all(Array.from({ length: requests }, async () => {
  const response = await get("/visit.svg");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /image\/svg\+xml/);
  assert.match(await response.text(), /<svg/);
}));
const after = await Promise.all(periods.map(count));
// Run outside UTC midnight and without simultaneous external traffic for exact deltas.
assert.deepEqual(after, before.map((value) => value + requests));

const badges = [];
for (const [i, period] of periods.entries()) {
  const endpoint = new URL(`/badges/${period}.json`, base);
  // A unique read-only URL prevents a previous Shields response masking this run.
  endpoint.searchParams.set("verify", String(Date.now()));
  const url = new URL("https://img.shields.io/endpoint");
  url.search = new URLSearchParams({ url: endpoint.href, style: "flat", labelColor: "161b22", color: "30363d", cacheSeconds: "300" });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /image\/svg\+xml/);
  const svg = await response.text();
  assert.ok(svg.includes(`aria-label="${labels[i]}: ${after[i]}"`), `Shields badge value for ${period}`);
  assert.doesNotMatch(svg, /invalid|inaccessible|unavailable/i);
  badges.push({ period, value: after[i], url: url.href });
}
assert.deepEqual(await Promise.all(periods.map(count)), after);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), before, after, requests, badges, passed: true }, null, 2));
