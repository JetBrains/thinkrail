package dev.aiir.bonsai.component.connect

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.data.model.ServerAddress
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
    private val onServerConnected: (host: String, port: Int) -> Unit,
) : ConnectComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(ConnectState(
        recentServers = connectionStorage.getRecentServers(),
    ))
    override val state: StateFlow<ConnectState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
    }

    override fun onAddressChanged(address: String) {
        _state.update { it.copy(addressInput = address, error = null) }
    }

    override fun onConnect() {
        if (_state.value.isConnecting) return
        val parsed = ConnectionManager.parseAddress(_state.value.addressInput)
        doHealthCheck(parsed.host, parsed.port)
    }

    override fun onRecentServerSelected(address: ServerAddress) {
        _state.update { it.copy(addressInput = "${address.host}:${address.port}") }
        doHealthCheck(address.host, address.port)
    }

    private fun doHealthCheck(host: String, port: Int) {
        _state.update { it.copy(isConnecting = true, error = null) }
        scope.launch {
            val baseUrl = "http://$host:$port"
            val result = connectionManager.checkServer(baseUrl)
            result.fold(
                onSuccess = {
                    connectionStorage.addRecentServer(host, port)
                    _state.update { it.copy(isConnecting = false) }
                    onServerConnected(host, port)
                },
                onFailure = { error ->
                    _state.update { it.copy(isConnecting = false, error = error.message ?: "Connection failed") }
                },
            )
        }
    }
}
