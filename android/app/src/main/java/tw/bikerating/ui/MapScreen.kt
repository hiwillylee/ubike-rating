package tw.bikerating.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.MarkerComposable
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberMarkerState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import tw.bikerating.BuildConfig
import tw.bikerating.data.ApiClient
import tw.bikerating.data.AppException
import tw.bikerating.data.LOCATION_PERMISSIONS
import tw.bikerating.data.METRICS
import tw.bikerating.data.MapData
import tw.bikerating.data.StationSummary
import tw.bikerating.data.currentPosition
import tw.bikerating.data.hasLocationPermission
import tw.bikerating.data.timeAgo
import tw.bikerating.ocr.PaddleOcr

private val TAIPEI = LatLng(25.0418, 121.5371)
private val Ink = Color(0xFF1D1D1B)

/** 首頁地圖：各站平均分數，有極品車的站加上 ★數量；底下是掃描按鈕 */
@Composable
fun MapScreen(modifier: Modifier, api: ApiClient, onOpenBike: (String) -> Unit, onScan: () -> Unit) {
    val context = LocalContext.current
    // 先在背景載入 OCR 模型，按掃描時就能馬上辨識
    LaunchedEffect(Unit) { withContext(Dispatchers.Default) { runCatching { PaddleOcr.get(context) } } }
    var manualOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    var data by remember { mutableStateOf<MapData?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var onlyExcellent by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<StationSummary?>(null) }
    var myLocation by remember { mutableStateOf(hasLocationPermission(context)) }

    LaunchedEffect(Unit) {
        try {
            data = api.getMap()
        } catch (e: AppException) {
            error = e.message
        }
    }

    val stations = data?.stations.orEmpty()
    val shown = stations.filter { !onlyExcellent || it.excellent.isNotEmpty() }
    val excellentTotal = stations.sumOf { it.excellent.size }

    val camera = rememberCameraPositionState { position = CameraPosition.fromLatLngZoom(TAIPEI, 13f) }
    var mapLoaded by remember { mutableStateOf(false) }
    // 第一次拿到資料時把所有站點放進畫面
    LaunchedEffect(mapLoaded, data) {
        if (!mapLoaded || stations.isEmpty()) return@LaunchedEffect
        val b = LatLngBounds.builder().apply { stations.forEach { include(LatLng(it.lat, it.lng)) } }.build()
        runCatching { camera.move(CameraUpdateFactory.newLatLngBounds(b, 120)) }
        if (camera.position.zoom > 15f) camera.move(CameraUpdateFactory.zoomTo(15f))
    }

    fun moveToMe() = scope.launch {
        myLocation = hasLocationPermission(context)
        currentPosition(context)?.let { camera.animate(CameraUpdateFactory.newLatLngZoom(LatLng(it.lat, it.lng), 16f)) }
    }
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { moveToMe() }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                when {
                    error != null -> error!!
                    data == null -> "載入中…"
                    stations.isEmpty() -> "還沒有人在還車時評分，來當第一個吧"
                    else -> "極品車 $excellentTotal 台 · ${stations.size} 站有資料"
                },
                Modifier.weight(1f),
                style = MaterialTheme.typography.bodyMedium,
                color = if (error != null) MaterialTheme.colorScheme.error else Color.Unspecified,
            )
            FilterChip(selected = onlyExcellent, onClick = { onlyExcellent = !onlyExcellent }, label = { Text("只看極品") })
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (BuildConfig.HAS_MAPS_KEY) {
                GoogleMap(
                    modifier = Modifier.fillMaxSize(),
                    cameraPositionState = camera,
                    properties = MapProperties(isMyLocationEnabled = myLocation),
                    uiSettings = MapUiSettings(myLocationButtonEnabled = false, zoomControlsEnabled = false, mapToolbarEnabled = false),
                    onMapLoaded = { mapLoaded = true },
                    onMapClick = { selected = null },
                ) {
                    shown.forEach { s ->
                        MarkerComposable(
                            s.id, s.avg, s.excellent.size,
                            state = rememberMarkerState(key = s.id, position = LatLng(s.lat, s.lng)),
                            title = s.name,
                            onClick = { selected = s; true },
                        ) { StationPin(s) }
                    }
                }
                SmallFloatingActionButton(
                    onClick = { if (hasLocationPermission(context)) moveToMe() else permLauncher.launch(LOCATION_PERMISSIONS) },
                    modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 16.dp, bottom = 128.dp),
                ) { Text("📍", fontSize = 18.sp) }
            } else {
                // 還沒設定 Google 地圖金鑰時用清單顯示
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 140.dp)) {
                    item {
                        Text(
                            "尚未設定 Google 地圖金鑰，先用清單顯示",
                            Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(shown.sortedByDescending { it.excellent.size * 10 + it.avg }, key = { it.id }) { s ->
                        Row(
                            Modifier.fillMaxWidth().clickable { selected = s }.padding(horizontal = 16.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            StationPin(s)
                            Text(s.name, Modifier.weight(1f))
                        }
                        HorizontalDivider()
                    }
                }
            }

            ScanBar(onScan, onManual = { manualOpen = true }, Modifier.align(Alignment.BottomCenter))

            selected?.let { s ->
                StationSheet(s, data?.maxAgeDays ?: 7, onOpenBike, onClose = { selected = null }, Modifier.align(Alignment.BottomCenter))
            }
        }
    }

    if (manualOpen) ManualDialog(onDismiss = { manualOpen = false }, onFound = { manualOpen = false; onOpenBike(it) })
}

@Composable
private fun ScanBar(onScan: () -> Unit, onManual: () -> Unit, modifier: Modifier) {
    Column(
        modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth(), contentPadding = PaddingValues(16.dp)) {
            Text("📷 還車了？掃車號評分", fontSize = 18.sp)
        }
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.9f), modifier = Modifier.padding(top = 6.dp)) {
            TextButton(onClick = onManual) { Text("手動輸入車號") }
        }
    }
}

@Composable
private fun ManualDialog(onDismiss: () -> Unit, onFound: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    val valid = Regex("^\\d{7}$").matches(input)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("輸入車號") },
        text = {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it.filter(Char::isDigit).take(7) },
                placeholder = { Text("7 碼數字") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { if (valid) onFound(input) }),
            )
        },
        confirmButton = { TextButton(onClick = { onFound(input) }, enabled = valid) { Text("查詢") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

/** 站點標記：圓圈顏色與數字是平均分數，右上角是極品車數量 */
@Composable
private fun StationPin(s: StationSummary) {
    Box(Modifier.size(52.dp, 46.dp)) {
        Box(
            Modifier.align(Alignment.BottomStart).size(40.dp)
                .background(levelColor(s.avg), CircleShape)
                .border(3.dp, Color.White, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text("%.1f".format(s.avg), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
        if (s.excellent.isNotEmpty()) {
            Text(
                "★${s.excellent.size}",
                Modifier.align(Alignment.TopEnd)
                    .background(Accent, RoundedCornerShape(50))
                    .border(2.dp, Color.White, RoundedCornerShape(50))
                    .padding(horizontal = 5.dp),
                color = Ink,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun StationSheet(
    s: StationSummary,
    maxAgeDays: Int,
    onOpenBike: (String) -> Unit,
    onClose: () -> Unit,
    modifier: Modifier,
) {
    Surface(
        modifier.fillMaxWidth().heightIn(max = 420.dp),
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
        shadowElevation = 8.dp,
    ) {
        Column(
            Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(s.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = onClose) { Text("關閉") }
            }
            Text(
                "最近 $maxAgeDays 天有 ${s.count} 台車在這裡還車",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            METRICS.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                    StarDisplay(s.scores[m.key], size = 16.dp)
                    Text("%.1f".format(s.scores[m.key]), Modifier.width(36.dp), textAlign = TextAlign.End, fontWeight = FontWeight.Bold)
                }
            }
            if (s.excellent.isNotEmpty()) {
                Text("極品車", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.titleSmall)
                s.excellent.forEach { b ->
                    Row(
                        Modifier.fillMaxWidth().clickable { onOpenBike(b.id) }.padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${b.id.take(2)} ${b.id.drop(2)}",
                            Modifier.weight(1f),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 1.sp,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            "${timeAgo(b.at)}還到這裡",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    "車可能已經被騎走了，到現場看看吧",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
