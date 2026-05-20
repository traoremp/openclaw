import { fetchAccount, fetchPositions } from "./alpaca.js";
import { isPdtSafe } from "./pdt.js";

export interface RiskGateResult {
  decision: "APPROVE" | "HALT";
  reasons: string[];
  accountSummary: {
    portfolioValue: number;
    buyingPower: number;
    openPositions: number;
    dayTradesUsed: number;
  };
}

export async function checkRiskGate(params: {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  estimatedPrice: number;
}): Promise<RiskGateResult> {
  const [account, positions, pdtStatus] = await Promise.all([
    fetchAccount(),
    fetchPositions(),
    isPdtSafe(),
  ]);

  const portfolioValue = parseFloat(account.portfolio_value);
  const buyingPower = parseFloat(account.buying_power);
  const equity = parseFloat(account.equity);
  const lastEquity = parseFloat(account.last_equity);

  const reasons: string[] = [];
  const orderValue = params.qty * params.estimatedPrice;

  if (params.side === "buy") {
    // Rule 1: Max position size = 20% of portfolio
    const positionPct = orderValue / portfolioValue;
    if (positionPct > 0.2) {
      reasons.push(
        `Position size ${(positionPct * 100).toFixed(1)}% exceeds 20% max (${orderValue.toFixed(2)} / ${portfolioValue.toFixed(2)})`,
      );
    }

    // Rule 2: Max total exposure = 80% of portfolio
    const currentExposure = positions.reduce((sum, p) => {
      const val = parseFloat(p.qty) * parseFloat(p.current_price);
      return sum + (p.side === "long" ? val : 0);
    }, 0);
    const newExposure = currentExposure + orderValue;
    const exposurePct = newExposure / portfolioValue;
    if (exposurePct > 0.8) {
      reasons.push(`Total exposure ${(exposurePct * 100).toFixed(1)}% would exceed 80% max`);
    }

    // Rule 3: Sufficient buying power
    if (orderValue > buyingPower) {
      reasons.push(
        `Insufficient buying power: need ${orderValue.toFixed(2)}, have ${buyingPower.toFixed(2)}`,
      );
    }

    // Rule 4: Max 5 open positions
    const openPositions = positions.filter((p) => p.side === "long").length;
    if (openPositions >= 5) {
      reasons.push(`Already at max 5 open long positions`);
    }

    // Rule 5: PDT safety
    if (!pdtStatus.safe) {
      // Check if this would be a day trade (same-day open+close)
      // Conservative: if account < $25k, refuse if PDT limit hit
      if (portfolioValue < 25000 && pdtStatus.dayTradesUsed >= 3) {
        reasons.push(
          `PDT limit reached: ${pdtStatus.dayTradesUsed}/3 day trades used in rolling 5-day window`,
        );
      }
    }

    // Rule 6: PDT — account flagged as pattern day trader
    if (account.pattern_day_trader) {
      reasons.push(`Account flagged as pattern day trader — no new positions until resolved`);
    }
  }

  // Rule 7: Daily drawdown kill-switch (10% loss vs yesterday equity)
  if (lastEquity > 0) {
    const dailyDrawdown = (lastEquity - equity) / lastEquity;
    if (dailyDrawdown > 0.1) {
      reasons.push(
        `Daily drawdown ${(dailyDrawdown * 100).toFixed(1)}% exceeds 10% kill-switch threshold`,
      );
    }
  }

  // Rule 8: Portfolio too small to trade (below $10 effective)
  if (portfolioValue < 10) {
    reasons.push(`Portfolio value ${portfolioValue.toFixed(2)} too small to trade`);
  }

  return {
    decision: reasons.length === 0 ? "APPROVE" : "HALT",
    reasons,
    accountSummary: {
      portfolioValue,
      buyingPower,
      openPositions: positions.length,
      dayTradesUsed: pdtStatus.dayTradesUsed,
    },
  };
}
