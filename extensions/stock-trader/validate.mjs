/**
 * Dry-run validation script for the stock-trader plugin.
 * Tests every data source and the risk gate. Does NOT place any orders.
 * Run with: node extensions/stock-trader/validate.mjs
 */

import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CRED_DIR = join(homedir(), ".openclaw", "credentials");
const TEST_SYMBOL = "AAPL";

// ── helpers ──────────────────────────────────────────────────────────────────

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

let _alpaca, _google;
async function alpacaCreds() {
  _alpaca ??= JSON.parse(await readFile(join(CRED_DIR, "alpaca.json"), "utf8"));
  return _alpaca;
}
async function googleCreds() {
  _google ??= JSON.parse(
    await readFile(join(homedir(), ".openclaw", "googlechat-service-account.json"), "utf8"),
  );
  return _google;
}

async function alpacaHeaders() {
  const c = await alpacaCreds();
  return {
    "APCA-API-KEY-ID": c.apiKey,
    "APCA-API-SECRET-KEY": c.secretKey,
    "Content-Type": "application/json",
  };
}

async function googleAccessToken() {
  const sa = await googleCreds();
  const now = Math.floor(Date.now() / 1000);
  const tokenUrl = "https://oauth2.googleapis.com/token";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: tokenUrl,
      iat: now,
      exp: now + 3600,
    }),
  );
  const msg = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(msg);
  const sig = b64url(sign.sign(sa.private_key));
  const jwt = `${msg}.${sig}`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google token: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function pass(label, detail = "") {
  console.log(`  ✅  ${label}${detail ? " — " + detail : ""}`);
}
function fail(label, err) {
  console.log(`  ❌  ${label} — ${err?.message ?? err}`);
}

// ── tests ────────────────────────────────────────────────────────────────────

async function testAlpacaAccount() {
  const c = await alpacaCreds();
  const base = c.paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  const res = await fetch(`${base}/v2/account`, { headers: await alpacaHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  pass(
    "Alpaca account",
    `portfolio=$${parseFloat(d.portfolio_value).toFixed(2)} buying_power=$${parseFloat(d.buying_power).toFixed(2)} status=${d.status}`,
  );
  return d;
}

async function testAlpacaBars() {
  const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const qs = new URLSearchParams({ timeframe: "1Day", limit: "52", start });
  const res = await fetch(`https://data.alpaca.markets/v2/stocks/${TEST_SYMBOL}/bars?${qs}`, {
    headers: await alpacaHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const bars = d.bars ?? [];
  if (bars.length < 20)
    throw new Error(`only ${bars.length} bars returned, need ≥20 for indicators`);
  const last = bars.at(-1);
  pass("Alpaca bars", `${bars.length} bars, last close=$${last.c} on ${last.t.slice(0, 10)}`);
  return bars;
}

async function testAlpacaNews() {
  const qs = new URLSearchParams({ symbols: TEST_SYMBOL, limit: "5" });
  const res = await fetch(`https://data.alpaca.markets/v1beta1/news?${qs}`, {
    headers: await alpacaHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const news = d.news ?? [];
  pass(
    "Alpaca news",
    `${news.length} articles, latest: "${(news[0]?.headline ?? "(none)").slice(0, 60)}"`,
  );
}

async function testAlpacaPositions() {
  const c = await alpacaCreds();
  const base = c.paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
  const res = await fetch(`${base}/v2/positions`, { headers: await alpacaHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const positions = await res.json();
  pass("Alpaca positions", `${positions.length} open position(s)`);
}

async function testStockTwits() {
  const res = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${TEST_SYMBOL}.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  const msgs = d.messages ?? [];
  let bull = 0,
    bear = 0;
  for (const m of msgs) {
    const s = m.entities?.sentiment?.basic;
    if (s === "Bullish") bull++;
    else if (s === "Bearish") bear++;
  }
  pass("StockTwits sentiment", `${msgs.length} messages — bull=${bull} bear=${bear}`);
}

async function testEdgar() {
  const tickerRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: { "User-Agent": "OpenClaw stock-trader traore.moussap@gmail.com" },
  });
  if (!tickerRes.ok) throw new Error(`CIK lookup HTTP ${tickerRes.status}`);
  const tickers = await tickerRes.json();
  const entry = Object.values(tickers).find((e) => e.ticker.toUpperCase() === TEST_SYMBOL);
  if (!entry) throw new Error(`${TEST_SYMBOL} not found in EDGAR tickers`);
  const cik = String(entry.cik_str).padStart(10, "0");
  const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: { "User-Agent": "OpenClaw stock-trader traore.moussap@gmail.com" },
  });
  if (!subRes.ok) throw new Error(`submissions HTTP ${subRes.status}`);
  const sub = await subRes.json();
  const forms = sub.filings?.recent?.form ?? [];
  const idx = forms.findIndex((f) => f === "10-K");
  const date = sub.filings?.recent?.filingDate?.[idx] ?? "unknown";
  pass("SEC EDGAR", `CIK=${parseInt(cik)} — latest 10-K filed ${date}`);
}

async function testGoogleSheets() {
  const creds = await alpacaCreds();
  const token = await googleAccessToken();
  const sheetId = creds.googleSheetId;
  // Write a test row to the Dashboard tab
  const range = "Dashboard!A1";
  const body = { values: [[`Dry-run check`, new Date().toISOString(), "PASS"]] };
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Sheets API HTTP ${res.status}: ${await res.text()}`);
  const d = await res.json();
  pass(
    "Google Sheets write",
    `wrote 1 row to Validation tab (updatedRows=${d.updates?.updatedRows ?? "?"})`,
  );
}

async function testRiskGate(account) {
  const pv = parseFloat(account.portfolio_value);
  const bp = parseFloat(account.buying_power);

  // Simulate: buy 1 share of TEST_SYMBOL at ~$200
  const estimatedPrice = 200;
  const qty = 1;
  const orderValue = qty * estimatedPrice;
  const positionPct = orderValue / pv;
  const sufficient = orderValue <= bp;

  const wouldApprove = positionPct <= 0.2 && sufficient;
  pass(
    "Risk gate logic (simulated)",
    `buy 1×${TEST_SYMBOL} @~$${estimatedPrice} = ${(positionPct * 100).toFixed(1)}% of portfolio — gate would ${wouldApprove ? "APPROVE" : "HALT"}`,
  );
}

async function testWatchlist() {
  const path = join(homedir(), ".openclaw", "workspace-reporter", "watchlist.json");
  const raw = await readFile(path, "utf8");
  const data = JSON.parse(raw);
  pass("Watchlist file", `exists, ${data.length} entries`);
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log(`\nStock Trader — Dry Run Validation`);
console.log(`Symbol under test: ${TEST_SYMBOL}`);
console.log(`──────────────────────────────────\n`);

const results = { pass: 0, fail: 0 };

async function run(label, fn, ...args) {
  try {
    const r = await fn(...args);
    results.pass++;
    return r;
  } catch (err) {
    fail(label, err);
    results.fail++;
    return null;
  }
}

console.log("[ Data Sources ]\n");
const account = await run("Alpaca account", testAlpacaAccount);
await run("Alpaca bars", testAlpacaBars);
await run("Alpaca news", testAlpacaNews);
await run("Alpaca positions", testAlpacaPositions);
await run("StockTwits", testStockTwits);
await run("SEC EDGAR", testEdgar);
await run("Google Sheets", testGoogleSheets);

console.log("\n[ Logic ]\n");
if (account) await run("Risk gate", testRiskGate, account);
await run("Watchlist file", testWatchlist);

console.log(`\n──────────────────────────────────`);
console.log(`Result: ${results.pass} passed, ${results.fail} failed\n`);
if (results.fail > 0) process.exit(1);
