import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { periodRange, readCount, recordVisit } from "../src/counters.ts";
import worker from "../src/index.ts";

const mf = new Miniflare({
  workers: [{ config: {
    name: "counter-tests",
    compatibilityDate: "2026-11-19",
    manifest: {
      mainModule: "index.js",
      modules: { "index.js": { type: "esm", contents: "export default { fetch() { return new Response('test'); } }" } },
    },
    env: { DB: { type: "d1", id: "counter-tests" } },
  } }],
});
const db = await mf.getD1Database("DB");
await db.prepare(await readFile(new URL("../migrations/0001_counters.sql", import.meta.url), "utf8")).run();
beforeEach(async () => { await db.prepare("DELETE FROM visit_counts").run(); });
after(async () => { await mf.dispose(); });

test("UTC periods use Monday, including weeks across a year boundary", () => {
  const sunday = new Date("2027-01-03T23:59:59Z");
  assert.deepEqual(periodRange("week", sunday), ["2026-12-28", "2027-01-03"]);
  assert.deepEqual(periodRange("week", new Date("2027-01-04T00:00:00Z")), ["2027-01-04", "2027-01-04"]);
  assert.deepEqual(periodRange("today", new Date("2026-11-24T01:00:00+03:00")), ["2026-11-23", "2026-11-23"]);
  assert.deepEqual(periodRange("month", new Date("2028-02-29T12:00:00Z")), ["2028-02-01", "2028-02-29"]);
});

test("empty statistics read as zero without creating counters", async () => {
  for (const period of ["today", "week", "month", "total"]) {
    assert.equal(await readCount(db, period), 0);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM visit_counts").first()).n, 0);
});

test("parallel requests preserve every day and total increment", async () => {
  const now = new Date("2026-11-23T12:00:00Z");
  await Promise.all(Array.from({ length: 50 }, () => recordVisit(db, now)));
  for (const period of ["today", "week", "month", "total"]) {
    assert.equal(await readCount(db, period, now), 50);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM visit_counts").first()).n, 2);
});

test("calendar boundaries and late requests do not reset other buckets", async () => {
  // Deliberately insert the previous day last, simulating a delayed request.
  for (const date of ["2026-10-31", "2026-11-01", "2026-11-23", "2026-11-22"]) {
    await recordVisit(db, new Date(`${date}T12:00:00Z`));
  }
  const now = new Date("2026-11-23T23:59:59Z");
  assert.equal(await readCount(db, "today", now), 1);
  assert.equal(await readCount(db, "week", now), 1);
  assert.equal(await readCount(db, "month", now), 3);
  assert.equal(await readCount(db, "total", now), 4);
  assert.equal(await readCount(db, "today", new Date("2026-11-24T00:00:00Z")), 0);
  assert.equal(await readCount(db, "month", new Date("2026-12-01T00:00:00Z")), 0);
});

test("the two increments roll back together when a constraint fails", async () => {
  const now = new Date("2026-11-23T12:00:00Z");
  await recordVisit(db, now);
  await db.exec("CREATE TRIGGER reject_total BEFORE UPDATE ON visit_counts WHEN NEW.period = 'total' BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  try {
    await assert.rejects(recordVisit(db, now));
    assert.equal(await readCount(db, "today", now), 1);
    assert.equal(await readCount(db, "total", now), 1);
  } finally {
    await db.exec("DROP TRIGGER reject_total;");
  }
});

const labels = { today: "Visits Today", week: "Visits This Week", month: "Visits This Month", total: "Visits Total" };
const request = (path, method = "GET", bindings = { DB: db }) =>
  worker.fetch(new Request(`https://example.com${path}`, { method }), bindings);

test("all four Shields endpoints are read-only, including HEAD", async () => {
  await recordVisit(db);
  for (const [period, label] of Object.entries(labels)) {
    for (let i = 0; i < 2; i++) {
      const response = await request(`/badges/${period}.json`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Content-Type"), /application\/json/);
      assert.match(response.headers.get("Cache-Control"), /no-store/);
      const badge = await response.json();
      assert.equal(badge.schemaVersion, 1);
      assert.equal(badge.label, label);
      assert.equal(badge.message, "1");
      assert.equal(badge.color, "30363d");
    }
    const head = await request(`/badges/${period}.json`, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  }
  assert.equal(await readCount(db, "total"), 1);
});

test("only GET of the tracking image increments, ignoring conditional cache headers", async () => {
  const head = await request("/visit.svg", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(await readCount(db, "total"), 0);
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(new Request("https://example.com/visit.svg", {
      headers: { "If-None-Match": "anything", "If-Modified-Since": new Date().toUTCString() },
    }), { DB: db });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Content-Type"), /image\/svg\+xml/);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.match(await response.text(), /<svg/);
  }
  assert.equal(await readCount(db, "total"), 2);
});

test("unknown routes and unsupported methods never count", async () => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await request("/visit.svg", method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
  }
  assert.equal((await request("/badges/today.json", "POST")).status, 405);
  assert.equal((await request("/badges/unknown.json")).status, 404);
  assert.equal((await request("/")).status, 200);
  assert.equal(await readCount(db, "total"), 0);
});

test("database errors return 503 without exposing details or claiming a successful visit", async () => {
  const broken = { DB: { prepare() { throw new Error("sensitive database detail"); } } };
  const badge = await request("/badges/total.json", "GET", broken);
  assert.equal(badge.status, 503);
  assert.match(badge.headers.get("Cache-Control"), /no-store/);
  const body = await badge.json();
  assert.equal(body.isError, true);
  assert.equal(body.message, "unavailable");
  const image = await request("/visit.svg", "GET", broken);
  assert.equal(image.status, 503);
  assert.doesNotMatch(await image.text(), /sensitive/);
});
