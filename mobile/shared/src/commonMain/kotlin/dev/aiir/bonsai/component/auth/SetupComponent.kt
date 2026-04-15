package dev.aiir.bonsai.component.auth

import kotlinx.coroutines.flow.StateFlow

interface SetupComponent {
    val state: StateFlow<SetupState>

    fun onUserIdChanged(value: String)
    fun onNameChanged(value: String)
    fun onSubmit()
}

data class SetupState(
    val userIdInput: String = "",
    val nameInput: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
    val createdToken: String? = null,
)
