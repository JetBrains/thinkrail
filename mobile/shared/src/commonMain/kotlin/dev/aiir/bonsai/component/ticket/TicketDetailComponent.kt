package dev.aiir.bonsai.component.ticket

import dev.aiir.bonsai.data.model.MetaTicket
import dev.aiir.bonsai.data.model.Plan
import kotlinx.coroutines.flow.StateFlow

interface TicketDetailComponent {
    val state: StateFlow<TicketDetailState>
    fun onBack()
}

data class TicketDetailState(
    val ticketId: String,
    val ticket: MetaTicket? = null,
    val plan: Plan? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)
