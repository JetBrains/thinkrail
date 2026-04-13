package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.aiir.bonsai.android.ui.theme.*

@Composable
fun ContextUsageBar(
    percent: Int,
    modifier: Modifier = Modifier,
    height: Dp = 3.dp,
) {
    val color = when {
        percent > 85 -> StatusError
        percent > 60 -> StatusWaiting
        else -> BonsaiGreen
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(height / 2))
            .background(Color.Gray.copy(alpha = 0.2f)),
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction = (percent.coerceIn(0, 100) / 100f))
                .clip(RoundedCornerShape(height / 2))
                .background(color),
        )
    }
}
