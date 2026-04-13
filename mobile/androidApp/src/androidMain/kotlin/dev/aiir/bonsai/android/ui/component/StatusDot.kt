package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.data.model.SessionStatus

@Composable
fun StatusDot(
    status: SessionStatus,
    modifier: Modifier = Modifier,
    size: Dp = 8.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(status.toColor())
    )
}

fun SessionStatus.toColor(): Color = when (this) {
    SessionStatus.RUNNING -> StatusRunning
    SessionStatus.IDLE -> StatusIdle
    SessionStatus.WAITING -> StatusWaiting
    SessionStatus.INITIALIZING -> StatusRunning
    SessionStatus.DRAFT -> StatusIdle
    SessionStatus.DONE -> StatusDone
    SessionStatus.ERROR -> StatusError
    SessionStatus.INTERRUPTED -> StatusWaiting
}
