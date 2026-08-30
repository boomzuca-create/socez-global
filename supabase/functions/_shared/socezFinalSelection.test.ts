import { describe, expect, it } from "vitest";
import type { RankedCandidate } from "./marketSelection";
import type { SocezRuleEvaluation } from "./socezRules";
import { selectSocezFinalPick } from "./socezFinalSelection";

function candidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    market: "OU",
    selection: "OVER",
    line: 2.5,
    decimalOdds: 1.9,
    modelProbability: 0.58,
    marketProbability: 1 / 1.9,
    expectedValue: 0.102,
    score: 82,
    riskFlag: "GREEN",
    tier: "QUALIFIED",
    bookmakerCount: 3,
    priceCapturedAt: "2026-08-31T03:55:00Z",
    criteria: { marketValue: 80, consensus: 82, bookmakerCoverage: 100, dataQuality: 90, priceFreshness: 100 },
    signals: [],
    ...overrides,
  };
}

function rule(overrides: Partial<SocezRuleEvaluation> = {}): SocezRuleEvaluation {
  return {
    ruleId: 5,
    code: "DOUBLE_ZERO_DRAW_OVER",
    status: "MATCH",
    recommendedMarket: "OU",
    recommendedSelection: "OVER",
    evidenceStrength: 78,
    evidence: {},
    sources: [],
    ...overrides,
  };
}

describe("SOCEZ Final Pick gate", () => {
  it("publishes one market-confirmed selection backed by an active rule", () => {
    const selection = selectSocezFinalPick([candidate()], [rule()], new Set([5]));
    expect(selection).toMatchObject({ confidence: 78, candidate: { market: "OU", selection: "OVER" } });
  });

  it("does not publish a market-only candidate", () => {
    expect(selectSocezFinalPick([candidate()], [], new Set([5]))).toBeNull();
  });

  it("does not publish best-available or negative-EV prices", () => {
    expect(selectSocezFinalPick([candidate({ tier: "BEST_AVAILABLE" })], [rule()], new Set([5]))).toBeNull();
    expect(selectSocezFinalPick([candidate({ expectedValue: -0.01 })], [rule()], new Set([5]))).toBeNull();
  });

  it("fails closed when active rules recommend opposite directions in one market", () => {
    const opposite = rule({ ruleId: 1, recommendedSelection: "UNDER" });
    expect(selectSocezFinalPick([candidate()], [rule(), opposite], new Set([1, 5]))).toBeNull();
  });

  it("ignores matches from inactive rules", () => {
    expect(selectSocezFinalPick([candidate()], [rule()], new Set([1]))).toBeNull();
  });
});
