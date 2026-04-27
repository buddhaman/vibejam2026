type ProfileTotals = {
  count: number;
  totalMs: number;
  maxMs: number;
};

const PROFILE_QUERY_KEY = "profile";
const PROFILE_STORAGE_KEY = "aom.profile";
const PROFILE_ALLOWED = import.meta.env.DEV;

let enabled = false;
const totals = new Map<string, ProfileTotals>();

function readInitialEnabled(): boolean {
  if (!PROFILE_ALLOWED || typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const queryValue = params.get(PROFILE_QUERY_KEY);
  if (queryValue === "1" || queryValue === "true") {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, "1");
    return true;
  }
  if (queryValue === "0" || queryValue === "false") {
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    return false;
  }
  return window.localStorage.getItem(PROFILE_STORAGE_KEY) === "1";
}

export function initProfiling(): void {
  enabled = readInitialEnabled();
  if (!enabled || typeof window === "undefined") return;
  console.info("[profile] enabled. Use ?profile=0 to disable.");
  window.setInterval(() => flushProfileTotals("periodic"), 5000);
}

export function isProfilingEnabled(): boolean {
  return enabled;
}

export function profileMark(label: string, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  console.info(`[profile] ${label} at ${Math.round(performance.now())}ms`, extra ?? "");
}

export function profileMeasure<T>(label: string, fn: () => T, extra?: Record<string, unknown>): T {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    recordProfileTime(label, performance.now() - start, extra);
  }
}

export async function profileMeasureAsync<T>(
  label: string,
  fn: () => Promise<T>,
  extra?: Record<string, unknown>
): Promise<T> {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    recordProfileTime(label, performance.now() - start, extra);
  }
}

export function recordProfileTime(label: string, ms: number, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  const prev = totals.get(label) ?? { count: 0, totalMs: 0, maxMs: 0 };
  prev.count += 1;
  prev.totalMs += ms;
  prev.maxMs = Math.max(prev.maxMs, ms);
  totals.set(label, prev);
  if (ms >= 12) {
    console.info(`[profile] ${label}: ${ms.toFixed(2)}ms`, extra ?? "");
  }
}

export function flushProfileTotals(reason: string): void {
  if (!enabled || totals.size === 0) return;
  const rows = Array.from(totals.entries())
    .map(([label, total]) => ({
      label,
      count: total.count,
      avgMs: Number((total.totalMs / total.count).toFixed(2)),
      maxMs: Number(total.maxMs.toFixed(2)),
      totalMs: Number(total.totalMs.toFixed(2)),
    }))
    .sort((a, b) => b.totalMs - a.totalMs);
  console.table(rows);
  console.info(`[profile:totals] ${reason} ${JSON.stringify(rows)}`);
  console.info(`[profile] totals flushed: ${reason}`);
  totals.clear();
}
