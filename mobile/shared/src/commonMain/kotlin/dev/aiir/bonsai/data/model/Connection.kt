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
    val connectionMode: String = "local",
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

// ── Auth / setup response models ────────────────────────────────────────────

@Serializable
data class SetupStatusResponse(
    val needsSetup: Boolean,
)

@Serializable
data class SetupResponse(
    val userId: String,
    val displayName: String,
    val token: String,
)

@Serializable
data class UserProfileResponse(
    val userId: String,
    val displayName: String,
    val isAdmin: Boolean,
    val createdAt: String? = null,
)

// ── Server info response models ─────────────────────────────────────────────

@Serializable
data class TailscaleInfo(
    val ip: String? = null,
    val hostname: String? = null,
    val active: Boolean = false,
)

@Serializable
data class ServerInfoResponse(
    val hostname: String = "",
    val lanIps: List<String> = emptyList(),
    val tailscale: TailscaleInfo = TailscaleInfo(),
    val version: String = "",
)
