export type Period = "today" | "week" | "month" | "total";

export function periodRange(period: Period, now = new Date()): [string, string] {
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now);
  if (period === "week") {
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  } else if (period === "month") {
    start.setUTCDate(1);
  }
  return [start.toISOString().slice(0, 10), end];
}

export async function recordVisit(db: D1Database, now = new Date()): Promise<void> {
  // One SQLite statement is atomic: either both increments commit or neither does.
  await db.prepare(`
    INSERT INTO visit_counts (period, visits) VALUES (?, 1), ('total', 1)
    ON CONFLICT(period) DO UPDATE SET visits = visit_counts.visits + excluded.visits
  `).bind(now.toISOString().slice(0, 10)).run();
}

export async function readCount(db: D1Database, period: Period, now = new Date()): Promise<number> {
  if (period === "total") {
    return (await db.prepare("SELECT visits FROM visit_counts WHERE period = 'total'")
      .first<number>("visits")) ?? 0;
  }
  const [start, end] = periodRange(period, now);
  return (await db.prepare(`
    SELECT COALESCE(SUM(visits), 0) AS visits FROM visit_counts
    WHERE period BETWEEN ? AND ?
  `).bind(start, end).first<number>("visits")) ?? 0;
}
