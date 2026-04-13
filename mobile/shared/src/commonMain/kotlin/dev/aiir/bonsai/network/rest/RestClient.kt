package dev.aiir.bonsai.network.rest

import dev.aiir.bonsai.data.model.HealthResponse
import dev.aiir.bonsai.data.model.ProjectInfo
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
