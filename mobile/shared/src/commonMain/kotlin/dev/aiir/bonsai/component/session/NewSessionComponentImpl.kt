package dev.aiir.bonsai.component.session

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.model.AgentConfig
import dev.aiir.bonsai.data.model.Effort
import dev.aiir.bonsai.data.model.PermissionMode
import dev.aiir.bonsai.data.model.PromptSection
import dev.aiir.bonsai.data.serialization.BonsaiJson
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.jsonPrimitive

class NewSessionComponentImpl(
    componentContext: ComponentContext,
    private val rpcMethods: RpcMethods,
    private val restClient: dev.aiir.bonsai.network.rest.RestClient,
    private val serverAddress: dev.aiir.bonsai.data.model.ServerAddress,
    private val onSessionStarted: (String) -> Unit,
    private val onBack: () -> Unit,
) : NewSessionComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(NewSessionState())
    override val state: StateFlow<NewSessionState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        loadOptions()
    }

    private fun loadOptions() {
        scope.launch {
            try {
                val models = rpcMethods.modelsList()
                val specs = rpcMethods.specList()
                val tickets = rpcMethods.boardList()
                val skills = try { rpcMethods.skillsList() } catch (_: Exception) { emptyList() }
                val files = try {
                    restClient.listFiles(serverAddress.baseUrl, serverAddress.projectPath)
                        .filter { !it.isDir }
                } catch (_: Exception) { emptyList() }
                _state.update {
                    it.copy(
                        availableModels = models,
                        availableSpecs = specs,
                        availableTickets = tickets,
                        availableSkills = skills,
                        availableFiles = files,
                        model = if (it.model.isEmpty()) models.firstOrNull()?.id ?: "" else it.model,
                    )
                }
            } catch (_: Exception) { /* Non-critical, use defaults */ }
        }
    }

    override fun onNameChanged(name: String) { _state.update { it.copy(name = name) } }
    override fun onPromptChanged(prompt: String) { _state.update { it.copy(prompt = prompt) } }
    override fun onModelChanged(model: String) { _state.update { it.copy(model = model) } }
    override fun onEffortChanged(effort: Effort?) { _state.update { it.copy(effort = effort) } }
    override fun onPermissionChanged(permission: PermissionMode) { _state.update { it.copy(permissionMode = permission) } }
    override fun onSkillChanged(skill: String?) { _state.update { it.copy(skillId = skill) } }
    override fun addSpec(specId: String) { _state.update { it.copy(specIds = it.specIds + specId) } }
    override fun removeSpec(specId: String) { _state.update { it.copy(specIds = it.specIds - specId) } }
    override fun addFile(path: String) { _state.update { it.copy(filePaths = it.filePaths + path) } }
    override fun removeFile(path: String) { _state.update { it.copy(filePaths = it.filePaths - path) } }
    override fun onTicketChanged(ticketId: String?) { _state.update { it.copy(linkedTicketId = ticketId) } }

    override fun preview() {
        val s = _state.value

        scope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                val config = AgentConfig(
                    model = s.model,
                    permissionMode = s.permissionMode,
                    effort = s.effort,
                )
                val result = rpcMethods.agentPrepare(
                    specIds = s.specIds,
                    config = config,
                    skillId = s.skillId,
                    prompt = s.prompt,
                    name = s.name.takeIf { it.isNotBlank() },
                    metaTicketId = s.linkedTicketId,
                    filePaths = s.filePaths,
                )
                val bonsaiSid = result["bonsaiSid"]?.jsonPrimitive?.content ?: ""
                val totalTokens = result["totalTokens"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                val sections = result["sections"]?.let {
                    try {
                        BonsaiJson.decodeFromJsonElement(
                            kotlinx.serialization.builtins.ListSerializer(PromptSection.serializer()), it
                        )
                    } catch (_: Exception) { emptyList() }
                } ?: emptyList()
                val systemPrompt = result["systemPrompt"]?.jsonPrimitive?.content

                _state.update {
                    it.copy(
                        step = NewSessionStep.PREVIEW,
                        draftBonsaiSid = bonsaiSid,
                        totalTokens = totalTokens,
                        sections = sections,
                        systemPrompt = systemPrompt,
                        isLoading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun start() {
        val s = _state.value
        val sid = s.draftBonsaiSid ?: return

        scope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                rpcMethods.agentStartDraft(sid, s.prompt)
                onSessionStarted(sid)
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun back() {
        if (_state.value.step == NewSessionStep.PREVIEW) {
            _state.update { it.copy(step = NewSessionStep.CONFIGURE) }
        } else {
            onBack()
        }
    }
}
