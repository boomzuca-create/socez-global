import { createClient } from "npm:@supabase/supabase-js@2";
import { addDays, type SessionName } from "../_shared/apiFootball.ts";
import {
  rankMarketCandidates,
  type MarketSnapshot,
  type RankedCandidate,
} from "../_shared/marketSelection.ts";
import { selectSocezFinalPick } from "../_shared/socezFinalSelection.ts";
import {
  evaluateSocezRules,
  type ClubIdentityProfile,
  type HistoricalFixture,
  type SocezRuleEvaluation,
  type VerifiedContextSignal,
} from "../_shared/socezRules.ts";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function bangkokDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function sessionWindow(date: string, session: SessionName) {
  const tomorrow = addDays(date, 1);
  if (session === "morning") {
    return { start: `${date}T11:00:00+07:00`, end: `${date}T18:00:00+07:00`, time: "11:00" };
  }
  if (session === "evening") {
    return { start: `${date}T18:00:00+07:00`, end: `${tomorrow}T05:00:00+07:00`, time: "18:00" };
  }
  return { start: `${date}T00:00:00+07:00`, end: `${addDays(date, 2)}T00:00:00+07:00`, time: "18:00" };
}

type FixtureRow = {
  id: string;
  competition_id: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string;
  data_quality: number | string;
  raw_payload: Record<string, unknown> | null;
};

type HistoryRow = FixtureRow & {
  status: string;
  home_score: number | null;
  away_score: number | null;
};

type OddsRow = {
  fixture_id: string;
  bookmaker_id: string;
  market: "1X2" | "AH" | "OU";
  selection: string;
  line: number | string | null;
  decimal_odds: number | string;
  captured_at: string;
  bookmaker: { reliability_weight: number | string } | Array<{ reliability_weight: number | string }> | null;
};

type HistoricalOddsRow = Pick<OddsRow, "fixture_id" | "bookmaker_id" | "market" | "selection" | "line" | "captured_at">;

function reliability(row: OddsRow): number {
  const bookmaker = Array.isArray(row.bookmaker) ? row.bookmaker[0] : row.bookmaker;
  return Number(bookmaker?.reliability_weight ?? 0.7);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function rawScore(raw: Record<string, unknown> | null, period: "halftime" | "fulltime") {
  const score = raw?.score as Record<string, unknown> | undefined;
  const value = score?.[period] as Record<string, unknown> | undefined;
  const home = typeof value?.home === "number" ? value.home : null;
  const away = typeof value?.away === "number" ? value.away : null;
  return { home, away };
}

function latestLine(rows: HistoricalOddsRow[], market: "OU" | "AH", selection?: string): number | null {
  const filtered = rows
    .filter((row) => row.market === market && row.line !== null && (!selection || row.selection === selection))
    .sort((left, right) => new Date(right.captured_at).getTime() - new Date(left.captured_at).getTime());
  if (filtered.length === 0) return null;
  const latestAt = filtered[0].captured_at;
  const lines = filtered
    .filter((row) => row.captured_at === latestAt)
    .map((row) => Number(row.line))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (lines.length === 0) return null;
  return lines[Math.floor(lines.length / 2)];
}

function historicalFixture(row: HistoryRow, odds: HistoricalOddsRow[]): HistoricalFixture {
  const halftime = rawScore(row.raw_payload, "halftime");
  return {
    id: row.id,
    competitionId: row.competition_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    kickoffAt: row.kickoff_at,
    homeScore: row.home_score,
    awayScore: row.away_score,
    status: row.status,
    halftimeHome: halftime.home,
    halftimeAway: halftime.away,
    closingTotalLine: latestLine(odds, "OU"),
    closingHomeHandicap: latestLine(odds, "AH", "HOME"),
  };
}

function evaluationRows(
  modelRunId: string,
  modelVersionId: string,
  fixtureId: string,
  evaluations: SocezRuleEvaluation[],
) {
  return evaluations.map((evaluation) => ({
    model_run_id: modelRunId,
    fixture_id: fixtureId,
    model_version_id: modelVersionId,
    rule_id: evaluation.ruleId,
    status: evaluation.status,
    recommended_market: evaluation.recommendedMarket,
    recommended_selection: evaluation.recommendedSelection,
    evidence_strength: evaluation.evidenceStrength,
    evidence: evaluation.evidence,
    sources: evaluation.sources,
  }));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!cronSecret || !supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Required server secrets are not configured" });
  }
  if (request.headers.get("x-cron-secret") !== cronSecret) return json(401, { error: "Unauthorized" });

  const requestUrl = new URL(request.url);
  const session = (requestUrl.searchParams.get("session") ?? "all") as SessionName;
  if (!["morning", "evening", "all"].includes(session)) {
    return json(400, { error: "session must be morning, evening or all" });
  }

  const date = bangkokDate();
  const window = sessionWindow(date, session);
  const idempotencyKey = `generate-picks:v5:${date}:${session}`;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let { data: model } = await supabase
    .from("model_versions")
    .select("id,version")
    .eq("status", "ACTIVE")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!model) {
    const fallback = await supabase
      .from("model_versions")
      .select("id,version")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    model = fallback.data;
  }
  if (!model) return json(500, { error: "No model version is configured" });

  const { data: activeRules, error: activeRuleError } = await supabase
    .from("model_rules")
    .select("id")
    .eq("phase", "PREMATCH")
    .eq("status", "ACTIVE")
    .in("id", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (activeRuleError) return json(500, { error: `Could not load active SOCEZ rules: ${activeRuleError.message}` });
  const activeRuleIds = new Set((activeRules ?? []).map((rule) => Number(rule.id)));
  if (activeRuleIds.size !== 11) {
    return json(503, { error: "SOCEZ Final Pick gate is closed because all 11 pre-match rules are not active" });
  }

  const { data: previousRun } = await supabase
    .from("model_runs")
    .select("id,status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (previousRun?.status === "SUCCEEDED") {
    return json(200, { status: "SKIPPED", reason: "This session is already generated", idempotencyKey });
  }

  let modelRunId = previousRun?.id as string | undefined;
  if (modelRunId) {
    await supabase.from("model_runs").update({
      status: "STARTED",
      started_at: new Date().toISOString(),
      completed_at: null,
      error_message: null,
    }).eq("id", modelRunId);
    await supabase.from("market_candidates").delete().eq("model_run_id", modelRunId);
    await supabase.from("socez_rule_evaluations").delete().eq("model_run_id", modelRunId);
    await supabase.from("final_picks").delete().eq("model_run_id", modelRunId).in("status", ["OPEN", "PENDING"]);
  } else {
    const { data: createdRun, error: runError } = await supabase.from("model_runs").insert({
      model_version_id: model.id,
      session_time: window.time,
      window_start: window.start,
      window_end: window.end,
      status: "STARTED",
      idempotency_key: idempotencyKey,
    }).select("id").single();
    if (runError || !createdRun) return json(500, { error: `Could not create model run: ${runError?.message ?? "unknown"}` });
    modelRunId = createdRun.id;
  }

  try {
    const { data: fixtureData, error: fixtureError } = await supabase
      .from("fixtures")
      .select("id,competition_id,home_team_id,away_team_id,kickoff_at,data_quality,raw_payload,competition:competitions!inner(coverage_tier)")
      .in("competition.coverage_tier", ["A", "B"])
      .eq("status", "SCHEDULED")
      .gte("kickoff_at", window.start)
      .lt("kickoff_at", window.end)
      .gt("kickoff_at", new Date().toISOString())
      .order("kickoff_at");
    if (fixtureError || !fixtureData) throw new Error(`Could not load fixtures: ${fixtureError?.message ?? "unknown"}`);
    const fixtures = fixtureData as unknown as FixtureRow[];
    const fixtureIds = fixtures.map((fixture) => fixture.id);
    const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.home_team_id, fixture.away_team_id]))];

    let odds: OddsRow[] = [];
    if (fixtureIds.length > 0) {
      const { data: oddsData, error: oddsError } = await supabase
        .from("odds_snapshots")
        .select("fixture_id,bookmaker_id,market,selection,line,decimal_odds,captured_at,bookmaker:bookmakers(reliability_weight)")
        .in("fixture_id", fixtureIds)
        .eq("is_in_play", false)
        .order("captured_at", { ascending: false })
        .limit(10000);
      if (oddsError || !oddsData) throw new Error(`Could not load odds: ${oddsError?.message ?? "unknown"}`);
      odds = oddsData as unknown as OddsRow[];
    }

    let historyRows: HistoryRow[] = [];
    if (teamIds.length > 0) {
      const historyStart = new Date(new Date(window.start).getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const teamList = teamIds.join(",");
      const { data: historyData, error: historyError } = await supabase
        .from("fixtures")
        .select("id,competition_id,home_team_id,away_team_id,kickoff_at,data_quality,raw_payload,status,home_score,away_score,competition:competitions!inner(coverage_tier)")
        .in("competition.coverage_tier", ["A", "B"])
        .in("status", ["FINISHED", "FT", "AET", "PEN"])
        .gte("kickoff_at", historyStart)
        .lt("kickoff_at", window.start)
        .or(`home_team_id.in.(${teamList}),away_team_id.in.(${teamList})`)
        .order("kickoff_at", { ascending: false })
        .limit(5000);
      if (historyError || !historyData) throw new Error(`Could not load rule history: ${historyError?.message ?? "unknown"}`);
      historyRows = historyData as unknown as HistoryRow[];
    }

    const historicalOdds: HistoricalOddsRow[] = [];
    for (const batch of chunks(historyRows.map((fixture) => fixture.id), 100)) {
      const { data, error } = await supabase
        .from("odds_snapshots")
        .select("fixture_id,bookmaker_id,market,selection,line,captured_at")
        .in("fixture_id", batch)
        .in("market", ["OU", "AH"])
        .eq("is_in_play", false)
        .order("captured_at", { ascending: false })
        .limit(10000);
      if (error || !data) throw new Error(`Could not load historical closing lines: ${error?.message ?? "unknown"}`);
      historicalOdds.push(...data as unknown as HistoricalOddsRow[]);
    }
    const history = historyRows.map((fixture) => historicalFixture(
      fixture,
      historicalOdds.filter((odd) => odd.fixture_id === fixture.id),
    ));

    let identities: ClubIdentityProfile[] = [];
    if (teamIds.length > 0) {
      const { data, error } = await supabase
        .from("club_identity_profiles")
        .select("team_id,identity_type,identity_label,source_url")
        .in("team_id", teamIds)
        .eq("active", true);
      if (error || !data) throw new Error(`Could not load verified club identities: ${error?.message ?? "unknown"}`);
      identities = data.map((row) => ({
        teamId: row.team_id,
        identityType: row.identity_type,
        identityLabel: row.identity_label,
        sourceUrl: row.source_url,
      })) as ClubIdentityProfile[];
    }

    let contextSignals: Array<VerifiedContextSignal & { fixtureId: string }> = [];
    if (fixtureIds.length > 0) {
      const { data, error } = await supabase
        .from("verified_context_signals")
        .select("fixture_id,rule_id,recommended_market,recommended_selection,confidence,source_tier,source_url,evidence")
        .in("fixture_id", fixtureIds)
        .gt("expires_at", new Date().toISOString());
      if (error || !data) throw new Error(`Could not load verified context signals: ${error?.message ?? "unknown"}`);
      contextSignals = data.map((row) => ({
        fixtureId: row.fixture_id,
        ruleId: Number(row.rule_id),
        recommendedMarket: row.recommended_market,
        recommendedSelection: row.recommended_selection,
        confidence: Number(row.confidence),
        sourceTier: row.source_tier,
        sourceUrl: row.source_url,
        evidence: row.evidence ?? {},
      })) as Array<VerifiedContextSignal & { fixtureId: string }>;
    }

    const candidateRows: Record<string, unknown>[] = [];
    const ruleRows: Record<string, unknown>[] = [];
    const finalRows: Record<string, unknown>[] = [];
    let fixturesWithMarkets = 0;

    for (const fixture of fixtures) {
      const snapshots: MarketSnapshot[] = odds
        .filter((odd) => odd.fixture_id === fixture.id)
        .map((odd) => ({
          bookmakerId: odd.bookmaker_id,
          reliabilityWeight: reliability(odd),
          market: odd.market,
          selection: odd.selection,
          line: odd.line === null ? null : Number(odd.line),
          decimalOdds: Number(odd.decimal_odds),
          capturedAt: odd.captured_at,
        }));
      const candidates = rankMarketCandidates(snapshots, Number(fixture.data_quality));
      if (candidates.length > 0) fixturesWithMarkets += 1;
      candidateRows.push(...candidates.map((candidate) => ({
        fixture_id: fixture.id,
        model_run_id: modelRunId,
        model_version_id: model.id,
        session_time: window.time,
        market: candidate.market,
        selection: candidate.selection,
        line: candidate.line,
        decimal_odds: candidate.decimalOdds,
        model_probability: candidate.modelProbability,
        market_probability: candidate.marketProbability,
        expected_value: candidate.expectedValue,
        market_score: candidate.score,
        data_quality: Number(fixture.data_quality),
        risk_flag: candidate.riskFlag,
        tier: candidate.tier,
        criteria: { ...candidate.criteria, bookmakerCount: candidate.bookmakerCount },
        signals: candidate.signals,
        price_locked_at: candidate.priceCapturedAt,
      })));

      const evaluations = evaluateSocezRules({
        fixture: {
          id: fixture.id,
          competitionId: fixture.competition_id,
          homeTeamId: fixture.home_team_id,
          awayTeamId: fixture.away_team_id,
          kickoffAt: fixture.kickoff_at,
        },
        history,
        identities,
        contextSignals: contextSignals.filter((signal) => signal.fixtureId === fixture.id),
      });
      ruleRows.push(...evaluationRows(modelRunId, model.id, fixture.id, evaluations));

      const final = selectSocezFinalPick(candidates, evaluations, activeRuleIds);
      if (!final) continue;
      const candidate = final.candidate;
      const ruleSignals = final.matchedRules.map((rule) =>
        `SOCEZ rule ${rule.ruleId}: ${rule.code} — evidence ${rule.evidenceStrength}%`
      );
      finalRows.push({
        fixture_id: fixture.id,
        model_run_id: modelRunId,
        model_version_id: model.id,
        session_time: window.time,
        market: candidate.market,
        selection: candidate.selection,
        line: candidate.line,
        decimal_odds: candidate.decimalOdds,
        model_probability: final.confidence / 100,
        market_probability: candidate.marketProbability,
        expected_value: candidate.expectedValue,
        confidence: final.confidence,
        data_quality: Number(fixture.data_quality),
        risk_flag: candidate.riskFlag,
        signals: [...ruleSignals, ...candidate.signals],
        evidence: {
          scope: "SOCEZ_11_RULE_ENGINE_V1",
          matchedRules: final.matchedRules.map((rule) => ({
            ruleId: rule.ruleId,
            code: rule.code,
            evidenceStrength: rule.evidenceStrength,
            evidence: rule.evidence,
            sources: rule.sources,
          })),
          marketConfirmation: {
            tier: candidate.tier,
            score: candidate.score,
            criteria: candidate.criteria,
            bookmakerCount: candidate.bookmakerCount,
          },
        },
        stake_units: 1,
        status: "OPEN",
        price_locked_at: candidate.priceCapturedAt,
      });
    }

    if (candidateRows.length > 0) {
      const { error } = await supabase.from("market_candidates").insert(candidateRows);
      if (error) throw new Error(`Could not store private market candidates: ${error.message}`);
    }
    if (ruleRows.length > 0) {
      const { error } = await supabase.from("socez_rule_evaluations").insert(ruleRows);
      if (error) throw new Error(`Could not store SOCEZ rule evaluations: ${error.message}`);
    }
    if (finalRows.length > 0) {
      const { error } = await supabase.from("final_picks").insert(finalRows);
      if (error) throw new Error(`Could not publish SOCEZ Final Picks: ${error.message}`);
    }

    await supabase.from("model_runs").update({
      fixtures_scanned: fixtures.length,
      fixtures_qualified: finalRows.length,
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
    }).eq("id", modelRunId);

    const matchedEvaluations = ruleRows.filter((row) => row.status === "MATCH").length;
    const insufficientEvaluations = ruleRows.filter((row) => row.status === "INSUFFICIENT_DATA").length;
    return json(200, {
      status: "SUCCEEDED",
      session,
      modelVersion: model.version,
      fixturesScanned: fixtures.length,
      fixturesWithUsableMarkets: fixturesWithMarkets,
      marketCandidatesStored: candidateRows.length,
      ruleEvaluationsStored: ruleRows.length,
      matchedRuleEvaluations: matchedEvaluations,
      insufficientRuleEvaluations: insufficientEvaluations,
      picksPublished: finalRows.length,
      finalPickGate: "SOCEZ_11_RULE_EVIDENCE_AND_MARKET_CONFIRMATION",
      noPickReason: finalRows.length === 0 ? "No fixture had both an active SOCEZ rule match and a compatible positive-EV market" : null,
      idempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown pick generation error";
    await supabase.from("model_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq("id", modelRunId);
    return json(500, { status: "FAILED", error: message, idempotencyKey });
  }
});
