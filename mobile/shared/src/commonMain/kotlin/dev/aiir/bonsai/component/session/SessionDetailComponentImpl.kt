package dev.aiir.bonsai.component.session

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.model.*
import dev.aiir.bonsai.data.serialization.BonsaiJson
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.*

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

    // Internal tracking for text accumulation
    private val currentAssistantText = StringBuilder()
    private var toolCallIndex = 0

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        loadInitialSession()
        subscribeToEvents()
    }

    // ── Load historical session data once ──

    private fun loadInitialSession() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val session = rpcMethods.sessionGet(bonsaiSid)
                if (session != null) {
                    _state.update {
                        it.copy(
                            session = session,
                            events = session.events,
                            sessionStatus = session.status,
                            sessionModel = session.model,
                            sessionModelLabel = deriveModelLabel(session.model),
                            sessionName = session.name.ifEmpty { bonsaiSid.take(8) },
                            costUsd = session.metrics.costUsd,
                            contextTokens = session.metrics.contextTokens,
                            contextMax = session.metrics.contextMax,
                            turns = session.metrics.turns,
                            pendingRequest = session.pendingRequest,
                            isLoading = false,
                        )
                    }
                    // Process existing events into chat items
                    session.events.forEach { processEvent(it) }
                    flushAssistantText()
                    rebuildChatItems()
                } else {
                    _state.update { it.copy(isLoading = false) }
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    // ── Subscribe to real-time notifications ──

    private fun subscribeToEvents() {
        // Agent event notifications (no id, no response expected)
        scope.launch {
            rpcClient.notifications.collect { notification ->
                val params = notification.params
                val sid = params["bonsaiSid"]?.jsonPrimitive?.content
                if (sid == null) {
                    println("[SessionDetail] Dropped ${notification.method}: missing bonsaiSid in params")
                    return@collect
                }
                if (sid != bonsaiSid) return@collect

                // Pre-route ephemeral notifications (state updates, not chat events)
                when (notification.method) {
                    "agent/costEstimate" -> { handleCostEstimate(params); return@collect }
                    "agent/statusChanged" -> { handleStatusChanged(params); return@collect }
                    "agent/configChanged" -> { handleConfigChanged(params); return@collect }
                }

                val eventTypeName = notification.method.removePrefix("agent/")
                val eventType = parseEventType(eventTypeName)
                if (eventType == null) {
                    println("[SessionDetail] Dropped ${notification.method}: unknown event type '$eventTypeName'")
                    return@collect
                }
                val event = AgentEvent(
                    bonsaiSid = sid,
                    eventType = eventType,
                    payload = params,
                )
                _state.update { it.copy(events = it.events + event) }
                processEvent(event)

                // Incremental: TEXT_DELTA only updates the streaming message in place
                if (eventType == EventType.TEXT_DELTA) {
                    updateStreamingText()
                } else {
                    rebuildChatItems()
                }
            }
        }

        // Server-initiated requests (have id, expect response) — approvals, questions
        scope.launch {
            rpcClient.serverRequests.collect { request ->
                val params = request.params
                val sid = params["bonsaiSid"]?.jsonPrimitive?.content ?: return@collect
                if (sid != bonsaiSid) return@collect

                val requestId = params["requestId"]?.jsonPrimitive?.content ?: return@collect
                val pending = parsePendingRequest(request.method, params, requestId)
                if (pending != null) {
                    _state.update {
                        it.copy(
                            pendingRequest = pending,
                            sessionStatus = SessionStatus.WAITING,
                        )
                    }
                    // Also add as event for chat rendering
                    val eventTypeName = request.method.removePrefix("agent/")
                    val eventType = parseEventType(eventTypeName) ?: return@collect
                    val event = AgentEvent(
                        bonsaiSid = sid,
                        eventType = eventType,
                        payload = params,
                    )
                    processEvent(event)
                    rebuildChatItems()
                }
            }
        }
    }

    /** Incrementally update the streaming assistant text without full rebuild. */
    private fun updateStreamingText() {
        if (currentAssistantText.isEmpty()) return
        val items = _state.value.chatItems.toMutableList()
        val lastItem = items.lastOrNull()
        if (lastItem is ChatItem.AssistantMessage && lastItem.isStreaming) {
            items[items.size - 1] = ChatItem.AssistantMessage(currentAssistantText.toString(), isStreaming = true)
        } else {
            items.add(ChatItem.AssistantMessage(currentAssistantText.toString(), isStreaming = true))
        }
        _state.update { it.copy(chatItems = items) }
    }

    // ── Process a single event into internal tracking state ──

    private fun processEvent(event: AgentEvent) {
        val payload = event.payload

        when (event.eventType) {
            EventType.USER_MESSAGE -> {
                flushAssistantText()
            }

            EventType.TEXT_DELTA -> {
                val text = payload["text"]?.jsonPrimitive?.content ?: ""
                currentAssistantText.append(text)
            }

            EventType.TOOL_CALL_START -> {
                flushAssistantText()
                val idx = toolCallIndex++
                val toolName = payload["toolName"]?.jsonPrimitive?.content ?: "tool"
                val input = payload["toolInput"] as? JsonObject ?: JsonObject(emptyMap())
                val isVis = toolName.endsWith("bonsai_visualize")

                val toolState = if (isVis) {
                    val visType = input["type"]?.jsonPrimitive?.content
                    val visTitle = input["title"]?.jsonPrimitive?.content ?: visType ?: "Visualization"
                    ToolCallState(
                        index = idx,
                        toolName = toolName,
                        input = input,
                        inputSummary = visTitle,
                        isVisualization = true,
                        visType = visType,
                        visTitle = visTitle,
                        visId = input["visId"]?.jsonPrimitive?.content,
                        visData = input["data"] as? JsonObject,
                        visLayout = input["layout"] as? JsonObject,
                    )
                } else {
                    val summary = extractToolSummary(toolName, input)
                    ToolCallState(
                        index = idx,
                        toolName = toolName,
                        input = input,
                        inputSummary = summary,
                    )
                }
                _state.update { it.copy(toolStates = it.toolStates + (idx to toolState)) }
            }

            EventType.TOOL_CALL_END -> {
                val output = payload["output"]?.jsonPrimitive?.content ?: ""
                val error = payload["error"]?.jsonPrimitive?.content
                val lastIdx = toolCallIndex - 1
                _state.update { state ->
                    val existing = state.toolStates[lastIdx] ?: return
                    val updated = existing.copy(
                        output = output,
                        error = error,
                        isComplete = true,
                    )
                    state.copy(toolStates = state.toolStates + (lastIdx to updated))
                }
            }

            EventType.TURN_COMPLETE -> {
                flushAssistantText()
                val cost = payload["costUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                val ctx = payload["contextTokens"]?.jsonPrimitive?.longOrNull ?: 0
                val ctxMax = payload["contextMax"]?.jsonPrimitive?.longOrNull ?: 0
                _state.update {
                    it.copy(
                        costUsd = it.costUsd + cost,
                        contextTokens = ctx,
                        contextMax = if (ctxMax > 0) ctxMax else it.contextMax,
                        turns = it.turns + 1,
                        sessionStatus = SessionStatus.IDLE,
                    )
                }
            }

            EventType.DONE -> {
                flushAssistantText()
                _state.update { it.copy(sessionStatus = SessionStatus.DONE, pendingRequest = null) }
            }

            EventType.ERROR -> {
                flushAssistantText()
                _state.update { it.copy(sessionStatus = SessionStatus.ERROR, pendingRequest = null) }
            }

            EventType.INTERRUPTED -> {
                flushAssistantText()
                _state.update { it.copy(sessionStatus = SessionStatus.INTERRUPTED, pendingRequest = null) }
            }

            EventType.CONFIRM_ACTION -> {
                flushAssistantText()
                // Link approval to the last tool call
                val lastIdx = toolCallIndex - 1
                val requestId = payload["requestId"]?.jsonPrimitive?.content
                if (requestId != null) {
                    _state.update { state ->
                        val existing = state.toolStates[lastIdx]
                        if (existing != null) {
                            val updated = existing.copy(
                                approvalStatus = ApprovalStatus.PENDING,
                                approvalRequestId = requestId,
                            )
                            state.copy(toolStates = state.toolStates + (lastIdx to updated))
                        } else state
                    }
                }
                _state.update { it.copy(sessionStatus = SessionStatus.WAITING) }
            }

            EventType.ASK_USER_QUESTION -> {
                flushAssistantText()
                _state.update { it.copy(sessionStatus = SessionStatus.WAITING) }
            }

            EventType.REQUEST_RESOLVED -> {
                val requestId = payload["requestId"]?.jsonPrimitive?.content ?: ""
                _state.update { it.copy(pendingRequest = null) }
            }

            EventType.REQUEST_EXPIRED -> {
                val requestId = payload["requestId"]?.jsonPrimitive?.content ?: ""
                // Mark tool call approval as expired
                _state.update { state ->
                    val updated = state.toolStates.mapValues { (_, ts) ->
                        if (ts.approvalRequestId == requestId) ts.copy(approvalStatus = ApprovalStatus.EXPIRED) else ts
                    }
                    state.copy(toolStates = updated, pendingRequest = null)
                }
            }

            EventType.SUBAGENT_START, EventType.SUBAGENT_END,
            EventType.NOTIFICATION, EventType.PROGRESS,
            EventType.PERMISSION_DENIED, EventType.SESSION_START,
            EventType.READY, EventType.SUGGEST_SESSION,
            EventType.SUGGEST_DESCRIPTION, EventType.COMPACT -> {
                // These are handled in rebuildChatItems()
            }
        }
    }

    // ── Flush accumulated assistant text into a completed message ──

    private val completedMessages = mutableListOf<ChatItem>()

    private fun flushAssistantText() {
        if (currentAssistantText.isNotEmpty()) {
            completedMessages.add(ChatItem.AssistantMessage(currentAssistantText.toString()))
            currentAssistantText.clear()
        }
    }

    // ── Build the final chat items list from events + tracked state ──

    private fun rebuildChatItems() {
        val items = mutableListOf<ChatItem>()
        var assistantText = StringBuilder()
        var tcIdx = 0

        // Pre-scan: find last done/error event index (only show full banner for the last one)
        var lastDoneIndex = -1
        var lastErrorIndex = -1
        for ((i, event) in _state.value.events.withIndex()) {
            if (event.eventType == EventType.DONE) lastDoneIndex = i
            if (event.eventType == EventType.ERROR) lastErrorIndex = i
        }

        // Pre-scan: find latest tool-call index per visId for collapse tracking
        val latestVisByVisId = mutableMapOf<String, Int>()
        var scanTcIdx = 0
        for (event in _state.value.events) {
            if (event.eventType == EventType.TOOL_CALL_START) {
                val toolName = event.payload["toolName"]?.jsonPrimitive?.content ?: ""
                if (toolName.endsWith("bonsai_visualize")) {
                    val visId = (event.payload["toolInput"] as? JsonObject)
                        ?.get("visId")?.jsonPrimitive?.content
                    if (visId != null) {
                        latestVisByVisId[visId] = scanTcIdx
                    }
                }
                scanTcIdx++
            }
        }

        for ((eventIndex, event) in _state.value.events.withIndex()) {
            val payload = event.payload

            when (event.eventType) {
                EventType.SESSION_START -> {
                    val config = _state.value.session?.let {
                        AgentConfig(model = it.model, permissionMode = it.permissionMode, effort = it.effort)
                    } ?: AgentConfig()
                    items.add(ChatItem.SessionConfig(
                        config = config,
                        specIds = _state.value.session?.specIds ?: emptyList(),
                        filePaths = _state.value.session?.filePaths ?: emptyList(),
                        sections = _state.value.session?.promptSections ?: emptyList(),
                        totalTokens = _state.value.session?.promptSections?.sumOf { it.tokens } ?: 0,
                    ))
                }

                EventType.USER_MESSAGE -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    val text = payload["text"]?.jsonPrimitive?.content ?: ""
                    items.add(ChatItem.UserMessage(text))
                }

                EventType.TEXT_DELTA -> {
                    val text = payload["text"]?.jsonPrimitive?.content ?: ""
                    assistantText.append(text)
                }

                EventType.TOOL_CALL_START -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    val toolState = _state.value.toolStates[tcIdx]
                    if (toolState != null) {
                        val finalState = if (toolState.isVisualization && toolState.visId != null) {
                            val isLatest = latestVisByVisId[toolState.visId] == tcIdx
                            toolState.copy(visCollapsed = !isLatest)
                        } else {
                            toolState
                        }
                        items.add(ChatItem.ToolCall(tcIdx, finalState))
                    }
                    tcIdx++
                }

                EventType.TOOL_CALL_END -> { /* State updated in toolStates, ToolCall item reads it */ }

                EventType.TURN_COMPLETE -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    val cost = payload["costUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                    val tokens = payload["contextTokens"]?.jsonPrimitive?.longOrNull ?: 0
                    items.add(ChatItem.TurnMarker(cost, tokens))
                }

                EventType.SUBAGENT_START -> {
                    val id = payload["subagentId"]?.jsonPrimitive?.content ?: ""
                    val desc = payload["description"]?.jsonPrimitive?.content ?: "Subagent"
                    items.add(ChatItem.SubagentStart(id, desc))
                }

                EventType.SUBAGENT_END -> {
                    val id = payload["subagentId"]?.jsonPrimitive?.content ?: ""
                    val cost = payload["costUsd"]?.jsonPrimitive?.doubleOrNull ?: 0.0
                    items.add(ChatItem.SubagentEnd(id, cost))
                }

                EventType.CONFIRM_ACTION -> {
                    // Pending approvals are rendered in the bottomBar, not inline
                    // Resolved approvals show on the ToolCall card (via toolState.approvalStatus)
                }

                EventType.ASK_USER_QUESTION -> {
                    // Pending questions are rendered in the bottomBar, not inline
                    val requestId = payload["requestId"]?.jsonPrimitive?.content ?: ""
                    val resolved = _state.value.resolvedRequests[requestId]
                    if (resolved != null) {
                        items.add(ChatItem.Notification("Answered: $resolved"))
                    }
                }

                EventType.SUGGEST_SESSION, EventType.SUGGEST_DESCRIPTION -> {
                    // Pending suggestions are rendered in the bottomBar, not inline
                    val requestId = payload["requestId"]?.jsonPrimitive?.content ?: ""
                    val resolved = _state.value.resolvedRequests[requestId]
                    if (resolved != null) {
                        items.add(ChatItem.Notification(resolved))
                    }
                }

                EventType.NOTIFICATION -> {
                    val msg = payload["message"]?.jsonPrimitive?.content ?: ""
                    if (msg.isNotEmpty()) items.add(ChatItem.Notification(msg))
                }

                EventType.PROGRESS -> {
                    val msg = payload["message"]?.jsonPrimitive?.content ?: ""
                    if (msg.isNotEmpty()) items.add(ChatItem.Progress(msg))
                }

                EventType.INTERRUPTED -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    items.add(ChatItem.Interrupted())
                }

                EventType.DONE -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    if (eventIndex == lastDoneIndex) {
                        // Full banner with Resume button for the last done event only
                        items.add(ChatItem.SessionDone(
                            costUsd = _state.value.costUsd,
                            turns = _state.value.turns,
                            toolCalls = _state.value.toolStates.size,
                            durationMs = _state.value.session?.metrics?.durationMs ?: 0,
                            filesChanged = _state.value.session?.metrics?.filesChanged ?: emptyMap(),
                        ))
                    } else {
                        // Earlier runs: simple marker, no Resume button
                        items.add(ChatItem.Notification("Run ended"))
                    }
                }

                EventType.ERROR -> {
                    if (assistantText.isNotEmpty()) {
                        items.add(ChatItem.AssistantMessage(assistantText.toString()))
                        assistantText.clear()
                    }
                    val msg = payload["message"]?.jsonPrimitive?.content
                        ?: payload["error"]?.jsonPrimitive?.content
                        ?: "Unknown error"
                    if (eventIndex == lastErrorIndex && lastDoneIndex < eventIndex) {
                        // Full banner only if this is the last terminal event
                        items.add(ChatItem.SessionError(msg, _state.value.costUsd))
                    } else {
                        items.add(ChatItem.Notification("Error: $msg"))
                    }
                }

                EventType.PERMISSION_DENIED -> {
                    val tool = payload["toolName"]?.jsonPrimitive?.content ?: "tool"
                    items.add(ChatItem.PermissionDenied(tool))
                }

                EventType.COMPACT -> {
                    val summary = payload["summary"]?.jsonPrimitive?.content ?: ""
                    items.add(ChatItem.CompactMarker(summary))
                }

                EventType.REQUEST_EXPIRED -> {
                    val requestId = payload["requestId"]?.jsonPrimitive?.content ?: ""
                    val toolName = _state.value.toolStates.values
                        .firstOrNull { it.approvalRequestId == requestId }?.toolName ?: "request"
                    items.add(ChatItem.RequestExpired(toolName = toolName))
                }

                EventType.READY, EventType.REQUEST_RESOLVED -> {
                    // No visual representation or handled elsewhere
                }
            }
        }

        // If there's still streaming text, add it as a streaming message
        if (assistantText.isNotEmpty()) {
            items.add(ChatItem.AssistantMessage(assistantText.toString(), isStreaming = true))
        }

        _state.update { it.copy(chatItems = items) }
    }

    // ── User actions ──

    override fun sendMessage(text: String) {
        if (text.isBlank()) return
        scope.launch {
            try {
                rpcMethods.agentSend(bonsaiSid, text)
                _state.update { it.copy(sessionStatus = SessionStatus.RUNNING) }
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun interrupt() {
        scope.launch {
            try { rpcMethods.agentInterrupt(bonsaiSid) } catch (_: Exception) {}
        }
    }

    override fun approve(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "allow") })
                markApproval(requestId, ApprovalStatus.APPROVED, "approved")
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun deny(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "deny") })
                markApproval(requestId, ApprovalStatus.DENIED, "denied")
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun answerQuestion(requestId: String, answers: Map<String, String>) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject {
                    put("answers", buildJsonObject { answers.forEach { (k, v) -> put(k, v) } })
                })
                val answerSummary = answers.values.firstOrNull() ?: "answered"
                _state.update {
                    it.copy(
                        pendingRequest = null,
                        resolvedRequests = it.resolvedRequests + (requestId to answerSummary),
                    )
                }
                rebuildChatItems()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun dismissSuggestion(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "deny") })
                _state.update {
                    it.copy(
                        pendingRequest = null,
                        resolvedRequests = it.resolvedRequests + (requestId to "Dismissed"),
                    )
                }
                rebuildChatItems()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun acceptSuggestion(requestId: String) {
        scope.launch {
            try {
                rpcMethods.agentRespond(bonsaiSid, requestId, buildJsonObject { put("behavior", "allow") })
                _state.update {
                    it.copy(
                        pendingRequest = null,
                        resolvedRequests = it.resolvedRequests + (requestId to "✓ Accepted"),
                    )
                }
                rebuildChatItems()
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun resumeSession() {
        scope.launch {
            try {
                rpcMethods.sessionContinue(bonsaiSid)
                _state.update { it.copy(sessionStatus = SessionStatus.INITIALIZING) }
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun changeModel(model: String) {
        scope.launch {
            try {
                rpcMethods.agentUpdateConfig(bonsaiSid, model = model)
                _state.update { it.copy(sessionModel = model, sessionModelLabel = deriveModelLabel(model)) }
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun changeEffort(effort: Effort?) {
        scope.launch {
            try {
                rpcMethods.agentUpdateConfig(bonsaiSid, effort = effort)
            } catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }

    override fun onBack() { onBack.invoke() }

    // ── Helpers ──

    private fun markApproval(requestId: String, status: ApprovalStatus, label: String) {
        _state.update { state ->
            val updatedTools = state.toolStates.mapValues { (_, ts) ->
                if (ts.approvalRequestId == requestId) ts.copy(approvalStatus = status) else ts
            }
            state.copy(
                toolStates = updatedTools,
                pendingRequest = null,
                resolvedRequests = state.resolvedRequests + (requestId to label),
            )
        }
        rebuildChatItems()
    }

    private fun parseEventType(name: String): EventType? = try {
        BonsaiJson.decodeFromString(EventType.serializer(), "\"$name\"")
    } catch (_: Exception) {
        null // Unknown event type — skip instead of corrupting the chat stream
    }

    private fun parsePendingRequest(method: String, params: JsonObject, requestId: String): PendingRequest? {
        val type = when (method) {
            "agent/askUserQuestion" -> PendingRequestType.QUESTION
            "agent/confirmAction" -> PendingRequestType.APPROVAL
            "agent/suggestSession" -> PendingRequestType.SUGGESTION
            "agent/suggestDescription" -> PendingRequestType.DESCRIPTION_SUGGESTION
            "agent/suggestStep" -> PendingRequestType.STEP_PROPOSAL
            else -> return null
        }

        val questions = params["questions"]?.let {
            try { BonsaiJson.decodeFromJsonElement<List<Question>>(it) } catch (_: Exception) { null }
        }

        return PendingRequest(
            requestId = requestId,
            type = type,
            questions = questions,
            toolName = params["toolName"]?.jsonPrimitive?.content,
            toolInput = params["toolInput"] as? JsonObject,
            skill = params["skillId"]?.jsonPrimitive?.content,
            specIds = params["specIds"]?.let {
                try { BonsaiJson.decodeFromJsonElement<List<String>>(it) } catch (_: Exception) { null }
            },
            name = params["name"]?.jsonPrimitive?.content,
            reason = params["reason"]?.jsonPrimitive?.content,
            description = params["description"]?.jsonPrimitive?.content,
            // Step proposal fields
            ticketId = params["ticketId"]?.jsonPrimitive?.content,
            stepNumber = params["stepNumber"]?.jsonPrimitive?.intOrNull,
            stepTitle = params["stepTitle"]?.jsonPrimitive?.content,
            inputSpecIds = params["inputSpecIds"]?.let {
                try { BonsaiJson.decodeFromJsonElement<List<String>>(it) } catch (_: Exception) { null }
            },
        )
    }

    private fun extractToolSummary(toolName: String, input: JsonObject): String {
        return when (toolName) {
            "Read", "Write", "Edit" -> input["file_path"]?.jsonPrimitive?.content
                ?: input["filePath"]?.jsonPrimitive?.content ?: ""
            "Bash" -> input["command"]?.jsonPrimitive?.content?.take(60) ?: ""
            "Glob" -> input["pattern"]?.jsonPrimitive?.content ?: ""
            "Grep" -> input["pattern"]?.jsonPrimitive?.content ?: ""
            "Agent" -> input["description"]?.jsonPrimitive?.content ?: ""
            else -> ""
        }
    }

    /** If the persisted status is stale (e.g., "idle" when events show "done"), fix it. */
    private fun deriveModelLabel(modelId: String): String {
        // "claude-opus-4-6" -> "Opus 4.6"
        // "claude-sonnet-4-6" -> "Sonnet 4.6"
        // "claude-haiku-4-5-20251001" -> "Haiku 4.5"
        val base = modelId.removePrefix("claude-")
        val parts = base.split("-")
        if (parts.size >= 3) {
            val family = parts[0].replaceFirstChar { it.uppercase() }
            val version = parts.subList(1, 3).joinToString(".")
            return "$family $version"
        }
        return modelId
    }

    // ── Ephemeral notification handlers (state updates, not chat events) ──

    private fun handleCostEstimate(params: JsonObject) {
        val cost = params["estimatedCostUsd"]?.jsonPrimitive?.doubleOrNull ?: return
        val contextTokens = params["currentContextWindow"]?.jsonPrimitive?.longOrNull ?: 0
        _state.update {
            it.copy(
                costUsd = cost,
                contextTokens = contextTokens,
            )
        }
    }

    private fun handleStatusChanged(params: JsonObject) {
        val statusStr = params["status"]?.jsonPrimitive?.content ?: return
        val newStatus = try {
            BonsaiJson.decodeFromString(SessionStatus.serializer(), "\"$statusStr\"")
        } catch (_: Exception) { return }
        // Guard: don't overwrite frontend-managed states
        val current = _state.value.sessionStatus
        if (current == SessionStatus.WAITING || current == SessionStatus.DONE || current == SessionStatus.ERROR) return
        _state.update { it.copy(sessionStatus = newStatus) }
    }

    private fun handleConfigChanged(params: JsonObject) {
        val model = params["model"]?.jsonPrimitive?.content
        _state.update {
            it.copy(
                sessionModel = model ?: it.sessionModel,
                sessionModelLabel = if (model != null) deriveModelLabel(model) else it.sessionModelLabel,
            )
        }
    }
}
