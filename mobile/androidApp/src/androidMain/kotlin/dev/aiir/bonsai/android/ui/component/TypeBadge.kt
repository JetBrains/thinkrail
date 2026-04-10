package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.data.model.MetaTicketType

@Composable
fun TypeBadge(
    type: MetaTicketType,
    modifier: Modifier = Modifier,
) {
    val (color, label) = when (type) {
        MetaTicketType.FEATURE -> TypeFeature to "feature"
        MetaTicketType.BUG -> TypeBug to "bug"
        MetaTicketType.IMPROVEMENT -> TypeImprovement to "improvement"
        MetaTicketType.IDEA -> TypeIdea to "idea"
    }

    Text(
        text = label,
        fontSize = 10.sp,
        fontWeight = FontWeight.Medium,
        color = color,
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.15f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}
