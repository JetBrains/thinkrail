package dev.aiir.bonsai.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class MetaTicketStatus {
    @SerialName("idea") IDEA,
    @SerialName("described") DESCRIBED,
    @SerialName("specified") SPECIFIED,
    @SerialName("planned") PLANNED,
    @SerialName("executing") EXECUTING,
    @SerialName("done") DONE,
}

@Serializable
enum class MetaTicketType {
    @SerialName("feature") FEATURE,
    @SerialName("bug") BUG,
    @SerialName("idea") IDEA,
    @SerialName("improvement") IMPROVEMENT,
}

@Serializable
data class SpecPatch(
    val specId: String,
    val specTitle: String,
    val operation: String, // "created" | "modified" | "deleted"
    val patchPath: String,
    val specPath: String,
    val sessionId: String,
    val created: String,
)

@Serializable
data class MetaTicket(
    val id: String,
    val title: String,
    val body: String = "",
    val status: MetaTicketStatus = MetaTicketStatus.IDEA,
    val type: MetaTicketType = MetaTicketType.FEATURE,
    val planPath: String? = null,
    val orchestratorSessionId: String? = null,
    val linkedSpecIds: List<String> = emptyList(),
    val sessionIds: List<String> = emptyList(),
    val specPatches: List<SpecPatch> = emptyList(),
    val order: Int = 0,
    val created: String = "",
    val updated: String = "",
)

@Serializable
data class MetaTicketSummary(
    val id: String,
    val title: String,
    val status: MetaTicketStatus = MetaTicketStatus.IDEA,
    val type: MetaTicketType = MetaTicketType.FEATURE,
    val planPath: String? = null,
    val orchestratorSessionId: String? = null,
    val linkedSpecIds: List<String> = emptyList(),
    val sessionIds: List<String> = emptyList(),
    val specPatchCount: Int? = null,
    val order: Int = 0,
    val created: String = "",
    val updated: String = "",
)
