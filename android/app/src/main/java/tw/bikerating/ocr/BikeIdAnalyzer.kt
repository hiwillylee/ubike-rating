package tw.bikerating.ocr

import android.graphics.Bitmap
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** 對準框：寬占畫面 55%（最多 300dp），高寬比 0.6，與網頁版一致 */
const val GUIDE_WIDTH = 0.55f
const val GUIDE_MAX_WIDTH_DP = 300f
const val GUIDE_RATIO = 0.6f

/**
 * 連續辨識：每隔 [intervalMs] 只把對準框內那塊裁下來跑 PaddleOCR，
 * 連續 [stableFrames] 次得到相同車號才回報，回報後暫停直到 [resume]。
 */
class BikeIdAnalyzer(
    private val ocr: () -> PaddleOcr,
    private val intervalMs: Long = 400,
    private val stableFrames: Int = 2,
    private val onDetected: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    /** 對準框在預覽畫面中的位置（0~1 的比例）與預覽畫面的寬高比，由 UI 設定 */
    @Volatile var guide: RectF? = null
    @Volatile var viewAspect: Float = 0f
    @Volatile private var paused = false

    private var lastRun = 0L
    private var last: String? = null
    private var streak = 0

    fun resume() {
        last = null
        streak = 0
        paused = false
    }

    override fun analyze(proxy: ImageProxy) {
        proxy.use {
            if (paused) return
            if (SystemClock.elapsedRealtime() - lastRun < intervalMs) return
            val g = guide ?: return
            if (viewAspect <= 0f) return
            val crop = cropGuide(proxy, g, viewAspect)
            val id = try {
                ocr().recognizeBikeId(crop).firstOrNull()
            } catch (e: Exception) {
                Log.w(TAG, "OCR failed", e)
                null
            } finally {
                crop.recycle()
                lastRun = SystemClock.elapsedRealtime()
            }
            if (id != null && id == last) streak++ else streak = if (id != null) 1 else 0
            last = id
            if (id != null && streak >= stableFrames) {
                paused = true
                onDetected(id)
            }
        }
    }

    private fun cropGuide(proxy: ImageProxy, g: RectF, aspect: Float): Bitmap {
        val src = proxy.toBitmap()
        val out = cropGuide(src, proxy.cropRect, proxy.imageInfo.rotationDegrees, g, aspect)
        if (out !== src) src.recycle()
        return out
    }

    companion object {
        private const val TAG = "BikeIdAnalyzer"

        /** 從相機原始影像裁出對準框那塊，轉正並縮到寬 [OCR_INPUT_WIDTH] */
        fun cropGuide(src: Bitmap, cropRect: Rect, rotation: Int, g: RectF, viewAspect: Float): Bitmap {
            val r = guideToSourceRect(src.width, src.height, cropRect, rotation, g, viewAspect)
            val uprightW = if (rotation % 180 == 0) r.width() else r.height()
            val s = OCR_INPUT_WIDTH.toFloat() / uprightW
            val m = Matrix().apply { postRotate(rotation.toFloat()); postScale(s, s) }
            return Bitmap.createBitmap(src, r.left, r.top, r.width(), r.height(), m, true)
        }

        /**
         * 把「預覽畫面上的對準框」換算成相機原始影像（未旋轉）的像素範圍。
         * 預覽是 FILL_CENTER：畫面看到的是影像置中裁成畫面比例的那一塊。
         * 有設 ViewPort 時 cropRect 已經是那一塊；沒有的話就自己置中裁。
         */
        fun guideToSourceRect(w: Int, h: Int, cropRect: Rect, rotation: Int, g: RectF, viewAspect: Float): Rect {
            // 1. cropRect 轉成直立座標
            val c = cropRect
            val u = when (rotation) {
                90 -> RectF((h - c.bottom).toFloat(), c.left.toFloat(), (h - c.top).toFloat(), c.right.toFloat())
                180 -> RectF((w - c.right).toFloat(), (h - c.bottom).toFloat(), (w - c.left).toFloat(), (h - c.top).toFloat())
                270 -> RectF(c.top.toFloat(), (w - c.right).toFloat(), c.bottom.toFloat(), (w - c.left).toFloat())
                else -> RectF(c)
            }
            // 2. FILL_CENTER：在直立影像中置中取出與畫面同比例的區域
            val ua = u.width() / u.height()
            if (abs(ua - viewAspect) / viewAspect > 0.02f) {
                if (ua > viewAspect) {
                    val vw = u.height() * viewAspect
                    u.left += (u.width() - vw) / 2; u.right = u.left + vw
                } else {
                    val vh = u.width() / viewAspect
                    u.top += (u.height() - vh) / 2; u.bottom = u.top + vh
                }
            }
            // 3. 對準框（比例）→ 直立影像座標
            val gx0 = u.left + g.left * u.width()
            val gx1 = u.left + g.right * u.width()
            val gy0 = u.top + g.top * u.height()
            val gy1 = u.top + g.bottom * u.height()
            // 4. 直立座標 → 原始影像座標
            val f = when (rotation) {
                90 -> RectF(gy0, h - gx1, gy1, h - gx0)
                180 -> RectF(w - gx1, h - gy1, w - gx0, h - gy0)
                270 -> RectF(w - gy1, gx0, w - gy0, gx1)
                else -> RectF(gx0, gy0, gx1, gy1)
            }
            val l = f.left.roundToInt().coerceIn(0, w - 1)
            val t = f.top.roundToInt().coerceIn(0, h - 1)
            val r = f.right.roundToInt().coerceIn(l + 1, w)
            val b = f.bottom.roundToInt().coerceIn(t + 1, h)
            return Rect(l, t, max(r, l + 1), max(b, t + 1))
        }
    }
}
