package dev.aiir.bonsai.component.connect

import dev.aiir.bonsai.data.model.ServerAddress
import kotlinx.coroutines.flow.StateFlow

interface ConnectComponent {
    val state: StateFlow<ConnectState>

    fun onAddressChanged(address: String)
    fun onConnect()
    fun onRecentServerSelected(address: ServerAddress)
}

data class ConnectState(
    val addressInput: String = "",
    val isConnecting: Boolean = false,
    val error: String? = null,
    val recentServers: List<ServerAddress> = emptyList(),
)
