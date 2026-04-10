package dev.aiir.bonsai

actual fun getPlatformName(): String = "Android ${android.os.Build.VERSION.SDK_INT}"
