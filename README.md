# PiBots — Open-Source Grok Bot Built on the Pi Agent SDK

**PiBots** is an open-source implementation of **Grok Bot** (AI teammates with names, roles, a shared persistent computer, compounding memory, multi-bot handoffs, group chats, reusable skills, scheduled/event routines, zero-knowledge Vault, and Auto Review approval cards) built directly on the **Pi Agent libraries** (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`).

---

## Core Grok Bot Functionalities Implemented

1. **Named AI Teammates & Roster Management (`PiBotsHub`, `BotRuntimeSession`)**
   - Each Bot has its own durable `AgentSession`, name, role label (`Chief of Staff`, `Sales Outbound`, `Bug Reproduction`, `Account Health`, `Expense Manager`, `Talent Scout`), avatar (`shape` + `color`), section grouping, pin/hide controls, and conversation history.
   - **Primary Bot**: Designated main point of contact (`Atlas — Chief of Staff`) that coordinates work across specialist Bots on the roster.
   - **Bot Templates & Duplication**: Duplicate a Bot for a new scope or export/import public and team `BotTemplate` definitions (sharing role, skills, and routines without exposing private memory, conversations, or Vault credentials).

2. **One Shared Cloud Computer (`/workspace`)**
   - Every Bot on the account shares the same persistent `/workspace` filesystem, connected apps, and Pi coding tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `codemode`, `tool_search`, and MCP servers).
   - Each Bot gets its own active work screen (`computer.activeScreens[botId]`) so multiple Bots can run in parallel (`hub.runParallelBotTasks(...)`).
   - Supports human takeover (`requestComputerTakeover` / `completeComputerTakeover`) for sensitive steps like SSO, passkeys, CAPTCHAs, or bank verification.

3. **Compounding Memory (`MemoryManager`)**
   - **Per-Bot Memory**: Retains lasting rules (`rule`), working style preferences (`preference`), role facts (`fact`), and a dated log of completed work (`work_log`). Memory persists across `resetConversation()`.
   - **Account-Wide Shared Facts**: Core facts about the user (such as name, timezone, and working style) are automatically shared across all Bots on the account (`sharedFacts`).
   - **Memory Import**: Import memories from another AI assistant directly into the Primary Bot (`importFromOtherAssistant`).

4. **Multi-Bot Coordination, Handoffs & Group Chats**
   - **Direct Bot-to-Bot Handoffs (`bot_handoff`)**: A Bot can message another specialist Bot and hand off a task on `/workspace`, receiving the finished work back in-thread.
   - **Multi-Bot Group Chats (`createGroupChat`, `postUserMessageInGroup`, `group_post`)**: Place multiple Bots in a shared thread where `@BotName` mentions route turns and pass task ownership (`activeOwnerBotId`).
   - **Tag `@bot` on X (`handleXTagMention`)**: Confirms with a short public reply while the user's Primary Bot picks up the post as a task.

5. **Skills & Teach-by-Demonstration (`SkillsManager`)**
   - Captures reusable 6-part Grok Bot skills (When to use, Required inputs & access, Sequence of work, Validation, Expected output, Approval boundaries).
   - Materializes skills as native Pi SDK `SKILL.md` files under `<workspace>/.pi/skills/<slug>/SKILL.md` and injects them into `DefaultResourceLoader`.
   - **Teach a Task (`startDemonstration`, `recordDemonstrationStep`, `finishDemonstration`)**: Record demonstrated steps (automatically redacting any Vault secrets) and synthesize a reusable Skill.

6. **Routines — Scheduled & Event-Driven Automations (`RoutineScheduler`)**
   - **Schedule Triggers**: Natural schedule phrases (`"every weekday at 8:00 AM"`, `"every 2 hours"`, `"every 30 minutes"`) with timezone support.
   - **Event Triggers**: Incoming email (`email` with `+tag` and `*@domain` filters and sender authentication verification), `slack`, `github`, `linear`, `sentry`, `pagerduty`, and `webhook`.
   - Enforces Grok Bot's hourly rate limits (up to 300 runs/hour across the account, 200 runs/hour per routine).

7. **Auto Review, Custom Rules & Approval Cards (`AutoReviewEngine`)**
   - Intercepts tool calls via Pi's `pi.on("tool_call", ...)` extension hook before execution.
   - Evaluates built-in safety boundaries, user prompt boundaries (e.g., *"only draft, do not send"*), and up to 20 **Ask first** + 20 **Allow automatically** Custom Rules (**Ask first** always wins when both match).
   - Generates **Approval Cards** (`Allow once`, `Always allow`, `Deny`) with warnings (`"This can't be undone"`, `"This changes sign-in or security settings"`, `"This shares your data outside this chat"`).
   - Denying an approval card prevents the Bot from retrying that action until the user sends a new message; background routine cards expire after 30 minutes.

8. **Zero-Knowledge Vault & Secure Forms (`VaultManager`)**
   - Stores **Logins**, **Payment Cards**, **Contacts**, and **API Secrets** encrypted at rest and write-only.
   - Bots only see safe metadata (`vault_list`), request secrets via in-chat **Secure Forms** (`vault_request_secret`), or inject credentials via `vault_use_credential`.
   - Scrubs any accidental secret output in Pi's `pi.on("tool_result", ...)` hook (`[VAULT_SECRET_REDACTED]`) so secret values never enter the LLM context.
   - Supports CSV password manager import (1Password, Chrome, Bitwarden, LastPass).

9. **Agent Email Inbox, Draft Cards & Collaborative Pages**
   - **Agent Email (`team@pibots.local`)**: Supports `+tag` routing (`team+shop@pibots.local`), marks external emails with `fromOwner: false` so untrusted emails are never treated as instructions, and prepares outgoing **Draft Cards** by default (and always during routines).
   - **Collaborative Pages (`page_upsert`, `page_list`)**: Bots build and maintain live Markdown/HTML reports, memos, and dashboards in the Library.

---

## Quick Start

### CLI Usage

```bash
# Show workspace status, shared computer path, Primary Bot, and roster
node ./src/cli.ts status

# Chat with a Bot (e.g. Atlas, Sierra, Kestrel, Vesper)
node ./src/cli.ts chat Atlas "Review our pipeline in /workspace/crm/pipeline_review.json and coordinate with Sierra"

# Post in a Multi-Bot Group Chat
node ./src/cli.ts group "Pipeline & Customer Watch" "@Vesper check churn signals on Vanguard FinTech"

# Launch the Web UI & REST API server (default port 4310)
node ./src/cli.ts serve --port 4310
```

### Programmatic SDK Usage

```typescript
import { PiBotsHub } from "./src/index.ts";

const hub = new PiBotsHub({
  dataDir: "./.pibots-data",
});

// Message your Primary Bot (Chief of Staff)
const result = await hub.chatWithBot(
  "Atlas",
  "Pull this week's pipeline review list from /workspace/crm/pipeline_review.json, skip active sequences, and have Sierra draft outreach to Dana at Acme Corp."
);

console.log(result.reply);
hub.dispose();
```

### Running Tests

```bash
npm test
```
