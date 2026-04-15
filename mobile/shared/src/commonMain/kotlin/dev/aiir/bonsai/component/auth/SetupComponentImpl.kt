package dev.aiir.bonsai.component.auth

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class SetupComponentImpl(
    componentContext: ComponentContext,
    private val baseUrl: String,
    private val restClient: RestClient,
    private val onAuthenticated: (token: String) -> Unit,
) : SetupComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(SetupState())
    override val state: StateFlow<SetupState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
    }

    override fun onUserIdChanged(value: String) {
        _state.update { it.copy(userIdInput = value, error = null) }
    }

    override fun onNameChanged(value: String) {
        _state.update { it.copy(nameInput = value, error = null) }
    }

    override fun onSubmit() {
        val userId = _state.value.userIdInput.trim()
        val name = _state.value.nameInput.trim()

        if (userId.isBlank()) {
            _state.update { it.copy(error = "User ID is required") }
            return
        }
        if (name.isBlank()) {
            _state.update { it.copy(error = "Name is required") }
            return
        }

        _state.update { it.copy(isLoading = true, error = null) }
        scope.launch {
            try {
                val response = restClient.setup(baseUrl, userId, name)
                _state.update { it.copy(isLoading = false, createdToken = response.token) }
                onAuthenticated(response.token)
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message ?: "Setup failed") }
            }
        }
    }
}
