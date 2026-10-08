package tw.bikerating.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.JsonObject
import tw.bikerating.BuildConfig
import java.io.IOException

/** 直接呼叫 Cognito User Pool REST API（與網頁版相同做法，不用 Amplify） */
class AuthRepo(context: Context) {
    private val endpoint = "https://cognito-idp.${BuildConfig.COGNITO_REGION}.amazonaws.com/"
    private val clientId = BuildConfig.COGNITO_CLIENT_ID

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "session",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val _email = MutableStateFlow(prefs.getString("email", null))
    val email: StateFlow<String?> = _email

    private val errors = mapOf(
        "UsernameExistsException" to "這個 Email 已經註冊過了",
        "UserNotFoundException" to "帳號或密碼錯誤",
        "NotAuthorizedException" to "帳號或密碼錯誤",
        "UserNotConfirmedException" to "帳號尚未完成 Email 驗證",
        "CodeMismatchException" to "驗證碼錯誤",
        "ExpiredCodeException" to "驗證碼已過期，請重新寄送",
        "InvalidPasswordException" to "密碼至少 8 碼且需包含數字",
        "InvalidParameterException" to "輸入格式有誤",
        "LimitExceededException" to "嘗試次數太多，請稍後再試",
        "TooManyRequestsException" to "嘗試次數太多，請稍後再試",
    )

    private suspend fun call(target: String, body: JsonObject): JsonObject {
        val payload = JsonObject(body + ("ClientId" to kotlinx.serialization.json.JsonPrimitive(clientId)))
        val res = try {
            sendJson(
                endpoint, "POST", payload.toString(),
                headers = mapOf("X-Amz-Target" to "AWSCognitoIdentityProviderService.$target"),
                contentType = "application/x-amz-json-1.1",
            )
        } catch (e: IOException) {
            throw networkError(e)
        }
        if (res.code !in 200..299) {
            val code = res.body["__type"]?.jsonPrimitive?.content?.substringAfterLast('#') ?: "Unknown"
            val msg = errors[code] ?: res.body["message"]?.jsonPrimitive?.content ?: "登入服務發生錯誤"
            throw AppException(code, msg, res.code)
        }
        return res.body
    }

    suspend fun signUp(email: String, password: String) {
        call("SignUp", buildJsonObject {
            put("Username", email)
            put("Password", password)
            putJsonArray("UserAttributes") {
                addJsonObject { put("Name", "email"); put("Value", email) }
            }
        })
    }

    suspend fun confirmSignUp(email: String, code: String) {
        call("ConfirmSignUp", buildJsonObject { put("Username", email); put("ConfirmationCode", code) })
    }

    suspend fun resendCode(email: String) {
        call("ResendConfirmationCode", buildJsonObject { put("Username", email) })
    }

    suspend fun signIn(email: String, password: String) {
        val r = call("InitiateAuth", buildJsonObject {
            put("AuthFlow", "USER_PASSWORD_AUTH")
            putJsonObject("AuthParameters") { put("USERNAME", email); put("PASSWORD", password) }
        })["AuthenticationResult"]!!.jsonObject
        prefs.edit()
            .putString("email", email)
            .putString("idToken", r["IdToken"]!!.jsonPrimitive.content)
            .putString("refreshToken", r["RefreshToken"]?.jsonPrimitive?.content.orEmpty())
            .putLong("expiresAt", System.currentTimeMillis() + r["ExpiresIn"]!!.jsonPrimitive.int * 1000L)
            .apply()
        _email.value = email
    }

    fun signOut() {
        prefs.edit().clear().apply()
        _email.value = null
    }

    /** 取得有效的 IdToken（快過期會自動換新）；未登入回傳 null */
    suspend fun idToken(): String? {
        val token = prefs.getString("idToken", null) ?: return null
        if (System.currentTimeMillis() < prefs.getLong("expiresAt", 0) - 60_000) return token
        return try {
            val r = call("InitiateAuth", buildJsonObject {
                put("AuthFlow", "REFRESH_TOKEN_AUTH")
                putJsonObject("AuthParameters") { put("REFRESH_TOKEN", prefs.getString("refreshToken", "")) }
            })["AuthenticationResult"]!!.jsonObject
            val newToken = r["IdToken"]!!.jsonPrimitive.content
            prefs.edit()
                .putString("idToken", newToken)
                .putLong("expiresAt", System.currentTimeMillis() + r["ExpiresIn"]!!.jsonPrimitive.int * 1000L)
                .apply()
            newToken
        } catch (e: AppException) {
            if (e.code == "network") throw e
            signOut()
            null
        }
    }
}
