package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.data.model.PendingRequest

private val SuggestionPurple = Color(0xFF9C27B0)

@Composable
fun SuggestionCard(
    request: PendingRequest,
    onAccept: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = SuggestionPurple.copy(alpha = 0.06f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, SuggestionPurple.copy(alpha = 0.2f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("\uD83D\uDCA1", fontSize = 14.sp)
                Spacer(modifier = Modifier.width(6.dp))
                Text("Session Suggestion", fontWeight = FontWeight.Bold, color = SuggestionPurple, fontSize = 12.sp)
            }
            if (request.skill != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text("Skill: ${request.skill}", fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
            if (request.reason != null) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(request.reason!!, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(modifier = Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onAccept,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = SuggestionPurple),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) { Text("Create Session", fontSize = 11.sp) }
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = SuggestionPurple),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) { Text("Dismiss", fontSize = 11.sp) }
            }
        }
    }
}
