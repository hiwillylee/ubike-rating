package tw.bikerating.ocr

import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import tw.bikerating.data.BikeIdParser

/** 對準框：寬占畫面 70%，高寬比 0.6；預覽與影像都是 3:4，座標可直接按比例換算 */
const val GUIDE_WIDTH = 0.7f
const val GUIDE_RATIO = 0.6f

/**
 * 每幀用 ML Kit 辨識文字，只取對準框內的行，組出車號；
 * 連續 [stableFrames] 幀結果相同才回報，避免一閃而過的誤判。
 */
class BikeIdAnalyzer(
    private val stableFrames: Int = 3,
    private val onDetected: (String) -> Unit,
) : ImageAnalysis.Analyzer {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var last: String? = null
    private var streak = 0

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    override fun analyze(proxy: ImageProxy) {
        val media = proxy.image ?: return proxy.close()
        val rotation = proxy.imageInfo.rotationDegrees
        val image = InputImage.fromMediaImage(media, rotation)
        // 轉正後的寬高
        val w = if (rotation % 180 == 0) proxy.width else proxy.height
        val h = if (rotation % 180 == 0) proxy.height else proxy.width
        val gw = w * GUIDE_WIDTH
        val gh = gw * GUIDE_RATIO
        val gl = (w - gw) / 2
        val gt = (h - gh) / 2

        recognizer.process(image)
            .addOnSuccessListener { text ->
                val lines = text.textBlocks.flatMap { it.lines }.mapNotNull { line ->
                    val b = line.boundingBox ?: return@mapNotNull null
                    val inGuide = b.centerX() in gl.toInt()..(gl + gw).toInt() &&
                        b.centerY() in gt.toInt()..(gt + gh).toInt()
                    if (inGuide) BikeIdParser.OcrLine(line.text, b.left, b.top, b.right, b.bottom) else null
                }
                val id = BikeIdParser.parse(lines).firstOrNull()
                if (id != null && id == last) streak++ else streak = if (id != null) 1 else 0
                last = id
                if (id != null && streak == stableFrames) onDetected(id)
            }
            .addOnCompleteListener { proxy.close() }
    }

    fun close() = recognizer.close()
}
