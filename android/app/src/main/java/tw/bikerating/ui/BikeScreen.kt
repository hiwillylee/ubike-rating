package tw.bikerating.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import tw.bikerating.data.ApiClient
import tw.bikerating.data.AppException
import tw.bikerating.data.BikeInfo
import tw.bikerating.data.METRICS
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val timeFmt = DateTimeFormatter.ofPattern("MM/dd HH:mm").withZone(ZoneId.systemDefault())

@Composable
fun BikeScreen(
    modifier: Modifier,
    bikeId: String,
    api: ApiClient,
    isLoggedIn: Boolean,
    onNeedLogin: () -> Unit,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var info by remember { mutableStateOf<BikeInfo?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    val form = remember { mutableStateMapOf<String, Int>() }
    var submitting by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<Boolean, String>?>(null) }

    LaunchedEffect(bikeId) {
        try {
            info = api.getBike(bikeId)
        } catch (e: AppException) {
            loadError = e.message
        }
    }

    val complete = METRICS.all { form[it.key] != null }

    fun submit() {
        if (!isLoggedIn) return onNeedLogin()
        scope.launch {
            submitting = true
            message = null
            try {
                info = api.rate(bikeId, form.toMap())
                form.clear()
                message = true to "已送出，謝謝！"
            } catch (e: AppException) {
                if (e.status == 401) onNeedLogin() else message = false to (e.message ?: "發生錯誤")
            } finally {
                submitting = false
            }
        }
    }

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TextButton(onClick = onBack) { Text("← 重新掃描") }
        Text("${bikeId.take(2)} ${bikeId.drop(2)}", fontSize = 36.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("目前車況", style = MaterialTheme.typography.titleMedium)
                val i = info
                when {
                    loadError != null -> Text(loadError!!, color = MaterialTheme.colorScheme.error)
                    i == null -> Text("載入中…")
                    i.scores == null -> Text("還沒人評分，來當第一個吧")
                    else -> {
                        METRICS.forEach { m ->
                            val v = i.scores[m.key]
                            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(m.label)
                                    Text(
                                        "%.1f · %s".format(v, m.levels[Math.round(v).toInt().coerceIn(1, 4) - 1]),
                                        fontWeight = FontWeight.Bold,
                                    )
                                }
                                StarDisplay(v, size = 22.dp)
                            }
                        }
                    }
                }
            }
        }

        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("我要評分", style = MaterialTheme.typography.titleMedium)
                METRICS.forEach { m ->
                    val v = form[m.key]
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(m.label, style = MaterialTheme.typography.bodyMedium)
                        StarInput(v, m.levels, onChange = { form[m.key] = it })
                        if (v != null) {
                            Text(
                                m.levels[v - 1],
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                message?.let { (ok, text) ->
                    Text(text, color = if (ok) levelColor(4.0) else MaterialTheme.colorScheme.error)
                }
                Button(onClick = ::submit, enabled = complete && !submitting, modifier = Modifier.fillMaxWidth()) {
                    Text(if (submitting) "送出中…" else if (isLoggedIn) "送出評分" else "登入後送出")
                }
            }
        }

        info?.recent?.takeIf { it.isNotEmpty() }?.let { recent ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("最近紀錄", style = MaterialTheme.typography.titleMedium)
                    Row {
                        Text("時間", Modifier.weight(1.4f), fontWeight = FontWeight.Bold)
                        METRICS.forEach { Text(it.label.take(3), Modifier.weight(1f), fontWeight = FontWeight.Bold) }
                    }
                    recent.forEach { r ->
                        Row {
                            Text(timeFmt.format(Instant.parse(r.at)), Modifier.weight(1.4f))
                            METRICS.forEach { m ->
                                StarDisplay(r[m.key].toDouble(), size = 12.dp, modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }
            }
        }
    }
}
