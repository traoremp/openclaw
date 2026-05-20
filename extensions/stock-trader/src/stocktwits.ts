export interface StockTwitsSentiment {
  symbol: string;
  bullishCount: number;
  bearishCount: number;
  totalMessages: number;
  bullishPct: number;
  bearishPct: number;
  sentiment: "bullish" | "bearish" | "neutral";
}

export async function fetchStockTwitsSentiment(symbol: string): Promise<StockTwitsSentiment> {
  const url = `https://api.stocktwits.com/api/2/streams/symbol/${symbol}.json`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`StockTwits ${symbol} → ${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    messages?: { entities?: { sentiment?: { basic?: string } } }[];
  };

  const messages = data.messages ?? [];
  let bullishCount = 0;
  let bearishCount = 0;

  for (const msg of messages) {
    const s = msg.entities?.sentiment?.basic;
    if (s === "Bullish") bullishCount++;
    else if (s === "Bearish") bearishCount++;
  }

  const total = messages.length;
  const bullishPct = total > 0 ? Math.round((bullishCount / total) * 100) : 0;
  const bearishPct = total > 0 ? Math.round((bearishCount / total) * 100) : 0;

  return {
    symbol,
    bullishCount,
    bearishCount,
    totalMessages: total,
    bullishPct,
    bearishPct,
    sentiment:
      bullishPct > bearishPct ? "bullish" : bearishPct > bullishPct ? "bearish" : "neutral",
  };
}
