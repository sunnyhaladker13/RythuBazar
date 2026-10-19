import { describe, expect, it } from "vitest";
import { bazarLabel, branchName, branchSlug, shortName, withSlugs } from "../src/branches";

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
    expect(bazarLabel("Beet Market,Hyd Road(Nalgonda)", "Nalgonda")).toBe("Nalgonda Rythu Bazar (Beet Market, Hyd Road)");
  });
});

// Every branch rbzts listed in Oct 2026: [id, name, district, expected slug].
const BRANCHES: [number, string, string, string][] = [
  [98, "Opp: Municipal Office", "Adilabad", "adilabad-municipal-office"],
  [108, "Kothagudem(P. Stdm)", "Badradri (Kothagudem)", "kothagudem-p-stdm"],
  [124, "Palvancha", "Badradri (Kothagudem)", "palvancha"],
  [91, "Erragadda", "Hyderabad", "erragadda"],
  [90, "Falaknama", "Hyderabad", "falaknama"],
  [83, "Mehdipatnam", "Hyderabad", "mehdipatnam"],
  [102, "Kashmir Gadda Area", "Karimnagar", "karimnagar-kashmir-gadda-area"],
  [101, "Weekly Market Area", "Karimnagar", "karimnagar-weekly-market-area"],
  [136, "III Town(Khammam)", "Khammam", "khammam-iii-town"],
  [135, "Madhira", "Khammam", "madhira"],
  [107, "Pavilian Ground", "Khammam", "khammam-pavilian-ground"],
  [109, "Sathupally(Ramalayam)", "Khammam", "sathupally-ramalayam"],
  [123, "Yellandu", "Khammam", "yellandu"],
  [131, "Badepally", "Mahbubnagar", "badepally"],
  [82, "Near Rly. Gate", "Mahbubnagar", "mahbubnagar-rly-gate"],
  [94, "Medak Town", "Medak", "medak-town"],
  [88, "Alwal", "Medchal (Malkajgiri)", "alwal"],
  [84, "Kukatpally", "Medchal (Malkajgiri)", "kukatpally"],
  [125, "Medchal", "Medchal (Malkajgiri)", "medchal"],
  [89, "Ramakrishnapuram", "Medchal (Malkajgiri)", "ramakrishnapuram"],
  [127, "Yellammabanda", "Medchal (Malkajgiri)", "yellammabanda"],
  [116, "Nagarkurnool", "Nagarkurnool", "nagarkurnool"],
  [128, "Beet Market,Hyd Road(Nalgonda)", "Nalgonda", "nalgonda-beet-market-hyd-road"],
  [111, "Miryalaguda(NSP Camp)", "Nalgonda", "miryalaguda-nsp-camp"],
  [110, "Ursu Premises(Nalgonda)", "Nalgonda", "nalgonda-ursu-premises"],
  [130, "Narayanpet", "Narayanpet", "narayanpet"],
  [97, "NGOs Colony", "Nizamabad", "nizamabad-ngos-colony"],
  [96, "Pullanga X Road", "Nizamabad", "nizamabad-pullanga-x-road"],
  [140, "Chevella", "Rangareddy", "chevella"],
  [85, "Saroornagar", "Rangareddy", "saroornagar"],
  [86, "Vanasthalipuram", "Rangareddy", "vanasthalipuram"],
  [137, "Jogipet", "Sanga Reddy", "jogipet"],
  [141, "Narayankhed", "Sanga Reddy", "narayankhed"],
  [95, "Siddipet Town", "Siddipet", "siddipet-town"],
  [112, "Kodad", "Suryapet", "kodad"],
  [113, "Suryapet", "Suryapet", "suryapet"],
  [122, "Vikarabad", "Vikarabad", "vikarabad"],
  [104, "Excise Colony", "Warangal", "warangal-excise-colony"],
  [106, "Laxmipuram (M.Y.)", "Warangal", "laxmipuram-my"],
  [114, "Bhongir", "Yadadri (Bhongir)", "bhongir"],
];

describe("branch slugs", () => {
  it("gives every live branch a readable, unique slug", () => {
    const list = withSlugs(BRANCHES.map(([id, name, district]) => ({ id, name, district })));
    expect(list.map((m) => m.slug)).toEqual(BRANCHES.map((b) => b[3]));
    expect(new Set(list.map((m) => m.slug)).size).toBe(BRANCHES.length);
  });

  it("only uses URL-safe characters", () => {
    for (const [, name, district] of BRANCHES) expect(branchSlug(name, district)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps a slug two branches would share apart with the id", () => {
    const list = withSlugs([
      { id: 1, name: "Kukatpally", district: "Medchal (Malkajgiri)" },
      { id: 2, name: "Kukatpally", district: "Hyderabad" },
    ]);
    expect(list.map((m) => m.slug)).toEqual(["kukatpally-1", "kukatpally-2"]);
  });
});

describe("branch names", () => {
  it("leads a spot in town with its place, so it stands alone", () => {
    expect(branchName("Opp: Municipal Office", "Adilabad")).toBe("Adilabad (Opp: Municipal Office)");
    expect(branchName("Kukatpally", "Medchal (Malkajgiri)")).toBe("Kukatpally");
    expect(branchName("Miryalaguda(NSP Camp)", "Nalgonda")).toBe("Miryalaguda (NSP Camp)");
  });

  it("drops the district inside a district's own list", () => {
    expect(shortName("Ursu Premises(Nalgonda)", "Nalgonda")).toBe("Ursu Premises");
    expect(shortName("Beet Market,Hyd Road(Nalgonda)", "Nalgonda")).toBe("Beet Market, Hyd Road");
  });
});
