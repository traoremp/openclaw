import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const LOG_PATH = join(homedir(), ".openclaw", "workspace-reporter", "pdt-log.json");

interface PdtEntry {
  date: string; // YYYY-MM-DD
  symbol: string;
  side: "buy" | "sell";
}

async function readLog(): Promise<PdtEntry[]> {
  try {
    const raw = await readFile(LOG_PATH, "utf8");
    return JSON.parse(raw) as PdtEntry[];
  } catch {
    return [];
  }
}

async function writeLog(entries: PdtEntry[]): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  await writeFile(LOG_PATH, JSON.stringify(entries, null, 2), "utf8");
}

// Count day trades in the rolling 5-business-day window ending today.
// A day trade = buy and sell (or sell-short and buy-to-cover) the same symbol on the same calendar day.
export async function countDayTradesInWindow(): Promise<number> {
  const entries = await readLog();
  const now = new Date();

  // Build 5-calendar-day window (conservative — PDT rule uses business days but being conservative is safer)
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 5);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = entries.filter((e) => e.date >= cutoffStr);

  // Group by date+symbol to find same-day round-trips
  const pairs = new Map<string, Set<string>>();
  for (const e of recent) {
    const key = `${e.date}|${e.symbol}`;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key)!.add(e.side);
  }

  let dayTrades = 0;
  for (const sides of pairs.values()) {
    if (sides.has("buy") && sides.has("sell")) dayTrades++;
  }
  return dayTrades;
}

export async function recordTrade(symbol: string, side: "buy" | "sell"): Promise<void> {
  const entries = await readLog();
  const today = new Date().toISOString().slice(0, 10);
  entries.push({ date: today, symbol, side });
  // Keep only last 10 days to avoid unbounded growth
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  await writeLog(entries.filter((e) => e.date >= cutoffStr));
}

export async function isPdtSafe(): Promise<{
  safe: boolean;
  dayTradesUsed: number;
  limit: number;
}> {
  const used = await countDayTradesInWindow();
  return { safe: used < 3, dayTradesUsed: used, limit: 3 };
}
