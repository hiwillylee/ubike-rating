import { getIdToken } from "./auth";
import { API_URL, type Scores } from "./config";

export interface StationRef {
  id: string;
  name: string;
}

export interface BikeInfo {
  id: string;
  count: number;
  scores: Scores | null;
  recent: (Scores & { at: string })[];
  /** 最後一次有定位的還車站點 */
  location: { station: StationRef; at: string } | null;
}

export type NearStation = (StationRef & { distance: number }) | null;

export interface Position {
  lat: number;
  lng: number;
}

export interface StationSummary extends StationRef {
  lat: number;
  lng: number;
  count: number;
  scores: Scores;
  avg: number;
  excellent: { id: string; at: string; scores: Scores }[];
}

export interface MapData {
  excellentMin: number;
  maxAgeDays: number;
  stations: StationSummary[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const token = await getIdToken();
    if (!token) throw new ApiError(401, "unauthorized", "請先登入");
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers });
  } catch {
    throw new ApiError(0, "network", "網路連線失敗");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? "發生錯誤");
  return data as T;
}

export const getBike = (id: string) => request<BikeInfo>(`/bikes/${id}`);

/** pos 有給就會比對還車站點 */
export const rateBike = (id: string, scores: Scores, pos?: Position | null) =>
  request<BikeInfo & { station: NearStation }>(
    `/bikes/${id}/ratings`,
    { method: "POST", body: JSON.stringify({ ...scores, ...pos }) },
    true,
  );

export const nearestStation = (pos: Position) =>
  request<{ station: NearStation }>("/stations/nearest", { method: "POST", body: JSON.stringify(pos) });

export const getMap = () => request<MapData>("/map");

export const getMe = () =>
  request<{ suspect: boolean; todayCount: number; dailyLimit: number }>("/me", {}, true);
