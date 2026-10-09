import type { Scores } from "./score.js";
import type { Station } from "./stations.js";

/** 地圖用：每個站點記錄「最後在這裡還車」的車和當時的分數 */
export interface BikeAtStation {
  scores: Scores;
  at: string; // 在這站還車的時間
}

export interface StationBikes extends Station {
  bikes: Record<string, BikeAtStation>;
}

export interface StationSummary extends Station {
  count: number;
  scores: Scores;
  avg: number;
  excellent: { id: string; at: string; scores: Scores }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (s: Scores) => (s.clean + s.gear + s.frame) / 3;

export const isExcellent = (s: Scores, min: number) => s.clean >= min && s.gear >= min && s.frame >= min;

/** 彙整各站：只算最近 maxAgeDays 天內在該站還車的車 */
export function summarize(
  items: StationBikes[],
  now: Date,
  maxAgeDays: number,
  excellentMin: number,
): StationSummary[] {
  const since = now.getTime() - maxAgeDays * 86400_000;
  const out: StationSummary[] = [];
  for (const { bikes, ...st } of items) {
    const fresh = Object.entries(bikes ?? {}).filter(([, b]) => Date.parse(b.at) >= since);
    if (fresh.length === 0) continue;
    const sum = { clean: 0, gear: 0, frame: 0 };
    for (const [, b] of fresh) {
      sum.clean += b.scores.clean;
      sum.gear += b.scores.gear;
      sum.frame += b.scores.frame;
    }
    const n = fresh.length;
    const scores = { clean: round2(sum.clean / n), gear: round2(sum.gear / n), frame: round2(sum.frame / n) };
    out.push({
      ...st,
      count: n,
      scores,
      avg: round2(mean(scores)),
      excellent: fresh
        .filter(([, b]) => isExcellent(b.scores, excellentMin))
        .sort(([, a], [, b]) => b.at.localeCompare(a.at))
        .map(([id, b]) => ({ id, at: b.at, scores: b.scores })),
    });
  }
  return out;
}
