package dev.aiir.bonsai.data.model

import kotlinx.serialization.Serializable

@Serializable
data class Link(
    val from: String,
    val to: String,
    val type: String,
)

@Serializable
data class RegistryEntry(
    val id: String,
    val type: String,
    val path: String,
    val title: String = "",
    val status: String = "",
    val covers: List<String> = emptyList(),
    val tags: List<String> = emptyList(),
    val created: String = "",
    val updated: String = "",
)

@Serializable
data class SpecDetail(
    val id: String,
    val type: String,
    val path: String,
    val status: String = "",
    val title: String = "",
    val tags: List<String> = emptyList(),
    val content: String = "",
    val links: List<Link> = emptyList(),
)

@Serializable
data class SpecGraph(
    val nodes: List<RegistryEntry> = emptyList(),
    val edges: List<Link> = emptyList(),
)
