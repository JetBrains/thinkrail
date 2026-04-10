package dev.aiir.bonsai.network.rpc

import dev.aiir.bonsai.data.serialization.BonsaiJson
import io.ktor.client.*
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import kotlin.concurrent.atomics.AtomicInt
import kotlin.concurrent.atomics.ExperimentalAtomicApi

sealed class ConnectionState {
    data object Disconnected : ConnectionState()
    data object Connecting : ConnectionState()
    data class Connected(val url: String) : ConnectionState()
    data class Error(val message: String) : ConnectionState()
}

/**
 * WebSocket JSON-RPC 2.0 client for communicating with the Bonsai backend.
 *
 * Features:
 * - Request/response correlation by ID
 * - Notification subscriptions by method
 * - Server-initiated request handling
 * - Auto-reconnect with exponential backoff
 */
@OptIn(ExperimentalAtomicApi::class)
class RpcClient(
    private val httpClient: HttpClient,
    private val scope: CoroutineScope,
) {
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _notifications = MutableSharedFlow<JsonRpcNotification>(extraBufferCapacity = 64)
    val notifications: SharedFlow<JsonRpcNotification> = _notifications.asSharedFlow()

    private val _serverRequests = MutableSharedFlow<JsonRpcServerRequest>(extraBufferCapacity = 16)
    val serverRequests: SharedFlow<JsonRpcServerRequest> = _serverRequests.asSharedFlow()

    private val nextId = AtomicInt(1)
    private val pendingRequests = mutableMapOf<Int, CompletableDeferred<JsonRpcResponse>>()
    private var session: DefaultClientWebSocketSession? = null
    private var connectionJob: Job? = null

    private var wsHost: String = ""
    private var wsPort: Int = 8000
    private var wsPath: String = "/ws"
    private var wsProject: String = ""
    private var shouldReconnect = false

    fun connect(host: String, port: Int, projectPath: String) {
        wsHost = host
        wsPort = port
        wsProject = projectPath
        shouldReconnect = true
        connectionJob?.cancel()
        connectionJob = scope.launch {
            connectWithRetry()
        }
    }

    fun disconnect() {
        shouldReconnect = false
        connectionJob?.cancel()
        connectionJob = null
        scope.launch {
            session?.close()
            session = null
        }
        failAllPending("Disconnected")
        _connectionState.value = ConnectionState.Disconnected
    }

    suspend fun call(method: String, params: JsonObject = JsonObject(emptyMap())): JsonElement? {
        val id = nextId.addAndFetch(1)
        val request = JsonRpcRequest(method = method, params = params, id = id)
        val json = BonsaiJson.encodeToString(JsonRpcRequest.serializer(), request)

        val deferred = CompletableDeferred<JsonRpcResponse>()
        pendingRequests[id] = deferred

        try {
            session?.send(Frame.Text(json)) ?: throw IllegalStateException("Not connected")
            val response = withTimeout(30_000) { deferred.await() }
            if (response.error != null) {
                throw RpcException(response.error.code, response.error.message)
            }
            return response.result
        } finally {
            pendingRequests.remove(id)
        }
    }

    suspend fun respond(id: JsonElement, result: JsonElement) {
        val response = buildJsonObject {
            put("jsonrpc", "2.0")
            put("result", result)
            put("id", id)
        }
        session?.send(Frame.Text(response.toString()))
    }

    /** Subscribe to notifications matching a specific method prefix. */
    fun notificationsFor(methodPrefix: String): Flow<JsonRpcNotification> =
        notifications.filter { it.method.startsWith(methodPrefix) }

    private suspend fun connectWithRetry() {
        var attempt = 0
        while (shouldReconnect) {
            try {
                _connectionState.value = ConnectionState.Connecting
                doConnect()
                attempt = 0
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _connectionState.value = ConnectionState.Error(e.message ?: "Connection failed")
                failAllPending(e.message ?: "Connection lost")
            }
            if (!shouldReconnect) break
            val delayMs = minOf(1000L * (1 shl minOf(attempt, 4)), 30_000L)
            attempt++
            delay(delayMs)
        }
    }

    private suspend fun doConnect() {
        httpClient.webSocket(
            method = HttpMethod.Get,
            host = wsHost,
            port = wsPort,
            path = wsPath,
            request = {
                url.parameters.append("project", wsProject)
            },
        ) {
            session = this
            _connectionState.value = ConnectionState.Connected("$wsHost:$wsPort")

            try {
                for (frame in incoming) {
                    when (frame) {
                        is Frame.Text -> handleMessage(frame.readText())
                        is Frame.Close -> break
                        else -> { /* ignore binary/ping/pong */ }
                    }
                }
            } finally {
                session = null
                if (shouldReconnect) {
                    _connectionState.value = ConnectionState.Error("Connection closed")
                }
            }
        }
    }

    private suspend fun handleMessage(text: String) {
        try {
            when (val msg = parseIncomingMessage(text)) {
                is IncomingMessage.Response -> {
                    val id = msg.response.id
                    if (id != null) {
                        pendingRequests[id]?.complete(msg.response)
                    }
                }
                is IncomingMessage.Notification -> {
                    _notifications.emit(msg.notification)
                }
                is IncomingMessage.ServerRequest -> {
                    _serverRequests.emit(msg.request)
                }
            }
        } catch (e: Exception) {
            // Log parse errors but don't crash the connection
        }
    }

    private fun failAllPending(reason: String) {
        val exception = RpcException(-1, reason)
        pendingRequests.values.forEach { it.completeExceptionally(exception) }
        pendingRequests.clear()
    }
}

class RpcException(val code: Int, override val message: String) : Exception(message)
