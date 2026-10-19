package us.romkal.barcode

import android.app.Application
import android.util.Log
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import okhttp3.Request
import okhttp3.coroutines.executeAsync

@OptIn(ExperimentalCoroutinesApi::class)
class DrinksViewModel(application: Application) : AndroidViewModel(application) {

  val drinkMap = MutableStateFlow(
    parseCsv(
      getApplication<BarcodeScannerApplication>().assets.open("pods_data.csv")
        .use {
          it.bufferedReader().use { it.readText() }
        })
  )

  fun loadDrinksFromNetwork() {
    viewModelScope.launch {
      val request = Request.Builder()
        .url("https://romkal.github.io/bartesian_pods/pods_data.csv")
        .get()
        .build()
      getApplication<BarcodeScannerApplication>().httpClient.newCall(request)
        .executeAsync().use { response ->
          if (response.isSuccessful) {
            val text = response.body.string()
            try {
              drinkMap.value = parseCsv(text)
            } catch (e: Exception) {
              Log.e(TAG, "Failed to parse the CSV map.", e)
            }
          }
        }
    }
  }

  private fun parseCsv(text: String): Map<Int, String> {
    return text.lines().filter { it.isNotBlank() }.associate {
      val (code, name) = it.split(',', limit = 2)
      code.toInt() to name
    }
  }

  companion object {
    const val TAG = "DrinksViewModel"
  }
}