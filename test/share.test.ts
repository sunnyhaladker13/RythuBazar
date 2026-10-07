import { describe, expect, it } from "vitest";
import { bazarLabel } from "../src/share";

describe("bazarLabel", () => {
  it("uses a place name as is", () => {
    expect(bazarLabel("Kukatpally", "Medchal (Malkajgiri)")).toBe("Kukatpally Rythu Bazar");
  });

  it("leads with the district when the name is a spot in town", () => {
    expect(bazarLabel("Opp: Municipal Office", "Adilabad")).toBe("Adilabad Rythu Bazar (Opp: Municipal Office)");
    expect(bazarLabel("Near Rly. Gate", "Mahbubnagar")).toBe("Mahbubnagar Rythu Bazar (Near Rly. Gate)");
    expect(bazarLabel("Excise Colony", "Warangal")).toBe("Warangal Rythu Bazar (Excise Colony)");
  });

  it("drops a trailing district in brackets", () => {
    expect(bazarLabel("Ursu Premises(Nalgonda)", "Nalgonda")).toBe("Nalgonda Rythu Bazar (Ursu Premises)");
    expect(bazarLabel("III Town(Khammam)", "Khammam")).toBe("Khammam Rythu Bazar (III Town)");
  });

  it("keeps other brackets, spaced", () => {
    expect(bazarLabel("Kothagudem(P. Stdm)", "Badradri (Kothagudem)")).toBe("Kothagudem (P. Stdm) Rythu Bazar");
  });

  it("leads with the district minus its bracketed part", () => {
    expect(bazarLabel("Weekly Market Area", "Medchal (Malkajgiri)")).toBe("Medchal Rythu Bazar (Weekly Market Area)");
    expect(bazarLabel("Beet Market,Hyd Road(Nalgonda)", "Nalgonda")).toBe("Nalgonda Rythu Bazar (Beet Market,Hyd Road)");
  });
});
