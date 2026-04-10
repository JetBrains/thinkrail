package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
fun StatusListCard(data: JsonObject, modifier: Modifier = Modifier) {
    val items = data["items"]?.jsonArray ?: return

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(3.dp)) {
        items.forEach { itemEl ->
            val item = itemEl.jsonObject
            val label = item["label"]?.jsonPrimitive?.content ?: ""
            val status = item["status"]?.jsonPrimitive?.content ?: "pending"
            val meta = item["meta"]?.jsonPrimitive?.content
                ?: item["detail"]?.jsonPrimitive?.content

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                VisStatusBadge(status = status, fontSize = 11.sp)
                Text(
                    text = label,
                    fontSize = 11.sp,
                    modifier = Modifier.weight(1f),
                )
                if (meta != null) {
                    Text(
                        text = meta,
                        fontSize = 9.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
