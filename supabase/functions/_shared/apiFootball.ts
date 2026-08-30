export type SessionName = "morning" | "evening" | "all";
export type RegionCode = "EUROPE" | "ASIA" | "AMERICAS" | "AFRICA" | "OCEANIA" | "INTERNATIONAL";

const BIG_FIVE_LEAGUES = new Map<string, { id: number; names: Set<string> }>([
  ["England", { id: 39, names: new Set(["premier league"]) }],
  ["Spain", { id: 140, names: new Set(["la liga", "primera division"]) }],
  ["Germany", { id: 78, names: new Set(["bundesliga"]) }],
  ["France", { id: 61, names: new Set(["ligue 1"]) }],
  ["Italy", { id: 135, names: new Set(["serie a"]) }],
]);

export const TARGET_DOMESTIC_COUNTRIES = new Set([
  "Armenia", "Australia", "Austria", "Belgium", "Denmark", "Finland", "Hungary", "Malaysia",
  "Mexico", "Netherlands", "Norway", "Portugal", "Scotland", "Sweden", "Switzerland", "USA",
  "United-States", "United States", "Chile",
]);

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    timezone: string;
    venue: { id: number | null; name: string | null; city: string | null } | null;
    status: { long: string; short: string; elapsed: number | null };
  };
  league: {
    id: number;
    name: string;
    country: string;
    logo: string | null;
    flag: string | null;
    season: number;
    round: string | null;
  };
  teams: {
    home: { id: number; name: string; logo: string | null; winner: boolean | null };
    away: { id: number; name: string; logo: string | null; winner: boolean | null };
  };
  goals: { home: number | null; away: number | null };
}

interface ApiFootballResponse<T> {
  errors: Record<string, string> | string[];
  results: number;
  paging: { current: number; total: number };
  response: T[];
}

const countryRegions: Record<RegionCode, Set<string>> = {
  EUROPE: new Set([
    "Albania", "Andorra", "Armenia", "Austria", "Azerbaijan", "Belarus", "Belgium", "Bosnia",
    "Bosnia and Herzegovina", "Bulgaria", "Croatia", "Cyprus", "Czech-Republic", "Czech Republic",
    "Denmark", "England", "Estonia", "Faroe-Islands", "Finland", "France", "Georgia", "Germany",
    "Gibraltar", "Greece", "Hungary", "Iceland", "Ireland", "Israel", "Italy", "Kazakhstan", "Kosovo",
    "Latvia", "Liechtenstein", "Lithuania", "Luxembourg", "Malta", "Moldova", "Montenegro", "Netherlands",
    "North-Macedonia", "Northern-Ireland", "Norway", "Poland", "Portugal", "Romania", "Russia", "San-Marino",
    "Scotland", "Serbia", "Slovakia", "Slovenia", "Spain", "Sweden", "Switzerland", "Turkey", "Ukraine", "Wales",
  ]),
  ASIA: new Set([
    "Afghanistan", "Bahrain", "Bangladesh", "Bhutan", "Brunei", "Cambodia", "China", "Chinese-Taipei",
    "Hong-Kong", "India", "Indonesia", "Iran", "Iraq", "Japan", "Jordan", "Kuwait", "Kyrgyzstan", "Laos",
    "Lebanon", "Macao", "Malaysia", "Maldives", "Mongolia", "Myanmar", "Nepal", "North-Korea", "Oman",
    "Pakistan", "Palestine", "Philippines", "Qatar", "Saudi-Arabia", "Singapore", "South-Korea", "Sri-Lanka",
    "Syria", "Tajikistan", "Thailand", "Timor-Leste", "Turkmenistan", "United-Arab-Emirates", "Uzbekistan", "Vietnam", "Yemen",
  ]),
  AMERICAS: new Set([
    "Anguilla", "Antigua-And-Barbuda", "Argentina", "Aruba", "Bahamas", "Barbados", "Belize", "Bermuda",
    "Bolivia", "Brazil", "British-Virgin-Islands", "Canada", "Cayman-Islands", "Chile", "Colombia", "Costa-Rica",
    "Cuba", "Curacao", "Dominica", "Dominican-Republic", "Ecuador", "El-Salvador", "Grenada", "Guatemala",
    "Guyana", "Haiti", "Honduras", "Jamaica", "Mexico", "Montserrat", "Nicaragua", "Panama", "Paraguay", "Peru",
    "Puerto-Rico", "Saint-Kitts-and-Nevis", "Saint-Lucia", "Saint-Vincent-and-the-Grenadines", "Suriname",
    "Trinidad-And-Tobago", "Turks-and-Caicos-Islands", "USA", "United-States", "Uruguay", "Venezuela", "US-Virgin-Islands",
  ]),
  AFRICA: new Set([
    "Algeria", "Angola", "Benin", "Botswana", "Burkina-Faso", "Burundi", "Cameroon", "Cape-Verde",
    "Central-African-Republic", "Chad", "Comoros", "Congo", "Congo-DR", "Djibouti", "Egypt", "Equatorial-Guinea",
    "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea", "Guinea-Bissau", "Ivory-Coast",
    "Kenya", "Lesotho", "Liberia", "Libya", "Madagascar", "Malawi", "Mali", "Mauritania", "Mauritius", "Morocco",
    "Mozambique", "Namibia", "Niger", "Nigeria", "Rwanda", "Sao-Tome-and-Principe", "Senegal", "Seychelles",
    "Sierra-Leone", "Somalia", "South-Africa", "South-Sudan", "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe",
  ]),
  OCEANIA: new Set([
    "American-Samoa", "Australia", "Cook-Islands", "Fiji", "French-Polynesia", "Guam", "Kiribati", "New-Caledonia",
    "New-Zealand", "Northern-Mariana-Islands", "Papua-New-Guinea", "Samoa", "Solomon-Islands", "Tahiti", "Tonga", "Vanuatu",
  ]),
  INTERNATIONAL: new Set(["World"]),
};

export function inferRegion(country: string): RegionCode {
  for (const [region, countries] of Object.entries(countryRegions) as Array<[RegionCode, Set<string>]>) {
    if (countries.has(country)) return region;
  }
  return "INTERNATIONAL";
}

export function isTargetCompetition(item: ApiFootballFixture): boolean {
  const majorLeague = BIG_FIVE_LEAGUES.get(item.league.country);
  if (majorLeague) {
    const normalizedName = item.league.name.trim().toLocaleLowerCase("en");
    return item.league.id === majorLeague.id || majorLeague.names.has(normalizedName);
  }
  return TARGET_DOMESTIC_COUNTRIES.has(item.league.country);
}

export function targetCoverageTier(item: ApiFootballFixture): "A" | "B" {
  return BIG_FIVE_LEAGUES.has(item.league.country) ? "A" : "B";
}

function bangkokParts(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function selectSessionFixtures(
  fixtures: ApiFootballFixture[],
  session: SessionName,
  bangkokDate: string,
): ApiFootballFixture[] {
  if (session === "all") return fixtures;
  const tomorrow = addDays(bangkokDate, 1);
  return fixtures.filter((item) => {
    const local = bangkokParts(item.fixture.date);
    if (session === "morning") return local.date === bangkokDate && local.hour >= 11 && local.hour < 18;
    return (local.date === bangkokDate && local.hour >= 18) || (local.date === tomorrow && local.hour < 5);
  });
}

export function normalizeFixtureStatus(status: string): string {
  if (["NS", "TBD"].includes(status)) return "SCHEDULED";
  if (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(status)) return "LIVE";
  if (["FT", "AET", "PEN"].includes(status)) return "FINISHED";
  if (["PST"].includes(status)) return "POSTPONED";
  if (["CANC"].includes(status)) return "CANCELLED";
  if (["ABD"].includes(status)) return "ABANDONED";
  return status;
}

export function fixtureDataQuality(item: ApiFootballFixture): number {
  let score = 35;
  if (item.fixture.id) score += 10;
  if (item.fixture.date) score += 10;
  if (item.league.id && item.league.name && item.league.country) score += 15;
  if (item.teams.home.id && item.teams.away.id) score += 15;
  if (item.teams.home.name && item.teams.away.name) score += 10;
  if (item.fixture.status.short) score += 5;
  return Math.min(score, 100);
}

export async function fetchFixturesForDate(apiKey: string, date: string): Promise<ApiFootballFixture[]> {
  const url = new URL("https://v3.football.api-sports.io/fixtures");
  url.searchParams.set("date", date);
  url.searchParams.set("timezone", "Asia/Bangkok");
  const response = await fetch(url, { headers: { "x-apisports-key": apiKey } });
  if (!response.ok) throw new Error(`API-Football fixtures request failed (${response.status})`);
  const body = (await response.json()) as ApiFootballResponse<ApiFootballFixture>;
  const errors = Array.isArray(body.errors) ? body.errors : Object.values(body.errors ?? {});
  if (errors.length > 0) throw new Error(`API-Football error: ${errors.join(", ")}`);
  return body.response;
}
