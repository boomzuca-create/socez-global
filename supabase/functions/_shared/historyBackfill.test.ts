import { describe, expect, it } from "vitest";
import { fetchHistoryBackfillBestEffort, selectHistoryBackfillDates } from "./historyBackfill";

describe("history backfill quota", () => {
  it("selects at most eight recent unsynchronized Bangkok dates", () => {
    expect(selectHistoryBackfillDates("2026-08-31", [])).toEqual([
      "2026-08-30", "2026-08-29", "2026-08-28", "2026-08-27",
      "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23",
    ]);
  });

  it("continues with older missing dates on the next successful run", () => {
    const seen = [
      "2026-08-30", "2026-08-29", "2026-08-28", "2026-08-27",
      "2026-08-26", "2026-08-25", "2026-08-24", "2026-08-23",
    ];
    expect(selectHistoryBackfillDates("2026-09-01", seen).slice(0, 3)).toEqual([
      "2026-08-31", "2026-08-22", "2026-08-21",
    ]);
  });

  it("never re-requests dates already recorded as successful", () => {
    const selected = selectHistoryBackfillDates("2026-08-31", ["2026-08-30", "2026-08-28"], 3);
    expect(selected).toEqual(["2026-08-29", "2026-08-27", "2026-08-26"]);
  });

  it("supports a free-plan daily accumulation window", () => {
    expect(selectHistoryBackfillDates("2026-08-31", [], 1, 1)).toEqual(["2026-08-30"]);
    expect(selectHistoryBackfillDates("2026-08-31", ["2026-08-30"], 1, 1)).toEqual([]);
  });

  it("keeps successful history when another provider date is rejected", async () => {
    const result = await fetchHistoryBackfillBestEffort(
      ["2026-08-30", "2026-08-29"],
      async (date) => {
        if (date === "2026-08-29") throw new Error("Free plan date unavailable");
        return [`fixture:${date}`];
      },
    );

    expect(result).toEqual({
      responses: [["fixture:2026-08-30"]],
      succeededDates: ["2026-08-30"],
      failures: [{ date: "2026-08-29", error: "Free plan date unavailable" }],
    });
  });
});
