import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AbuseStore } from "./abuse.js";
import type { StationBikes } from "./map.js";
import type { Rating, Scores } from "./score.js";
import type { Station } from "./stations.js";

export interface BikeLocation {
  station: string;
  name: string;
  at: string;
}

const isConditionFail = (e: unknown) =>
  e instanceof Error &&
  (e.name === "ConditionalCheckFailedException" ||
    (e.name === "TransactionCanceledException" && e.message.includes("ConditionalCheckFailed")));

const userPk = (userId: string) => `USER#${userId}`;
const bikePk = (bikeId: string) => `BIKE#${bikeId}`;
// 地圖資料全部放在同一個 partition，一次 Query 就能取回所有站點
const MAP_PK = "MAP";
const stationSk = (id: string) => `ST#${id}`;

export class DynamoStore implements AbuseStore {
  private db: DynamoDBDocumentClient;

  constructor(
    private table: string,
    client = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client);
  }

  async isSuspect(userId: string) {
    const r = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: userPk(userId), SK: "PROFILE" },
        ProjectionExpression: "suspect",
      }),
    );
    return r.Item?.suspect === true;
  }

  async cooldownActive(userId: string, bikeId: string, nowSec: number) {
    const r = await this.db.send(
      new GetCommand({
        TableName: this.table,
        Key: { PK: userPk(userId), SK: `LAST#${bikeId}` },
      }),
    );
    // DynamoDB 的 TTL 刪除會延遲，所以要自己比對
    return !!r.Item && r.Item.ttl > nowSec;
  }

  async incrMinute(userId: string, minuteKey: string, limit: number, ttl: number) {
    try {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: userPk(userId), SK: `MIN#${minuteKey}` },
          UpdateExpression: "ADD n :one SET #ttl = :ttl",
          ConditionExpression: "attribute_not_exists(n) OR n < :limit",
          ExpressionAttributeNames: { "#ttl": "ttl" },
          ExpressionAttributeValues: { ":one": 1, ":ttl": ttl, ":limit": limit },
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFail(e)) return false;
      throw e;
    }
  }

  private async incr(userId: string, sk: string, ttl: number) {
    const r = await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: userPk(userId), SK: sk },
        UpdateExpression: "ADD n :one SET #ttl = :ttl",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":ttl": ttl },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    return Number(r.Attributes?.n ?? 0);
  }

  recordViolation(userId: string, hourKey: string, ttl: number) {
    return this.incr(userId, `VIOL#${hourKey}`, ttl);
  }

  incrDay(userId: string, dayKey: string, ttl: number) {
    return this.incr(userId, `DAY#${dayKey}`, ttl);
  }

  async dayCount(userId: string, dayKey: string) {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: userPk(userId), SK: `DAY#${dayKey}` } }),
    );
    return Number(r.Item?.n ?? 0);
  }

  async markSuspect(userId: string, reason: string, nowIso: string) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: userPk(userId), SK: "PROFILE" },
        UpdateExpression: "SET suspect = :t, suspectReason = :r, suspectAt = :at",
        ExpressionAttributeValues: { ":t": true, ":r": reason, ":at": nowIso },
      }),
    );
  }

  async saveRating(bikeId: string, rating: Rating, cooldownTtl: number, nowSec: number) {
    try {
      await this.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.table,
                Item: {
                  PK: bikePk(bikeId),
                  SK: `R#${rating.at}#${rating.userId}`,
                  ...rating,
                },
              },
            },
            {
              Put: {
                TableName: this.table,
                Item: { PK: userPk(rating.userId), SK: `LAST#${bikeId}`, ttl: cooldownTtl },
                ConditionExpression: "attribute_not_exists(PK) OR #ttl <= :now",
                ExpressionAttributeNames: { "#ttl": "ttl" },
                ExpressionAttributeValues: { ":now": nowSec },
              },
            },
          ],
        }),
      );
      return true;
    } catch (e) {
      if (isConditionFail(e)) return false;
      throw e;
    }
  }

  /** 該車最新 limit 筆評分（由新到舊） */
  async latestRatings(bikeId: string, limit: number): Promise<Rating[]> {
    const r = await this.db.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :r)",
        ExpressionAttributeValues: { ":pk": bikePk(bikeId), ":r": "R#" },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (r.Items ?? []).map((i) => ({
      clean: i.clean,
      gear: i.gear,
      frame: i.frame,
      at: i.at,
      userId: i.userId,
      ...(i.station ? { station: i.station } : {}),
    }));
  }

  /** 回傳這些使用者中被標記為假帳號的集合 */
  async suspectUsers(userIds: string[]): Promise<Set<string>> {
    const result = new Set<string>();
    const unique = [...new Set(userIds)];
    for (let i = 0; i < unique.length; i += 100) {
      let keys: Record<string, unknown>[] | undefined = unique
        .slice(i, i + 100)
        .map((id) => ({ PK: userPk(id), SK: "PROFILE" }));
      // BatchGet 可能回傳 UnprocessedKeys，要重試
      for (let attempt = 0; keys && keys.length > 0 && attempt < 5; attempt++) {
        const r: BatchGetCommandOutput = await this.db.send(
          new BatchGetCommand({
            RequestItems: {
              [this.table]: { Keys: keys, ProjectionExpression: "PK, suspect" },
            },
          }),
        );
        for (const item of r.Responses?.[this.table] ?? []) {
          if (item.suspect === true) result.add(String(item.PK).slice("USER#".length));
        }
        keys = r.UnprocessedKeys?.[this.table]?.Keys;
      }
    }
    return result;
  }

  /** 這台車最後在哪一站還車 */
  async bikeLocation(bikeId: string): Promise<BikeLocation | null> {
    const r = await this.db.send(
      new GetCommand({ TableName: this.table, Key: { PK: bikePk(bikeId), SK: "LOC" } }),
    );
    return r.Item ? { station: r.Item.station, name: r.Item.name, at: r.Item.at } : null;
  }

  /** 記錄車子在 station 還車：放進新站點，從上一個站點移除 */
  async placeBike(bikeId: string, station: Station, scores: Scores, at: string, prev: string | null) {
    const entry = { scores, at };
    const names = { "#b": bikeId, "#n": "name" };
    const base = { ":n": station.name, ":lat": station.lat, ":lng": station.lng };
    const key = { PK: MAP_PK, SK: stationSk(station.id) };
    // bikes 這個 map 不存在時不能直接設定 bikes.<車號>，所以先試著加入，失敗再建立整個 map
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.db.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: "SET #n = :n, lat = :lat, lng = :lng, bikes.#b = :e",
            ConditionExpression: "attribute_exists(bikes)",
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: { ...base, ":e": entry },
          }),
        );
        break;
      } catch (e) {
        if (!isConditionFail(e)) throw e;
      }
      try {
        await this.db.send(
          new UpdateCommand({
            TableName: this.table,
            Key: key,
            UpdateExpression: "SET #n = :n, lat = :lat, lng = :lng, bikes = :m",
            ConditionExpression: "attribute_not_exists(bikes)",
            ExpressionAttributeNames: { "#n": "name" },
            ExpressionAttributeValues: { ...base, ":m": { [bikeId]: entry } },
          }),
        );
        break;
      } catch (e) {
        if (!isConditionFail(e)) throw e;
      }
    }

    if (prev && prev !== station.id) {
      await this.db.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: MAP_PK, SK: stationSk(prev) },
          UpdateExpression: "REMOVE bikes.#b",
          ExpressionAttributeNames: { "#b": bikeId },
        }),
      ).catch(() => {});
    }

    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: bikePk(bikeId), SK: "LOC", station: station.id, name: station.name, at },
      }),
    );
  }

  /** 沒有 GPS 的評分：只更新車子目前所在站點上的分數 */
  async refreshBikeScores(bikeId: string, stationId: string, scores: Scores) {
    await this.db.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: MAP_PK, SK: stationSk(stationId) },
        UpdateExpression: "SET bikes.#b.scores = :s",
        ConditionExpression: "attribute_exists(bikes.#b)",
        ExpressionAttributeNames: { "#b": bikeId },
        ExpressionAttributeValues: { ":s": scores },
      }),
    ).catch((e) => {
      if (!isConditionFail(e)) throw e;
    });
  }

  /** 所有有資料的站點 */
  async mapItems(): Promise<StationBikes[]> {
    const out: StationBikes[] = [];
    let start: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": MAP_PK },
          ExclusiveStartKey: start,
        }),
      );
      for (const i of r.Items ?? []) {
        out.push({
          id: String(i.SK).slice(3),
          name: i.name,
          lat: i.lat,
          lng: i.lng,
          bikes: i.bikes ?? {},
        });
      }
      start = r.LastEvaluatedKey;
    } while (start);
    return out;
  }
}
