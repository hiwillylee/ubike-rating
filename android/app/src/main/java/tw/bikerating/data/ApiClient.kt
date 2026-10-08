package tw.bikerating.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonPrimitive
import tw.bikerating.BuildConfig
import java.io.IOException

@Serializable
data class Scores(val clean: Double, val gear: Double, val frame: Double) {
    operator fun get(key: String) = when (key) {
        "clean" -> clean
        "gear" -> gear
        else -> frame
    }
}

@Serializable
data class RecentRating(val clean: Int, val gear: Int, val frame: Int, val at: String) {
    operator fun get(key: String) = when (key) {
        "clean" -> clean
        "gear" -> gear
        else -> frame
    }
}

@Serializable
data class BikeInfo(val id: String, val count: Int, val scores: Scores? = null, val recent: List<RecentRating>)

class ApiClient(private val auth: AuthRepo) {
    private val base = BuildConfig.API_URL.trimEnd('/')

    private suspend fun request(path: String, method: String = "GET", body: String? = null, needAuth: Boolean = false): HttpResult {
        val headers = mutableMapOf<String, String>()
        if (needAuth) {
            val token = auth.idToken() ?: throw AppException("unauthorized", "請先登入", 401)
            headers["Authorization"] = "Bearer $token"
        }
        val res = try {
            sendJson(base + path, method, body, headers)
        } catch (e: IOException) {
            throw networkError(e)
        }
        if (res.code !in 200..299) {
            throw AppException(
                res.body["error"]?.jsonPrimitive?.content ?: "error",
                res.body["message"]?.jsonPrimitive?.content ?: "發生錯誤",
                res.code,
            )
        }
        return res
    }

    suspend fun getBike(id: String): BikeInfo =
        json.decodeFromJsonElement(request("/bikes/$id").body)

    suspend fun rate(id: String, scores: Map<String, Int>): BikeInfo {
        val body = scores.entries.joinToString(",", "{", "}") { "\"${it.key}\":${it.value}" }
        return json.decodeFromJsonElement(request("/bikes/$id/ratings", "POST", body, needAuth = true).body)
    }
}
