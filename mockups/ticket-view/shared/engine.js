// ── Mockup Engine ──────────────────────────────────────────────
// Provides: play/pause, step execution, message rendering,
// artifact panel management, keyboard shortcuts.
//
// Experiments MUST define before including this file:
//   window.SCRIPT = [...] — the step array
//
// Experiments CAN override:
//   window.onStepExecute(step) — called for unknown step types
//   window.onReset() — called during reset
//   window.onEnterSplit() — called when split mode opens
//   window.onExitSplit() — called when split mode closes
// ───────────────────────────────────────────────────────────────

// ── State ─────────────────────────────────────────────────────

var currentStep = 0;
var playing = false;
var stepTimer = null;
var waitingForInteraction = false;
var currentPhase = null;
var approvedArtifacts = [false, false, false];
var currentArtifact = 0;
var productDesignApproved = false;
var execAnimationRunning = false;
var peekMode = false;
var peekSavedState = null;

// ── DOM refs (resolved on DOMContentLoaded) ───────────────────

var convInner, convScroll, stepNumEl, stepTotalEl, progressFill, playBtn, userInput, sendBtn;

document.addEventListener('DOMContentLoaded', function() {
  convInner = document.getElementById('convInner');
  convScroll = document.getElementById('convScroll');
  stepNumEl = document.getElementById('stepNum');
  stepTotalEl = document.getElementById('stepTotal');
  progressFill = document.getElementById('progressFill');
  playBtn = document.getElementById('playBtn');
  userInput = document.getElementById('userInput');
  sendBtn = document.getElementById('sendBtn');

  if (stepTotalEl && window.SCRIPT) stepTotalEl.textContent = window.SCRIPT.length;

  // Wire up input events
  if (userInput) {
    userInput.addEventListener('input', function() {
      if (sendBtn) sendBtn.disabled = !userInput.value.trim();
    });
  }

  // Auto-start interactive mode
  setTimeout(function() { advanceInteractive(); }, 300);
});

// ── Play/Pause ────────────────────────────────────────────────

function togglePlay() {
  if (playing) pause();
  else play();
}

function play() {
  playing = true;
  waitingForInteraction = false;
  updatePlayBtn();
  advanceAutoPlay();
}

function pause() {
  playing = false;
  clearTimeout(stepTimer);
  updatePlayBtn();
}

function updatePlayBtn() {
  if (!playBtn) return;
  playBtn.textContent = playing ? '❚❚ Pause' : '▶ Play';
  playBtn.className = playing ? 'ctrl-btn playing' : 'ctrl-btn';
}

// ── Auto-play ─────────────────────────────────────────────────

function advanceAutoPlay() {
  if (!playing || !window.SCRIPT || currentStep >= window.SCRIPT.length) { pause(); return; }

  var step = window.SCRIPT[currentStep];
  executeStep(step);
  currentStep++;

  var delay;
  if (step.type === 'typing') {
    delay = step.duration;
  } else if (step.type === 'decision') {
    delay = 1800;
    var stepId = step.id;
    var recOption = step.options[step.recommended];
    setTimeout(function() {
      if (playing) {
        resolveDecisionCard(stepId, recOption.replace(/\s*★/, ''));
      }
    }, 1500);
  } else if (step.type === 'approve') {
    delay = 1200;
    var artIdx = step.artifact;
    setTimeout(function() {
      if (playing) autoApprove(artIdx);
    }, 900);
  } else if (step.type === 'approve-doc') {
    delay = 1200;
    setTimeout(function() {
      if (playing) autoApproveDoc();
    }, 900);
  } else if (step.type === 'layout') {
    delay = 700;
  } else if (step.type === 'switch-artifact') {
    delay = 500;
  } else if (step.type === 'all-approved') {
    delay = 1500;
  } else if (step.type === 'exec-progress') {
    runExecAnimation(function() {
      if (playing) {
        stepTimer = setTimeout(advanceAutoPlay, 600);
      }
    });
    return;
  } else if (step.type === 'complete') {
    return;
  } else if (step.type === 'user') {
    delay = 800;
  } else if (step.type === 'phase') {
    delay = 800;
  } else {
    delay = 1200;
  }

  stepTimer = setTimeout(advanceAutoPlay, delay);
}

function autoApprove(idx) {
  approvedArtifacts[idx] = true;
  if (currentArtifact === idx) renderArtifact(idx);
}

function autoApproveDoc() {
  productDesignApproved = true;
  var btn = document.getElementById('approveDocBtn');
  if (btn) {
    btn.textContent = 'Approved ✔';
    btn.style.background = 'var(--green-sub)';
    btn.style.color = 'var(--green)';
    btn.style.pointerEvents = 'none';
  }
}

// ── Interactive mode ──────────────────────────────────────────

function advanceInteractive() {
  if (!window.SCRIPT || currentStep >= window.SCRIPT.length) return;

  var step = window.SCRIPT[currentStep];

  // Interactive user input — wait for them to type
  if (step.type === 'user' && step.interactive && !playing) {
    currentStep++;
    waitingForInteraction = true;
    if (userInput) {
      userInput.value = '';
      userInput.placeholder = step.placeholder || 'Type a message...';
      userInput.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
    return;
  }

  // Decision — wait for click
  if (step.type === 'decision' && !playing) {
    executeStep(step);
    currentStep++;
    waitingForInteraction = true;
    return;
  }

  // Approve — wait for click (auto-skip if already approved)
  if (step.type === 'approve' && !playing) {
    if (step.artifact !== undefined && approvedArtifacts[step.artifact]) {
      currentStep++;
      setTimeout(function() { advanceInteractive(); }, 200);
      return;
    }
    waitingForInteraction = true;
    currentStep++;
    return;
  }

  // Approve doc — wait for click (auto-skip if already approved)
  if (step.type === 'approve-doc' && !playing) {
    if (productDesignApproved) {
      currentStep++;
      setTimeout(function() { advanceInteractive(); }, 200);
      return;
    }
    waitingForInteraction = true;
    currentStep++;
    return;
  }

  executeStep(step);
  currentStep++;

  if (step.type === 'typing') {
    setTimeout(function() { advanceInteractive(); }, step.duration);
  } else if (step.type === 'exec-progress') {
    runExecAnimation(function() {
      setTimeout(function() { advanceInteractive(); }, 600);
    });
    return;
  } else if (step.type === 'all-approved') {
    setTimeout(function() { advanceInteractive(); }, 1200);
  } else if (step.type === 'layout') {
    setTimeout(function() { advanceInteractive(); }, 500);
  } else if (step.type === 'switch-artifact') {
    setTimeout(function() { advanceInteractive(); }, 400);
  } else if (step.type === 'complete') {
    // Done
  } else {
    setTimeout(function() { advanceInteractive(); }, 600);
  }
}

function advanceSoon(delay) {
  setTimeout(function() {
    if (!playing && !waitingForInteraction) advanceInteractive();
  }, delay || 600);
}

// ── Step execution ────────────────────────────────────────────

function executeStep(step) {
  if (stepNumEl) stepNumEl.textContent = currentStep + 1;
  if (progressFill && window.SCRIPT) {
    var pct = ((currentStep + 1) / window.SCRIPT.length) * 100;
    progressFill.style.width = pct + '%';
  }

  switch (step.type) {
    case 'agent':
      removeTypingIndicator();
      addAgentMsg(step.text);
      if (step.phase) setPhaseActive(step.phase);
      break;

    case 'user':
      addUserMsg(step.text);
      break;

    case 'typing':
      addTypingIndicator();
      break;

    case 'decision':
      addDecisionCard(step);
      break;

    case 'artifact-card':
      addArtifactCard(step);
      break;

    case 'phase':
      setPhaseActive(step.phase);
      addPhaseDivider(step.label);
      break;

    case 'layout':
      if (step.action === 'open-doc-section') openDocSection(step.section);
      else if (step.action === 'update-doc') updateDocContent(step.section);
      else if (step.action === 'open') openArtifactPanel(step.artifact);
      else if (step.action === 'open-plan') openPlanPanel();
      else if (step.action === 'open-exec') openExecPanel();
      else if (step.action === 'close') closeArtifactPanel();
      break;

    case 'approve':
      // In auto-play, auto-approve. In interactive, wait.
      break;

    case 'approve-doc':
      // In auto-play, auto-approve. In interactive, wait.
      break;

    case 'switch-artifact':
      switchArtifact(step.artifact);
      break;

    case 'all-approved':
      showAllApproved();
      break;

    case 'exec-progress':
      // Handled by advanceAutoPlay / advanceInteractive
      return;

    case 'complete':
      completeAllPhases();
      pause();
      break;

    default:
      // Delegate to experiment-specific handler
      if (typeof window.onStepExecute === 'function') {
        window.onStepExecute(step);
      }
      break;
  }
}

// ── Phase management ──────────────────────────────────────────

function setPhaseActive(p) {
  currentPhase = p;
  // Discover which phase dots exist in the DOM
  var allPhaseIds = ['D', 'S', 'P', 'E', 'V'];
  var phases = [];
  allPhaseIds.forEach(function(ph) {
    if (document.getElementById('pd-' + ph)) phases.push(ph);
  });

  phases.forEach(function(ph) {
    var el = document.getElementById('pd-' + ph);
    if (!el) return;
    var dot = el.querySelector('.dot');
    var label = el.querySelector('.label');
    var idx = phases.indexOf(ph);
    var activeIdx = phases.indexOf(p);

    el.classList.remove('is-done', 'is-active');
    if (idx < activeIdx) {
      el.classList.add('is-done');
      if (dot) dot.className = 'dot done';
      if (label) label.className = 'label done';
    } else if (idx === activeIdx) {
      el.classList.add('is-active');
      if (dot) dot.className = 'dot active';
      if (label) label.className = 'label active';
    } else {
      if (dot) dot.className = 'dot pending';
      if (label) label.className = 'label';
    }
  });
}

function completeAllPhases() {
  var allPhaseIds = ['D', 'S', 'P', 'E', 'V'];
  allPhaseIds.forEach(function(ph) {
    var el = document.getElementById('pd-' + ph);
    if (!el) return;
    el.classList.add('is-done');
    var dot = el.querySelector('.dot');
    var label = el.querySelector('.label');
    if (dot) dot.className = 'dot done';
    if (label) label.className = 'label done';
  });
}

// ── Message rendering ─────────────────────────────────────────

function addAgentMsg(text) {
  var div = document.createElement('div');
  div.className = 'msg agent fade-in';
  div.innerHTML = text;
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function addUserMsg(text) {
  var div = document.createElement('div');
  div.className = 'msg user fade-in';
  div.textContent = text;
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function addTypingIndicator() {
  var div = document.createElement('div');
  div.className = 'typing-indicator fade-in';
  div.id = 'typingIndicator';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function removeTypingIndicator() {
  var el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function addDecisionCard(step) {
  var div = document.createElement('div');
  div.className = 'decision-card fade-in';
  div.id = 'dc-' + step.id;
  var optsHtml = '';
  step.options.forEach(function(opt, i) {
    var rec = i === step.recommended ? ' recommended' : '';
    optsHtml += '<button class="dc-opt' + rec + '" onclick="handleDecision(' + step.id + ', ' + i + ', \'' + opt.replace(/'/g, "\\'") + '\')">' + opt + '</button>';
  });
  var hintHtml = step.hint ? '<div class="dc-hint">' + step.hint + '</div>' : '';
  div.innerHTML = '<div class="dc-label">DECISION</div><div class="dc-q">' + step.question + '</div><div class="dc-opts">' + optsHtml + '</div>' + hintHtml;
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function resolveDecisionCard(id, label) {
  var el = document.getElementById('dc-' + id);
  if (el) {
    el.className = 'decision-card resolved';
    el.innerHTML = '<span class="dc-resolved">✓ ' + label + '</span>';
  }
}

function addArtifactCard(step) {
  var div = document.createElement('div');
  div.className = 'artifact-card fade-in';
  div.innerHTML = '<div class="ac-header">' + step.header + '</div><div class="ac-body">' + step.body + '</div><span class="card-peek-hint">Click to review →</span>';
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function addPhaseDivider(label) {
  var div = document.createElement('div');
  div.className = 'phase-divider fade-in';
  div.innerHTML = '<span class="pd-label">' + label + '</span>';
  if (convInner) convInner.appendChild(div);
  scrollConv();
}

function scrollConv() {
  if (!convScroll) return;
  requestAnimationFrame(function() {
    convScroll.scrollTop = convScroll.scrollHeight;
  });
}

// ── Artifact panel management ─────────────────────────────────

function openArtifactPanel(artifactIndex) {
  currentArtifact = artifactIndex;
  renderArtifact(artifactIndex);
  document.body.classList.add('split-mode');
  if (typeof window.onEnterSplit === 'function') window.onEnterSplit();
}

function renderArtifact(idx) {
  if (!window.DIFFS) return;
  var d = window.DIFFS[idx];
  if (!d) return;
  var count = approvedArtifacts.filter(Boolean).length;
  var headerEl = document.getElementById('apHeader');
  if (headerEl) {
    headerEl.innerHTML =
      '<span class="ap-badge spec" id="apBadge">SPEC</span>' +
      '<span class="ap-path" id="apPath">' + d.path + '</span>' +
      '<span class="ap-stats" id="apStats">' + d.stats + ' · ' + count + '/3 approved</span>';
  }
  var bodyEl = document.getElementById('apBody');
  if (bodyEl) bodyEl.innerHTML = '<div class="diff-view">' + d.content + '</div>';

  var actionsEl = document.getElementById('apActions');
  if (actionsEl) {
    actionsEl.innerHTML = approvedArtifacts[idx]
      ? '<span style="font-size:13px;color:var(--green);font-weight:600;padding:0 8px;">✓ Approved</span>'
      : '<button class="btn-request" onclick="requestChanges()">Request Changes</button><button class="btn-approve" id="approveBtn" onclick="handleApprove()">Approve ✓</button>';
  }
}

function switchArtifact(idx) {
  currentArtifact = idx;
  renderArtifact(idx);
}

function closeArtifactPanel() {
  document.body.classList.remove('split-mode', 'peek-mode');
  peekMode = false;
  peekSavedState = null;
  if (typeof window.onExitSplit === 'function') window.onExitSplit();
}

function closePeek() {
  peekMode = false;
  document.body.classList.remove('peek-mode');
  if (peekSavedState) {
    var headerEl = document.getElementById('apHeader');
    var bodyEl = document.getElementById('apBody');
    var actionsEl = document.getElementById('apActions');
    if (headerEl) headerEl.innerHTML = peekSavedState.header;
    if (bodyEl) bodyEl.innerHTML = peekSavedState.body;
    if (actionsEl) actionsEl.innerHTML = peekSavedState.actions;
    peekSavedState = null;
  } else {
    document.body.classList.remove('split-mode');
    if (typeof window.onExitSplit === 'function') window.onExitSplit();
  }
}

// ── Document section management ───────────────────────────────

function openDocSection(section) {
  if (!window.DOC_SECTIONS) return;
  document.body.classList.add('split-mode');
  if (typeof window.onEnterSplit === 'function') window.onEnterSplit();
  var headerEl = document.getElementById('apHeader');
  if (headerEl) {
    headerEl.innerHTML =
      '<span class="ap-badge doc" id="apBadge">DOC</span>' +
      '<span class="ap-path" id="apPath">product-design.md</span>' +
      '<span class="ap-stats" id="apStats">Building...</span>';
  }
  var bodyEl = document.getElementById('apBody');
  if (bodyEl) bodyEl.innerHTML = window.DOC_SECTIONS[section];
  var actionsEl = document.getElementById('apActions');
  if (actionsEl) actionsEl.innerHTML = '';
}

function updateDocContent(section) {
  if (!window.DOC_SECTIONS) return;
  var bodyEl = document.getElementById('apBody');
  if (bodyEl) bodyEl.innerHTML = window.DOC_SECTIONS[section];
  if (section === 'full') {
    var actionsEl = document.getElementById('apActions');
    if (actionsEl) {
      actionsEl.innerHTML =
        '<button class="btn-request" onclick="requestChanges()">Request Changes</button>' +
        '<button class="btn-approve" id="approveDocBtn" onclick="handleApproveDoc()">Approve Product Design ✓</button>';
    }
    var statsEl = document.getElementById('apStats');
    if (statsEl) statsEl.textContent = '';
  }
  if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
}

// ── Plan & Exec panels ───────────────────────────────────────

function openPlanPanel() {
  document.body.classList.add('split-mode');
  if (typeof window.onEnterSplit === 'function') window.onEnterSplit();
  var headerEl = document.getElementById('apHeader');
  if (headerEl) {
    headerEl.innerHTML =
      '<span class="ap-badge new" id="apBadge">PLAN</span>' +
      '<span class="ap-path" id="apPath">Implementation Plan</span>' +
      '<span class="ap-stats" id="apStats">2 milestones · 6 steps</span>';
  }
  var bodyEl = document.getElementById('apBody');
  if (bodyEl) bodyEl.innerHTML = buildStepsHTML('plan');
  var actionsEl = document.getElementById('apActions');
  if (actionsEl) {
    actionsEl.innerHTML =
      '<button class="btn-execute" onclick="handlePlanExecute()">Execute this plan</button>';
  }
}

function openExecPanel() {
  document.body.classList.add('split-mode');
  if (typeof window.onEnterSplit === 'function') window.onEnterSplit();
  var headerEl = document.getElementById('apHeader');
  if (headerEl) {
    headerEl.innerHTML =
      '<span class="ap-badge exec" id="apBadge">EXEC</span>' +
      '<span class="ap-path" id="apPath">Executing Plan</span>' +
      '<span class="ap-stats" id="apStats"><span id="execCounter">0/6 complete</span></span>';
  }
  var bodyEl = document.getElementById('apBody');
  if (bodyEl) bodyEl.innerHTML = buildStepsHTML('exec');
  var actionsEl = document.getElementById('apActions');
  if (actionsEl) actionsEl.innerHTML = '';
  var cp = document.getElementById('codePreview');
  if (cp) cp.classList.add('visible');
}

function buildStepsHTML(mode) {
  if (!window.EXEC_STEPS) return '';
  var state = mode === 'exec' ? 'pending' : 'ready';
  var html = '<div class="steps-panel"><div class="steps-list">';
  html += '<div class="steps-milestone">Milestone 1: Core Auth</div>';
  window.EXEC_STEPS.slice(0, 4).forEach(function(s, i) {
    html += '<div class="step-row ' + state + '" id="sr-' + i + '"><span class="step-icon">' + (i + 1) + '</span><span class="step-name">' + s.name + '</span><span class="step-file">' + s.file + '</span></div>';
  });
  html += '<div class="steps-milestone">Milestone 2: API &amp; Admin</div>';
  window.EXEC_STEPS.slice(4).forEach(function(s, i) {
    var idx = i + 4;
    html += '<div class="step-row ' + state + '" id="sr-' + idx + '"><span class="step-icon">' + (idx + 1) + '</span><span class="step-name">' + s.name + '</span><span class="step-file">' + s.file + '</span></div>';
  });
  html += '</div>';
  html += '<div class="code-preview" id="codePreview"><div class="code-preview-header" id="codePreviewHeader"><span class="cph-file">Waiting...</span></div><div class="code-preview-body" id="codePreviewBody"></div></div>';
  html += '</div>';
  return html;
}

// ── Execution animation ───────────────────────────────────────

function runExecAnimation(callback) {
  execAnimationRunning = true;
  var stepIdx = 0;
  var msgIdx = 0;

  function runNextExecStep() {
    if (!window.EXEC_STEPS || stepIdx >= window.EXEC_STEPS.length) {
      execAnimationRunning = false;
      var counter = document.getElementById('execCounter');
      if (counter) counter.textContent = window.EXEC_STEPS.length + '/' + window.EXEC_STEPS.length + ' complete';
      if (callback) callback();
      return;
    }

    var stepEl = document.getElementById('sr-' + stepIdx);
    if (stepEl) {
      stepEl.className = 'step-row running';
      stepEl.querySelector('.step-icon').textContent = '●';
    }

    var codeHeader = document.getElementById('codePreviewHeader');
    if (codeHeader) {
      codeHeader.innerHTML = '<span class="cph-file">' + window.EXEC_STEPS[stepIdx].file + '</span>';
    }

    var codeBody = document.getElementById('codePreviewBody');
    if (codeBody && window.EXEC_CODE_SNIPPETS) {
      codeBody.innerHTML = '';
      var snippet = window.EXEC_CODE_SNIPPETS[stepIdx];
      var lineIdx = 0;

      function addNextLine() {
        if (lineIdx >= snippet.length) {
          setTimeout(function() {
            if (stepEl) {
              stepEl.className = 'step-row done';
              stepEl.querySelector('.step-icon').textContent = '✓';
            }
            var counter = document.getElementById('execCounter');
            if (counter) counter.textContent = (stepIdx + 1) + '/' + window.EXEC_STEPS.length + ' complete';
            if (window.EXEC_MESSAGES && msgIdx < window.EXEC_MESSAGES.length) {
              addAgentMsg(window.EXEC_MESSAGES[msgIdx]);
              msgIdx++;
            }
            if (window.EXEC_MESSAGES && msgIdx < window.EXEC_MESSAGES.length) {
              setTimeout(function() {
                addAgentMsg(window.EXEC_MESSAGES[msgIdx]);
                msgIdx++;
                stepIdx++;
                setTimeout(runNextExecStep, 200);
              }, 250);
            } else {
              stepIdx++;
              setTimeout(runNextExecStep, 200);
            }
          }, 300);
          return;
        }
        var line = snippet[lineIdx];
        var lineEl = document.createElement('div');
        if (line.t === 'hunk') {
          lineEl.className = 'diff-hunk-header';
          lineEl.textContent = line.v;
        } else {
          lineEl.className = 'diff-line add';
          lineEl.style.animationDelay = (lineIdx * 0.03) + 's';
          lineEl.innerHTML = '<span class="ln">' + line.ln + '</span>' + escapeHtml(line.v);
        }
        codeBody.appendChild(lineEl);
        codeBody.scrollTop = codeBody.scrollHeight;
        lineIdx++;
        setTimeout(addNextLine, 60 + Math.random() * 40);
      }
      addNextLine();
    } else {
      stepIdx++;
      setTimeout(runNextExecStep, 500);
    }
  }

  if (window.EXEC_MESSAGES && window.EXEC_MESSAGES.length > 0) {
    addAgentMsg(window.EXEC_MESSAGES[msgIdx]);
    msgIdx++;
  }
  setTimeout(runNextExecStep, 400);
}

// ── All-approved flash ────────────────────────────────────────

function showAllApproved() {
  var flash = document.createElement('div');
  flash.className = 'all-approved-flash';
  flash.textContent = 'All specs approved ✔';
  flash.style.position = 'fixed';
  flash.style.zIndex = '200';
  document.body.appendChild(flash);
  setTimeout(function() { flash.remove(); }, 1400);
}

// ── User interaction handlers ─────────────────────────────────

function handleDecision(id, choiceIdx, label) {
  var cleanLabel = label.replace(/\s*★/, '');
  resolveDecisionCard(id, cleanLabel);
  waitingForInteraction = false;
  if (playing) return;
  setTimeout(function() { advanceInteractive(); }, 400);
}

function handleApprove() {
  approvedArtifacts[currentArtifact] = true;
  renderArtifact(currentArtifact);
  waitingForInteraction = false;
  if (!playing) {
    setTimeout(function() { advanceInteractive(); }, 400);
  }
}

function handleApproveDoc() {
  productDesignApproved = true;
  var btn = document.getElementById('approveDocBtn');
  if (btn) {
    btn.textContent = 'Approved ✔';
    btn.style.background = 'var(--green-sub)';
    btn.style.color = 'var(--green)';
    btn.style.pointerEvents = 'none';
  }
  waitingForInteraction = false;
  if (!playing) {
    setTimeout(function() { advanceInteractive(); }, 400);
  }
}

function handlePlanExecute() {
  waitingForInteraction = false;
  if (!playing) {
    var unresolved = document.querySelectorAll('.decision-card:not(.resolved)');
    unresolved.forEach(function(dc) {
      dc.className = 'decision-card resolved';
      dc.innerHTML = '<span class="dc-resolved">✓ Execute this plan</span>';
    });
    setTimeout(function() { advanceInteractive(); }, 400);
  }
}

function requestChanges() {
  var btn = document.querySelector('.btn-request');
  if (btn) {
    btn.textContent = 'Not in mockup';
    setTimeout(function() { btn.textContent = 'Request Changes'; }, 1000);
  }
}

function handleSend() {
  if (!userInput) return;
  var text = userInput.value.trim();
  if (!text) return;
  addUserMsg(text);
  userInput.value = '';
  userInput.placeholder = 'Type a message...';
  if (sendBtn) sendBtn.disabled = true;
  waitingForInteraction = false;
  if (!playing) {
    setTimeout(function() { advanceInteractive(); }, 400);
  }
}

function handleInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (waitingForInteraction && userInput && userInput.value.trim()) {
      handleSend();
    }
  }
}

// ── Step forward (manual) ─────────────────────────────────────

function stepForward() {
  if (playing) return;

  if (peekMode) {
    closePeek();
    return;
  }

  if (waitingForInteraction && window.SCRIPT) {
    var step = window.SCRIPT[currentStep - 1] || window.SCRIPT[currentStep];
    if (step && step.type === 'decision') {
      resolveDecisionCard(step.id, step.options[step.recommended].replace(/\s*★/, ''));
      waitingForInteraction = false;
      setTimeout(function() { advanceInteractive(); }, 200);
    } else if (step && step.type === 'approve') {
      handleApprove();
    } else if (step && step.type === 'approve-doc') {
      handleApproveDoc();
    } else if (step && step.type === 'user' && step.interactive) {
      addUserMsg(step.placeholder || step.text);
      if (userInput) userInput.value = '';
      if (sendBtn) sendBtn.disabled = true;
      waitingForInteraction = false;
      setTimeout(function() { advanceInteractive(); }, 200);
    }
    return;
  }
  advanceInteractive();
}

// ── Reset ─────────────────────────────────────────────────────

function resetFlow() {
  pause();
  currentStep = 0;
  approvedArtifacts = [false, false, false];
  currentArtifact = 0;
  waitingForInteraction = false;
  currentPhase = null;
  peekMode = false;
  peekSavedState = null;
  productDesignApproved = false;
  execAnimationRunning = false;

  if (convInner) convInner.innerHTML = '';
  closeArtifactPanel();
  if (stepNumEl) stepNumEl.textContent = '0';
  if (progressFill) progressFill.style.width = '0%';
  if (userInput) {
    userInput.value = '';
    userInput.placeholder = 'Type a message...';
  }
  if (sendBtn) sendBtn.disabled = true;

  // Reset phase dots
  var allPhaseIds = ['D', 'S', 'P', 'E', 'V'];
  allPhaseIds.forEach(function(ph) {
    var el = document.getElementById('pd-' + ph);
    if (!el) return;
    el.classList.remove('is-done', 'is-active');
    var dot = el.querySelector('.dot');
    var label = el.querySelector('.label');
    if (dot) dot.className = 'dot pending';
    if (label) label.className = 'label';
  });

  // Reset artifact panel actions
  var actionsEl = document.getElementById('apActions');
  if (actionsEl) {
    actionsEl.innerHTML =
      '<button class="btn-request" onclick="requestChanges()">Request Changes</button>' +
      '<button class="btn-approve" id="approveBtn" onclick="handleApprove()">Approve ✓</button>';
  }

  // Call experiment-specific reset
  if (typeof window.onReset === 'function') window.onReset();

  setTimeout(function() { advanceInteractive(); }, 300);
}

// ── Utility ───────────────────────────────────────────────────

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Keyboard shortcuts ────────────────────────────────────────

document.addEventListener('keydown', function(e) {
  if (userInput && e.target === userInput) return;

  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'Escape') {
    e.preventDefault();
    if (peekMode) {
      closePeek();
    } else {
      resetFlow();
    }
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    stepForward();
  }
  // Other keys are left for experiments to handle
});
