package dev.aiir.bonsai.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.arkivanov.decompose.defaultComponentContext
import com.arkivanov.decompose.extensions.compose.stack.Children
import com.arkivanov.decompose.extensions.compose.stack.animation.slide
import com.arkivanov.decompose.extensions.compose.stack.animation.stackAnimation
import dev.aiir.bonsai.android.ui.screen.ConnectScreen
import dev.aiir.bonsai.android.ui.screen.MainScreen
import dev.aiir.bonsai.android.ui.screen.ProjectPickerScreen
import dev.aiir.bonsai.android.ui.theme.BonsaiTheme
import dev.aiir.bonsai.component.root.RootComponent
import dev.aiir.bonsai.component.root.RootComponentImpl
import dev.aiir.bonsai.data.ConnectionStorage
import dev.aiir.bonsai.network.connection.ConnectionManager
import dev.aiir.bonsai.network.rest.RestClient
import dev.aiir.bonsai.network.rpc.RpcClient
import dev.aiir.bonsai.network.rpc.RpcMethods
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {
    private val rpcClient: RpcClient by inject()
    private val rpcMethods: RpcMethods by inject()
    private val restClient: RestClient by inject()
    private val connectionManager: ConnectionManager by inject()
    private val connectionStorage: ConnectionStorage by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val componentContext = defaultComponentContext()

        val rootComponent = RootComponentImpl(
            componentContext = componentContext,
            rpcClient = rpcClient,
            rpcMethods = rpcMethods,
            restClient = restClient,
            connectionManager = connectionManager,
            connectionStorage = connectionStorage,
        )

        setContent {
            BonsaiTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    Children(
                        stack = rootComponent.childStack,
                        animation = stackAnimation(slide()),
                    ) { child ->
                        when (val instance = child.instance) {
                            is RootComponent.Child.Connect -> ConnectScreen(component = instance.component)
                            is RootComponent.Child.ProjectPicker -> ProjectPickerScreen(component = instance.component)
                            is RootComponent.Child.Main -> MainScreen(component = instance.component)
                        }
                    }
                }
            }
        }
    }
}
