package dev.aiir.bonsai.component.session

import com.arkivanov.decompose.ComponentContext
import dev.aiir.bonsai.data.serialization.BonsaiJson
import dev.aiir.bonsai.data.model.Session
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class SessionListComponentImpl(
    componentContext: ComponentContext,
    private val rpcMethods: RpcMethods,
    private val rpcClient: RpcClient,
    private val onSessionSelected: (String) -> Unit,
) : SessionListComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(SessionListState())
    override val state: StateFlow<SessionListState> = _state.asStateFlow()

    init {
        loadSessions()
        observeAgentEvents()
    }

    override fun loadSessions() {
        scope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                val sessions = rpcMethods.sessionList()
                _state.update { it.copy(sessions = sessions, isLoading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun onTabChanged(tab: SessionTab) {
        _state.update { it.copy(activeTab = tab) }
    }

    override fun onSessionTapped(bonsaiSid: String) {
        onSessionSelected(bonsaiSid)
    }

    override fun onApprove(bonsaiSid: String, requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("behavior", "allow")
                })
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun onDeny(bonsaiSid: String, requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("behavior", "deny")
                })
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun onAnswerQuestion(bonsaiSid: String, requestId: String, answers: Map<String, String>) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("answers", buildJsonObject {
                        answers.forEach { (k, v) -> put(k, v) }
                    })
                })
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun onNewSession() {
        // TODO: Navigate to new session form
    }

    private fun observeAgentEvents() {
        scope.launch {
            rpcClient.notificationsFor("agent/").collect {
                // Reload sessions on agent state changes
                loadSessions()
            }
        }
    }
}
