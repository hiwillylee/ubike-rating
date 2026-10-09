package tw.bikerating.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.graphics.StrokeJoin

private const val MAX_STARS = 4

// 與網頁版相同的星形（24x24 座標）
private val STAR_POINTS = listOf(
    12f to 2.6f, 14.9f to 8.8f, 21.7f to 9.6f, 16.7f to 14.3f, 18f to 21f,
    12f to 17.6f, 6f to 21f, 7.3f to 14.3f, 2.3f to 9.6f, 9.1f to 8.8f,
)

@Composable
private fun starColors(): Pair<Color, Color> =
    if (isSystemInDarkTheme()) Color(0xFFFFB81F) to Color(0xFF5C5C55)
    else Color(0xFFF5A400) to Color(0xFFB9B9B2)

/** 單顆星：外框一定畫，實心部分依 fill (0~1) 從左往右裁切 */
@Composable
private fun Star(fill: Float, size: Dp, modifier: Modifier = Modifier) {
    val (on, off) = starColors()
    Canvas(modifier.size(size)) {
        val k = this.size.width / 24f
        val path = Path().apply {
            STAR_POINTS.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(x * k, y * k) else lineTo(x * k, y * k) }
            close()
        }
        val stroke = Stroke(width = 1.6f * k, join = StrokeJoin.Round)
        drawPath(path, off, style = stroke)
        if (fill > 0f) {
            clipRect(right = this.size.width * fill.coerceAtMost(1f)) {
                drawPath(path, on)
                drawPath(path, on, style = stroke)
            }
        }
    }
}

/** 顯示分數（1~4，可為小數，例如 3.4 會亮 3 顆加 0.4 顆） */
@Composable
fun StarDisplay(value: Double, size: Dp = 20.dp, modifier: Modifier = Modifier) {
    Row(
        modifier.semantics { contentDescription = "%.1f 顆星（滿分 $MAX_STARS）".format(value) },
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        repeat(MAX_STARS) { i -> Star((value - i).toFloat().coerceIn(0f, 1f), size) }
    }
}

/** 點選評分：點第 n 顆，前 n 顆都會亮 */
@Composable
fun StarInput(value: Int?, labels: List<String>, onChange: (Int) -> Unit, size: Dp = 40.dp) {
    Row(Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        repeat(MAX_STARS) { i ->
            val score = i + 1
            Star(
                fill = if (value != null && score <= value) 1f else 0f,
                size = size,
                modifier = Modifier
                    .selectable(selected = value == score, role = Role.RadioButton, onClick = { onChange(score) })
                    .semantics { contentDescription = "$score 顆星：${labels[i]}" },
            )
        }
    }
}
