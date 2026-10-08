package tw.bikerating.data

data class Metric(val key: String, val label: String, val levels: List<String>)

val METRICS = listOf(
    Metric("clean", "乾淨程度", listOf("很髒", "有點髒", "尚可", "乾淨")),
    Metric("gear", "變速器", listOf("無法變速", "常跳檔", "偶爾不順", "順暢")),
    Metric("frame", "車體（輪框、龍頭）", listOf("明顯歪斜", "有點歪", "輕微", "正常")),
)
