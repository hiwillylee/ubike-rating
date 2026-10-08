import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AbuseStore } from "./abuse.js";
import type { Rating } from "./score.js";

const isConditionFail = (e: unknown) =>
  e instanceof Error &&
  (e.name === "ConditionalCheckFailedException" ||
    (e.name === "TransactionCanceledException" && e.message.includes("ConditionalCheckFailed")));

const userPk = (userId: string) => `USER#${userId}`;
const bikePk = (bikeId: string) => `BIKE#${bikeId}`;

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
}
