package dev.aiir.bonsai.component.auth

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class LoginComponentImpl(
    componentContext: ComponentContext,
    private val baseUrl: String,
    private val restClient: RestClient,
    initialError: String? = null,
    private val onAuthenticated: (token: String) -> Unit,
) : LoginComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(LoginState(error = initialError))
    override val state: StateFlow<LoginState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
    }

    override fun onTokenChanged(value: String) {
        _state.update { it.copy(tokenInput = value, error = null) }
    }

    override fun onSubmit() {
        val token = _state.value.tokenInput.trim()
        if (token.isBlank()) {
            _state.update { it.copy(error = "Token is required") }
            return
        }

        _state.update { it.copy(isLoading = true, error = null) }
        scope.launch {
            try {
                val profile = restClient.validateToken(baseUrl, token)
                if (profile != null) {
                    _state.update { it.copy(isLoading = false) }
                    onAuthenticated(token)
                } else {
                    _state.update { it.copy(isLoading = false, error = "Invalid token") }
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message ?: "Could not reach the server") }
            }
        }
    }
}
