package dev.aiir.bonsai.component.board

import dev.aiir.bonsai.data.model.MetaTicketSummary
import dev.aiir.bonsai.data.model.MetaTicketStatus
import kotlinx.coroutines.flow.StateFlow

interface BoardComponent {
    val state: StateFlow<BoardState>

    fun loadTickets()
    fun onBoardTypeChanged(type: BoardType)
    fun onCreateTicket(title: String, type: String)
    fun onTicketTapped(ticketId: String)
    fun onTicketStatusChanged(ticketId: String, newStatus: String)
}

enum class BoardType { TICKETS, TASKS }

data class BoardState(
    val boardType: BoardType = BoardType.TICKETS,
    val tickets: List<MetaTicketSummary> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
) {
    val ticketsByStatus: Map<MetaTicketStatus, List<MetaTicketSummary>>
        get() = tickets.groupBy { it.status }.toSortedMap()
}
