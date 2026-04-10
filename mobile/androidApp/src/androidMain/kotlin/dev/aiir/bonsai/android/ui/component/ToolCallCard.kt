package dev.aiir.bonsai.android.ui.component

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.component.session.ApprovalStatus
import dev.aiir.bonsai.component.session.ToolCallState

@Composable
fun ToolCallCard(
    state: ToolCallState,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    val statusIcon = when {
        state.approvalStatus == ApprovalStatus.APPROVED -> "✓"
        state.approvalStatus == ApprovalStatus.DENIED -> "✕"
        state.approvalStatus == ApprovalStatus.EXPIRED -> "⏱"
        state.isComplete && state.error != null -> "✕"
        state.isComplete -> "✓"
        else -> "⟳"
    }

    val statusColor = when {
        state.approvalStatus == ApprovalStatus.APPROVED -> BonsaiGreen
        state.approvalStatus == ApprovalStatus.DENIED -> StatusError
        state.approvalStatus == ApprovalStatus.EXPIRED -> StatusDone
        state.isComplete && state.error != null -> StatusError
        state.isComplete -> BonsaiGreen
        else -> StatusWaiting
    }

    val approvalLabel = when (state.approvalStatus) {
        ApprovalStatus.APPROVED -> " approved"
        ApprovalStatus.DENIED -> " denied"
        ApprovalStatus.EXPIRED -> " expired"
        else -> ""
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 8.dp)
            .clickable { expanded = !expanded },
        shape = RoundedCornerShape(6.dp),
        colors = CardDefaults.cardColors(
            containerColor = TypeImprovement.copy(alpha = 0.06f),
        ),
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            TypeImprovement.copy(alpha = 0.12f),
        ),
    ) {
        // Collapsed header (always shown)
        Row(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (expanded) "▼" else "▶",
                color = TypeImprovement,
                fontSize = 10.sp,
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = state.toolName,
                fontWeight = FontWeight.Bold,
                color = TypeImprovement,
                fontSize = 11.sp,
            )
            if (state.inputSummary.isNotEmpty()) {
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = state.inputSummary,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 10.sp,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.width(4.dp))
            Text(text = statusIcon, color = statusColor, fontSize = 10.sp)
            if (approvalLabel.isNotEmpty()) {
                Text(text = approvalLabel, color = statusColor, fontSize = 9.sp)
            }
            if (state.linesAdded > 0 || state.linesRemoved > 0) {
                Spacer(modifier = Modifier.width(4.dp))
                if (state.linesAdded > 0) Text("+${state.linesAdded}", color = BonsaiGreen, fontSize = 9.sp)
                if (state.linesRemoved > 0) {
                    Spacer(modifier = Modifier.width(2.dp))
                    Text("-${state.linesRemoved}", color = StatusError, fontSize = 9.sp)
                }
            }
        }

        // Expanded content
        AnimatedVisibility(visible = expanded) {
            var showFullInput by remember { mutableStateOf(false) }
            var showFullOutput by remember { mutableStateOf(false) }

            Column(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
                // Input
                if (state.input.isNotEmpty()) {
                    val inputStr = state.input.toString()
                    val truncateInput = inputStr.length > 500 && !showFullInput
                    Text("Input:", fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Text(
                            text = if (truncateInput) inputStr.take(500) + "..." else inputStr,
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(6.dp),
                            maxLines = if (showFullInput) Int.MAX_VALUE else 15,
                        )
                    }
                    if (inputStr.length > 500) {
                        Text(
                            text = if (showFullInput) "Show less" else "Show more",
                            fontSize = 9.sp,
                            color = TypeImprovement,
                            modifier = Modifier.clickable { showFullInput = !showFullInput },
                        )
                    }
                }
                // Output
                if (state.output != null) {
                    val outputStr = state.output!!
                    val truncateOutput = outputStr.length > 500 && !showFullOutput
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("Output:", fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                        shape = RoundedCornerShape(4.dp),
                        color = MaterialTheme.colorScheme.surface,
                    ) {
                        Text(
                            text = if (truncateOutput) outputStr.take(500) + "..." else outputStr,
                            fontSize = 9.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(6.dp),
                            maxLines = if (showFullOutput) Int.MAX_VALUE else 15,
                        )
                    }
                    if (outputStr.length > 500) {
                        Text(
                            text = if (showFullOutput) "Show less" else "Show more",
                            fontSize = 9.sp,
                            color = TypeImprovement,
                            modifier = Modifier.clickable { showFullOutput = !showFullOutput },
                        )
                    }
                }
                // Error
                if (state.error != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "Error: ${state.error}",
                        fontSize = 9.sp,
                        color = StatusError,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
            }
        }
    }
}
