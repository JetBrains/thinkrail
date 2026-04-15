package dev.aiir.bonsai.component.connect

import dev.aiir.bonsai.data.model.ServerAddress
import kotlinx.coroutines.flow.StateFlow

enum class ConnectionMode { LOCAL, TAILSCALE }

interface ConnectComponent {
    val state: StateFlow<ConnectState>

    fun onModeChanged(mode: ConnectionMode)
    fun onAddressChanged(address: String)
    fun onTailscaleMachineChanged(name: String)
    fun onConnect()
    fun onRecentServerSelected(address: ServerAddress)
}

data class ConnectState(
    val mode: ConnectionMode = ConnectionMode.LOCAL,
    val addressInput: String = "",
    val tailscaleMachineInput: String = "",
    val isConnecting: Boolean = false,
    val error: String? = null,
    val recentServers: List<ServerAddress> = emptyList(),
    val isTailscaleActive: Boolean = false,
)
