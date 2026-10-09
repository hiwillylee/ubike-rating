package tw.bikerating.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import tw.bikerating.data.ApiClient
import tw.bikerating.data.AuthRepo

sealed interface Screen {
    data object Scan : Screen
    data object Capture : Screen
    data class Bike(val id: String) : Screen
    data object Login : Screen
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val auth = AuthRepo(applicationContext)
        val api = ApiClient(auth)
        setContent { AppTheme { App(auth, api) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(auth: AuthRepo, api: ApiClient) {
    // 簡單的返回堆疊
    val stack = remember { mutableStateListOf<Screen>(Screen.Scan) }
    val screen = stack.last()
    val email by auth.email.collectAsState()
    fun go(s: Screen) = stack.add(s)
    fun back() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }

    BackHandler(enabled = stack.size > 1) { back() }

    // 全螢幕掃描不放在 Scaffold 裡；辨識到車號後以車輛頁取代掃描畫面，返回時回到首頁
    if (screen == Screen.Capture) {
        CaptureScreen(
            onFound = { id -> back(); go(Screen.Bike(id)) },
            onClose = { back() },
        )
        return
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("🚲 單車車況") },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    titleContentColor = MaterialTheme.colorScheme.onPrimary,
                ),
                actions = {
                    if (email != null) {
                        TextButton(onClick = { auth.signOut() }) { Text("登出", color = MaterialTheme.colorScheme.onPrimary) }
                    } else if (screen != Screen.Login) {
                        TextButton(onClick = { go(Screen.Login) }) { Text("登入", color = MaterialTheme.colorScheme.onPrimary) }
                    }
                },
            )
        },
    ) { padding ->
        val m = Modifier.padding(padding)
        when (screen) {
            Screen.Scan -> ScanScreen(m, onFound = { go(Screen.Bike(it)) }, onCapture = { go(Screen.Capture) })
            Screen.Capture -> Unit
            is Screen.Bike -> BikeScreen(m, screen.id, api, isLoggedIn = email != null,
                onNeedLogin = { go(Screen.Login) }, onBack = { back() })
            Screen.Login -> LoginScreen(m, auth, onDone = { back() })
        }
    }
}
