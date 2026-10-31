import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { PiBotsHub, RoutineScheduler, startPiBotsServer } from "../src/index.ts";

function createTempDir(prefix = "pibots-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("1. Bot Roster, Primary Bot, Duplicate, Template Export/Import, and Delete", () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });

	try {
		const bots = hub.listBots();
		assert.equal(bots.length, 4);
		const primary = hub.getPrimaryBot();
		assert.equal(primary.name, "Atlas");
		assert.equal(primary.isPrimary, true);

		// Shared Bot cannot be Primary Bot
		const shared = hub.createBot({
			name: "TeamHelper",
			label: "Shared Ops",
			job: "Help the team",
		});
		shared.isSharedBot = true;
		assert.throws(() => hub.setPrimaryBot(shared.id), /shared Bot can't be your primary Bot/);

		// Add a memory to Atlas, then duplicate Atlas -> copy should keep skills & routines, NOT memories
		hub.memory.remember({
			botId: primary.id,
			category: "preference",
			content: "Private memory only for Atlas",
		});
		const copy = hub.duplicateBot(primary.id, "Atlas EMEA");
		assert.equal(copy.label, primary.label);
		assert.deepEqual(copy.enabledSkills, primary.enabledSkills);
		assert.equal(hub.routines.listRoutines(copy.id).length, hub.routines.listRoutines(primary.id).length);
		assert.equal(hub.memory.recall(copy.id).botMemories.length, 0);

		// Export as template & import into a new Bot
		const template = hub.exportBotAsTemplate(primary.id, "team");
		const imported = hub.importBotFromTemplate(template.id, "Atlas APAC");
		assert.equal(imported.name, "Atlas APAC");
		assert.equal(imported.label, primary.label);

		// Delete a Bot removes its memories and shared facts it saved, but keeps /workspace files
		hub.memory.remember({
			botId: imported.id,
			category: "fact",
			content: "Temporary shared fact from APAC bot",
			sharedAcrossBots: true,
			sharedKey: "apac_region_lead",
		});
		assert.ok(
			hub.memory.recall(primary.id).sharedFacts.some((f) => f.key === "apac_region_lead"),
		);
		hub.deleteBot(imported.id);
		assert.equal(hub.getBot(imported.id), undefined);
		assert.equal(
			hub.memory.recall(primary.id).sharedFacts.some((f) => f.key === "apac_region_lead"),
			false,
		);
		assert.equal(
			fs.existsSync(path.join(hub.store.workspaceDir, "crm", "pipeline_review.json")),
			true,
		);
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("2. Compounding Memory, Shared Account Facts, Conversation Reset, and Assistant Import", async () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });

	try {
		const atlas = hub.getPrimaryBot();
		const sierra = hub.getBot("Sierra")!;

		// Save a shared fact via Sierra -> Atlas immediately knows it too
		hub.memory.remember({
			botId: sierra.id,
			category: "fact",
			content: "Alex Rivera",
			sharedAcrossBots: true,
			sharedKey: "user_name",
		});

		const recalledByAtlas = hub.memory.recall(atlas.id);
		assert.ok(
			recalledByAtlas.sharedFacts.some(
				(f) => f.key === "user_name" && f.value === "Alex Rivera",
			),
		);

		// Save a private memory on Sierra -> Atlas does not see Sierra's private memory
		hub.memory.remember({
			botId: sierra.id,
			category: "rule",
			content: "Skip any account touched in the last 14 days.",
		});
		assert.equal(
			hub.memory
				.recall(atlas.id)
				.botMemories.some((m) => m.content.includes("touched in the last 14 days")),
			false,
		);

		// Resetting Sierra's conversation keeps Sierra's memory
		const session = hub.getOrCreateBotSession(sierra.id);
		await session.resetConversation();
		assert.equal(
			hub.memory
				.recall(sierra.id)
				.botMemories.some((m) => m.content.includes("touched in the last 14 days")),
			true,
		);

		// Import memory from another assistant into Primary Bot
		const imported = hub.memory.importFromOtherAssistant(
			atlas.id,
			"- My time zone is America/Los_Angeles\n- Always ask before inviting external guests\n- I prefer tables with decimal-aligned numbers",
		);
		assert.equal(imported.importedMemories.length, 3);
		assert.ok(imported.importedSharedFacts.length >= 1);
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("3. Vault Zero-Knowledge Storage, CSV Import, Secure Forms, and Secret Redaction", () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });

	try {
		const login = hub.vault.addLogin({
			website: "https://zendesk.example.com",
			username: "ops@pibots.local",
			password: "super-secret-password-9988",
			hints: "Support queue login",
		});
		const card = hub.vault.addCard({
			cardholderName: "Alex Rivera",
			cardNumber: "4242424242429876",
			expiry: "09/29",
			cvv: "842",
			hints: "Use for work SaaS subscriptions",
		});
		const secret = hub.vault.addSecret({
			envName: "LINEAR_WEBHOOK_SECRET",
			description: "Linear webhook signing key",
			value: "lin_sec_77665544332211",
		});

		// Safe summary never contains raw passwords, full card numbers, CVVs, or secret values
		const safeJson = JSON.stringify(hub.vault.listSafeItems());
		assert.equal(safeJson.includes("super-secret-password-9988"), false);
		assert.equal(safeJson.includes("4242424242429876"), false);
		assert.equal(safeJson.includes("lin_sec_77665544332211"), false);
		assert.equal(safeJson.includes("9876"), true);

		// Redaction scrubs secrets from any tool output
		const leakyOutput =
			"Debug output: password=super-secret-password-9988 card=4242424242429876 key=lin_sec_77665544332211";
		const scrubbed = hub.vault.redactSecrets(leakyOutput);
		assert.equal(scrubbed.includes("super-secret-password-9988"), false);
		assert.equal(scrubbed.includes("4242424242429876"), false);
		assert.equal(scrubbed.includes("lin_sec_77665544332211"), false);
		assert.equal(scrubbed.includes("[VAULT_SECRET_REDACTED]"), true);

		// Use credential returns safe summary
		const useRes = hub.vault.useCredential(login.id, "Sign in to Zendesk");
		assert.equal(useRes.success, true);
		assert.ok(useRes.summaryForModel.includes("never shown to the Bot"));
		assert.ok(card.id && secret.id);

		// CSV import enforces https://, non-empty password, and deduplication
		const csv = [
			"name,url,username,password",
			"GitHub Work,https://github.com,alex@pibots.local,gh_pass_12345",
			"GitHub Duplicate,https://github.com,alex@pibots.local,gh_pass_12345",
			"Insecure Site,http://insecure.example.com,alex,pass123",
			"Missing Pass,https://notion.so,alex,",
		].join("\n");
		const csvRes = hub.vault.importFromCsv(csv);
		assert.equal(csvRes.importedCount, 1);
		assert.equal(csvRes.skippedDuplicates, 1);
		assert.equal(csvRes.errors.length, 2);

		// Secure Form flow
		const form = hub.vault.createSecureForm({
			botId: hub.getPrimaryBot().id,
			formType: "secret",
			targetSiteOrEnv: "STRIPE_RESTRICTED_KEY",
			prompt: "Provide your Stripe read-only key",
		});
		const filled = hub.vault.submitSecureForm(
			form.id,
			{
				envName: "STRIPE_RESTRICTED_KEY",
				description: "Stripe read-only key",
				value: "rk_live_secret_value_5555",
			},
			true,
		);
		assert.equal(filled.form.status, "filled");
		assert.equal(
			hub.vault.redactSecrets("key is rk_live_secret_value_5555"),
			"key is [VAULT_SECRET_REDACTED]",
		);
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("4. Auto Review Rules, Precedence (Ask First Wins), Eviction, and Approval Cards", () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });

	try {
		const botId = hub.getPrimaryBot().id;

		// Saving a routine or skill is never counted as risky by itself
		const evalRoutine = hub.autoReview.evaluateAction({
			botId,
			toolName: "routine_create",
			input: { name: "Daily check" },
			origin: "user_chat",
		});
		assert.equal(evalRoutine.decision, "allow");

		// When both Allow automatically and Ask first match, Ask first wins!
		hub.autoReview.addCustomRule("run deploy script in staging", "allow_automatically");
		hub.autoReview.addCustomRule("run deploy script in staging", "ask_first");

		const evalConflict = hub.autoReview.evaluateAction({
			botId,
			toolName: "bash",
			input: { command: "./scripts/deploy.sh staging" },
			origin: "user_chat",
		});
		assert.equal(evalConflict.decision, "ask_approval");

		// Create an approval card and deny it -> subsequent identical attempt in the same turn is rejected
		const card = hub.autoReview.createApprovalCard({
			botId,
			chatId: "chat-1",
			toolName: "bash",
			input: { command: "rm -rf /workspace/tmp_cache" },
			evaluation: evalConflict,
			origin: "user_chat",
		});
		hub.autoReview.resolveApprovalCard(card.id, "deny");

		const retryEval = hub.autoReview.evaluateAction({
			botId,
			toolName: "bash",
			input: { command: "rm -rf /workspace/tmp_cache" },
			origin: "user_chat",
		});
		assert.equal(retryEval.decision, "deny_previously_rejected");

		// Sending a new user message resets per-turn denials and expires open cards
		const openCard = hub.autoReview.createApprovalCard({
			botId,
			chatId: "chat-1",
			toolName: "bash",
			input: { command: "sudo reboot" },
			evaluation: evalConflict,
			origin: "user_chat",
		});
		hub.autoReview.onNewUserMessage(botId, "chat-1");
		assert.equal(openCard.status, "expired");

		// Adding more than 20 Allow automatically rules evicts the oldest Allow rule
		let lastEvicted: string | undefined;
		for (let i = 0; i < 22; i++) {
			const res = hub.autoReview.addCustomRule(
				`allow custom safe action number ${i}`,
				"allow_automatically",
			);
			if (res.evictedRule) {
				lastEvicted = res.evictedRule.whenAction;
			}
		}
		assert.ok(lastEvicted);
		const allowCount = hub.autoReview
			.getSettings()
			.customRules.filter((r) => r.behavior === "allow_automatically").length;
		assert.equal(allowCount, 20);
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("5. Skills Library, SKILL.md Materialization, Teach-by-Demonstration, and Routines", async () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });

	try {
		const botId = hub.getPrimaryBot().id;
		const demo = hub.skills.startDemonstration(botId, "Audit weekly CRM stale deals");
		hub.skills.recordDemonstrationStep(demo.id, {
			kind: "command",
			summary: "Read /workspace/crm/pipeline_review.json and filter stalled deals",
		});
		const { skill } = hub.skills.finishDemonstration(demo.id, {
			skillName: "Weekly CRM Stale Deal Audit",
		});

		assert.equal(skill.slug, "weekly-crm-stale-deal-audit");
		const skillFile = path.join(hub.store.skillsDir, skill.slug, "SKILL.md");
		assert.equal(fs.existsSync(skillFile), true);

		// Schedule parsing
		const parsed2h = RoutineScheduler.parseSchedulePhrase("every 2 hours");
		assert.equal(parsed2h.intervalMs, 2 * 3600_000);

		// Incoming email routine only runs when authenticatedSender is true
		const unauthEmail = await hub.receiveInboundEmail({
			from: "spoofed@vendor.example.com",
			to: "team+shop@pibots.local",
			subject: "Fake Invoice",
			body: "Pay immediately",
			authenticatedSender: false,
		});
		assert.equal(unauthEmail.triggeredRoutineRuns, 0);
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("6. End-to-End Pi AgentSession Integration: Multi-Bot Handoffs, Shared /workspace, Auto Review, Vault Scrubbing, Group Chats, and @bot on X", async () => {
	const dataDir = createTempDir();
	const faux = fauxProvider({ provider: "pibots-test", models: [{ id: "grok-bot-test-model" }] });

	const hub = new PiBotsHub({
		dataDir,
		inMemorySessions: true,
		model: faux.getModel(),
		extraExtensionFactories: [
			(pi) => {
				pi.registerProvider(faux.provider);
			},
		],
	});

	try {
		// Save a secret in Vault to verify Pi tool_result hook scrubs it if a command ever prints it
		hub.vault.addSecret({
			envName: "CRM_SECRET_TOKEN",
			description: "Internal CRM token",
			value: "crm_tok_ultra_secret_9000",
		});

		// Scripted multi-step turn on Primary Bot (Atlas) that:
		// 1. Saves a memory (`memory_remember`)
		// 2. Updates a collaborative Page (`page_upsert`)
		// 3. Hands off outbound drafting to Sierra (`bot_handoff`), where Sierra drafts an email (`email_send`)
		faux.setResponses([
			// Turn 1 of Atlas: call memory_remember and page_upsert and bot_handoff
			fauxAssistantMessage(
				[
					fauxToolCall("memory_remember", {
						category: "rule",
						content: "Always leave Acme Corp outreach as drafts for Dana.",
					}),
					fauxToolCall("page_upsert", {
						title: "Q4 Outbound Watchlist",
						content: "# Q4 Outbound Watchlist\n\n1. **Acme Corp** (Intent: 94) — Expanding 25 seats.",
						pinned: true,
					}),
					fauxToolCall("bot_handoff", {
						targetBot: "Sierra",
						taskOrMessage:
							"Draft a renewal & 25-seat expansion follow-up email to dana@acmecorp.example.com.",
					}),
				],
				{ stopReason: "toolUse" },
			),
			// Turn 1 of Sierra (inside the handoff): call email_send to create a Draft Card
			fauxAssistantMessage(
				[
					fauxToolCall("email_send", {
						channel: "email",
						to: ["dana@acmecorp.example.com"],
						subject: "Acme Corp 25-Seat Annual Expansion & SSO Checklist",
						body: "Hi Dana, here is the SSO provisioning checklist for your 25-seat annual expansion.",
						sendImmediately: false,
					}),
				],
				{ stopReason: "toolUse" },
			),
			// Final response of Sierra back to Atlas
			fauxAssistantMessage(
				fauxText("Prepared Draft Card for Dana at Acme Corp and saved it for approval."),
			),
			// Final response of Atlas back to the user
			fauxAssistantMessage(
				fauxText(
					"I updated the Q4 Outbound Watchlist Page and handed off the Acme Corp outreach to Sierra, who prepared a Draft Card for your approval.",
				),
			),
		]);

		const res = await hub.chatWithBot(
			"Atlas",
			"Coordinate our Acme Corp follow-up, update a Q4 Outbound Watchlist page, and have Sierra draft the email to Dana.",
		);

		assert.ok(res.reply.includes("Sierra"));
		assert.ok(hub.listPages().some((p) => p.title === "Q4 Outbound Watchlist"));
		const drafts = hub.store.getState().drafts;
		assert.equal(drafts.length, 1);
		assert.equal(drafts[0].status, "needs_approval");
		assert.equal(drafts[0].to[0], "dana@acmecorp.example.com");

		// Approve and send the Draft Card
		const sentDraft = hub.approveAndSendDraft(drafts[0].id);
		assert.equal(sentDraft.status, "sent");

		// Test Auto Review intercepting a risky `bash` command (`rm -rf`) in Pi AgentSession
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", {
						command: "rm -rf /workspace/crm/pipeline_review.json",
						timeout: 5,
					}),
				],
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(
				fauxText(
					"Auto Review paused the deletion and posted an Approval Card in chat for your review.",
				),
			),
		]);

		const riskyRes = await hub.chatWithBot("Kestrel", "Clean up old files in /workspace/crm.");
		assert.equal(riskyRes.approvalCards.length, 1);
		assert.equal(riskyRes.approvalCards[0].status, "pending");
		assert.ok(riskyRes.approvalCards[0].warnings.includes("This can't be undone"));
		// File was protected and NOT deleted!
		assert.equal(
			fs.existsSync(path.join(hub.store.workspaceDir, "crm", "pipeline_review.json")),
			true,
		);

		// Test Vault secret redaction in `tool_result` when a bash command prints a secret stored in Vault
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("bash", {
						command: "echo 'Token is crm_tok_ultra_secret_9000'",
						timeout: 5,
					}),
				],
				{ stopReason: "toolUse" },
			),
			(context) => {
				// Inspect the toolResult message that reached the model context:
				const serialized = JSON.stringify(context.messages);
				assert.equal(
					serialized.includes("crm_tok_ultra_secret_9000"),
					false,
					"Secret value must be scrubbed before reaching the model context!",
				);
				assert.equal(serialized.includes("[VAULT_SECRET_REDACTED]"), true);
				return fauxAssistantMessage(
					fauxText("Verified that the secret was redacted from the transcript."),
				);
			},
		]);

		await hub.chatWithBot("Kestrel", "Check environment output.");

		// Test Multi-Bot Group Chat with @Vesper mention
		faux.setResponses([
			fauxAssistantMessage(
				fauxText(
					"Reviewed Vanguard FinTech: 2 open P1 tickets and 18% usage drop. Flagged on the Account Health watchlist for @Atlas.",
				),
			),
		]);
		const group = hub.listGroupChats()[0];
		const groupRes = await hub.postUserMessageInGroup(
			group.id,
			"@Vesper please check churn risk on Vanguard FinTech.",
		);
		assert.equal(groupRes.botReplies.length, 1);
		assert.ok(groupRes.botReplies[0].senderName.includes("Vesper"));

		// Test Tag @bot on X
		faux.setResponses([
			fauxAssistantMessage(
				fauxText("Picked up your X post and added the task to the Monday Scoreboard."),
			),
		]);
		const xRes = await hub.handleXTagMention({
			authorHandle: "adrien",
			postText: "@bot summarize our top 3 renewal priorities for Monday morning",
		});
		assert.ok(xRes.publicConfirmationReply.includes("@adrien"));
		assert.equal(xRes.primaryBot.name, "Atlas");
	} finally {
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});

test("7. Web UI & REST API Server Integration", async () => {
	const dataDir = createTempDir();
	const hub = new PiBotsHub({ dataDir, inMemorySessions: true });
	const srv = await startPiBotsServer({ hub, port: 0 });

	try {
		const htmlRes = await fetch(`${srv.url}/`);
		assert.equal(htmlRes.status, 200);
		const html = await htmlRes.text();
		assert.ok(html.includes("PiBots"));
		assert.ok(html.includes("Geist"));

		const stateRes = await fetch(`${srv.url}/api/state`);
		assert.equal(stateRes.status, 200);
		const stateJson = (await stateRes.json()) as Record<string, any>;
		assert.equal(stateJson.bots.length, 4);
		assert.equal(stateJson.vault, undefined);
		assert.ok(Array.isArray(stateJson.vaultSafe));
	} finally {
		await srv.close();
		hub.dispose();
		fs.rmSync(dataDir, { recursive: true, force: true });
	}
});
