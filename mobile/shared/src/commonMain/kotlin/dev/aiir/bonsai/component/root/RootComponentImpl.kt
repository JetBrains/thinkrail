package dev.aiir.bonsai.component.root

import com.arkivanov.decompose.ComponentContext
import com.arkivanov.decompose.router.stack.*
import com.arkivanov.decompose.value.Value
import dev.aiir.bonsai.component.connect.ConnectComponent
import dev.aiir.bonsai.component.connect.ConnectComponentImpl
import dev.aiir.bonsai.component.main.MainComponent
import dev.aiir.bonsai.component.main.MainComponentImpl
import dev.aiir.bonsai.data.model.ServerAddress
import dev.aiir.bonsai.network.connection.ConnectionManager
import dev.aiir.bonsai.network.rest.RestClient
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import kotlinx.serialization.Serializable

class RootComponentImpl(
    componentContext: ComponentContext,
    private val rpcClient: RpcClient,
    private val rpcMethods: RpcMethods,
    private val restClient: RestClient,
    private val connectionManager: ConnectionManager,
) : RootComponent, ComponentContext by componentContext {

    private val navigation = StackNavigation<Config>()

    override val childStack: Value<ChildStack<*, RootComponent.Child>> =
        childStack(
            source = navigation,
            serializer = Config.serializer(),
            initialConfiguration = Config.Connect,
            handleBackButton = true,
            childFactory = ::createChild,
        )

    private fun createChild(config: Config, componentContext: ComponentContext): RootComponent.Child =
        when (config) {
            Config.Connect -> RootComponent.Child.Connect(
                ConnectComponentImpl(
                    componentContext = componentContext,
                    connectionManager = connectionManager,
                    restClient = restClient,
                    onConnected = { address -> onConnected(address) },
                )
            )
            is Config.Main -> RootComponent.Child.Main(
                MainComponentImpl(
                    componentContext = componentContext,
                    rpcClient = rpcClient,
                    rpcMethods = rpcMethods,
                    restClient = restClient,
                    serverAddress = config.address,
                    onDisconnect = { navigation.replaceAll(Config.Connect) },
                )
            )
        }

    private fun onConnected(address: ServerAddress) {
        navigation.replaceAll(Config.Main(address))
    }

    @Serializable
    private sealed class Config {
        @Serializable
        data object Connect : Config()

        @Serializable
        data class Main(val address: ServerAddress) : Config()
    }
}
