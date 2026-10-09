package tw.bikerating.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.RectF
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import tw.bikerating.ocr.BikeIdAnalyzer
import tw.bikerating.ocr.GUIDE_MAX_WIDTH_DP
import tw.bikerating.ocr.GUIDE_RATIO
import tw.bikerating.ocr.GUIDE_WIDTH
import tw.bikerating.ocr.PaddleOcr
import java.util.concurrent.Executors

/** 首頁：「拍攝車號」打開全螢幕掃描，下面可以手動輸入 */
@Composable
fun ScanScreen(modifier: Modifier, onFound: (String) -> Unit, onCapture: () -> Unit) {
    val context = LocalContext.current
    // 先在背景載入 OCR 模型，打開掃描時就能馬上辨識
    LaunchedEffect(Unit) { withContext(Dispatchers.Default) { runCatching { PaddleOcr.get(context) } } }

    var input by remember { mutableStateOf("") }
    val valid = Regex("^\\d{7}$").matches(input)

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("查詢車況", style = MaterialTheme.typography.headlineSmall)

        Button(onClick = onCapture, modifier = Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
            Text("📷 拍攝車號", fontSize = 18.sp)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.filter(Char::isDigit).take(7) },
                placeholder = { Text("或手動輸入 7 碼車號") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { if (valid) onFound(input) }),
                modifier = Modifier.weight(1f),
            )
            Button(onClick = { onFound(input) }, enabled = valid) { Text("查詢") }
        }
    }
}

private val Ink = Color(0xFF1D1D1B)

/**
 * 全螢幕掃描（外觀同網頁版）：預覽鋪滿畫面，框外蓋半透明白色，框內原色。
 * 不用快門，持續只辨識框內畫面；連續兩次相同就跳出結果面板。
 */
@Composable
fun CaptureScreen(onFound: (String) -> Unit, onClose: () -> Unit) {
    val context = LocalContext.current
    var hasPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var camError by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        hasPermission = it
        camError = !it
    }
    LaunchedEffect(Unit) { if (!hasPermission) launcher.launch(Manifest.permission.CAMERA) }

    var found by remember { mutableStateOf<String?>(null) }
    val analyzer = remember {
        BikeIdAnalyzer(ocr = { PaddleOcr.get(context) }, onDetected = { id ->
            ContextCompat.getMainExecutor(context).execute { found = id }
        })
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val density = LocalDensity.current
        val guideW = minOf(maxWidth * GUIDE_WIDTH, GUIDE_MAX_WIDTH_DP.dp)
        val guideH = guideW * GUIDE_RATIO
        // 網頁版是「提示文字 + 框」整組置中在 42% 高度；提示約 28dp 高、與框間隔 16dp
        val tipBlock = 28.dp + 16.dp
        val guideTop = maxHeight * 0.42f - (guideH + tipBlock) / 2 + tipBlock
        val guideLeft = (maxWidth - guideW) / 2

        // 告訴分析器對準框在預覽中的比例位置
        analyzer.viewAspect = maxWidth / maxHeight
        analyzer.guide = RectF(
            guideLeft / maxWidth, guideTop / maxHeight,
            (guideLeft + guideW) / maxWidth, (guideTop + guideH) / maxHeight,
        )

        if (hasPermission) {
            CameraPreview(analyzer, onError = { camError = true })
        }

        // 遮罩與四角標記
        Canvas(Modifier.fillMaxSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            val l = guideLeft.toPx()
            val t = guideTop.toPx()
            val w = guideW.toPx()
            val h = guideH.toPx()
            val radius = 14.dp.toPx()
            drawRect(Color.White.copy(alpha = 0.72f))
            drawRoundRect(Color.Transparent, Offset(l, t), Size(w, h), CornerRadius(radius), blendMode = BlendMode.Clear)

            val len = 28.dp.toPx()
            val r = 12.dp.toPx()
            val stroke = Stroke(width = 4.dp.toPx())
            fun corner(x: Float, y: Float, sx: Float, sy: Float) {
                // (x, y) 是角點，sx/sy 是往框內的方向
                val p = Path().apply {
                    moveTo(x, y + sy * len)
                    lineTo(x, y + sy * r)
                    quadraticTo(x, y, x + sx * r, y)
                    lineTo(x + sx * len, y)
                }
                drawPath(p, Accent, style = stroke)
            }
            corner(l, t, 1f, 1f)
            corner(l + w, t, -1f, 1f)
            corner(l, t + h, 1f, -1f)
            corner(l + w, t + h, -1f, -1f)
        }

        // 提示文字（畫在遮罩上面）
        Text(
            if (camError) "開不了相機，請允許相機權限" else "請將車號對準框內",
            color = Ink,
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).offset(y = guideTop - tipBlock),
        )

        // 上方：關閉與標題
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = onClose, modifier = Modifier.size(48.dp), contentPadding = PaddingValues(0.dp)) {
                Text("✕", color = Ink, fontSize = 22.sp)
            }
            Text("拍攝車號", color = Ink, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            Spacer(Modifier.width(48.dp))
        }

        // 下方：辨識結果
        found?.let { id ->
            Surface(
                shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
                color = MaterialTheme.colorScheme.surface,
                shadowElevation = 8.dp,
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth(),
            ) {
                Column(
                    Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("辨識到車號，點一下查看", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedButton(onClick = { onFound(id) }, shape = RoundedCornerShape(50)) {
                        Text("${id.take(2)} ${id.drop(2)}", fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                    }
                    Button(onClick = { found = null; analyzer.resume() }, modifier = Modifier.fillMaxWidth()) {
                        Text("重新掃描")
                    }
                }
            }
        }
    }
}

@Composable
private fun CameraPreview(analyzer: BikeIdAnalyzer, onError: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    val executor = remember { Executors.newSingleThreadExecutor() }

    DisposableEffect(lifecycleOwner) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        var disposed = false
        fun bind() {
            if (disposed) return
            try {
                val provider = providerFuture.get()
                // 預覽與分析都用 4:3，再用 ViewPort 讓分析影像的 cropRect 對應到畫面上看得到的範圍
                val selector = ResolutionSelector.Builder()
                    .setAspectRatioStrategy(AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY)
                    .build()
                val preview = Preview.Builder().setResolutionSelector(selector).build()
                    .also { it.surfaceProvider = previewView.surfaceProvider }
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(selector)
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                    .build()
                    .also { it.setAnalyzer(executor, analyzer) }
                val group = UseCaseGroup.Builder().addUseCase(preview).addUseCase(analysis)
                previewView.viewPort?.let { group.setViewPort(it) }
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, group.build())
            } catch (e: Exception) {
                onError()
            }
        }
        // 等 PreviewView 排版完成（viewPort 才有值）再綁定
        providerFuture.addListener({ previewView.post { bind() } }, ContextCompat.getMainExecutor(context))

        onDispose {
            disposed = true
            runCatching { providerFuture.get().unbindAll() }
            executor.shutdown()
        }
    }

    AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
}
