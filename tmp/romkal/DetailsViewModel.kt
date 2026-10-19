package us.romkal.barcode

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Stable
import androidx.compose.runtime.State
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.navigation.toRoute
import java.io.File
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.mapNotNull
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.launch

// At the top level of your kotlin file:
val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")
private val USE_KEY = intPreferencesKey("uses_count")
class DetailsViewModel(
  app: Application,
  savedStateHandle: SavedStateHandle,
) : AndroidViewModel(app) {

  init {
    viewModelScope.launch {
      app.dataStore.edit {
        it[USE_KEY] = (it[USE_KEY] ?: 0) + 1
      }
    }
  }

  private val details = savedStateHandle.toRoute<Details>()

  val scannedBarcode: Int
    get() = details.barcode

  val scannedImageFile: String?
    get() = details.file

  val shouldAskForReview = app.dataStore.data.mapNotNull { it[USE_KEY] }.take(1).map { it % 5 == 3 }

  private fun listOfAlcohols(barcode: Int): List<Alcohol> = listOfNotNull(
    barcode.ifHasBit(11, Alcohol.TEQUILA),
    barcode.ifHasBit(10, Alcohol.VODKA),
    barcode.ifHasBit(8, Alcohol.GIN),
    barcode.ifHasBit(9, Alcohol.RUM),
    barcode.ifHasBit(12, Alcohol.WHISKEY),
  )

  fun shareImageIntent(): Intent? {
    val sharedImageFile = File(scannedImageFile ?: return null)
    val application = getApplication<Application>()
    val emailIntent = Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))
    val emailActivity =
      application.packageManager.queryIntentActivities(emailIntent, 0).firstOrNull() ?: return null
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
      type = "message/rfc822"
      setPackage(emailActivity.activityInfo.packageName)
      putExtra(Intent.EXTRA_EMAIL, arrayOf("roman.kalukiewicz@gmail.com"))
      putExtra(Intent.EXTRA_SUBJECT, "New Bartesian Code: $scannedBarcode")
      putExtra(
        Intent.EXTRA_TEXT,
        """I've just found a new barcode for the Bartesian pod.
          |The name of the drink is:""".trimMargin()
      )
      val uriForFile =
        FileProvider.getUriForFile(application, "${application.packageName}.files", sharedImageFile)
      putExtra(Intent.EXTRA_STREAM, uriForFile)
      flags = Intent.FLAG_GRANT_READ_URI_PERMISSION
    }
    return sendIntent
  }

  private val alcoholStates = Alcohol.entries.associateWith { alcohol ->
    val amountIdx = listOfAlcohols(scannedBarcode).indexOf(alcohol)
    val amount = if (amountIdx == -1) {
      0
    } else {
      (scannedBarcode ushr (13 + 3 * amountIdx) and 0b111) + 1
    }
    mutableIntStateOf(amount)
  }.toSortedMap()

  fun alcoholAmount(alcohol: Alcohol): State<Float> = derivedStateOf {
      val amount = alcoholStates[alcohol]!!.intValue
      if (amount == 0) 0f else ALCOHOL_AMOUNTS[amount]
    }

  fun setAlcoholAmount(alcohol: Alcohol, amount: Float) {
    alcoholStates[alcohol]!!.intValue = ALCOHOL_AMOUNTS.asList().findClosest(amount)
  }

  private var water by mutableIntStateOf(scannedBarcode ushr 3 and 0b11111)

  val waterAmount = derivedStateOf {
    WATER_AMOUNTS[water]
  }

  fun setWater(amount: Float) {
    water = waterForAmount(amount)
  }

  var glass by mutableStateOf(
    when (scannedBarcode and 0b110) {
      0b000 -> Glass.LOWBALL
      0b100 -> Glass.SHAKER
      0b010 -> Glass.HIGHBALL
      else -> throw IllegalArgumentException("Glass type unknown: $scannedBarcode")
    }
  )

  var drinkId by mutableIntStateOf(scannedBarcode ushr 22 and 0b111111111)

  val alcoholCount: Int
    get() = alcoholStates.values.count { it.intValue > 0 }

  @Stable
  val barcode: Int
    get() {
      val alcoholBits = alcoholStates.values.mapIndexed { idx, state ->
        if (state.intValue > 0) 1 shl 8 + idx else 0
      }.reduceOrNull(Int::or) ?: 0
      val sizeBits = alcoholStates.values.filter { it.intValue > 0 }.mapIndexed { idx, state ->
        (state.intValue - 1) shl 13 + (3 * idx)
      }.reduceOrNull(Int::or) ?: 0
      return 1 or when (glass) {
        Glass.HIGHBALL -> 0b010
        Glass.LOWBALL -> 0b000
        Glass.SHAKER -> 0b100
      } or alcoholBits or
        sizeBits or
        (water shl 3) or
        (drinkId shl 22)

    }

  companion object {
    fun waterForAmount(amount: Float): Int {
      val sortedAmounts = WATER_AMOUNTS.withIndex().sortedBy { it.value }
      val idx = sortedAmounts.map { it.value }.findClosest(amount)
      return sortedAmounts[idx].index
    }

    val WATER_AMOUNTS = arrayOf(
      0.2f,
      0.45f,
      0.7f,
      0.35f,
      0.65f,
      0.8f,
      1.1f,
      1.3f,
      1.55f,
      1.7f,
      2f,
      2.4f,
      2.85f,
      3.25f,
      3.7f,
      4.2f,
      4.65f,
      5.15f,
      5.5f,
      5.95f,
      6.35f,
      6.8f,
      7.25f,
      7.65f,
      8.1f,
      8.6f,
      9.1f,
      9.45f,
      10.4f,
      10.85f,
      11.25f,
      12.15f,
    )

    val ALCOHOL_AMOUNTS = arrayOf(
      0f,
      0.35f,
      0.6f,
      0.85f,
      1.2f,
      1.55f,
      1.95f,
      2.15f,
      2.8f,
    )
  }
}

private fun <T> Int.ifHasBit(bit: Int, value: T): T? = if (ifHasBit(bit)) value else null

private fun Int.ifHasBit(bit: Int): Boolean = this and (1 shl bit) > 0

private fun List<Float>.findClosest(target: Float): Int {
  val binarySearched = binarySearch(target)
  if (binarySearched >= 0) return binarySearched
  val biggerIdx = -binarySearched - 1
  val smaller = this[biggerIdx - 1]
  val bigger = this[biggerIdx]
  return if (target > smaller + (bigger - smaller) / 2f) biggerIdx else biggerIdx - 1
}