package us.romkal.barcode

import android.content.Context
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.asExecutor

@Composable
fun Camera(analyzer: ImageAnalysis.Analyzer, modifier: Modifier = Modifier) {
  val lensFacing = CameraSelector.LENS_FACING_BACK
  val lifecycleOwner = LocalLifecycleOwner.current
  val context = LocalContext.current
  val preview = remember { Preview.Builder().build() }
  val imageAnalysis = remember {
    ImageAnalysis.Builder()
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setAllowedResolutionMode(ResolutionSelector.PREFER_HIGHER_RESOLUTION_OVER_CAPTURE_RATE)
          .setResolutionFilter { sizes, rotation ->
            sizes.filter { it.width > 1000 }.sortedByDescending { it.width }
          }
          .build())
      .setOutputImageRotationEnabled(true)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
      .build()
  }
  LaunchedEffect(analyzer) {
    imageAnalysis.setAnalyzer(Dispatchers.Default.asExecutor(), analyzer)
  }
  val previewView = remember {
    PreviewView(context)
  }
  val cameraxSelector = CameraSelector.Builder().requireLensFacing(lensFacing).build()
  LaunchedEffect(lensFacing) {
    val cameraProvider = context.getCameraProvider()
    cameraProvider.unbindAll()
    cameraProvider.bindToLifecycle(lifecycleOwner, cameraxSelector, preview, imageAnalysis)
    preview.surfaceProvider = previewView.surfaceProvider
  }
  AndroidView(factory = { previewView }, modifier = modifier)
}

private suspend fun Context.getCameraProvider(): ProcessCameraProvider =
  suspendCoroutine { continuation ->
    ProcessCameraProvider.getInstance(this).also { cameraProvider ->
      cameraProvider.addListener(
        {
          continuation.resume(cameraProvider.get())
        },
        ContextCompat.getMainExecutor(this)
      )
    }
  }