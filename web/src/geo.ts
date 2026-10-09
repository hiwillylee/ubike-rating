import type { Position } from "./api";

/** 取得目前位置；使用者拒絕、沒有 GPS 或逾時都回傳 null */
export function getPosition(timeoutMs = 10000): Promise<Position | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    ),
  );
}

export function timeAgo(iso: string, now = Date.now()): string {
  const min = Math.floor((now - Date.parse(iso)) / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)} 小時前`;
  return `${Math.floor(min / 1440)} 天前`;
}

/** 平均分數對應的顏色（CSS 變數） */
export function levelColor(v: number): string {
  if (v >= 3.5) return "var(--good)";
  if (v >= 2.5) return "var(--ok)";
  if (v >= 1.5) return "var(--warn)";
  return "var(--bad)";
}
