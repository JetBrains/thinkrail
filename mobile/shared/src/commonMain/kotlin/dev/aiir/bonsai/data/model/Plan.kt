package dev.aiir.bonsai.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class StepStatus {
    @SerialName("pending") PENDING,
    @SerialName("in_progress") IN_PROGRESS,
    @SerialName("done") DONE,
    @SerialName("skipped") SKIPPED,
}

@Serializable
data class PlanStep(
    val stepNumber: Int,
    val title: String,
    val description: String = "",
    val status: StepStatus = StepStatus.PENDING,
    val sessionId: String? = null,
)

@Serializable
data class Plan(
    val title: String,
    val steps: List<PlanStep> = emptyList(),
    val verification: List<String> = emptyList(),
)
