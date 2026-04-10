package dev.aiir.bonsai.component.session

import com.arkivanov.decompose.ComponentContext
import dev.aiir.bonsai.data.model.AgentEvent
import dev.aiir.bonsai.data.model.Session
import dev.aiir.bonsai.data.serialization.BonsaiJson
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class SessionDetailComponentImpl(
    componentContext: ComponentContext,
    private val bonsaiSid: String,
    private val rpcMethods: RpcMethods,
    private val rpcClient: RpcClient,
    private val onBack: () -> Unit,
) : SessionDetailComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(SessionDetailState(bonsaiSid = bonsaiSid))
    override val state: StateFlow<SessionDetailState> = _state.asStateFlow()

    init {
        loadSession()
        observeEvents()
    }

    private fun loadSession() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val session = rpcMethods.sessionGet(bonsaiSid)
                _state.update {
                    it.copy(
                        session = session,
                        events = session?.events ?: emptyList(),
                        pendingRequest = session?.pendingRequest,
                        isLoading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun sendMessage(text: String) {
        if (text.isBlank()) return
        scope.launch {
            try {
                rpcMethods.agentSend(bonsaiSid, text)
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun interrupt() {
        scope.launch {
            try {
                rpcMethods.agentInterrupt(bonsaiSid)
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun approve(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("behavior", "allow")
                })
                _state.update { it.copy(pendingRequest = null) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun deny(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("behavior", "deny")
                })
                _state.update { it.copy(pendingRequest = null) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun answerQuestion(requestId: String, answers: Map<String, String>) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("answers", buildJsonObject {
                        answers.forEach { (k, v) -> put(k, v) }
                    })
                })
                _state.update { it.copy(pendingRequest = null) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun onBack() {
        onBack.invoke()
    }

    private fun observeEvents() {
        scope.launch {
            rpcClient.notificationsFor("agent/").collect { notification ->
                val params = notification.params
                val sid = params["bonsaiSid"]?.jsonPrimitive?.content ?: return@collect
                if (sid != bonsaiSid) return@collect

                when (notification.method) {
                    "agent/textDelta", "agent/toolCallStart", "agent/toolCallEnd",
                    "agent/turnComplete", "agent/done", "agent/error",
                    "agent/interrupted", "agent/progress", "agent/notification" -> {
                        // Reload full session to get updated events
                        loadSession()
                    }
                    "agent/askUserQuestion", "agent/confirmAction" -> {
                        loadSession()
                    }
                }
            }
        }
    }
}
