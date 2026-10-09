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
data class StationRef(val id: String, val name: String)

@Serializable
data class BikeLocation(val station: StationRef, val at: String)

@Serializable
data class NearStation(val id: String, val name: String, val distance: Int)

@Serializable
data class BikeInfo(
    val id: String,
    val count: Int,
    val scores: Scores? = null,
    val recent: List<RecentRating>,
    /** 最後一次有定位的還車站點 */
    val location: BikeLocation? = null,
    /** 只有送出評分的回應才有：這次比對到的站點 */
    val station: NearStation? = null,
)

@Serializable
data class ExcellentBike(val id: String, val at: String, val scores: Scores)

@Serializable
data class StationSummary(
    val id: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val count: Int,
    val scores: Scores,
    val avg: Double,
    val excellent: List<ExcellentBike>,
)

@Serializable
data class MapData(val excellentMin: Double, val maxAgeDays: Int, val stations: List<StationSummary>)

data class Position(val lat: Double, val lng: Double)

@Serializable
private data class NearestResponse(val station: NearStation? = null)

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

    /** pos 有給就會比對還車站點 */
    suspend fun rate(id: String, scores: Map<String, Int>, pos: Position? = null): BikeInfo {
        val fields = scores.entries.map { "\"${it.key}\":${it.value}" } +
            listOfNotNull(pos?.let { "\"lat\":${it.lat},\"lng\":${it.lng}" })
        val body = fields.joinToString(",", "{", "}")
        return json.decodeFromJsonElement(request("/bikes/$id/ratings", "POST", body, needAuth = true).body)
    }

    suspend fun nearestStation(pos: Position): NearStation? =
        json.decodeFromJsonElement<NearestResponse>(
            request("/stations/nearest", "POST", "{\"lat\":${pos.lat},\"lng\":${pos.lng}}").body,
        ).station

    suspend fun getMap(): MapData = json.decodeFromJsonElement(request("/map").body)
}
