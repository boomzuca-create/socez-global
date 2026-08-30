import { createClient } from "npm:@supabase/supabase-js@2";
import { addDays, type SessionName } from "../_shared/apiFootball.ts";
import { fetchOddsForFixture, normalizeOddsFixture, type NormalizedOdd } from "../_shared/apiFootballOdds.ts";

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

function sessionWindow(date: string, session: SessionName): { start: string; end: string; dates: string[] } {
  const tomorrow = addDays(date, 1);
  if (session === "morning") {
    return { start: `${date}T11:00:00+07:00`, end: `${date}T18:00:00+07:00`, dates: [date] };
  }
  if (session === "evening") {
    return { start: `${date}T18:00:00+07:00`, end: `${tomorrow}T05:00:00+07:00`, dates: [date, tomorrow] };
  }
  return {
    start: `${date}T00:00:00+07:00`,
    end: `${addDays(date, 2)}T00:00:00+07:00`,
    dates: [date, tomorrow],
  };
}

function snapshotKey(fixtureId: string, bookmakerId: string, odd: NormalizedOdd): string {
  return [fixtureId, bookmakerId, odd.market, odd.selection, odd.line ?? "NO_LINE", odd.capturedAt].join("|");
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

  const requestUrl = new URL(request.url);
  const session = (requestUrl.searchParams.get("session") ?? "all") as SessionName;
  if (!["morning", "evening", "all"].includes(session)) {
    return json(400, { error: "session must be morning, evening or all" });
  }
  const batch = Number(requestUrl.searchParams.get("batch") ?? "0");
  if (!Number.isInteger(batch) || batch < 0 || batch > 4) {
    return json(400, { error: "batch must be an integer from 0 to 4" });
  }

  const date = bangkokDate();
  const window = sessionWindow(date, session);
  const idempotencyKey = `sync-odds:v4:${date}:${session}:batch-${batch}`;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing } = await supabase
    .from("job_runs")
    .select("id,status,attempt")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing?.status === "SUCCEEDED") {
    return json(200, { status: "SKIPPED", reason: "This session is already synchronized", idempotencyKey });
  }

  const attempt = Number(existing?.attempt ?? 0) + 1;
  const { data: job, error: jobError } = await supabase
    .from("job_runs")
    .upsert({
      job_name: "sync-odds",
      scheduled_for: new Date().toISOString(),
      status: "STARTED",
      started_at: new Date().toISOString(),
      completed_at: null,
      attempt,
      records_processed: 0,
      error_message: null,
      idempotency_key: idempotencyKey,
      details: { session, batch, bangkokDate: date, provider: "api-football", quotaMode: "FREE" },
    }, { onConflict: "idempotency_key" })
    .select("id")
    .single();
  if (jobError || !job) return json(500, { error: "Could not create job audit record" });

  try {
    const { data: fixtures, error: fixtureError } = await supabase
      .from("fixtures")
      .select("id,provider_fixture_id,competition:competitions!inner(coverage_tier)")
      .eq("provider", "api-football")
      .in("competition.coverage_tier", ["A", "B"])
      .gte("kickoff_at", window.start)
      .lt("kickoff_at", window.end)
      .order("kickoff_at");
    if (fixtureError || !fixtures) throw new Error(`Could not load session fixtures: ${fixtureError?.message ?? "unknown"}`);

    const fixtureIds = new Map(fixtures.map((fixture) => [fixture.provider_fixture_id, fixture.id]));
    const batchSize = 8;
    const batchStart = batch * batchSize;
    const requestedFixtures = fixtures.slice(batchStart, batchStart + batchSize);
    const providerResponses = [];
    for (const fixture of requestedFixtures) {
      const response = await fetchOddsForFixture(apiKey, fixture.provider_fixture_id);
      providerResponses.push(response);
      if (response.quotaRemaining !== null && response.quotaRemaining <= 5) break;
    }

    const normalized = providerResponses
      .flatMap((response) => response.fixtures)
      .filter((item) => fixtureIds.has(String(item.fixture.id)))
      .flatMap((item) => normalizeOddsFixture(item, true));

    const bookmakerSources = [...new Map(normalized.map((odd) => [odd.bookmakerProviderId, odd])).values()];
    let bookmakerIds = new Map<string, string>();
    if (bookmakerSources.length > 0) {
      const { data: bookmakers, error: bookmakerError } = await supabase
        .from("bookmakers")
        .upsert(bookmakerSources.map((odd) => ({
          provider: "api-football",
          provider_bookmaker_id: odd.bookmakerProviderId,
          name: odd.bookmakerName,
          region_code: "GLOBAL",
          reliability_weight: odd.isPrimaryBookmaker ? 1 : 0.7,
          is_active: true,
        })), { onConflict: "provider,provider_bookmaker_id" })
        .select("id,provider_bookmaker_id");
      if (bookmakerError || !bookmakers) throw new Error(`Bookmaker upsert failed: ${bookmakerError?.message ?? "unknown"}`);
      bookmakerIds = new Map(bookmakers.map((item) => [item.provider_bookmaker_id, item.id]));
    }

    const rows = normalized.flatMap((odd) => {
      const fixtureId = fixtureIds.get(odd.fixtureProviderId);
      const bookmakerId = bookmakerIds.get(odd.bookmakerProviderId);
      if (!fixtureId || !bookmakerId) return [];
      return [{
        fixture_id: fixtureId,
        bookmaker_id: bookmakerId,
        market: odd.market,
        selection: odd.selection,
        line: odd.line,
        decimal_odds: odd.decimalOdds,
        implied_probability: 1 / odd.decimalOdds,
        captured_at: odd.capturedAt,
        is_in_play: false,
        source_payload: odd.source,
        snapshot_key: snapshotKey(fixtureId, bookmakerId, odd),
      }];
    });

    if (rows.length > 0) {
      const { error: oddsError } = await supabase
        .from("odds_snapshots")
        .upsert(rows, { onConflict: "snapshot_key", ignoreDuplicates: true });
      if (oddsError) throw new Error(`Odds snapshot upsert failed: ${oddsError.message}`);
    }

    const pagesFetched = providerResponses.reduce((total, response) => total + response.pagesFetched, 0);
    const quotaRemaining = providerResponses.at(-1)?.quotaRemaining ?? null;
    const details = {
      session,
      batch,
      bangkokDate: date,
      provider: "api-football",
      quotaMode: "FREE",
      datesRequested: window.dates,
      fixturesInWindow: fixtures.length,
      batchSize,
      batchStart,
      maximumSessionCoverage: batchSize * 5,
      fixturesRequested: providerResponses.length,
      oddsFixturesReceived: providerResponses.reduce((total, response) => total + response.fixtures.length, 0),
      approvedSnapshots: rows.length,
      primarySnapshots: rows.filter((row) => row.source_payload.sourceTier === "PRIMARY").length,
      fallbackSnapshots: rows.filter((row) => row.source_payload.sourceTier === "FALLBACK").length,
      pagesFetched,
      requestMode: "TARGETED_FIXTURE",
      quotaRemaining,
      truncated: fixtures.length > batchStart + providerResponses.length,
    };

    await supabase.from("job_runs").update({
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
      records_processed: rows.length,
      details,
    }).eq("id", job.id);
    return json(200, { status: "SUCCEEDED", ...details, idempotencyKey });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown odds synchronization error";
    await supabase.from("job_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq("id", job.id);
    return json(500, { status: "FAILED", error: message, idempotencyKey });
  }
});
