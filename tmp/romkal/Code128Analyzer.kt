package us.romkal.barcode

import android.graphics.Bitmap
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import java.nio.ByteBuffer
import kotlin.math.absoluteValue
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@OptIn(ExperimentalUnsignedTypes::class)
class Code128Analyzer(private val onBarcode: (Bitmap, Int) -> Unit, private val isPortrait: Boolean) :
  ImageAnalysis.Analyzer {
  override fun analyze(image: ImageProxy) {
    findBarcode(image)?.let {onBarcode(it.first, it.second)}
    image.close()
  }

  private fun findBarcode(image: ImageProxy): Pair<Bitmap, Int>? {
    val start = if (isPortrait) 4 else 3
    for (y in image.height * start / 10..image.height * (10 - start) / 10) {
      analyzeLine(y, image)?.let { return it }
    }
    return null
  }

  private fun analyzeLine(
    y: Int,
    image: ImageProxy,
  ): Pair<Bitmap, Int>? {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val beginIndex = image.width / 4 + y * plane.rowStride
    buffer.position(beginIndex)
    buffer.limit(beginIndex + image.width / 2)

    val threshold = findThreshold(buffer)
    var count = 0
    var last = true
    val segments = buildList {
      while (buffer.hasRemaining()) {
        val avgByte =
          buffer.get().toUByte().toInt()
        val new = avgByte > threshold
        if (last != new) {
          add(count)
          count = 0
          last = new
        }
        count++
      }
      add(count)
    }
    buffer.rewind()
    buffer.limit(buffer.capacity())
    val normalized = normalizeSegments(segments)
    return if (normalized != null && isValid(normalized)) {
      Code128.tryParse(normalized)?.let {
        image.toBitmap() to it
      }
    } else {
      null
    }
  }

  private fun findThreshold(buffer: ByteBuffer): Int {
    buffer.mark()
    val buckets = IntArray(1 shl BUCKET_BITS)
    while (buffer.hasRemaining()) {
      val byte = buffer.get().toUByte().toInt()
      val bucketIdx = byte ushr (8 - BUCKET_BITS)
      buckets[bucketIdx]++
    }
    buffer.reset()

    val maxBucket = buckets.withIndex().maxBy { it.value }
    val nextMaxBucket =
      buckets.withIndex().filter { (it.index - maxBucket.index).absoluteValue > 4 }
        .maxBy { it.value }
    val valley = buckets.withIndex().filter {
      it.index in min(maxBucket.index, nextMaxBucket.index)..max(
        maxBucket.index,
        nextMaxBucket.index
      )
    }.minBy { it.value }
    return (valley.index shl (8 - BUCKET_BITS)) + (1 shl (7 - BUCKET_BITS))
  }

  private fun isValid(segments: List<Int>) =
    segments.lastOrNull() == 2 && segments.sum() == 68 && segments.all { it <= 4 }

  private fun normalizeSegments(segments: List<Int>): List<Int>? {
    val secondBiggest = segments.sortedDescending().getOrNull(1) ?: return null
    val onlyShort =
      segments.dropWhile { it < secondBiggest }.dropLastWhile { it < secondBiggest }.drop(1)
        .dropLast(1)
    val shortest = onlyShort.minOrNull() ?: return null
    return onlyShort.map { (it / shortest.toFloat()).roundToInt() }
  }


  companion object {
    const val BUCKET_BITS = 5
  }
}

