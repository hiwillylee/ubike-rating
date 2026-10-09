import { describe, expect, it } from "vitest";
import { summarize } from "../src/map.js";
import { distanceM, nearestStation } from "../src/stations.js";

const st = { id: "500101001", name: "捷運科技大樓站", lat: 25.02605, lng: 121.5436 };
const now = new Date("2026-10-09T00:00:00Z");
const s = (clean: number, gear: number, frame: number) => ({ clean, gear, frame });

describe("summarize", () => {
  it("平均各車分數，挑出三項都 >= 門檻的極品車", () => {
    const [r] = summarize(
      [
        {
          ...st,
          bikes: {
            "1111111": { scores: s(4, 4, 3.6), at: "2026-10-08T10:00:00Z" },
            "2222222": { scores: s(2, 3, 4), at: "2026-10-08T11:00:00Z" },
            "3333333": { scores: s(3.5, 3.5, 3.5), at: "2026-10-08T12:00:00Z" },
          },
        },
      ],
      now,
      7,
      3.5,
    );
    expect(r.count).toBe(3);
    expect(r.scores).toEqual({ clean: 3.17, gear: 3.5, frame: 3.7 });
    expect(r.excellent.map((b) => b.id)).toEqual(["3333333", "1111111"]); // 新的在前
  });

  it("太久以前的位置不算，沒有車的站不回傳", () => {
    const out = summarize(
      [
        { ...st, bikes: { "1111111": { scores: s(4, 4, 4), at: "2026-09-01T00:00:00Z" } } },
        { ...st, id: "x", bikes: {} },
      ],
      now,
      7,
      3.5,
    );
    expect(out).toEqual([]);
  });
});

describe("nearestStation", () => {
  const list = [st, { id: "b", name: "B", lat: 25.03, lng: 121.5436 }];
  it("回傳半徑內最近的站", () => {
    const m = nearestStation(list, 25.0261, 121.5437, 100);
    expect(m?.station.id).toBe("500101001");
    expect(m!.distance).toBeLessThan(20);
  });
  it("超出半徑回傳 null", () => {
    expect(nearestStation(list, 25.028, 121.5436, 100)).toBeNull();
  });
  it("距離計算", () => {
    expect(Math.round(distanceM(25, 121.5, 25.001, 121.5))).toBe(111);
  });
});
