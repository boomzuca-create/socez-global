import { describe, expect, it } from "vitest";
import { settleAsianHandicap, settleOneXTwo, settleTotal } from "./settlement";

describe("settlement engine", () => {
  it("settles 1X2 using regulation-time score", () => {
    expect(settleOneXTwo("HOME", 2, 1)).toBe("FULL_WIN");
    expect(settleOneXTwo("DRAW", 2, 1)).toBe("FULL_LOSS");
  });

  it("settles Asian handicap quarter lines", () => {
    expect(settleAsianHandicap("HOME", -0.25, 1, 1)).toBe("HALF_LOSS");
    expect(settleAsianHandicap("AWAY", 0.25, 1, 1)).toBe("HALF_WIN");
    expect(settleAsianHandicap("HOME", -0.75, 2, 1)).toBe("HALF_WIN");
  });

  it("settles total quarter lines", () => {
    expect(settleTotal("OVER", 2.25, 1, 1)).toBe("HALF_LOSS");
    expect(settleTotal("UNDER", 2.25, 1, 1)).toBe("HALF_WIN");
    expect(settleTotal("OVER", 2.5, 2, 1)).toBe("FULL_WIN");
  });
});
