package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.component.session.ChatItem

@Composable
fun CompletionBanner(
    item: ChatItem.SessionDone,
    onResume: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = BonsaiGreen.copy(alpha = 0.08f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, BonsaiGreen.copy(alpha = 0.2f)),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("✓ Session Complete", fontWeight = FontWeight.Bold, color = BonsaiGreen, fontSize = 12.sp)
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "$${String.format("%.2f", item.costUsd)} · ${item.turns} turns · ${item.toolCalls} tools · ${formatDuration(item.durationMs)}",
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            if (item.filesChanged.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                val created = item.filesChanged.count { it.value == "created" }
                val modified = item.filesChanged.count { it.value == "modified" }
                val deleted = item.filesChanged.count { it.value == "deleted" }
                Text(
                    text = buildString {
                        if (created > 0) append("+$created created")
                        if (modified > 0) { if (isNotEmpty()) append(" · "); append("$modified modified") }
                        if (deleted > 0) { if (isNotEmpty()) append(" · "); append("-$deleted deleted") }
                    },
                    fontSize = 10.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = onResume,
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 6.dp),
            ) { Text("Resume Session", fontSize = 11.sp) }
        }
    }
}

@Composable
fun ErrorBanner(
    item: ChatItem.SessionError,
    onResume: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = StatusError.copy(alpha = 0.08f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, StatusError.copy(alpha = 0.2f)),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("✕ Session Error", fontWeight = FontWeight.Bold, color = StatusError, fontSize = 12.sp)
            Spacer(modifier = Modifier.height(4.dp))
            Text(item.message, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedButton(
                onClick = onResume,
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 6.dp),
            ) { Text("Resume Session", fontSize = 11.sp) }
        }
    }
}

private fun formatDuration(ms: Long): String {
    val seconds = ms / 1000
    return when {
        seconds < 60 -> "${seconds}s"
        seconds < 3600 -> "${seconds / 60}m ${seconds % 60}s"
        else -> "${seconds / 3600}h ${(seconds % 3600) / 60}m"
    }
}
