package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.component.StatusDot
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.component.session.SessionDetailComponent
import dev.aiir.bonsai.data.model.*
import kotlinx.serialization.json.jsonPrimitive

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailScreen(component: SessionDetailComponent) {
    val state by component.state.collectAsState()
    var messageInput by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Auto-scroll to bottom when new events arrive
    LaunchedEffect(state.events.size) {
        if (state.events.isNotEmpty()) {
            listState.animateScrollToItem(state.events.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { component.onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Column {
                        Text(state.sessionName, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            StatusDot(status = state.status, size = 5.dp)
                            Text(
                                text = "${state.status.name.lowercase()} · ${state.model.substringAfterLast("-")}",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
            )
        },
        bottomBar = {
            // Approval card or message input
            Column {
                if (state.isWaiting && state.pendingRequest != null) {
                    ApprovalBar(
                        request = state.pendingRequest!!,
                        onApprove = { component.approve(state.pendingRequest!!.requestId) },
                        onDeny = { component.deny(state.pendingRequest!!.requestId) },
                    )
                }

                // Message input
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = messageInput,
                        onValueChange = { messageInput = it },
                        placeholder = {
                            Text(
                                if (state.isWaiting) "Respond to approval first..." else "Message...",
                                fontSize = 13.sp,
                            )
                        },
                        enabled = state.canSendMessage,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(20.dp),
                        maxLines = 3,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    if (state.status == SessionStatus.RUNNING) {
                        // Interrupt button
                        IconButton(
                            onClick = { component.interrupt() },
                            modifier = Modifier
                                .size(40.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Interrupt", tint = StatusError)
                        }
                    } else {
                        // Send button
                        IconButton(
                            onClick = {
                                if (messageInput.isNotBlank()) {
                                    component.sendMessage(messageInput)
                                    messageInput = ""
                                }
                            },
                            enabled = state.canSendMessage && messageInput.isNotBlank(),
                            modifier = Modifier
                                .size(40.dp)
                                .background(
                                    if (state.canSendMessage && messageInput.isNotBlank()) BonsaiGreen
                                    else MaterialTheme.colorScheme.surfaceVariant,
                                    CircleShape,
                                ),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Send",
                                tint = if (state.canSendMessage && messageInput.isNotBlank()) Color.White
                                else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        },
    ) { padding ->
        // Event stream
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            state = listState,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(state.events) { event ->
                EventItem(event = event)
            }
        }
    }
}

@Composable
private fun EventItem(event: AgentEvent) {
    when (event.eventType) {
        EventType.USER_MESSAGE -> {
            val text = event.payload["text"]?.jsonPrimitive?.content ?: ""
            Column(modifier = Modifier.fillMaxWidth()) {
                Text("You", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(2.dp))
                Card(
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = BonsaiGreen.copy(alpha = 0.12f)),
                ) {
                    Text(
                        text = text,
                        modifier = Modifier.padding(10.dp),
                        fontSize = 13.sp,
                    )
                }
            }
        }

        EventType.TEXT_DELTA -> {
            val text = event.payload["text"]?.jsonPrimitive?.content ?: ""
            if (text.isNotBlank()) {
                Card(
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                ) {
                    Text(
                        text = text,
                        modifier = Modifier.padding(10.dp),
                        fontSize = 13.sp,
                    )
                }
            }
        }

        EventType.TOOL_CALL_START -> {
            val toolName = event.payload["toolName"]?.jsonPrimitive?.content ?: "tool"
            val input = event.payload["input"]?.toString()?.take(80) ?: ""
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Card(
                    shape = RoundedCornerShape(6.dp),
                    colors = CardDefaults.cardColors(containerColor = TypeImprovement.copy(alpha = 0.08f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("\u25B6", color = TypeImprovement, fontSize = 10.sp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(toolName, fontWeight = FontWeight.Bold, color = TypeImprovement, fontSize = 11.sp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(input, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp, maxLines = 1)
                    }
                }
            }
        }

        EventType.TOOL_CALL_END -> {
            // Show check mark for completed tool
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 8.dp),
            ) {
                Card(
                    shape = RoundedCornerShape(6.dp),
                    colors = CardDefaults.cardColors(containerColor = TypeImprovement.copy(alpha = 0.08f)),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("\u2713", color = BonsaiGreen, fontSize = 11.sp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("completed", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                    }
                }
            }
        }

        EventType.DONE, EventType.ERROR -> {
            val isError = event.eventType == EventType.ERROR
            Card(
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (isError) StatusError.copy(alpha = 0.1f) else BonsaiGreen.copy(alpha = 0.1f)
                ),
            ) {
                Text(
                    text = if (isError) "Session ended with error" else "Session completed",
                    modifier = Modifier.padding(10.dp),
                    fontSize = 12.sp,
                    color = if (isError) StatusError else BonsaiGreen,
                )
            }
        }

        else -> {
            // Other events: show minimal
        }
    }
}

@Composable
private fun ApprovalBar(
    request: PendingRequest,
    onApprove: () -> Unit,
    onDeny: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = StatusWaiting.copy(alpha = 0.1f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("\uD83D\uDD10", fontSize = 14.sp)
                Spacer(modifier = Modifier.width(6.dp))
                Text("Tool Approval Required", fontWeight = FontWeight.Bold, color = StatusWaiting, fontSize = 12.sp)
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = request.toolName ?: "action",
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = onApprove,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
                ) { Text("Approve") }
                OutlinedButton(
                    onClick = onDeny,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = StatusError),
                ) { Text("Deny") }
            }
        }
    }
}
