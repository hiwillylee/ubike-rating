import Ocr from "@gutenye/ocr-browser";
import * as ort from "onnxruntime-web";
import { parseBikeId, type OcrLine } from "./parseBikeId";

// PaddleOCR (PP-OCRv4) 透過 ONNX Runtime 在瀏覽器執行。
// 實拍照片測試：Tesseract.js 4 張只對 1 張，PaddleOCR 搭配綠色通道前處理 4 張全對。

// GitHub Pages 沒有 COOP/COEP 標頭，不能用多執行緒
ort.env.wasm.numThreads = 1;

const MODEL_BASE = `${import.meta.env.BASE_URL}models/`;

let ocrPromise: Promise<Ocr> | null = null;

/** 預先載入 OCR 模型（第一次約 15 MB，之後瀏覽器會快取） */
export function warmUpOcr(): Promise<Ocr> {
  if (!ocrPromise) {
    ocrPromise = Ocr.create({
      models: {
        detectionPath: `${MODEL_BASE}ch_PP-OCRv4_det_infer.onnx`,
        recognitionPath: `${MODEL_BASE}ch_PP-OCRv4_rec_infer.onnx`,
        dictionaryPath: `${MODEL_BASE}ppocr_keys_v1.txt`,
      },
    });
    ocrPromise.catch(() => (ocrPromise = null));
  }
  return ocrPromise;
}

type Variant = "green" | "original";

/**
 * 車號是綠色字，用「綠的程度」(G - max(R, B)) 當亮度：
 * 白色車架、黃色擋泥板、深色背景都接近 0，只有綠字會凸出來，反光與雜物幾乎都會消失。
 */
function toImageData(src: HTMLCanvasElement, variant: Variant): ImageData {
  const img = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, src.width, src.height);
  if (variant === "original") return img;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const greenness = d[i + 1] - Math.max(d[i], d[i + 2]);
    const v = 255 - Math.max(0, Math.min(255, greenness * 3)); // 綠字變黑、其他變白
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return img;
}

/**
 * 辨識已裁切好的車號區域，回傳候選車號（最可能的在前）。
 * 先試綠色通道，沒結果再用原圖。
 */
export async function recognizeBikeId(crop: HTMLCanvasElement): Promise<string[]> {
  const ocr = await warmUpOcr();
  for (const variant of ["green", "original"] as Variant[]) {
    const img = toImageData(crop, variant);
    const { texts } = await ocr.detect({ data: img.data, width: img.width, height: img.height });
    const lines: OcrLine[] = texts.flatMap((t) => {
      if (!t.box) return [];
      const xs = t.box.map((p) => p[0]);
      const ys = t.box.map((p) => p[1]);
      return [{ text: t.text, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] }];
    });
    const ids = parseBikeId(lines);
    if (ids.length > 0) return ids;
  }
  return [];
}
