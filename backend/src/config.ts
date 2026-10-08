const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback;
};

export const config = {
  tableName: process.env.TABLE_NAME ?? "ubike",
  userPoolId: process.env.USER_POOL_ID ?? "",
  userPoolClientId: process.env.USER_POOL_CLIENT_ID ?? "",

  // 車號格式：上行 2 碼 + 下行 5 碼，串成 7 碼數字
  bikeIdPattern: new RegExp(process.env.BIKE_ID_PATTERN ?? "^\\d{7}$"),

  // 計分：取最新 N 筆有效評分；為了排除假帳號，多抓一些再過濾
  scoreWindow: num(process.env.SCORE_WINDOW, 10),
  fetchWindow: num(process.env.FETCH_WINDOW, 30),

  // 防濫用
  perMinuteLimit: num(process.env.PER_MINUTE_LIMIT, 3),
  sameBikeCooldownMinutes: num(process.env.SAME_BIKE_COOLDOWN_MINUTES, 30),
  dailySuspectThreshold: num(process.env.DAILY_SUSPECT_THRESHOLD, 60),
  hourlyViolationThreshold: num(process.env.HOURLY_VIOLATION_THRESHOLD, 5),
};

export type Config = typeof config;
