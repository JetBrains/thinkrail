package dev.aiir.bonsai.android.ui.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.data.model.PendingRequest
import dev.aiir.bonsai.data.model.Question

@Composable
fun QuestionCard(
    request: PendingRequest,
    onSubmit: (Map<String, String>) -> Unit,
    modifier: Modifier = Modifier,
) {
    val questions = request.questions ?: return
    val answers = remember { mutableStateMapOf<String, String>() }

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = StatusQuestion.copy(alpha = 0.08f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, StatusQuestion.copy(alpha = 0.25f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("\u2753", fontSize = 14.sp)
                Spacer(modifier = Modifier.width(6.dp))
                Text("Question", fontWeight = FontWeight.Bold, color = StatusQuestion, fontSize = 12.sp)
            }

            questions.forEach { question ->
                Spacer(modifier = Modifier.height(8.dp))
                Text(text = question.question, fontSize = 12.sp)
                Spacer(modifier = Modifier.height(6.dp))

                // Option chips
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    question.options.forEach { option ->
                        val isSelected = answers[question.question] == option.label
                        FilterChip(
                            selected = isSelected,
                            onClick = { answers[question.question] = option.label },
                            label = { Text(option.label, fontSize = 10.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = StatusQuestion,
                                selectedLabelColor = Color.White,
                            ),
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(10.dp))
            Button(
                onClick = { onSubmit(answers.toMap()) },
                enabled = answers.size == questions.size,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = StatusQuestion),
                contentPadding = PaddingValues(vertical = 8.dp),
            ) { Text("Submit Answer", fontSize = 12.sp) }
        }
    }
}

@Composable
private fun FlowRow(
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: @Composable () -> Unit,
) {
    // Simple flow row using built-in
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = horizontalArrangement,
        verticalArrangement = verticalArrangement,
    ) { content() }
}
