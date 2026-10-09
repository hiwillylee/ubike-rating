package tw.bikerating.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.os.CancellationSignal
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Duration
import java.time.Instant
import kotlin.coroutines.resume

val LOCATION_PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

fun hasLocationPermission(context: Context) = LOCATION_PERMISSIONS.any {
    ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
}

/** 取得目前位置：同時向所有開啟的定位來源要，先回來的就用；沒有權限、沒開定位或逾時都回傳 null */
@SuppressLint("MissingPermission")
suspend fun currentPosition(context: Context, timeoutMs: Long = 10_000): Position? {
    if (!hasLocationPermission(context)) return null
    val lm = context.getSystemService(LocationManager::class.java) ?: return null
    val providers = listOf(LocationManager.FUSED_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
        .filter { runCatching { lm.isProviderEnabled(it) }.getOrDefault(false) }
    if (providers.isEmpty()) return null
    return withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine { cont ->
            val signals = providers.map { CancellationSignal() }
            var pending = providers.size
            cont.invokeOnCancellation { signals.forEach(CancellationSignal::cancel) }
            providers.forEachIndexed { i, provider ->
                LocationManagerCompat.getCurrentLocation(lm, provider, signals[i], ContextCompat.getMainExecutor(context)) { loc ->
                    pending--
                    if (!cont.isActive) return@getCurrentLocation
                    if (loc != null) {
                        signals.forEach(CancellationSignal::cancel)
                        cont.resume(Position(loc.latitude, loc.longitude))
                    } else if (pending == 0) {
                        cont.resume(null)
                    }
                }
            }
        }
    }
}

fun timeAgo(iso: String, now: Instant = Instant.now()): String {
    val min = Duration.between(Instant.parse(iso), now).toMinutes()
    return when {
        min < 1 -> "剛剛"
        min < 60 -> "$min 分鐘前"
        min < 24 * 60 -> "${min / 60} 小時前"
        else -> "${min / 1440} 天前"
    }
}
