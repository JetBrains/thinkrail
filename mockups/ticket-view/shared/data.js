// ── Bonsai Ticket View — Shared Demo Data ─────────────────────
// AUTH-42 scenario: diffs, product design sections, execution
// steps, code snippets, and execution messages.
//
// Used by: engine.js and experiment SCRIPT arrays.
// ───────────────────────────────────────────────────────────────

// ── Helper: build code snippet from hunk header + lines ───────

function mkSnippet(hunk, lines) {
  return [{ t: 'hunk', v: hunk }].concat(lines.map(function(v, i) { return { t: 'add', ln: i + 1, v: '+' + v }; }));
}

// ── Spec diffs ────────────────────────────────────────────────

var DIFFS = [
  {
    badge: 'NEW', badgeClass: 'new',
    path: 'auth/README.md', stats: '<span class="stat-add">+47</span>',
    content: '<div class="diff-hunk-header">@@ -0,0 +1,47 @@</div>' +
'<div class="diff-line add"><span class="ln">1</span>+# Auth Module — Design Spec</div>' +
'<div class="diff-line add"><span class="ln">2</span>+</div>' +
'<div class="diff-line add"><span class="ln">3</span>+## Purpose</div>' +
'<div class="diff-line add"><span class="ln">4</span>+User authentication, authorization, and session</div>' +
'<div class="diff-line add"><span class="ln">5</span>+management for Bonsai workspaces.</div>' +
'<div class="diff-line add"><span class="ln">6</span>+</div>' +
'<div class="diff-line add"><span class="ln">7</span>+## Architecture</div>' +
'<div class="diff-line add"><span class="ln">8</span>+```</div>' +
'<div class="diff-line add"><span class="ln">9</span>+auth/</div>' +
'<div class="diff-line add"><span class="ln">10</span>+  models.py    # Pydantic: User, Token, Role</div>' +
'<div class="diff-line add"><span class="ln">11</span>+  service.py   # Business logic + JWT ops</div>' +
'<div class="diff-line add"><span class="ln">12</span>+  storage.py   # SQLite via aiosqlite</div>' +
'<div class="diff-line add"><span class="ln">13</span>+  middleware.py # FastAPI auth dependency</div>' +
'<div class="diff-line add"><span class="ln">14</span>+```</div>' +
'<div class="diff-line add"><span class="ln">15</span>+</div>' +
'<div class="diff-line add"><span class="ln">16</span>+## Auth Strategy</div>' +
'<div class="diff-line add"><span class="ln">17</span>+JWT-based authentication with refresh tokens.</div>' +
'<div class="diff-line add"><span class="ln">18</span>+Access tokens expire after 15 minutes.</div>' +
'<div class="diff-line add"><span class="ln">19</span>+Refresh tokens expire after 7 days.</div>' +
'<div class="diff-line add"><span class="ln">20</span>+</div>' +
'<div class="diff-line add"><span class="ln">21</span>+## Roles</div>' +
'<div class="diff-line add"><span class="ln">22</span>+- **Admin**: Full access, user management</div>' +
'<div class="diff-line add"><span class="ln">23</span>+- **User**: Read/write specs, run agents</div>' +
'<div class="diff-line add"><span class="ln">24</span>+- **Viewer**: Read-only access to specs</div>' +
'<div class="diff-line add"><span class="ln">25</span>+</div>' +
'<div class="diff-line add"><span class="ln">26</span>+## API Endpoints</div>' +
'<div class="diff-line add"><span class="ln">27</span>+POST /auth/signup    # Create account</div>' +
'<div class="diff-line add"><span class="ln">28</span>+POST /auth/login     # Get JWT tokens</div>' +
'<div class="diff-line add"><span class="ln">29</span>+POST /auth/refresh   # Refresh access token</div>' +
'<div class="diff-line add"><span class="ln">30</span>+POST /auth/logout    # Invalidate session</div>' +
'<div class="diff-line add"><span class="ln">31</span>+GET  /auth/me        # Current user info</div>' +
'<div class="diff-line add"><span class="ln">32</span>+</div>' +
'<div class="diff-line add"><span class="ln">33</span>+## Token Format</div>' +
'<div class="diff-line add"><span class="ln">34</span>+Extends bns_ prefix convention:</div>' +
'<div class="diff-line add"><span class="ln">35</span>+- Access:  bns_at_&lt;jwt_payload&gt;</div>' +
'<div class="diff-line add"><span class="ln">36</span>+- Refresh: bns_rt_&lt;opaque_id&gt;</div>' +
'<div class="diff-line add"><span class="ln">37</span>+</div>' +
'<div class="diff-line add"><span class="ln">38</span>+## Storage Schema</div>' +
'<div class="diff-line add"><span class="ln">39</span>+users: id, email, password_hash, role,</div>' +
'<div class="diff-line add"><span class="ln">40</span>+       created_at, last_login</div>' +
'<div class="diff-line add"><span class="ln">41</span>+sessions: id, user_id, refresh_token,</div>' +
'<div class="diff-line add"><span class="ln">42</span>+          expires_at, revoked</div>' +
'<div class="diff-line add"><span class="ln">43</span>+</div>' +
'<div class="diff-line add"><span class="ln">44</span>+## Dependencies</div>' +
'<div class="diff-line add"><span class="ln">45</span>+- python-jose (JWT encoding)</div>' +
'<div class="diff-line add"><span class="ln">46</span>+- passlib[bcrypt] (password hashing)</div>' +
'<div class="diff-line add"><span class="ln">47</span>+- aiosqlite (async storage)</div>'
  },
  {
    badge: 'MODIFIED', badgeClass: 'modified',
    path: 'DESIGN_DOC.md', stats: '<span class="stat-add">+12</span> <span class="stat-del">-2</span>',
    content: '<div class="diff-hunk-header">@@ -14,7 +14,19 @@ ## Module Overview</div>' +
'<div class="diff-line ctx"><span class="ln">14</span> ### Existing Modules</div>' +
'<div class="diff-line ctx"><span class="ln">15</span> - core/ — Config, file I/O, watcher</div>' +
'<div class="diff-line ctx"><span class="ln">16</span> - spec/ — Spec models, parser, validator</div>' +
'<div class="diff-line del"><span class="ln">17</span>-- agent/ — Agent runner, context, tools</div>' +
'<div class="diff-line add"><span class="ln">17</span>+- agent/ — Agent runner, context, tools</div>' +
'<div class="diff-line add"><span class="ln">18</span>+- auth/ — Authentication &amp; authorization</div>' +
'<div class="diff-line ctx"><span class="ln">19</span> </div>' +
'<div class="diff-line del"><span class="ln">20</span>-### Data Flow</div>' +
'<div class="diff-line add"><span class="ln">20</span>+### Auth Integration</div>' +
'<div class="diff-line add"><span class="ln">21</span>+```</div>' +
'<div class="diff-line add"><span class="ln">22</span>+Request → auth/middleware → router</div>' +
'<div class="diff-line add"><span class="ln">23</span>+         │</div>' +
'<div class="diff-line add"><span class="ln">24</span>+         └─ JWT verify → role check</div>' +
'<div class="diff-line add"><span class="ln">25</span>+```</div>' +
'<div class="diff-line add"><span class="ln">26</span>+All API routes require auth except:</div>' +
'<div class="diff-line add"><span class="ln">27</span>+- POST /auth/signup, /auth/login</div>' +
'<div class="diff-line add"><span class="ln">28</span>+- GET /health</div>' +
'<div class="diff-line add"><span class="ln">29</span>+</div>' +
'<div class="diff-line add"><span class="ln">30</span>+### Data Flow</div>' +
'<div class="diff-line ctx"><span class="ln">31</span> Client → FastAPI → Service → Storage</div>'
  },
  {
    badge: 'MODIFIED', badgeClass: 'modified',
    path: 'core/README.md', stats: '<span class="stat-add">+6</span> <span class="stat-del">-1</span>',
    content: '<div class="diff-hunk-header">@@ -8,6 +8,11 @@ ## Dependencies</div>' +
'<div class="diff-line ctx"><span class="ln">8</span> - aiosqlite</div>' +
'<div class="diff-line ctx"><span class="ln">9</span> - watchfiles</div>' +
'<div class="diff-line del"><span class="ln">10</span>-- pydantic</div>' +
'<div class="diff-line add"><span class="ln">10</span>+- pydantic</div>' +
'<div class="diff-line add"><span class="ln">11</span>+- python-jose (via auth module)</div>' +
'<div class="diff-line add"><span class="ln">12</span>+- passlib[bcrypt] (via auth module)</div>' +
'<div class="diff-line ctx"><span class="ln">13</span> </div>' +
'<div class="diff-line ctx"><span class="ln">14</span> ## Configuration</div>' +
'<div class="diff-line ctx"><span class="ln">15</span> Settings loaded from .bonsai/config.toml</div>' +
'<div class="diff-hunk-header">@@ -22,3 +27,5 @@ ## Server Store</div>' +
'<div class="diff-line ctx"><span class="ln">27</span> SQLite database for runtime state.</div>' +
'<div class="diff-line ctx"><span class="ln">28</span> Tables: users, sessions, settings</div>' +
'<div class="diff-line add"><span class="ln">29</span>+New tables from auth module:</div>' +
'<div class="diff-line add"><span class="ln">30</span>+  auth_users, auth_sessions, auth_roles</div>'
  }
];

// ── Product design document sections ──────────────────────────

var DOC_SECTIONS = {
  goal: '<div class="doc-preview"><h1>Product Design: User Authentication</h1><h2>Goal</h2><p>Enable secure multi-user access to the Bonsai workspace with role-based permissions.</p><div class="doc-building-hint">Building document...</div></div>',

  stories: '<div class="doc-preview"><h1>Product Design: User Authentication</h1><h2>Goal</h2><p>Enable secure multi-user access to the Bonsai workspace with role-based permissions.</p><h2>User Stories</h2><ol><li>As a new user, I can sign up with a username and password</li><li>As a returning user, I can log in and have my session persisted</li><li>As an admin, I can manage users (create, deactivate, change roles)</li><li>As a viewer, I can browse specs and tickets in read-only mode</li></ol><div class="doc-building-hint">Building document...</div></div>',

  roles: '<div class="doc-preview"><h1>Product Design: User Authentication</h1><h2>Goal</h2><p>Enable secure multi-user access to the Bonsai workspace with role-based permissions.</p><h2>User Stories</h2><ol><li>As a new user, I can sign up with a username and password</li><li>As a returning user, I can log in and have my session persisted</li><li>As an admin, I can manage users (create, deactivate, change roles)</li><li>As a viewer, I can browse specs and tickets in read-only mode</li></ol><h2>Roles &amp; Permissions</h2><table><thead><tr><th>Role</th><th>Read</th><th>Write</th><th>Admin</th></tr></thead><tbody><tr><td>Admin</td><td>✓</td><td>✓</td><td>✓</td></tr><tr><td>User</td><td>✓</td><td>✓</td><td>✗</td></tr><tr><td>Viewer</td><td>✓</td><td>✗</td><td>✗</td></tr></tbody></table><div class="doc-building-hint">Building document...</div></div>',

  full: '<div class="doc-preview"><h1>Product Design: User Authentication</h1><h2>Goal</h2><p>Enable secure multi-user access to the Bonsai workspace with role-based permissions.</p><h2>User Stories</h2><ol><li>As a new user, I can sign up with a username and password</li><li>As a returning user, I can log in and have my session persisted</li><li>As an admin, I can manage users (create, deactivate, change roles)</li><li>As a viewer, I can browse specs and tickets in read-only mode</li></ol><h2>Roles &amp; Permissions</h2><table><thead><tr><th>Role</th><th>Read</th><th>Write</th><th>Admin</th></tr></thead><tbody><tr><td>Admin</td><td>✓</td><td>✓</td><td>✓</td></tr><tr><td>User</td><td>✓</td><td>✓</td><td>✗</td></tr><tr><td>Viewer</td><td>✓</td><td>✗</td><td>✗</td></tr></tbody></table><h2>Success Criteria</h2><ul><li>Users can sign up, log in, and maintain sessions</li><li>Token-based auth extends existing <code>bns_</code> prefix system</li><li>RBAC enforces permission boundaries on all API endpoints</li><li>Admin users can manage other users via CLI and API</li></ul><h2>Out of Scope (v1)</h2><ul><li>OAuth/SSO integration</li><li>Two-factor authentication</li><li>Password recovery flow</li></ul></div>'
};

// ── Execution steps ───────────────────────────────────────────

var EXEC_STEPS = [
  { name: 'Create auth models',      file: 'models.py' },
  { name: 'Implement storage layer',  file: 'storage.py' },
  { name: 'Build auth service',       file: 'service.py' },
  { name: 'Add auth middleware',      file: 'middleware.py' },
  { name: 'Create API endpoints',     file: 'routers/auth.py' },
  { name: 'Write tests',             file: 'tests/test_auth.py' }
];

// ── Code snippets for each execution step ─────────────────────

var EXEC_CODE_SNIPPETS = [
  mkSnippet('@@ -0,0 +1,25 @@', ['from __future__ import annotations', '"""Auth models for user, token, and role."""', '', 'from enum import Enum', 'from pydantic import BaseModel, Field', '', 'class Role(str, Enum):', '    ADMIN = "admin"', '    USER = "user"', '    VIEWER = "viewer"', '', 'class User(BaseModel):', '    id: str', '    email: str', '    role: Role = Role.USER']),
  mkSnippet('@@ -0,0 +1,22 @@', ['from __future__ import annotations', '"""Auth storage layer."""', '', 'import aiosqlite', '', 'class AuthStorage:', '    def __init__(self, db):', '        self._db = db', '', '    async def create_tables(self):', '        await self._db.execute("""', '            CREATE TABLE IF NOT EXISTS auth_users (', '                id TEXT PRIMARY KEY,', '                email TEXT UNIQUE NOT NULL', '            )""")']),
  mkSnippet('@@ -0,0 +1,20 @@', ['from __future__ import annotations', '"""Auth service."""', '', 'from jose import jwt', 'from passlib.hash import bcrypt', '', 'class AuthService:', '    def __init__(self, storage, secret):', '        self._storage = storage', '        self._secret = secret', '', '    async def signup(self, email, pw):', '        hashed = bcrypt.hash(pw)', '        user = await self._storage.create_user(', '            email=email, password_hash=hashed', '        )', '        return self._issue_tokens(user)']),
  mkSnippet('@@ -0,0 +1,18 @@', ['from __future__ import annotations', '"""FastAPI auth dependency."""', '', 'from fastapi import Depends, HTTPException', 'from fastapi.security import HTTPBearer', '', 'bearer = HTTPBearer()', '', 'async def require_auth(token=Depends(bearer)):', '    payload = verify_token(token.credentials)', '    if not payload:', '        raise HTTPException(401, "Invalid token")', '    return payload']),
  mkSnippet('@@ -0,0 +1,16 @@', ['from __future__ import annotations', '"""Auth API endpoints."""', '', 'from fastapi import APIRouter, Depends', '', 'router = APIRouter(prefix="/auth", tags=["auth"])', '', '@router.post("/signup")', 'async def signup(req: SignupRequest):', '    return await auth_service.signup(req.email, req.password)', '', '@router.post("/login")', 'async def login(req: LoginRequest):', '    return await auth_service.login(req.email, req.password)']),
  mkSnippet('@@ -0,0 +1,14 @@', ['from __future__ import annotations', '"""Tests for auth module."""', '', 'import pytest', '', 'class TestAuthService:', '    async def test_signup_creates_user(self):', '        result = await service.signup("a@b.c", "pw")', '        assert result.access_token.startswith("bns_at_")', '', '    async def test_login_returns_tokens(self):', '        result = await service.login("a@b.c", "pw")', '        assert result.refresh_token.startswith("bns_rt_")'])
];

// ── Conversation messages during execution ────────────────────

var EXEC_MESSAGES = [
  'Starting step 1: Create auth models...',
  'Step 1 complete. Created models.py with User, Session, Role.',
  'Starting step 2: Implement storage layer...',
  'Step 2 complete. Created storage.py with SQLite schema.',
  'Starting step 3: Build auth service...',
  'Step 3 complete. Created service.py with JWT + bcrypt logic.',
  'Starting step 4: Add auth middleware...',
  'Step 4 complete. Created middleware.py with FastAPI dependency.',
  'Starting step 5: Create API endpoints...',
  'Step 5 complete. Created routers/auth.py with signup, login, refresh.',
  'Starting step 6: Write tests...',
  'Step 6 complete. Created test_auth.py with 12 test cases.'
];
