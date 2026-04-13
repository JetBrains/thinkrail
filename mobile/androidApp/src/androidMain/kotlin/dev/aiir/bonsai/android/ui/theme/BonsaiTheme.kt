package dev.aiir.bonsai.android.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = BonsaiGreen,
    onPrimary = Color.White,
    primaryContainer = BonsaiGreenDark,
    onPrimaryContainer = BonsaiGreenLight,
    secondary = StatusQuestion,
    tertiary = StatusWaiting,
    background = SurfaceDark,
    surface = SurfaceDark,
    surfaceVariant = SurfaceAltDark,
    onBackground = Color.White,
    onSurface = Color.White,
    error = StatusError,
)

private val LightColorScheme = lightColorScheme(
    primary = BonsaiGreen,
    onPrimary = Color.White,
    primaryContainer = BonsaiGreenLight,
    onPrimaryContainer = BonsaiGreenDark,
    secondary = StatusQuestion,
    tertiary = StatusWaiting,
    background = SurfaceLight,
    surface = SurfaceLight,
    surfaceVariant = SurfaceAltLight,
    error = StatusError,
)

@Composable
fun BonsaiTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        content = content,
    )
}
