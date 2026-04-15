package dev.aiir.bonsai.component.auth

import com.arkivanov.decompose.router.slot.ChildSlot
import com.arkivanov.decompose.value.Value

interface AuthComponent {
    val childSlot: Value<ChildSlot<*, AuthChild>>

    sealed class AuthChild {
        data object Loading : AuthChild()
        data class Setup(val component: SetupComponent) : AuthChild()
        data class Login(val component: LoginComponent) : AuthChild()
    }
}
