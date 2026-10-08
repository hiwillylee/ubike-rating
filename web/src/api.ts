import { getIdToken } from "./auth";
import { API_URL, type Scores } from "./config";

export interface BikeInfo {
  id: string;
  count: number;
  scores: Scores | null;
  recent: (Scores & { at: string })[];
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

export const rateBike = (id: string, scores: Scores) =>
  request<BikeInfo>(`/bikes/${id}/ratings`, { method: "POST", body: JSON.stringify(scores) }, true);

export const getMe = () =>
  request<{ suspect: boolean; todayCount: number; dailyLimit: number }>("/me", {}, true);
