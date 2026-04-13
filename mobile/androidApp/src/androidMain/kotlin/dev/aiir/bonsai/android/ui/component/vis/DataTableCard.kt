package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.*

@Composable
fun DataTableCard(data: JsonObject, modifier: Modifier = Modifier) {
    val columns = data["columns"]?.jsonArray ?: return
    val rows = data["rows"]?.jsonArray ?: return
    val statusColumn = data["statusColumn"]?.jsonPrimitive?.intOrNull

    val colInfo = columns.map { col ->
        if (col is JsonPrimitive) {
            col.content to col.content
        } else {
            val obj = col.jsonObject
            val key = obj["key"]?.jsonPrimitive?.content ?: ""
            val label = obj["label"]?.jsonPrimitive?.content ?: key
            key to label
        }
    }

    val scrollState = rememberScrollState()

    Column(modifier = modifier.horizontalScroll(scrollState)) {
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            colInfo.forEach { (_, label) ->
                Text(
                    text = label,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.widthIn(min = 60.dp),
                )
            }
        }
        HorizontalDivider(
            modifier = Modifier.padding(vertical = 4.dp),
            color = MaterialTheme.colorScheme.outlineVariant,
        )
        rows.forEach { rowEl ->
            Row(
                modifier = Modifier.padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                colInfo.forEachIndexed { j, (key, _) ->
                    val cell = when (rowEl) {
                        is JsonArray -> rowEl.getOrNull(j)?.jsonPrimitive?.content ?: ""
                        is JsonObject -> rowEl[key]?.jsonPrimitive?.content ?: ""
                        else -> ""
                    }
                    val isStatusCol = statusColumn == j
                        || (rowEl is JsonObject && (columns.getOrNull(j)?.jsonObject?.get("isStatus")?.jsonPrimitive?.booleanOrNull == true))
                    val color = if (isStatusCol) visStatusColor(cell) else MaterialTheme.colorScheme.onSurface
                    Text(
                        text = if (isStatusCol) "${visStatusIcon(cell)} $cell" else cell,
                        fontSize = 10.sp,
                        color = color,
                        modifier = Modifier.widthIn(min = 60.dp),
                    )
                }
            }
        }
    }
}
