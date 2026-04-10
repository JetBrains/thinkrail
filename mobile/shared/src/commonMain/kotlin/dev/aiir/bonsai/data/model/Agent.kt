package dev.aiir.bonsai.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
enum class EventType {
    @SerialName("sessionStart") SESSION_START,
    @SerialName("textDelta") TEXT_DELTA,
    @SerialName("toolCallStart") TOOL_CALL_START,
    @SerialName("toolCallEnd") TOOL_CALL_END,
    @SerialName("turnComplete") TURN_COMPLETE,
    @SerialName("interrupted") INTERRUPTED,
    @SerialName("subagentStart") SUBAGENT_START,
    @SerialName("subagentEnd") SUBAGENT_END,
    @SerialName("notification") NOTIFICATION,
    @SerialName("compact") COMPACT,
    @SerialName("progress") PROGRESS,
    @SerialName("done") DONE,
    @SerialName("error") ERROR,
    @SerialName("permissionDenied") PERMISSION_DENIED,
    @SerialName("ready") READY,
    @SerialName("askUserQuestion") ASK_USER_QUESTION,
    @SerialName("confirmAction") CONFIRM_ACTION,
    @SerialName("suggestSession") SUGGEST_SESSION,
    @SerialName("suggestDescription") SUGGEST_DESCRIPTION,
    @SerialName("requestResolved") REQUEST_RESOLVED,
    @SerialName("requestExpired") REQUEST_EXPIRED,
    @SerialName("userMessage") USER_MESSAGE,
}

@Serializable
data class AgentConfig(
    val model: String = "claude-sonnet-4-6",
    val maxTurns: Int = 50,
    val permissionMode: String = "default",
    val streamText: Boolean = true,
    val betas: List<String> = emptyList(),
    val effort: String? = null,
)

@Serializable
data class AgentEvent(
    val bonsaiSid: String = "",
    val sessionId: String = "",
    val eventType: EventType = EventType.TEXT_DELTA,
    val payload: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class AgentResult(
    val bonsaiSid: String,
    val sessionId: String,
    val result: String,
    val costUsd: Double = 0.0,
    val turns: Int = 0,
    val durationMs: Long = 0,
    val usage: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class AgentTask(
    val bonsaiSid: String,
    val name: String = "",
    val status: String = "initializing", // TaskStatus as string
    val specIds: List<String> = emptyList(),
    val filePaths: List<String> = emptyList(),
    val skillId: String? = null,
    val sessionPrompt: String? = null,
    val config: AgentConfig = AgentConfig(),
    val sessionId: String? = null,
    val metaTicketId: String? = null,
    val systemPrompt: String? = null,
    val created: String = "",
    val updated: String = "",
)

@Serializable
data class QuestionOption(
    val label: String,
    val description: String,
)

@Serializable
data class Question(
    val question: String,
    val header: String,
    val options: List<QuestionOption> = emptyList(),
    val multiSelect: Boolean = false,
)

@Serializable
data class AskUserQuestionResponse(
    val questions: List<Question> = emptyList(),
    val answers: Map<String, String> = emptyMap(),
)

@Serializable
data class ToolApprovalResponse(
    val behavior: String, // "allow" | "deny"
    val message: String? = null,
    val interrupt: Boolean = false,
)
