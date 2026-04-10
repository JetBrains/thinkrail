package dev.aiir.bonsai.android.ui.component.vis

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.serialization.json.*

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MermaidDiagramCard(data: JsonObject, modifier: Modifier = Modifier) {
    val definition = remember(data) {
        data["definition"]?.jsonPrimitive?.content
            ?: data["diagram"]?.jsonPrimitive?.content
            ?: toMermaidSyntax(data)
    }

    AndroidView(
        modifier = modifier.fillMaxWidth().heightIn(min = 120.dp, max = 400.dp),
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                settings.loadWithOverviewMode = true
                settings.useWideViewPort = true
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                webViewClient = WebViewClient()
                loadUrl("file:///android_res/raw/mermaid_renderer.html")
            }
        },
        update = { webView ->
            val escaped = definition.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
            webView.evaluateJavascript("renderDiagram(\"$escaped\")", null)
        },
    )
}

private fun toMermaidSyntax(data: JsonObject): String {
    val nodes = data["nodes"]?.jsonArray ?: return ""
    val edges = data["edges"]?.jsonArray ?: return ""
    val layout = data["layout"]?.jsonPrimitive?.content
    val direction = if (layout == "left-to-right") "LR" else "TD"

    val lines = mutableListOf("graph $direction")
    nodes.forEach { nodeEl ->
        val node = nodeEl.jsonObject
        val id = node["id"]?.jsonPrimitive?.content ?: return@forEach
        val label = node["label"]?.jsonPrimitive?.content ?: id
        val escaped = label.replace("\"", "#quot;")
        lines.add("  $id[\"$escaped\"]")
    }
    edges.forEach { edgeEl ->
        val edge = edgeEl.jsonObject
        val from = edge["from"]?.jsonPrimitive?.content ?: return@forEach
        val to = edge["to"]?.jsonPrimitive?.content ?: return@forEach
        val edgeLabel = edge["label"]?.jsonPrimitive?.content
        if (edgeLabel != null) {
            val escaped = edgeLabel.replace("\"", "#quot;")
            lines.add("  $from -->|$escaped| $to")
        } else {
            lines.add("  $from --> $to")
        }
    }
    return lines.joinToString("\n")
}
