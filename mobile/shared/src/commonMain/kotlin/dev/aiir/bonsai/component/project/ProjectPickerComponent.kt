package dev.aiir.bonsai.component.project

import dev.aiir.bonsai.data.model.ProjectInfo
import dev.aiir.bonsai.data.model.RecentProject
import kotlinx.coroutines.flow.StateFlow

interface ProjectPickerComponent {
    val state: StateFlow<ProjectPickerState>

    fun onProjectSelected(path: String)
    fun onPathChanged(path: String)
    fun onSuggestionSelected(path: String)
    fun onOpenManualPath()
    fun onDisconnect()
}

data class ProjectPickerState(
    val host: String = "",
    val port: Int = 8000,
    val recentProjects: List<RecentProject> = emptyList(),
    val availableProjects: List<ProjectInfo> = emptyList(),
    val pathInput: String = "",
    val autocompleteSuggestions: List<String> = emptyList(),
    val isLoading: Boolean = false,
    val isConnecting: Boolean = false,
    val error: String? = null,
)
