package tw.bikerating.data

import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * 車號解析：車上印成上下兩行（上 2 碼、下 5 碼），OCR 會分成多行，要依座標組回來。
 * 與網頁版 web/src/parseBikeId.ts 同一套規則，共用 shared/bike-id-cases.json 測試。
 */
object BikeIdParser {
    val LAYOUT = listOf(2, 5)

    data class OcrLine(val text: String, val left: Int, val top: Int, val right: Int, val bottom: Int)

    private val lookalike = mapOf(
        'O' to '0', 'o' to '0', 'D' to '0', 'Q' to '0',
        'I' to '1', 'l' to '1', '|' to '1', 'i' to '1',
        'Z' to '2', 'z' to '2',
        'S' to '5', 's' to '5',
        'G' to '6', 'b' to '6',
        'T' to '7',
        'B' to '8',
        'g' to '9', 'q' to '9',
    )

    /** 把一行文字轉成純數字；字母佔多數的行（如 "YouBike"）不做字形校正，避免誤造數字 */
    fun toDigits(text: String): String {
        val chars = text.filterNot { it.isWhitespace() }
        if (chars.isEmpty()) return ""
        val digitCount = chars.count { it in '0'..'9' }
        val mapped = if (digitCount * 2 >= chars.length) chars.map { lookalike[it] ?: it } else chars.toList()
        return mapped.filter { it in '0'..'9' }.joinToString("")
    }

    private class Line(val digits: String, val left: Int, val top: Int, val right: Int, val bottom: Int) {
        val height get() = bottom - top
    }

    /** b 是否在 a 正下方且距離合理；回傳間距，不合格回傳 null */
    private fun gapBelow(a: Line, b: Line): Int? {
        if (b.top < (a.top + a.bottom) / 2.0) return null
        if (min(a.right, b.right) - max(a.left, b.left) <= 0) return null
        val gap = b.top - a.bottom
        if (gap > 1.5 * max(a.height, b.height)) return null
        return gap
    }

    /** 回傳車號候選，最可能的排第一 */
    fun parse(input: List<OcrLine>, layout: List<Int> = LAYOUT): List<String> {
        val total = layout.sum()
        val lines = input
            .map { Line(toDigits(it.text), it.left, it.top, it.right, it.bottom) }
            .filter { it.digits.isNotEmpty() }
            .sortedBy { it.top }

        val found = mutableListOf<Pair<String, Long>>()

        fun walk(prev: Line, k: Int, acc: String, cost: Long) {
            if (k == layout.size) {
                found += acc to cost
                return
            }
            for (next in lines) {
                if (next === prev || next.digits.length != layout[k]) continue
                val gap = gapBelow(prev, next) ?: continue
                walk(next, k + 1, acc + next.digits, cost + abs(gap))
            }
        }
        for (first in lines) {
            if (first.digits.length == layout[0]) walk(first, 1, first.digits, 0)
        }

        // 容錯：OCR 把兩行黏成同一行
        for (l in lines) {
            if (l.digits.length == total) found += l.digits to Long.MAX_VALUE
        }

        return found.sortedBy { it.second }.map { it.first }.distinct()
    }
}
