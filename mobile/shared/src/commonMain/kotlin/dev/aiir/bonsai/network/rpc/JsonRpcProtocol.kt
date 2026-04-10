package dev.aiir.bonsai.network.rpc

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * JSON-RPC 2.0 protocol types for WebSocket communication with the Bonsai backend.
 */

@Serializable
data class JsonRpcRequest(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: JsonObject = JsonObject(emptyMap()),
    val id: Int,
)

@Serializable
data class JsonRpcResponse(
    val jsonrpc: String = "2.0",
    val result: JsonElement? = null,
    val error: JsonRpcError? = null,
    val id: Int? = null,
)

@Serializable
data class JsonRpcError(
    val code: Int,
    val message: String,
    val data: JsonElement? = null,
)

/**
 * Server-initiated notification (no id field, no response expected).
 * Used for streaming events like agent/textDelta, spec/didChange, etc.
 */
@Serializable
data class JsonRpcNotification(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: JsonObject = JsonObject(emptyMap()),
)

/**
 * Server-initiated request (has id field, expects response).
 * Used for agent/askUserQuestion, agent/confirmAction, etc.
 * Note: id is JsonElement because the backend uses UUID strings for request IDs,
 * while client-initiated requests use integer IDs.
 */
@Serializable
data class JsonRpcServerRequest(
    val jsonrpc: String = "2.0",
    val method: String,
    val params: JsonObject = JsonObject(emptyMap()),
    val id: JsonElement? = null,
)

/**
 * Parsed incoming message from the WebSocket.
 */
sealed class IncomingMessage {
    data class Response(val response: JsonRpcResponse) : IncomingMessage()
    data class Notification(val notification: JsonRpcNotification) : IncomingMessage()
    data class ServerRequest(val request: JsonRpcServerRequest) : IncomingMessage()
}

/**
 * Parse a raw JSON string into an IncomingMessage.
 * - Has "id" + ("result" or "error") → Response
 * - Has "id" + "method" → ServerRequest
 * - Has "method" but no "id" → Notification
 */
fun parseIncomingMessage(json: String): IncomingMessage {
    val element = kotlinx.serialization.json.Json.parseToJsonElement(json)
    val obj = element as? JsonObject ?: error("Expected JSON object")

    val hasId = obj.containsKey("id") && obj["id"].toString() != "null"
    val hasMethod = obj.containsKey("method")
    val hasResult = obj.containsKey("result")
    val hasError = obj.containsKey("error")

    return when {
        hasId && (hasResult || hasError) -> {
            val response = dev.aiir.bonsai.data.serialization.BonsaiJson
                .decodeFromJsonElement(JsonRpcResponse.serializer(), element)
            IncomingMessage.Response(response)
        }
        hasId && hasMethod -> {
            val request = dev.aiir.bonsai.data.serialization.BonsaiJson
                .decodeFromJsonElement(JsonRpcServerRequest.serializer(), element)
            IncomingMessage.ServerRequest(request)
        }
        hasMethod -> {
            val notification = dev.aiir.bonsai.data.serialization.BonsaiJson
                .decodeFromJsonElement(JsonRpcNotification.serializer(), element)
            IncomingMessage.Notification(notification)
        }
        else -> error("Unrecognized JSON-RPC message: $json")
    }
}
