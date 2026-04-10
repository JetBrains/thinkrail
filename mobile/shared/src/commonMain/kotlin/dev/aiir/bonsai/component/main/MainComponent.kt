package dev.aiir.bonsai.component.main

import com.arkivanov.decompose.router.slot.ChildSlot
import com.arkivanov.decompose.value.Value
import dev.aiir.bonsai.component.board.BoardComponent
import dev.aiir.bonsai.component.session.NewSessionComponent
import dev.aiir.bonsai.component.session.SessionDetailComponent
import dev.aiir.bonsai.component.session.SessionListComponent
import dev.aiir.bonsai.component.ticket.TicketDetailComponent
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.rpc.ConnectionState
import kotlinx.coroutines.flow.StateFlow

interface MainComponent {
    val connectionState: StateFlow<ConnectionState>
    val serverAddress: ServerAddress
    val activeTab: StateFlow<Tab>

    val boardComponent: BoardComponent
    val sessionListComponent: SessionListComponent

    /** Slot for detail view overlaid on top of tabs (zero or one child). */
    val detailSlot: Value<ChildSlot<*, DetailChild>>

    fun onTabSelected(tab: Tab)
    fun onNewSession()
    fun onDisconnect()

    sealed class DetailChild {
        data class SessionDetail(val component: SessionDetailComponent) : DetailChild()
        data class NewSession(val component: NewSessionComponent) : DetailChild()
        data class TicketDetail(val component: TicketDetailComponent) : DetailChild()
    }
}

enum class Tab { BOARD, SESSIONS }
