/**
 * What the price agent has actually been doing — the owner's report.
 *
 * Built entirely from rows that already exist: the audit trail the agent writes
 * for every price it applies (`price-watch:auto-apply`), and each source's own
 * lastRunAt/lastRunStatus. No parallel "activity" table, so the report and a
 * dispute are settled from the same rows.
 *
 * The health field is the part that earns its keep. On 17 Sept 2026 the panel
 * showed each source's last cheerful summary and nothing else, so a stopped
 * agent looked exactly like a quiet one — and it was stopped: nothing had been
 * scheduled since 22 August. Worse, the reassuring "last checked" line was not
 * even the agent's own handwriting; "N priced, N differ" is the format a laptop
 * script (scripts/catalog/reconcile-euronics.mjs) writes, while the signed
 * ingest route writes "N stored, N unresolved". Three writers share one string,
 * so `lastRunStatus` alone cannot tell you the agent ran. A report that cannot
 * say "you have heard nothing because nothing ran" is worse than no report,
 * because it is read as reassurance.
 */

/** A source that should be checked regularly is overdue after this long. */
const OVERDUE_AFTER_DAYS = 2;
/** How far back the change list and the per-day rollup look. */
const DEFAULT_WINDOW_DAYS = 14;

const asDate = (v: Date | string | number | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export type AgentSourceHealth = {
  id: string;
  label: string;
  kind: string;
  enabled: boolean;
  allowAutoApply: boolean;
  lastRunAt: string | null;
  lastRunStatus: string;
  daysSinceRun: number | null;
  /** ok = ran recently · overdue = should have run and did not · halted = it
   *  stopped itself and is waiting for a human · never = has never run ·
   *  off = switched off, so silence is expected and not a fault. */
  health: "ok" | "overdue" | "halted" | "never" | "off";
  /** One plain sentence for a non-technical reader. */
  note: string;
};

export type AgentChange = {
  at: string;
  day: string;
  productId: string;
  productCode: string;
  title: string;
  from: number | null;
  to: number | null;
  direction: "rise" | "drop" | "flat";
  sourceLabel: string;
  /** What the source was showing when the change was made — the justification. */
  observedPrice: number | null;
};

export type AgentDay = { day: string; applied: number; rises: number; drops: number };

export type AgentReport = {
  windowDays: number;
  sources: AgentSourceHealth[];
  changes: AgentChange[];
  days: AgentDay[];
  totals: { applied: number; rises: number; drops: number };
  /** True when any source that ought to be running is overdue, halted, or has never run. */
  needsAttention: boolean;
};

export async function agentReport(
  db: any,
  opts: { windowDays?: number; limit?: number; now?: Date } = {},
): Promise<AgentReport> {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - windowDays * 86400_000);

  const [rawSources, audit] = await Promise.all([
    db.priceSource.findMany({ orderBy: [{ kind: "asc" }, { label: "asc" }] }),
    db.adminAuditLog.findMany({
      where: { action: "price-watch:auto-apply", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 200,
    }),
  ]);

  const sources: AgentSourceHealth[] = (rawSources as any[]).map((s) => {
    const lastRun = asDate(s.lastRunAt);
    const status = String(s.lastRunStatus || "");
    const enabled = Boolean(s.enabled);
    const auto = Boolean(s.allowAutoApply);
    const days = lastRun ? Math.floor((now.getTime() - lastRun.getTime()) / 86400_000) : null;

    let health: AgentSourceHealth["health"];
    let note: string;
    if (!enabled) {
      health = "off";
      note = "Switched off — it is not checking prices, and that is deliberate.";
    } else if (status.startsWith("HALTED")) {
      health = "halted";
      note = "It stopped itself because too much changed at once, and is waiting for you to look.";
    } else if (!lastRun) {
      health = "never";
      note = "Has never run.";
    } else if (days !== null && days > OVERDUE_AFTER_DAYS) {
      health = "overdue";
      note = `No check for ${days} days — prices from here are not being kept up to date.`;
    } else {
      health = "ok";
      note = auto ? "Running, and allowed to update prices by itself." : "Running — changes wait for you to approve them.";
    }
    return {
      id: String(s.id),
      label: String(s.label || s.id),
      kind: String(s.kind || "advisory"),
      enabled,
      allowAutoApply: auto,
      lastRunAt: lastRun ? lastRun.toISOString() : null,
      lastRunStatus: status,
      daysSinceRun: days,
      health,
      note,
    };
  });

  const productIds = [...new Set((audit as any[]).map((a) => String(a.entityId)))];
  const products = productIds.length
    ? await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, title: true, productCode: true } })
    : [];
  const byId = new Map((products as any[]).map((p) => [p.id, p]));

  const changes: AgentChange[] = (audit as any[]).map((a) => {
    const at = asDate(a.createdAt) ?? now;
    const p = byId.get(String(a.entityId));
    const prev = (a.previousValue || {}) as any;
    const next = (a.newValue || {}) as any;
    const from = typeof prev.priceNow === "number" ? prev.priceNow : null;
    const to = typeof next.priceNow === "number" ? next.priceNow : null;
    return {
      at: at.toISOString(),
      day: dayKey(at),
      productId: String(a.entityId),
      // A product deleted since the change still has to appear: the money moved.
      productCode: p?.productCode || "",
      title: p?.title || "(product since removed)",
      from,
      to,
      direction: from === null || to === null || from === to ? "flat" : to > from ? "rise" : "drop",
      sourceLabel: String(next.sourceLabel || next.sourceId || ""),
      observedPrice: typeof next.observedPrice === "number" ? next.observedPrice : null,
    };
  });

  // Every day in the window gets a row, including the empty ones — a night with
  // no changes must be visibly a night with no changes, not a gap in a list.
  const byDay = new Map<string, AgentDay>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(now.getTime() - i * 86400_000);
    byDay.set(dayKey(d), { day: dayKey(d), applied: 0, rises: 0, drops: 0 });
  }
  for (const c of changes) {
    const row = byDay.get(c.day);
    if (!row) continue;
    row.applied += 1;
    if (c.direction === "rise") row.rises += 1;
    else if (c.direction === "drop") row.drops += 1;
  }

  const totals = changes.reduce(
    (t, c) => ({
      applied: t.applied + 1,
      rises: t.rises + (c.direction === "rise" ? 1 : 0),
      drops: t.drops + (c.direction === "drop" ? 1 : 0),
    }),
    { applied: 0, rises: 0, drops: 0 },
  );

  return {
    windowDays,
    sources,
    changes,
    days: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    totals,
    // "never" counts: a source the owner switched ON that has never once run is
    // the same silence as an overdue one. "off" does not — that is his choice.
    needsAttention: sources.some((s) => s.health === "overdue" || s.health === "halted" || s.health === "never"),
  };
}
