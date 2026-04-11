package dev.aiir.bonsai.component.project

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.connection.ConnectionManager
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class ProjectPickerComponentImpl(
    componentContext: ComponentContext,
    private val host: String,
    private val port: Int,
    private val restClient: RestClient,
    private val connectionManager: ConnectionManager,
    private val connectionStorage: ConnectionStorage,
    private val onProjectSelected: (ServerAddress) -> Unit,
    private val onDisconnect: () -> Unit,
) : ProjectPickerComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(ProjectPickerState(host = host, port = port))
    override val state: StateFlow<ProjectPickerState> = _state.asStateFlow()

    private val baseUrl = "http://$host:$port"
    private var autocompleteJob: Job? = null

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        loadProjects()
    }

    private fun loadProjects() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val recent = connectionStorage.getRecentProjects(host, port)
                val scanned = try { restClient.listProjects(baseUrl) } catch (_: Exception) { emptyList() }
                val recentPaths = recent.map { it.path }.toSet()
                val available = scanned.filter { it.path !in recentPaths }
                _state.update {
                    it.copy(
                        recentProjects = recent,
                        availableProjects = available,
                        isLoading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun onProjectSelected(path: String) {
        validateAndConnect(path)
    }

    override fun onPathChanged(path: String) {
        _state.update { it.copy(pathInput = path, error = null) }
        autocompleteJob?.cancel()
        if (path.length >= 2) {
            autocompleteJob = scope.launch {
                delay(300)
                try {
                    val parentDir = path.substringBeforeLast("/", "")
                    val prefix = path.substringAfterLast("/", "")
                    val base = if (parentDir.isEmpty()) "/" else parentDir
                    val dirs = restClient.listDirs(baseUrl, base, prefix)
                    _state.update { it.copy(autocompleteSuggestions = dirs) }
                } catch (_: Exception) {
                    _state.update { it.copy(autocompleteSuggestions = emptyList()) }
                }
            }
        } else {
            _state.update { it.copy(autocompleteSuggestions = emptyList()) }
        }
    }

    override fun onSuggestionSelected(path: String) {
        _state.update { it.copy(pathInput = path, autocompleteSuggestions = emptyList()) }
    }

    override fun onOpenManualPath() {
        val path = _state.value.pathInput.trim()
        if (path.isNotBlank()) validateAndConnect(path)
    }

    override fun onDisconnect() {
        onDisconnect.invoke()
    }

    private fun validateAndConnect(path: String) {
        scope.launch {
            _state.update { it.copy(isConnecting = true, error = null) }
            try {
                val info = restClient.validateProject(baseUrl, path)
                if (!info.exists) {
                    _state.update { it.copy(isConnecting = false, error = "Directory does not exist") }
                    return@launch
                }
                if (!info.valid) {
                    restClient.initProject(baseUrl, path)
                }
                connectionStorage.addRecentProject(host, port, info.path, info.name)
                val address = ServerAddress(
                    host = host,
                    port = port,
                    projectPath = info.path,
                    displayName = info.name,
                    lastConnected = System.currentTimeMillis(),
                )
                val result = connectionManager.connect(address)
                result.fold(
                    onSuccess = {
                        _state.update { it.copy(isConnecting = false) }
                        onProjectSelected(address)
                    },
                    onFailure = { error ->
                        _state.update { it.copy(isConnecting = false, error = error.message ?: "Connection failed") }
                    },
                )
            } catch (e: Exception) {
                _state.update { it.copy(isConnecting = false, error = e.message) }
            }
        }
    }
}
