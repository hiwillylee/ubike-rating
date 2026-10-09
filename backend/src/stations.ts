// YouBike 站點：從各縣市開放資料抓取，快取在 Lambda 記憶體。
// 只存站點編號，不存使用者的 GPS 座標。

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

type Source = { url: string; parse: (data: unknown) => Station[] };

const cleanName = (s: string) => s.replace(/^YouBike2\.0_/, "").trim();

const SOURCES: Source[] = [
  {
    // 臺北市
    url: "https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json",
    parse: (data) =>
      (data as { sno: string; sna: string; latitude: number; longitude: number }[]).map((s) => ({
        id: s.sno,
        name: cleanName(s.sna),
        lat: Number(s.latitude),
        lng: Number(s.longitude),
      })),
  },
  {
    // 新北市
    url: "https://data.ntpc.gov.tw/api/datasets/010e5b15-3823-4b20-b401-b1cf000550c5/json?page=0&size=5000",
    parse: (data) =>
      (data as { sno: string; sna: string; lat: string; lng: string }[]).map((s) => ({
        id: s.sno,
        name: cleanName(s.sna),
        lat: Number(s.lat),
        lng: Number(s.lng),
      })),
  },
];

const CACHE_MS = 6 * 3600_000;
let cache: { at: number; list: Station[] } | null = null;

async function fetchSource(src: Source): Promise<Station[]> {
  const res = await fetch(src.url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${src.url} ${res.status}`);
  return src.parse(await res.json()).filter((s) => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

/** 所有站點；抓取失敗時沿用舊快取，某個縣市失敗不影響其他縣市 */
export async function loadStations(): Promise<Station[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;
  const results = await Promise.allSettled(SOURCES.map(fetchSource));
  const list = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  results.forEach((r) => r.status === "rejected" && console.warn("stations", r.reason));
  if (list.length === 0) {
    if (cache) return cache.list;
    throw new Error("無法取得站點資料");
  }
  // 有縣市失敗時快取時間縮短，10 分鐘後重抓
  const partial = results.some((r) => r.status === "rejected");
  cache = { at: partial ? Date.now() - CACHE_MS + 600_000 : Date.now(), list };
  return list;
}

/** 兩點距離（公尺） */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** 半徑內最近的站點 */
export function nearestStation(
  list: Station[],
  lat: number,
  lng: number,
  maxM: number,
): { station: Station; distance: number } | null {
  let best: { station: Station; distance: number } | null = null;
  for (const s of list) {
    const d = distanceM(lat, lng, s.lat, s.lng);
    if (d <= maxM && (!best || d < best.distance)) best = { station: s, distance: Math.round(d) };
  }
  return best;
}

export const isValidCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;
