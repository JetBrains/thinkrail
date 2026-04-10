package dev.aiir.bonsai.android.ui.component

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.TypeImprovement

@Composable
fun SubagentBlock(
    description: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    var expanded by remember { mutableStateOf(true) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = 4.dp),
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = !expanded }
                .padding(vertical = 4.dp),
        ) {
            Text(
                text = if (expanded) "↳ ▼" else "↳ ▶",
                color = TypeImprovement,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
            )
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                text = "Subagent: $description",
                color = TypeImprovement,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        // Indented children
        AnimatedVisibility(visible = expanded) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp)
                    .background(
                        color = TypeImprovement.copy(alpha = 0.03f),
                    )
                    .padding(start = 8.dp, top = 4.dp, bottom = 4.dp),
            ) {
                // Left border
                Box(
                    modifier = Modifier
                        .width(2.dp)
                        .fillMaxHeight()
                        .background(TypeImprovement.copy(alpha = 0.3f)),
                )
                Column(modifier = Modifier.padding(start = 10.dp)) {
                    content()
                }
            }
        }
    }
}

@Composable
fun SubagentFooter(
    costUsd: Double,
    modifier: Modifier = Modifier,
) {
    Text(
        text = "Subagent complete · $${String.format("%.2f", costUsd)}",
        fontSize = 9.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(start = 12.dp, top = 2.dp, bottom = 4.dp),
    )
}
