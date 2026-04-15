package dev.aiir.bonsai.network.rest

import dev.aiir.bonsai.data.model.HealthResponse
import dev.aiir.bonsai.data.model.ProjectInfo
import dev.aiir.bonsai.data.model.ServerInfoResponse
import dev.aiir.bonsai.data.model.SetupResponse
import dev.aiir.bonsai.data.model.SetupStatusResponse
import dev.aiir.bonsai.data.model.UserProfileResponse
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import dev.aiir.bonsai.data.serialization.BonsaiJson
import io.ktor.client.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import kotlinx.serialization.json.*

/**
 * HTTP REST client for non-WebSocket backend endpoints.
 * Used for health checks, project validation, and file operations.
 */
class RestClient(private val httpClient: HttpClient) {

    suspend fun healthCheck(baseUrl: String): HealthResponse {
        val response = httpClient.get("$baseUrl/api/health")
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(HealthResponse.serializer(), body)
    }

    suspend fun validateProject(baseUrl: String, path: String): ProjectInfo {
        val response = httpClient.get("$baseUrl/api/project/validate") {
            parameter("path", path)
        }
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(ProjectInfo.serializer(), body)
    }

    suspend fun listFiles(baseUrl: String, projectPath: String): List<FileEntry> {
        val response = httpClient.get("$baseUrl/api/project/files") {
            parameter("path", projectPath)
        }
        val body = response.bodyAsText()
        val json = BonsaiJson.parseToJsonElement(body).jsonObject
        val entries = json["entries"]?.jsonArray ?: return emptyList()
        return BonsaiJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(FileEntry.serializer()),
            entries
        )
    }

    suspend fun readFile(baseUrl: String, projectPath: String, filePath: String): FileContent {
        val response = httpClient.get("$baseUrl/api/file/read") {
            parameter("project", projectPath)
            parameter("path", filePath)
        }
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(FileContent.serializer(), body)
    }

    suspend fun writeFile(baseUrl: String, projectPath: String, filePath: String, content: String): Boolean {
        val response = httpClient.post("$baseUrl/api/file/write") {
            header("Content-Type", "application/json")
            setBody(BonsaiJson.encodeToString(
                WriteFileBody.serializer(),
                WriteFileBody(project = projectPath, path = filePath, content = content)
            ))
        }
        val body = response.bodyAsText()
        val json = BonsaiJson.parseToJsonElement(body).jsonObject
        return json["ok"]?.jsonPrimitive?.booleanOrNull == true
    }
    suspend fun listProjects(baseUrl: String, base: String = ""): List<ProjectInfo> {
        val response = httpClient.get("$baseUrl/api/project/list") {
            if (base.isNotEmpty()) parameter("base", base)
            parameter("max_depth", 4)
        }
        val body = response.bodyAsText()
        val json = BonsaiJson.parseToJsonElement(body).jsonObject
        val projects = json["projects"]?.jsonArray ?: return emptyList()
        return BonsaiJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(ProjectInfo.serializer()),
            projects,
        )
    }

    suspend fun listDirs(baseUrl: String, base: String, prefix: String = ""): List<String> {
        val response = httpClient.get("$baseUrl/api/fs/list-dirs") {
            parameter("base", base)
            parameter("prefix", prefix)
        }
        val body = response.bodyAsText()
        val json = BonsaiJson.parseToJsonElement(body).jsonObject
        val dirs = json["dirs"]?.jsonArray ?: return emptyList()
        return dirs.map { it.jsonPrimitive.content }
    }

    suspend fun initProject(baseUrl: String, path: String): ProjectInfo {
        val response = httpClient.post("$baseUrl/api/project/init") {
            header("Content-Type", "application/json")
            setBody("""{"path":"$path"}""")
        }
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(ProjectInfo.serializer(), body)
    }

    // ── Auth / setup endpoints ──────────────────────────────────────────────

    suspend fun checkSetupStatus(baseUrl: String): SetupStatusResponse {
        val response = httpClient.get("$baseUrl/api/setup/status")
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(SetupStatusResponse.serializer(), body)
    }

    suspend fun setup(baseUrl: String, userId: String, name: String): SetupResponse {
        val response = httpClient.post("$baseUrl/api/setup") {
            header("Content-Type", "application/json")
            setBody(BonsaiJson.encodeToString(
                kotlinx.serialization.serializer(),
                buildJsonObject {
                    put("userId", userId)
                    put("name", name)
                },
            ))
        }
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(SetupResponse.serializer(), body)
    }

    /**
     * Validate a token via the REST profile endpoint.
     * Returns the user profile on success, or null if the token is invalid.
     */
    suspend fun validateToken(baseUrl: String, token: String): UserProfileResponse? {
        return try {
            val response = httpClient.get("$baseUrl/api/user/profile") {
                parameter("token", token)
            }
            if (response.status.value != 200) return null
            val body = response.bodyAsText()
            BonsaiJson.decodeFromString(UserProfileResponse.serializer(), body)
        } catch (_: Exception) {
            null
        }
    }

    suspend fun getServerInfo(baseUrl: String): ServerInfoResponse {
        val response = httpClient.get("$baseUrl/api/server-info")
        val body = response.bodyAsText()
        return BonsaiJson.decodeFromString(ServerInfoResponse.serializer(), body)
    }
}

@kotlinx.serialization.Serializable
data class FileEntry(
    val path: String,
    val name: String,
    val isDir: Boolean = false,
    val depth: Int = 0,
)

@kotlinx.serialization.Serializable
data class FileContent(
    val content: String? = null,
    val path: String = "",
    val name: String = "",
    val size: Long = 0,
    val error: String? = null,
)

@kotlinx.serialization.Serializable
data class WriteFileBody(
    val project: String,
    val path: String,
    val content: String,
)
