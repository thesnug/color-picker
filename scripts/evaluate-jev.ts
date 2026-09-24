/**
 * Evaluate the thresholds that gate Jev's judgments against the labeled sets in
 * tests/fixtures/jev/, using the live TypeSafe API, and write a Markdown report
 * to docs/evaluations/<date>.md. See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * - Words to color: accepting the top match, at each acceptance threshold.
 * - Mood re-rank: garment order against draft picks, at each mood weight.
 * - Recolor plausibility: flagging a swap as implausible, at each cutoff.
 *
 * Manual, never in CI: it needs `TYPESAFE_API_KEY` and spends requests on a
 * cache miss. Answers land in the local Jev cache, so a rerun with the same
 * question versions is free and only rescoring happens.
 *
 *   npm run jev:evaluate
 *   npm run jev:evaluate -- --only describe,vet --no-cache --out /tmp/report.md
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { type Hex, relativeLuminance } from "../src/color/index.js";
import { loadColors } from "../src/data/index.js";
import {
  combineMood,
  DESCRIBE_COLOR_ACCEPT,
  DESCRIBE_COLOR_VERSION,
  describeToColor,
  type DescribeSet,
  MOOD_TOP,
  MOOD_VERSION,
  MOOD_WEIGHT,
  type MoodDesign,
  type MoodRerank,
  PLAUSIBILITY_THRESHOLD,
  rerankByMood,
  VET_RECOLOR_VERSION,
  vetRecolorPlans,
} from "../src/jev/index.js";
import type { RecolorMapping, RecolorPlan } from "../src/recolor.js";
import { type ProductColorRecommendation, recommendProductColors } from "../src/recommend.js";
import {
  pickByAccuracy,
  pickByPrecision,
  pickWeight,
  type Scored,
  steps,
  sweep,
  type SweepRow,
  weightRows,
} from "./jev-evaluation.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "tests", "fixtures", "jev");
const readJson = <T>(file: string) => JSON.parse(readFileSync(join(fixtures, file), "utf8")) as T;

// ---------------------------------------------------------------------------
// Arguments

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const features = new Set((flag("--only") ?? "describe,mood,vet").split(","));
const cache = argv.includes("--no-cache") ? { cache: false as const } : {};
const date = flag("--date") ?? new Date().toISOString().slice(0, 10);
const out = flag("--out") ?? join(root, "docs", "evaluations", `${date}.md`);
// Reports may contain hand-written decisions that the generator cannot reproduce.
// Reject before any Jev calls, even on a cached rerun.
if (existsSync(out)) throw new Error(`Report already exists: ${out}. Choose a new --out path; existing reports are not overwritten.`);

/** Precision the acceptance threshold must reach: a wrong answer acted on is worse than a suggestion. */
const MIN_ACCEPT_PRECISION = 0.9;

/** A confident answer, for listing confident wrong ones. */
const CONFIDENT = 0.7;

// ---------------------------------------------------------------------------
// Fixtures

interface Phrase {
  text: string;
  set: DescribeSet;
  expected: string[];
}

interface Design extends Required<MoodDesign> {
  id: string;
  palette: { hex: string; share: number; element?: string }[];
  picks: string[];
}

interface Swap {
  design: string;
  element: string;
  to: string;
  plausible: boolean;
}

const phrases = readJson<{ phrases: Phrase[] }>("describe-color.json").phrases;
const designs = readJson<{ designs: Design[] }>("designs.json").designs;
const swaps = readJson<{ swaps: Swap[] }>("recolor-swaps.json").swaps;

// ---------------------------------------------------------------------------
// Report helpers

const lines: string[] = [];
const say = (...text: string[]) => lines.push(...text);
const f2 = (v: number | null) => (v === null ? "–" : v.toFixed(2));
const pct = (v: number) => `${Math.round(v * 100)}%`;

function sweepTable(rows: readonly SweepRow[], current: number, chosen: number | undefined, label: string) {
  say(`| ${label} | TP | FP | FN | TN | Accuracy | Precision | Recall |`, "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const marks = [r.threshold === current && "current", r.threshold === chosen && "chosen"].filter(Boolean);
    const t = `${r.threshold.toFixed(2)}${marks.length ? ` (${marks.join(", ")})` : ""}`;
    say(`| ${t} | ${r.tp} | ${r.fp} | ${r.fn} | ${r.tn} | ${f2(r.accuracy)} | ${f2(r.precision)} | ${f2(r.recall)} |`);
  }
  say("");
}

let model: string | undefined;

// ---------------------------------------------------------------------------
// Words to color

async function evaluateDescribe() {
  const cases: (Scored & { phrase: Phrase; top: string; none: number; noneTop: boolean; cached: boolean })[] = [];
  const skipped: string[] = [];
  for (const phrase of phrases) {
    const result = await describeToColor(phrase.text, { set: phrase.set, ...cache });
    if (result.via !== "jev") {
      skipped.push(phrase.text);
      continue;
    }
    model ??= result.model;
    const top = result.matches[0];
    cases.push({
      phrase,
      top: result.noneTop ? "none" : (top?.color.name ?? "none"),
      // What `acceptedColor` compares with the threshold; 0 when none is Jev's top option.
      score: result.noneTop || !top ? 0 : top.probability,
      // Accepting is right only when the top color is an expected one.
      positive: top !== undefined && phrase.expected.includes(top.color.name),
      none: result.none,
      noneTop: result.noneTop,
      cached: result.cached,
    });
  }

  const rows = sweep(cases, steps(0.1, 0.8, 0.05), (score, t) => score >= t);
  const chosen = pickByPrecision(rows, MIN_ACCEPT_PRECISION);

  say(
    "## Words to color",
    "",
    `\`describeToColor\`, question version ${DESCRIBE_COLOR_VERSION}, ${cases.length} phrases sent to Jev` +
      (skipped.length ? ` (${skipped.length} resolved by name and skipped: ${skipped.join(", ")})` : "") +
      ". The decision is `acceptedColor`: take the top match when its probability clears the threshold and " +
      "`none` is not Jev's top option. A positive case is one whose top match is an expected color; a phrase " +
      "labeled `none` is correctly handled by not accepting.",
    "",
  );
  sweepTable(rows, DESCRIBE_COLOR_ACCEPT, chosen?.threshold, "Accept at");
  say(
    chosen
      ? `Lowest threshold with precision at least ${MIN_ACCEPT_PRECISION}: **${chosen.threshold.toFixed(2)}** ` +
          `(precision ${f2(chosen.precision)}, recall ${f2(chosen.recall)}).`
      : "No threshold accepted anything.",
    "",
    "| Phrase | Set | Top | Probability | None | Expected | |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const c of cases) {
    const mark = c.positive ? "ok" : c.phrase.expected.includes(c.top) ? "ok (none)" : "miss";
    say(
      `| ${c.phrase.text} | ${c.phrase.set} | ${c.top} | ${f2(c.score)} | ${f2(c.none)} | ${c.phrase.expected.join(" / ")} | ${mark} |`,
    );
  }
  say("");

  const confidentWrong = cases.filter((c) => !c.positive && c.score >= Math.min(CONFIDENT, chosen?.threshold ?? CONFIDENT));
  say("### Confident wrong answers", "");
  if (confidentWrong.length === 0) say("None.", "");
  for (const c of confidentWrong) {
    say(`- "${c.phrase.text}" → ${c.top} at ${f2(c.score)}; expected ${c.phrase.expected.join(" / ")}.`);
  }
  if (confidentWrong.length) say("");
  return { chosen: chosen?.threshold };
}

// ---------------------------------------------------------------------------
// Mood re-rank

const MOOD_WEIGHTS = steps(0, 1, 0.1);

async function evaluateMood() {
  const runs: { design: Design; order: (w: number) => string[]; shortlist: string[]; ranked: MoodRerank<ProductColorRecommendation> }[] = [];
  for (const design of designs) {
    const inkLuminance = design.palette.reduce((sum, c) => sum + c.share * relativeLuminance(c.hex), 0);
    const recs = recommendProductColors({ palette: design.palette, inkLuminance }, { n: 1000 });
    const ranked = await rerankByMood(recs, design, cache);
    if (!ranked.applied) throw new Error(`Mood was not applied for ${design.id}: ${ranked.note}`);
    model ??= ranked.model;
    runs.push({
      design,
      ranked,
      shortlist: recs.slice(0, MOOD_TOP).map((r) => r.color.name),
      order: (w) => combineMood(ranked.candidates, w).map((c) => c.color.name),
    });
  }

  const rows = weightRows(
    MOOD_WEIGHTS,
    (w) => runs.map((r) => r.order(w)),
    runs.map((r) => r.design.picks),
  );
  const chosen = pickWeight(rows);

  say(
    "## Mood re-rank",
    "",
    `\`rerankByMood\` over \`recommendProductColors\`, question version ${MOOD_VERSION}, ${runs.length} designs, ` +
      `top ${MOOD_TOP} re-ranked. Each order is scored against draft agent picks (not yet reviewed by Jill): top-1 is whether the first garment is ` +
      "a pick, P@3 the share of picks in the first three, MRR the mean of one over the first pick's position. " +
      "Weight 0 is the deterministic order.",
    "",
    "| Weight | Top-1 | P@3 | MRR |",
    "| --- | --- | --- | --- |",
  );
  for (const r of rows) {
    const marks = [r.weight === MOOD_WEIGHT && "current", r.weight === chosen?.weight && "chosen"].filter(Boolean);
    say(
      `| ${r.weight.toFixed(1)}${marks.length ? ` (${marks.join(", ")})` : ""} | ${pct(r.top1)} | ${f2(r.precisionAt3)} | ${f2(r.meanReciprocalRank)} |`,
    );
  }
  say(
    "",
    chosen ? `Best mean reciprocal rank at weight **${chosen.weight.toFixed(1)}**.` : "",
    "",
    "| Design | Draft picks in shortlist | Deterministic top 3 | Top 3 at chosen weight | Jev on draft picks |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const r of runs) {
    const inShortlist = r.design.picks.filter((p) => r.shortlist.includes(p));
    const onPicks = r.ranked.candidates
      .filter((c) => r.design.picks.includes(c.color.name) && c.moodLevel)
      .map((c) => `${c.color.name} ${c.moodLevel}`)
      .join(", ");
    say(
      `| ${r.design.id} | ${inShortlist.length}/${r.design.picks.length} | ${r.order(0).slice(0, 3).join(", ")} | ` +
        `${r.order(chosen?.weight ?? MOOD_WEIGHT).slice(0, 3).join(", ")} | ${onPicks || "–"} |`,
    );
  }
  say("");

  // Garments Jev rated highly and confidently that are not in the draft picks.
  say("### Confident wrong answers", "", "Shortlisted garments Jev rated _elevates_ with confidence at least " +
    `${CONFIDENT} that are not among the draft picks, and draft picks Jev rated _clashes_.`, "");
  let any = false;
  for (const r of runs) {
    for (const c of r.ranked.candidates) {
      if (c.moodLevel === null || c.confidence === null) continue;
      const picked = r.design.picks.includes(c.color.name);
      if ((!picked && c.moodLevel === "elevates" && c.confidence >= CONFIDENT) || (picked && c.moodLevel === "clashes")) {
        any = true;
        say(`- ${r.design.id}: ${c.color.name} rated ${c.moodLevel} (${f2(c.moodScore)}, confidence ${f2(c.confidence)})${picked ? ", but it is a pick" : ""}.`);
      }
    }
  }
  say(any ? "" : "None.", "");
  return { chosen: chosen?.weight };
}

// ---------------------------------------------------------------------------
// Recolor plausibility

async function evaluateVet() {
  const wada = new Map(loadColors().map((c) => [c.name, c]));
  const cases: (Scored & { swap: Swap; question: string })[] = [];
  for (const design of designs) {
    const mine = swaps.filter((s) => s.design === design.id);
    if (mine.length === 0) continue;
    const mapping: RecolorMapping[] = mine.map((s) => {
      const from = design.palette.find((p) => p.element === s.element);
      const to = wada.get(s.to);
      if (!from || !to) throw new Error(`Unknown element or Wada color in swap ${JSON.stringify(s)}`);
      return {
        from: { hex: from.hex as Hex, share: from.share, element: s.element },
        to: { index: to.index, name: to.name, hex: to.hex as Hex },
      };
    });
    // The production path, with one plan holding all of the design's labeled swaps.
    const plan = { mapping, reasons: [] } as unknown as RecolorPlan;
    const result = await vetRecolorPlans([plan], design, cache);
    if (result.skipped) throw new Error(`Swaps were not vetted for ${design.id}: ${result.skipped.note}`);
    model ??= result.model;
    result.plans[0]!.mapping.forEach((m, i) => {
      const swap = mine[i]!;
      // Positive is the flag: a swap that should be caught as implausible.
      cases.push({ swap, score: m.plausibility ?? 1, positive: !swap.plausible, question: `${swap.element} → ${swap.to}` });
    });
  }

  const rows = sweep(cases, steps(0.1, 0.8, 0.05), (score, t) => score < t);
  const chosen = pickByAccuracy(rows);

  say(
    "## Recolor plausibility",
    "",
    `\`vetRecolorPlans\`, question version ${VET_RECOLOR_VERSION}, ${cases.length} labeled swaps. A swap is flagged ` +
      "implausible when its Noul probability is below the cutoff; a positive case is one labeled implausible. " +
      "Each design's swaps were sent as one plan, so one request per design.",
    "",
  );
  sweepTable(rows, PLAUSIBILITY_THRESHOLD, chosen?.threshold, "Flag below");
  say(
    chosen
      ? `Most accurate cutoff: **${chosen.threshold.toFixed(2)}** (accuracy ${f2(chosen.accuracy)}, ` +
          `precision ${f2(chosen.precision)}, recall ${f2(chosen.recall)}).`
      : "",
    "",
    "| Design | Swap | Label | Plausibility |",
    "| --- | --- | --- | --- |",
  );
  for (const c of cases) {
    say(`| ${c.swap.design} | ${c.question} | ${c.swap.plausible ? "plausible" : "implausible"} | ${f2(c.score)} |`);
  }
  say("");

  const confidentWrong = cases.filter((c) => (c.positive ? c.score >= CONFIDENT : c.score <= 1 - CONFIDENT));
  say("### Confident wrong answers", "", `Swaps Jev judged at least ${CONFIDENT} the wrong way.`, "");
  if (confidentWrong.length === 0) say("None.");
  for (const c of confidentWrong) {
    say(`- ${c.swap.design}: ${c.question} labeled ${c.swap.plausible ? "plausible" : "implausible"}, Jev ${f2(c.score)}.`);
  }
  say("");
  return { chosen: chosen?.threshold };
}

// ---------------------------------------------------------------------------

const results: Record<string, number | undefined> = {};
if (features.has("describe")) results.DESCRIBE_COLOR_ACCEPT = (await evaluateDescribe()).chosen;
if (features.has("mood")) results.MOOD_WEIGHT = (await evaluateMood()).chosen;
if (features.has("vet")) results.PLAUSIBILITY_THRESHOLD = (await evaluateVet()).chosen;

const current: Record<string, number> = { DESCRIBE_COLOR_ACCEPT, MOOD_WEIGHT, PLAUSIBILITY_THRESHOLD };
const header = [
  `# Jev threshold evaluation, ${date}`,
  "",
  `Generated by \`npm run jev:evaluate\` (scripts/evaluate-jev.ts) against ${model ?? "Jev"}, on the labeled sets in ` +
    "`tests/fixtures/jev/`. Numbers from a set this small move with one case; read them as direction, not " +
    "precision. See INT-2273.",
  "",
  "| Constant | Current | Measured best |",
  "| --- | --- | --- |",
  ...Object.entries(results).map(([name, v]) => `| \`${name}\` | ${current[name]} | ${v ?? "–"} |`),
  "",
];

mkdirSync(dirname(out), { recursive: true });
// Exclusive creation closes the race between the preflight and writing the report.
writeFileSync(out, `${[...header, ...lines].join("\n").trimEnd()}\n`, { flag: "wx" });
console.log(`Wrote ${relative(process.cwd(), out)}`);
for (const [name, v] of Object.entries(results)) console.log(`${name}: current ${current[name]}, measured ${v ?? "–"}`);
