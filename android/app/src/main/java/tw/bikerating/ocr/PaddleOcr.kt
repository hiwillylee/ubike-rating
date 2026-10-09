package tw.bikerating.ocr

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import tw.bikerating.data.BikeIdParser
import java.nio.FloatBuffer
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * PaddleOCR（PP-OCRv4 det + rec）用 ONNX Runtime 推論。
 * 前後處理照網頁版用的 @gutenye/ocr-common 移植，數值保持一致：
 * - 偵測：縮放到 32 的倍數（ceil），輸入 RGB/255（不減 mean、不除 std），平面順序 B、G、R；
 *   機率圖門檻 0.03；框以 unclip 比例 1.5 向外擴張。
 * - 辨識：每個框縮放到高 48，CTC greedy decode，index 0 為 blank，字典 index 要減 1；平均信心 < 0.5 的行丟掉；
 *   中線相近的框併成同一行。
 * 與 JS 的差異：JS 用 OpenCV findContours + minAreaRect（可旋轉的框），這裡用連通區塊的軸對齊外接矩形。
 * 我們只辨識對準框內的小圖、文字大致水平，軸對齊就夠了。
 *
 * 不是執行緒安全的，請在同一個背景執行緒呼叫。
 */
class PaddleOcr private constructor(
    private val env: OrtEnvironment,
    private val det: OrtSession,
    private val rec: OrtSession,
    private val dictionary: List<String>,
) : AutoCloseable {

    /** 一行辨識結果，座標是輸入圖的像素 */
    data class TextLine(val text: String, val mean: Float, val left: Int, val top: Int, val right: Int, val bottom: Int)

    private class Box(val left: Int, val top: Int, val right: Int, val bottom: Int)

    fun recognize(image: Bitmap): List<TextLine> {
        val input = Bitmap.createScaledBitmap(image, multipleOf32(image.width), multipleOf32(image.height), true)
        val boxes = detect(input)
        val lines = boxes.mapNotNull { box ->
            val crop = cropBox(input, box)
            val (text, mean) = recognizeLine(crop)
            if (crop !== input) crop.recycle()
            if (mean >= 0.5f) TextLine(text, mean, box.left, box.top, box.right, box.bottom) else null
        }
        // 換回原圖座標
        val rx = image.width.toFloat() / input.width
        val ry = image.height.toFloat() / input.height
        if (input !== image) input.recycle()
        return groupByMidline(lines).map {
            it.copy(
                left = (it.left * rx).roundToInt(), top = (it.top * ry).roundToInt(),
                right = (it.right * rx).roundToInt(), bottom = (it.bottom * ry).roundToInt(),
            )
        }
    }

    // ---------------------------------------------------------------- 偵測

    private fun detect(img: Bitmap): List<Box> {
        val w = img.width
        val h = img.height
        val out = run(det, toInput(img), w, h)
        val map = (out[0] as Array<*>)[0] as Array<*> // [1][1][H][W]
        val bin = BooleanArray(w * h)
        for (y in 0 until h) {
            val row = map[y] as FloatArray
            for (x in 0 until w) bin[y * w + x] = row[x] > DET_THRESHOLD
        }
        return components(bin, w, h).mapNotNull { (l, t, r, b) -> toTextBox(l, t, r, b, w, h) }
    }

    /** 8 連通區塊的外接矩形（座標為像素中心，與 OpenCV 輪廓點相同） */
    private fun components(bin: BooleanArray, w: Int, h: Int): List<IntArray> {
        val seen = BooleanArray(w * h)
        val stack = IntArray(w * h)
        val result = mutableListOf<IntArray>()
        for (start in bin.indices) {
            if (!bin[start] || seen[start]) continue
            var sp = 0
            stack[sp++] = start
            seen[start] = true
            var l = w; var t = h; var r = -1; var b = -1
            while (sp > 0) {
                val p = stack[--sp]
                val x = p % w
                val y = p / w
                if (x < l) l = x; if (x > r) r = x
                if (y < t) t = y; if (y > b) b = y
                for (dy in -1..1) for (dx in -1..1) {
                    val nx = x + dx
                    val ny = y + dy
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
                    val q = ny * w + nx
                    if (bin[q] && !seen[q]) { seen[q] = true; stack[sp++] = q }
                }
            }
            result += intArrayOf(l, t, r, b)
        }
        return result
    }

    /** 對應 JS 的 getMiniBoxes → unclip → 再取框 → 過濾 */
    private fun toTextBox(l: Int, t: Int, r: Int, b: Int, w: Int, h: Int): Box? {
        val bw = (r - l).toDouble()
        val bh = (b - t).toDouble()
        if (min(bw, bh) < MIN_SIZE) return null
        // 矩形 unclip：distance = area × ratio / perimeter，四邊各外擴 distance
        val d = bw * bh * UNCLIP_RATIO / (2 * (bw + bh))
        if (min(bw, bh) + 2 * d < MIN_SIZE + 2) return null
        val left = (l - d).roundToInt().coerceIn(0, w)
        val top = (t - d).roundToInt().coerceIn(0, h)
        val right = (r + d).roundToInt().coerceIn(0, w)
        val bottom = (b + d).roundToInt().coerceIn(0, h)
        if (right - left <= 3 || bottom - top <= 3) return null
        return Box(left, top, right, bottom)
    }

    /** 對應 getRotateCropImage：軸對齊時就是直接裁切；高寬比 ≥ 1.5 時逆時針轉 90 度 */
    private fun cropBox(img: Bitmap, box: Box): Bitmap {
        val cw = min(box.right, img.width) - box.left
        val ch = min(box.bottom, img.height) - box.top
        val crop = Bitmap.createBitmap(img, box.left, box.top, cw, ch)
        if (ch.toFloat() / cw < 1.5f) return crop
        val rotated = Bitmap.createBitmap(crop, 0, 0, cw, ch, Matrix().apply { postRotate(-90f) }, true)
        if (crop !== img) crop.recycle()
        return rotated
    }

    // ---------------------------------------------------------------- 辨識

    private fun recognizeLine(line: Bitmap): Pair<String, Float> {
        val w = max(1, (line.width.toFloat() / line.height * REC_HEIGHT).roundToInt())
        val img = Bitmap.createScaledBitmap(line, w, REC_HEIGHT, true)
        val out = run(rec, toInput(img), w, REC_HEIGHT)
        if (img !== line) img.recycle()
        val steps = out[0] as Array<*> // [1][T][C]
        val sb = StringBuilder()
        var sum = 0f
        var n = 0
        var prev = -1
        for (s in steps) {
            val probs = s as FloatArray
            var idx = 0
            for (i in 1 until probs.size) if (probs[i] > probs[idx]) idx = i
            if (idx != 0 && idx != prev) {
                sb.append(dictionary.getOrElse(idx - 1) { "" })
                sum += probs[idx]
                n++
            }
            prev = idx
        }
        return sb.toString() to (if (n > 0) sum / n else 0f)
    }

    /** 對應 JS 的 groupBoxesByMidlineDifference：中線差 < 平均高度/2 視為同一行，行內依 x 排序後以空白相接 */
    private fun groupByMidline(lines: List<TextLine>): List<TextLine> {
        if (lines.isEmpty()) return lines
        val avgH = lines.map { it.bottom - it.top }.average()
        val groups = mutableListOf<MutableList<TextLine>>()
        for (l in lines) {
            val mid = (l.top + l.bottom) / 2.0
            val g = groups.find { abs((it[0].top + it[0].bottom) / 2.0 - mid) < avgH / 2 }
            if (g != null) g += l else groups += mutableListOf(l)
        }
        groups.forEach { g -> g.sortBy { it.left } }
        groups.sortBy { it[0].top }
        return groups.map { g ->
            TextLine(
                text = g.joinToString(" ") { it.text },
                mean = g.map { it.mean }.average().toFloat(),
                left = g.minOf { it.left }, top = g.minOf { it.top },
                right = g.maxOf { it.right }, bottom = g.maxOf { it.bottom },
            )
        }
    }

    // ---------------------------------------------------------------- 共用

    /** RGB/255，平面順序 B、G、R（與 JS 的 imageToInput 相同） */
    private fun toInput(img: Bitmap): FloatBuffer {
        val w = img.width
        val h = img.height
        val px = IntArray(w * h)
        img.getPixels(px, 0, w, 0, 0, w, h)
        val plane = w * h
        val buf = FloatBuffer.allocate(3 * plane)
        val arr = buf.array()
        for (i in 0 until plane) {
            val p = px[i]
            arr[i] = Color.blue(p) / 255f
            arr[plane + i] = Color.green(p) / 255f
            arr[2 * plane + i] = Color.red(p) / 255f
        }
        return buf
    }

    private fun run(session: OrtSession, data: FloatBuffer, w: Int, h: Int): Array<*> {
        OnnxTensor.createTensor(env, data, longArrayOf(1, 3, h.toLong(), w.toLong())).use { tensor ->
            session.run(mapOf(session.inputNames.first() to tensor)).use { result ->
                return result[0].value as Array<*>
            }
        }
    }

    override fun close() {
        det.close()
        rec.close()
    }

    companion object {
        private const val DET_THRESHOLD = 0.03f
        private const val UNCLIP_RATIO = 1.5
        private const val MIN_SIZE = 3
        private const val REC_HEIGHT = 48

        private fun multipleOf32(v: Int) = max(32, ceil(v / 32.0).toInt() * 32)

        @Volatile private var instance: PaddleOcr? = null

        /** 載入模型（約 15 MB，第一次要一點時間），之後重複使用同一組 session */
        fun get(context: Context): PaddleOcr = instance ?: synchronized(this) {
            instance ?: create(context.applicationContext).also { instance = it }
        }

        private fun create(context: Context): PaddleOcr {
            val env = OrtEnvironment.getEnvironment()
            val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(2) }
            fun load(name: String) = context.assets.open("models/$name").use { it.readBytes() }
            val det = env.createSession(load("ch_PP-OCRv4_det_infer.onnx"), opts)
            val rec = env.createSession(load("ch_PP-OCRv4_rec_infer.onnx"), opts)
            // 與 JS 相同：每行一個字，最後補一個空白
            val dict = String(load("ppocr_keys_v1.txt"), Charsets.UTF_8).split("\n") + " "
            return PaddleOcr(env, det, rec, dict)
        }
    }
}

/** 綠色前處理（與網頁版相同）：綠的程度 (G − max(R,B)) × 3，綠字變黑、其他變白 */
fun greenness(src: Bitmap): Bitmap {
    val w = src.width
    val h = src.height
    val px = IntArray(w * h)
    src.getPixels(px, 0, w, 0, 0, w, h)
    for (i in px.indices) {
        val p = px[i]
        val g = (Color.green(p) - max(Color.red(p), Color.blue(p))) * 3
        val v = 255 - g.coerceIn(0, 255)
        px[i] = Color.rgb(v, v, v)
    }
    return Bitmap.createBitmap(px, w, h, Bitmap.Config.ARGB_8888)
}

/** 辨識寬度（與網頁版 OUT_W 相同） */
const val OCR_INPUT_WIDTH = 640

/** 車號辨識流程（與網頁版 recognizeBikeId 相同）：裁切縮到寬 640，先試綠色前處理，沒結果再用原圖 */
fun PaddleOcr.recognizeBikeId(crop: Bitmap): List<String> {
    val scaled = if (crop.width == OCR_INPUT_WIDTH) crop
    else Bitmap.createScaledBitmap(crop, OCR_INPUT_WIDTH, max(1, (crop.height * OCR_INPUT_WIDTH.toFloat() / crop.width).roundToInt()), true)
    try {
        for (variant in listOf(greenness(scaled), scaled)) {
            val lines = recognize(variant).map { BikeIdParser.OcrLine(it.text, it.left, it.top, it.right, it.bottom) }
            if (variant !== scaled) variant.recycle()
            val ids = BikeIdParser.parse(lines)
            if (ids.isNotEmpty()) return ids
        }
        return emptyList()
    } finally {
        if (scaled !== crop) scaled.recycle()
    }
}
