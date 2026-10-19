package us.romkal.barcode

import android.content.Intent
import android.util.Log
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconToggleButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.RichTooltip
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.inset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImagePainter
import coil3.compose.rememberAsyncImagePainter
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import com.google.android.play.core.review.ReviewManagerFactory
import com.google.android.play.core.review.testing.FakeReviewManager
import java.text.Normalizer
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import us.romkal.barcode.Glass.*

private const val TAG = "DetailsScreen"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsScreen(
  modifier: Modifier = Modifier,
  snackbarHostState: SnackbarHostState,
  viewModel: DetailsViewModel = viewModel<DetailsViewModel>(),
  setCustomActions: (@Composable RowScope.() -> Unit) -> Unit,
  ) {
  val barcode = viewModel.barcode
  val scope = rememberCoroutineScope()
  val context = LocalContext.current
  val drinksViewModel =
    viewModel<DrinksViewModel>(viewModelStoreOwner = context as ViewModelStoreOwner)
  val drinkMap by drinksViewModel.drinkMap.collectAsState()
  val launcher =
    rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
      if (uri != null) {
        scope.launch {
          context.contentResolver.openOutputStream(uri, "wt")?.use {
            BarcodePrinter(context).printPdf(
              barcode,
              it,
              Alcohol.entries.associateWith {
                viewModel.alcoholAmount(it).value
              }.filterValues { it > 0f }
                .mapKeys { context.getString(alcoholName(it.key)) },
              viewModel.waterAmount.value,
              context.getString(resForGlass(viewModel.glass)),
            )
          }
          val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/pdf")
            .setFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          context.startActivity(intent)
          snackbarHostState.showSnackbar("Saved")
        }
      }
    }
  LaunchedEffect(Unit) {
    setCustomActions {
      IconButton(
        onClick = {
          launcher.launch("barcodes.pdf")
        },
      ) {
        Icon(
          painter = painterResource(R.drawable.baseline_print_24),
          contentDescription = "Print"
        )
      }
    }
  }
  val shouldAskForReview by viewModel.shouldAskForReview.collectAsState(false)
  if (shouldAskForReview) {
    StartReview()
  }
  Column(
    modifier = modifier
      .imePadding()
      .padding(vertical = 8.dp, horizontal = 24.dp)
      .verticalScroll(state = rememberScrollState()),
    verticalArrangement = Arrangement.spacedBy(8.dp)
  ) {
    val drinkName = drinkMap[barcode]
    TitleRow(
      drinkName = drinkName,
      intentToShare = remember(barcode) {
        if (drinkName == null &&
          viewModel.scannedImageFile != null &&
          barcode == viewModel.scannedBarcode
        ) viewModel.shareImageIntent() else null
      }
    )
    ContentCard(viewModel)
    GlassRow(glass = viewModel.glass, setGlass = { viewModel.glass = it })
    DrinkIdRow({ viewModel.drinkId = it }, viewModel.drinkId)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        AnimatedContent(
          targetState = barcode,
          label = "Barcode",
          transitionSpec = {
            fadeIn().togetherWith(fadeOut())
          }
        ) { barcodeToShow ->
          Barcode(
            barcode = barcodeToShow, modifier = Modifier
              .widthIn(0.dp, 240.dp)
              .aspectRatio(2.0f)
              .padding(4.dp)
          )
        }
        Spacer(Modifier.weight(1f))
        DrinkImage(
          drinkName = drinkName,
          localImage = if (viewModel.scannedBarcode == barcode) viewModel.scannedImageFile else null,
          modifier = Modifier.height(128.dp),
        )
      }
      SelectionContainer {
        AnimatedContent(
          targetState = barcode,
          label = "Code",
          transitionSpec = {
            fadeIn().togetherWith(fadeOut())
          }
        ) { barcodeToShow ->
          Text(
            stringResource(R.string.code, barcodeToShow),
            style = MaterialTheme.typography.bodyLarge
          )
        }
      }
    }
  }
}

@Composable
private fun TitleRow(
  drinkName: String?,
  intentToShare: Intent?,
) {
  Row {
    Text(
      drinkName ?: stringResource(R.string.unknown_drink),
      style = MaterialTheme.typography.displayMedium
    )
    AnimatedVisibility(intentToShare != null) {
      val context = LocalContext.current
      IconButton(onClick = {
        if (intentToShare != null) {
          context.startActivity(intentToShare)
        }
      }) {
        Icon(
          painter = painterResource(R.drawable.baseline_attach_email_24),
          tint = MaterialTheme.colorScheme.primary,
          contentDescription = stringResource(R.string.share)
        )
      }
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun ContentCard(viewModel: DetailsViewModel) {
  OutlinedCard {
    val (expanded, setExpanded) = remember { mutableStateOf(false) }
    Column(
      modifier = Modifier
        .padding(8.dp)
        .fillMaxWidth()
    ) {
      CardTitle(expanded, setExpanded)
      for (alcohol in Alcohol.entries) {
        val amount = viewModel.alcoholAmount(alcohol).value
        AnimatedVisibility(expanded || amount != 0f) {
          AlcoholRow(
            alcohol,
            amount = amount,
            setAmount = { viewModel.setAlcoholAmount(alcohol, it) },
            enabled = amount > 0f || viewModel.alcoholCount < 3
          )
        }
      }
      WaterRow(water = viewModel.waterAmount.value, setWater = { viewModel.setWater(it) })
    }
  }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun CardTitle(expanded: Boolean, setExpanded: (Boolean) -> Unit) {
  Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    val tooltipState = rememberTooltipState(isPersistent = true)
    val coroutineScope = rememberCoroutineScope()
    TooltipBox(
      positionProvider = TooltipDefaults.rememberRichTooltipPositionProvider(),
      state = tooltipState,
      tooltip = {
        RichTooltip(
          title = { Text(stringResource(R.string.about_alcohol_amount)) },
          action = {
            Button(onClick = { tooltipState.dismiss() }) {
              Text(stringResource(android.R.string.ok))
            }
          }
        ) {
          Text(
            stringResource(R.string.alcohol_details_tooltip).trimIndent()
          )
        }
      },
    ) {
      Text(
        stringResource(R.string.alcohol_content),
        Modifier.clickable(onClick = { coroutineScope.launch { tooltipState.show() } })
      )
    }
    Spacer(Modifier.weight(1f))
    IconToggleButton(
      checked = expanded, onCheckedChange = setExpanded
    ) {
      Icon(
        imageVector = if (expanded) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,
        contentDescription = stringResource(if (expanded) R.string.fold else R.string.unfold),
      )
    }
  }
}

@Composable
private fun DrinkIdRow(setDrinkId: (Int) -> Unit, drinkId: Int) {
  var enteredDrinkId by remember { mutableStateOf(drinkId.toString()) }
  fun isValid(n: String) = (n.toIntOrNull() ?: Int.MAX_VALUE) in 0..0b1111111111
  TextField(
    value = enteredDrinkId,
    onValueChange = { v ->
      enteredDrinkId = v
      if (isValid(v)) {
        setDrinkId(v.toInt())
      }
    },
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    isError = !isValid(enteredDrinkId),
    singleLine = true,
    supportingText = {
      if (!isValid(enteredDrinkId)) {
        Text(stringResource(R.string.only_values_up_to_511))
      }
    },
    label = { Text(stringResource(R.string.drink_id)) },
  )
}

@Composable
fun AlcoholRow(alcohol: Alcohol, amount: Float, setAmount: (Float) -> Unit, enabled: Boolean) {
  AmountRow(
    amount = amount,
    setAmount = setAmount,
    enabled = enabled,
    title = stringResource(alcoholName(alcohol)),
    symbol = alcoholSymbol(alcohol),
    maxValue = DetailsViewModel.ALCOHOL_AMOUNTS.last(),
  )
}

@Composable
private fun AmountRow(
  amount: Float,
  setAmount: (Float) -> Unit,
  enabled: Boolean,
  title: String,
  symbol: Int,
  minValue: Float = 0f,
  maxValue: Float,
) {
  Column {
    Text(title)
    Row(
      horizontalArrangement = Arrangement.spacedBy(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(contentDescription = null, painter = painterResource(symbol))
      Slider(
        modifier = Modifier.weight(1f),
        value = amount,
        onValueChange = { setAmount(it) },
        valueRange = minValue..maxValue,
        enabled = enabled,
      )
      Text(
        stringResource(R.string.oz, amount),
        modifier = Modifier.width(64.dp)
      )
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GlassRow(glass: Glass, setGlass: (Glass) -> Unit) {
  SingleChoiceSegmentedButtonRow {
    for ((idx, glassEntry) in Glass.entries.withIndex()) {
      SegmentedButton(
        selected = glass == glassEntry,
        onClick = { setGlass(glassEntry) },
        shape = SegmentedButtonDefaults.itemShape(idx, Glass.entries.size)
      ) {
        Text(stringResource(resForGlass(glassEntry)))
      }
    }
  }
}

@Composable
fun WaterRow(water: Float, setWater: (Float) -> Unit) {
  AmountRow(
    amount = water,
    setAmount = setWater,
    enabled = true,
    title = stringResource(R.string.water),
    symbol = R.drawable.water_drop_24px,
    minValue = DetailsViewModel.WATER_AMOUNTS.first(),
    maxValue = DetailsViewModel.WATER_AMOUNTS.last(),
  )
}

@Composable
fun Barcode(barcode: Int, modifier: Modifier = Modifier) {
  val intervals = remember(barcode) { Code128.toIntervals(barcode) }
  Canvas(modifier = modifier) {
    drawRect(Color.White)
    var x = size.width / 4
    var unit = size.width / 2 / 68
    var black = true
    for (bar in intervals) {
      if (black) {
        drawRect(
          Color.Black,
          topLeft = Offset(x, 0f),
          size = Size(unit * bar, size.height),
        )
      }
      black = !black
      x += unit * bar
    }
    inset(unit * 1.5f) {
      drawRect(Color.Black, style = Stroke(width = 3 * unit))
    }
  }
}

@Composable
fun DrinkImage(drinkName: String?, localImage: String?, modifier: Modifier = Modifier) {
  val menuPainter = if (USE_MENU_IMAGES) {
    drinkName?.let { rememberAsyncImagePainter(imageUrlForName(drinkName))}
  } else {
    null
  }
  val menuState = menuPainter?.state?.collectAsState()
  val painter = if (menuState != null && menuState.value !is AsyncImagePainter.State.Error) {
    menuPainter
  } else if (localImage != null) {
    val context = LocalContext.current
    rememberAsyncImagePainter(remember(localImage) {
      ImageRequest.Builder(context)
        .data(localImage)
        .memoryCachePolicy(CachePolicy.DISABLED)
        .diskCachePolicy(CachePolicy.DISABLED)
        .build()
    })
  } else {
    rememberAsyncImagePainter("https://romkal.github.io/bartesian_pods/images/$drinkName.jpg")
  }
  Image(
    modifier = modifier,
    painter = painter,
    contentDescription = null,
    )
}

@Composable
fun StartReview() {
  val activity = LocalActivity.current
  if (activity != null) {
    LaunchedEffect(Unit) {
      val manager = ReviewManagerFactory.create(activity)
      try {
        withContext(NonCancellable) {
          val info = manager.requestReviewFlow().await()
          Log.d(TAG, "Asking for review")
          manager.launchReviewFlow(activity, info).await()
        }
      } catch (e: Exception) {
        Log.w(TAG, "Exception while requesting review.", e)
      }
    }
  }
}

private fun imageUrlForName(drinkName: String): String {
  val isLowCal = drinkName.startsWith("Low-Cal ", ignoreCase = true)
  val baseName = if (isLowCal) drinkName.drop("Low-Cal ".length) else drinkName
  val baseNameNormalized = Normalizer.normalize(baseName, Normalizer.Form.NFD).replace(REGEX_NON_WORD, "").lowercase()
  val fileName = if (isLowCal) "lowcal-$baseNameNormalized" else baseNameNormalized
  return "https://www.bartesianmenu.com/cocktail_images/$fileName.jpg"
}

@StringRes
fun alcoholName(alcohol: Alcohol) = when (alcohol) {
  Alcohol.VODKA -> R.string.vodka
  Alcohol.WHISKEY -> R.string.whiskey
  Alcohol.GIN -> R.string.gin
  Alcohol.RUM -> R.string.rum
  Alcohol.TEQUILA -> R.string.tequila
}

@DrawableRes
fun alcoholSymbol(alcohol: Alcohol) = when (alcohol) {
  Alcohol.GIN -> R.drawable.liquor_24px
  Alcohol.RUM -> R.drawable.sailing_24px
  Alcohol.VODKA -> R.drawable.water_full_24px
  Alcohol.TEQUILA -> R.drawable.local_bar_24px
  Alcohol.WHISKEY -> R.drawable.wine_bar_24px
}

@StringRes
fun resForGlass(glass: Glass) = when (glass) {
  HIGHBALL -> R.string.highball
  LOWBALL -> R.string.lowball
  SHAKER -> R.string.shaker
}

private val REGEX_NON_WORD = Regex("\\p{InCombiningDiacriticalMarks}|\\W+")
private const val USE_MENU_IMAGES = false