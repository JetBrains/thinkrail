package dev.aiir.bonsai.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ServerAddress(
    val host: String,
    val port: Int = 8000,
    val projectPath: String = "",
    val displayName: String = "",
    val lastConnected: Long = 0,
) {
    val baseUrl: String get() = "http://$host:$port"
    val wsUrl: String get() = "ws://$host:$port/ws?project=$projectPath"
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
