package dev.aiir.bonsai.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ModelInfo(
    val id: String,
    val name: String = "",
    val provider: String = "",
)

@Serializable
data class ProjectSettings(
    val defaultModel: String? = null,
    val permissionTimeout: Int? = null,
    val trashRetentionDays: Int? = null,
)
