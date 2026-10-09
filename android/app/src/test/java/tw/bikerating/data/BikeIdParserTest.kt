package tw.bikerating.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File

class BikeIdParserTest {

    /** 讀取與網頁版共用的測試案例 */
    @Test
    fun sharedCases() {
        val root = Json.parseToJsonElement(File("../../shared/bike-id-cases.json").readText()).jsonObject
        val layout = root["layout"]!!.jsonArray.map { it.jsonPrimitive.int }
        for (c in root["cases"]!!.jsonArray.map { it.jsonObject }) {
            val lines = c["lines"]!!.jsonArray.map { it.jsonObject.toLine() }
            val got = BikeIdParser.parse(lines, layout).firstOrNull()
            assertEquals(c["name"]!!.jsonPrimitive.content, c["expect"]!!.jsonPrimitive.contentOrNull, got)
        }
    }

    @Test
    fun doesNotFabricateDigitsFromWords() {
        assertEquals("", BikeIdParser.toDigits("YouBike"))
        assertEquals("20", BikeIdParser.toDigits("YouBike 2.0"))
    }

    /** 實拍：破損的 0 被 OCR 讀成 G，不能把它當成 6 造出別台車的車號 */
    @Test
    fun doesNotMapGTo6() {
        val lines = listOf(
            BikeIdParser.OcrLine("13", 275, 84, 408, 182),
            BikeIdParser.OcrLine("0G474", 155, 141, 483, 312),
        )
        assertEquals(emptyList<String>(), BikeIdParser.parse(lines))
    }

    private fun JsonObject.toLine(): BikeIdParser.OcrLine {
        val b = this["box"]!!.jsonArray.map { it.jsonPrimitive.int }
        return BikeIdParser.OcrLine(this["text"]!!.jsonPrimitive.content, b[0], b[1], b[2], b[3])
    }
}
