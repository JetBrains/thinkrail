# ThinkRail - Claude Code Plugin for Spec-Driven Development

## Project Type and Context
- **Type**: VSCode extension plugin for Claude Code
- **Purpose**: Implement spec-driven development workflow through interactive commands
- **Main Commands**: `/thinkrail:design` and `/thinkrail:implement`
- **Specification Storage**: All specs stored in `<project_root>/thinkrail/` directory

## Core Workflow Overview

The plugin implements a 2-phase development approach:

### Phase 1: Design (`/thinkrail:design`)

Interactive specification creation through 4 structured steps:

1. **Init** - Establish requirements and technology stack
2. **Core Design** - Create component specifications
3. **Design Review** - Self-criticism and improvement suggestions
4. **Plan** - Generate implementation plan

### Phase 2: Implementation (`/thinkrail:implement`)
Structured implementation following generated specifications and plans.

---

## Detailed Command Workflows

### `/thinkrail:design` - Specification Creation

This command guides users through creating hierarchical system specifications.

#### Progress Tracking During Design

The `/thinkrail:design` command maintains a progress tracking file to show current status and completed steps.

**Progress File**: `thinkrail/.design-progress.md`

**Progress Format**:
```markdown
# Design Progress

## Overall Status
- Current Step: [Init | Core Design | Design Review | Plan]
- Started: 2026-01-28 14:30
- Components Designed: 3/5

## Step 1: Init ✓
- Status: Completed
- Requirements file: thinkrail/requirements.md
- Technology stack: Confirmed
- Completed: 2026-01-28 14:45

## Step 2: Core Design [IN PROGRESS]
- Status: In Progress (60%)
- Components identified: 5
- Specifications created: 3/5

### Component Status:
- [✓] backend-services (thinkrail/backend-services.md)
- [✓] data-model (thinkrail/data-model.md)
- [○] api-gateway (thinkrail/backend-services/api-gateway.md) - In progress
- [ ] frontend-app
- [ ] testing-framework

## Step 3: Design Review
- Status: Pending
- Depends on: Core Design completion

## Step 4: Plan
- Status: Pending
- Depends on: Design Review approval

## Next Actions:
1. Complete api-gateway specification
2. Design frontend-app component
3. Design testing-framework component
4. Conduct design review and self-criticism
5. Create implementation plan
```

**Progress Markers**:
- `[✓]` - Completed
- `[○]` - In progress
- `[ ]` - Not started
- `[×]` - Blocked/Failed (with reason)

**Update Rules**:
1. Create `.design-progress.md` when `/thinkrail:design` starts
2. Update after each significant action (completing step, creating spec, etc.)
3. Show current component being worked on
4. Track percentage completion for multi-component steps
5. List next actions for clarity
6. Remove file or mark "Design Complete" when design phase finishes

**Visual Feedback in Agent Responses**:

- **Step transitions**: "Starting Step 2: Core Design"
- **Progress references**: "Completing Step 1 (Init)..."
- **Milestone completions**: "✓ Step 1 Complete: Requirements saved to thinkrail/requirements.md"
- **Multi-step progress**: "Designing component 3 of 5: api-gateway"
- **Component progress**: "[○] Creating specification for api-gateway..."
- **Component completion**: "✓ api-gateway specification saved to thinkrail/backend-services/api-gateway.md"
- **Percentage updates**: "Core Design: 60% complete (3/5 components)"
- **Next action hints**: "Next: Designing frontend-app component"

**Example Response Flow**:

```
Agent: Starting Step 1: Init - Initial Requirements Alignment

[asks questions...]

Agent: ✓ Step 1 Complete: Requirements saved to thinkrail/requirements.md
       Starting Step 2: Core Design (5 components identified)

Agent: Creating specification 1/5: backend-services
       [○] Analyzing backend-services component...

Agent: ✓ backend-services specification complete
       Core Design: 20% complete (1/5 components)
       Next: data-model component
```

#### Step 1: Init (Initial Requirements Alignment)

**Goal**: Establish core requirements and technology stack.

**Progress Tracking**:

- Update `.design-progress.md` when step starts: `Step 1: Init [IN PROGRESS]`
- Track sub-tasks: gathering requirements, confirming with user, saving file
- Mark complete when requirements file is saved

**Process**:
1. Ask clarifying questions about:
   - Application type (CLI, web app, mobile app, service, etc.)
   - Programming language and infrastructure (Python, Kotlin multiplatform, Node.js, etc.)
   - Key technologies, libraries, and APIs (Kafka, Spring, React, etc.)
   - Target users and scale
2. Only ask questions when necessary - don't ask if the answer is obvious from context
3. Create summary of agreed requirements
4. Save requirements to structured YAML/Markdown file in `thinkrail/` directory
5. **Update progress**: Mark Step 1 as complete with checkmark and timestamp

**Example Interaction**:
```
User: "I want service to work with PDF files"
Agent: Asks about deployment (CLI/web/desktop/mobile)
User: "Web page"
Agent: Asks about architecture (static page vs client-server)
Agent: Asks about expected user count
[... clarifying questions ...]
Agent: Presents summary for confirmation
User: "ok"
Agent: Saves to thinkrail/requirements.md or similar
```

#### Step 2: Verify and Adjust Core Design

**Goal**: Create hierarchical structure of interconnected specification documents.

**Progress Tracking**:

- Update `.design-progress.md` when step starts: `Step 2: Core Design [IN PROGRESS]`
- List all identified components with status markers
- Update after each component specification is created
- Show completion percentage: `Specifications created: 3/5 (60%)`
- Track which component is currently being designed
- Show visual feedback in responses: "Designing component 3 of 5: api-gateway"

**Output Structure**:

- Top-level: `thinkrail/MAIN.md` - High-level system architecture
- Component specs: Individual markdown files with explicit links to parent specs
- Hierarchical organization using compound specs (see below)

**Process**:

1. Identify all components needed from requirements
2. Update progress file with component list (all marked `[ ]` initially)
3. Propose initial architecture with components and data flow
4. For each component:
   - Mark component as `[○]` (in progress) in `.design-progress.md`
   - Ask specific clarifying questions (only when genuinely uncertain)
   - Create specification file
   - Mark component as `[✓]` (completed) in `.design-progress.md`
5. Create hierarchical structure:
   - Each component gets its own markdown file
   - Child components reference parent specs explicitly
   - Use relative paths for internal references
6. Ask user if they want to:
   - Change something
   - Specify components in more detail
   - Continue to planning step
7. **Update progress**: Mark Step 2 as complete when all components are designed

**Example Structure**:
```
thinkrail/
├── MAIN.md                    # Top-level architecture
├── server/
│   ├── server.md             # Server component spec (parent)
│   ├── data-design.md        # Data layer spec
│   └── handlers/
│       └── handlers.md       # Request handlers spec
└── client/
    └── client.md             # Client component spec
```

#### Step 3: Design Review & Self-Criticism

**Goal**: Critically evaluate the proposed design for potential issues and improvements.

**Progress Tracking**:

- Update `.design-progress.md` when step starts: `Step 3: Design Review [IN PROGRESS]`
- Track review completion
- Mark complete after presenting analysis and handling any changes

**Process**:

1. **Analyze the complete design** (all specs + architecture):
   - Identify potential weaknesses, bottlenecks, or risks
   - Consider scalability, maintainability, security concerns
   - Check for over-engineering or unnecessary complexity
   - Look for missing components or unclear interfaces
   - Evaluate technology choices and dependencies

2. **Present laconic, high-level summary** to user:
   - **Strengths**: 2-3 key advantages of current design
   - **Concerns**: 2-4 potential issues or risks (if any)
   - **Alternatives**: 1-2 alternative approaches (only if significantly better)
   - Keep it brief and actionable

3. **User decision**:
   - If user wants changes: Return to Step 2, update affected specs
   - If design is approved: Proceed to Step 4 (Plan)

**Example Output**:

```text
Design Review Summary:

Strengths:
- Clear separation between API and UI layers
- Database schema supports future extensibility

Concerns:
- No caching layer: may have performance issues at scale
- Authentication in API layer: consider separate auth service for microservices evolution
- Frontend direct DB access in data-model spec: violates separation of concerns

Alternatives:
- Add Redis caching layer between API and database
- Extract auth into separate service (future-proofing)

Proceed with current design, or would you like to address any concerns?
```

**Update progress**: Mark Step 3 complete when review is done and user approves

#### Step 4: Plan

**Goal**: Create detailed implementation plan.

**Progress Tracking**:

- Update `.design-progress.md` when step starts: `Step 4: Plan [IN PROGRESS]`
- Track plan creation progress: analyzing specs, identifying steps, organizing tasks
- Mark complete when PLAN.md is saved
- **Final update**: Mark entire design phase as complete, show summary

**Output**: `thinkrail/PLAN.md` file with structured implementation steps.

**Plan Format**:

- Break down implementation into concrete steps
- Identify dependencies between steps
- Specify which files need to be created/modified
- Include testing and verification steps
- Use progress markers for tracking during implementation:
  - `[v]` - Done
  - `[o]` - Ongoing
  - `[ ]` - To be done
  - `[x]` - Failed

**Process**:

1. Review all created specifications
2. Identify implementation tasks from each component spec
3. Determine dependencies and optimal order
4. Create structured PLAN.md with:
   - Task list with progress markers (all `[ ]` initially)
   - File paths to be created/modified
   - Testing requirements
   - Acceptance criteria
5. Save PLAN.md to `thinkrail/PLAN.md`
6. **Update progress**: Mark Step 4 complete
7. **Finalize**: Update `.design-progress.md` to show design phase completion:

   ```markdown
   # Design Phase: COMPLETE ✓
   - All 4 steps completed
   - Ready for implementation phase
   ```

---

## Complete Design Progress Example

Here's how `.design-progress.md` evolves during a full design session:

### Initial State (Session Start)

```markdown
# Design Progress

## Overall Status
- Current Step: Init
- Started: 2026-01-28 14:30
- Components Designed: 0/0

## Step 1: Init [IN PROGRESS]
- Status: In Progress
- Started: 2026-01-28 14:30

## Step 2: Core Design
- Status: Pending

## Step 3: Design Review
- Status: Pending

## Step 4: Plan
- Status: Pending
```

### After Step 1 (Requirements Complete)

```markdown
# Design Progress

## Overall Status
- Current Step: Core Design
- Started: 2026-01-28 14:30
- Components Designed: 0/3

## Step 1: Init ✓
- Status: Completed
- Requirements file: thinkrail/requirements.md
- Technology stack: Node.js, Express, React, PostgreSQL
- Completed: 2026-01-28 14:42

## Step 2: Core Design [IN PROGRESS]
- Status: In Progress (0%)
- Components identified: 3
- Specifications created: 0/3
- Started: 2026-01-28 14:42

### Component Status:
- [ ] backend-api
- [ ] frontend-ui
- [ ] database-schema

## Step 3: Design Review
- Status: Pending
- Depends on: Core Design completion

## Step 4: Plan
- Status: Pending
- Depends on: Design Review approval
```

### During Step 2 (Designing Components)

```markdown
# Design Progress

## Overall Status
- Current Step: Core Design
- Started: 2026-01-28 14:30
- Components Designed: 2/3

## Step 1: Init ✓
- Status: Completed
- Requirements file: thinkrail/requirements.md
- Technology stack: Node.js, Express, React, PostgreSQL
- Completed: 2026-01-28 14:42

## Step 2: Core Design [IN PROGRESS]
- Status: In Progress (67%)
- Components identified: 3
- Specifications created: 2/3
- Started: 2026-01-28 14:42

### Component Status:
- [✓] backend-api (thinkrail/backend-api.md) - Completed 14:50
- [✓] database-schema (thinkrail/database-schema.md) - Completed 14:55
- [○] frontend-ui (thinkrail/frontend-ui.md) - In progress

## Step 3: Design Review
- Status: Pending
- Depends on: Core Design completion

## Step 4: Plan
- Status: Pending
- Depends on: Design Review approval

## Next Actions:
1. Complete frontend-ui specification
2. Conduct design review and self-criticism
3. Create implementation plan
```

### After Step 2 (Components Complete, Before Review)

```markdown
# Design Progress

## Overall Status
- Current Step: Design Review
- Started: 2026-01-28 14:30
- Components Designed: 3/3

## Step 1: Init ✓
- Requirements file: thinkrail/requirements.md
- Technology stack: Node.js, Express, React, PostgreSQL
- Completed: 2026-01-28 14:42

## Step 2: Core Design ✓
- Specifications created: 3/3 (100%)
- Completed: 2026-01-28 15:05

### Components:
- [✓] backend-api (thinkrail/backend-api.md)
- [✓] database-schema (thinkrail/database-schema.md)
- [✓] frontend-ui (thinkrail/frontend-ui.md)

## Step 3: Design Review [IN PROGRESS]
- Status: In Progress
- Started: 2026-01-28 15:06
- Analyzing: Architecture, scalability, potential issues

## Step 4: Plan
- Status: Pending
- Depends on: Design Review approval

## Next Actions:
1. Present design review findings
2. Address any concerns if needed
3. Create implementation plan
```

### Final State (Design Complete)

```markdown
# Design Phase: COMPLETE ✓

## Summary
- Total Duration: 50 minutes
- Started: 2026-01-28 14:30
- Completed: 2026-01-28 15:20
- Components Designed: 3

## Step 1: Init ✓
- Requirements file: thinkrail/requirements.md
- Completed: 2026-01-28 14:42

## Step 2: Core Design ✓
- Specifications created: 3/3 (100%)
- Completed: 2026-01-28 15:05

### Components:
- [✓] backend-api (thinkrail/backend-api.md)
- [✓] database-schema (thinkrail/database-schema.md)
- [✓] frontend-ui (thinkrail/frontend-ui.md)

## Step 3: Design Review ✓
- Review completed: No major concerns
- Design approved by user
- Completed: 2026-01-28 15:10

## Step 4: Plan ✓
- Plan file: thinkrail/PLAN.md
- Implementation tasks: 12
- Completed: 2026-01-28 15:20

## Ready for Implementation
Run `/thinkrail:implement` to begin implementation phase.
```

---

### `/thinkrail:implement` - Implementation Execution

#### Step 4: Implement

**Goal**: Follow the plan while keeping specifications and plan up-to-date.

**Process**:
1. Follow steps from `thinkrail/PLAN.md`
2. Update `PLAN.md` with progress markers:
   - `[v]` - Done
   - `[o]` - Ongoing
   - `[ ]` - To be done
   - `[x]` - Failed
3. Show progress in Claude Code interface (status bar if possible)
4. If issues arise or requirements change:
   - **Option A**: If specs need updating → return to `/thinkrail:design` Step 2
   - **Option B**: If specs are current → update PLAN.md and continue

**Key Rule**: Keep PLAN.md synchronized with actual progress at all times.

#### Step 5: Test and Verification

**Goal**: Verify and test the complete solution.

**Process**:
- Run all tests
- Verify against specifications
- Check that all plan items are complete
- Document any deviations from original specs

---

## Progress Recovery and Error Handling

### Resuming Interrupted Design Sessions

If a `/thinkrail:design` session is interrupted, the agent should:

1. **Check for existing progress file**: Read `thinkrail/.design-progress.md`
2. **Identify last completed step**: Look for `✓` markers and `[IN PROGRESS]` status
3. **Resume from interruption point**:
   - If Step 1 incomplete: Restart Step 1
   - If Step 2 incomplete: Continue with remaining components
   - If Step 3 incomplete: Create/complete PLAN.md
4. **Inform user**: "Resuming design session - Step 2 in progress (2/5 components completed)"
5. **Continue updating progress**: Maintain continuity in progress tracking

### Handling Design Changes

When user requests changes during design:

1. **Mark affected components** as `[○]` (in progress) in `.design-progress.md`
2. **Update specifications**: Modify affected spec files
3. **Check dependencies**: Identify components that reference changed specs
4. **Update dependent specs**: Modify components that depend on changed specs
5. **Update progress**: Mark all modified components with timestamps
6. **Recalculate completion**: Adjust percentage based on changes

**Example**:

```markdown
### Component Status:
- [✓] backend-api (thinkrail/backend-api.md) - Completed 14:50
- [○] database-schema (thinkrail/database-schema.md) - Updating 15:20 (was ✓ 14:55)
- [✓] frontend-ui (thinkrail/frontend-ui.md) - Completed 15:05

## Change Log:
- 15:20: Updating database-schema per user request (add caching layer)
- 15:20: backend-api may need updates to support caching
```

### Error States

Use `[×]` marker for blocked or failed tasks:

```markdown
### Component Status:
- [✓] backend-api (thinkrail/backend-api.md)
- [×] payment-service - BLOCKED: Waiting for payment provider API docs
- [○] frontend-ui (thinkrail/frontend-ui.md) - In progress
```

When blocked:

1. Mark component as `[×]` with reason
2. Continue with other components if possible
3. Return to blocked component when unblocked
4. Update progress marker to `[○]` when resuming

---

## Specification Format and Organization

### Hierarchical Structure: Compound Specs

**Convention**: A spec file `component.md` can have a matching directory `component/` containing child specs.

**Example 1 - Simple Hierarchy**:
```
.tr/
├── backend-services.md        # Parent spec
└── backend-services/          # Child specs directory
    ├── user-service.md
    ├── auth-service.md
    └── data-access.md
```

**Example 2 - Multi-Level Hierarchy**:
```
.tr/
├── e-commerce-platform.md     # Root
├── e-commerce-platform/
│   ├── frontend.md            # Child & parent
│   ├── frontend/
│   │   ├── product-catalog.md # Grandchild
│   │   └── shopping-cart.md
│   ├── backend.md
│   └── backend/
│       ├── api-gateway.md
│       └── payment-service.md
└── database.md                # Sibling to root
```

**Example 3 - Grouping Without Parents**:
```
.tr/
├── services/                  # Directory for organization only
│   ├── user-service.md
│   └── auth-service.md
└── data/
    └── user-repository.md
```

### Specification Document Contents

Each specification markdown file should include:

1. **Overview**: Brief description and purpose
2. **Functional Requirements**: Features, capabilities, operations
3. **Non-Functional Requirements**: Performance, security, scalability
4. **Dependencies**:
   - Internal components (use relative paths: `./sibling.md`, `../parent.md`)
   - External dependencies (libraries, APIs, services)
5. **Links**: Explicit references to parent specs and related components

### Design Principles

- **Iterative**: Start high-level, drill down as needed
- **Flexible**: Simple specs can become compound specs by adding child directory
- **Connected**: Use relative paths to show relationships
- **Discoverable**: Agent should explore existing `.tr/` to learn conventions
- **Adaptive**: Match existing format if specs already exist

---

## Command Usage Examples

### `/thinkrail:design` Examples

```bash
# Start with high-level purpose
/thinkrail:design build a user authentication system with social login

# Start with project goal
/thinkrail:design create a real-time chat application

# Game example
/thinkrail:design cli-based football manager simulator

# Complex application
/thinkrail:design application that examines TweedeKamer laws weekly, summarizes them in English, and generates video podcast

# Specific component
/thinkrail:design user-authentication-service

# Interactive mode
/thinkrail:design
```

---

## Complete Walkthrough Example: Ping-Pong Server

Here's a detailed example of the `/thinkrail:design` workflow for a simple client-server ping-pong application.

**User Request**: "Design a simple client-server ping-pong project in Kotlin using Ktor with simple authorization"

### Step 1: Init - Requirements Alignment

**Agent**: Starting Step 1: Init - Initial Requirements Alignment

Let me clarify the requirements for your ping-pong application:

1. **Deployment**: I understand you want a client-server architecture. Should the client be:
   - A) CLI application
   - B) Desktop GUI
   - C) Web client

2. **Authorization**: You mentioned "simple authorization". Should this be:
   - A) Username/password with session tokens
   - B) API keys
   - C) OAuth/JWT

3. **Persistence**: Should user credentials and game state be:
   - A) Stored in a database (PostgreSQL, SQLite)
   - B) In-memory only
   - C) File-based

**User**: A for all - CLI client, username/password with tokens, SQLite database

**Agent**: Perfect. Here's the requirements summary:

**Requirements Summary** (`thinkrail/requirements.md`):
```yaml
project_name: ping-pong-server
description: Client-server ping-pong game with authorization

technology_stack:
  language: Kotlin
  server_framework: Ktor
  database: SQLite
  client_type: CLI

architecture:
  type: client-server
  protocol: HTTP/REST

features:
  - User registration and login
  - Session token authentication
  - Ping-pong game logic (client sends "ping", server responds "pong")
  - Game history tracking

scale:
  expected_users: Small (10-50 concurrent)
  deployment: Single server instance
```

✓ Step 1 Complete: Requirements saved to thinkrail/requirements.md

### Step 2: Core Design - Component Specifications

**Agent**: Starting Step 2: Core Design (4 components identified)

Based on the requirements, I've identified these components:
1. Server API (Ktor application)
2. Authentication Module
3. Database Schema
4. CLI Client

Creating specification 1/4: Server API [○]

**Server API Specification** (`thinkrail/server-api.md`):
```markdown
# Server API Component

## Overview
Ktor-based REST API server handling ping-pong game logic and user management.

## Functional Requirements
- REST endpoints: /register, /login, /ping, /history
- Session token validation middleware
- JSON request/response handling
- CORS configuration for development

## Non-Functional Requirements
- Performance: <100ms response time
- Security: Password hashing (bcrypt), token generation (UUID)
- Logging: Request/response logging with timestamps

## Dependencies
- Internal: [authentication-module](./authentication-module.md), [database-schema](./database-schema.md)
- External: Ktor 2.x, kotlinx.serialization, exposed (ORM)

## API Endpoints
- POST /register - Create new user
- POST /login - Authenticate and get token
- POST /ping - Play ping-pong (requires auth)
- GET /history - Get game history (requires auth)
```

✓ server-api specification complete
Core Design: 25% complete (1/4 components)
Next: authentication-module component

**Agent**: Creating specification 2/4: Authentication Module [○]

**Authentication Module Specification** (`thinkrail/authentication-module.md`):
```markdown
# Authentication Module

## Overview
Handles user authentication, password management, and session tokens.

## Functional Requirements
- Password hashing using bcrypt
- Session token generation and validation
- Token expiration (24 hours)
- User credential verification

## Non-Functional Requirements
- Security: Salt rounds = 12 for bcrypt
- Performance: Token lookup from in-memory cache with DB fallback
- Thread-safe token storage

## Dependencies
- Internal: [database-schema](./database-schema.md)
- External: BCrypt library, Kotlin coroutines

## Public Interface
```kotlin
interface AuthService {
    suspend fun registerUser(username: String, password: String): Result<User>
    suspend fun authenticateUser(username: String, password: String): Result<String>
    suspend fun validateToken(token: String): Result<User>
    suspend fun invalidateToken(token: String)
}
```
```

✓ authentication-module specification complete
Core Design: 50% complete (2/4 components)

**Agent**: Creating specification 3/4: Database Schema [○]

**Database Schema Specification** (`thinkrail/database-schema.md`):
```markdown
# Database Schema

## Overview
SQLite database schema for users, sessions, and game history.

## Schema Design

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Sessions Table
```sql
CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### Game History Table
```sql
CREATE TABLE game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    request TEXT NOT NULL,
    response TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Dependencies
- External: SQLite JDBC driver, Exposed ORM

## Migrations
- Migration scripts in `resources/db/migration/`
```

✓ database-schema specification complete
Core Design: 75% complete (3/4 components)

**Agent**: Creating specification 4/4: CLI Client [○]

**CLI Client Specification** (`thinkrail/cli-client.md`):
```markdown
# CLI Client

## Overview
Command-line client for interacting with the ping-pong server.

## Functional Requirements
- Commands: register, login, ping, history, logout
- Store session token locally (file-based)
- Display formatted responses
- Interactive mode and single-command mode

## Non-Functional Requirements
- User-friendly error messages
- Command validation
- Config file for server URL

## Dependencies
- Internal: Communicates with [server-api](./server-api.md) via HTTP
- External: Ktor HTTP client, kotlinx-cli, kotlinx.serialization

## Command Examples
```bash
./client register --username alice --password secret123
./client login --username alice --password secret123
./client ping
./client history
./client logout
```

## Configuration
```yaml
# client-config.yml
server_url: http://localhost:8000
token_file: .auth-token
```
```

✓ cli-client specification complete
Core Design: 100% complete (4/4 components)

✓ Step 2 Complete: All component specifications created

### Step 3: Design Review - Self-Criticism

**Agent**: Starting Step 3: Design Review

Let me analyze the complete design:

**Design Review Summary:**

**Strengths:**
- Clear separation of concerns (auth, API, data, client)
- Simple architecture appropriate for small-scale use
- Standard REST patterns, easy to test and extend

**Concerns:**
- Token storage in sessions table: in-memory cache mentioned but no cache invalidation strategy
- No rate limiting: vulnerable to brute-force attacks on /login
- Database schema has no indexes: queries on user_id and token will be slow as data grows
- CLI client stores token in plain file: security risk if multiple users share the system

**Alternatives:**
- Add Redis for session caching (more complex, but better for 50+ concurrent users)
- Use JWT tokens instead of database sessions (stateless, but can't invalidate easily)
- Add indexes to database schema: `CREATE INDEX idx_sessions_token ON sessions(token);`
- Consider HTTPS/TLS for client-server communication (not in current specs)

**Recommendations:**
1. Add database indexes (low effort, high impact)
2. Add rate limiting to /login endpoint (low effort, prevents basic attacks)
3. Consider file permissions for token storage in client (security hardening)

Proceed with current design, or would you like to address any concerns?

**User**: Add the indexes and rate limiting, keep everything else as is.

**Agent**: Updating specifications...

[○] Updating database-schema.md with indexes
[○] Updating server-api.md with rate limiting requirement

✓ database-schema.md updated with index definitions
✓ server-api.md updated: added rate limiting (5 attempts per minute per IP on /login)

✓ Step 3 Complete: Design review complete, changes applied

### Step 4: Plan - Implementation Plan

**Agent**: Starting Step 4: Plan

**Implementation Plan** (`thinkrail/PLAN.md`):

```markdown
# Implementation Plan: Ping-Pong Server

## Tasks

### Phase 1: Project Setup
- [ ] 1.1: Create Kotlin/Gradle project structure
- [ ] 1.2: Add dependencies (Ktor, Exposed, SQLite, BCrypt)
- [ ] 1.3: Setup project structure (packages: api, auth, db, models)

### Phase 2: Database Layer
- [ ] 2.1: Create database schema migrations (resources/db/migration/V1__initial.sql)
- [ ] 2.2: Implement database connection setup (DBConfig.kt)
- [ ] 2.3: Create Exposed table definitions (Tables.kt)
- [ ] 2.4: Add database indexes for performance

### Phase 3: Authentication Module
- [ ] 3.1: Implement AuthService interface (AuthServiceImpl.kt)
- [ ] 3.2: Add password hashing with BCrypt
- [ ] 3.3: Implement token generation and validation
- [ ] 3.4: Create authentication middleware for Ktor

### Phase 4: Server API
- [ ] 4.1: Setup Ktor application (Application.kt)
- [ ] 4.2: Implement /register endpoint
- [ ] 4.3: Implement /login endpoint with rate limiting
- [ ] 4.4: Implement /ping endpoint (authenticated)
- [ ] 4.5: Implement /history endpoint (authenticated)
- [ ] 4.6: Add request/response logging
- [ ] 4.7: Configure CORS

### Phase 5: CLI Client
- [ ] 5.1: Create CLI application structure
- [ ] 5.2: Implement HTTP client wrapper
- [ ] 5.3: Implement command handlers (register, login, ping, history, logout)
- [ ] 5.4: Add token file management
- [ ] 5.5: Add configuration file loading

### Phase 6: Testing
- [ ] 6.1: Write unit tests for AuthService
- [ ] 6.2: Write integration tests for API endpoints
- [ ] 6.3: Test rate limiting functionality
- [ ] 6.4: Manual testing with CLI client

### Phase 7: Documentation
- [ ] 7.1: Add API documentation (endpoints, request/response formats)
- [ ] 7.2: Add README with setup instructions
- [ ] 7.3: Document CLI client commands

## Files to Create/Modify

### Server (src/main/kotlin/com/pingpong/)
- api/Application.kt
- api/routes/*.kt (register, login, ping, history)
- api/middleware/AuthMiddleware.kt
- api/middleware/RateLimitMiddleware.kt
- auth/AuthService.kt
- auth/AuthServiceImpl.kt
- db/DBConfig.kt
- db/Tables.kt
- models/User.kt, Session.kt, GameHistory.kt

### Client (client/src/main/kotlin/)
- Client.kt
- commands/*.kt
- http/HttpClient.kt
- config/Config.kt

### Resources
- resources/db/migration/V1__initial.sql
- client/resources/client-config.yml

## Testing Requirements
- Unit test coverage: >80% for core logic
- Integration tests for all API endpoints
- Rate limiting verification test
- Token expiration test

## Acceptance Criteria
- All API endpoints respond correctly
- Authentication works end-to-end
- CLI client can perform all operations
- Rate limiting prevents brute force
- Database queries use indexes
- Tests pass with >80% coverage
```

✓ Step 4 Complete: Implementation plan saved to thinkrail/PLAN.md

**Final Summary:**

# Design Phase: COMPLETE ✓

All 4 steps completed. Ready for implementation phase.

**Next Command**: `/thinkrail:implement` to begin implementation

---

## Multi-Component Design Workflow Example

The `/thinkrail:design` command supports designing multiple related components in a single session:

1. **Purpose**: "build a blog platform with comments"
2. **Component Identification**:
   - Data model (foundation)
   - API service
   - Frontend UI
   - Comment system
   - Testing framework
3. **Sequential Design**: Design each component, maintaining context
4. **Relationship Tracking**: Later components reference earlier ones
5. **Consistency**: Ensure compatible interfaces between components

---

## Implementation Notes for Agent

### When Implementing `/thinkrail:design`:

1. **Always check** for existing specs in `thinkrail/` to learn conventions
2. **Check for existing progress file** on session start - resume if found
3. **Create `.design-progress.md`** at the start of new design session
4. **Update progress file** after each significant action:
   - When starting a new step
   - When completing a component specification
   - When finishing a step
   - When user requests status update
   - When handling errors or blocks
5. **Show progress in responses**: Reference what step/component you're working on
   - Use consistent format: "Step X: [step name] - [action]"
   - Show completion markers: "✓", "[○]", percentages
   - Indicate what's next after completing each action
6. **Ask questions** only when genuinely uncertain - don't over-ask
7. **Use relative paths** in specifications for component references
8. **Create parent directories** automatically as needed
9. **Suggest logical organization** based on component relationships
10. **Validate understanding** at each phase before proceeding
11. **Allow modifications** before saving specifications
12. **Track session context** when designing multiple components
13. **Perform design review (Step 3)**: After all specs are created:
    - Critically evaluate the complete design
    - Identify potential issues: scalability, security, complexity
    - Suggest 1-2 alternatives only if significantly better
    - Keep feedback laconic and high-level (2-4 concerns max)
    - Don't over-criticize: focus on real issues, not theoretical edge cases
14. **Handle interruptions gracefully**: Save progress before each major transition
15. **Mark errors clearly**: Use `[×]` for blocked tasks with clear reasons
16. **Clean up progress file**: Mark as complete when design phase finishes

### Progress Tracking Best Practices

**Frequency**: Update `.design-progress.md`:

- Immediately when starting/completing a step
- After creating each component spec
- When user makes changes to existing specs
- At least once per major action (don't batch updates)

**Accuracy**: Ensure progress file reflects reality:

- Verify file existence before marking spec as complete
- Keep component count accurate
- Update timestamps for significant events
- Maintain correct status markers

**User Communication**: In every response during design:

- Reference current step and progress
- Show what was just completed
- Indicate what's happening next
- Provide context from progress file

**Example Pattern**:

```text
Agent: ✓ backend-api specification saved to thinkrail/backend-api.md
       Core Design: 33% complete (1/3 components)

       Now creating database-schema specification [○]
       [asks questions about database design...]
```

### When Implementing `/thinkrail:implement`:

1. **Read PLAN.md first** to understand implementation steps
2. **Update PLAN.md** after completing each step
3. **Update status markers** in real-time
4. **Check specifications** when uncertain about requirements
5. **Return to design phase** if specs are insufficient
6. **Keep specifications current** if requirements evolve

### File Locations

- **Requirements**: `thinkrail/requirements.md` (or similar)
- **Main Architecture**: `thinkrail/MAIN.md`
- **Implementation Plan**: `thinkrail/PLAN.md`
- **Progress Tracking**: `thinkrail/.design-progress.md`
- **Visualization**: `thinkrail/graph.html` (auto-generated)
- **Component Specs**: `thinkrail/<component-name>.md` or `thinkrail/<category>/<component-name>.md`

### Directory Structure

The `thinkrail/` directory should be created in the project root and can be:
- Committed to version control for team collaboration
- Added to `.gitignore` for local-only specifications

---

## Interactive Visualization

ThinkRail includes an **auto-updating interactive graph visualization** that shows the relationships between all design components in real-time.

### How It Works

The visualization uses a **hooks-based approach** that automatically regenerates a static HTML file whenever specs are created or modified:

1. **Agent creates spec** → Hook triggers
2. **Generator scans `thinkrail/`** → Parses all markdown files
3. **Builds graph data** → Extracts dependencies from markdown links
4. **Generates HTML** → Self-contained file with embedded Cytoscape.js
5. **Browser auto-refreshes** → Shows updated graph

**Key Benefits:**
- No server required (pure static HTML)
- Auto-updates as design progresses
- Works offline
- Single HTML file with all dependencies inline
- Lightweight and fast

### Setup

1. **Install visualizer:**
   ```bash
   cd visualizer
   npm install
   npm run build
   ```

2. **Configure hook** (`.claude/hooks.json`):
   ```json
   {
     "hooks": {
       "PostToolUse": [{
         "name": "thinkrail-visualizer",
         "tool": "write_file",
         "condition": "path.includes('thinkrail/') && path.endsWith('.md')",
         "command": "node visualizer/dist/generate-graph.js"
       }]
     }
   }
   ```

3. **Open visualization:**
   ```bash
   # Option 1: Direct open (with meta refresh)
   open thinkrail/graph.html

   # Option 2: LiveServer (recommended - instant refresh)
   npx live-server thinkrail --port=8000 --entry-file=graph.html
   ```

### Features

**Visual Elements:**
- **Node colors** by type: System (blue), Module (yellow), Component (green)
- **Status indicators**: Complete (green), In-progress (orange), Pending (gray)
- **Edge styles**: Dependencies (solid arrows), Parent-child (dashed lines)

**Interactive:**
- Click nodes to see details (description, path, dependencies)
- Zoom in/out, fit to view
- Multiple layouts: hierarchical (dagre), circular, grid
- Auto-refresh every 2 seconds (or instant with LiveServer)

**Progress Integration:**
- Reads `.design-progress.md` to show component status
- Highlights current component being designed
- Updates in real-time as agent creates specs

### During Design Session

As you run `/thinkrail:design`, the graph automatically updates:

```
Agent: Creating specification 1/4: Server API [○]
  → Hook triggers
  → graph.html regenerates
  → Browser shows new "server-api" node

Agent: Creating specification 2/4: Authentication Module [○]
  → Hook triggers
  → graph.html regenerates
  → Browser shows "authentication-module" node + dependency edge

... and so on
```

**See [VISUALIZATION_REVISED.md](VISUALIZATION_REVISED.md) for complete documentation.**

---

## Additional Features

### Format Flexibility

- Specifications use simple markdown format
- Template is extensible with additional sections
- Agent should adapt to existing specification conventions
- Format can evolve as project needs change

---

## Key Implementation Constraints

1. **No over-engineering**: Keep specifications focused and minimal
2. **Convention discovery**: Learn from existing specs before creating new ones
3. **Explicit links**: Always use explicit references between specs
4. **Progress tracking**: Keep PLAN.md synchronized during implementation
5. **Question economy**: Only ask when genuinely uncertain
6. **Hierarchical thinking**: Design top-down, implement foundation-first

---

## Project Status

This is a VSCode extension plugin for Claude Code. The plugin should:
- Register custom commands (`/thinkrail:design`, `/thinkrail:implement`)
- Provide interactive multi-step workflows
- Manage specification files in `.tr/` directory
- Integrate with Claude Code's interface for progress display
- Support iterative refinement of specifications
