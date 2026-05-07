// ── Bonsai Ticket View — Sidebar Module ───────────────────────
// Optional sidebar navigation for experiments with phase-
// structured subsession trees.
//
// Experiments CAN define:
//   window.onSidebarNavigate(key) — called when a sidebar item
//     is clicked (done items only by default)
//   window.SUBSESSIONS = [...] — registry of subsession defs
//     Each: { key, phase, label, icon, context, parent? }
// ───────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────

var sidebarItems = {};       // key -> { status, duration, sidebarEl }
var sidebarCollapsed = false;

// ── Add item to sidebar tree ──────────────────────────────────

function addSidebarItem(key, phase, label, icon, parent) {
  if (sidebarItems[key]) return;

  // Allow calling with a SUBSESSIONS-style object
  if (typeof key === 'object') {
    var def = key;
    key = def.key;
    phase = def.phase;
    label = def.label;
    icon = def.icon;
    parent = def.parent;
    if (sidebarItems[key]) return;
  }

  // Or look up from window.SUBSESSIONS if only key was passed
  if (!phase && window.SUBSESSIONS) {
    var found = window.SUBSESSIONS.find(function(s) { return s.key === key; });
    if (found) {
      phase = found.phase;
      label = found.label;
      icon = found.icon;
      parent = found.parent;
    }
  }

  if (!phase) return;

  var container = document.getElementById('gi-' + phase);
  if (!container) return;

  var item = document.createElement('div');
  item.className = 'sidebar-item' + (parent ? ' nested' : '');
  item.id = 'si-' + key;
  item.title = label;
  item.innerHTML = '<span class="item-icon">' + (icon || '●') + '</span>' +
    '<span class="item-label">' + label + '</span>' +
    '<span class="item-meta" id="si-meta-' + key + '"></span>';
  item.onclick = function() { handleSidebarClick(key); };

  // Insert nested items after their parent
  if (parent && sidebarItems[parent]) {
    var parentEl = document.getElementById('si-' + parent);
    if (parentEl && parentEl.nextSibling) {
      container.insertBefore(item, parentEl.nextSibling);
    } else {
      container.appendChild(item);
    }
  } else {
    container.appendChild(item);
  }

  sidebarItems[key] = { status: 'pending', duration: null, sidebarEl: item };
}

// ── Update item status ────────────────────────────────────────

function setSidebarStatus(key, status, duration) {
  var state = sidebarItems[key];
  if (!state) return;
  state.status = status;
  if (duration) state.duration = duration;

  var el = state.sidebarEl;
  var meta = document.getElementById('si-meta-' + key);

  el.classList.remove('active', 'done');

  if (status === 'active') {
    el.classList.add('active');
    if (meta) { meta.textContent = 'active'; meta.className = 'item-meta active-meta'; }
  } else if (status === 'done') {
    el.classList.add('done');
    if (meta) { meta.textContent = duration || ''; meta.className = 'item-meta'; }
    var iconEl = el.querySelector('.item-icon');
    if (iconEl) iconEl.innerHTML = '✓';
  } else {
    if (meta) { meta.textContent = ''; meta.className = 'item-meta'; }
  }
}

// ── Highlight active item ─────────────────────────────────────

function setActiveSidebarItem(key) {
  // Remove active from all
  Object.keys(sidebarItems).forEach(function(k) {
    var item = sidebarItems[k];
    if (item.status !== 'active') {
      item.sidebarEl.classList.remove('active');
    }
  });
  // Add active to target
  if (key && sidebarItems[key]) {
    sidebarItems[key].sidebarEl.classList.add('active');
  }
}

// ── Toggle group collapse/expand ──────────────────────────────

function toggleSidebarGroup(group) {
  var items = document.getElementById('gi-' + group);
  var toggle = document.getElementById('gt-' + group);
  if (!items || !toggle) return;
  items.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed');
}

// ── Full sidebar collapse to icons ────────────────────────────

function toggleSidebarCollapse() {
  sidebarCollapsed = !sidebarCollapsed;
  var sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed', sidebarCollapsed);
}

// ── Handle sidebar clicks ─────────────────────────────────────

function handleSidebarClick(key) {
  var state = sidebarItems[key];
  if (!state) return;

  // Delegate to experiment handler
  if (typeof window.onSidebarNavigate === 'function') {
    window.onSidebarNavigate(key);
  }
}
