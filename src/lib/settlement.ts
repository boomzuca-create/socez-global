export type SettlementResult =
  | "FULL_WIN"
  | "HALF_WIN"
  | "PUSH"
  | "HALF_LOSS"
  | "FULL_LOSS";

export function settleOneXTwo(
  selection: "HOME" | "DRAW" | "AWAY",
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const outcome = homeGoals > awayGoals ? "HOME" : homeGoals < awayGoals ? "AWAY" : "DRAW";
  return selection === outcome ? "FULL_WIN" : "FULL_LOSS";
}

function settleSingleAsianHandicap(adjustedMargin: number): SettlementResult {
  if (adjustedMargin > 0) return "FULL_WIN";
  if (adjustedMargin < 0) return "FULL_LOSS";
  return "PUSH";
}

function splitQuarterLine(line: number): [number, number] {
  const doubled = line * 2;
  return [Math.floor(doubled) / 2, Math.ceil(doubled) / 2];
}

function combineHalfSettlements(
  first: SettlementResult,
  second: SettlementResult,
): SettlementResult {
  const score: Record<SettlementResult, number> = {
    FULL_WIN: 1,
    HALF_WIN: 0.5,
    PUSH: 0,
    HALF_LOSS: -0.5,
    FULL_LOSS: -1,
  };
  const combined = (score[first] + score[second]) / 2;
  if (combined === 1) return "FULL_WIN";
  if (combined === 0.5) return "HALF_WIN";
  if (combined === 0) return "PUSH";
  if (combined === -0.5) return "HALF_LOSS";
  return "FULL_LOSS";
}

export function settleAsianHandicap(
  selection: "HOME" | "AWAY",
  line: number,
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const margin = selection === "HOME" ? homeGoals - awayGoals : awayGoals - homeGoals;
  const [lower, upper] = splitQuarterLine(line);
  return combineHalfSettlements(
    settleSingleAsianHandicap(margin + lower),
    settleSingleAsianHandicap(margin + upper),
  );
}

export function settleTotal(
  selection: "OVER" | "UNDER",
  line: number,
  homeGoals: number,
  awayGoals: number,
): SettlementResult {
  const totalGoals = homeGoals + awayGoals;
  const [lower, upper] = splitQuarterLine(line);
  const direction = selection === "OVER" ? 1 : -1;
  return combineHalfSettlements(
    settleSingleAsianHandicap((totalGoals - lower) * direction),
    settleSingleAsianHandicap((totalGoals - upper) * direction),
  );
}
