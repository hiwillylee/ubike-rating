import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "./config.js";
import { submitRating, timeKeys } from "./abuse.js";
import { summarize } from "./map.js";
import { isValidScore, weightedScores } from "./score.js";
import { isValidCoord, loadStations, nearestStation, type Station } from "./stations.js";
import { DynamoStore } from "./store.js";

const store = new DynamoStore(config.tableName);
const verifier = CognitoJwtVerifier.create({
  userPoolId: config.userPoolId,
  tokenUse: "id",
  clientId: config.userPoolClientId,
});

// CORS 標頭由 Function URL 設定處理，這裡不重複加
const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

const err = (statusCode: number, error: string, message: string) =>
  json(statusCode, { error, message });

async function authUser(event: APIGatewayProxyEventV2): Promise<string | null> {
  const h = event.headers?.authorization ?? event.headers?.Authorization;
  const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return null;
  try {
    const payload = await verifier.verify(token);
    return payload.sub;
  } catch {
    return null;
  }
}

async function bikeInfo(bikeId: string) {
  const [latest, location] = await Promise.all([
    store.latestRatings(bikeId, config.fetchWindow),
    store.bikeLocation(bikeId),
  ]);
  const suspects = await store.suspectUsers(latest.map((r) => r.userId));
  const valid = latest.filter((r) => !suspects.has(r.userId));
  const { count, scores } = weightedScores(valid, config.scoreWindow);
  return {
    id: bikeId,
    count,
    scores,
    recent: valid
      .slice(0, config.scoreWindow)
      .map(({ clean, gear, frame, at }) => ({ clean, gear, frame, at })),
    // 最後一次有 GPS 的還車站點
    location: location ? { station: { id: location.station, name: location.name }, at: location.at } : null,
  };
}

const getBike = async (bikeId: string) => json(200, await bikeInfo(bikeId));

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** GPS 座標對應到半徑內最近的站點；站點資料抓不到時當作沒有 */
async function matchStation(lat: unknown, lng: unknown) {
  if (!isValidCoord(lat, lng)) return null;
  try {
    return nearestStation(await loadStations(), lat, lng as number, config.stationMatchMeters);
  } catch (e) {
    console.warn(e);
    return null;
  }
}

const stationJson = (m: { station: Station; distance: number } | null) =>
  m ? { id: m.station.id, name: m.station.name, distance: m.distance } : null;

async function postRating(event: APIGatewayProxyEventV2, bikeId: string) {
  const userId = await authUser(event);
  if (!userId) return err(401, "unauthorized", "請先登入");

  const body = parseBody(event);
  if (!body) return err(400, "bad_request", "JSON 格式錯誤");
  const { clean, gear, frame } = body;
  if (!isValidScore(clean) || !isValidScore(gear) || !isValidScore(frame)) {
    return err(400, "bad_request", "clean、gear、frame 必須是 1~4 的整數");
  }

  const matched = await matchStation(body.lat, body.lng);
  const now = new Date();
  const result = await submitRating(store, config, userId, bikeId, { clean, gear, frame }, now, matched?.station.id);
  if (result.status !== 201) return err(result.status, result.error, result.message);

  // 更新地圖：有站點就把車移到該站，沒有就只更新原站點上的分數
  const before = await store.bikeLocation(bikeId);
  let info = await bikeInfo(bikeId);
  if (info.scores) {
    try {
      if (matched) {
        await store.placeBike(bikeId, matched.station, info.scores, now.toISOString(), before?.station ?? null);
        info = {
          ...info,
          location: { station: { id: matched.station.id, name: matched.station.name }, at: now.toISOString() },
        };
      } else if (before) {
        await store.refreshBikeScores(bikeId, before.station, info.scores);
      }
      mapCache = null;
    } catch (e) {
      console.error("map update", e);
    }
  }
  return json(201, { ...info, station: stationJson(matched) });
}

async function postNearest(event: APIGatewayProxyEventV2) {
  const body = parseBody(event);
  if (!body || !isValidCoord(body.lat, body.lng)) return err(400, "bad_request", "需要 lat、lng");
  return json(200, { station: stationJson(await matchStation(body.lat, body.lng)) });
}

// 地圖資料在記憶體快取 1 分鐘，減少 DynamoDB 讀取量
let mapCache: { at: number; body: unknown } | null = null;

async function getMap() {
  if (!mapCache || Date.now() - mapCache.at > 60_000) {
    const stations = summarize(await store.mapItems(), new Date(), config.mapMaxAgeDays, config.excellentMin);
    mapCache = {
      at: Date.now(),
      body: { excellentMin: config.excellentMin, maxAgeDays: config.mapMaxAgeDays, stations },
    };
  }
  return json(200, mapCache.body);
}

async function getMe(event: APIGatewayProxyEventV2) {
  const userId = await authUser(event);
  if (!userId) return err(401, "unauthorized", "請先登入");
  const [suspect, today] = await Promise.all([
    store.isSuspect(userId),
    store.dayCount(userId, timeKeys(new Date()).day),
  ]);
  return json(200, { suspect, todayCount: today, dailyLimit: config.dailySuspectThreshold });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, "");

  try {
    if (method === "GET" && path === "/me") return await getMe(event);
    if (method === "GET" && path === "/map") return await getMap();
    if (method === "POST" && path === "/stations/nearest") return await postNearest(event);

    const m = path.match(/^\/bikes\/([^/]+)(\/ratings)?$/);
    if (m) {
      const bikeId = decodeURIComponent(m[1]);
      if (!config.bikeIdPattern.test(bikeId)) return err(400, "bad_bike_id", "車號格式錯誤");
      if (method === "GET" && !m[2]) return await getBike(bikeId);
      if (method === "POST" && m[2]) return await postRating(event, bikeId);
    }
    return err(404, "not_found", "找不到此路徑");
  } catch (e) {
    console.error(e);
    return err(500, "internal", "伺服器錯誤");
  }
}
