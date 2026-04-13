package dev.aiir.bonsai.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ServerAddress(
    val host: String,
    val port: Int = 8000,
    val projectPath: String = "",
    val displayName: String = "",
    val lastConnected: Long = 0,
    val token: String? = null,
) {
    val baseUrl: String get() = "http://$host:$port"
    val wsUrl: String get() = buildString {
        append("ws://$host:$port/ws?project=$projectPath")
        if (!token.isNullOrBlank()) append("&token=$token")
    }
}

@Serializable
data class ProjectInfo(
    val path: String,
    val name: String,
    val valid: Boolean = false,
    val exists: Boolean = false,
)

@Serializable
data class HealthResponse(
    val status: String,
    val version: String = "",
)

@Serializable
data class RecentProject(
    val path: String,
    val name: String,
    val lastOpened: Long = 0,
)
