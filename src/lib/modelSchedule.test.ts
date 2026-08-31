import { describe, expect, it } from "vitest";
import { nextModelRun } from "./modelSchedule";

describe("Bangkok model schedule", () => {
  it("shows 11:00 before the morning run", () => {
    expect(nextModelRun(new Date("2026-08-30T23:30:00Z"))).toBe("11:00");
  });

  it("shows 18:00 after the morning run", () => {
    expect(nextModelRun(new Date("2026-08-31T05:00:00Z"))).toBe("18:00");
  });

  it("returns to 11:00 after the evening run", () => {
    expect(nextModelRun(new Date("2026-08-31T12:00:00Z"))).toBe("11:00");
  });
});
