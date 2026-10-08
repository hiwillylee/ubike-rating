import { createWorker, PSM, type Worker } from "tesseract.js";
import { parseBikeId, type OcrLine } from "./parseBikeId";

let workerPromise: Promise<Worker> | null = null;

/** 預先載入 OCR 模型（第一次約 2～4 MB，之後瀏覽器會快取） */
export function warmUpOcr(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const w = await createWorker("eng");
      await w.setParameters({
        tessedit_char_whitelist: "0123456789",
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      });
      return w;
    })();
    workerPromise.catch(() => (workerPromise = null));
  }
  return workerPromise;
}

type Variant = "gray" | "binary" | "inverted";

/** 灰階後依 Otsu 門檻二值化；inverted 用在深底淺字 */
function preprocess(src: HTMLCanvasElement, variant: Variant): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) {
    const g = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    gray[i] = g;
    hist[gray[i]]++;
  }

  let threshold = 128;
  if (variant !== "gray") {
    // Otsu
    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) ** 2;
      if (between > best) {
        best = between;
        threshold = t;
      }
    }
  }

  for (let i = 0; i < gray.length; i++) {
    let v = gray[i];
    if (variant === "binary") v = v > threshold ? 255 : 0;
    if (variant === "inverted") v = v > threshold ? 0 : 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/**
 * 辨識已裁切好的車號區域，回傳候選車號（最可能的在前）。
 * 依序嘗試灰階、二值化、反相，有結果就停。
 */
export async function recognizeBikeId(crop: HTMLCanvasElement): Promise<string[]> {
  const worker = await warmUpOcr();
  const found: string[] = [];
  for (const variant of ["gray", "binary", "inverted"] as Variant[]) {
    const { data } = await worker.recognize(preprocess(crop, variant));
    const lines: OcrLine[] = (data.lines ?? []).map((l) => ({
      text: l.text,
      box: [l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1],
    }));
    // Tesseract 有時會把上下兩行合併成一行並以換行分隔，拆開再估座標
    const expanded = lines.flatMap(splitMultiline);
    for (const id of parseBikeId(expanded)) if (!found.includes(id)) found.push(id);
    if (found.length > 0) break;
  }
  return found;
}

function splitMultiline(l: OcrLine): OcrLine[] {
  const parts = l.text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
  if (parts.length <= 1) return [l];
  const [x0, y0, x1, y1] = l.box;
  const h = (y1 - y0) / parts.length;
  return parts.map((text, i) => ({ text, box: [x0, y0 + h * i, x1, y0 + h * (i + 1)] }));
}
