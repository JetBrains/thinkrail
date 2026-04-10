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
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.data.model.PendingRequest

@Composable
fun ApprovalCard(
    request: PendingRequest,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = StatusWaiting.copy(alpha = 0.08f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, StatusWaiting.copy(alpha = 0.25f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("\uD83D\uDD10", fontSize = 14.sp)
                Spacer(modifier = Modifier.width(6.dp))
                Text("Tool Approval", fontWeight = FontWeight.Bold, color = StatusWaiting, fontSize = 12.sp)
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = request.toolName ?: "action",
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
            )
            if (request.toolInput != null) {
                val path = request.toolInput!!["file_path"]?.toString()?.trim('"')
                    ?: request.toolInput!!["filePath"]?.toString()?.trim('"')
                    ?: request.toolInput!!["command"]?.toString()?.trim('"')?.take(60)
                if (path != null) {
                    Text(
                        text = path,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(modifier = Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) { Text("✓ Approve", fontSize = 12.sp) }
                OutlinedButton(
                    onClick = onDeny,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusError),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) { Text("✕ Deny", fontSize = 12.sp) }
            }
        }
    }
}
