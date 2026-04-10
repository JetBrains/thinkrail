package dev.aiir.bonsai.component.session

import dev.aiir.bonsai.data.model.*
import kotlinx.coroutines.flow.StateFlow

interface SessionDetailComponent {
    val state: StateFlow<SessionDetailState>

    fun sendMessage(text: String)
    fun interrupt()
    fun approve(requestId: String)
    fun deny(requestId: String)
    fun answerQuestion(requestId: String, answers: Map<String, String>)
    fun onBack()
}

data class SessionDetailState(
    val bonsaiSid: String,
    val session: Session? = null,
    val events: List<AgentEvent> = emptyList(),
    val pendingRequest: PendingRequest? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    val sessionName: String get() = session?.name?.ifEmpty { bonsaiSid.take(8) } ?: bonsaiSid.take(8)
    val status: SessionStatus get() = session?.status ?: SessionStatus.IDLE
    val model: String get() = session?.model ?: ""
    val canSendMessage: Boolean get() = status in listOf(SessionStatus.IDLE, SessionStatus.INTERRUPTED)
    val isWaiting: Boolean get() = status == SessionStatus.WAITING && pendingRequest != null
}
