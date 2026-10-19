package us.romkal.barcode

import android.content.res.Configuration
import android.graphics.Bitmap
import android.util.Log
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.center
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import com.google.accompanist.permissions.shouldShowRationale
import java.io.File
import java.io.IOException
import java.nio.file.Path
import kotlin.io.path.outputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val TAG  = "CameraScreen"

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun CameraScreen(
    modifier: Modifier = Modifier, onBarcode: (Int, Path?) -> Unit,
    setCustomActions: (@Composable RowScope.() -> Unit) -> Unit,
  ) {
  val coroutineScope = rememberCoroutineScope()
  val permissionState = rememberPermissionState(android.Manifest.permission.CAMERA)
  if (!permissionState.status.isGranted) {
    Column(modifier = modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("Camera permission is needed to scan a barcode")
      if (permissionState.status.shouldShowRationale) {
        Button(onClick = {
          permissionState.launchPermissionRequest()
        }) {
          Text(stringResource(R.string.grant_permission))
        }
        Button(onClick = {
          onBarcode(0, null)
        }) {
          Text(stringResource(R.string.manual_entry))
        }
      } else {
        LaunchedEffect(permissionState) {
          permissionState.launchPermissionRequest()
        }
      }
    }
    return
  }
  LaunchedEffect(Unit) {
    setCustomActions {
      IconButton(
        onClick = {
          onBarcode(0, null)
        },
      ) {
        Icon(
          painter = painterResource(R.drawable.baseline_fast_forward_24),
          contentDescription = "Manual entry"
        )
      }
    }
  }
  Box(modifier = modifier) {
    val isPortrait = LocalConfiguration.current.layoutDirection == Configuration.ORIENTATION_PORTRAIT
    val context = LocalContext.current
    var callbackCalled by remember { mutableStateOf(false) }
    Camera(remember(isPortrait) {
      Code128Analyzer(
        onBarcode = {bitmap, code ->
          if (callbackCalled) return@Code128Analyzer
          callbackCalled = true
          coroutineScope.launch {
            val file = withContext(Dispatchers.IO) {
              val dir = File(context.cacheDir, "barcodes")
              try {
                dir.mkdirs()
                val file = File(dir, "barcode_$code.jpg").toPath()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 80, file.outputStream())
                file
              } catch (e: IOException) {
                Log.e(TAG, "Failed to create a file.", e)
                null
              }
            }
            onBarcode(code, file)
          }
        },
        isPortrait = isPortrait,
      )
    }, modifier = Modifier.fillMaxSize())
    Canvas(modifier = Modifier.fillMaxSize()) {
      drawRect(color = Color.Red, alpha = 0.2f)
      val windowWidth = (if (isPortrait) 0.5f else 0.6f) * size.width
      val windowHeight = windowWidth / 2f
      val rectSize = Size(width = windowWidth, height = windowHeight)
      drawRoundRect(
        topLeft = size.center - rectSize.center,
        size = rectSize,
        color = Color.Red,
        cornerRadius = CornerRadius(15f),
        style = Stroke(width = 4f)
      )
      drawRoundRect(
        topLeft = size.center - rectSize.center,
        size = rectSize,
        color = Color.Red,
        cornerRadius = CornerRadius(15f),
        blendMode = BlendMode.Clear
      )
    }
    }
}