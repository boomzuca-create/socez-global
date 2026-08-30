export type RegionCode = "EUROPE" | "ASIA" | "AMERICAS" | "AFRICA" | "OCEANIA";
export type MarketCode = "1X2" | "AH" | "OU";
export type PickStatus = "OPEN" | "WIN" | "LOSS" | "PUSH" | "PENDING";

export interface Pick {
  id: string;
  region: RegionCode;
  country: string;
  competition: string;
  kickoffAt: string;
  session: "11:00" | "18:00";
  homeTeam: string;
  awayTeam: string;
  market: MarketCode;
  selection: string;
  line: string | null;
  decimalOdds: number;
  modelProbability: number;
  marketProbability: number;
  expectedValue: number;
  confidence: number;
  dataQuality: number;
  riskFlag: "GREEN" | "YELLOW" | "RED";
  status: PickStatus;
  signals: string[];
}

export interface RegionMetric {
  region: RegionCode;
  label: string;
  wins: number;
  losses: number;
  pushes: number;
  profitUnits: number;
}

export interface ProfitPoint {
  label: string;
  value: number;
}
