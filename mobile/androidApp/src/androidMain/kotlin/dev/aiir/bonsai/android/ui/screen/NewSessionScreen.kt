package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.component.TokenBreakdownBar
import dev.aiir.bonsai.android.ui.component.TokenSegment
import dev.aiir.bonsai.android.ui.theme.*
import dev.aiir.bonsai.component.session.NewSessionComponent
import dev.aiir.bonsai.component.session.NewSessionStep
import dev.aiir.bonsai.data.model.Effort
import dev.aiir.bonsai.data.model.PermissionMode

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewSessionScreen(component: NewSessionComponent) {
    val state by component.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { component.back() }) {
                        Text(if (state.step == NewSessionStep.PREVIEW) "←" else "✕", fontSize = 16.sp)
                    }
                },
                title = {
                    Text(
                        if (state.step == NewSessionStep.CONFIGURE) "New Session" else "Draft Preview",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                    )
                },
                actions = {
                    val label = if (state.step == NewSessionStep.CONFIGURE) "Preview" else "Start"
                    val onClick = if (state.step == NewSessionStep.CONFIGURE) component::preview else component::start
                    Button(
                        onClick = onClick,
                        enabled = !state.isLoading,
                        colors = ButtonDefaults.buttonColors(containerColor = BonsaiGreen),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 6.dp),
                    ) {
                        if (state.isLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                        } else {
                            Text(label, fontSize = 12.sp)
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            if (state.step == NewSessionStep.CONFIGURE) {
                ConfigureForm(component, state)
            } else {
                PreviewContent(component, state)
            }

            // Error
            if (state.error != null) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(state.error!!, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
        }
    }
}

@Composable
private fun ConfigureForm(component: NewSessionComponent, state: dev.aiir.bonsai.component.session.NewSessionState) {
    var showModelMenu by remember { mutableStateOf(false) }
    var showSpecPicker by remember { mutableStateOf(false) }
    var showTicketMenu by remember { mutableStateOf(false) }
    var showFileInput by remember { mutableStateOf(false) }
    var fileSearchQuery by remember { mutableStateOf("") }
    var showSkillMenu by remember { mutableStateOf(false) }

    // Name
    FormField("Name") {
        OutlinedTextField(
            value = state.name,
            onValueChange = { component.onNameChanged(it) },
            placeholder = { Text("Session name (optional)", fontSize = 12.sp) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = RoundedCornerShape(8.dp),
        )
    }

    // Prompt
    FormField("Prompt") {
        OutlinedTextField(
            value = state.prompt,
            onValueChange = { component.onPromptChanged(it) },
            placeholder = { Text("What should the agent work on?", fontSize = 12.sp) },
            modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
            shape = RoundedCornerShape(8.dp),
            maxLines = 8,
        )
    }

    // Model + Effort
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Column(modifier = Modifier.weight(1f)) {
            FormLabel("Model")
            Box {
                OutlinedCard(
                    modifier = Modifier.fillMaxWidth().clickable { showModelMenu = true },
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Row(modifier = Modifier.padding(10.dp)) {
                        val selectedLabel = state.availableModels.find { it.id == state.model }?.label ?: state.model
                        Text(selectedLabel, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        Text("▼", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                    }
                }
                DropdownMenu(expanded = showModelMenu, onDismissRequest = { showModelMenu = false }) {
                    state.availableModels.forEach { model ->
                        DropdownMenuItem(
                            text = { Text(model.label.ifEmpty { model.id }, fontSize = 12.sp) },
                            onClick = {
                                component.onModelChanged(model.id)
                                showModelMenu = false
                            },
                        )
                    }
                    if (state.availableModels.isEmpty()) {
                        DropdownMenuItem(text = { Text("Loading...", fontSize = 12.sp) }, onClick = {})
                    }
                }
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            FormLabel("Effort")
            ChipRow(
                options = Effort.entries.map { it.displayLabel } + "auto",
                selected = state.effort?.displayLabel ?: "auto",
                onSelect = { label ->
                    if (label == "auto") component.onEffortChanged(null)
                    else Effort.entries.find { it.displayLabel == label }?.let { component.onEffortChanged(it) }
                },
            )
        }
    }

    // Permission Mode
    FormField("Permission Mode") {
        ChipRow(
            options = PermissionMode.entries.map { it.displayLabel },
            selected = state.permissionMode.displayLabel,
            onSelect = { label ->
                PermissionMode.entries.find { it.displayLabel == label }?.let { component.onPermissionChanged(it) }
            },
        )
    }

    // Skill (dropdown picker)
    FormField("Skill") {
        Box {
            OutlinedCard(
                modifier = Modifier.fillMaxWidth().clickable { showSkillMenu = true },
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(modifier = Modifier.padding(10.dp)) {
                    val skillName = state.availableSkills.find { it.id == state.skillId }?.name ?: "None"
                    Text(
                        skillName,
                        fontSize = 12.sp,
                        color = if (state.skillId != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text("\u25BC", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                }
            }
            DropdownMenu(expanded = showSkillMenu, onDismissRequest = { showSkillMenu = false }) {
                DropdownMenuItem(
                    text = { Text("None", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = { component.onSkillChanged(null); showSkillMenu = false },
                )
                state.availableSkills.forEach { skill ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(skill.name, fontSize = 12.sp, maxLines = 1)
                                Text(skill.description, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                            }
                        },
                        onClick = { component.onSkillChanged(skill.id); showSkillMenu = false },
                    )
                }
            }
        }
    }

    // Specs (with picker dialog)
    FormField(
        "Specs",
        trailing = {
            Text(
                "+ Add",
                color = BonsaiGreen,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { showSpecPicker = true },
            )
        },
    ) {
        if (state.specIds.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.specIds.forEach { specId ->
                    InputChip(
                        selected = true,
                        onClick = { component.removeSpec(specId) },
                        label = { Text(specId, fontSize = 9.sp) },
                        trailingIcon = { Text("✕", fontSize = 8.sp) },
                    )
                }
            }
        } else {
            Text("No specs selected", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    // Spec picker dialog
    if (showSpecPicker) {
        AlertDialog(
            onDismissRequest = { showSpecPicker = false },
            title = { Text("Select Specs", fontSize = 14.sp) },
            text = {
                Column(modifier = Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState())) {
                    if (state.availableSpecs.isEmpty()) {
                        Text("No specs available", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    state.availableSpecs.forEach { spec ->
                        val isSelected = spec.id in state.specIds
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (isSelected) component.removeSpec(spec.id) else component.addSpec(spec.id)
                                }
                                .padding(vertical = 6.dp),
                            verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = isSelected, onCheckedChange = { checked ->
                                if (checked) component.addSpec(spec.id) else component.removeSpec(spec.id)
                            })
                            Column(modifier = Modifier.padding(start = 4.dp)) {
                                Text(spec.title.ifEmpty { spec.id }, fontSize = 12.sp, maxLines = 1)
                                Text(spec.type, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showSpecPicker = false }) { Text("Done") } },
        )
    }

    // Files (with add dialog)
    FormField(
        "Files",
        trailing = {
            Text(
                "+ Add",
                color = BonsaiGreen,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clickable { showFileInput = true },
            )
        },
    ) {
        if (state.filePaths.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                state.filePaths.forEach { path ->
                    InputChip(
                        selected = true,
                        onClick = { component.removeFile(path) },
                        label = { Text(path.substringAfterLast("/"), fontSize = 9.sp) },
                        trailingIcon = { Text("✕", fontSize = 8.sp) },
                    )
                }
            }
        } else {
            Text("No files selected", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }

    // File picker dialog
    if (showFileInput) {
        AlertDialog(
            onDismissRequest = { showFileInput = false; fileSearchQuery = "" },
            title = { Text("Select Files", fontSize = 14.sp) },
            text = {
                Column {
                    OutlinedTextField(
                        value = fileSearchQuery,
                        onValueChange = { fileSearchQuery = it },
                        placeholder = { Text("Search files...", fontSize = 12.sp) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    val filtered = state.availableFiles.filter {
                        fileSearchQuery.isBlank() || it.path.contains(fileSearchQuery, ignoreCase = true)
                    }.take(100)
                    Column(modifier = Modifier.heightIn(max = 300.dp).verticalScroll(rememberScrollState())) {
                        if (state.availableFiles.isEmpty()) {
                            Text("Loading files...", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        } else if (filtered.isEmpty()) {
                            Text("No matching files", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        filtered.forEach { file ->
                            val isSelected = file.path in state.filePaths
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        if (isSelected) component.removeFile(file.path) else component.addFile(file.path)
                                    }
                                    .padding(vertical = 4.dp),
                                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            ) {
                                Checkbox(checked = isSelected, onCheckedChange = { checked ->
                                    if (checked) component.addFile(file.path) else component.removeFile(file.path)
                                })
                                Text(file.path, fontSize = 11.sp, maxLines = 1, modifier = Modifier.padding(start = 4.dp))
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showFileInput = false; fileSearchQuery = "" }) { Text("Done") } },
        )
    }

    // Linked Ticket (dropdown)
    FormField("Linked Ticket") {
        Box {
            OutlinedCard(
                modifier = Modifier.fillMaxWidth().clickable { showTicketMenu = true },
                shape = RoundedCornerShape(8.dp),
            ) {
                Row(modifier = Modifier.padding(10.dp)) {
                    val ticketName = state.availableTickets.find { it.id == state.linkedTicketId }?.title ?: "None"
                    Text(
                        ticketName,
                        fontSize = 12.sp,
                        color = if (state.linkedTicketId != null) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                    )
                    Text("▼", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
                }
            }
            DropdownMenu(expanded = showTicketMenu, onDismissRequest = { showTicketMenu = false }) {
                DropdownMenuItem(
                    text = { Text("None", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) },
                    onClick = { component.onTicketChanged(null); showTicketMenu = false },
                )
                state.availableTickets.forEach { ticket ->
                    DropdownMenuItem(
                        text = { Text(ticket.title, fontSize = 12.sp, maxLines = 1) },
                        onClick = { component.onTicketChanged(ticket.id); showTicketMenu = false },
                    )
                }
            }
        }
    }

    Spacer(modifier = Modifier.height(16.dp))
}

@Composable
private fun PreviewContent(component: NewSessionComponent, state: dev.aiir.bonsai.component.session.NewSessionState) {
    // Token summary
    Card(
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = BonsaiGreen.copy(alpha = 0.06f)),
        border = androidx.compose.foundation.BorderStroke(1.dp, BonsaiGreen.copy(alpha = 0.12f)),
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text("System Prompt · ${state.totalTokens} tokens", fontWeight = FontWeight.Bold, fontSize = 12.sp)
            Spacer(modifier = Modifier.height(8.dp))
            TokenBreakdownBar(
                segments = state.sections.mapIndexed { i, section ->
                    val colors = listOf(BonsaiGreen, StatusQuestion, StatusWaiting, Color(0xFF9C27B0), StatusDone)
                    TokenSegment(label = section.label, tokens = section.tokens, color = colors[i % colors.size])
                },
                totalTokens = state.totalTokens,
            )
        }
    }

    Spacer(modifier = Modifier.height(12.dp))

    // Expandable sections
    Text("PROMPT SECTIONS", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Spacer(modifier = Modifier.height(6.dp))

    state.sections.forEach { section ->
        var expanded by remember { mutableStateOf(false) }
        OutlinedCard(
            modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp),
            shape = RoundedCornerShape(6.dp),
            onClick = { expanded = !expanded },
        ) {
            Column(modifier = Modifier.padding(10.dp)) {
                Row {
                    Text(if (expanded) "▼" else "▶", fontSize = 10.sp)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(section.label, fontWeight = FontWeight.Bold, fontSize = 11.sp, modifier = Modifier.weight(1f))
                    Text("${section.tokens} tok", fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (expanded) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = section.content.take(500) + if (section.content.length > 500) "..." else "",
                        fontSize = 9.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 13.sp,
                    )
                }
            }
        }
    }

    Spacer(modifier = Modifier.height(16.dp))
}

// ── Reusable form helpers ──

@Composable
private fun FormField(
    label: String,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.padding(bottom = 12.dp)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            FormLabel(label, modifier = Modifier.weight(1f))
            trailing?.invoke()
        }
        Spacer(modifier = Modifier.height(3.dp))
        content()
    }
}

@Composable
private fun FormLabel(label: String, modifier: Modifier = Modifier) {
    Text(label, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier)
}

@Composable
private fun ChipRow(options: List<String>, selected: String, onSelect: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        options.forEach { option ->
            val isSelected = selected == option
            FilterChip(
                selected = isSelected,
                onClick = { onSelect(option) },
                label = { Text(option, fontSize = 9.sp) },
                modifier = Modifier.height(28.dp),
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = BonsaiGreen,
                    selectedLabelColor = Color.White,
                ),
            )
        }
    }
}

@Composable
private fun FlowRow(
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Start,
    verticalArrangement: Arrangement.Vertical = Arrangement.Top,
    content: @Composable () -> Unit,
) {
    androidx.compose.foundation.layout.FlowRow(
        horizontalArrangement = horizontalArrangement,
        verticalArrangement = verticalArrangement,
    ) { content() }
}
