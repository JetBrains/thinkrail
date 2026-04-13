package dev.aiir.bonsai.android.ui.screen

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.aiir.bonsai.android.ui.component.TypeBadge
import dev.aiir.bonsai.android.ui.theme.BonsaiGreen
import dev.aiir.bonsai.android.ui.theme.StatusDone
import dev.aiir.bonsai.android.ui.theme.StatusWaiting
import dev.aiir.bonsai.component.ticket.TicketDetailComponent
import dev.aiir.bonsai.data.model.MetaTicketStatus
import dev.aiir.bonsai.data.model.PlanStep
import dev.aiir.bonsai.data.model.StepStatus

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TicketDetailScreen(component: TicketDetailComponent) {
    val state by component.state.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(onClick = { component.onBack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                title = {
                    Text(
                        text = state.ticket?.title ?: "Ticket",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                },
            )
        },
    ) { padding ->
        if (state.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { CircularProgressIndicator() }
        } else if (state.error != null) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center,
            ) { Text(state.error!!, color = MaterialTheme.colorScheme.error) }
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val ticket = state.ticket ?: return@Scaffold

                // Header: type badge + status
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TypeBadge(type = ticket.type)
                    StatusBadge(status = ticket.status)
                }

                // Body
                if (ticket.body.isNotBlank()) {
                    Card(
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                    ) {
                        Text(
                            text = ticket.body,
                            modifier = Modifier.padding(12.dp),
                            fontSize = 13.sp,
                            lineHeight = 18.sp,
                        )
                    }
                }

                // Linked specs
                if (ticket.linkedSpecIds.isNotEmpty()) {
                    SectionHeader("Specs (${ticket.linkedSpecIds.size})")
                    ticket.linkedSpecIds.forEach { specId ->
                        Text(specId, fontSize = 11.sp, color = BonsaiGreen)
                    }
                }

                // Linked sessions
                if (ticket.sessionIds.isNotEmpty()) {
                    SectionHeader("Sessions (${ticket.sessionIds.size})")
                    ticket.sessionIds.forEach { sid ->
                        Text(sid.take(12), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }

                // Plan
                val plan = state.plan
                if (plan != null && plan.steps.isNotEmpty()) {
                    SectionHeader("Plan (${plan.steps.size} steps)")
                    plan.steps.forEachIndexed { index, step ->
                        PlanStepRow(index + 1, step)
                    }
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        text = title.uppercase(),
        fontSize = 10.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun StatusBadge(status: MetaTicketStatus) {
    val color = when (status) {
        MetaTicketStatus.DONE -> StatusDone
        MetaTicketStatus.EXECUTING -> BonsaiGreen
        MetaTicketStatus.PLANNED -> StatusWaiting
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(
        shape = RoundedCornerShape(4.dp),
        color = color.copy(alpha = 0.15f),
    ) {
        Text(
            text = status.name.lowercase(),
            fontSize = 9.sp,
            color = color,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

@Composable
private fun PlanStepRow(number: Int, step: PlanStep) {
    val icon = when (step.status) {
        StepStatus.DONE -> "\u2713"
        StepStatus.IN_PROGRESS -> "\u27F3"
        else -> "\u25CB"
    }
    val color = when (step.status) {
        StepStatus.DONE -> StatusDone
        StepStatus.IN_PROGRESS -> BonsaiGreen
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    Row(
        modifier = Modifier.padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(icon, fontSize = 12.sp, color = color)
        Column {
            Text("$number. ${step.title}", fontSize = 12.sp, fontWeight = FontWeight.Medium)
            if (step.description.isNotBlank()) {
                Text(step.description, fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
