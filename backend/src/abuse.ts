import type { Config } from "./config.js";
import type { Rating } from "./score.js";

/** 防濫用邏輯需要的儲存操作；正式環境用 DynamoDB 實作，測試用記憶體實作。 */
export interface AbuseStore {
  isSuspect(userId: string): Promise<boolean>;
  /** 同帳號對同台車的冷卻是否仍有效 */
  cooldownActive(userId: string, bikeId: string, nowSec: number): Promise<boolean>;
  /** 每分鐘計數 +1；若已達上限則不增加並回傳 false */
  incrMinute(userId: string, minuteKey: string, limit: number, ttl: number): Promise<boolean>;
  /** 記一次限流違規，回傳該小時累計次數 */
  recordViolation(userId: string, hourKey: string, ttl: number): Promise<number>;
  /** 每日計數 +1，回傳累計 */
  incrDay(userId: string, dayKey: string, ttl: number): Promise<number>;
  markSuspect(userId: string, reason: string, nowIso: string): Promise<void>;
  /** 寫入評分與冷卻紀錄；若冷卻已存在（併發）回傳 false */
  saveRating(bikeId: string, rating: Rating, cooldownTtl: number, nowSec: number): Promise<boolean>;
  dayCount(userId: string, dayKey: string): Promise<number>;
}

export type SubmitResult =
  | { status: 201 }
  | { status: 403 | 409 | 429; error: string; message: string };

// 用台灣時間（UTC+8）切分鐘、小時、日
function twParts(now: Date) {
  const s = new Date(now.getTime() + 8 * 3600_000).toISOString(); // yyyy-mm-ddThh:mm
  const d = s.slice(0, 10).replace(/-/g, "");
  return { day: d, hour: d + s.slice(11, 13), minute: d + s.slice(11, 13) + s.slice(14, 16) };
}

export const timeKeys = twParts;

export async function submitRating(
  store: AbuseStore,
  cfg: Config,
  userId: string,
  bikeId: string,
  scores: { clean: number; gear: number; frame: number },
  now: Date = new Date(),
): Promise<SubmitResult> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const nowIso = now.toISOString();
  const keys = twParts(now);

  if (await store.isSuspect(userId)) {
    return { status: 403, error: "suspect", message: "此帳號因打分頻率異常已被停權" };
  }

  if (await store.cooldownActive(userId, bikeId, nowSec)) {
    return {
      status: 409,
      error: "cooldown",
      message: `同一台車 ${cfg.sameBikeCooldownMinutes} 分鐘內只能評一次`,
    };
  }

  const okMinute = await store.incrMinute(userId, keys.minute, cfg.perMinuteLimit, nowSec + 120);
  if (!okMinute) {
    const v = await store.recordViolation(userId, keys.hour, nowSec + 7200);
    if (v >= cfg.hourlyViolationThreshold) {
      await store.markSuspect(userId, `1 小時內觸發限流 ${v} 次`, nowIso);
    }
    return { status: 429, error: "rate_limited", message: `每分鐘最多評 ${cfg.perMinuteLimit} 筆` };
  }

  const daily = await store.incrDay(userId, keys.day, nowSec + 2 * 86400);
  if (daily > cfg.dailySuspectThreshold) {
    await store.markSuspect(userId, `單日評分 ${daily} 筆`, nowIso);
    return { status: 403, error: "suspect", message: "此帳號因打分頻率異常已被停權" };
  }

  const saved = await store.saveRating(
    bikeId,
    { ...scores, at: nowIso, userId },
    nowSec + cfg.sameBikeCooldownMinutes * 60,
    nowSec,
  );
  if (!saved) {
    return {
      status: 409,
      error: "cooldown",
      message: `同一台車 ${cfg.sameBikeCooldownMinutes} 分鐘內只能評一次`,
    };
  }
  return { status: 201 };
}
