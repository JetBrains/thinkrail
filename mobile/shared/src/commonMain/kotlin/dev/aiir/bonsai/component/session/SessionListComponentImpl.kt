package dev.aiir.bonsai.component.session

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
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

class SessionListComponentImpl(
    componentContext: ComponentContext,
    private val rpcMethods: RpcMethods,
    private val rpcClient: RpcClient,
    private val onSessionSelected: (String) -> Unit,
    private val onNewSessionRequested: () -> Unit = {},
) : SessionListComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(SessionListState())
    override val state: StateFlow<SessionListState> = _state.asStateFlow()

    // Debounce: avoid reloading more than once per second
    private var lastReloadTime = 0L
    private var pendingReload: Job? = null

    init {
        lifecycle.doOnDestroy { scope.cancel() }
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
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "allow") })
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onDeny(bonsaiSid: String, requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "deny") })
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onAnswerQuestion(bonsaiSid: String, requestId: String, answers: Map<String, String>) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("answers", buildJsonObject { answers.forEach { (k, v) -> put(k, v) } })
                })
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onContinueSession(bonsaiSid: String) {
        scope.launch {
            try {
                rpcMethods.sessionContinue(bonsaiSid)
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onStopSession(bonsaiSid: String) {
        scope.launch {
            try {
                rpcMethods.agentInterrupt(bonsaiSid)
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onEndSession(bonsaiSid: String) {
        scope.launch {
            try {
                rpcMethods.agentEnd(bonsaiSid)
                debouncedReload()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onDeleteSession(bonsaiSid: String) {
        scope.launch {
            try {
                rpcMethods.sessionDelete(bonsaiSid)
                // Immediately remove from local state
                _state.update { state ->
                    state.copy(sessions = state.sessions.filter { it.bonsaiSid != bonsaiSid })
                }
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onNewSession() {
        onNewSessionRequested()
    }

    private fun observeAgentEvents() {
        // Watch notifications (events without JSON-RPC id)
        scope.launch {
            rpcClient.notificationsFor("agent/").collect { notification ->
                val method = notification.method
                if (method in RELOAD_METHODS) {
                    debouncedReload()
                }
            }
        }
        // Also watch server-initiated requests (events WITH JSON-RPC id) —
        // approval and question requests arrive this way
        scope.launch {
            rpcClient.serverRequests.collect { request ->
                if (request.method in RELOAD_METHODS) {
                    debouncedReload()
                }
            }
        }
    }

    companion object {
        private val RELOAD_METHODS = setOf(
            "agent/done", "agent/error", "agent/interrupted",
            "agent/sessionStart", "agent/turnComplete",
            "agent/askUserQuestion", "agent/confirmAction",
            "agent/requestResolved", "agent/requestExpired",
        )
    }

    private fun debouncedReload() {
        val now = System.currentTimeMillis()
        if (now - lastReloadTime < 1000) {
            // Schedule a delayed reload if one isn't already pending
            if (pendingReload?.isActive != true) {
                pendingReload = scope.launch {
                    delay(1000)
                    lastReloadTime = System.currentTimeMillis()
                    loadSessions()
                }
            }
        } else {
            lastReloadTime = now
            loadSessions()
        }
    }
}
