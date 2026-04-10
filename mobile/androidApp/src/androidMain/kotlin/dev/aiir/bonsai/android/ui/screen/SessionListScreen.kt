package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.component.SessionCard
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.android.ui.theme.StatusWaiting
import dev.aiir.bonsai.component.session.SessionListComponent
import dev.aiir.bonsai.component.session.SessionTab

@Composable
fun SessionListScreen(component: SessionListComponent) {
    val state by component.state.collectAsState()

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Tabs: Active | All
            TabRow(
                selectedTabIndex = if (state.activeTab == SessionTab.ACTIVE) 0 else 1,
            ) {
                Tab(
                    selected = state.activeTab == SessionTab.ACTIVE,
                    onClick = { component.onTabChanged(SessionTab.ACTIVE) },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(state.activeTabLabel, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            if (state.attentionSessions.isNotEmpty()) {
                                Badge(containerColor = StatusWaiting) {
                                    Text("!${state.attentionSessions.size}", fontSize = 9.sp)
                                }
                            }
                        }
                    },
                )
                Tab(
                    selected = state.activeTab == SessionTab.ALL,
                    onClick = { component.onTabChanged(SessionTab.ALL) },
                    text = { Text("All", fontSize = 12.sp) },
                )
            }

            // Session list
            val sessions = when (state.activeTab) {
                SessionTab.ACTIVE -> state.activeSessions
                SessionTab.ALL -> state.sessions
            }

            if (state.isLoading && sessions.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (sessions.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = if (state.activeTab == SessionTab.ACTIVE) "No active sessions" else "No sessions yet",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(sessions, key = { it.bonsaiSid }) { session ->
                        SessionCard(
                            session = session,
                            onClick = { component.onSessionTapped(session.bonsaiSid) },
                            onApprove = session.pendingRequest?.let {
                                { component.onApprove(session.bonsaiSid, it.requestId) }
                            },
                            onDeny = session.pendingRequest?.let {
                                { component.onDeny(session.bonsaiSid, it.requestId) }
                            },
                        )
                    }
                }
            }
        }

        // FAB
        FloatingActionButton(
            onClick = { component.onNewSession() },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = BonsaiGreen,
            shape = CircleShape,
        ) {
            Icon(Icons.Default.Add, contentDescription = "New session")
        }
    }
}
