package tw.bikerating.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import tw.bikerating.data.AppException
import tw.bikerating.data.AuthRepo

private enum class Mode { SignIn, SignUp, Confirm }

@Composable
fun LoginScreen(modifier: Modifier, auth: AuthRepo, onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(Mode.SignIn) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var info by remember { mutableStateOf<String?>(null) }

    fun act(block: suspend () -> Unit) = scope.launch {
        busy = true; error = null; info = null
        try {
            block()
        } catch (e: AppException) {
            if (e.code == "UserNotConfirmedException") {
                mode = Mode.Confirm
                info = "請輸入驗證碼"
            } else {
                error = e.message
            }
        } finally {
            busy = false
        }
    }

    fun submit() = when (mode) {
        Mode.SignIn -> act { auth.signIn(email, password); onDone() }
        Mode.SignUp -> act {
            auth.signUp(email, password)
            mode = Mode.Confirm
            info = "驗證碼已寄到你的信箱"
        }
        Mode.Confirm -> act {
            auth.confirmSignUp(email, code)
            auth.signIn(email, password)
            onDone()
        }
    }

    Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            when (mode) { Mode.SignIn -> "登入"; Mode.SignUp -> "註冊"; Mode.Confirm -> "驗證 Email" },
            style = MaterialTheme.typography.headlineSmall,
        )

        OutlinedTextField(
            value = email, onValueChange = { email = it.trim() }, label = { Text("Email") },
            singleLine = true, enabled = mode != Mode.Confirm,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("密碼") },
            singleLine = true, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            supportingText = if (mode == Mode.SignUp) ({ Text("至少 8 碼，需包含數字") }) else null,
            modifier = Modifier.fillMaxWidth(),
        )
        if (mode == Mode.Confirm) {
            OutlinedTextField(
                value = code, onValueChange = { code = it.trim() }, label = { Text("驗證碼") },
                singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
        }

        info?.let { Text(it, color = levelColor(4.0)) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        Button(onClick = { submit() }, enabled = !busy && email.isNotBlank() && password.length >= 8,
            modifier = Modifier.fillMaxWidth()) {
            Text(if (busy) "處理中…" else when (mode) {
                Mode.SignIn -> "登入"; Mode.SignUp -> "註冊"; Mode.Confirm -> "驗證並登入"
            })
        }

        when (mode) {
            Mode.SignIn -> TextButton(onClick = { mode = Mode.SignUp }) { Text("還沒有帳號？註冊") }
            Mode.SignUp -> TextButton(onClick = { mode = Mode.SignIn }) { Text("已有帳號？登入") }
            Mode.Confirm -> TextButton(onClick = { act { auth.resendCode(email); info = "已重新寄送驗證碼" } }, enabled = !busy) {
                Text("重新寄送驗證碼")
            }
        }
    }
}
