package dev.aiir.bonsai.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ModelInfo(
    val id: String,
    val label: String = "",
)

/** A value the backend accepts plus its display label (permission mode, effort, or model). */
@Serializable
data class LabeledOption(
    val value: String,
    val label: String = "",
)

/** A runtime's declared capabilities, returned by `runtimes/capabilities`. */
@Serializable
data class RuntimeCapabilities(
    val permissionModes: List<LabeledOption> = emptyList(),
    val effortLevels: List<LabeledOption> = emptyList(),
    val models: List<LabeledOption> = emptyList(),
)

@Serializable
data class SkillInfo(
    val id: String,
    val name: String = "",
    val description: String = "",
)

@Serializable
data class ProjectSettings(
    val defaultModel: String? = null,
    val permissionTimeout: Int? = null,
    val trashRetentionDays: Int? = null,
    /** "auto" | "subsession" | "off" — null treated as "auto". */
    val voiceReviseMode: String? = null,
)

/** Small shared envelope for RPC methods that return `{ text: string }`. */
@Serializable
data class TextResult(val text: String = "")
