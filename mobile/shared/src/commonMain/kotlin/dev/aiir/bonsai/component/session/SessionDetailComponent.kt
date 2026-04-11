package dev.aiir.bonsai.component.session

import dev.aiir.bonsai.data.model.*
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject

interface SessionDetailComponent {
    val state: StateFlow<SessionDetailState>

    fun sendMessage(text: String)
    fun interrupt()
    fun approve(requestId: String)
    fun deny(requestId: String)
    fun answerQuestion(requestId: String, answers: Map<String, String>)
    fun dismissSuggestion(requestId: String)
    fun acceptSuggestion(requestId: String)
    fun resumeSession()
    fun changeModel(model: String)
    fun changeEffort(effort: Effort?)
    fun onBack()
}

/** Tracks the state of a single tool call through its lifecycle. */
data class ToolCallState(
    val index: Int,
    val toolName: String,
    val input: JsonObject = JsonObject(emptyMap()),
    val inputSummary: String = "",
    val output: String? = null,
    val error: String? = null,
    val isComplete: Boolean = false,
    val approvalStatus: ApprovalStatus = ApprovalStatus.NONE,
    val approvalRequestId: String? = null,
    val linesAdded: Int = 0,
    val linesRemoved: Int = 0,
    // Visualization fields
    val isVisualization: Boolean = false,
    val visType: String? = null,
    val visTitle: String? = null,
    val visId: String? = null,
    val visData: JsonObject? = null,
    val visLayout: JsonObject? = null,
    val visCollapsed: Boolean = false,
)

enum class ApprovalStatus { NONE, PENDING, APPROVED, DENIED, EXPIRED }

/** A processed message block for rendering — groups consecutive textDelta events. */
sealed class ChatItem {
    data class UserMessage(val text: String) : ChatItem()
    data class AssistantMessage(val text: String, val isStreaming: Boolean = false) : ChatItem()
    data class ToolCall(val index: Int, val state: ToolCallState) : ChatItem()
    data class TurnMarker(val costUsd: Double, val tokens: Long) : ChatItem()
    data class SubagentStart(val id: String, val description: String) : ChatItem()
    data class SubagentEnd(val id: String, val costUsd: Double = 0.0) : ChatItem()
    data class PendingApproval(val requestId: String, val request: PendingRequest) : ChatItem()
    data class PendingQuestion(val requestId: String, val request: PendingRequest) : ChatItem()
    data class Suggestion(val requestId: String, val request: PendingRequest) : ChatItem()
    data class Notification(val message: String) : ChatItem()
    data class Progress(val message: String) : ChatItem()
    data class Interrupted(val reason: String = "") : ChatItem()
    data class SessionDone(val costUsd: Double, val turns: Int, val toolCalls: Int, val durationMs: Long, val filesChanged: Map<String, String> = emptyMap()) : ChatItem()
    data class SessionError(val message: String, val costUsd: Double = 0.0) : ChatItem()
    data class SessionConfig(val config: AgentConfig, val specIds: List<String> = emptyList(), val filePaths: List<String> = emptyList(), val sections: List<PromptSection> = emptyList(), val totalTokens: Int = 0) : ChatItem()
    data class PermissionDenied(val toolName: String) : ChatItem()
    data class CompactMarker(val summary: String = "") : ChatItem()
    data class RequestExpired(val toolName: String = "", val requestType: String = "") : ChatItem()
}

data class SessionDetailState(
    val bonsaiSid: String,
    val session: Session? = null,
    val events: List<AgentEvent> = emptyList(),
    val chatItems: List<ChatItem> = emptyList(),
    val pendingRequest: PendingRequest? = null,
    val toolStates: Map<Int, ToolCallState> = emptyMap(),
    val resolvedRequests: Map<String, String> = emptyMap(), // requestId → outcome ("approved", "denied", "answered:X", etc.)
    val costUsd: Double = 0.0,
    val contextTokens: Long = 0,
    val contextMax: Long = 0,
    val turns: Int = 0,
    val sessionStatus: SessionStatus = SessionStatus.IDLE,
    val sessionModel: String = "",
    val sessionModelLabel: String = "",
    val sessionName: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    val contextPercent: Int get() = if (contextMax > 0) ((contextTokens * 100) / contextMax).toInt() else 0
    val canSendMessage: Boolean get() = sessionStatus in listOf(SessionStatus.IDLE, SessionStatus.INTERRUPTED)
    val isRunning: Boolean get() = sessionStatus == SessionStatus.RUNNING
    val isWaiting: Boolean get() = sessionStatus == SessionStatus.WAITING && pendingRequest != null
    val isTerminal: Boolean get() = sessionStatus in listOf(SessionStatus.DONE, SessionStatus.ERROR)
}
