package dev.aiir.bonsai.network.rpc

import dev.aiir.bonsai.data.model.*
import dev.aiir.bonsai.data.serialization.BonsaiJson
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.*

/**
 * Typed wrappers for all Bonsai backend JSON-RPC methods.
 * Each method serializes params, calls RpcClient.call(), and deserializes the result.
 */
class RpcMethods(private val client: RpcClient) {

    // ── Board ──

    suspend fun boardList(): List<MetaTicketSummary> =
        callList("board/list", MetaTicketSummary.serializer())

    suspend fun boardGet(id: String): MetaTicket =
        call("board/get", buildParams("id" to id), MetaTicket.serializer())

    suspend fun boardCreate(title: String, body: String = "", type: String = "feature"): MetaTicket =
        call("board/create", buildParams("title" to title, "body" to body, "type" to type), MetaTicket.serializer())

    suspend fun boardUpdate(id: String, title: String? = null, body: String? = null, status: String? = null, type: String? = null): MetaTicket {
        val params = buildJsonObject {
            put("id", id)
            title?.let { put("title", it) }
            body?.let { put("body", it) }
            status?.let { put("status", it) }
            type?.let { put("type", it) }
        }
        return call("board/update", params, MetaTicket.serializer())
    }

    suspend fun boardDelete(id: String) {
        client.call("board/delete", buildParams("id" to id))
    }

    suspend fun boardReorder(id: String, status: String, order: Int): MetaTicket =
        call("board/reorder", buildJsonObject {
            put("id", id)
            put("status", status)
            put("order", order)
        }, MetaTicket.serializer())

    suspend fun boardGetPlan(ticketId: String): Plan? {
        val result = client.call("board/getPlan", buildParams("ticketId" to ticketId))
        if (result == null || result is JsonNull) return null
        return BonsaiJson.decodeFromJsonElement(Plan.serializer(), result)
    }

    // ── Agent ──

    suspend fun agentRun(
        specIds: List<String> = emptyList(),
        config: AgentConfig = AgentConfig(),
        skillId: String? = null,
        prompt: String? = null,
        name: String? = null,
        metaTicketId: String? = null,
    ): String {
        val params = buildJsonObject {
            put("specIds", BonsaiJson.encodeToJsonElement(specIds))
            put("config", BonsaiJson.encodeToJsonElement(config))
            skillId?.let { put("skillId", it) }
            prompt?.let { put("prompt", it) }
            name?.let { put("name", it) }
            metaTicketId?.let { put("metaTicketId", it) }
        }
        val result = call("agent/run", params, JsonObject.serializer())
        return result["bonsaiSid"]?.jsonPrimitive?.content ?: error("No bonsaiSid in response")
    }

    suspend fun agentPrepare(
        specIds: List<String> = emptyList(),
        config: AgentConfig = AgentConfig(),
        skillId: String? = null,
        prompt: String? = null,
        name: String? = null,
        metaTicketId: String? = null,
        filePaths: List<String> = emptyList(),
    ): JsonObject {
        val params = buildJsonObject {
            put("specIds", BonsaiJson.encodeToJsonElement(specIds))
            put("config", BonsaiJson.encodeToJsonElement(config))
            skillId?.let { put("skillId", it) }
            prompt?.let { put("prompt", it) }
            name?.let { put("name", it) }
            metaTicketId?.let { put("metaTicketId", it) }
            if (filePaths.isNotEmpty()) put("filePaths", BonsaiJson.encodeToJsonElement(filePaths))
        }
        return call("agent/prepare", params, JsonObject.serializer())
    }

    suspend fun agentStartDraft(bonsaiSid: String, prompt: String? = null): String {
        val params = buildJsonObject {
            put("bonsaiSid", bonsaiSid)
            prompt?.let { put("prompt", it) }
        }
        val result = call("agent/startDraft", params, JsonObject.serializer())
        return result["bonsaiSid"]?.jsonPrimitive?.content ?: bonsaiSid
    }

    suspend fun agentSend(bonsaiSid: String, text: String) {
        client.call("agent/send", buildJsonObject {
            put("bonsaiSid", bonsaiSid)
            put("text", text)
        })
    }

    suspend fun agentRespond(bonsaiSid: String, requestId: String, response: JsonObject) {
        client.call("agent/respond", buildJsonObject {
            put("bonsaiSid", bonsaiSid)
            put("requestId", requestId)
            put("response", response)
        })
    }

    suspend fun agentInterrupt(bonsaiSid: String) {
        client.call("agent/interrupt", buildParams("bonsaiSid" to bonsaiSid))
    }

    suspend fun agentEnd(bonsaiSid: String) {
        client.call("agent/end", buildParams("bonsaiSid" to bonsaiSid))
    }

    suspend fun agentUpdateConfig(
        bonsaiSid: String,
        model: String? = null,
        permissionMode: String? = null,
        effort: String? = null,
    ): JsonObject {
        val params = buildJsonObject {
            put("bonsaiSid", bonsaiSid)
            model?.let { put("model", it) }
            permissionMode?.let { put("permissionMode", it) }
            effort?.let { put("effort", it) }
        }
        return call("agent/updateConfig", params, JsonObject.serializer())
    }

    suspend fun agentList(): List<AgentTask> =
        callList("agent/list", AgentTask.serializer())

    // ── Sessions ──

    suspend fun sessionList(): List<Session> =
        callList("session/list", Session.serializer())

    suspend fun sessionGet(bonsaiSid: String): Session? {
        val result = client.call("session/get", buildParams("bonsaiSid" to bonsaiSid))
        if (result == null || result is JsonNull) return null
        return BonsaiJson.decodeFromJsonElement(Session.serializer(), result)
    }

    suspend fun sessionContinue(bonsaiSid: String): String {
        val result = call("session/continue", buildParams("bonsaiSid" to bonsaiSid), JsonObject.serializer())
        return result["bonsaiSid"]?.jsonPrimitive?.content ?: bonsaiSid
    }

    suspend fun sessionDelete(bonsaiSid: String) {
        client.call("session/delete", buildParams("bonsaiSid" to bonsaiSid))
    }

    // ── Specs ──

    suspend fun specList(): List<RegistryEntry> =
        callList("spec/list", RegistryEntry.serializer())

    suspend fun specGet(id: String): SpecDetail =
        call("spec/get", buildParams("id" to id), SpecDetail.serializer())

    // ── Settings ──

    suspend fun settingsGet(): ProjectSettings =
        call("settings/get", JsonObject(emptyMap()), ProjectSettings.serializer())

    suspend fun settingsUpdate(settings: JsonObject): ProjectSettings =
        call("settings/update", buildJsonObject { put("settings", settings) }, ProjectSettings.serializer())

    suspend fun modelsList(): List<ModelInfo> =
        callList("models/list", ModelInfo.serializer())

    // ── Helpers ──

    private suspend fun <T> call(
        method: String,
        params: JsonObject,
        serializer: kotlinx.serialization.DeserializationStrategy<T>,
    ): T {
        val result = client.call(method, params) ?: error("Null result from $method")
        return BonsaiJson.decodeFromJsonElement(serializer, result)
    }

    private suspend fun <T> callList(
        method: String,
        elementSerializer: kotlinx.serialization.KSerializer<T>,
    ): List<T> {
        val result = client.call(method) ?: return emptyList()
        return BonsaiJson.decodeFromJsonElement(ListSerializer(elementSerializer), result)
    }

    private fun buildParams(vararg pairs: Pair<String, String>): JsonObject = buildJsonObject {
        pairs.forEach { (key, value) -> put(key, value) }
    }
}
