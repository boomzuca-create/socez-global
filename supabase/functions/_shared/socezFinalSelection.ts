import type { RankedCandidate } from "./marketSelection.ts";
import type { SocezRuleEvaluation } from "./socezRules.ts";

export interface SocezFinalSelection {
  candidate: RankedCandidate;
  matchedRules: SocezRuleEvaluation[];
  confidence: number;
}

function recommendationKey(evaluation: SocezRuleEvaluation): string | null {
  if (!evaluation.recommendedMarket || !evaluation.recommendedSelection) return null;
  return `${evaluation.recommendedMarket}|${evaluation.recommendedSelection}`;
}

/**
 * Converts private market candidates into, at most, one public SOCEZ Final Pick.
 * A candidate must be backed by at least one active rule and must pass the
 * market confirmation gate. Conflicting rule directions fail closed.
 */
export function selectSocezFinalPick(
  candidates: RankedCandidate[],
  evaluations: SocezRuleEvaluation[],
  activeRuleIds: Set<number>,
): SocezFinalSelection | null {
  const matches = evaluations.filter((evaluation) =>
    activeRuleIds.has(evaluation.ruleId) &&
    evaluation.status === "MATCH" &&
    recommendationKey(evaluation) !== null
  );
  if (matches.length === 0) return null;

  const recommendationsByMarket = new Map<string, Set<string>>();
  for (const evaluation of matches) {
    const selections = recommendationsByMarket.get(evaluation.recommendedMarket!) ?? new Set<string>();
    selections.add(evaluation.recommendedSelection!);
    recommendationsByMarket.set(evaluation.recommendedMarket!, selections);
  }

  const eligible = candidates.flatMap((candidate) => {
    if (candidate.tier === "BEST_AVAILABLE" || candidate.expectedValue <= 0) return [];
    const directions = recommendationsByMarket.get(candidate.market);
    if (!directions || directions.size !== 1 || !directions.has(candidate.selection)) return [];
    const matchedRules = matches.filter((evaluation) =>
      evaluation.recommendedMarket === candidate.market &&
      evaluation.recommendedSelection === candidate.selection
    );
    if (matchedRules.length === 0) return [];
    const evidenceStrength = Math.max(...matchedRules.map((evaluation) => evaluation.evidenceStrength));
    return [{
      candidate,
      matchedRules,
      confidence: Math.round(Math.min(candidate.score, evidenceStrength)),
      finalScore: evidenceStrength * 0.6 + candidate.score * 0.4,
    }];
  }).sort((left, right) => right.finalScore - left.finalScore || right.candidate.expectedValue - left.candidate.expectedValue);

  const winner = eligible[0];
  if (!winner) return null;
  return { candidate: winner.candidate, matchedRules: winner.matchedRules, confidence: winner.confidence };
}
