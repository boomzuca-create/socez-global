import { describe, expect, it } from "vitest";
import { evaluateSocezRules, type HistoricalFixture, type RuleEngineInput } from "./socezRules";

const current = {
  id: "current",
  competitionId: "league-a",
  homeTeamId: "home",
  awayTeamId: "away",
  kickoffAt: "2026-08-31T11:00:00.000Z",
};

function historical(overrides: Partial<HistoricalFixture>): HistoricalFixture {
  return {
    id: "previous",
    competitionId: "league-a",
    homeTeamId: "home",
    awayTeamId: "away",
    kickoffAt: "2026-08-26T11:00:00.000Z",
    homeScore: 3,
    awayScore: 1,
    status: "FINISHED",
    halftimeHome: 1,
    halftimeAway: 0,
    ...overrides,
  };
}

function input(history: HistoricalFixture[] = []): RuleEngineInput {
  return { fixture: current, history, identities: [], contextSignals: [] };
}

describe("SOCEZ 11-rule evaluator", () => {
  it("evaluates all eleven pre-match rules on every fixture", () => {
    expect(evaluateSocezRules(input())).toHaveLength(11);
  });

  it("reverses a decisive closing O/U outcome for a rematch within seven days", () => {
    const rules = evaluateSocezRules(input([historical({ closingTotalLine: 2.5 })]));
    expect(rules[0]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "UNDER" });
  });

  it("continues a decisive O/U outcome for a rematch after seven and within fourteen days", () => {
    const rules = evaluateSocezRules(input([historical({
      kickoffAt: "2026-08-21T11:00:00.000Z",
      homeScore: 1,
      awayScore: 0,
      closingTotalLine: 2.5,
    })]));
    expect(rules[1]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "UNDER" });
  });

  it("backs the previous outright winner at the same venue within seven days", () => {
    const rules = evaluateSocezRules(input([historical({ homeScore: 2, awayScore: 0 })]));
    expect(rules[2]).toMatchObject({ status: "MATCH", recommendedMarket: "AH", recommendedSelection: "HOME" });
  });

  it("backs the previous handicap loser after the venue reverses", () => {
    const rules = evaluateSocezRules(input([historical({
      homeTeamId: "away",
      awayTeamId: "home",
      homeScore: 1,
      awayScore: 0,
      closingHomeHandicap: -0.5,
    })]));
    expect(rules[3]).toMatchObject({ status: "MATCH", recommendedMarket: "AH", recommendedSelection: "HOME" });
  });

  it("fails closed when a rematch has no verified closing total line", () => {
    const rules = evaluateSocezRules(input([historical({ closingTotalLine: null })]));
    expect(rules[0].status).toBe("INSUFFICIENT_DATA");
  });

  it("matches two consecutive league 0-0 draws", () => {
    const rules = evaluateSocezRules(input([
      historical({ id: "a", kickoffAt: "2026-08-25T11:00:00Z", homeTeamId: "home", awayTeamId: "x", homeScore: 0, awayScore: 0 }),
      historical({ id: "b", kickoffAt: "2026-08-20T11:00:00Z", homeTeamId: "y", awayTeamId: "home", homeScore: 0, awayScore: 0 }),
    ]));
    expect(rules[4]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "OVER" });
  });

  it("matches three consecutive 1-1 results in all competitions", () => {
    const rules = evaluateSocezRules(input([
      historical({ id: "a", kickoffAt: "2026-08-25T11:00:00Z", awayTeamId: "x", homeScore: 1, awayScore: 1 }),
      historical({ id: "b", kickoffAt: "2026-08-20T11:00:00Z", homeTeamId: "y", awayTeamId: "home", homeScore: 1, awayScore: 1 }),
      historical({ id: "c", kickoffAt: "2026-08-15T11:00:00Z", competitionId: "cup", awayTeamId: "z", homeScore: 1, awayScore: 1 }),
    ]));
    expect(rules[5]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "OVER" });
  });

  it("matches two consecutive 2-0 wins whose goals were complete at half time", () => {
    const rules = evaluateSocezRules(input([
      historical({ id: "a", kickoffAt: "2026-08-25T11:00:00Z", awayTeamId: "x", homeScore: 2, awayScore: 0, halftimeHome: 2, halftimeAway: 0 }),
      historical({ id: "b", kickoffAt: "2026-08-20T11:00:00Z", awayTeamId: "y", homeScore: 2, awayScore: 0, halftimeHome: 2, halftimeAway: 0 }),
    ]));
    expect(rules[6]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "OVER" });
  });

  it("requires Tier 1 evidence for event, criticism and new-manager signals", () => {
    const base = input();
    base.contextSignals = [{
      ruleId: 10,
      recommendedMarket: "AH",
      recommendedSelection: "AWAY",
      confidence: 80,
      sourceTier: "TIER2",
      sourceUrl: "https://example.com/report",
      evidence: {},
    }];
    expect(evaluateSocezRules(base)[9].status).toBe("INSUFFICIENT_DATA");
    base.contextSignals[0].sourceTier = "TIER1";
    expect(evaluateSocezRules(base)[9]).toMatchObject({ status: "MATCH", recommendedSelection: "AWAY" });
  });

  it.each([
    [8, 7, "OU", "OVER"],
    [10, 9, "AH", "AWAY"],
    [11, 10, "OU", "OVER"],
  ])("matches contextual rule %i only with a verified Tier 1 signal", (ruleId, index, market, selection) => {
    const base = input();
    base.contextSignals = [{
      ruleId,
      recommendedMarket: market as "AH" | "OU",
      recommendedSelection: selection,
      confidence: 81,
      sourceTier: "TIER1",
      sourceUrl: "https://official.example/evidence",
      evidence: { verified: true },
    }];
    expect(evaluateSocezRules(base)[index]).toMatchObject({
      status: "MATCH",
      recommendedMarket: market,
      recommendedSelection: selection,
      evidenceStrength: 81,
    });
  });

  it("matches the club identity rule only when both identities are verified", () => {
    const base = input();
    base.identities = [
      { teamId: "home", identityType: "BIRD", identityLabel: "Cockerel", sourceUrl: "https://club.example/home" },
      { teamId: "away", identityType: "BIRD", identityLabel: "Liver bird", sourceUrl: "https://club.example/away" },
    ];
    expect(evaluateSocezRules(base)[8]).toMatchObject({ status: "MATCH", recommendedMarket: "OU", recommendedSelection: "OVER" });
  });
});
