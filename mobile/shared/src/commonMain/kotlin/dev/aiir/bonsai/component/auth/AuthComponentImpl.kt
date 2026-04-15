package dev.aiir.bonsai.component.auth

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.decompose.router.slot.ChildSlot
import com.arkivanov.decompose.router.slot.SlotNavigation
import com.arkivanov.decompose.router.slot.activate
import com.arkivanov.decompose.router.slot.childSlot
import com.arkivanov.decompose.value.Value
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.*
import kotlinx.serialization.Serializable

class AuthComponentImpl(
    componentContext: ComponentContext,
    private val host: String,
    private val port: Int,
    private val storedToken: String?,
    private val connectionMode: String,
    private val restClient: RestClient,
    private val connectionStorage: ConnectionStorage,
    private val onAuthenticated: (host: String, port: Int, token: String) -> Unit,
) : AuthComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val slotNavigation = SlotNavigation<SlotConfig>()

    override val childSlot: Value<ChildSlot<*, AuthComponent.AuthChild>> =
        childSlot(
            source = slotNavigation,
            serializer = SlotConfig.serializer(),
            initialConfiguration = { SlotConfig.Loading },
            childFactory = ::createChild,
        )

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        checkAuthState()
    }

    private fun checkAuthState() {
        scope.launch {
            try {
                val baseUrl = "http://$host:$port"
                val status = restClient.checkSetupStatus(baseUrl)

                if (status.needsSetup) {
                    slotNavigation.activate(SlotConfig.Setup)
                    return@launch
                }

                // Server is set up — try auto-validating stored token
                if (!storedToken.isNullOrBlank()) {
                    val profile = restClient.validateToken(baseUrl, storedToken)
                    if (profile != null) {
                        // Token is still valid — proceed directly
                        onAuthSuccess(storedToken)
                        return@launch
                    }
                    // Stored token is invalid — show login with error
                    slotNavigation.activate(SlotConfig.Login("Stored token expired"))
                } else {
                    slotNavigation.activate(SlotConfig.Login(null))
                }
            } catch (e: Exception) {
                // Network error during auth check — show login screen
                slotNavigation.activate(SlotConfig.Login("Could not reach the server"))
            }
        }
    }

    private fun onAuthSuccess(token: String) {
        connectionStorage.addRecentServer(host, port, token, connectionMode)
        onAuthenticated(host, port, token)
    }

    private fun createChild(config: SlotConfig, componentContext: ComponentContext): AuthComponent.AuthChild {
        val baseUrl = "http://$host:$port"
        return when (config) {
            SlotConfig.Loading -> AuthComponent.AuthChild.Loading

            SlotConfig.Setup -> AuthComponent.AuthChild.Setup(
                SetupComponentImpl(
                    componentContext = componentContext,
                    baseUrl = baseUrl,
                    restClient = restClient,
                    onAuthenticated = ::onAuthSuccess,
                )
            )

            is SlotConfig.Login -> AuthComponent.AuthChild.Login(
                LoginComponentImpl(
                    componentContext = componentContext,
                    baseUrl = baseUrl,
                    restClient = restClient,
                    initialError = config.initialError,
                    onAuthenticated = ::onAuthSuccess,
                )
            )
        }
    }

    @Serializable
    private sealed class SlotConfig {
        @Serializable
        data object Loading : SlotConfig()

        @Serializable
        data object Setup : SlotConfig()

        @Serializable
        data class Login(val initialError: String? = null) : SlotConfig()
    }
}
