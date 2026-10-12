import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MANIFEST } from "../../scripts/make-engine-fixtures.js";
import { ENGINE_FIXTURES, readManifest, staleFixtures, type ExpectedOutputs } from "../../scripts/record-engine-fixtures.js";
import { ENGINE_VERSION, LEGIBILITY_PROTOCOL } from "../../src/engine/index.js";

describe("recorded engine fixtures", () => {
  it("list every fixture the generator draws", () => {
    expect(readManifest()).toEqual(MANIFEST);
    // At least one is wider than the 1024 px sample and is measured with its content bounds.
    expect(MANIFEST.fixtures.some((f) => f.contentBounds !== null)).toBe(true);
  });

  it("match what the MCP tools answer now, under the current engine version", async () => {
    expect(await staleFixtures()).toEqual([]);
    for (const fixture of MANIFEST.fixtures) {
      const expected = JSON.parse(readFileSync(join(ENGINE_FIXTURES, fixture.expected), "utf8")) as ExpectedOutputs;
      expect(expected).toMatchObject({ engineVersion: ENGINE_VERSION, protocol: LEGIBILITY_PROTOCOL, fixture: fixture.file });
    }
  }, 60_000);

  it("record the incident's two disagreements the right way round", () => {
    const read = (file: string) =>
      JSON.parse(readFileSync(join(ENGINE_FIXTURES, file.replace(/\.png$/, ".expected.json")), "utf8")) as ExpectedOutputs;
    const pass = (e: ExpectedOutputs, color: string) => e.verdicts.find((v) => v.colorName === color)!.pass;
    const lettering = read("two-tone-lettering.png");
    for (const pastel of ["Ivory", "White", "Butter", "Blossom", "Navy"]) expect(pass(lettering, pastel), pastel).toBe(false);
    for (const dark of ["Black", "True Navy"]) expect(pass(lettering, dark), dark).toBe(true);
    expect(lettering.ranking.slice(0, 2).map((r) => r.colorName).sort()).toEqual(["Black", "True Navy"]);
    const outlined = read("outlined-fill.png");
    for (const light of ["Ivory", "White", "Butter", "Blossom"]) expect(pass(outlined, light), light).toBe(true);
    expect(pass(outlined, "Navy")).toBe(false);
  });

  it("record the study's order over the original and its options: the original first, repaints last", () => {
    for (const fixture of ["two-tone-lettering.png", "distressed-lettering.png"]) {
      const { pairs, artworkOptions } = JSON.parse(
        readFileSync(join(ENGINE_FIXTURES, fixture.replace(/\.png$/, ".expected.json")), "utf8"),
      ) as ExpectedOutputs;
      expect(artworkOptions.options.map((o) => o.source), fixture).toEqual(["legible-ink", "wada", "wada"]);
      expect(new Set(pairs.map((p) => p.artworkId)), fixture).toEqual(
        new Set(["original", ...artworkOptions.options.map((o) => o.plan.key)]),
      );
      const leads = pairs.filter((p, i) => pairs.findIndex((q) => q.colorName === p.colorName) === i);
      expect(leads.slice(0, 2).map((p) => [p.colorName, p.artworkId]).sort(), fixture).toEqual([
        ["Black", "original"],
        ["True Navy", "original"],
      ]);
      const order = { original: 0, "legible-ink": 1, wada: 2 } as const;
      expect(leads.map((p) => order[p.source]), fixture).toEqual(leads.map((p) => order[p.source]).sort());
      expect(leads.slice(0, artworkOptions.colorCount + 1).some((p) => p.source === "wada"), fixture).toBe(false);
    }
  });
});
