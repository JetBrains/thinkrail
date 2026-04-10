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
import dev.aiir.bonsai.android.ui.component.*
import dev.aiir.bonsai.android.ui.component.vis.*
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.component.session.*
import dev.aiir.bonsai.data.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailScreen(component: SessionDetailComponent) {
    val state by component.state.collectAsState()
    var messageInput by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    // Auto-scroll to bottom on new items
    LaunchedEffect(state.chatItems.size) {
        if (state.chatItems.isNotEmpty()) {
            listState.animateScrollToItem(state.chatItems.size - 1)
        }
    }

    Scaffold(
        topBar = {
            // Compact header: name, status · model ▼ · $cost · X% ctx
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { component.onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Column {
                        Text(
                            text = state.sessionName.ifEmpty { state.bonsaiSid.take(8) },
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            StatusDot(status = state.sessionStatus, size = 5.dp)
                            Text(
                                text = state.sessionStatus.name.lowercase(),
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text("·", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            // Tappable model name
                            Text(
                                text = "${state.sessionModel.substringAfterLast("-")} ▼",
                                fontSize = 10.sp,
                                color = BonsaiGreen,
                                modifier = Modifier.clickable { /* TODO: show model picker */ },
                            )
                            Text("·", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                text = "$${String.format("%.2f", state.costUsd)}",
                                fontSize = 10.sp,
                                color = BonsaiGreen,
                                fontWeight = FontWeight.Bold,
                            )
                            Text("·", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                text = "${state.contextPercent}% ctx",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        // Context usage bar
                        Spacer(modifier = Modifier.height(2.dp))
                        ContextUsageBar(percent = state.contextPercent)
                    }
                },
            )
        },
        bottomBar = {
            Column {
                // Pending request card (approval, question, suggestion)
                val pending = state.pendingRequest
                if (state.isWaiting && pending != null) {
                    Box(modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) {
                        when (pending.type) {
                            PendingRequestType.APPROVAL -> ApprovalCard(
                                request = pending,
                                onApprove = { component.approve(pending.requestId) },
                                onDeny = { component.deny(pending.requestId) },
                            )
                            PendingRequestType.QUESTION -> QuestionCard(
                                request = pending,
                                onSubmit = { answers -> component.answerQuestion(pending.requestId, answers) },
                            )
                            PendingRequestType.SUGGESTION, PendingRequestType.DESCRIPTION_SUGGESTION -> SuggestionCard(
                                request = pending,
                                onAccept = { component.acceptSuggestion(pending.requestId) },
                                onDismiss = { component.dismissSuggestion(pending.requestId) },
                            )
                            PendingRequestType.STEP_PROPOSAL -> SuggestionCard(
                                request = pending,
                                onAccept = { component.acceptSuggestion(pending.requestId) },
                                onDismiss = { component.dismissSuggestion(pending.requestId) },
                            )
                        }
                    }
                }

                // Message input bar
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
                                if (state.isWaiting) "Respond above first..." else "Message...",
                                fontSize = 13.sp,
                            )
                        },
                        enabled = state.canSendMessage,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(20.dp),
                        maxLines = 3,
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    if (state.isRunning) {
                        IconButton(
                            onClick = { component.interrupt() },
                            modifier = Modifier
                                .size(40.dp)
                                .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
                        ) {
                            Icon(Icons.Default.Close, contentDescription = "Interrupt", tint = StatusError)
                        }
                    } else {
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
        if (state.isLoading && state.chatItems.isEmpty()) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                state = listState,
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(state.chatItems.size) { index ->
                    ChatItemView(
                        item = state.chatItems[index],
                        component = component,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatItemView(
    item: ChatItem,
    component: SessionDetailComponent,
) {
    when (item) {
        is ChatItem.UserMessage -> {
            Column {
                Text("You", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(modifier = Modifier.height(2.dp))
                Card(
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = BonsaiGreen.copy(alpha = 0.12f)),
                ) {
                    Text(text = item.text, modifier = Modifier.padding(10.dp), fontSize = 13.sp)
                }
            }
        }

        is ChatItem.AssistantMessage -> {
            Card(
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
            ) {
                Text(
                    text = item.text,
                    modifier = Modifier.padding(10.dp),
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                )
            }
        }

        is ChatItem.ToolCall -> {
            if (item.state.isVisualization) {
                if (item.state.visCollapsed) {
                    CollapsedVisMarker(
                        title = item.state.visTitle ?: "",
                        type = item.state.visType ?: "",
                    )
                } else {
                    VisualizationCard(state = item.state)
                }
            } else {
                ToolCallCard(state = item.state)
            }
        }

        is ChatItem.TurnMarker -> {
            SystemPill(text = "$${String.format("%.2f", item.costUsd)} · ${item.tokens / 1000}k tokens")
        }

        is ChatItem.SubagentStart -> {
            SubagentBlock(description = item.description) {
                // Children events would be nested here in a more advanced implementation
                // For now, they render flat in the list
            }
        }

        is ChatItem.SubagentEnd -> {
            SubagentFooter(costUsd = item.costUsd)
        }

        is ChatItem.PendingApproval -> {
            // Rendered in bottomBar, not inline
        }

        is ChatItem.PendingQuestion -> {
            // Rendered in bottomBar, not inline
        }

        is ChatItem.Suggestion -> {
            // Rendered in bottomBar, not inline
        }

        is ChatItem.Notification -> {
            SystemPill(text = item.message)
        }

        is ChatItem.Progress -> {
            SystemPill(text = item.message)
        }

        is ChatItem.Interrupted -> {
            SystemPill(
                text = "\u23F8 Turn interrupted",
                color = StatusWaiting,
                backgroundColor = StatusWaiting.copy(alpha = 0.1f),
            )
        }

        is ChatItem.SessionDone -> {
            CompletionBanner(item = item, onResume = { component.resumeSession() })
        }

        is ChatItem.SessionError -> {
            ErrorBanner(item = item, onResume = { component.resumeSession() })
        }

        is ChatItem.SessionConfig -> {
            var configExpanded by remember { mutableStateOf(false) }
            Card(
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(containerColor = BonsaiGreen.copy(alpha = 0.06f)),
                border = androidx.compose.foundation.BorderStroke(1.dp, BonsaiGreen.copy(alpha = 0.15f)),
                onClick = { configExpanded = !configExpanded },
            ) {
                Column(modifier = Modifier.padding(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (configExpanded) "▼" else "▶", fontSize = 10.sp, color = BonsaiGreen)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("SESSION CONFIG", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = BonsaiGreen)
                        if (item.totalTokens > 0) {
                            Spacer(modifier = Modifier.weight(1f))
                            Text(
                                text = "${item.totalTokens} tokens",
                                fontSize = 9.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Model: ${item.config.model}", fontSize = 10.sp)
                        Text("Permission: ${item.config.permissionMode.displayLabel}", fontSize = 10.sp)
                    }
                    if (configExpanded) {
                        if (item.specIds.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "Specs: ${item.specIds.joinToString(", ")}",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (item.filePaths.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = "Files: ${item.filePaths.joinToString(", ") { it.substringAfterLast("/") }}",
                                fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (item.sections.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(6.dp))
                            TokenBreakdownBar(
                                segments = item.sections.mapIndexed { i, section ->
                                    val colors = listOf(BonsaiGreen, StatusQuestion, StatusWaiting, Color(0xFF9C27B0), StatusDone)
                                    TokenSegment(label = section.label, tokens = section.tokens, color = colors[i % colors.size])
                                },
                                totalTokens = item.totalTokens,
                            )
                        }
                    }
                }
            }
        }

        is ChatItem.PermissionDenied -> {
            SystemPill(
                text = "\u26A0 Permission denied: ${item.toolName}",
                color = StatusError,
                backgroundColor = StatusError.copy(alpha = 0.1f),
            )
        }
    }
}
