package dev.aiir.bonsai.component.root

import com.arkivanov.decompose.router.stack.ChildStack
import com.arkivanov.decompose.value.Value
import dev.aiir.bonsai.component.connect.ConnectComponent
import dev.aiir.bonsai.component.main.MainComponent

interface RootComponent {
    val childStack: Value<ChildStack<*, Child>>

    sealed class Child {
        data class Connect(val component: ConnectComponent) : Child()
        data class Main(val component: MainComponent) : Child()
    }
}
