import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "typebox";
import {
  fetchAccount,
  fetchPositions,
  fetchOrders,
  fetchBars,
  fetchNews,
  placeOrder,
} from "./src/alpaca.js";
import { fetchSecFiling } from "./src/edgar.js";
import { computeIndicators } from "./src/indicators.js";
import { recordTrade } from "./src/pdt.js";
import { checkRiskGate } from "./src/risk-gate.js";
import { sheetsWrite } from "./src/sheets.js";
import { fetchStockTwitsSentiment } from "./src/stocktwits.js";

export default definePluginEntry({
  id: "stock-trader",
  name: "Stock Trader",
  description:
    "Swing trading tools: Alpaca brokerage, Google Sheets reporting, SEC EDGAR filings, StockTwits sentiment",
  register(api) {
    // ── get_account ──────────────────────────────────────────────────────────
    api.registerTool({
      name: "get_account",
      label: "Get Account",
      description:
        "Fetch Alpaca account details including portfolio value, buying power, equity, and PDT status.",
      parameters: Type.Object({}),
      async execute() {
        const account = await fetchAccount();
        return {
          content: [{ type: "text", text: JSON.stringify(account, null, 2) }],
          details: account,
        };
      },
    });

    // ── get_positions ────────────────────────────────────────────────────────
    api.registerTool({
      name: "get_positions",
      label: "Get Positions",
      description:
        "List all open positions with symbol, quantity, average entry price, current price, and unrealized P&L.",
      parameters: Type.Object({}),
      async execute() {
        const positions = await fetchPositions();
        return {
          content: [{ type: "text", text: JSON.stringify(positions, null, 2) }],
          details: { count: positions.length, positions },
        };
      },
    });

    // ── get_orders ───────────────────────────────────────────────────────────
    api.registerTool({
      name: "get_orders",
      label: "Get Orders",
      description: "Fetch recent orders. Filter by status (open/closed/all), limit, date range.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], {
            description: "Order status filter (default: open)",
          }),
        ),
        limit: Type.Optional(Type.Number({ description: "Max number of orders (default: 10)" })),
        after: Type.Optional(Type.String({ description: "ISO date lower bound" })),
        until: Type.Optional(Type.String({ description: "ISO date upper bound" })),
      }),
      async execute(_id, params) {
        const {
          status = "open",
          limit = 10,
          after,
          until,
        } = params as {
          status?: "open" | "closed" | "all";
          limit?: number;
          after?: string;
          until?: string;
        };
        const orders = await fetchOrders({ status, limit, after, until });
        return {
          content: [{ type: "text", text: JSON.stringify(orders, null, 2) }],
          details: { count: orders.length },
        };
      },
    });

    // ── get_bars ─────────────────────────────────────────────────────────────
    api.registerTool({
      name: "get_bars",
      label: "Get Bars",
      description:
        "Fetch OHLCV price bars for a symbol and compute technical indicators (SMA20, SMA50, RSI14, MACD).",
      parameters: Type.Object({
        symbol: Type.String({ description: "Ticker symbol, e.g. AAPL" }),
        timeframe: Type.Optional(
          Type.String({ description: "Bar timeframe: 1Day, 1Hour, 15Min (default: 1Day)" }),
        ),
        limit: Type.Optional(Type.Number({ description: "Number of bars to fetch (default: 50)" })),
      }),
      async execute(_id, params) {
        const {
          symbol,
          timeframe = "1Day",
          limit = 50,
        } = params as {
          symbol: string;
          timeframe?: string;
          limit?: number;
        };
        const bars = await fetchBars(symbol, timeframe, limit);
        const indicators = bars.length >= 20 ? computeIndicators(bars) : null;
        return {
          content: [
            { type: "text", text: JSON.stringify({ bars: bars.slice(-10), indicators }, null, 2) },
          ],
          details: { symbol, barCount: bars.length, indicators },
        };
      },
    });

    // ── get_news ─────────────────────────────────────────────────────────────
    api.registerTool({
      name: "get_news",
      label: "Get News",
      description:
        "Fetch recent financial news articles for one or more symbols via Alpaca (Benzinga feed).",
      parameters: Type.Object({
        symbols: Type.Array(Type.String(), { description: "Ticker symbols to fetch news for" }),
        limit: Type.Optional(Type.Number({ description: "Max articles per symbol (default: 10)" })),
      }),
      async execute(_id, params) {
        const { symbols, limit = 10 } = params as { symbols: string[]; limit?: number };
        const news = await fetchNews(symbols, limit);
        return {
          content: [{ type: "text", text: JSON.stringify(news, null, 2) }],
          details: { count: news.length },
        };
      },
    });

    // ── place_order ──────────────────────────────────────────────────────────
    api.registerTool({
      name: "place_order",
      label: "Place Order",
      description:
        "Submit a buy or sell order on Alpaca. Buys with stop_loss_price use an OTO bracket order for automatic downside protection.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Ticker symbol" }),
        qty: Type.Number({ description: "Number of shares" }),
        side: Type.Union([Type.Literal("buy"), Type.Literal("sell")], {
          description: "buy or sell",
        }),
        type: Type.Optional(
          Type.Union([Type.Literal("market"), Type.Literal("limit")], {
            description: "Order type (default: market)",
          }),
        ),
        limit_price: Type.Optional(
          Type.Number({ description: "Limit price (required when type=limit)" }),
        ),
        stop_loss_price: Type.Optional(
          Type.Number({ description: "Stop-loss trigger price for OTO bracket (buy orders only)" }),
        ),
      }),
      async execute(_id, params) {
        const { symbol, qty, side, type, limit_price, stop_loss_price } = params as {
          symbol: string;
          qty: number;
          side: "buy" | "sell";
          type?: "market" | "limit";
          limit_price?: number;
          stop_loss_price?: number;
        };
        const order = await placeOrder({ symbol, qty, side, type, limit_price, stop_loss_price });
        await recordTrade(symbol, side);
        return {
          content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
          details: order,
        };
      },
    });

    // ── get_stocktwits_sentiment ─────────────────────────────────────────────
    api.registerTool({
      name: "get_stocktwits_sentiment",
      label: "StockTwits Sentiment",
      description:
        "Fetch retail investor sentiment for a symbol from StockTwits: bullish/bearish counts and percentage.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Ticker symbol" }),
      }),
      async execute(_id, params) {
        const { symbol } = params as { symbol: string };
        const sentiment = await fetchStockTwitsSentiment(symbol);
        return {
          content: [{ type: "text", text: JSON.stringify(sentiment, null, 2) }],
          details: sentiment,
        };
      },
    });

    // ── get_sec_filing ───────────────────────────────────────────────────────
    api.registerTool({
      name: "get_sec_filing",
      label: "SEC Filing",
      description:
        "Fetch the most recent SEC filing of a given type (10-K, 10-Q, 8-K) for a ticker via EDGAR.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Ticker symbol" }),
        form_type: Type.Optional(
          Type.String({ description: "SEC form type: 10-K, 10-Q, 8-K (default: 10-K)" }),
        ),
      }),
      async execute(_id, params) {
        const { symbol, form_type = "10-K" } = params as { symbol: string; form_type?: string };
        const filing = await fetchSecFiling(symbol, form_type);
        if (!filing) {
          return {
            content: [{ type: "text", text: `No ${form_type} found for ${symbol}` }],
            details: null,
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(filing, null, 2) }],
          details: filing,
        };
      },
    });

    // ── sheets_write ─────────────────────────────────────────────────────────
    api.registerTool({
      name: "sheets_write",
      label: "Sheets Write",
      description:
        "Write rows to a Google Sheet tab. Use mode=append to add rows, mode=clear_and_write to reset the tab first.",
      parameters: Type.Object({
        tab: Type.String({ description: "Sheet tab name, e.g. Trades or Weekly" }),
        rows: Type.Array(
          Type.Array(Type.Union([Type.String(), Type.Number()]), { description: "Row values" }),
          { description: "Array of rows to write" },
        ),
        mode: Type.Union([Type.Literal("append"), Type.Literal("clear_and_write")], {
          description: "append (add rows) or clear_and_write (reset tab first)",
        }),
      }),
      async execute(_id, params) {
        const { tab, rows, mode } = params as {
          tab: string;
          rows: (string | number)[][];
          mode: "append" | "clear_and_write";
        };
        const result = await sheetsWrite({ tab, rows, mode });
        return {
          content: [{ type: "text", text: `Written ${result.updatedRows} rows to ${tab}` }],
          details: result,
        };
      },
    });

    // ── check_risk_gate ──────────────────────────────────────────────────────
    api.registerTool({
      name: "check_risk_gate",
      label: "Check Risk Gate",
      description:
        "Run all 8 risk checks before placing an order. Returns APPROVE or HALT with reasons. Always call before place_order.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Ticker symbol" }),
        side: Type.Union([Type.Literal("buy"), Type.Literal("sell")], {
          description: "Intended order side",
        }),
        qty: Type.Number({ description: "Intended number of shares" }),
        estimated_price: Type.Number({ description: "Expected execution price per share" }),
      }),
      async execute(_id, params) {
        const { symbol, side, qty, estimated_price } = params as {
          symbol: string;
          side: "buy" | "sell";
          qty: number;
          estimated_price: number;
        };
        const result = await checkRiskGate({ symbol, side, qty, estimatedPrice: estimated_price });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    });
  },
});
