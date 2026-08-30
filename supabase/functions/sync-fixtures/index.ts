import { createClient } from "npm:@supabase/supabase-js@2";
import {
  addDays,
  fetchFixturesForDate,
  fixtureDataQuality,
  inferRegion,
  isTargetCompetition,
  normalizeFixtureStatus,
  selectSessionFixtures,
  targetCoverageTier,
  type ApiFootballFixture,
  type SessionName,
} from "../_shared/apiFootball.ts";

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

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
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
  if (request.headers.get("x-cron-secret") !== cronSecret) {
    return json(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  const session = (url.searchParams.get("session") ?? "all") as SessionName;
  if (!["morning", "evening", "all"].includes(session)) {
    return json(400, { error: "session must be morning, evening or all" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const date = bangkokDate();
  const idempotencyKey = `sync-fixtures:v2:${date}:${session}`;

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
    .upsert(
      {
        job_name: "sync-fixtures",
        scheduled_for: new Date().toISOString(),
        status: "STARTED",
        started_at: new Date().toISOString(),
        completed_at: null,
        attempt,
        records_processed: 0,
        error_message: null,
        idempotency_key: idempotencyKey,
        details: { session, bangkokDate: date, provider: "api-football" },
      },
      { onConflict: "idempotency_key" },
    )
    .select("id")
    .single();

  if (jobError || !job) return json(500, { error: "Could not create job audit record" });

  try {
    const dates = session === "evening" || session === "all" ? [date, addDays(date, 1)] : [date];
    const dailyResponses = await Promise.all(dates.map((item) => fetchFixturesForDate(apiKey, item)));
    const sessionFixtures = selectSessionFixtures(dailyResponses.flat(), session, date);
    const fixtures = uniqueBy(
      sessionFixtures.filter(isTargetCompetition),
      (item) => String(item.fixture.id),
    );

    if (fixtures.length === 0) {
      await supabase.from("job_runs").update({
        status: "SUCCEEDED",
        completed_at: new Date().toISOString(),
        records_processed: 0,
        details: {
          session,
          bangkokDate: date,
          provider: "api-football",
          datesRequested: dates,
          fixturesReceived: dailyResponses.flat().length,
          fixturesInSessionBeforeScopeFilter: sessionFixtures.length,
          fixturesOutsideScope: sessionFixtures.length,
          fixturesSelected: 0,
        },
      }).eq("id", job.id);
      return json(200, {
        status: "SUCCEEDED",
        session,
        bangkokDate: date,
        fixturesReceived: dailyResponses.flat().length,
        fixturesInSessionBeforeScopeFilter: sessionFixtures.length,
        fixturesOutsideScope: sessionFixtures.length,
        fixturesSelected: 0,
        idempotencyKey,
      });
    }

    const { data: regions, error: regionError } = await supabase.from("regions").select("id,code");
    if (regionError || !regions) throw new Error("Could not load region reference data");
    const regionIds = new Map(regions.map((region) => [region.code, region.id]));
    const internationalRegionId = regionIds.get("INTERNATIONAL");
    if (!internationalRegionId) throw new Error("INTERNATIONAL region is missing");

    const competitionRows = uniqueBy(fixtures, (item) => String(item.league.id)).map((item) => ({
      provider: "api-football",
      provider_competition_id: String(item.league.id),
      region_id: regionIds.get(inferRegion(item.league.country)) ?? internationalRegionId,
      country: item.league.country,
      name: item.league.name,
      season_label: String(item.league.season),
      coverage_tier: targetCoverageTier(item),
      is_active: true,
    }));
    const { data: competitions, error: competitionError } = await supabase
      .from("competitions")
      .upsert(competitionRows, { onConflict: "provider,provider_competition_id" })
      .select("id,provider_competition_id");
    if (competitionError || !competitions) throw new Error(`Competition upsert failed: ${competitionError?.message ?? "unknown"}`);
    const competitionIds = new Map(competitions.map((item) => [item.provider_competition_id, item.id]));

    const teamSources = fixtures.flatMap((item) => [
      { team: item.teams.home, country: item.league.country },
      { team: item.teams.away, country: item.league.country },
    ]);
    const teamRows = uniqueBy(teamSources, (item) => String(item.team.id)).map((item) => ({
      provider: "api-football",
      provider_team_id: String(item.team.id),
      name: item.team.name,
      normalized_name: item.team.name.trim().toLocaleLowerCase("en"),
      country: item.country,
      badge_url: item.team.logo,
    }));
    const { data: teams, error: teamError } = await supabase
      .from("teams")
      .upsert(teamRows, { onConflict: "provider,provider_team_id" })
      .select("id,provider_team_id");
    if (teamError || !teams) throw new Error(`Team upsert failed: ${teamError?.message ?? "unknown"}`);
    const teamIds = new Map(teams.map((item) => [item.provider_team_id, item.id]));

    const fixtureRows = fixtures.map((item: ApiFootballFixture) => ({
      provider: "api-football",
      provider_fixture_id: String(item.fixture.id),
      competition_id: competitionIds.get(String(item.league.id)),
      home_team_id: teamIds.get(String(item.teams.home.id)),
      away_team_id: teamIds.get(String(item.teams.away.id)),
      kickoff_at: item.fixture.date,
      venue: item.fixture.venue?.name ?? null,
      status: normalizeFixtureStatus(item.fixture.status.short),
      home_score: item.goals.home,
      away_score: item.goals.away,
      regulation_result_confirmed: item.fixture.status.short === "FT",
      data_quality: fixtureDataQuality(item),
      raw_payload: item,
    }));
    const { error: fixtureError } = await supabase
      .from("fixtures")
      .upsert(fixtureRows, { onConflict: "provider,provider_fixture_id" });
    if (fixtureError) throw new Error(`Fixture upsert failed: ${fixtureError.message}`);

    await supabase.from("job_runs").update({
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
      records_processed: fixtureRows.length,
      details: {
        session,
        bangkokDate: date,
        provider: "api-football",
        datesRequested: dates,
        fixturesReceived: dailyResponses.flat().length,
        fixturesInSessionBeforeScopeFilter: sessionFixtures.length,
        fixturesOutsideScope: sessionFixtures.length - fixtureRows.length,
        fixturesSelected: fixtureRows.length,
      },
    }).eq("id", job.id);

    return json(200, {
      status: "SUCCEEDED",
      session,
      bangkokDate: date,
      fixturesReceived: dailyResponses.flat().length,
      fixturesInSessionBeforeScopeFilter: sessionFixtures.length,
      fixturesOutsideScope: sessionFixtures.length - fixtureRows.length,
      fixturesSelected: fixtureRows.length,
      idempotencyKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown synchronization error";
    await supabase.from("job_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      error_message: message,
    }).eq("id", job.id);
    return json(500, { status: "FAILED", error: message, idempotencyKey });
  }
});
