package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.arkivanov.decompose.extensions.compose.subscribeAsState
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.android.ui.theme.StatusWaiting
import dev.aiir.bonsai.component.main.MainComponent
import dev.aiir.bonsai.component.main.Tab
import dev.aiir.bonsai.network.rpc.ConnectionState
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(component: MainComponent) {
    val activeTab by component.activeTab.collectAsState()
    val connectionState by component.connectionState.collectAsState()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            ModalDrawerSheet(modifier = Modifier.width(280.dp)) {
                // Drawer header
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("\uD83C\uDF33 Bonsai", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(
                        text = component.serverAddress.projectPath.substringAfterLast("/"),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    val connIcon = if (connectionState is ConnectionState.Connected) "\u25CF" else "\u25CB"
                    val connColor = if (connectionState is ConnectionState.Connected) BonsaiGreen else MaterialTheme.colorScheme.error
                    Text(
                        text = "$connIcon ${component.serverAddress.host}:${component.serverAddress.port}",
                        fontSize = 11.sp,
                        color = connColor,
                    )
                }

                HorizontalDivider()

                // Main
                Text("MAIN", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, top = 12.dp))
                NavigationDrawerItem(
                    label = { Text("Board") },
                    icon = { Text("\u25A6") },
                    selected = activeTab == Tab.BOARD,
                    onClick = {
                        component.onTabSelected(Tab.BOARD)
                        scope.launch { drawerState.close() }
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                NavigationDrawerItem(
                    label = { Text("Sessions") },
                    icon = { Text("\uD83D\uDCAC") },
                    selected = activeTab == Tab.SESSIONS,
                    onClick = {
                        component.onTabSelected(Tab.SESSIONS)
                        scope.launch { drawerState.close() }
                    },
                    modifier = Modifier.padding(horizontal = 8.dp),
                )

                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))

                // Tools
                Text("TOOLS", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp))
                NavigationDrawerItem(
                    label = { Text("Specs") },
                    icon = { Text("\uD83D\uDCCB") },
                    selected = false,
                    onClick = { scope.launch { drawerState.close() } },
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                NavigationDrawerItem(
                    label = { Text("Files") },
                    icon = { Text("\uD83D\uDCC2") },
                    selected = false,
                    onClick = { scope.launch { drawerState.close() } },
                    modifier = Modifier.padding(horizontal = 8.dp),
                )

                Spacer(modifier = Modifier.weight(1f))

                HorizontalDivider()
                NavigationDrawerItem(
                    label = { Text("Settings") },
                    icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                    selected = false,
                    onClick = { scope.launch { drawerState.close() } },
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                NavigationDrawerItem(
                    label = { Text("Disconnect", color = MaterialTheme.colorScheme.error) },
                    icon = { Text("\u23FB") },
                    selected = false,
                    onClick = { component.onDisconnect() },
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
        },
    ) {
        Scaffold(
            topBar = {
                // Hide main top bar when a detail view is open (they have their own)
                val detailSlotTop by component.detailSlot.subscribeAsState()
                if (detailSlotTop.child == null) {
                    TopAppBar(
                        navigationIcon = {
                            IconButton(onClick = { scope.launch { drawerState.open() } }) {
                                Icon(Icons.Default.Menu, contentDescription = "Menu")
                            }
                        },
                        title = {
                            Text("\uD83C\uDF33 Bonsai", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        },
                        actions = {
                            val connColor = if (connectionState is ConnectionState.Connected) BonsaiGreen else MaterialTheme.colorScheme.error
                            Text(
                                text = "\u25CF",
                                color = connColor,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(end = 16.dp),
                            )
                        },
                    )
                }
            },
            bottomBar = {
                // Hide bottom tabs when a detail view is open (session, new session, ticket)
                val detailSlot by component.detailSlot.subscribeAsState()
                if (detailSlot.child == null) {
                    NavigationBar {
                        NavigationBarItem(
                            selected = activeTab == Tab.BOARD,
                            onClick = { component.onTabSelected(Tab.BOARD) },
                            icon = { Text("\u25A6", fontSize = 18.sp) },
                            label = { Text("Board", fontSize = 10.sp) },
                        )
                        NavigationBarItem(
                            selected = activeTab == Tab.SESSIONS,
                            onClick = { component.onTabSelected(Tab.SESSIONS) },
                            icon = { Text("\uD83D\uDCAC", fontSize = 18.sp) },
                            label = { Text("Sessions", fontSize = 10.sp) },
                        )
                    }
                }
            },
        ) { padding ->
            // Tab content gets Scaffold padding (top bar + bottom bar)
            Box(modifier = Modifier.padding(padding)) {
                when (activeTab) {
                    Tab.BOARD -> BoardScreen(component = component.boardComponent)
                    Tab.SESSIONS -> SessionListScreen(component = component.sessionListComponent)
                }
            }

            // Detail overlay fills entire screen (ignores Scaffold padding — has its own bars)
            val detailSlot by component.detailSlot.subscribeAsState()
            detailSlot.child?.instance?.let { instance ->
                Box(modifier = Modifier.fillMaxSize()) {
                    when (instance) {
                        is MainComponent.DetailChild.SessionDetail ->
                            SessionDetailScreen(component = instance.component)
                        is MainComponent.DetailChild.NewSession ->
                            NewSessionScreen(component = instance.component)
                        is MainComponent.DetailChild.TicketDetail ->
                            TicketDetailScreen(component = instance.component)
                    }
                }
            }
        }
    }
}
