package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.android.ui.theme.StatusError
import kotlinx.serialization.json.*

@Composable
fun ComparisonCard(data: JsonObject, modifier: Modifier = Modifier) {
    val options = data["options"]?.jsonArray ?: return

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { optEl ->
            val opt = optEl.jsonObject
            val name = opt["name"]?.jsonPrimitive?.content ?: ""
            val description = opt["description"]?.jsonPrimitive?.content
            val pros = opt["pros"]?.jsonArray?.mapNotNull { it.jsonPrimitive.content }
            val cons = opt["cons"]?.jsonArray?.mapNotNull { it.jsonPrimitive.content }
            val isRecommended = opt["recommendation"]?.jsonPrimitive?.booleanOrNull == true

            val borderColor = if (isRecommended) BonsaiGreen else MaterialTheme.colorScheme.outlineVariant

            OutlinedCard(
                shape = RoundedCornerShape(8.dp),
                border = BorderStroke(if (isRecommended) 2.dp else 1.dp, borderColor),
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(name, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        if (isRecommended) {
                            Surface(
                                shape = RoundedCornerShape(4.dp),
                                color = BonsaiGreen.copy(alpha = 0.15f),
                            ) {
                                Text(
                                    "\u2713 Recommended",
                                    fontSize = 9.sp,
                                    color = BonsaiGreen,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                    if (description != null) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(description, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!pros.isNullOrEmpty()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        pros.forEach { pro ->
                            Text("+ $pro", fontSize = 10.sp, color = BonsaiGreen)
                        }
                    }
                    if (!cons.isNullOrEmpty()) {
                        Spacer(modifier = Modifier.height(2.dp))
                        cons.forEach { con ->
                            Text("- $con", fontSize = 10.sp, color = StatusError)
                        }
                    }
                }
            }
        }
    }
}
