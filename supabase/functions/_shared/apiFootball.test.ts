import { describe, expect, it } from "vitest";
import {
  fixtureDataQuality,
  inferRegion,
  normalizeFixtureStatus,
  selectSessionFixtures,
  type ApiFootballFixture,
} from "./apiFootball";

function fixture(date: string): ApiFootballFixture {
  return {
    fixture: { id: 10, date, timezone: "Asia/Bangkok", venue: null, status: { long: "Not Started", short: "NS", elapsed: null } },
    league: { id: 20, name: "League", country: "Thailand", logo: null, flag: null, season: 2026, round: null },
    teams: {
      home: { id: 1, name: "Home", logo: null, winner: null },
      away: { id: 2, name: "Away", logo: null, winner: null },
    },
    goals: { home: null, away: null },
  };
}

describe("API-Football normalization", () => {
  it("maps countries to dashboard regions", () => {
    expect(inferRegion("Thailand")).toBe("ASIA");
    expect(inferRegion("Brazil")).toBe("AMERICAS");
    expect(inferRegion("England")).toBe("EUROPE");
    expect(inferRegion("World")).toBe("INTERNATIONAL");
  });

  it("filters the two Bangkok publishing windows", () => {
    const fixtures = [
      fixture("2026-08-30T11:00:00+07:00"),
      fixture("2026-08-30T17:59:00+07:00"),
      fixture("2026-08-30T18:00:00+07:00"),
      fixture("2026-08-31T04:59:00+07:00"),
      fixture("2026-08-31T05:00:00+07:00"),
    ];
    expect(selectSessionFixtures(fixtures, "morning", "2026-08-30")).toHaveLength(2);
    expect(selectSessionFixtures(fixtures, "evening", "2026-08-30")).toHaveLength(2);
  });

  it("normalizes statuses and scores complete fixture data", () => {
    expect(normalizeFixtureStatus("FT")).toBe("FINISHED");
    expect(normalizeFixtureStatus("1H")).toBe("LIVE");
    expect(fixtureDataQuality(fixture("2026-08-30T12:00:00+07:00"))).toBe(100);
  });
});
