import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchFixturesForDate, normalizeFixtureStatus, type ApiFootballFixture } from "../_shared/apiFootball.ts";
import { pickStatus, profitUnits, settleMarket, type SettlementResult } from "../_shared/settlement.ts";

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

function regulationScore(item: ApiFootballFixture): { home: number; away: number } | null {
  const finished = ["FT", "AET", "PEN"].includes(item.fixture.status.short);
  if (!finished) return null;
  const home = item.score?.fulltime.home ?? item.goals.home;
  const away = item.score?.fulltime.away ?? item.goals.away;
  return home === null || away === null ? null : { home, away };
}

type PickRow = {
  id: string;
  market: "1X2" | "AH" | "OU";
  selection: string;
  line: number | string | null;
  decimal_odds: number | string;
  stake_units: number | string;
  fixture: {
    id: string;
    provider_fixture_id: string;
    kickoff_at: string;
  } | Array<{
    id: string;
    provider_fixture_id: string;
    kickoff_at: string;
  }>;
};

function fixtureOf(pick: PickRow) {
  return Array.isArray(pick.fixture) ? pick.fixture[0] : pick.fixture;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const apiKey = Deno.env.get("API_FOOTBALL_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !cronSecret || !supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Required server secrets are not configured" });
  }
  if (request.headers.get("x-cron-secret") !== cronSecret) return json(401, { error: "Unauthorized" });

  const now = new Date();
  const date = bangkokDate(now);
  const idempotencyKey = `settle-results:v1:${date}`;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await supabase
    .from("job_runs")
    .select("id,status,attempt")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.status === "SUCCEEDED") {
    return json(200, { status: "SKIPPED", reason: "Daily settlement already completed", idempotencyKey });
  }

  const attempt = Number(existing?.attempt ?? 0) + 1;
  const { data: job, error: jobError } = await supabase.from("job_runs").upsert({
    job_name: "settle-results",
    scheduled_for: now.toISOString(),
    status: "STARTED",
    started_at: now.toISOString(),
    completed_at: null,
    attempt,
    records_processed: 0,
    error_message: null,
    idempotency_key: idempotencyKey,
    details: { bangkokDate: date, provider: "api-football", maximumResultDates: 2 },
  }, { onConflict: "idempotency_key" }).select("id").single();
  if (jobError || !job) return json(500, { error: "Could not create settlement audit record" });

  try {
    const oldestKickoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: pickData, error: pickError } = await supabase
      .from("final_picks")
      .select("id,market,selection,line,decimal_odds,stake_units,fixture:fixtures!inner(id,provider_fixture_id,kickoff_at)")
      .in("status", ["OPEN", "PENDING"])
      .gte("fixture.kickoff_at", oldestKickoff)
      .lt("fixture.kickoff_at", now.toISOString());
    if (pickError || !pickData) throw new Error(`Could not load unsettled picks: ${pickError?.message ?? "unknown"}`);
    const picks = pickData as unknown as PickRow[];

    const resultDates = [...new Set(picks.map((pick) => bangkokDate(new Date(fixtureOf(pick).kickoff_at))))]
      .sort()
      .slice(0, 2);
    const providerRows = (await Promise.all(resultDates.map((resultDate) => fetchFixturesForDate(apiKey, resultDate)))).flat();
    const providerById = new Map(providerRows.map((item) => [String(item.fixture.id), item]));

    const settlements: Array<{
      pick_id: string;
      result: SettlementResult;
      home_score: number;
      away_score: number;
      profit_units: number;
      settlement_detail: Record<string, unknown>;
      source_confirmations: Array<Record<string, unknown>>;
    }> = [];
    const pickStatuses = new Map<"WIN" | "LOSS" | "PUSH", string[]>();
    const fixtureUpdates: Array<{ id: string; item: ApiFootballFixture; score: { home: number; away: number } }> = [];

    for (const pick of picks) {
      const fixture = fixtureOf(pick);
      const providerFixture = providerById.get(fixture.provider_fixture_id);
      if (!providerFixture) continue;
      const score = regulationScore(providerFixture);
      if (!score) continue;

      const line = pick.line === null ? null : Number(pick.line);
      const odds = Number(pick.decimal_odds);
      const stake = Number(pick.stake_units);
      const result = settleMarket(pick.market, pick.selection, line, score.home, score.away);
      const status = pickStatus(result);
      pickStatuses.set(status, [...(pickStatuses.get(status) ?? []), pick.id]);
      settlements.push({
        pick_id: pick.id,
        result,
        home_score: score.home,
        away_score: score.away,
        profit_units: profitUnits(result, odds, stake),
        settlement_detail: {
          regulationTime: true,
          market: pick.market,
          selection: pick.selection,
          line,
          lockedDecimalOdds: odds,
          stakeUnits: stake,
        },
        source_confirmations: [{
          provider: "api-football",
          providerFixtureId: fixture.provider_fixture_id,
          fixtureStatus: providerFixture.fixture.status.short,
          fetchedAt: now.toISOString(),
        }],
      });
      fixtureUpdates.push({ id: fixture.id, item: providerFixture, score });
    }

    if (settlements.length > 0) {
      const { error: settlementError } = await supabase
        .from("settlements")
        .upsert(settlements, { onConflict: "pick_id", ignoreDuplicates: true });
      if (settlementError) throw new Error(`Settlement insert failed: ${settlementError.message}`);

      for (const [status, ids] of pickStatuses) {
        const { error: statusError } = await supabase.from("final_picks").update({ status }).in("id", ids);
        if (statusError) throw new Error(`Pick status update failed: ${statusError.message}`);
      }
      for (const fixture of fixtureUpdates) {
        const { error: fixtureError } = await supabase.from("fixtures").update({
          status: normalizeFixtureStatus(fixture.item.fixture.status.short),
          home_score: fixture.score.home,
          away_score: fixture.score.away,
          regulation_result_confirmed: true,
          raw_payload: fixture.item,
        }).eq("id", fixture.id);
        if (fixtureError) throw new Error(`Fixture result update failed: ${fixtureError.message}`);
      }
    }

    const details = {
      bangkokDate: date,
      openPicksScanned: picks.length,
      resultDatesRequested: resultDates,
      providerRequests: resultDates.length,
      settlementsCreated: settlements.length,
      unresolvedPicks: picks.length - settlements.length,
    };
    await supabase.from("job_runs").update({
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
      records_processed: settlements.length,
      details,
    }).eq("id", job.id);
    return json(200, { status: "SUCCEEDED", ...details, idempotencyKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown settlement error";
    await supabase.from("job_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq("id", job.id);
    return json(500, { status: "FAILED", error: message, idempotencyKey });
  }
});
