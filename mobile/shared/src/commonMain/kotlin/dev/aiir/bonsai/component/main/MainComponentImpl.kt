package dev.aiir.bonsai.component.main

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.decompose.childContext
import com.arkivanov.decompose.router.slot.*
import com.arkivanov.decompose.value.Value
import dev.aiir.bonsai.component.board.BoardComponent
import dev.aiir.bonsai.component.board.BoardComponentImpl
import dev.aiir.bonsai.component.session.SessionDetailComponent
import dev.aiir.bonsai.component.session.SessionDetailComponentImpl
import dev.aiir.bonsai.component.session.SessionListComponent
import dev.aiir.bonsai.component.session.SessionListComponentImpl
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.rpc.ConnectionState
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import dev.aiir.bonsai.network.rest.RestClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable

class MainComponentImpl(
    componentContext: ComponentContext,
    private val rpcClient: RpcClient,
    private val rpcMethods: RpcMethods,
    private val restClient: RestClient,
    override val serverAddress: ServerAddress,
    private val onDisconnect: () -> Unit,
) : MainComponent, ComponentContext by componentContext {

    override val connectionState: StateFlow<ConnectionState> = rpcClient.connectionState

    private val _activeTab = MutableStateFlow(Tab.BOARD)
    override val activeTab: StateFlow<Tab> = _activeTab.asStateFlow()

    override val boardComponent: BoardComponent = BoardComponentImpl(
        componentContext = childContext("board"),
        rpcMethods = rpcMethods,
        rpcClient = rpcClient,
        onTicketSelected = { ticketId -> /* TODO: open TicketDetailScreen */ },
    )

    override val sessionListComponent: SessionListComponent = SessionListComponentImpl(
        componentContext = childContext("sessions"),
        rpcMethods = rpcMethods,
        rpcClient = rpcClient,
        onSessionSelected = { bonsaiSid -> openSessionDetail(bonsaiSid) },
    )

    private val detailNavigation = SlotNavigation<DetailConfig>()

    override val detailSlot: Value<ChildSlot<*, MainComponent.DetailChild>> =
        childSlot(
            source = detailNavigation,
            serializer = DetailConfig.serializer(),
            handleBackButton = true,
            childFactory = ::createDetailChild,
        )

    private fun createDetailChild(config: DetailConfig, componentContext: ComponentContext): MainComponent.DetailChild =
        when (config) {
            is DetailConfig.SessionDetail -> MainComponent.DetailChild.SessionDetail(
                SessionDetailComponentImpl(
                    componentContext = componentContext,
                    bonsaiSid = config.bonsaiSid,
                    rpcMethods = rpcMethods,
                    rpcClient = rpcClient,
                    onBack = { detailNavigation.dismiss() },
                )
            )
        }

    override fun onTabSelected(tab: Tab) {
        _activeTab.value = tab
    }

    override fun onDisconnect() {
        rpcClient.disconnect()
        onDisconnect.invoke()
    }

    private fun openSessionDetail(bonsaiSid: String) {
        detailNavigation.activate(DetailConfig.SessionDetail(bonsaiSid))
    }

    @Serializable
    private sealed class DetailConfig {
        @Serializable
        data class SessionDetail(val bonsaiSid: String) : DetailConfig()
    }
}
