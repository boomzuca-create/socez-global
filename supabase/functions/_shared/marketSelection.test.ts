import { describe, expect, it } from "vitest";
import { rankMarketCandidates, selectPublishedCandidates, type MarketSnapshot } from "./marketSelection";

const capturedAt = "2026-08-30T10:55:00.000Z";
const now = new Date("2026-08-30T11:00:00.000Z");

function book(bookmakerId: string, home: number, draw: number, away: number): MarketSnapshot[] {
  return [
    { bookmakerId, reliabilityWeight: 1, market: "1X2", selection: "HOME", line: null, decimalOdds: home, capturedAt },
    { bookmakerId, reliabilityWeight: 1, market: "1X2", selection: "DRAW", line: null, decimalOdds: draw, capturedAt },
    { bookmakerId, reliabilityWeight: 1, market: "1X2", selection: "AWAY", line: null, decimalOdds: away, capturedAt },
  ];
}

describe("market-led candidate ranking", () => {
  it("removes bookmaker margin and ranks the best available price", () => {
    const candidates = rankMarketCandidates([
      ...book("a", 2.1, 3.3, 3.5),
      ...book("b", 2.2, 3.2, 3.4),
      ...book("c", 2.15, 3.25, 3.45),
    ], 95, now);
    const home = candidates.find((candidate) => candidate.selection === "HOME")!;
    expect(home.decimalOdds).toBe(2.2);
    expect(home.bookmakerCount).toBe(3);
    expect(home.criteria.bookmakerCoverage).toBe(100);
    expect(home.signals).toContain("Data quality 95%");
  });

  it("publishes the top fallback with a clear tier when nothing reaches 70%", () => {
    const candidates = rankMarketCandidates(book("only", 1.9, 3.4, 4.2), 45, now);
    const published = selectPublishedCandidates(candidates);
    expect(published).toHaveLength(1);
    expect(published[0].tier).toBe("BEST_AVAILABLE");
    expect(published[0].score).toBeLessThan(70);
  });

  it("publishes no more than four candidates scoring at least 70%", () => {
    const candidates = rankMarketCandidates([
      ...book("a", 2.1, 3.3, 3.5),
      ...book("b", 2.2, 3.2, 3.4),
      ...book("c", 2.15, 3.25, 3.45),
    ], 100, now);
    expect(selectPublishedCandidates(candidates, 2)).toHaveLength(2);
    expect(selectPublishedCandidates(candidates, 2).every((candidate) => candidate.score >= 70)).toBe(true);
  });
});
