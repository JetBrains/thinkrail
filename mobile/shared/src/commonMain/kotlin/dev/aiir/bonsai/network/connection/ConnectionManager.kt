package dev.aiir.bonsai.network.connection

import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.rest.RestClient
import dev.aiir.bonsai.network.rpc.ConnectionState
import dev.aiir.bonsai.network.rpc.RpcClient
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeout

/**
 * Manages the lifecycle of connecting to a Bonsai backend server.
 * Handles address parsing, health checks, and WebSocket connection setup.
 */
class ConnectionManager(
    private val rpcClient: RpcClient,
    private val restClient: RestClient,
) {
    val connectionState: StateFlow<ConnectionState> = rpcClient.connectionState

    /**
     * Check if a server is reachable via health check only — no WebSocket.
     * Used as the first step before project selection.
     */
    suspend fun checkServer(baseUrl: String): Result<Unit> {
        return try {
            val health = restClient.healthCheck(baseUrl)
            if (health.status == "ok") Result.success(Unit)
            else Result.failure(Exception("Server health check failed: ${health.status}"))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Connect to a Bonsai backend.
     * 1. Parse address
     * 2. Health check
     * 3. Open WebSocket
     */
    suspend fun connect(address: ServerAddress): Result<Unit> {
        return try {
            // Health check first
            val health = restClient.healthCheck(address.baseUrl)
            if (health.status != "ok") {
                return Result.failure(Exception("Server health check failed: ${health.status}"))
            }

            // Connect WebSocket and wait for it to actually connect
            rpcClient.connect(address.host, address.port, address.projectPath, address.token)

            // Wait up to 10s for Connected or Error state
            val state = withTimeout(10_000) {
                rpcClient.connectionState.first { it is ConnectionState.Connected || it is ConnectionState.Error }
            }

            when (state) {
                is ConnectionState.Connected -> Result.success(Unit)
                is ConnectionState.Error -> Result.failure(Exception(state.message))
                else -> Result.failure(Exception("Unexpected connection state"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun disconnect() {
        rpcClient.disconnect()
    }

    companion object {
        /**
         * Parse a user-entered address string into a ServerAddress.
         * Supports formats:
         * - "192.168.1.5:8000"
         * - "http://192.168.1.5:8000"
         * - "bonsai://192.168.1.5:8000/path/to/project"
         */
        fun parseAddress(input: String, projectPath: String = ""): ServerAddress {
            val cleaned = input.trim()

            // Handle bonsai:// URI scheme
            if (cleaned.startsWith("bonsai://")) {
                val withoutScheme = cleaned.removePrefix("bonsai://")
                val parts = withoutScheme.split("/", limit = 2)
                val hostPort = parts[0]
                val path = if (parts.size > 1) "/${parts[1]}" else projectPath
                val (host, port) = parseHostPort(hostPort)
                return ServerAddress(host = host, port = port, projectPath = path)
            }

            // Handle http:// prefix
            val withoutScheme = cleaned
                .removePrefix("http://")
                .removePrefix("https://")

            val (host, port) = parseHostPort(withoutScheme.trimEnd('/'))
            return ServerAddress(host = host, port = port, projectPath = projectPath)
        }

        private fun parseHostPort(hostPort: String): Pair<String, Int> {
            val parts = hostPort.split(":")
            val host = parts[0]
            val port = parts.getOrNull(1)?.toIntOrNull() ?: 8000
            return host to port
        }
    }
}
