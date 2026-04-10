package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
fun ProgressTrackerCard(data: JsonObject, modifier: Modifier = Modifier) {
    val steps = data["steps"]?.jsonArray ?: return

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        steps.forEach { stepEl ->
            val step = stepEl.jsonObject
            val label = step["label"]?.jsonPrimitive?.content ?: ""
            val status = step["status"]?.jsonPrimitive?.content ?: "pending"
            val detail = step["detail"]?.jsonPrimitive?.content
            val file = step["file"]?.jsonPrimitive?.content
            val subSteps = step["subSteps"]?.jsonArray ?: step["substeps"]?.jsonArray

            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                VisStatusBadge(status = status, fontSize = 12.sp)
                Column(modifier = Modifier.weight(1f)) {
                    Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    if (detail != null) {
                        Text(detail, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (file != null) {
                        Text(file, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }

            subSteps?.forEach { subEl ->
                val sub = subEl.jsonObject
                val subLabel = sub["label"]?.jsonPrimitive?.content ?: ""
                val subStatus = sub["status"]?.jsonPrimitive?.content ?: "pending"
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 24.dp, top = 1.dp, bottom = 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    VisStatusBadge(status = subStatus, fontSize = 10.sp)
                    Text(subLabel, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
