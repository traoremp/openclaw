import type { Bar } from "./alpaca.js";

export interface Indicators {
  sma20: number;
  sma50: number;
  rsi14: number;
  macd: { macd: number; signal: number; histogram: number };
  currentPrice: number;
  priceVsSma20: string;
  priceVsSma50: string;
  rsiSignal: string;
  macdSignal: string;
}

function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    result.push(prev);
  }
  return result;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macd(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.slice(-ema26.length).map((v, i) => v - ema26[i]!);
  const signalLine = ema(macdLine, 9);
  const macdVal = macdLine.at(-1) ?? 0;
  const signalVal = signalLine.at(-1) ?? 0;
  return { macd: macdVal, signal: signalVal, histogram: macdVal - signalVal };
}

export function computeIndicators(bars: Bar[]): Indicators {
  const closes = bars.map((b) => b.c);
  const current = closes.at(-1) ?? 0;
  const sma20Val = sma(closes, 20);
  const sma50Val = sma(closes, 50);
  const rsiVal = rsi(closes);
  const macdVal = macd(closes);

  return {
    sma20: Number(sma20Val.toFixed(2)),
    sma50: Number(sma50Val.toFixed(2)),
    rsi14: Number(rsiVal.toFixed(2)),
    macd: {
      macd: Number(macdVal.macd.toFixed(4)),
      signal: Number(macdVal.signal.toFixed(4)),
      histogram: Number(macdVal.histogram.toFixed(4)),
    },
    currentPrice: current,
    priceVsSma20: current > sma20Val ? "above" : "below",
    priceVsSma50: current > sma50Val ? "above" : "below",
    rsiSignal: rsiVal > 70 ? "overbought" : rsiVal < 30 ? "oversold" : "neutral",
    macdSignal: macdVal.histogram > 0 ? "bullish" : "bearish",
  };
}
