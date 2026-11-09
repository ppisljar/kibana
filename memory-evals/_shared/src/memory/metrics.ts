/**
 * Fraction of gold evidence sessions that were retrieved. `null` when the
 * question has no evidence (abstention), so it is excluded from averages.
 */
export const evidenceRecall = (retrieved: readonly string[], gold: readonly string[]): number | null => {
  if (gold.length === 0) return null;
  const found = new Set(retrieved);
  return gold.filter((id) => found.has(id)).length / gold.length;
};

/** Whether at least one gold evidence session was retrieved. `null` for abstention questions. */
export const evidenceHit = (retrieved: readonly string[], gold: readonly string[]): boolean | null => {
  if (gold.length === 0) return null;
  const found = new Set(retrieved);
  return gold.some((id) => found.has(id));
};

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
