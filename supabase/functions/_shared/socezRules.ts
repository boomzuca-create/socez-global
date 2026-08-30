export type RuleEvaluationStatus = "MATCH" | "NO_MATCH" | "INSUFFICIENT_DATA";
export type RuleMarket = "1X2" | "AH" | "OU";

export interface HistoricalFixture {
  id: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffAt: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  halftimeHome: number | null;
  halftimeAway: number | null;
  closingTotalLine?: number | null;
  closingHomeHandicap?: number | null;
}

export interface VerifiedContextSignal {
  ruleId: number;
  recommendedMarket: RuleMarket;
  recommendedSelection: string;
  confidence: number;
  sourceTier: "TIER1" | "TIER2" | "TIER3";
  sourceUrl: string;
  evidence: Record<string, unknown>;
}

export interface ClubIdentityProfile {
  teamId: string;
  identityType: "BIRD" | "ANIMAL";
  identityLabel: string;
  sourceUrl: string;
}

export interface RuleEngineInput {
  fixture: {
    id: string;
    competitionId: string;
    homeTeamId: string;
    awayTeamId: string;
    kickoffAt: string;
  };
  history: HistoricalFixture[];
  identities: ClubIdentityProfile[];
  contextSignals: VerifiedContextSignal[];
}

export interface SocezRuleEvaluation {
  ruleId: number;
  code: string;
  status: RuleEvaluationStatus;
  recommendedMarket: RuleMarket | null;
  recommendedSelection: string | null;
  evidenceStrength: number;
  evidence: Record<string, unknown>;
  sources: Array<{ tier: string; url: string }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function result(
  ruleId: number,
  code: string,
  status: RuleEvaluationStatus,
  recommendedMarket: RuleMarket | null = null,
  recommendedSelection: string | null = null,
  evidenceStrength = 0,
  evidence: Record<string, unknown> = {},
  sources: Array<{ tier: string; url: string }> = [],
): SocezRuleEvaluation {
  return { ruleId, code, status, recommendedMarket, recommendedSelection, evidenceStrength, evidence, sources };
}

function completed(fixture: HistoricalFixture): boolean {
  return ["FINISHED", "FT", "AET", "PEN"].includes(fixture.status) &&
    fixture.homeScore !== null && fixture.awayScore !== null;
}

function teamFixtures(input: RuleEngineInput, teamId: string): HistoricalFixture[] {
  const kickoff = new Date(input.fixture.kickoffAt).getTime();
  return input.history
    .filter((item) => completed(item) && new Date(item.kickoffAt).getTime() < kickoff &&
      (item.homeTeamId === teamId || item.awayTeamId === teamId))
    .sort((left, right) => new Date(right.kickoffAt).getTime() - new Date(left.kickoffAt).getTime());
}

function latestHeadToHead(input: RuleEngineInput): { fixture: HistoricalFixture; ageDays: number } | null {
  const kickoff = new Date(input.fixture.kickoffAt).getTime();
  const previous = input.history
    .filter((item) => completed(item) &&
      ((item.homeTeamId === input.fixture.homeTeamId && item.awayTeamId === input.fixture.awayTeamId) ||
       (item.homeTeamId === input.fixture.awayTeamId && item.awayTeamId === input.fixture.homeTeamId)) &&
      new Date(item.kickoffAt).getTime() < kickoff)
    .sort((left, right) => new Date(right.kickoffAt).getTime() - new Date(left.kickoffAt).getTime())[0];
  return previous ? { fixture: previous, ageDays: (kickoff - new Date(previous.kickoffAt).getTime()) / DAY_MS } : null;
}

function totalOutcome(fixture: HistoricalFixture): "OVER" | "UNDER" | "PUSH" | null {
  if (fixture.homeScore === null || fixture.awayScore === null || fixture.closingTotalLine === null || fixture.closingTotalLine === undefined) return null;
  const total = fixture.homeScore + fixture.awayScore;
  if (total > fixture.closingTotalLine) return "OVER";
  if (total < fixture.closingTotalLine) return "UNDER";
  return "PUSH";
}

function handicapLoser(fixture: HistoricalFixture): string | null {
  if (fixture.homeScore === null || fixture.awayScore === null || fixture.closingHomeHandicap === null || fixture.closingHomeHandicap === undefined) return null;
  const adjustedHome = fixture.homeScore - fixture.awayScore + fixture.closingHomeHandicap;
  if (adjustedHome > 0) return fixture.awayTeamId;
  if (adjustedHome < 0) return fixture.homeTeamId;
  return null;
}

function evaluateRule1(input: RuleEngineInput): SocezRuleEvaluation {
  const h2h = latestHeadToHead(input);
  if (!h2h || h2h.ageDays > 7) return result(1, "REMATCH_REVERSAL_7D", "NO_MATCH");
  const previous = totalOutcome(h2h.fixture);
  if (!previous || previous === "PUSH") return result(1, "REMATCH_REVERSAL_7D", "INSUFFICIENT_DATA", null, null, 0, { previousFixtureId: h2h.fixture.id, missing: "closing O/U line or decisive total outcome" });
  const selection = previous === "OVER" ? "UNDER" : "OVER";
  return result(1, "REMATCH_REVERSAL_7D", "MATCH", "OU", selection, 80, { previousFixtureId: h2h.fixture.id, ageDays: h2h.ageDays, previousOutcome: previous, closingTotalLine: h2h.fixture.closingTotalLine });
}

function evaluateRule2(input: RuleEngineInput): SocezRuleEvaluation {
  const h2h = latestHeadToHead(input);
  if (!h2h || h2h.ageDays <= 7 || h2h.ageDays > 14) return result(2, "REMATCH_CONTINUATION_14D", "NO_MATCH");
  const previous = totalOutcome(h2h.fixture);
  if (!previous || previous === "PUSH") return result(2, "REMATCH_CONTINUATION_14D", "INSUFFICIENT_DATA", null, null, 0, { previousFixtureId: h2h.fixture.id, missing: "closing O/U line or decisive total outcome" });
  return result(2, "REMATCH_CONTINUATION_14D", "MATCH", "OU", previous, 80, { previousFixtureId: h2h.fixture.id, ageDays: h2h.ageDays, previousOutcome: previous, closingTotalLine: h2h.fixture.closingTotalLine });
}

function evaluateRule3(input: RuleEngineInput): SocezRuleEvaluation {
  const h2h = latestHeadToHead(input);
  if (!h2h || h2h.ageDays > 7) return result(3, "SAME_VENUE_PRICE_REPEAT", "NO_MATCH");
  const sameVenue = h2h.fixture.homeTeamId === input.fixture.homeTeamId && h2h.fixture.awayTeamId === input.fixture.awayTeamId;
  if (!sameVenue) return result(3, "SAME_VENUE_PRICE_REPEAT", "NO_MATCH");
  if (h2h.fixture.homeScore === h2h.fixture.awayScore) return result(3, "SAME_VENUE_PRICE_REPEAT", "NO_MATCH", null, null, 0, { previousFixtureId: h2h.fixture.id, previousResult: "DRAW" });
  const winnerId = Number(h2h.fixture.homeScore) > Number(h2h.fixture.awayScore) ? h2h.fixture.homeTeamId : h2h.fixture.awayTeamId;
  const selection = winnerId === input.fixture.homeTeamId ? "HOME" : "AWAY";
  return result(3, "SAME_VENUE_PRICE_REPEAT", "MATCH", "AH", selection, 82, { previousFixtureId: h2h.fixture.id, ageDays: h2h.ageDays, previousWinnerTeamId: winnerId, sameVenue: true });
}

function evaluateRule4(input: RuleEngineInput): SocezRuleEvaluation {
  const h2h = latestHeadToHead(input);
  if (!h2h || h2h.ageDays > 7) return result(4, "REVERSED_VENUE_RECOVERY", "NO_MATCH");
  const reversed = h2h.fixture.homeTeamId === input.fixture.awayTeamId && h2h.fixture.awayTeamId === input.fixture.homeTeamId;
  if (!reversed) return result(4, "REVERSED_VENUE_RECOVERY", "NO_MATCH");
  const loserId = handicapLoser(h2h.fixture);
  if (!loserId) return result(4, "REVERSED_VENUE_RECOVERY", "INSUFFICIENT_DATA", null, null, 0, { previousFixtureId: h2h.fixture.id, missing: "closing Asian Handicap line or decisive handicap outcome" });
  const selection = loserId === input.fixture.homeTeamId ? "HOME" : "AWAY";
  return result(4, "REVERSED_VENUE_RECOVERY", "MATCH", "AH", selection, 82, { previousFixtureId: h2h.fixture.id, ageDays: h2h.ageDays, previousHandicapLoserTeamId: loserId, closingHomeHandicap: h2h.fixture.closingHomeHandicap });
}

function evaluateRule5(input: RuleEngineInput): SocezRuleEvaluation {
  for (const teamId of [input.fixture.homeTeamId, input.fixture.awayTeamId]) {
    const leagueMatches = teamFixtures(input, teamId).filter((item) => item.competitionId === input.fixture.competitionId).slice(0, 2);
    if (leagueMatches.length < 2) continue;
    if (leagueMatches.every((item) => item.homeScore === 0 && item.awayScore === 0)) {
      return result(5, "DOUBLE_ZERO_DRAW_OVER", "MATCH", "OU", "OVER", 78, { triggeringTeamId: teamId, previousFixtureIds: leagueMatches.map((item) => item.id), exactSequence: ["0-0", "0-0"] });
    }
  }
  const enoughHistory = [input.fixture.homeTeamId, input.fixture.awayTeamId].every((teamId) =>
    teamFixtures(input, teamId).filter((item) => item.competitionId === input.fixture.competitionId).length >= 2);
  return result(5, "DOUBLE_ZERO_DRAW_OVER", enoughHistory ? "NO_MATCH" : "INSUFFICIENT_DATA");
}

function evaluateRule6(input: RuleEngineInput): SocezRuleEvaluation {
  for (const teamId of [input.fixture.homeTeamId, input.fixture.awayTeamId]) {
    const matches = teamFixtures(input, teamId).slice(0, 3);
    if (matches.length < 3) continue;
    if (matches.every((item) => item.homeScore === 1 && item.awayScore === 1)) {
      return result(6, "TRIPLE_ONE_DRAW_OVER", "MATCH", "OU", "OVER", 82, { triggeringTeamId: teamId, previousFixtureIds: matches.map((item) => item.id), exactSequence: ["1-1", "1-1", "1-1"] });
    }
  }
  const enoughHistory = [input.fixture.homeTeamId, input.fixture.awayTeamId].every((teamId) => teamFixtures(input, teamId).length >= 3);
  return result(6, "TRIPLE_ONE_DRAW_OVER", enoughHistory ? "NO_MATCH" : "INSUFFICIENT_DATA");
}

function teamWonTwoNilWithFirstHalfGoals(fixture: HistoricalFixture, teamId: string): boolean {
  if (fixture.homeTeamId === teamId) {
    return fixture.homeScore === 2 && fixture.awayScore === 0 && fixture.halftimeHome === 2 && fixture.halftimeAway === 0;
  }
  return fixture.awayScore === 2 && fixture.homeScore === 0 && fixture.halftimeAway === 2 && fixture.halftimeHome === 0;
}

function evaluateRule7(input: RuleEngineInput): SocezRuleEvaluation {
  for (const teamId of [input.fixture.homeTeamId, input.fixture.awayTeamId]) {
    const matches = teamFixtures(input, teamId).slice(0, 2);
    if (matches.length < 2) continue;
    if (matches.every((item) => teamWonTwoNilWithFirstHalfGoals(item, teamId))) {
      return result(7, "DOUBLE_TWO_ZERO_PROFILE", "MATCH", "OU", "OVER", 85, { triggeringTeamId: teamId, previousFixtureIds: matches.map((item) => item.id), exactProfile: "2-0 full time and 2-0 at half time" });
    }
  }
  const enoughHistory = [input.fixture.homeTeamId, input.fixture.awayTeamId].every((teamId) => teamFixtures(input, teamId).length >= 2);
  return result(7, "DOUBLE_TWO_ZERO_PROFILE", enoughHistory ? "NO_MATCH" : "INSUFFICIENT_DATA");
}

function verifiedSignal(input: RuleEngineInput, ruleId: number, code: string): SocezRuleEvaluation {
  const signal = input.contextSignals.find((item) => item.ruleId === ruleId && item.sourceTier === "TIER1");
  if (!signal) return result(ruleId, code, "INSUFFICIENT_DATA", null, null, 0, { missing: "verified Tier 1 context signal" });
  return result(ruleId, code, "MATCH", signal.recommendedMarket, signal.recommendedSelection, signal.confidence, signal.evidence, [{ tier: signal.sourceTier, url: signal.sourceUrl }]);
}

function evaluateRule9(input: RuleEngineInput): SocezRuleEvaluation {
  const home = input.identities.find((item) => item.teamId === input.fixture.homeTeamId);
  const away = input.identities.find((item) => item.teamId === input.fixture.awayTeamId);
  if (!home || !away) return result(9, "CLUB_IDENTITY_PATTERN", "INSUFFICIENT_DATA", null, null, 0, { missing: "verified identity profile for both clubs" });
  return result(9, "CLUB_IDENTITY_PATTERN", "MATCH", "OU", "OVER", 70, { homeIdentity: home.identityLabel, awayIdentity: away.identityLabel }, [{ tier: "TIER1", url: home.sourceUrl }, { tier: "TIER1", url: away.sourceUrl }]);
}

export function evaluateSocezRules(input: RuleEngineInput): SocezRuleEvaluation[] {
  return [
    evaluateRule1(input),
    evaluateRule2(input),
    evaluateRule3(input),
    evaluateRule4(input),
    evaluateRule5(input),
    evaluateRule6(input),
    evaluateRule7(input),
    verifiedSignal(input, 8, "TWO_RED_NO_GOAL_OVER"),
    evaluateRule9(input),
    verifiedSignal(input, 10, "MANAGER_CRITICISM_SIGNAL"),
    verifiedSignal(input, 11, "NEW_MANAGER_CONTEXT"),
  ];
}
