export const METRICS = ["clean", "gear", "frame"] as const;
export type Metric = (typeof METRICS)[number];

export interface Rating {
  clean: number;
  gear: number;
  frame: number;
  at: string; // ISO 時間
  userId: string;
}

export type Scores = Record<Metric, number>;

/**
 * n 筆評分的權重（索引 0 = 最新）。最新 1.0、最舊 0.5，中間等差。
 */
export function weights(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  return Array.from({ length: n }, (_, i) => 1 - (0.5 * i) / (n - 1));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * @param ratings 依時間由新到舊排序、已排除假帳號的評分
 * @param window 只取最新幾筆
 */
export function weightedScores(
  ratings: Rating[],
  window: number,
): { count: number; scores: Scores | null } {
  const used = ratings.slice(0, window);
  if (used.length === 0) return { count: 0, scores: null };

  const w = weights(used.length);
  const total = w.reduce((a, b) => a + b, 0);
  const scores = {} as Scores;
  for (const m of METRICS) {
    scores[m] = round2(used.reduce((sum, r, i) => sum + r[m] * w[i], 0) / total);
  }
  return { count: used.length, scores };
}

export function isValidScore(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 4;
}
