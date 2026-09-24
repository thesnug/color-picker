import { NONE_LABEL, type DescribeByJev } from "../src/jev/index.js";

/** Rank every Choice option, including `none`, before scoring an expected answer. */
export function scoreDescribeColor(result: DescribeByJev, expected: readonly string[]) {
  const ranked = [
    ...result.matches.map((match) => ({ name: match.color.name, probability: match.probability })),
    { name: NONE_LABEL, probability: result.none },
  ].sort((a, b) => {
    const byProbability = b.probability - a.probability;
    if (byProbability !== 0 || !result.noneTop) return byProbability;
    // If probabilities tie, preserve Jev's selected top option.
    return Number(b.name === NONE_LABEL) - Number(a.name === NONE_LABEL);
  });

  return {
    top1: expected.includes(ranked[0]!.name),
    top3: ranked.slice(0, 3).some(({ name }) => expected.includes(name)),
  };
}
