package dev.aiir.bonsai.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
enum class SessionStatus {
    @SerialName("draft") DRAFT,
    @SerialName("initializing") INITIALIZING,
    @SerialName("idle") IDLE,
    @SerialName("running") RUNNING,
    @SerialName("waiting") WAITING,
    @SerialName("done") DONE,
    @SerialName("error") ERROR,
    @SerialName("interrupted") INTERRUPTED,
}

@Serializable
enum class PendingRequestType {
    @SerialName("question") QUESTION,
    @SerialName("approval") APPROVAL,
    @SerialName("suggestion") SUGGESTION,
    @SerialName("description-suggestion") DESCRIPTION_SUGGESTION,
    @SerialName("step-proposal") STEP_PROPOSAL,
}

@Serializable
data class PendingRequest(
    val requestId: String,
    val type: PendingRequestType,
    // Question fields
    val questions: List<Question>? = null,
    // Approval fields
    val toolName: String? = null,
    val toolInput: JsonObject? = null,
    // Suggestion fields
    val skill: String? = null,
    val specIds: List<String>? = null,
    val name: String? = null,
    val reason: String? = null,
    val prompt: String? = null,
    // Description suggestion fields
    val description: String? = null,
    val section: String? = null,
    // Step proposal fields
    val ticketId: String? = null,
    val stepNumber: Int? = null,
    val stepTitle: String? = null,
    val inputSpecIds: List<String>? = null,
)

@Serializable
data class SessionMetrics(
    val costUsd: Double = 0.0,
    val turns: Int = 0,
    val toolCalls: Int = 0,
    val contextTokens: Long = 0,
    val contextMax: Long = 0,
    val durationMs: Long = 0,
    val filesChanged: Map<String, String> = emptyMap(),
    val contextUsage: ContextUsage? = null,
)

@Serializable
data class ContextUsage(
    val contextMax: Long = 0,
    val contextTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val cacheCreationTokens: Long = 0,
    val inputTokens: Long = 0,
    val turnHistory: List<TurnUsage> = emptyList(),
    val runBoundaries: List<Int> = emptyList(),
    val toolCallCounts: Map<String, Int> = emptyMap(),
    val toolTokens: Map<String, JsonObject> = emptyMap(),
    val filesRead: List<String> = emptyList(),
    val filesWritten: List<String> = emptyList(),
)

@Serializable
data class TurnUsage(
    val turnIndex: Int = 0,
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheCreationTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val totalContextTokens: Long = 0,
    val costUsd: Double = 0.0,
    val timestamp: Long = 0,
    val sdkTurns: Int = 0,
)

@Serializable
data class PromptSection(
    val key: String,
    val label: String,
    val content: String,
    val tokens: Int = 0,
)

@Serializable
data class Session(
    val bonsaiSid: String,
    val name: String = "",
    val skillId: String? = null,
    val specIds: List<String> = emptyList(),
    val filePaths: List<String> = emptyList(),
    val status: SessionStatus = SessionStatus.IDLE,
    val model: String = "",
    val permissionMode: PermissionMode = PermissionMode.DEFAULT,
    val betas: List<String> = emptyList(),
    val effort: Effort? = null,
    val maxTurns: Int = 50,
    val startedAt: Long = 0,
    val events: List<AgentEvent> = emptyList(),
    val metrics: SessionMetrics = SessionMetrics(),
    val pendingRequest: PendingRequest? = null,
    val answeredRequests: Map<String, JsonObject> = emptyMap(),
    val metaTicketId: String? = null,
    val restored: Boolean? = null,
    val systemPrompt: String? = null,
    val promptSections: List<PromptSection>? = null,
)
