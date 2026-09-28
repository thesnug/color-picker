/** Batch diversity is a preference among visually approved candidates, never a legibility override. */
import { colorFamily, distance, toOklch } from "./color/index.js";
import { type ProductColorRecommendation } from "./recommend.js";

export interface GarmentUse {
  product: string;
  slug: string;
  name: string;
  hex: string;
}
export interface ArtworkCandidate {
  artworkId: string;
  /** Exact prepared production rendition shown in the proof. */
  renditionId: string;
  recommendation: ProductColorRecommendation;
  /** Human/contextual review of text, outlines and subject recognition. */
  legible: boolean;
  subjectRecognizable: boolean;
  /** Provider-confirmed sizes for this color, checked before selection. */
  availableSizes: readonly string[];
  /** Provenance retained with the selection for approval review. */
  sizeEvidence: { checkedAt: string; source: string };
}
export interface BatchDesign {
  id: string;
  product: string;
  candidates: readonly ArtworkCandidate[];
  /** A reviewed garment default remains selected even when frequently used. */
  defaultSlug: string;
  /** Optional assortment goals supplied by the requesting project, in priority order. */
  desiredGroups?: readonly DesiredColorGroup[];
}
export interface DesiredColorGroup {
  name: string;
  slugs?: readonly string[];
  families?: readonly string[];
  excludeSlugs?: readonly string[];
}
export interface BatchSelection {
  designId: string;
  defaultSlug: string;
  picks: ArtworkCandidate[];
  /** Caller-supplied groups that could not be filled with an eligible distinct color. */
  unfilledGroups: string[];
}

export const REQUIRED_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"] as const;

const matchesGroup = (candidate: ArtworkCandidate, group: DesiredColorGroup) => {
  const { slug, family } = candidate.recommendation.color;
  return !group.excludeSlugs?.includes(slug) && (group.slugs?.includes(slug) || group.families?.includes(family));
};

export function repetitionReport(current: readonly GarmentUse[], recent: readonly GarmentUse[] = []) {
  const summarize = (uses: readonly GarmentUse[]) => {
    const colors: Record<string, number> = {};
    const families: Record<string, number> = {};
    const lightness: Record<string, number> = {};
    const saturation: Record<string, number> = {};
    for (const use of uses) {
      const key = `${use.product}/${use.slug}`;
      colors[key] = (colors[key] ?? 0) + 1;
      const family = colorFamily(use.hex, use.name);
      families[family] = (families[family] ?? 0) + 1;
      const { l, c } = toOklch(use.hex);
      const tone = l < 0.45 ? "dark" : l > 0.8 ? "light" : "mid";
      const chroma = c < 0.04 ? "muted" : c > 0.12 ? "vivid" : "moderate";
      lightness[tone] = (lightness[tone] ?? 0) + 1;
      saturation[chroma] = (saturation[chroma] ?? 0) + 1;
    }
    const distinct = [...new Map(uses.map(u => [`${u.product}/${u.slug}`, u])).values()];
    const similar: { a: string; b: string; distance: number }[] = [];
    distinct.forEach((a, i) => distinct.slice(i + 1).forEach(b => {
      const gap = distance(a.hex, b.hex);
      if (gap < 10) similar.push({ a: `${a.product}/${a.slug}`, b: `${b.product}/${b.slug}`, distance: Number(gap.toFixed(1)) });
    }));
    return { total: uses.length, distinct: distinct.length, garments: distinct.map(u => ({ ...u, count: colors[`${u.product}/${u.slug}`] })), colors, families, lightness, saturation, similar };
  };
  return { current: summarize(current), recent: summarize(recent), combined: summarize([...recent, ...current]),
    note: "Proposal usage, not inventory. Similarity uses OKLab distance <10; variety is a preference, not a quota." };
}

/** Evaluate original and approved alternates together; always return eight or fail explicitly. */
export function selectBatchColors(designs: readonly BatchDesign[], recent: readonly GarmentUse[] = []) {
  if (designs.length === 0) throw new RangeError("Supply at least one design.");
  const uses: GarmentUse[] = [];
  const selections: BatchSelection[] = [];
  if (new Set(designs.map(d => d.id)).size !== designs.length) throw new RangeError("Design IDs must be unique.");
  for (const design of designs) {
    const groups = design.desiredGroups ?? [];
    if (groups.length > 8 || new Set(groups.map(g => g.name)).size !== groups.length || groups.some(g => !g.name.trim() || !(g.slugs?.length || g.families?.length))) {
      throw new RangeError(`${design.id}: supply at most eight uniquely named desired groups, each with slugs or families.`);
    }
    const eligible = design.candidates.filter(c => c.legible && c.subjectRecognizable && c.recommendation.color.available && c.sizeEvidence?.checkedAt && c.sizeEvidence?.source && REQUIRED_SIZES.every(size => c.availableSizes?.includes(size)));
    if (eligible.some(c => !c.artworkId.trim() || !c.renditionId.trim() || !Number.isFinite(c.recommendation.score))) {
      throw new RangeError(`${design.id}: candidates need artwork/rendition IDs and finite scores.`);
    }
    const defaults = eligible.filter(c => c.recommendation.color.slug === design.defaultSlug).sort((a,b) => b.recommendation.score-a.recommendation.score);
    if (!defaults[0]) throw new RangeError(`${design.id}: default is not a visually approved available candidate.`);
    const picks: ArtworkCandidate[] = [];
    const add = (pick: ArtworkCandidate) => {
      picks.push(pick);
      const color = pick.recommendation.color;
      uses.push({ product: design.product, slug: color.slug, name: color.name, hex: color.hex });
    };
    add(defaults[0]);
    const unfilledGroups: string[] = [];
    const score = (c: ArtworkCandidate) => {
      const color = c.recommendation.color;
      const history = [...recent, ...uses].filter(u => u.product === design.product);
      const exact = history.filter(u => u.slug === color.slug).length;
      const near = history.filter(u => u.slug !== color.slug && distance(u.hex, color.hex) < 10).length;
      const family = history.filter(u => colorFamily(u.hex, u.name) === colorFamily(color.hex, color.name)).length;
      return c.recommendation.score - 0.08 * exact - 0.04 * near - 0.01 * family;
    };
    for (const group of groups) {
      if (picks.some(p => matchesGroup(p, group))) continue;
      const options = eligible.filter(c => matchesGroup(c, group) && !picks.some(p => p.recommendation.color.slug === c.recommendation.color.slug));
      options.sort((a,b) => score(b)-score(a));
      if (!options[0] || picks.length === 8) {
        unfilledGroups.push(group.name);
        continue;
      }
      add(options[0]);
    }
    while (picks.length < 8) {
      const pool = eligible.filter(c => !picks.some(p => p.recommendation.color.slug === c.recommendation.color.slug));
      pool.sort((a,b) => score(b)-score(a));
      if (!pool[0]) throw new RangeError(`${design.id}: fewer than eight distinct visually approved colors with provider-confirmed S–3XL availability; prepare/review alternates.`);
      add(pool[0]);
    }
    selections.push({ designId: design.id, defaultSlug: design.defaultSlug, picks, unfilledGroups });
  }
  return { selections, repetition: repetitionReport(uses, recent),
    note: "Deterministic diversity selection of reviewed candidates; unfilledGroups names caller-supplied color groups without an eligible distinct pick. No mood re-ranking or recolor vetting was performed here. Approval still requires provider size, placement, rendition and proof checks." };
}
