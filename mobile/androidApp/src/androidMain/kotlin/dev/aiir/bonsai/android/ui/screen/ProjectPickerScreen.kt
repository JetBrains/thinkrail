package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.component.project.ProjectPickerComponent

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProjectPickerScreen(component: ProjectPickerComponent) {
    val state by component.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Select Project", fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(
                            "${state.host}:${state.port}",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { component.onDisconnect() }) {
                        Icon(Icons.Default.Close, contentDescription = "Disconnect")
                    }
                },
            )
        },
    ) { padding ->
        if (state.isConnecting) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = BonsaiGreen)
                    Spacer(modifier = Modifier.height(12.dp))
                    Text("Connecting...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                // Error
                if (state.error != null) {
                    item {
                        Text(
                            state.error!!,
                            color = MaterialTheme.colorScheme.error,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(bottom = 8.dp),
                        )
                    }
                }

                // Recent projects
                if (state.recentProjects.isNotEmpty()) {
                    item {
                        Text(
                            "RECENT PROJECTS",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(state.recentProjects, key = { it.path }) { project ->
                        ProjectCard(
                            name = project.name,
                            path = project.path,
                            subtitle = formatTimeAgo(project.lastOpened),
                            onClick = { component.onProjectSelected(project.path) },
                        )
                    }
                    item { Spacer(modifier = Modifier.height(8.dp)) }
                }

                // Available projects (scanned)
                if (state.availableProjects.isNotEmpty()) {
                    item {
                        Text(
                            "AVAILABLE PROJECTS",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(state.availableProjects, key = { it.path }) { project ->
                        ProjectCard(
                            name = project.name,
                            path = project.path,
                            onClick = { component.onProjectSelected(project.path) },
                        )
                    }
                    item { Spacer(modifier = Modifier.height(8.dp)) }
                }

                // Loading indicator
                if (state.isLoading) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                        }
                    }
                }

                // Manual path input
                item {
                    HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
                    Text(
                        "ENTER PATH",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedTextField(
                        value = state.pathInput,
                        onValueChange = { component.onPathChanged(it) },
                        placeholder = { Text("/path/to/project", fontSize = 12.sp) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                    )
                }

                // Autocomplete suggestions
                if (state.autocompleteSuggestions.isNotEmpty()) {
                    items(state.autocompleteSuggestions) { suggestion ->
                        Text(
                            text = suggestion,
                            fontSize = 12.sp,
                            color = BonsaiGreen,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { component.onSuggestionSelected(suggestion) }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                        )
                    }
                }

                // Open button
                item {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = { component.onOpenManualPath() },
                        enabled = state.pathInput.isNotBlank() && !state.isConnecting,
                        modifier = Modifier.fillMaxWidth().height(44.dp),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
                    ) {
                        Text("Open")
                    }
                    Spacer(modifier = Modifier.height(16.dp))
                }
            }
        }
    }
}

@Composable
private fun ProjectCard(
    name: String,
    path: String,
    subtitle: String? = null,
    onClick: () -> Unit,
) {
    OutlinedCard(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("\uD83D\uDCC1", fontSize = 18.sp)
            Spacer(modifier = Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.Bold, fontSize = 13.sp, maxLines = 1)
                Text(path, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                if (subtitle != null) {
                    Text(subtitle, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
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
