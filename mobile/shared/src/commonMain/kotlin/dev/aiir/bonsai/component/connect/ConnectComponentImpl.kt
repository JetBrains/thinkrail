package dev.aiir.bonsai.component.connect

import com.arkivanov.decompose.ComponentContext
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.connection.ConnectionManager
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class ConnectComponentImpl(
    componentContext: ComponentContext,
    private val connectionManager: ConnectionManager,
    private val restClient: RestClient,
    private val onConnected: (ServerAddress) -> Unit,
) : ConnectComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(ConnectState())
    override val state: StateFlow<ConnectState> = _state.asStateFlow()

    override fun onAddressChanged(address: String) {
        _state.update { it.copy(addressInput = address, error = null) }
    }

    override fun onProjectPathChanged(path: String) {
        _state.update { it.copy(projectPath = path, error = null) }
    }

    override fun onConnect() {
        val currentState = _state.value
        if (currentState.isConnecting) return

        val address = ConnectionManager.parseAddress(
            currentState.addressInput,
            currentState.projectPath,
        )

        doConnect(address)
    }

    override fun onRecentConnectionSelected(address: ServerAddress) {
        _state.update { it.copy(addressInput = "${address.host}:${address.port}", projectPath = address.projectPath) }
        doConnect(address)
    }

    private fun doConnect(address: ServerAddress) {
        _state.update { it.copy(isConnecting = true, error = null) }

        scope.launch {
            val result = connectionManager.connect(address)
            result.fold(
                onSuccess = {
                    _state.update { it.copy(isConnecting = false) }
                    onConnected(address.copy(lastConnected = System.currentTimeMillis()))
                },
                onFailure = { error ->
                    _state.update {
                        it.copy(isConnecting = false, error = error.message ?: "Connection failed")
                    }
                },
            )
        }
    }
}
