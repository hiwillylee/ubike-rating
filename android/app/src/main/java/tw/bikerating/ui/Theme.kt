package tw.bikerating.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFFF5A400)

/** 依分數 1~4 給顏色（與網頁版一致） */
@Composable
fun levelColor(v: Double): Color {
    val dark = isSystemInDarkTheme()
    return when {
        v >= 3.5 -> if (dark) Color(0xFF51CF66) else Color(0xFF2F9E44)
        v >= 2.5 -> if (dark) Color(0xFFA9E34B) else Color(0xFF74B816)
        v >= 1.5 -> if (dark) Color(0xFFFFA94D) else Color(0xFFF08C00)
        else -> if (dark) Color(0xFFFF6B6B) else Color(0xFFE03131)
    }
}

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val scheme = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = Accent, onPrimary = Color(0xFF1D1D1B))
    } else {
        lightColorScheme(primary = Accent, onPrimary = Color(0xFF1D1D1B))
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
