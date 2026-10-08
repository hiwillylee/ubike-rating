export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
export const COGNITO_REGION = import.meta.env.VITE_COGNITO_REGION ?? "ap-northeast-1";
export const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

export const METRICS = [
  { key: "clean", label: "乾淨程度", levels: ["很髒", "有點髒", "尚可", "乾淨"] },
  { key: "gear", label: "變速器", levels: ["無法變速", "常跳檔", "偶爾不順", "順暢"] },
  { key: "frame", label: "車體（輪框、龍頭）", levels: ["明顯歪斜", "有點歪", "輕微", "正常"] },
] as const;

export type MetricKey = (typeof METRICS)[number]["key"];
export type Scores = Record<MetricKey, number>;
