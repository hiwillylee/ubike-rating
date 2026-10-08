# API 規格

Base URL：`sam deploy` 輸出的 `ApiUrl`（Lambda Function URL）。回應都是 JSON。

車號 `{id}`：7 碼數字（車上印成上 2 碼、下 5 碼）。

## GET /bikes/{id}

公開，不需登入。

```json
{
  "id": "1234567",
  "count": 3,
  "scores": { "clean": 3.42, "gear": 2.8, "frame": 4 },
  "recent": [{ "clean": 4, "gear": 3, "frame": 4, "at": "2026-10-08T04:00:00.000Z" }]
}
```

- `scores` 是該車最新 10 筆**有效**評分（排除被判定為假帳號的評分）的加權平均。最新一筆權重 1.0，最舊一筆 0.5，中間等差。沒有評分時為 `null`。
- `recent` 是參與計算的評分，由新到舊排列。

## POST /bikes/{id}/ratings

需要 `Authorization: Bearer <Cognito IdToken>`。

```json
{ "clean": 1, "gear": 4, "frame": 3 }
```

三項都必須是 1~4 的整數（4 = 最好）。

| 狀態碼 | error | 說明 |
|---|---|---|
| 201 | — | 成功，回傳內容同 GET /bikes/{id} |
| 400 | bad_request / bad_bike_id | 格式錯誤 |
| 401 | unauthorized | 未登入或 token 無效 |
| 403 | suspect | 帳號已被判定為假帳號 |
| 409 | cooldown | 同帳號對同一台車 30 分鐘內只能評一次 |
| 429 | rate_limited | 每分鐘最多 3 筆 |

### 假帳號判定（符合任一條件就標記，之後該帳號所有評分都不列入計算）

- 單日（台灣時間）評分超過 60 筆
- 1 小時內觸發每分鐘限流 5 次以上

門檻都可以在 `sam deploy` 時用參數調整（`PerMinuteLimit`、`SameBikeCooldownMinutes`、`DailySuspectThreshold`、`HourlyViolationThreshold`）。

## GET /me

需要登入。回傳 `{ "suspect": false, "todayCount": 5, "dailyLimit": 60 }`。
