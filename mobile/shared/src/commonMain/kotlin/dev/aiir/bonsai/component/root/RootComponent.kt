package dev.aiir.bonsai.component.root

import com.arkivanov.decompose.router.stack.ChildStack
import com.arkivanov.decompose.value.Value
import dev.aiir.bonsai.component.auth.AuthComponent
import dev.aiir.bonsai.component.connect.ConnectComponent
import dev.aiir.bonsai.component.main.MainComponent
import dev.aiir.bonsai.component.project.ProjectPickerComponent

interface RootComponent {
    val childStack: Value<ChildStack<*, Child>>

    sealed class Child {
        data class Connect(val component: ConnectComponent) : Child()
        data class Auth(val component: AuthComponent) : Child()
        data class ProjectPicker(val component: ProjectPickerComponent) : Child()
        data class Main(val component: MainComponent) : Child()
    }
}
