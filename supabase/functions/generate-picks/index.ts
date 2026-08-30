import { createClient } from "npm:@supabase/supabase-js@2";
import { addDays, type SessionName } from "../_shared/apiFootball.ts";
import {
  rankMarketCandidates,
  selectPublishedCandidates,
  type MarketSnapshot,
  type RankedCandidate,
} from "../_shared/marketSelection.ts";

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

function reliability(row: OddsRow): number {
  const bookmaker = Array.isArray(row.bookmaker) ? row.bookmaker[0] : row.bookmaker;
  return Number(bookmaker?.reliability_weight ?? 0.7);
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
  if (!['morning', 'evening', 'all'].includes(session)) {
    return json(400, { error: "session must be morning, evening or all" });
  }

  const date = bangkokDate();
  const window = sessionWindow(date, session);
  const idempotencyKey = `generate-picks:v2:${date}:${session}`;
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
    await supabase.from("final_picks").delete().eq("model_run_id", modelRunId);
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
    const { data: fixtures, error: fixtureError } = await supabase
      .from("fixtures")
      .select("id,data_quality,competition:competitions!inner(coverage_tier)")
      .in("competition.coverage_tier", ["A", "B"])
      .gte("kickoff_at", window.start)
      .lt("kickoff_at", window.end)
      .order("kickoff_at");
    if (fixtureError || !fixtures) throw new Error(`Could not load fixtures: ${fixtureError?.message ?? "unknown"}`);

    const fixtureIds = fixtures.map((fixture) => fixture.id);
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

    const perFixture: Array<{ fixtureId: string; dataQuality: number; candidate: RankedCandidate }> = [];
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
      const candidate = rankMarketCandidates(snapshots, Number(fixture.data_quality))[0];
      if (candidate) perFixture.push({ fixtureId: fixture.id, dataQuality: Number(fixture.data_quality), candidate });
    }

    const selectedCandidates = selectPublishedCandidates(perFixture.map((item) => item.candidate));
    const selected = selectedCandidates.map((candidate) => perFixture.find((item) => item.candidate === candidate)!);
    if (selected.length > 0) {
      const { error: pickError } = await supabase.from("final_picks").insert(selected.map(({ fixtureId, dataQuality, candidate }) => ({
        fixture_id: fixtureId,
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
        confidence: candidate.score,
        data_quality: dataQuality,
        risk_flag: candidate.riskFlag,
        signals: [candidate.tier, ...candidate.signals],
        evidence: {
          scope: "MARKET_LED_SELECTION_V1",
          tier: candidate.tier,
          overallScore: candidate.score,
          qualificationThreshold: 70,
          investThreshold: 75,
          criteria: candidate.criteria,
          bookmakerCount: candidate.bookmakerCount,
          note: candidate.tier === "BEST_AVAILABLE"
            ? "Best available selection; below the standard 70% qualification threshold"
            : "Published from market consensus, source coverage, price freshness and data quality",
        },
        stake_units: 1,
        status: "OPEN",
        price_locked_at: candidate.priceCapturedAt,
      })));
      if (pickError) throw new Error(`Could not publish picks: ${pickError.message}`);
    }

    await supabase.from("model_runs").update({
      fixtures_scanned: fixtures.length,
      fixtures_qualified: selected.length,
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
    }).eq("id", modelRunId);

    return json(200, {
      status: "SUCCEEDED",
      session,
      modelVersion: model.version,
      fixturesScanned: fixtures.length,
      fixturesWithUsableMarkets: perFixture.length,
      picksPublished: selected.length,
      qualifiedThreshold: 70,
      scores: selected.map((item) => item.candidate.score),
      tiers: selected.map((item) => item.candidate.tier),
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
