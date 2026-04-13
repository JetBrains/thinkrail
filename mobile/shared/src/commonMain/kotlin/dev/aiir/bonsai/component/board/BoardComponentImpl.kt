package dev.aiir.bonsai.component.board

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.essenty.lifecycle.doOnDestroy
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class BoardComponentImpl(
    componentContext: ComponentContext,
    private val rpcMethods: RpcMethods,
    private val rpcClient: RpcClient,
    private val onTicketSelected: (String) -> Unit,
) : BoardComponent, ComponentContext by componentContext {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val _state = MutableStateFlow(BoardState())
    override val state: StateFlow<BoardState> = _state.asStateFlow()

    init {
        lifecycle.doOnDestroy { scope.cancel() }
        loadTickets()
        observeNotifications()
    }

    override fun loadTickets() {
        scope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            try {
                val tickets = rpcMethods.boardList()
                _state.update { it.copy(tickets = tickets, isLoading = false) }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, error = e.message) }
            }
        }
    }

    override fun onBoardTypeChanged(type: BoardType) {
        _state.update { it.copy(boardType = type) }
    }

    override fun onCreateTicket(title: String, type: String) {
        scope.launch {
            try {
                rpcMethods.boardCreate(title = title, type = type)
                loadTickets()
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    override fun onTicketTapped(ticketId: String) {
        onTicketSelected(ticketId)
    }

    override fun onTicketStatusChanged(ticketId: String, newStatus: String) {
        scope.launch {
            try {
                rpcMethods.boardUpdate(id = ticketId, status = newStatus)
                loadTickets()
            } catch (e: Exception) {
                _state.update { it.copy(error = e.message) }
            }
        }
    }

    private fun observeNotifications() {
        scope.launch {
            rpcClient.notificationsFor("board/").collect {
                loadTickets() // Reload on any board change
            }
        }
    }
}
