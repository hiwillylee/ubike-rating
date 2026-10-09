package tw.bikerating.ocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import tw.bikerating.data.BikeIdParser
import kotlin.math.roundToInt

/**
 * 用實拍車號照片跑 PaddleOCR + BikeIdParser，列出原始辨識行、解析結果與耗時（診斷用）。
 *
 * 照片含站點標籤，不進版控：要跑時把照片暫放 app/src/androidTest/assets/bikeocr/，
 * 檔名對應下方 cases，跑完刪掉。沒有照片時整個測試自動略過。
 * 結果看 logcat：adb logcat -s BikeOcr
 */
@RunWith(AndroidJUnit4::class)
class BikeIdOcrPhotoTest {

    /** cx, cy, guideW 以 1500x2000 縮圖座標計；框高 = 框寬 × GUIDE_RATIO */
    private data class Case(val file: String, val expected: String, val cx: Int, val cy: Int, val guideW: Int)

    private val cases = listOf(
        Case("08656387-image.jpg", "1211023", 675, 915, 460),
        Case("6901f331-image.jpg", "1211023", 655, 1240, 520),
        Case("ec785cad-image.jpg", "1300474", 690, 1135, 480),
        Case("16113425-image.jpg", "1300474", 692, 930, 400),
    )

    @Test
    fun recognizeBikeIdPhotos() {
        val instr = InstrumentationRegistry.getInstrumentation()
        val assets = instr.context.assets
        val available = assets.list("bikeocr").orEmpty().toSet()
        val present = cases.filter { it.file in available }
        assumeTrue("沒有車號照片（app/src/androidTest/assets/bikeocr/），略過", present.isNotEmpty())

        var t0 = SystemClock.elapsedRealtime()
        val ocr = PaddleOcr.get(instr.targetContext)
        Log.i(TAG, "model load ${SystemClock.elapsedRealtime() - t0} ms")

        val summary = mutableListOf<String>()
        for (c in present) {
            val full = assets.open("bikeocr/${c.file}").use { BitmapFactory.decodeStream(it) }
            val scale = full.width / 1500f
            val gw = c.guideW * scale
            val gh = gw * GUIDE_RATIO
            val left = (c.cx * scale - gw / 2).roundToInt().coerceAtLeast(0)
            val top = (c.cy * scale - gh / 2).roundToInt().coerceAtLeast(0)
            val raw = Bitmap.createBitmap(full, left, top, gw.roundToInt(), gh.roundToInt())
            full.recycle()
            // 與 App 相同：裁切縮到寬 640
            val crop = Bitmap.createScaledBitmap(raw, OCR_INPUT_WIDTH, (raw.height * OCR_INPUT_WIDTH.toFloat() / raw.width).roundToInt(), true)

            for ((mode, bmp) in listOf("crop" to crop, "crop+green" to greenness(crop))) {
                t0 = SystemClock.elapsedRealtime()
                val lines = ocr.recognize(bmp)
                val ms = SystemClock.elapsedRealtime() - t0
                lines.forEach { Log.i(TAG, "${c.file} [$mode] line \"${it.text}\" mean=${"%.2f".format(it.mean)} @(${it.left},${it.top},${it.right},${it.bottom})") }
                val ids = BikeIdParser.parse(lines.map { BikeIdParser.OcrLine(it.text, it.left, it.top, it.right, it.bottom) })
                summary += "${c.file} [$mode] ${verdict(ids, c.expected)} expected=${c.expected} parsed=$ids ${ms}ms"
            }
            // App 實際流程：先綠色、沒結果再原圖
            t0 = SystemClock.elapsedRealtime()
            val ids = ocr.recognizeBikeId(crop)
            summary += "${c.file} [pipeline] ${verdict(ids, c.expected)} expected=${c.expected} parsed=$ids ${SystemClock.elapsedRealtime() - t0}ms"
        }
        Log.i(TAG, "===== SUMMARY =====")
        summary.forEach { Log.i(TAG, it) }
    }

    /**
     * 模擬相機影格走 App 的完整流程：照片當成 1440x1920 的直立畫面，再轉成感光元件方向（rotation 0/90/270），
     * 預覽是 1080x2400 的 FILL_CENTER，對準框放在車號上，經 BikeIdAnalyzer.cropGuide 裁切後辨識。
     * 也測 rotation 90 搭配 ViewPort（cropRect 已是畫面可見範圍）的情況。
     */
    @Test
    fun cameraFramePipeline() {
        val instr = InstrumentationRegistry.getInstrumentation()
        val assets = instr.context.assets
        val available = assets.list("bikeocr").orEmpty().toSet()
        val present = cases.filter { it.file in available }
        assumeTrue("沒有車號照片，略過", present.isNotEmpty())
        val ocr = PaddleOcr.get(instr.targetContext)

        val viewAspect = 1080f / 2400f
        val failures = mutableListOf<String>()
        for (c in present) {
            val photo = assets.open("bikeocr/${c.file}").use { BitmapFactory.decodeStream(it) }
            val up = Bitmap.createScaledBitmap(photo, 1440, 1920, true)
            photo.recycle()
            val k = up.width / 1500f
            val W = up.width.toFloat()
            val H = up.height.toFloat()
            // FILL_CENTER：直立畫面中看得到的範圍
            val visW = H * viewAspect
            val offX = (W - visW) / 2
            val gw = c.guideW * k
            val gh = gw * GUIDE_RATIO
            val guide = RectF(
                (c.cx * k - gw / 2 - offX) / visW, (c.cy * k - gh / 2) / H,
                (c.cx * k + gw / 2 - offX) / visW, (c.cy * k + gh / 2) / H,
            )
            for (rotation in listOf(0, 90, 270)) {
                // 感光元件影像 = 直立畫面逆向旋轉
                val src = if (rotation == 0) up else
                    Bitmap.createBitmap(up, 0, 0, up.width, up.height, Matrix().apply { postRotate(-rotation.toFloat()) }, true)
                val variants = mutableListOf("full" to Rect(0, 0, src.width, src.height))
                if (rotation == 90) {
                    // ViewPort：直立可見範圍 x∈[offX, offX+visW] → 原始影像 y∈[h−(offX+visW), h−offX]
                    variants += "viewport" to Rect(0, (src.height - (offX + visW)).roundToInt(), src.width, (src.height - offX).roundToInt())
                }
                for ((name, cropRect) in variants) {
                    val crop = BikeIdAnalyzer.cropGuide(src, cropRect, rotation, guide, viewAspect)
                    val t0 = SystemClock.elapsedRealtime()
                    val ids = ocr.recognizeBikeId(crop)
                    val row = "${c.file} [frame rot=$rotation $name ${crop.width}x${crop.height}] ${verdict(ids, c.expected)} parsed=$ids ${SystemClock.elapsedRealtime() - t0}ms"
                    Log.i(TAG, row)
                    if (ids.firstOrNull() != c.expected) failures += row
                    crop.recycle()
                }
                if (src !== up) src.recycle()
            }
            up.recycle()
        }
        assertTrue("相機影格流程辨識失敗：\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    private fun verdict(ids: List<String>, expected: String) = if (ids.firstOrNull() == expected) "OK" else "FAIL"

    private companion object {
        const val TAG = "BikeOcr"
    }
}
