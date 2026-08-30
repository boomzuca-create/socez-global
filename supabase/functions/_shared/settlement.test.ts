import { describe, expect, it } from "vitest";
import { pickStatus, profitUnits, settleMarket } from "./settlement";

describe("server settlement engine", () => {
  it("settles 1X2 from the regulation-time score", () => {
    expect(settleMarket("1X2", "HOME", null, 2, 1)).toBe("FULL_WIN");
    expect(settleMarket("1X2", "DRAW", null, 2, 1)).toBe("FULL_LOSS");
  });

  it("settles Asian Handicap quarter lines", () => {
    expect(settleMarket("AH", "HOME", -0.25, 1, 1)).toBe("HALF_LOSS");
    expect(settleMarket("AH", "AWAY", 0.25, 1, 1)).toBe("HALF_WIN");
    expect(settleMarket("AH", "HOME", -0.75, 2, 1)).toBe("HALF_WIN");
  });

  it("settles total quarter lines", () => {
    expect(settleMarket("OU", "OVER", 2.25, 1, 1)).toBe("HALF_LOSS");
    expect(settleMarket("OU", "UNDER", 2.25, 1, 1)).toBe("HALF_WIN");
    expect(settleMarket("OU", "OVER", 2.5, 2, 1)).toBe("FULL_WIN");
  });

  it("calculates flat-stake profit without changing locked odds", () => {
    expect(profitUnits("FULL_WIN", 1.9, 1)).toBeCloseTo(0.9);
    expect(profitUnits("HALF_WIN", 1.9, 1)).toBeCloseTo(0.45);
    expect(profitUnits("HALF_LOSS", 1.9, 1)).toBe(-0.5);
    expect(profitUnits("FULL_LOSS", 1.9, 1)).toBe(-1);
  });

  it("maps half outcomes to the correct public pick status", () => {
    expect(pickStatus("HALF_WIN")).toBe("WIN");
    expect(pickStatus("HALF_LOSS")).toBe("LOSS");
    expect(pickStatus("PUSH")).toBe("PUSH");
  });
});
