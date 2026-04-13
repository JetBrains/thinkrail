package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*

data class TokenSegment(
    val label: String,
    val tokens: Int,
    val color: Color,
)

@Composable
fun TokenBreakdownBar(
    segments: List<TokenSegment>,
    totalTokens: Int,
    modifier: Modifier = Modifier,
    height: Dp = 14.dp,
) {
    if (totalTokens == 0) return

    Column(modifier = modifier) {
        // Bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(height)
                .clip(RoundedCornerShape(height / 2)),
        ) {
            segments.forEach { segment ->
                val fraction = segment.tokens.toFloat() / totalTokens
                if (fraction > 0.02f) {
                    Box(
                        modifier = Modifier
                            .fillMaxHeight()
                            .weight(fraction)
                            .background(segment.color),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (fraction > 0.12f) {
                            Text(
                                text = segment.label,
                                fontSize = 7.sp,
                                color = Color.White,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }

        // Legend
        Spacer(modifier = Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            segments.forEach { segment ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(RoundedCornerShape(1.dp))
                            .background(segment.color),
                    )
                    Spacer(modifier = Modifier.width(3.dp))
                    Text(
                        text = "${segment.label} ${segment.tokens}",
                        fontSize = 8.sp,
                        color = segment.color,
                    )
                }
            }
        }
    }
}
