/**
 * Report describeToColor's top-1 and top-3 accuracy on the labeled phrases in
 * tests/fixtures/jev/describe-color.json, against the live TypeSafe API.
 *
 * Manual, never in CI: it needs `TYPESAFE_API_KEY` and spends requests on a
 * cache miss. Answers are cached in the local Jev cache, so a rerun with the
 * same question version is free.
 *
 *   npm run jev:describe:evaluate
 *   npm run jev:describe:evaluate -- --no-cache
 */

import { readFileSync } from "node:fs";

import { describeToColor, type DescribeSet } from "../src/jev/index.js";
import { scoreDescribeColor } from "./score-describe-color.js";

interface Phrase {
  text: string;
  set: DescribeSet;
  expected: string[];
}

const fixture = JSON.parse(
  readFileSync(new URL("../tests/fixtures/jev/describe-color.json", import.meta.url), "utf8"),
) as { phrases: Phrase[] };
const cache = process.argv.includes("--no-cache") ? false : undefined;

let top1 = 0;
let top3 = 0;
const rows: string[] = [];

for (const phrase of fixture.phrases) {
  const result = await describeToColor(phrase.text, { set: phrase.set, ...(cache === false ? { cache } : {}) });
  if (result.via !== "jev") {
    rows.push(`SKIP  ${phrase.text}: resolved by name, so not a Jev case`);
    continue;
  }
  const { top1: hit1, top3: hit3 } = scoreDescribeColor(result, phrase.expected);
  if (hit1) top1 += 1;
  if (hit3) top3 += 1;

  const answers = result.matches.map((m) => `${m.color.name} ${m.probability.toFixed(2)}`).join(", ");
  const mark = hit1 ? "ok   " : hit3 ? "top3 " : "MISS ";
  rows.push(
    `${mark} ${phrase.set.padEnd(7)} ${JSON.stringify(phrase.text)} -> ${answers}; none ${result.none.toFixed(2)}, ` +
      `confidence ${result.confidence.toFixed(2)}${result.cached ? ", cached" : ""}` +
      (hit1 ? "" : `; expected ${phrase.expected.join(" / ")}`),
  );
}

const n = fixture.phrases.length;
console.log(rows.join("\n"));
console.log(`\ntop-1 ${top1}/${n} (${((100 * top1) / n).toFixed(0)}%), top-3 ${top3}/${n} (${((100 * top3) / n).toFixed(0)}%)`);
