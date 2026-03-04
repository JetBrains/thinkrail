* Global bottom status bar

    - [ ] "**45** sessions need attention" —- counter has to be up-to-date
    - [ ] "1 need attention" should be clickable -> choose ...
    - [ ] count money (globally spend on the project) on the fly

* Chat
    - [ ] Visualize plan and display progress
    - [ ] It can ask questions and do something at the same time. As a result "AskUserQuestion" or approval requests "slips upwards in history" or can appear simultaneously rather than being focused and displayed (ex. as in claude code)
    - [ ] I think we have to group tool calls and tasks somehow
    - [ ] add "don't ask approval again for ..."
    - [ ] send message should always be active?
    - [ ] add interrupt
    - [ ] on approval "denied" agent stuck
    - [ ] should always has "other" in AskUserQuestions
    - [ ] add something like "agent is thinking..." which tracks that agent is not stuck and displays user that "work is in progress"
    - [ ] for each tool show the directory it is being executed from 
    - [ ] "plan mode exit" should be separately handled. Now it looks like "unstructured tool result":
        ```
        Action requires approval
        ExitPlanMode{ "allowedPrompts": [ { "tool": "Bash", "prompt": "initialize npm project and install dependencies" }, { "tool": "Bash", "prompt": "run dev server for testing" }, { "tool": "Bash", "prompt": "run tests with vitest" }, { "tool": "Bash", "prompt": "create directories for project structure" } ], "plan": "# PDF Toolkit Web Service — Implementation Plan\n\n## Context\n\nBuild a comprehensive PDF toolkit REST API from scratch in a new TypeScript/Node.js project. The service handles PDF generation, parsing/extraction, and manipulation — all in-memory (no server-side file storage). The API is documented via auto-generated OpenAPI/Swagger.\n\n**Stack**: Hono + @hono/zod-openapi + Swagger UI + PDFKit + pdfjs-dist + pdf-lib\n**Project root**: `/home/danya/bonsai-demo/` (empty project)\n\n---\n\n## API Endpoints\n\n### Generation\n| Endpoint | Description |\n|---|---|\n| `POST /api/pdf/generate/from-text` | Generate PDF from plain text |\n| `POST /api/pdf/generate/from-html` | Generate PDF from HTML (Puppeteer if available, else plain-text fallback) |\n| `POST /api/pdf/generate/from-template` | Generate PDF from predefined templates (invoice, report, letter) with data |\n\n### Extraction\n| Endpoint | Description |\n|---|---|\n| `POST /api/pdf/extract/text` | Extract text per-page from uploaded PDF |\n| `POST /api/pdf/extract/metadata` | Extract title, author, page count, etc. |\n| `POST /api/pdf/extract/pages` | Extract specific page range as new PDF |\n| `POST /api/pdf/extract/images` | Extract embedded images |\n\n### Manipulation\n| Endpoint | Description |\n|---|---|\n| `POST /api/pdf/merge` | Merge multiple PDFs into one |\n| `POST /api/pdf/split` | Split PDF into ranges |\n| `POST /api/pdf/rotate` | Rotate pages |\n| `POST /api/pdf/watermark` | Add text watermark |\n| `POST /api/pdf/compress` | Re-serialize to reduce size |\n| `POST /api/pdf/protect` | Add password protection |\n\n### Infrastructure\n| Endpoint | Description |\n|---|---|\n| `GET /health` | Health check |\n| `GET /doc` | OpenAPI JSON spec |\n| `GET /docs` | Swagger UI |\n\n---\n\n## Directory Structure\n\n```\nsrc/\n├── index.ts # Entry: starts Hono server via @hono/node-server\n├── app.ts # OpenAPIHono assembly, middleware, doc routes\n├── config.ts # Port, file size limits, etc.\n├── schemas/\n│ ├── common.ts # ErrorSchema, FileUploadSchema\n│ ├── generation.ts # Request/response schemas for /generate/*\n│ ├── extraction.ts # Schemas for /extract/*\n│ └── manipulation.ts # Schemas for /merge, /split, etc.\n├── routes/ # createRoute() definitions (declarative, no logic)\n│ ├── health.route.ts\n│ ├── generation/ # from-html, from-template, from-text\n│ ├── extraction/ # text, metadata, pages, images\n│ └── manipulation/ # merge, split, rotate, watermark, compress, protect\n├── handlers/ # Request handlers (call services, return responses)\n│ ├── health.handler.ts\n│ ├── generation/\n│ ├── extraction/\n│ └── manipulation/\n├── services/ # Pure PDF logic (library wrappers)\n│ ├── pdfkit.service.ts # PDFKit — generation\n│ ├── pdfjs.service.ts # pdfjs-dist — text extraction, metadata\n│ ├── pdflib.service.ts # pdf-lib — merge, split, rotate, watermark, pages\n│ └── html-renderer.service.ts # Puppeteer (optional) or PDFKit fallback\n├── templates/ # Predefined PDF templates\n│ ├── invoice.template.ts\n│ ├── report.template.ts\n│ ├── letter.template.ts\n│ └── index.ts # Template registry\n├── middleware/\n│ ├── error-handler.ts # Global error handler\n│ ├── request-id.ts # X-Request-Id header\n│ └── file-size-limit.ts # Max upload size enforcement\n└── utils/\n ├── errors.ts # PdfProcessingError, FileTooLargeError classes\n ├── pdf-helpers.ts # Buffer/Uint8Array conversions\n ├── response-builders.ts # Helpers for PDF binary responses\n └── logger.ts # Structured logging\ntests/\n├── setup.ts # Test app factory using app.request()\n├── fixtures/ # sample.pdf, multi-page.pdf, with-images.pdf\n├── unit/services/ # Unit tests for each service\n└── integration/ # Endpoint tests for each route group\n```\n\n---\n\n## Key Architecture Decisions\n\n1. **Three PDF libraries** — No single JS library covers all cases:\n - **PDFKit**: Rich generation API (fonts, images, layout)\n - **pdfjs-dist**: Best-in-class text extraction (Mozilla's PDF.js engine)\n - **pdf-lib**: Structural manipulation of existing PDFs (copy pages, rotate, embed)\n\n2. **Route → Handler → Service layering** — Routes are pure `createRoute()` declarations (OpenAPI schema). Handlers orchestrate request parsing and response building. Services contain pure PDF logic with `Buffer` in / `Buffer | Uint8Array` out — no framework dependency.\n\n3. **Puppeteer is optional** — HTML-to-PDF falls back to PDFKit plain-text rendering when Puppeteer isn't installed. Avoids the 300MB Chromium download for environments that don't need true HTML rendering.\n\n4. **In-memory only** — All PDFs flow through `Buffer`/`Uint8Array`. A configurable file-size-limit middleware (default 50MB) prevents OOM.\n\n5. **pdf-lib encryption** — Standard pdf-lib can't encrypt. We use the `pdf-lib` encrypt API (`PDFDocument.save({ userPassword, ownerPassword })`) for password protection.\n\n---\n\n## Dependencies\n\n### Production\n- `hono`, `@hono/node-server`, `@hono/zod-openapi`, `@hono/swagger-ui`, `zod`\n- `pdfkit` (generation)\n- `pdfjs-dist` (extraction)\n- `pdf-lib` (manipulation)\n\n### Dev\n- `typescript`, `tsx`, `@types/node`, `@types/pdfkit`\n- `vitest`, `@vitest/coverage-v8`\n\n### Optional\n- `puppeteer` (true HTML-to-PDF rendering)\n\n---\n\n## Implementation Phases\n\n### Phase 1: Project Scaffold\n1. `npm init`, install deps, create `tsconfig.json` (strict, ES2022, NodeNext)\n2. Create `src/index.ts`, `src/app.ts`, `src/config.ts`\n3. Wire up `GET /health`, OpenAPI doc at `/doc`, Swagger UI at `/docs`\n4. Create error handler, request-id middleware, custom error classes\n5. **Verify**: server starts, `/health` → 200, `/docs` → Swagger UI\n\n### Phase 2: Shared Schemas & Utilities\n1. `src/schemas/common.ts` — ErrorSchema, FileUploadSchema\n2. `src/utils/` — errors, pdf-helpers, response-builders\n3. `src/middleware/file-size-limit.ts`\n\n### Phase 3: PDF Generation (3 endpoints)\n1. `src/services/pdfkit.service.ts` — `generatePdfFromText()`\n2. `/api/pdf/generate/from-text` route + handler\n3. `src/templates/` — invoice, report, letter templates + registry\n4. `/api/pdf/generate/from-template` route + handler\n5. `src/services/html-renderer.service.ts` — Puppeteer or fallback\n6. `/api/pdf/generate/from-html` route + handler\n\n### Phase 4: PDF Extraction (4 endpoints)\n1. `src/services/pdfjs.service.ts` — `extractText()`, `extractMetadata()`\n2. `/api/pdf/extract/text` + `/api/pdf/extract/metadata` routes + handlers\n3. `/api/pdf/extract/pages` (uses pdf-lib to copy pages)\n4. `/api/pdf/extract/images` (uses pdfjs-dist operator list)\n\n### Phase 5: PDF Manipulation (6 endpoints)\n1. `src/services/pdflib.service.ts` — merge, split, rotate, watermark, compress\n2. Build endpoints in order: rotate → merge → split → watermark → compress → protect\n\n### Phase 6: Tests\n1. Vitest setup + test fixtures (generate sample PDFs in setup)\n2. Unit tests for all service functions\n3. Integration tests for all endpoints via `app.request()`\n\n---\n\n## Error Handling\n\n| Scenario | HTTP | Code |\n|---|---|---|\n| Zod validation failure | 400 | `VALIDATION_ERROR` |\n| Missing/invalid file | 400 | `INVALID_FILE` |\n| File too large | 413 | `FILE_TOO_LARGE` |\n| Corrupt/unreadable PDF | 422 | `PDF_PROCESSING_ERROR` |\n| Encrypted PDF (no password) | 422 | `PDF_ENCRYPTED` |\n| Invalid page range | 422 | `INVALID_PAGE_RANGE` |\n| Unexpected error | 500 | `INTERNAL_ERROR` |\n\nAll errors return: `{ success: false, error: { code, message, details? } }`\nAll JSON successes return: `{ success: true, data: { ... } }`\nPDF binary responses return `application/pdf` with `Content-Disposition` header.\n\n---\n\n## Verification\n\n1. **Start server**: `npm run dev` → confirm no errors, logs port\n2. **Swagger UI**: Open `http://localhost:3000/docs` → all endpoints listed with schemas\n3. **Smoke test generation**: `curl -X POST http://localhost:3000/api/pdf/generate/from-text -H 'Content-Type: application/json' -d '{\"text\":\"Hello World\"}' --output test.pdf` → opens as valid PDF\n4. **Smoke test extraction**: Upload the generated PDF to `/api/pdf/extract/text` → returns `{ success: true, data: { text: \"Hello World\", ... } }`\n5. **Smoke test manipulation**: Upload two PDFs to `/api/pdf/merge` → returns merged PDF\n6. **Run tests**: `npm test` → all pass\n7. **Error handling**: Send invalid JSON → 400 with `VALIDATION_ERROR`\n" }
        Approve Deny
        ```

* "Project memory/state
    - [ ] "sessions do not restore after restart
    - [~] save and restore sessions
* Session status bar
    - [ ] money is not counted on the fly
    - [ ] no context size and opacity
    - [ ] Display current mode (plan, accept edits, spec, ...) in status bar in sessions tabs (right below chat box); should be clickable to quick switch modes (a-la ```⏸️ plan mode on (shift+tab to cycle)```)
    - [ ] Display current model (opus 4.5 1m, opus 4.5, ...) in status bar in sessions tabs (right below chat box); should be clickable to quick switch models
* Notifications
    - [ ] Needs something like timeout (when active usage)
    - [ ] Should "focus on problem on click"
* left bar
    - [x] files tab doesn't display directory
    - [x] files tab doesn't have scrolling

* bugs and strange behaviours:
    - [ ] Ones agent decided to go to inspect other projects on disk
    - [ ] Unexpected "session start". E,g, in one sessions:
        ```
        Action requires approval
        Write/home/danya/bonsai-demo/src/services/pdflib.service.ts
        ✓ Approved
        Turn complete — $1.80 · 21 turns
        Session started — claude-opus-4-6
        ```
    - [ ] session renew:
        ```
        The project isn't fully wired up yet — the app.ts imports handlers that don't exist yet. Let me finish building all the routes, handlers, and templates so it actually runs.
        Session started — claude-opus-4-6
        ```
        I.e. session stopped by itself and didn't resume
    - [ ] **Graph view** has to be fixed
    - [ ] Reqs and Specs tabs displays nothing (mocks)
    - [ ] Progress definitely shows something wrong
    - [ ] Tree-view (files tab) always appears fully unfolded --- not nice
* Other
    - [x] add ~~somewhere~~ in main (session) tabs window file/code preview
    - [x] Support preview for markdowns and mermaid
    - [x] Support file editing and simple IDE features (Implementation comment: Basic support is done with monaco editor)
        * click on file -> open in tba view preview with "edit button" -> click on edit -> dialogue open in idea\vscode (mocks) \in place editor (done)\ open in Vim (done)
    - [x] IntelliJ Idea-style theme for `files` tab and code
    - [ ] Different (global) themes support
    - [ ] keybindings for non-mac
    - [ ] Better mermaid scrolling, focusing, etc
    - [x] Add working-dir and project selection with autocomplete during project path typing
    - [ ] Add preview for html-s
    - [ ] For Spec files in preview add clickable links -- connections to other specs
* Features:
    - [ ] Bind tools, sessions, conversations, and/with tasks (at list like a link or folder)
    - [x] Session manager: manage and history of sessions, as well as ability to restore and continue
    - [ ] Skill a-la "let's reason and discuss something"