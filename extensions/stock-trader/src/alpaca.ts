import { getAlpacaCredentials } from "./credentials.js";

async function alpacaHeaders(): Promise<Record<string, string>> {
  const creds = await getAlpacaCredentials();
  return {
    "APCA-API-KEY-ID": creds.apiKey,
    "APCA-API-SECRET-KEY": creds.secretKey,
    "Content-Type": "application/json",
  };
}

async function tradingBase(): Promise<string> {
  const creds = await getAlpacaCredentials();
  return creds.paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
}

const DATA_BASE = "https://data.alpaca.markets";

async function alpacaGet<T>(path: string, base?: string): Promise<T> {
  const baseUrl = base ?? (await tradingBase());
  const res = await fetch(`${baseUrl}${path}`, { headers: await alpacaHeaders() });
  if (!res.ok) throw new Error(`Alpaca ${path} → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface Account {
  portfolio_value: string;
  buying_power: string;
  equity: string;
  last_equity: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface Position {
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  side: string;
}

export interface Order {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: string;
  filled_avg_price: string | null;
  status: string;
  created_at: string;
  filled_at: string | null;
}

export interface Bar {
  t: string; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  created_at: string;
  url: string;
  symbols: string[];
}

export async function fetchAccount(): Promise<Account> {
  return alpacaGet<Account>("/v2/account");
}

export async function fetchPositions(): Promise<Position[]> {
  return alpacaGet<Position[]>("/v2/positions");
}

export async function fetchOrders(params: {
  status?: string;
  limit?: number;
  after?: string;
  until?: string;
}): Promise<Order[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.after) qs.set("after", params.after);
  if (params.until) qs.set("until", params.until);
  return alpacaGet<Order[]>(`/v2/orders?${qs}`);
}

export async function fetchBars(symbol: string, timeframe: string, limit: number): Promise<Bar[]> {
  const start = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const qs = new URLSearchParams({ timeframe, limit: String(limit), start });
  const res = await alpacaGet<{ bars: Bar[] }>(`/v2/stocks/${symbol}/bars?${qs}`, DATA_BASE);
  return res.bars ?? [];
}

export async function fetchNews(symbols: string[], limit = 10): Promise<NewsItem[]> {
  const qs = new URLSearchParams({ symbols: symbols.join(","), limit: String(limit) });
  const res = await alpacaGet<{ news: NewsItem[] }>(`/v1beta1/news?${qs}`, DATA_BASE);
  return res.news ?? [];
}

export interface PlaceOrderParams {
  symbol: string;
  qty: number;
  side: "buy" | "sell";
  type?: "market" | "limit";
  limit_price?: number;
  stop_loss_price?: number;
}

export async function placeOrder(params: PlaceOrderParams): Promise<Order> {
  const base = await tradingBase();
  const headers = await alpacaHeaders();

  const body: Record<string, unknown> = {
    symbol: params.symbol,
    qty: params.qty,
    side: params.side,
    type: params.type ?? "market",
    time_in_force: "day",
  };

  if (params.type === "limit" && params.limit_price) {
    body["limit_price"] = params.limit_price;
  }

  // Bracket order with stop-loss when buying
  if (params.side === "buy" && params.stop_loss_price) {
    body["order_class"] = "oto";
    body["stop_loss"] = { stop_price: params.stop_loss_price };
  }

  const res = await fetch(`${base}/v2/orders`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Alpaca place_order → ${res.status}: ${await res.text()}`);
  return res.json() as Promise<Order>;
}
