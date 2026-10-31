/**
 * Standalone Web UI for PiBots (Grok Bot open-source clone).
 * Built following strict typography, spacing, flat dark surface, and motion tokens.
 */
export function renderPiBotsWebAppHtml(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PiBots Workspace | AI teammates with their own computer</title>
  <meta name="description" content="Open source AI teammates with compounding memory, shared computer workspace, routines, Vault, and Auto Review powered by Pi Agent SDK." />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-style: normal;
    }

    :root {
      --bg-0: #000000;
      --bg-1: #181818;
      --bg-2: #1F1F1F;
      --bg-3: #272727;
      --bg-4: #313131;
      --bg-warm: #131209;
      --text-primary: #FFFFFF;
      --text-secondary: #9B9B9B;
      --border-subtle: #272727;
      --border-strong: #313131;
      --accent: #10B981;
      --warn: #F59E0B;
      --danger: #EF4444;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    }

    body {
      font-family: "Geist", sans-serif;
      background-color: var(--bg-0);
      color: var(--text-primary);
      font-size: 14px;
      line-height: 20px;
      text-wrap: pretty;
      min-height: 100vh;
    }

    h1, h2, h3, h4 {
      font-weight: 600;
      text-wrap: balance;
    }

    code, pre, .mono {
      font-family: "Geist Mono", monospace;
    }

    .skip-link {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      padding: 8px 12px;
      background: var(--bg-3);
      color: var(--text-primary);
      border-radius: 8px;
    }
    .skip-link:focus {
      opacity: 1;
      pointer-events: auto;
      outline: 2px solid var(--accent);
    }

    .app-shell {
      display: grid;
      grid-template-columns: 280px 1fr 340px;
      gap: 16px;
      padding: 16px;
      height: 100vh;
      background-color: var(--bg-0);
    }

    @media (max-width: 1100px) {
      .app-shell {
        grid-template-columns: 260px 1fr;
      }
      .right-panel {
        display: none;
      }
    }

    .panel {
      background-color: var(--bg-1);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow: hidden;
    }

    .card {
      background-color: var(--bg-2);
      border: 1px solid var(--border-strong);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: transform 300ms var(--ease-out), opacity 300ms var(--ease-out), background-color 300ms var(--ease-out);
    }

    .card:hover {
      background-color: var(--bg-3);
    }

    .btn {
      font-family: "Geist", sans-serif;
      font-size: 14px;
      line-height: 20px;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background-color: var(--bg-3);
      color: var(--text-primary);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: transform 300ms var(--ease-out), opacity 300ms var(--ease-out), background-color 300ms var(--ease-out);
    }

    .btn:hover {
      background-color: var(--bg-4);
      transform: translateY(-1px);
    }

    .btn:active {
      transform: scale(0.98);
    }

    .btn:focus-visible, .input:focus-visible, .textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .btn-primary {
      background-color: var(--accent);
      color: #000000;
      border-color: var(--accent);
      font-size: 16px;
      line-height: 24px;
    }

    .btn-primary:hover {
      opacity: 0.92;
      background-color: var(--accent);
    }

    .btn-danger {
      background-color: var(--bg-3);
      color: var(--danger);
      border-color: var(--danger);
    }

    .input, .textarea, .select {
      font-family: "Geist", sans-serif;
      font-size: 14px;
      line-height: 20px;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background-color: var(--bg-2);
      color: var(--text-primary);
      width: 100%;
    }

    .scroll-area {
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    .bot-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background-color: var(--bg-2);
      cursor: pointer;
      transition: transform 300ms var(--ease-out), background-color 300ms var(--ease-out);
    }

    .bot-item:hover {
      background-color: var(--bg-3);
    }

    .bot-item.active {
      background-color: var(--bg-3);
      border-color: var(--accent);
    }

    .avatar-dot {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background-color: var(--bg-4);
      border: 1px solid var(--border-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      line-height: 20px;
      flex-shrink: 0;
    }

    .badge {
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
      background-color: var(--bg-4);
      color: var(--text-primary);
      border: 1px solid var(--border-strong);
    }

    .nav-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .tab-btn {
      font-size: 12px;
      line-height: 16px;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: 8px;
      background-color: var(--bg-2);
      color: var(--text-secondary);
      border: 1px solid var(--border-subtle);
      cursor: pointer;
      transition: transform 300ms var(--ease-out), background-color 300ms var(--ease-out);
    }

    .tab-btn.active {
      background-color: var(--bg-4);
      color: var(--text-primary);
      border-color: var(--accent);
    }

    .hero-title {
      font-size: 20px;
      line-height: 28px;
      font-weight: 700;
      max-width: 680px;
      background: linear-gradient(90deg, #FFFFFF, #9B9B9B);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .msg-bubble {
      padding: 12px;
      border-radius: 8px;
      border: 1px solid var(--border-strong);
      background-color: var(--bg-2);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .msg-bubble.user {
      background-color: var(--bg-3);
    }

    .approval-card {
      background-color: var(--bg-warm);
      border: 1px solid var(--warn);
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .muted {
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 16px;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition-duration: 200ms !important;
        transform: none !important;
      }
    }
  </style>
</head>
<body>
  <a href="#main-workspace" class="skip-link">Skip to workspace</a>
  <div class="app-shell">
    <!-- LEFT SIDEBAR: ROSTER & GROUP CHATS -->
    <aside class="panel" aria-label="Bot Roster and Group Chats">
      <div class="row">
        <div>
          <h1 class="hero-title">PiBots</h1>
          <p class="muted">AI teammates with their own computer</p>
        </div>
        <button class="btn" id="btn-new-bot" title="Create a new Bot">New Bot</button>
      </div>

      <div class="nav-tabs" role="tablist">
        <button class="tab-btn active" data-mode="bots">Roster</button>
        <button class="tab-btn" data-mode="groups">Groups</button>
        <button class="tab-btn" data-mode="templates">Templates</button>
      </div>

      <div id="sidebar-list" class="scroll-area"></div>

      <div class="card">
        <div class="row">
          <span style="font-weight: 600;">Shared Computer</span>
          <span class="badge" id="comp-status-badge">Awake</span>
        </div>
        <p class="muted mono" id="comp-workspace-path">/workspace</p>
        <p class="muted" id="comp-email-addr">team@pibots.local</p>
      </div>
    </aside>

    <!-- CENTER MAIN: CONVERSATION, CARDS & COMPOSER -->
    <main id="main-workspace" class="panel">
      <header class="row" style="padding-bottom: 8px;">
        <div>
          <h2 id="active-bot-title" style="font-size: 18px; line-height: 28px;">Atlas</h2>
          <p id="active-bot-subtitle" class="muted">Chief of Staff · Primary Bot</p>
        </div>
        <div class="row">
          <button class="btn" id="btn-teach-task">Teach a task</button>
          <button class="btn" id="btn-voice-call">Voice chat</button>
          <button class="btn" id="btn-reset-chat">Reset chat</button>
        </div>
      </header>

      <div id="chat-stream" class="scroll-area" aria-live="polite"></div>

      <form id="chat-form" style="display: flex; flex-direction: column; gap: 8px;">
        <textarea
          id="chat-input"
          class="textarea"
          rows="3"
          placeholder="Message your Bot like a teammate. Give a task, sources, and approval boundary..."
          required
        ></textarea>
        <div class="row">
          <span class="muted" id="composer-hint">Powered by Pi Agent SDK · Auto Review active</span>
          <div class="row">
            <button type="button" class="btn" id="btn-stop-work">Stop now</button>
            <button type="submit" class="btn btn-primary" id="btn-send-msg">Send task</button>
          </div>
        </div>
      </form>
    </main>

    <!-- RIGHT INSPECTOR: COMPUTER, PAGES, SKILLS, ROUTINES, VAULT, AUTO REVIEW -->
    <aside class="panel right-panel" aria-label="Shared Computer and Controls">
      <div class="nav-tabs">
        <button class="tab-btn active" data-inspector="approvals">Approvals & Drafts</button>
        <button class="tab-btn" data-inspector="pages">Pages</button>
        <button class="tab-btn" data-inspector="routines">Routines</button>
        <button class="tab-btn" data-inspector="skills">Skills</button>
        <button class="tab-btn" data-inspector="vault">Vault</button>
        <button class="tab-btn" data-inspector="rules">Auto Review</button>
        <button class="tab-btn" data-inspector="computer">Computer</button>
      </div>

      <div id="inspector-content" class="scroll-area"></div>
    </aside>
  </div>

  <script>
    const state = {
      mode: "bots",
      inspector: "approvals",
      activeBotId: null,
      activeGroupId: null,
      snapshot: null,
      loading: false
    };

    async function api(path, options = {}) {
      const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...options
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      return data;
    }

    function escapeHtml(str) {
      return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    async function refreshState() {
      state.snapshot = await api("/api/state");
      if (!state.activeBotId && state.snapshot.bots.length > 0) {
        const primary = state.snapshot.bots.find(b => b.isPrimary) || state.snapshot.bots[0];
        state.activeBotId = primary.id;
      }
      renderSidebar();
      renderMainHeader();
      renderChatStream();
      renderInspector();
    }

    function renderSidebar() {
      const el = document.getElementById("sidebar-list");
      const snap = state.snapshot;
      if (!snap) return;

      document.getElementById("comp-status-badge").textContent = snap.computer.status;
      document.getElementById("comp-workspace-path").textContent = snap.computer.workspaceDir;
      document.getElementById("comp-email-addr").textContent = snap.computer.agentEmailAddress;

      if (state.mode === "bots") {
        el.innerHTML = snap.bots.filter(b => !b.hidden).map(bot => {
          const isActive = state.activeBotId === bot.id && !state.activeGroupId;
          return \`
            <div class="bot-item \${isActive ? "active" : ""}" onclick="selectBot('\${bot.id}')">
              <div class="row" style="justify-content: flex-start; gap: 12px;">
                <div class="avatar-dot" style="color: \${escapeHtml(bot.avatar.color)};">\${escapeHtml(bot.name.slice(0, 2).toUpperCase())}</div>
                <div>
                  <div style="font-weight: 600;">\${escapeHtml(bot.name)}</div>
                  <div class="muted">\${escapeHtml(bot.label)}</div>
                </div>
              </div>
              \${bot.isPrimary ? '<span class="badge">Primary</span>' : ""}
            </div>
          \`;
        }).join("");
      } else if (state.mode === "groups") {
        el.innerHTML = snap.groupChats.map(g => {
          const isActive = state.activeGroupId === g.id;
          return \`
            <div class="bot-item \${isActive ? "active" : ""}" onclick="selectGroup('\${g.id}')">
              <div>
                <div style="font-weight: 600;">\${escapeHtml(g.name)}</div>
                <div class="muted">\${g.botIds.length} Bots collaborating</div>
              </div>
              <span class="badge">Group</span>
            </div>
          \`;
        }).join("");
      } else {
        el.innerHTML = snap.templates.map(t => \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">\${escapeHtml(t.name)}</span>
              <span class="badge">\${escapeHtml(t.label)}</span>
            </div>
            <p class="muted">\${escapeHtml(t.job.slice(0, 110))}...</p>
            <button class="btn" onclick="importTemplate('\${t.id}')">Import Bot</button>
          </div>
        \`).join("");
      }
    }

    function renderMainHeader() {
      const snap = state.snapshot;
      if (!snap) return;
      const titleEl = document.getElementById("active-bot-title");
      const subEl = document.getElementById("active-bot-subtitle");

      if (state.activeGroupId) {
        const grp = snap.groupChats.find(g => g.id === state.activeGroupId);
        if (grp) {
          titleEl.textContent = grp.name;
          subEl.textContent = grp.description || "Multi Bot group collaboration";
        }
        return;
      }

      const bot = snap.bots.find(b => b.id === state.activeBotId);
      if (bot) {
        titleEl.textContent = bot.name;
        subEl.textContent = \`\${bot.label}\${bot.isPrimary ? " · Primary Bot" : ""}\`;
      }
    }

    function renderChatStream() {
      const el = document.getElementById("chat-stream");
      const snap = state.snapshot;
      if (!snap) return;

      if (state.activeGroupId) {
        const grp = snap.groupChats.find(g => g.id === state.activeGroupId);
        const msgs = grp ? grp.messages : [];
        if (msgs.length === 0) {
          el.innerHTML = '<div class="card"><p class="muted">Start a group conversation. Mention @BotName to route tasks across your roster.</p></div>';
          return;
        }
        el.innerHTML = msgs.map(m => \`
          <div class="msg-bubble \${m.senderType === "user" ? "user" : ""}">
            <div class="row">
              <span style="font-weight: 600;">\${escapeHtml(m.senderName)}</span>
              <span class="muted">\${new Date(m.createdAt).toLocaleTimeString()}</span>
            </div>
            <div style="white-space: pre-wrap;">\${escapeHtml(m.content)}</div>
          </div>
        \`).join("");
        el.scrollTop = el.scrollHeight;
        return;
      }

      const bot = snap.bots.find(b => b.id === state.activeBotId);
      const msgs = (bot && snap.transcripts[bot.id]) ? snap.transcripts[bot.id] : [];
      if (msgs.length === 0 && bot) {
        el.innerHTML = \`
          <div class="card">
            <div style="font-weight: 600;">Role & operating boundary for \${escapeHtml(bot.name)}</div>
            <p class="muted" style="white-space: pre-wrap;">\${escapeHtml(bot.job)}</p>
          </div>
        \`;
        return;
      }

      el.innerHTML = msgs.map(m => \`
        <div class="msg-bubble \${m.role === "user" ? "user" : ""}">
          <div class="row">
            <span style="font-weight: 600;">\${m.role === "user" ? "You" : escapeHtml(bot ? bot.name : "Bot")}</span>
            <span class="muted">\${escapeHtml(m.origin)} · \${new Date(m.createdAt).toLocaleTimeString()}</span>
          </div>
          <div style="white-space: pre-wrap;">\${escapeHtml(m.content)}</div>
        </div>
      \`).join("");
      el.scrollTop = el.scrollHeight;
    }

    function renderInspector() {
      const el = document.getElementById("inspector-content");
      const snap = state.snapshot;
      if (!snap) return;

      if (state.inspector === "approvals") {
        const pendingCards = snap.approvalCards.filter(c => c.status === "pending");
        const pendingDrafts = snap.drafts.filter(d => d.status === "needs_approval");
        let html = "";

        if (pendingCards.length === 0 && pendingDrafts.length === 0) {
          html += '<div class="card"><div style="font-weight: 600;">All clear</div><p class="muted">No pending approval cards or drafts waiting on you.</p></div>';
        }

        for (const card of pendingCards) {
          html += \`
            <div class="approval-card">
              <div class="row">
                <span style="font-weight: 600;">Approval needed</span>
                <span class="badge">\${escapeHtml(card.appName || card.toolName)}</span>
              </div>
              <div>\${escapeHtml(card.actionSummary)}</div>
              \${card.warnings.map(w => \`<div class="muted" style="color: var(--warn);">Warning: \${escapeHtml(w)}</div>\`).join("")}
              <div class="row" style="justify-content: flex-start;">
                <button class="btn btn-primary" onclick="resolveApproval('\${card.id}', 'allow_once')">Allow once</button>
                \${card.canAlwaysAllow ? \`<button class="btn" onclick="resolveApproval('\${card.id}', 'always_allow')">Always allow</button>\` : ""}
                <button class="btn btn-danger" onclick="resolveApproval('\${card.id}', 'deny')">Deny</button>
              </div>
            </div>
          \`;
        }

        for (const draft of pendingDrafts) {
          html += \`
            <div class="card">
              <div class="row">
                <span style="font-weight: 600;">Draft (\${escapeHtml(draft.channel)})</span>
                <span class="badge">Needs approval</span>
              </div>
              <div class="muted">To: \${escapeHtml(draft.to.join(", "))}</div>
              \${draft.subject ? \`<div style="font-weight: 600;">\${escapeHtml(draft.subject)}</div>\` : ""}
              <div style="white-space: pre-wrap;">\${escapeHtml(draft.body)}</div>
              <div class="row" style="justify-content: flex-start;">
                <button class="btn btn-primary" onclick="sendDraft('\${draft.id}')">Send</button>
                <button class="btn btn-danger" onclick="discardDraft('\${draft.id}')">Discard</button>
              </div>
            </div>
          \`;
        }
        el.innerHTML = html;
      } else if (state.inspector === "pages") {
        el.innerHTML = snap.pages.map(p => \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">\${escapeHtml(p.title)}</span>
              <span class="badge">\${escapeHtml(p.visibility)}</span>
            </div>
            <div class="muted" style="white-space: pre-wrap;">\${escapeHtml(p.content.slice(0, 280))}</div>
          </div>
        \`).join("");
      } else if (state.inspector === "routines") {
        el.innerHTML = snap.routines.map(r => \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">\${escapeHtml(r.name)}</span>
              <span class="badge">\${r.enabled ? "Active" : "Paused"}</span>
            </div>
            <div class="muted">\${r.trigger.type === "schedule" ? escapeHtml(r.trigger.scheduleText) : "Event: " + escapeHtml(r.trigger.eventType + " (" + r.trigger.filter + ")")}</div>
            <p class="muted">\${escapeHtml(r.instructions)}</p>
            <button class="btn" onclick="runRoutine('\${r.id}')">Test routine now</button>
          </div>
        \`).join("");
      } else if (state.inspector === "skills") {
        el.innerHTML = snap.skills.map(s => \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">\${escapeHtml(s.name)}</span>
              <span class="badge mono">\${escapeHtml(s.slug)}</span>
            </div>
            <p class="muted">\${escapeHtml(s.description)}</p>
          </div>
        \`).join("");
      } else if (state.inspector === "vault") {
        el.innerHTML = \`
          <div class="card">
            <div style="font-weight: 600;">Zero knowledge Vault</div>
            <p class="muted">Saved passwords, card numbers, and secrets are write only and never shown to the model.</p>
          </div>
          \${snap.vaultSafe.map(v => \`
            <div class="card">
              <div class="row">
                <span style="font-weight: 600;">\${escapeHtml(v.label)}</span>
                <span class="badge">\${escapeHtml(v.type)}</span>
              </div>
              \${v.hints ? \`<div class="muted">Hint: \${escapeHtml(v.hints)}</div>\` : ""}
            </div>
          \`).join("")}
        \`;
      } else if (state.inspector === "rules") {
        el.innerHTML = \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">Auto Review</span>
              <span class="badge">\${snap.autoReview.enabled ? "On" : "Off"}</span>
            </div>
            <p class="muted">Ask first rules always win when both rule types match.</p>
          </div>
          \${snap.autoReview.customRules.map(rule => \`
            <div class="card">
              <div class="row">
                <span class="badge">\${rule.behavior === "ask_first" ? "Ask first" : "Allow automatically"}</span>
              </div>
              <div>When Bot wants to: \${escapeHtml(rule.whenAction)}</div>
            </div>
          \`).join("")}
        \`;
      } else if (state.inspector === "computer") {
        el.innerHTML = \`
          <div class="card">
            <div class="row">
              <span style="font-weight: 600;">Shared Cloud Computer</span>
              <span class="badge">\${escapeHtml(snap.computer.status)}</span>
            </div>
            <div class="muted mono">\${escapeHtml(snap.computer.workspaceDir)}</div>
            <div class="muted">Agent Email: \${escapeHtml(snap.computer.agentEmailAddress)}</div>
          </div>
          \${(snap.workspaceFiles || []).map(f => \`
            <div class="card">
              <div class="row">
                <span class="mono">\${escapeHtml(f.relativePath)}</span>
                <span class="badge">\${f.isDirectory ? "Folder" : f.sizeBytes + " B"}</span>
              </div>
            </div>
          \`).join("")}
        \`;
      }
    }

    window.selectBot = (botId) => {
      state.activeGroupId = null;
      state.activeBotId = botId;
      renderSidebar();
      renderMainHeader();
      renderChatStream();
    };

    window.selectGroup = (groupId) => {
      state.activeGroupId = groupId;
      renderSidebar();
      renderMainHeader();
      renderChatStream();
    };

    window.resolveApproval = async (cardId, decision) => {
      await api(\`/api/approvals/\${cardId}/resolve\`, {
        method: "POST",
        body: JSON.stringify({ decision })
      });
      await refreshState();
    };

    window.sendDraft = async (draftId) => {
      await api(\`/api/drafts/\${draftId}/send\`, { method: "POST" });
      await refreshState();
    };

    window.discardDraft = async (draftId) => {
      await api(\`/api/drafts/\${draftId}/discard\`, { method: "POST" });
      await refreshState();
    };

    window.runRoutine = async (routineId) => {
      await api(\`/api/routines/\${routineId}/run\`, { method: "POST" });
      await refreshState();
    };

    window.importTemplate = async (templateId) => {
      await api("/api/templates/import", {
        method: "POST",
        body: JSON.stringify({ templateId })
      });
      state.mode = "bots";
      await refreshState();
    };

    document.querySelectorAll("[data-mode]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-mode]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.mode = btn.getAttribute("data-mode");
        renderSidebar();
      });
    });

    document.querySelectorAll("[data-inspector]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-inspector]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.inspector = btn.getAttribute("data-inspector");
        renderInspector();
      });
    });

    document.getElementById("chat-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("chat-input");
      const message = input.value.trim();
      if (!message) return;
      input.value = "";
      document.getElementById("btn-send-msg").textContent = "Working...";

      try {
        if (state.activeGroupId) {
          await api(\`/api/groups/\${state.activeGroupId}/messages\`, {
            method: "POST",
            body: JSON.stringify({ content: message })
          });
        } else if (state.activeBotId) {
          await api(\`/api/bots/\${state.activeBotId}/chat\`, {
            method: "POST",
            body: JSON.stringify({ message })
          });
        }
      } finally {
        document.getElementById("btn-send-msg").textContent = "Send task";
        await refreshState();
      }
    });

    document.getElementById("btn-stop-work").addEventListener("click", async () => {
      if (!state.activeBotId) return;
      await api(\`/api/bots/\${state.activeBotId}/chat\`, {
        method: "POST",
        body: JSON.stringify({ message: "Stop now" })
      });
      await refreshState();
    });

    document.getElementById("btn-reset-chat").addEventListener("click", async () => {
      if (!state.activeBotId) return;
      await api(\`/api/bots/\${state.activeBotId}/reset\`, { method: "POST" });
      await refreshState();
    });

    document.getElementById("btn-new-bot").addEventListener("click", async () => {
      const name = prompt("Bot name (e.g. Orion):");
      if (!name) return;
      const label = prompt("Role title (e.g. Talent Scout):") || "Specialist";
      const job = prompt("Operational role and approval boundary:") || "Own assigned tasks in /workspace and ask before external actions.";
      const created = await api("/api/bots", {
        method: "POST",
        body: JSON.stringify({ name, label, job })
      });
      state.activeBotId = created.id;
      await refreshState();
    });

    document.getElementById("btn-teach-task").addEventListener("click", async () => {
      if (!state.activeBotId) return;
      const goal = prompt("Describe the workflow you are about to demonstrate:");
      if (!goal) return;
      const step = prompt("Demonstrated step summary (command or browser action):") || "Inspected /workspace and generated report";
      await api("/api/demonstrations/quick-teach", {
        method: "POST",
        body: JSON.stringify({ botId: state.activeBotId, goalDescription: goal, steps: [step] })
      });
      state.inspector = "skills";
      await refreshState();
    });

    document.getElementById("btn-voice-call").addEventListener("click", async () => {
      if (!state.activeBotId) return;
      const call = await api(\`/api/bots/\${state.activeBotId}/voice-call\`, { method: "POST" });
      await api(\`/api/voice-calls/\${call.id}/end\`, { method: "POST" });
      await refreshState();
    });

    refreshState();
  </script>
</body>
</html>`;
}
