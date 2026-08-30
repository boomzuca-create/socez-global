import type { RegionMetric } from "../types";

export function calculateWinRate(wins: number, losses: number): number {
  const graded = wins + losses;
  return graded === 0 ? 0 : (wins / graded) * 100;
}

export function calculateTotals(metrics: RegionMetric[]) {
  return metrics.reduce(
    (total, item) => ({
      wins: total.wins + item.wins,
      losses: total.losses + item.losses,
      pushes: total.pushes + item.pushes,
      profitUnits: total.profitUnits + item.profitUnits,
    }),
    { wins: 0, losses: 0, pushes: 0, profitUnits: 0 },
  );
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}
