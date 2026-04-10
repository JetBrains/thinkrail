package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.data.model.PendingRequestType
import dev.aiir.bonsai.data.model.Session
import dev.aiir.bonsai.data.model.SessionStatus

@Composable
fun SessionCard(
    session: Session,
    onClick: () -> Unit,
    onApprove: (() -> Unit)? = null,
    onDeny: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val isAttention = session.status == SessionStatus.WAITING && session.pendingRequest != null
    val borderColor = when {
        isAttention && session.pendingRequest?.type == PendingRequestType.APPROVAL -> StatusWaiting
        isAttention && session.pendingRequest?.type == PendingRequestType.QUESTION -> StatusQuestion
        session.status == SessionStatus.RUNNING -> StatusRunning
        session.status == SessionStatus.ERROR -> StatusError
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    val containerColor = when {
        isAttention && session.pendingRequest?.type == PendingRequestType.APPROVAL ->
            StatusWaiting.copy(alpha = 0.08f)
        isAttention && session.pendingRequest?.type == PendingRequestType.QUESTION ->
            StatusQuestion.copy(alpha = 0.08f)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    Card(
        modifier = modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(1.dp, borderColor.copy(alpha = 0.3f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusDot(status = session.status)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = session.name.ifEmpty { session.bonsaiSid.take(8) },
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Status line
            if (isAttention && session.pendingRequest != null) {
                val request = session.pendingRequest!!
                val icon = if (request.type == PendingRequestType.APPROVAL) "\uD83D\uDD10" else "\u2753"
                val label = when (request.type) {
                    PendingRequestType.APPROVAL -> "Approve: ${request.toolName ?: "action"}"
                    PendingRequestType.QUESTION -> request.questions?.firstOrNull()?.question ?: "Question"
                    else -> "Needs attention"
                }
                Text(
                    text = "$icon $label",
                    color = if (request.type == PendingRequestType.APPROVAL) StatusWaiting else StatusQuestion,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 16.dp),
                )

                if (request.type == PendingRequestType.APPROVAL && onApprove != null && onDeny != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(modifier = Modifier.padding(start = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(
                            onClick = onApprove,
                            colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                            modifier = Modifier.height(32.dp),
                        ) {
                            Text("Approve", fontSize = 12.sp)
                        }
                        OutlinedButton(
                            onClick = onDeny,
                            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                            modifier = Modifier.height(32.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusError),
                        ) {
                            Text("Deny", fontSize = 12.sp)
                        }
                    }
                }
            } else {
                Text(
                    text = buildString {
                        append(session.status.name.lowercase())
                        if (session.model.isNotEmpty()) append(" · ${session.model.substringAfterLast("-").take(10)}")
                        if (session.metrics.turns > 0) append(" · ${session.metrics.turns} turns")
                        if (session.metrics.costUsd > 0) append(" · $${String.format("%.2f", session.metrics.costUsd)}")
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(start = 16.dp),
                )
            }
        }
    }
}
