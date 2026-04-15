package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.arkivanov.decompose.extensions.compose.subscribeAsState
import dev.aiir.bonsai.component.auth.AuthComponent

@Composable
fun AuthScreen(component: AuthComponent) {
    val slot by component.childSlot.subscribeAsState()

    when (val child = slot.child?.instance) {
        is AuthComponent.AuthChild.Loading -> {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Checking server...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        is AuthComponent.AuthChild.Setup -> SetupScreen(component = child.component)
        is AuthComponent.AuthChild.Login -> LoginScreen(component = child.component)
        null -> {
            // Slot is empty during initialization
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        }
    }
}
