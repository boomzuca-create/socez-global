import { addDays } from "./apiFootball.ts";

/**
 * Selects the newest not-yet-synchronized result dates. Callers decide how
 * many dates their provider plan can safely access and afford.
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

export type HistoryBackfillFailure = { date: string; error: string };

export type HistoryBackfillResult<T> = {
  responses: T[];
  succeededDates: string[];
  failures: HistoryBackfillFailure[];
};

/**
 * Historical data is optional for the current production cycle. A provider
 * rejecting one historical date must not prevent current fixtures, odds and
 * the SOCEZ model from running.
 */
export async function fetchHistoryBackfillBestEffort<T>(
  dates: string[],
  fetchDate: (date: string) => Promise<T>,
): Promise<HistoryBackfillResult<T>> {
  const settled = await Promise.allSettled(dates.map((date) => fetchDate(date)));
  const responses: T[] = [];
  const succeededDates: string[] = [];
  const failures: HistoryBackfillFailure[] = [];

  settled.forEach((result, index) => {
    const date = dates[index];
    if (result.status === "fulfilled") {
      responses.push(result.value);
      succeededDates.push(date);
      return;
    }
    failures.push({
      date,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
  });

  return { responses, succeededDates, failures };
}
