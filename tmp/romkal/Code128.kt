package us.romkal.barcode


object Code128 {
  fun tryParse(segments: List<Int>): Int? {
    val values = segments.windowed(size = 6, step = 6, partialWindows = false)
      .map {
        it.fold(0) { a, d -> a * 10 + d }
      }
      .map { CODE_TO_VALUE[it] ?: return null }
    if (values.size != 6) {
      return null
    }
    val checkSum = values.last().toInt()
    val actualValues = values.dropLast(1)
    val calculated = actualValues.foldIndexed(2) { idx, acc: Int, v -> acc + (idx + 1) * v.toInt()}.mod(103)
    if (calculated != checkSum) {
      println("Checksum $checkSum is not $calculated")
      return null
    }
    return actualValues.fold(0) {
      a, d -> a * 100 + d.toInt()
    }
  }

  fun toIntervals(code: Int): List<Int> {
    val decimals = sequence {
      var currentCode = code
      while (currentCode > 0) {
        yield(currentCode % 100)
        currentCode /= 100
      }
    }.toList()
    val codePoints = IntArray(6) {
      decimals.getOrNull(4 - it) ?: 0
    }
    codePoints[5] = codePoints.dropLast(1).foldIndexed(2) {idx, a, d -> a + d * (idx + 1)} % 103

    return codePoints.flatMap {
      var encoding = LEGAL_CODES_128[it]
      sequence {
        while (encoding > 0) {
          yield(encoding % 10)
          encoding /= 10
        }
      }.toList().reversed()
    } + listOf(2)


  }

  val LEGAL_CODES_128 = listOf(
    212222,
    222122,
    222221,
    121223,
    121322,
    131222,
    122213,
    122312,
    132212,
    221213,
    221312,
    231212,
    112232,
    122132,
    122231,
    113222,
    123122,
    123221,
    223211,
    221132,
    221231,
    213212,
    223112,
    312131,
    311222,
    321122,
    321221,
    312212,
    322112,
    322211,
    212123,
    212321,
    232121,
    111323,
    131123,
    131321,
    112313,
    132113,
    132311,
    211313,
    231113,
    231311,
    112133,
    112331,
    132131,
    113123,
    113321,
    133121,
    313121,
    211331,
    231131,
    213113,
    213311,
    213131,
    311123,
    311321,
    331121,
    312113,
    312311,
    332111,
    314111,
    221411,
    431111,
    111224,
    111422,
    121124,
    121421,
    141122,
    141221,
    112214,
    112412,
    122114,
    122411,
    142112,
    142211,
    241211,
    221114,
    413111,
    241112,
    134111,
    111242,
    121142,
    121241,
    114212,
    124112,
    124211,
    411212,
    421112,
    421211,
    212141,
    214121,
    412121,
    111143,
    111341,
    131141,
    114113,
    114311,
    411113,
    411311,
    113141,
    114131,
    311141,
    411131,
    211412,
    211214,
    211232,
  )
  val CODE_TO_VALUE : Map<Int, UByte> = LEGAL_CODES_128.withIndex().associate { it.value to it.index.toUByte() }
}