package dev.aiir.bonsai.component.connect

import dev.aiir.bonsai.data.model.ServerAddress
import kotlinx.coroutines.flow.StateFlow

interface ConnectComponent {
    val state: StateFlow<ConnectState>

    fun onAddressChanged(address: String)
    fun onProjectPathChanged(path: String)
    fun onConnect()
    fun onRecentConnectionSelected(address: ServerAddress)
}

data class ConnectState(
    val addressInput: String = "",
    val projectPath: String = "",
    val isConnecting: Boolean = false,
    val error: String? = null,
    val recentConnections: List<ServerAddress> = emptyList(),
)
