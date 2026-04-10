package dev.aiir.bonsai.component.session

import dev.aiir.bonsai.data.model.PendingRequest
import dev.aiir.bonsai.data.model.Session
import dev.aiir.bonsai.data.model.SessionStatus
import kotlinx.coroutines.flow.StateFlow

interface SessionListComponent {
    val state: StateFlow<SessionListState>

    fun loadSessions()
    fun onTabChanged(tab: SessionTab)
    fun onSessionTapped(bonsaiSid: String)
    fun onApprove(bonsaiSid: String, requestId: String)
    fun onDeny(bonsaiSid: String, requestId: String)
    fun onAnswerQuestion(bonsaiSid: String, requestId: String, answers: Map<String, String>)
    fun onNewSession()
}

enum class SessionTab { ACTIVE, ALL }

data class SessionListState(
    val sessions: List<Session> = emptyList(),
    val activeTab: SessionTab = SessionTab.ACTIVE,
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    /** Sessions needing user attention (waiting with pendingRequest). */
    val attentionSessions: List<Session>
        get() = sessions.filter { it.status == SessionStatus.WAITING && it.pendingRequest != null }

    /** Active (non-terminal) sessions, attention-needed sorted to top. */
    val activeSessions: List<Session>
        get() {
            val active = sessions.filter { it.status !in listOf(SessionStatus.DONE, SessionStatus.ERROR) }
            val attention = active.filter { it.status == SessionStatus.WAITING && it.pendingRequest != null }
            val rest = active.filter { it !in attention }
            return attention + rest
        }

    /** Count string for active tab: "!!N / M" */
    val activeTabLabel: String
        get() {
            val attentionCount = attentionSessions.size
            val totalActive = activeSessions.size
            return if (attentionCount > 0) "Active (!!$attentionCount / $totalActive)"
            else "Active ($totalActive)"
        }
}
