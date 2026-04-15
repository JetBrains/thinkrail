package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.component.connect.ConnectComponent
import dev.aiir.bonsai.component.connect.ConnectionMode

@Composable
fun ConnectScreen(component: ConnectComponent) {
    val state by component.state.collectAsState()
    val selectedTab = if (state.mode == ConnectionMode.LOCAL) 0 else 1

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(48.dp))

        // Logo
        Text(text = "\uD83C\uDF33", fontSize = 48.sp)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Bonsai",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Connect to your Bonsai server",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Connection mode tabs
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = BonsaiGreen,
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { component.onModeChanged(ConnectionMode.LOCAL) },
                text = { Text("Local Network") },
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { component.onModeChanged(ConnectionMode.TAILSCALE) },
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Tailscale")
                        if (state.isTailscaleActive) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Badge(containerColor = BonsaiGreen) {
                                Text("VPN", style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                },
            )
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Mode-specific input
        when (state.mode) {
            ConnectionMode.LOCAL -> {
                Text(
                    text = "SERVER ADDRESS",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = state.addressInput,
                    onValueChange = { component.onAddressChanged(it) },
                    placeholder = { Text("192.168.1.x:8000") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                )
            }
            ConnectionMode.TAILSCALE -> {
                Text(
                    text = "MACHINE NAME",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(4.dp))
                OutlinedTextField(
                    value = state.tailscaleMachineInput,
                    onValueChange = { component.onTailscaleMachineChanged(it) },
                    placeholder = { Text("e.g. my-laptop") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Enter your computer's Tailscale machine name.\nFind it by running tailscale status or check the Bonsai web UI.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Error
        if (state.error != null) {
            Text(
                text = state.error!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        // Connect button
        val inputValid = when (state.mode) {
            ConnectionMode.LOCAL -> state.addressInput.isNotBlank()
            ConnectionMode.TAILSCALE -> state.tailscaleMachineInput.isNotBlank()
        }
        Button(
            onClick = { component.onConnect() },
            enabled = !state.isConnecting && inputValid,
            modifier = Modifier.fillMaxWidth().height(48.dp),
            shape = RoundedCornerShape(8.dp),
            colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
        ) {
            if (state.isConnecting) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
            } else {
                Text("Connect")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Recent servers
        if (state.recentServers.isNotEmpty()) {
            HorizontalDivider()
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = "RECENT SERVERS",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(8.dp))
            LazyColumn(
                modifier = Modifier.weight(1f, fill = false),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(state.recentServers) { server ->
                    OutlinedCard(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { component.onRecentServerSelected(server) },
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "${server.host}:${server.port}",
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold,
                                )
                                Row {
                                    if (server.connectionMode == "tailscale") {
                                        Text(
                                            text = "Tailscale",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = BonsaiGreen,
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                    }
                                    if (server.lastConnected > 0) {
                                        Text(
                                            text = formatTimeAgo(server.lastConnected),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                            if (server.token != null) {
                                Text(
                                    text = "\uD83D\uDD11",
                                    fontSize = 14.sp,
                                )
                            }
                        }
                    }
                }
            }
        } else {
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = "Run ./run.sh on your computer,\nthen enter its address above",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

private fun formatTimeAgo(timestamp: Long): String {
    val now = System.currentTimeMillis()
    val diff = now - timestamp
    val minutes = diff / 60_000
    val hours = minutes / 60
    val days = hours / 24
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes}m ago"
        hours < 24 -> "${hours}h ago"
        days < 7 -> "${days}d ago"
        else -> "${days / 7}w ago"
    }
}
