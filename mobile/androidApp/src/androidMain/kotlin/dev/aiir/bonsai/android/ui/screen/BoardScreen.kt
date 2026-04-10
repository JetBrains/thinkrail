package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.component.TicketCard
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.component.board.BoardComponent
import dev.aiir.bonsai.component.board.BoardType
import dev.aiir.bonsai.data.model.MetaTicketStatus

@Composable
fun BoardScreen(component: BoardComponent) {
    val state by component.state.collectAsState()
    var selectedColumn by remember { mutableStateOf(MetaTicketStatus.IDEA) }
    var showCreateDialog by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Board type toggle
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                SegmentedButton(
                    selected = state.boardType == BoardType.TICKETS,
                    onClick = { component.onBoardTypeChanged(BoardType.TICKETS) },
                    shape = RoundedCornerShape(topStart = 8.dp, bottomStart = 8.dp),
                    label = { Text("Tickets", fontSize = 12.sp) },
                )
                SegmentedButton(
                    selected = state.boardType == BoardType.TASKS,
                    onClick = { component.onBoardTypeChanged(BoardType.TASKS) },
                    shape = RoundedCornerShape(topEnd = 8.dp, bottomEnd = 8.dp),
                    label = { Text("Tasks", fontSize = 12.sp) },
                )
            }

            // Column headers (horizontally scrollable)
            val columns = MetaTicketStatus.entries
            val scrollState = rememberScrollState()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(scrollState)
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                columns.forEach { status ->
                    val count = state.ticketsByStatus[status]?.size ?: 0
                    val isSelected = selectedColumn == status
                    FilterChip(
                        selected = isSelected,
                        onClick = { selectedColumn = status },
                        label = {
                            Text(
                                text = "${status.name.lowercase().replaceFirstChar { it.uppercase() }} ($count)",
                                fontSize = 11.sp,
                            )
                        },
                    )
                }
            }

            // Tickets in selected column
            val tickets = state.ticketsByStatus[selectedColumn] ?: emptyList()
            if (state.isLoading && tickets.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else if (tickets.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize().padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "No tickets in ${selectedColumn.name.lowercase()}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(tickets, key = { it.id }) { ticket ->
                        TicketCard(
                            ticket = ticket,
                            onClick = { component.onTicketTapped(ticket.id) },
                        )
                    }
                }
            }
        }

        // FAB
        FloatingActionButton(
            onClick = { showCreateDialog = true },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            containerColor = BonsaiGreen,
            shape = CircleShape,
        ) {
            Icon(Icons.Default.Add, contentDescription = "Create ticket")
        }
    }

    // Create ticket dialog
    if (showCreateDialog) {
        CreateTicketDialog(
            onDismiss = { showCreateDialog = false },
            onCreate = { title, type ->
                component.onCreateTicket(title, type)
                showCreateDialog = false
            },
        )
    }
}

@Composable
private fun SegmentedButton(
    selected: Boolean,
    onClick: () -> Unit,
    shape: RoundedCornerShape,
    label: @Composable () -> Unit,
) {
    val colors = if (selected) {
        ButtonDefaults.buttonColors(containerColor = BonsaiGreen)
    } else {
        ButtonDefaults.outlinedButtonColors()
    }

    if (selected) {
        Button(onClick = onClick, shape = shape, colors = colors, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) { label() }
    } else {
        OutlinedButton(onClick = onClick, shape = shape, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) { label() }
    }
}

@Composable
private fun CreateTicketDialog(
    onDismiss: () -> Unit,
    onCreate: (title: String, type: String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("feature") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Ticket") },
        text = {
            Column {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    placeholder = { Text("Ticket title") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("feature", "bug", "idea", "improvement").forEach { t ->
                        FilterChip(
                            selected = type == t,
                            onClick = { type = t },
                            label = { Text(t, fontSize = 11.sp) },
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { if (title.isNotBlank()) onCreate(title, type) },
                colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
            ) { Text("Create") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}
