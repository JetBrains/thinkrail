package dev.aiir.bonsai.component.ticket

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class TicketDetailComponentImpl(
    componentContext: ComponentContext,
    private val ticketId: String,
    private val rpcMethods: RpcMethods,
    private val onBack: () -> Unit,
) : TicketDetailComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(TicketDetailState(ticketId = ticketId))
    override val state: StateFlow<TicketDetailState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        loadTicket()
    }

    private fun loadTicket() {
        scope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val ticket = rpcMethods.boardGet(ticketId)
                val plan = try { rpcMethods.boardGetPlan(ticketId) } catch (_: Exception) { null }
                _state.update {
                    it.copy(
                        ticket = ticket,
                        plan = plan,
                        isLoading = false,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun onBack() { onBack.invoke() }
}
