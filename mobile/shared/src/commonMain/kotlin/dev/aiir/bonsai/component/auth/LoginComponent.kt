package dev.aiir.bonsai.component.auth

import kotlinx.coroutines.flow.StateFlow

interface LoginComponent {
    val state: StateFlow<LoginState>

    fun onTokenChanged(value: String)
    fun onSubmit()
}

data class LoginState(
    val tokenInput: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
)
