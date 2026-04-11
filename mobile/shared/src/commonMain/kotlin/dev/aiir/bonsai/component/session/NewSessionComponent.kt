package dev.aiir.bonsai.component.session

import dev.aiir.bonsai.data.model.Effort
import dev.aiir.bonsai.data.model.MetaTicketSummary
import dev.aiir.bonsai.data.model.ModelInfo
import dev.aiir.bonsai.data.model.PermissionMode
import dev.aiir.bonsai.data.model.PromptSection
import dev.aiir.bonsai.data.model.RegistryEntry
import dev.aiir.bonsai.data.model.SkillInfo
import kotlinx.coroutines.flow.StateFlow

interface NewSessionComponent {
    val state: StateFlow<NewSessionState>

    fun onNameChanged(name: String)
    fun onPromptChanged(prompt: String)
    fun onModelChanged(model: String)
    fun onEffortChanged(effort: Effort?)
    fun onPermissionChanged(permission: PermissionMode)
    fun onSkillChanged(skill: String?)
    fun addSpec(specId: String)
    fun removeSpec(specId: String)
    fun addFile(path: String)
    fun removeFile(path: String)
    fun onTicketChanged(ticketId: String?)
    fun preview()
    fun start()
    fun back()
}

enum class NewSessionStep { CONFIGURE, PREVIEW }

data class NewSessionState(
    val step: NewSessionStep = NewSessionStep.CONFIGURE,
    val name: String = "",
    val prompt: String = "",
    val model: String = "",
    val effort: Effort? = null,
    val permissionMode: PermissionMode = PermissionMode.DEFAULT,
    val skillId: String? = null,
    val specIds: List<String> = emptyList(),
    val filePaths: List<String> = emptyList(),
    val linkedTicketId: String? = null,
    // Draft preview data
    val draftBonsaiSid: String? = null,
    val systemPrompt: String? = null,
    val sections: List<PromptSection> = emptyList(),
    val totalTokens: Int = 0,
    // Available options (fetched from backend)
    val availableModels: List<ModelInfo> = emptyList(),
    val availableSpecs: List<RegistryEntry> = emptyList(),
    val availableTickets: List<MetaTicketSummary> = emptyList(),
    val availableSkills: List<SkillInfo> = emptyList(),
    val availableFiles: List<dev.aiir.bonsai.network.rest.FileEntry> = emptyList(),
    // State
    val isLoading: Boolean = false,
    val error: String? = null,
)
