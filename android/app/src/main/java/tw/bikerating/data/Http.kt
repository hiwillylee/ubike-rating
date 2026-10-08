package tw.bikerating.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

internal val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

internal val http = OkHttpClient.Builder()
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()

internal class HttpResult(val code: Int, val body: JsonObject)

/** 送出 JSON 請求；網路錯誤丟 IOException，其餘交給呼叫端判斷 code */
internal suspend fun sendJson(
    url: String,
    method: String = "GET",
    body: String? = null,
    headers: Map<String, String> = emptyMap(),
    contentType: String = "application/json",
): HttpResult = withContext(Dispatchers.IO) {
    val req = Request.Builder().url(url).apply {
        headers.forEach { (k, v) -> header(k, v) }
        method(method, body?.toRequestBody(contentType.toMediaType()))
    }.build()
    http.newCall(req).execute().use { res ->
        val text = res.body?.string().orEmpty()
        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrDefault(JsonObject(emptyMap()))
        HttpResult(res.code, obj)
    }
}

class AppException(val code: String, message: String, val status: Int = 0) : Exception(message)

internal fun networkError(e: IOException) = AppException("network", "網路連線失敗")
