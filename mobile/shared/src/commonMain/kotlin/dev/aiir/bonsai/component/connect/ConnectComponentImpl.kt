package dev.aiir.bonsai.component.connect

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.TailscaleDetector
import dev.aiir.bonsai.network.connection.ConnectionManager
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class ConnectComponentImpl(
    componentContext: ComponentContext,
    private val connectionManager: ConnectionManager,
    private val connectionStorage: ConnectionStorage,
    private val onServerConnected: (host: String, port: Int, token: String?, connectionMode: String) -> Unit,
) : ConnectComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(ConnectState(
        recentServers = connectionStorage.getRecentServers(),
    ))
    override val state: StateFlow<ConnectState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        // Detect Tailscale VPN status
        scope.launch {
            val active = TailscaleDetector.isVpnActive()
            _state.update {
                it.copy(
                    isTailscaleActive = active,
                    mode = if (active) ConnectionMode.TAILSCALE else it.mode,
                )
            }
        }
    }

    override fun onModeChanged(mode: ConnectionMode) {
        _state.update { it.copy(mode = mode, error = null) }
    }

    override fun onAddressChanged(address: String) {
        _state.update { it.copy(addressInput = address, error = null) }
    }

    override fun onTailscaleMachineChanged(name: String) {
        _state.update { it.copy(tailscaleMachineInput = name, error = null) }
    }

    override fun onConnect() {
        if (_state.value.isConnecting) return

        val currentState = _state.value
        val (host, port) = when (currentState.mode) {
            ConnectionMode.LOCAL -> {
                val parsed = ConnectionManager.parseAddress(currentState.addressInput)
                parsed.host to parsed.port
            }
            ConnectionMode.TAILSCALE -> {
                parseTailscaleInput(currentState.tailscaleMachineInput)
            }
        }

        // Look up stored token from recent servers
        val storedToken = currentState.recentServers
            .firstOrNull { it.host == host && it.port == port }
            ?.token

        doHealthCheck(host, port, storedToken)
    }

    override fun onRecentServerSelected(address: ServerAddress) {
        _state.update {
            it.copy(
                mode = if (address.connectionMode == "tailscale") ConnectionMode.TAILSCALE else ConnectionMode.LOCAL,
                addressInput = "${address.host}:${address.port}",
                tailscaleMachineInput = if (address.connectionMode == "tailscale") address.host else "",
            )
        }
        doHealthCheck(address.host, address.port, address.token)
    }

    private fun doHealthCheck(host: String, port: Int, token: String? = null) {
        val mode = if (_state.value.mode == ConnectionMode.TAILSCALE) "tailscale" else "local"
        _state.update { it.copy(isConnecting = true, error = null) }
        scope.launch {
            val baseUrl = "http://$host:$port"
            val result = connectionManager.checkServer(baseUrl)
            result.fold(
                onSuccess = {
                    _state.update { it.copy(isConnecting = false) }
                    onServerConnected(host, port, token, mode)
                },
                onFailure = { error ->
                    _state.update { it.copy(isConnecting = false, error = error.message ?: "Connection failed") }
                },
            )
        }
    }

    private fun parseTailscaleInput(input: String): Pair<String, Int> {
        val trimmed = input.trim()
        val parts = trimmed.split(":")
        val host = parts[0]
        val port = parts.getOrNull(1)?.toIntOrNull() ?: 8000
        return host to port
    }
}
