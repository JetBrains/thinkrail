# Bonsai Visualization System

## Overview

The Bonsai visualization system provides an **auto-updating, interactive graph** of design specifications using a **hooks-based static HTML approach**. This eliminates the need for servers, WebSockets, or complex build processes while still providing real-time visual feedback during the design process.

## Architecture: Hooks-Based Static HTML

### Core Concept

Instead of a server + WebSocket architecture, we use **Claude Code hooks** to regenerate a static HTML file whenever specs are created or modified. The browser auto-refreshes to show updates.

```
User runs /bonsai:design
    ↓
Agent creates spec files in bonsai/
    ↓
PostToolUse hook triggers (on file write)
    ↓
generate-graph.ts runs:
    - Scans bonsai/ directory
    - Parses all .md files
    - Extracts dependencies from markdown links
    - Builds graph data structure
    - Generates self-contained HTML file
    ↓
Writes bonsai/graph.html
    ↓
Browser auto-refreshes (via <meta> tag or LiveServer)
    ↓
User sees updated graph
```

### Benefits

1. **No server required** - Pure static HTML
2. **Simple deployment** - Just Node.js + single script
3. **Auto-refresh** - Browser updates automatically
4. **Offline capable** - Works without network
5. **Lightweight** - Single HTML file with inline JS
6. **Easy debugging** - Inspect generated HTML directly
7. **Version controllable** - HTML file can be committed

## Implementation

### Directory Structure

```
bonsai/
├── .claude/
│   └── hooks.json                    # Hook configuration
├── visualizer/
│   ├── package.json
│   ├── generate-graph.ts             # Main generator script
│   ├── spec-parser.ts                # Parse bonsai/ markdown files
│   ├── graph-builder.ts              # Build Cytoscape.js data
│   ├── template.html                 # HTML template
│   └── README.md
└── bonsai/                           # Generated during design
    ├── graph.html                    # Generated visualization
    ├── .design-progress.md           # Progress tracking
    └── *.md                          # Spec files
```

### Hook Configuration

**File: `.claude/hooks.json`**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "name": "bonsai-visualizer",
        "tool": "write_file",
        "condition": "path.includes('bonsai/') && path.endsWith('.md')",
        "command": "node visualizer/dist/generate-graph.js",
        "description": "Regenerate visualization graph when bonsai specs change"
      }
    ]
  }
}
```

**How it works:**
- Triggers **after** any file write in `bonsai/` directory
- Only runs for `.md` files (specs and progress)
- Executes `dist/generate-graph.js` to rebuild visualization
- Non-blocking - agent continues while graph regenerates

### Spec Parser

**File: `visualizer/spec-parser.ts`**

Parses `bonsai/` directory to extract spec information:

```typescript
interface BonsaiSpec {
  id: string;              // Unique ID (normalized file path)
  name: string;            // Display name (from H1 or filename)
  path: string;            // Relative path from .bonsai/
  filePath: string;        // Absolute file path
  description?: string;    // Brief overview (first paragraph)
  dependencies: string[];  // Internal links to other specs
  parent?: string;         // Parent spec (from directory structure)
  children: string[];      // Child specs (compound spec pattern)
  type: 'system' | 'component' | 'module';  // Inferred from location
  status?: 'complete' | 'in-progress' | 'pending';  // From progress file
}

async function parseSpecs(bonsaiDir: string): Promise<BonsaiSpec[]> {
  // 1. Recursively scan bonsai/ for .md files (exclude .design-progress.md)
  // 2. For each file:
  //    - Read content
  //    - Extract H1 as name
  //    - Extract first paragraph as description
  //    - Find all markdown links: [text](./path.md)
  //    - Resolve relative paths to absolute spec IDs
  //    - Determine parent from directory structure
  //    - Find children (files in matching subdirectory)
  // 3. Parse .design-progress.md to get status for each spec
  // 4. Return array of BonsaiSpec objects
}
```

**Dependency Extraction:**

```typescript
// Parse markdown links to find dependencies
function extractDependencies(markdown: string, currentPath: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
  const deps: string[] = [];

  let match;
  while ((match = linkRegex.exec(markdown)) !== null) {
    const linkPath = match[2];

    // Resolve relative paths
    const absolutePath = path.resolve(
      path.dirname(currentPath),
      linkPath
    );

    deps.push(normalizeSpecId(absolutePath));
  }

  return deps;
}
```

### Graph Builder

**File: `visualizer/graph-builder.ts`**

Converts specs into Cytoscape.js format:

```typescript
interface GraphData {
  nodes: Array<{
    data: {
      id: string;
      label: string;
      type: string;
      description?: string;
      path: string;
      status?: string;
    };
  }>;
  edges: Array<{
    data: {
      id: string;
      source: string;
      target: string;
      type: 'dependency' | 'parent-child';
    };
  }>;
}

function buildGraph(specs: BonsaiSpec[]): GraphData {
  const nodes = specs.map(spec => ({
    data: {
      id: spec.id,
      label: spec.name,
      type: spec.type,
      description: spec.description,
      path: spec.path,
      status: spec.status
    }
  }));

  const edges: GraphData['edges'] = [];

  // Add dependency edges
  specs.forEach(spec => {
    spec.dependencies.forEach(depId => {
      edges.push({
        data: {
          id: `${spec.id}->${depId}`,
          source: spec.id,
          target: depId,
          type: 'dependency'
        }
      });
    });

    // Add parent-child edges
    if (spec.parent) {
      edges.push({
        data: {
          id: `${spec.parent}->${spec.id}`,
          source: spec.parent,
          target: spec.id,
          type: 'parent-child'
        }
      });
    }
  });

  return { nodes, edges };
}
```

### HTML Template

**File: `visualizer/template.html`**

Self-contained HTML with inline Cytoscape.js:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="2">  <!-- Auto-refresh every 2 seconds -->
  <title>Bonsai Design Graph</title>
  <script src="https://unpkg.com/cytoscape@3.28.1/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
  <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1e1e1e;
      color: #d4d4d4;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    header {
      background: #252526;
      padding: 12px 20px;
      border-bottom: 1px solid #3c3c3c;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
    }

    .stats {
      font-size: 13px;
      color: #858585;
    }

    .controls {
      display: flex;
      gap: 10px;
      padding: 10px 20px;
      background: #2d2d30;
      border-bottom: 1px solid #3c3c3c;
    }

    button {
      background: #0e639c;
      color: white;
      border: none;
      padding: 6px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }

    button:hover {
      background: #1177bb;
    }

    #cy {
      flex: 1;
      background: #1e1e1e;
    }

    .info-panel {
      position: absolute;
      right: 20px;
      top: 100px;
      width: 300px;
      background: #252526;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
      padding: 15px;
      display: none;
    }

    .info-panel.visible {
      display: block;
    }

    .info-panel h3 {
      margin: 0 0 10px 0;
      font-size: 14px;
      color: #4ec9b0;
    }

    .info-panel p {
      margin: 5px 0;
      font-size: 12px;
      line-height: 1.5;
    }

    .status-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .status-complete { background: #4ec9b0; color: #000; }
    .status-in-progress { background: #ce9178; color: #000; }
    .status-pending { background: #858585; color: #fff; }
  </style>
</head>
<body>
  <header>
    <h1>🌳 Bonsai Design Graph</h1>
    <div class="stats">
      <span id="node-count">0 components</span> |
      <span id="edge-count">0 connections</span> |
      <span id="last-update">Updated: now</span>
    </div>
  </header>

  <div class="controls">
    <button onclick="cy.fit()">Fit to View</button>
    <button onclick="cy.zoom(cy.zoom() * 1.2)">Zoom In</button>
    <button onclick="cy.zoom(cy.zoom() / 1.2)">Zoom Out</button>
    <button onclick="cy.layout({ name: 'dagre', rankDir: 'TB' }).run()">Hierarchical</button>
    <button onclick="cy.layout({ name: 'circle' }).run()">Circular</button>
    <button onclick="cy.layout({ name: 'grid' }).run()">Grid</button>
  </div>

  <div id="cy"></div>

  <div class="info-panel" id="info-panel">
    <h3 id="info-title">Select a node</h3>
    <p id="info-description"></p>
    <p><strong>Path:</strong> <span id="info-path"></span></p>
    <p><strong>Status:</strong> <span id="info-status"></span></p>
    <p><strong>Dependencies:</strong> <span id="info-deps"></span></p>
  </div>

  <script>
    // GRAPH_DATA will be injected here by generator
    const graphData = {{GRAPH_DATA}};

    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements: graphData,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'font-size': '12px',
            'color': '#d4d4d4',
            'background-color': function(ele) {
              const type = ele.data('type');
              const status = ele.data('status');

              if (status === 'in-progress') return '#ce9178';
              if (status === 'complete') return '#4ec9b0';

              if (type === 'system') return '#569cd6';
              if (type === 'module') return '#dcdcaa';
              return '#4ec9b0';
            },
            'border-width': 2,
            'border-color': '#3c3c3c',
            'width': 60,
            'height': 60,
            'text-wrap': 'wrap',
            'text-max-width': '80px'
          }
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#007acc',
            'border-width': 3
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 2,
            'line-color': function(ele) {
              return ele.data('type') === 'parent-child' ? '#858585' : '#569cd6';
            },
            'target-arrow-color': function(ele) {
              return ele.data('type') === 'parent-child' ? '#858585' : '#569cd6';
            },
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'line-style': function(ele) {
              return ele.data('type') === 'parent-child' ? 'dashed' : 'solid';
            }
          }
        }
      ],
      layout: {
        name: 'dagre',
        rankDir: 'TB',
        padding: 50
      }
    });

    // Update stats
    document.getElementById('node-count').textContent =
      cy.nodes().length + ' components';
    document.getElementById('edge-count').textContent =
      cy.edges().length + ' connections';
    document.getElementById('last-update').textContent =
      'Updated: ' + new Date().toLocaleTimeString();

    // Node click handler
    cy.on('tap', 'node', function(evt) {
      const node = evt.target;
      const data = node.data();

      document.getElementById('info-panel').classList.add('visible');
      document.getElementById('info-title').textContent = data.label;
      document.getElementById('info-description').textContent =
        data.description || 'No description available';
      document.getElementById('info-path').textContent = data.path;

      const status = data.status || 'pending';
      document.getElementById('info-status').innerHTML =
        `<span class="status-badge status-${status}">${status}</span>`;

      const deps = cy.edges(`[source="${data.id}"]`)
        .map(e => cy.getElementById(e.data('target')).data('label'))
        .join(', ') || 'None';
      document.getElementById('info-deps').textContent = deps;
    });

    // Click background to hide info panel
    cy.on('tap', function(evt) {
      if (evt.target === cy) {
        document.getElementById('info-panel').classList.remove('visible');
      }
    });
  </script>
</body>
</html>
```

### Generator Script

**File: `visualizer/generate-graph.ts`**

Main script that ties everything together:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parseSpecs } from './spec-parser';
import { buildGraph } from './graph-builder';

const BONSAI_DIR = path.join(process.cwd(), 'bonsai');
const OUTPUT_FILE = path.join(BONSAI_DIR, 'graph.html');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');

async function generateGraph() {
  try {
    // Check if bonsai directory exists
    if (!fs.existsSync(BONSAI_DIR)) {
      console.log('No bonsai directory found, skipping visualization');
      return;
    }

    // Parse all specs
    console.log('Parsing specifications...');
    const specs = await parseSpecs(BONSAI_DIR);

    if (specs.length === 0) {
      console.log('No specs found yet, skipping visualization');
      return;
    }

    // Build graph data
    console.log(`Building graph from ${specs.length} specs...`);
    const graphData = buildGraph(specs);

    // Read template
    const template = fs.readFileSync(TEMPLATE_FILE, 'utf-8');

    // Inject graph data
    const html = template.replace(
      '{{GRAPH_DATA}}',
      JSON.stringify(graphData, null, 2)
    );

    // Write output
    fs.writeFileSync(OUTPUT_FILE, html);
    console.log(`✓ Graph generated: ${OUTPUT_FILE}`);
    console.log(`  Nodes: ${graphData.nodes.length}`);
    console.log(`  Edges: ${graphData.edges.length}`);

  } catch (error) {
    console.error('Error generating graph:', error);
    process.exit(1);
  }
}

generateGraph();
```

## Usage

### Setup

1. **Install dependencies:**

```bash
cd visualizer
npm install
npm run build
```

2. **Configure hooks:**

Create `.claude/hooks.json` (see Hook Configuration above)

3. **Start design session:**

```bash
# In Claude Code
/bonsai:design my project
```

4. **Open visualization:**

```bash
# Manual open (or use LiveServer extension)
open bonsai/graph.html

# Or with LiveServer (auto-refresh)
npx live-server bonsai --port=8080 --entry-file=graph.html
```

### During Design

As the agent creates specs, the hook automatically triggers:

```
Agent writes: bonsai/server-api.md
    ↓
Hook triggers: node visualizer/dist/generate-graph.js
    ↓
Graph regenerated: bonsai/graph.html
    ↓
Browser refreshes (if using LiveServer or meta refresh)
    ↓
New node appears in graph
```

## Features

### Visual Elements

**Node Colors:**
- **Blue** (#569cd6) - System/MAIN specs
- **Yellow** (#dcdcaa) - Module specs
- **Green** (#4ec9b0) - Component specs
- **Orange** (#ce9178) - In-progress (from .design-progress.md)

**Edge Styles:**
- **Solid blue arrows** - Dependencies (→ depends on)
- **Dashed gray lines** - Parent-child hierarchy

**Status Badges:**
- **Complete** - Green badge
- **In Progress** - Orange badge
- **Pending** - Gray badge

### Interactive Features

1. **Click node** - Show details panel with description, path, dependencies
2. **Zoom controls** - Zoom in/out, fit to view
3. **Layout options** - Hierarchical (dagre), circular, grid
4. **Auto-refresh** - Updates every 2 seconds (meta tag) or via LiveServer
5. **Responsive** - Adapts to window size

### Progress Integration

The visualization reads `.design-progress.md` to show real-time status:

```markdown
## Step 2: Core Design [IN PROGRESS]
### Component Status:
- [✓] backend-api (bonsai/backend-api.md) - Completed
- [○] database-schema (bonsai/database-schema.md) - In progress
- [ ] frontend-ui
```

Graph shows:
- `backend-api` - Green (complete)
- `database-schema` - Orange (in progress)
- `frontend-ui` - Gray (pending)

## Example Visualization

For the ping-pong server example from README-CLAUDE.md:

```
     [MAIN.md]
         |
    ┌────┴────┬────────┬────────┐
    |         |        |        |
[server-api] [auth]  [db]   [client]
    |         |        |
    └────┬────┘        |
         |             |
    [depends on]  [depends on]
```

**Interactive Graph Shows:**
- 5 nodes (MAIN, server-api, authentication-module, database-schema, cli-client)
- Dependency edges connecting them
- Hierarchical layout with MAIN at top
- Status colors showing progress
- Click any node to see full details

## Troubleshooting

### Hook not triggering

Check `.claude/hooks.json` is valid:
```bash
cat .claude/hooks.json | jq .
```

Verify hook is registered:
```bash
# In Claude Code
/hooks list
```

### Graph not updating

1. Check hook executed:
```bash
# Look for hook output in Claude Code terminal
```

2. Manually regenerate:
```bash
node visualizer/dist/generate-graph.js
```

3. Verify output file exists:
```bash
ls -la bonsai/graph.html
```

### Browser not refreshing

**Option 1: Meta refresh (built-in)**
- HTML has `<meta http-equiv="refresh" content="2">`
- Browser auto-refreshes every 2 seconds

**Option 2: LiveServer (recommended)**
```bash
npx live-server bonsai --port=8080 --entry-file=graph.html
```
- Watches file changes
- Instant refresh via WebSocket
- No polling needed

**Option 3: Browser extension**
- Install "Auto Refresh" extension
- Set refresh interval to 2-3 seconds

## Advantages Over WebSocket Approach

| Feature | Hooks + Static HTML | WebSocket Server |
|---------|-------------------|------------------|
| **Complexity** | Low (single script) | High (server + client) |
| **Dependencies** | Minimal (Node.js only) | Many (MCP SDK, WS, React) |
| **Setup** | 1 hook config | Server config + build process |
| **Maintenance** | Simple file generation | Server management + state sync |
| **Debugging** | Inspect HTML file | Debug WebSocket + React |
| **Offline** | Works offline | Requires server running |
| **Version Control** | HTML can be committed | Server code + client code |
| **Performance** | Instant generation | Server overhead |

## Future Enhancements

1. **Diff Visualization** - Show changes since last session
2. **Export Options** - Save as PNG/SVG
3. **Filter Controls** - Show/hide by type or status
4. **Search** - Find specific components
5. **Zoom to Node** - Click link in spec to highlight in graph
6. **Timeline View** - Show how graph evolved over time
7. **Metrics** - Display complexity metrics on nodes
8. **Custom Layouts** - Save preferred layout per project