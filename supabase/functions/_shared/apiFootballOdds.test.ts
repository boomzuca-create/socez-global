import { describe, expect, it } from "vitest";
import { normalizeOddsFixture, type ApiFootballOddsFixture } from "./apiFootballOdds";

const fixture: ApiFootballOddsFixture = {
  league: { id: 39, name: "Premier League", country: "England", season: 2026 },
  fixture: { id: 101, timezone: "UTC", date: "2026-08-30T12:00:00+00:00", timestamp: 0 },
  update: "2026-08-30T08:00:00+00:00",
  bookmakers: [
    {
      id: 8,
      name: "Bet365",
      bets: [
        { id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.10" }, { value: "Draw", odd: "3.20" }, { value: "Away", odd: "3.40" }] },
        { id: 4, name: "Asian Handicap", values: [{ value: "Home -0.25", odd: "1.95" }, { value: "Away +0.25", odd: "1.91" }] },
        { id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }, { value: "Under 2.5", odd: "1.96" }] },
      ],
    },
    { id: 999, name: "Unapproved Book", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "2.20" }] }] },
  ],
};

describe("API-Football odds normalization", () => {
  it("keeps only approved bookmakers and the three supported markets", () => {
    const rows = normalizeOddsFixture(fixture);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((row) => row.market))).toEqual(new Set(["1X2", "AH", "OU"]));
    expect(new Set(rows.map((row) => row.bookmakerName))).toEqual(new Set(["Bet365"]));
  });

  it("can retain fallback bookmakers with an explicit lower source tier", () => {
    const rows = normalizeOddsFixture(fixture, true);
    expect(rows).toHaveLength(8);
    expect(rows).toContainEqual(expect.objectContaining({
      bookmakerName: "Unapproved Book",
      isPrimaryBookmaker: false,
      source: expect.objectContaining({ sourceTier: "FALLBACK" }),
    }));
  });

  it("normalizes handicap and total lines without changing their sign", () => {
    const rows = normalizeOddsFixture(fixture);
    expect(rows).toContainEqual(expect.objectContaining({ market: "AH", selection: "HOME", line: -0.25, decimalOdds: 1.95 }));
    expect(rows).toContainEqual(expect.objectContaining({ market: "OU", selection: "UNDER", line: 2.5, decimalOdds: 1.96 }));
  });

  it("rejects malformed and non-decimal prices", () => {
    const malformed = structuredClone(fixture);
    malformed.bookmakers[0].bets[0].values = [{ value: "Home", odd: "1.00" }, { value: "Unknown", odd: "2.00" }];
    expect(normalizeOddsFixture(malformed).some((row) => row.market === "1X2")).toBe(false);
  });
});
