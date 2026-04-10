package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.layout.*
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
fun SummaryBoxCard(data: JsonObject, modifier: Modifier = Modifier) {
    val sections = data["sections"]?.jsonArray ?: return

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        sections.forEachIndexed { idx, sectionEl ->
            val section = sectionEl.jsonObject
            val heading = section["heading"]?.jsonPrimitive?.content
                ?: section["title"]?.jsonPrimitive?.content ?: ""
            val status = section["status"]?.jsonPrimitive?.content
            val items = section["items"]?.jsonArray ?: return@forEachIndexed

            if (idx > 0) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (status != null) {
                    VisStatusBadge(status = status, fontSize = 11.sp)
                }
                Text(heading, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }

            items.forEach { itemEl ->
                val item = itemEl.jsonObject
                val label = item["label"]?.jsonPrimitive?.content ?: ""
                val value = item["value"]?.jsonPrimitive?.content ?: ""
                val style = item["style"]?.jsonPrimitive?.content ?: "normal"

                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = label,
                        fontSize = 10.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = value,
                        fontSize = 10.sp,
                        fontWeight = if (style == "bold") FontWeight.Bold else FontWeight.Normal,
                        fontFamily = if (style == "code") FontFamily.Monospace else FontFamily.Default,
                        color = if (style == "dim") MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface,
                    )
                }
            }
        }
    }
}
