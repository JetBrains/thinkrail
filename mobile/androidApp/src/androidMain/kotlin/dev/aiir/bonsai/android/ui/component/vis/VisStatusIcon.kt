package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*

fun visStatusIcon(status: String): String = when (status) {
    "done", "fresh" -> "\u2713"
    "current", "in_progress" -> "\u25B6"
    "pending" -> "\u25CB"
    "error" -> "\u2715"
    "skipped" -> "\u2298"
    "stale" -> "~"
    else -> "\u25CB"
}

fun visStatusColor(status: String): Color = when (status) {
    "done", "fresh" -> BonsaiGreen
    "current", "in_progress" -> StatusQuestion
    "error" -> StatusError
    "stale" -> StatusWaiting
    else -> StatusDone
}

@Composable
fun VisStatusBadge(
    status: String,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 11.sp,
) {
    Text(
        text = visStatusIcon(status),
        color = visStatusColor(status),
        fontSize = fontSize,
        modifier = modifier,
    )
}
