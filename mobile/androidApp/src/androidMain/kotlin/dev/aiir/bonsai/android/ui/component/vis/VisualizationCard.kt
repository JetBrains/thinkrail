package dev.aiir.bonsai.android.ui.component.vis

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.TypeImprovement
import dev.aiir.bonsai.component.session.ToolCallState

@Composable
fun VisualizationCard(
    state: ToolCallState,
    modifier: Modifier = Modifier,
) {
    val visData = state.visData ?: return
    val visType = state.visType ?: return
    val visTitle = state.visTitle

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(
            containerColor = TypeImprovement.copy(alpha = 0.06f),
        ),
        border = androidx.compose.foundation.BorderStroke(1.dp, TypeImprovement.copy(alpha = 0.15f)),
    ) {
        Column(modifier = Modifier.padding(10.dp)) {
            if (visTitle != null) {
                Text(
                    text = visTitle,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = TypeImprovement,
                )
                Spacer(modifier = Modifier.height(6.dp))
            }

            when (visType) {
                "progress-tracker" -> ProgressTrackerCard(data = visData)
                "summary-box" -> SummaryBoxCard(data = visData)
                "status-list" -> StatusListCard(data = visData)
                "data-table" -> DataTableCard(data = visData)
                "comparison" -> ComparisonCard(data = visData)
                "diagram" -> MermaidDiagramCard(data = visData)
                else -> Text("Unknown visualization type: $visType", fontSize = 10.sp)
            }
        }
    }
}
