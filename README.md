# 單車車況評價系統

用相機辨識 YouBike 2.0 車號（上 2 碼、下 5 碼），查詢或登記該車的三項車況：

| 項目 | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| 乾淨程度 | 很髒 | 有點髒 | 尚可 | 乾淨 |
| 變速器 | 無法變速 | 常跳檔 | 偶爾不順 | 順暢 |
| 車體（輪框、龍頭） | 明顯歪斜 | 有點歪 | 輕微 | 正常 |

## 專案結構

```
backend/   AWS SAM：Cognito + Lambda(Function URL) + DynamoDB，全用 Always Free 服務
web/       手機網頁版（給 iOS），Vite + React + PaddleOCR（ONNX Runtime Web）
android/   Android 原生 App，Kotlin + Compose + CameraX + ML Kit
shared/    兩端共用的車號解析測試案例
docs/      API 規格
```

## 1. 部署後端

```bash
brew install awscli aws-sam-cli
```

```bash
aws configure
```

```bash
cd backend && npm install && npm run build && sam deploy --guided --region ap-northeast-1
```

`--guided` 會問幾個參數：

- `AlertEmail`：只要產生任何費用（超過 0.01 USD）就寄信通知。
- `AllowedOrigin`：先用 `*`，網頁部署好後可以改成 `https://<你的帳號>.github.io`。
- 其他防濫用門檻用預設值就好。

部署完成後，記下 Outputs 裡的 `ApiUrl`、`Region`、`UserPoolClientId`。

### 免費額度說明

| 服務 | 用法 | Always Free 額度 |
|---|---|---|
| Cognito | Email 註冊登入（Lite 方案） | 每月 10,000 名活躍使用者 |
| Lambda + Function URL | API | 每月 100 萬次請求 |
| DynamoDB | Provisioned 10 RCU / 10 WCU | 25 GB、25 RCU / 25 WCU |
| 影像辨識 | 在手機端執行 | 不用雲端 |

- 不用 API Gateway 和 S3，因為兩者只有前 12 個月免費。
- Cognito 用內建寄信，每天上限約 50 封驗證信。使用者變多時再改接 SES。
- 2025/7/15 之後開的 AWS 帳號預設是「Free plan」，6 個月後要升級成 Paid plan 才能繼續用。升級後上面的 Always Free 額度照樣有效。

## 2. 網頁版

本機開發：

```bash
cd web && cp .env.example .env.local && npm install && npm run dev
```

把 `.env.local` 填成後端的 Outputs。手機上的相機需要 HTTPS，所以要在手機測試時，請部署到 GitHub Pages：

1. 把專案推上 GitHub。
2. 到 Settings → Pages，Source 選 **GitHub Actions**。
3. 到 Settings → Secrets and variables → Actions → **Variables**，新增 `VITE_API_URL`、`VITE_COGNITO_REGION`、`VITE_COGNITO_CLIENT_ID`。
4. 推到 `main` 就會自動部署（`.github/workflows/web.yml`）。

在 iPhone 上用 Safari 打開網址，選「分享 → 加入主畫面」，就能像 App 一樣使用。

## 3. Android

```bash
cp android/app-config.properties.example android/app-config.properties
```

填好設定後，用 Android Studio 開啟 `android/` 資料夾，接上手機執行。也可以用指令編譯：

```bash
cd android && ./gradlew assembleDebug
```

## 測試

```bash
cd backend && npm test
```

```bash
cd web && npm test
```

```bash
cd android && ./gradlew testDebugUnitTest
```

## 車號辨識

- 網頁版用 PaddleOCR（PP-OCRv4）。實拍照片測試中，Tesseract.js 4 張只對 1 張，PaddleOCR 4 張全對。
- 車號是綠色字，所以會先用「綠的程度」（G 減去 R、B 中較大者）做前處理，把白色車架、黃色擋泥板和背景濾掉；沒有結果再用原圖辨識。
- 模型放在 `web/public/models/`。手機第一次掃描時大約要下載 22 MB（壓縮後），之後從瀏覽器快取讀取。

## 車號格式

目前規則是：上一行剛好 2 碼數字，正下方一行剛好 5 碼數字，兩行串成 7 碼。如果實際格式不同，要改這幾個地方：

- `web/src/parseBikeId.ts` 的 `BIKE_ID_LAYOUT`
- `android/.../data/BikeIdParser.kt` 的 `LAYOUT`
- `shared/bike-id-cases.json`
- 後端 `BIKE_ID_PATTERN` 環境變數（預設 `^\d{7}$`）
- 兩端手動輸入的 7 碼檢查
