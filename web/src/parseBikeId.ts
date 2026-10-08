// 車號解析：車上印成上下兩行（上 2 碼、下 5 碼），OCR 會分成多行，要依座標組回來。
// Android 版 BikeIdParser.kt 是同一套規則，兩邊共用 shared/bike-id-cases.json 測試。

export const BIKE_ID_LAYOUT = [2, 5];

export interface OcrLine {
  text: string;
  /** [left, top, right, bottom] */
  box: [number, number, number, number];
}

const LOOKALIKE: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0",
  I: "1", l: "1", "|": "1", i: "1",
  Z: "2", z: "2",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

/** 把一行文字轉成純數字；字母佔多數的行（如 "YouBike"）不做字形校正，避免誤造數字 */
export function toDigits(text: string): string {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length === 0) return "";
  const digitCount = chars.filter((c) => c >= "0" && c <= "9").length;
  const mapped = digitCount * 2 >= chars.length ? chars.map((c) => LOOKALIKE[c] ?? c) : chars;
  return mapped.filter((c) => c >= "0" && c <= "9").join("");
}

interface Line {
  digits: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const height = (l: Line) => l.bottom - l.top;
const overlapsX = (a: Line, b: Line) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0;

/** b 是否在 a 正下方且距離合理；回傳間距，不合格回傳 null */
function gapBelow(a: Line, b: Line): number | null {
  if (b.top < (a.top + a.bottom) / 2) return null;
  if (!overlapsX(a, b)) return null;
  const gap = b.top - a.bottom;
  if (gap > 1.5 * Math.max(height(a), height(b))) return null;
  return gap;
}

/**
 * 回傳車號候選，最可能的排第一。
 */
export function parseBikeId(input: OcrLine[], layout: number[] = BIKE_ID_LAYOUT): string[] {
  const total = layout.reduce((a, b) => a + b, 0);
  const lines: Line[] = input
    .map((l) => ({
      digits: toDigits(l.text),
      left: l.box[0],
      top: l.box[1],
      right: l.box[2],
      bottom: l.box[3],
    }))
    .filter((l) => l.digits.length > 0)
    .sort((a, b) => a.top - b.top);

  const found: { id: string; cost: number }[] = [];

  // 依 layout 逐行往下串：第 k 段必須剛好 layout[k] 碼
  const walk = (prev: Line, k: number, acc: string, cost: number) => {
    if (k === layout.length) {
      found.push({ id: acc, cost });
      return;
    }
    for (const next of lines) {
      if (next === prev || next.digits.length !== layout[k]) continue;
      const gap = gapBelow(prev, next);
      if (gap !== null) walk(next, k + 1, acc + next.digits, cost + Math.abs(gap));
    }
  };
  for (const first of lines) {
    if (first.digits.length === layout[0]) walk(first, 1, first.digits, 0);
  }

  // 容錯：OCR 把兩行黏成同一行
  for (const l of lines) {
    if (l.digits.length === total) found.push({ id: l.digits, cost: Number.MAX_SAFE_INTEGER });
  }

  found.sort((a, b) => a.cost - b.cost);
  return [...new Set(found.map((f) => f.id))];
}
