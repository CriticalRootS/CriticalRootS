import { readCount, recordVisit, type Period } from "./counters.ts";

const labels: Record<Period, string> = {
  today: "Visits Today",
  week: "Visits This Week",
  month: "Visits This Month",
  total: "Visits Total",
};
const pixel = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>';
const headers = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Content-Type-Options": "nosniff",
};

function reply(request: Request, body: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(request.method === "HEAD" ? null : body, {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    const match = /^\/badges\/(today|week|month|total)\.json$/.exec(path);
    const period = match?.[1] as Period | undefined;
    if (path !== "/" && path !== "/visit.svg" && !period) {
      return reply(request, JSON.stringify({ error: "Not found" }), 404);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return reply(request, JSON.stringify({ error: "Method not allowed" }), 405, { Allow: "GET, HEAD" });
    }
    if (path === "/") {
      return reply(request, JSON.stringify({
        service: "GitHub profile image requests",
        timezone: "UTC",
        weekStartsOn: "Monday",
        trackingImage: "/visit.svg",
        badges: Object.keys(labels).map((key) => `/badges/${key}.json`),
        source: "https://github.com/CriticalRootS/CriticalRootS/tree/main/profile-visits",
        note: "Counts image requests reaching the Worker, not unique visitors. GitHub Camo and Shields cache images.",
      }));
    }
    try {
      if (path === "/visit.svg") {
        // HEAD probes and all badge reads are deliberately side-effect free.
        if (request.method === "GET") await recordVisit(env.DB);
        return reply(request, pixel, 200, { "Content-Type": "image/svg+xml; charset=utf-8" });
      }
      const key = period!;
      const count = await readCount(env.DB, key);
      return reply(request, JSON.stringify({
        schemaVersion: 1,
        label: labels[key],
        message: String(count),
        color: "30363d",
        labelColor: "161b22",
        style: "flat",
      }));
    } catch {
      // Never log request headers, URLs, visitor data, or internal database errors.
      const body = period
        ? { schemaVersion: 1, label: labels[period], message: "unavailable", color: "red", isError: true }
        : { error: "Counter temporarily unavailable" };
      return reply(request, JSON.stringify(body), 503, { "Retry-After": "60" });
    }
  },
} satisfies ExportedHandler<Env>;
