import { addDays } from "./apiFootball.ts";

/**
 * Selects the newest not-yet-synchronized result dates. Eight dates plus the
 * morning fixture request remain within the provider's ten-request minute
 * allowance and keep the full daily plan below the 100-request quota.
 */
export function selectHistoryBackfillDates(
  bangkokDate: string,
  previouslySynchronized: Iterable<string>,
  maximumDates = 8,
  lookbackDays = 60,
): string[] {
  const synchronized = new Set(previouslySynchronized);
  const selected: string[] = [];
  for (let age = 1; age <= lookbackDays && selected.length < maximumDates; age += 1) {
    const date = addDays(bangkokDate, -age);
    if (!synchronized.has(date)) selected.push(date);
  }
  return selected;
}
