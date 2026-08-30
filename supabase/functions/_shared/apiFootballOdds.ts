export type NormalizedMarket = "1X2" | "AH" | "OU";

export interface ApiFootballOddValue {
  value: string;
  odd: string;
}

export interface ApiFootballBet {
  id: number;
  name: string;
  values: ApiFootballOddValue[];
}

export interface ApiFootballBookmaker {
  id: number;
  name: string;
  bets: ApiFootballBet[];
}

export interface ApiFootballOddsFixture {
  league: { id: number; name: string; country: string; season: number };
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  update: string;
  bookmakers: ApiFootballBookmaker[];
}

export interface NormalizedOdd {
  fixtureProviderId: string;
  bookmakerProviderId: string;
  bookmakerName: string;
  market: NormalizedMarket;
  selection: string;
  line: number | null;
  decimalOdds: number;
  capturedAt: string;
  isPrimaryBookmaker: boolean;
  source: { betId: number; betName: string; rawValue: string; sourceTier: "PRIMARY" | "FALLBACK" };
}

interface ApiFootballResponse<T> {
  errors: Record<string, string> | string[];
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

export const APPROVED_BOOKMAKERS = ["Bet365", "Pinnacle", "Betfair", "William Hill", "Unibet"] as const;

export function isApprovedBookmaker(name: string): boolean {
  const normalized = name.trim().toLocaleLowerCase("en");
  return APPROVED_BOOKMAKERS.some((item) => item.toLocaleLowerCase("en") === normalized);
}

function parseDecimalOdds(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function normalize1X2(value: string): { selection: string; line: null } | null {
  const normalized = value.trim().toLocaleLowerCase("en");
  if (normalized === "home") return { selection: "HOME", line: null };
  if (normalized === "draw") return { selection: "DRAW", line: null };
  if (normalized === "away") return { selection: "AWAY", line: null };
  return null;
}

function normalizeHandicap(value: string): { selection: string; line: number } | null {
  const match = value.trim().match(/^(Home|Away)\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return { selection: match[1].toUpperCase(), line };
}

function normalizeTotal(value: string): { selection: string; line: number } | null {
  const match = value.trim().match(/^(Over|Under)\s*([+-]?\d+(?:\.\d+)?)$/i);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return { selection: match[1].toUpperCase(), line };
}

function normalizeValue(betName: string, value: string): { market: NormalizedMarket; selection: string; line: number | null } | null {
  const normalizedBet = betName.trim().toLocaleLowerCase("en");
  if (normalizedBet === "match winner") {
    const result = normalize1X2(value);
    return result ? { market: "1X2", ...result } : null;
  }
  if (normalizedBet === "asian handicap") {
    const result = normalizeHandicap(value);
    return result ? { market: "AH", ...result } : null;
  }
  if (normalizedBet === "goals over/under" || normalizedBet === "over/under") {
    const result = normalizeTotal(value);
    return result ? { market: "OU", ...result } : null;
  }
  return null;
}

export function normalizeOddsFixture(item: ApiFootballOddsFixture, includeFallback = false): NormalizedOdd[] {
  const capturedAt = new Date(item.update).toISOString();
  return item.bookmakers
    .filter((bookmaker) => includeFallback || isApprovedBookmaker(bookmaker.name))
    .flatMap((bookmaker) => bookmaker.bets.flatMap((bet) => bet.values.flatMap((value) => {
      const decimalOdds = parseDecimalOdds(value.odd);
      const normalized = normalizeValue(bet.name, value.value);
      if (!decimalOdds || !normalized) return [];
      return [{
        fixtureProviderId: String(item.fixture.id),
        bookmakerProviderId: String(bookmaker.id),
        bookmakerName: bookmaker.name,
        market: normalized.market,
        selection: normalized.selection,
        line: normalized.line,
        decimalOdds,
        capturedAt,
        isPrimaryBookmaker: isApprovedBookmaker(bookmaker.name),
        source: {
          betId: bet.id,
          betName: bet.name,
          rawValue: value.value,
          sourceTier: isApprovedBookmaker(bookmaker.name) ? "PRIMARY" : "FALLBACK",
        },
      } satisfies NormalizedOdd];
    })));
}

export async function fetchOddsForDate(
  apiKey: string,
  date: string,
  maxPages = 15,
): Promise<{ fixtures: ApiFootballOddsFixture[]; pagesFetched: number; totalPages: number; quotaRemaining: number | null }> {
  const fixtures: ApiFootballOddsFixture[] = [];
  let page = 1;
  let totalPages = 1;
  let quotaRemaining: number | null = null;

  do {
    const url = new URL("https://v3.football.api-sports.io/odds");
    url.searchParams.set("date", date);
    url.searchParams.set("page", String(page));
    const response = await fetch(url, { headers: { "x-apisports-key": apiKey } });
    const remaining = Number(response.headers.get("x-ratelimit-requests-remaining"));
    if (Number.isFinite(remaining)) quotaRemaining = remaining;
    if (!response.ok) throw new Error(`API-Football odds request failed (${response.status})`);

    const body = (await response.json()) as ApiFootballResponse<ApiFootballOddsFixture>;
    const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors ?? {});
    if (errors.length > 0) throw new Error(`API-Football error: ${errors.join(", ")}`);
    fixtures.push(...body.response);
    totalPages = Math.max(1, body.paging.total);
    page += 1;
  } while (page <= totalPages && page <= maxPages);

  return { fixtures, pagesFetched: page - 1, totalPages, quotaRemaining };
}
