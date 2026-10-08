import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "./config.js";
import { submitRating, timeKeys } from "./abuse.js";
import { isValidScore, weightedScores } from "./score.js";
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

async function getBike(bikeId: string, status = 200) {
  const latest = await store.latestRatings(bikeId, config.fetchWindow);
  const suspects = await store.suspectUsers(latest.map((r) => r.userId));
  const valid = latest.filter((r) => !suspects.has(r.userId));
  const { count, scores } = weightedScores(valid, config.scoreWindow);
  return json(status, {
    id: bikeId,
    count,
    scores,
    recent: valid
      .slice(0, config.scoreWindow)
      .map(({ clean, gear, frame, at }) => ({ clean, gear, frame, at })),
  });
}

async function postRating(event: APIGatewayProxyEventV2, bikeId: string) {
  const userId = await authUser(event);
  if (!userId) return err(401, "unauthorized", "請先登入");

  let body: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "");
    body = JSON.parse(raw);
  } catch {
    return err(400, "bad_request", "JSON 格式錯誤");
  }
  const { clean, gear, frame } = body;
  if (!isValidScore(clean) || !isValidScore(gear) || !isValidScore(frame)) {
    return err(400, "bad_request", "clean、gear、frame 必須是 1~4 的整數");
  }

  const result = await submitRating(store, config, userId, bikeId, { clean, gear, frame });
  if (result.status !== 201) return err(result.status, result.error, result.message);
  return getBike(bikeId, 201);
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
