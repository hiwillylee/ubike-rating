import { beforeEach, describe, expect, it } from "vitest";
import { submitRating, type AbuseStore } from "../src/abuse.js";
import { config } from "../src/config.js";
import type { Rating } from "../src/score.js";

class MemoryStore implements AbuseStore {
  counters = new Map<string, number>();
  cooldowns = new Map<string, number>();
  suspects = new Map<string, string>();
  ratings: { bikeId: string; rating: Rating }[] = [];

  async isSuspect(u: string) {
    return this.suspects.has(u);
  }
  async cooldownActive(u: string, b: string, now: number) {
    return (this.cooldowns.get(`${u}|${b}`) ?? 0) > now;
  }
  async incrMinute(u: string, k: string, limit: number) {
    const key = `MIN|${u}|${k}`;
    const n = this.counters.get(key) ?? 0;
    if (n >= limit) return false;
    this.counters.set(key, n + 1);
    return true;
  }
  private incr(key: string) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return n;
  }
  async recordViolation(u: string, k: string) {
    return this.incr(`VIOL|${u}|${k}`);
  }
  async incrDay(u: string, k: string) {
    return this.incr(`DAY|${u}|${k}`);
  }
  async dayCount(u: string, k: string) {
    return this.counters.get(`DAY|${u}|${k}`) ?? 0;
  }
  async markSuspect(u: string, reason: string) {
    this.suspects.set(u, reason);
  }
  async saveRating(bikeId: string, rating: Rating, ttl: number, now: number) {
    if (await this.cooldownActive(rating.userId, bikeId, now)) return false;
    this.cooldowns.set(`${rating.userId}|${bikeId}`, ttl);
    this.ratings.push({ bikeId, rating });
    return true;
  }
}

const S = { clean: 3, gear: 3, frame: 3 };
const t0 = new Date("2026-10-08T04:00:00Z");
const at = (sec: number) => new Date(t0.getTime() + sec * 1000);
const bike = (i: number) => String(1000000 + i);

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

describe("submitRating", () => {
  it("accepts a normal rating", async () => {
    expect(await submitRating(store, config, "u1", bike(1), S, t0)).toEqual({ status: 201 });
    expect(store.ratings).toHaveLength(1);
  });

  it("blocks re-rating the same bike within cooldown, allows after", async () => {
    await submitRating(store, config, "u1", bike(1), S, t0);
    expect((await submitRating(store, config, "u1", bike(1), S, at(60))).status).toBe(409);
    const after = config.sameBikeCooldownMinutes * 60 + 1;
    expect((await submitRating(store, config, "u1", bike(1), S, at(after))).status).toBe(201);
  });

  it("other users can rate the same bike", async () => {
    await submitRating(store, config, "u1", bike(1), S, t0);
    expect((await submitRating(store, config, "u2", bike(1), S, at(1))).status).toBe(201);
  });

  it("limits ratings per minute", async () => {
    for (let i = 0; i < config.perMinuteLimit; i++) {
      expect((await submitRating(store, config, "u1", bike(i), S, at(i))).status).toBe(201);
    }
    expect((await submitRating(store, config, "u1", bike(99), S, at(10))).status).toBe(429);
    // 下一分鐘恢復
    expect((await submitRating(store, config, "u1", bike(99), S, at(61))).status).toBe(201);
  });

  it("marks account suspect after repeated rate-limit violations within an hour", async () => {
    let n = 0;
    for (let minute = 0; minute < config.hourlyViolationThreshold; minute++) {
      for (let i = 0; i <= config.perMinuteLimit; i++) {
        await submitRating(store, config, "spam", bike(n++), S, at(minute * 60 + i));
      }
    }
    expect(store.suspects.has("spam")).toBe(true);
    expect((await submitRating(store, config, "spam", bike(n), S, at(3000))).status).toBe(403);
  });

  it("marks account suspect when daily count exceeds threshold", async () => {
    // 每分鐘打滿但不超過限制，一天內累積超過門檻
    let n = 0;
    let last = 0;
    for (let minute = 0; n <= config.dailySuspectThreshold; minute++) {
      for (let i = 0; i < config.perMinuteLimit && n <= config.dailySuspectThreshold; i++) {
        last = (await submitRating(store, config, "busy", bike(n++), S, at(minute * 60 + i))).status;
      }
    }
    expect(last).toBe(403);
    expect(store.suspects.get("busy")).toMatch(/單日/);
    expect(store.ratings.filter((r) => r.rating.userId === "busy")).toHaveLength(
      config.dailySuspectThreshold,
    );
  });
});
