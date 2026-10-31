import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { MemoryManager } from "../memory/memory-manager.ts";
import { RoutineScheduler } from "../routines/routine-scheduler.ts";
import { AutoReviewEngine } from "../security/auto-review.ts";
import { SkillsManager } from "../skills/skills-manager.ts";
import { StateStore } from "../storage/state-store.ts";
import type {
	AgentEmailMessage,
	ApprovalCard,
	BotAvatar,
	BotProfile,
	BotTemplate,
	CollaborativePage,
	DraftCard,
	GroupChat,
	GroupChatMessage,
	RoutineDefinition,
	VoiceCallSession,
} from "../types.ts";
import { VaultManager } from "../vault/vault-manager.ts";
import {
	BotRuntimeSession,
	type SendMessageOptions,
	type SendMessageResult,
} from "./bot-session.ts";

export interface PiBotsHubOptions {
	dataDir: string;
	workspaceDir?: string;
	inMemorySessions?: boolean;
	model?: Model<any>;
	extraExtensionFactories?: ExtensionFactory[];
	onApprovalCardCreated?: (
		card: ApprovalCard,
	) => Promise<"allow_once" | "always_allow" | "deny" | "defer">;
}

/**
 * PiBotsHub is the central orchestrator for Grok Bot functionalities built on the Pi Agent SDK.
 * It coordinates the Bot roster, shared computer (/workspace), compounding memory,
 * multi-bot handoffs, group chats, skills, routines, Vault, Auto Review, Pages, and Agent Email.
 */
export class PiBotsHub {
	readonly store: StateStore;
	readonly memory: MemoryManager;
	readonly vault: VaultManager;
	readonly autoReview: AutoReviewEngine;
	readonly skills: SkillsManager;
	readonly routines: RoutineScheduler;
	private readonly options: PiBotsHubOptions;
	private readonly botSessions = new Map<string, BotRuntimeSession>();

	constructor(options: PiBotsHubOptions) {
		this.options = options;
		this.store = new StateStore({
			dataDir: options.dataDir,
			workspaceDir: options.workspaceDir,
		});
		this.memory = new MemoryManager(this.store);
		this.vault = new VaultManager(this.store);
		this.autoReview = new AutoReviewEngine(this.store);
		this.skills = new SkillsManager(this.store, this.vault);
		this.routines = new RoutineScheduler(
			this.store,
			async (routine: RoutineDefinition, triggerReason: string) => {
				const prompt = `[Automated Routine Run: "${routine.name}"]\nTrigger: ${triggerReason}\n${
					routine.skillName ? `Use Skill: ${routine.skillName}\n` : ""
				}Instructions: ${routine.instructions}\nApproval Boundary: ${routine.approvalBoundary}\nIf source missing: ${routine.onMissingSource}`;
				const res = await this.chatWithBot(routine.botId, prompt, {
					origin: "routine",
					chatId: `routine-${routine.id}`,
				});
				return {
					outputSummary: res.reply.slice(0, 500),
					blockedByApproval: res.approvalCards.length > 0,
				};
			},
		);
	}

	// =========================================================================
	// 1. BOT ROSTER & PRIMARY BOT MANAGEMENT
	// =========================================================================

	listBots(options?: { includeHidden?: boolean }): BotProfile[] {
		const bots = this.store.getState().bots;
		const filtered = options?.includeHidden ? bots : bots.filter((b) => !b.hidden);
		return [...filtered].sort((a, b) => {
			if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	}

	getBot(idOrName: string): BotProfile | undefined {
		const needle = idOrName.trim().toLowerCase();
		return this.store
			.getState()
			.bots.find(
				(b) =>
					b.id.toLowerCase() === needle ||
					b.name.toLowerCase() === needle ||
					b.label.toLowerCase() === needle,
			);
	}

	getPrimaryBot(): BotProfile {
		const bots = this.store.getState().bots;
		const primary = bots.find((b) => b.isPrimary);
		if (primary) return primary;
		if (bots.length === 0) {
			throw new Error("No Bots exist on the roster.");
		}
		bots[0].isPrimary = true;
		this.store.save();
		return bots[0];
	}

	setPrimaryBot(botIdOrName: string): BotProfile {
		const target = this.getBot(botIdOrName);
		if (!target) {
			throw new Error(`Bot "${botIdOrName}" not found`);
		}
		if (target.isSharedBot) {
			throw new Error("A shared Bot can't be your primary Bot.");
		}
		for (const bot of this.store.getState().bots) {
			bot.isPrimary = bot.id === target.id;
		}
		this.store.save();
		return target;
	}

	createBot(input: {
		name: string;
		label: string;
		job: string;
		avatar?: Partial<BotAvatar>;
		section?: string;
		pinned?: boolean;
		isPrimary?: boolean;
		enabledSkills?: string[];
	}): BotProfile {
		const now = new Date().toISOString();
		const state = this.store.getState();

		if (input.isPrimary) {
			for (const b of state.bots) b.isPrimary = false;
		}

		const bot: BotProfile = {
			id: `bot-${crypto.randomUUID().slice(0, 8)}`,
			name: input.name.trim(),
			label: input.label.trim(),
			avatar: {
				shape: input.avatar?.shape ?? "hexagon",
				color: input.avatar?.color ?? "#10B981",
				imageUrl: input.avatar?.imageUrl,
			},
			job: input.job.trim(),
			isPrimary: Boolean(input.isPrimary || state.bots.length === 0),
			pinned: Boolean(input.pinned),
			hidden: false,
			section: input.section || "Core Team",
			draftsEnabled: true,
			enabledSkills: input.enabledSkills ?? [],
			allowedTools: [
				"read",
				"bash",
				"edit",
				"write",
				"grep",
				"find",
				"ls",
				"codemode",
				"tool_search",
			],
			createdAt: now,
			updatedAt: now,
		};

		state.bots.push(bot);
		this.store.save();
		return bot;
	}

	updateBot(
		botIdOrName: string,
		updates: Partial<
			Pick<
				BotProfile,
				| "name"
				| "label"
				| "avatar"
				| "job"
				| "pinned"
				| "hidden"
				| "section"
				| "draftsEnabled"
				| "enabledSkills"
				| "sharedDescription"
			>
		>,
	): BotProfile {
		const bot = this.getBot(botIdOrName);
		if (!bot) throw new Error(`Bot "${botIdOrName}" not found`);

		if (updates.name !== undefined) bot.name = updates.name.trim();
		if (updates.label !== undefined) bot.label = updates.label.trim();
		if (updates.avatar !== undefined) bot.avatar = { ...bot.avatar, ...updates.avatar };
		if (updates.job !== undefined) bot.job = updates.job.trim();
		if (updates.pinned !== undefined) bot.pinned = updates.pinned;
		if (updates.hidden !== undefined) bot.hidden = updates.hidden;
		if (updates.section !== undefined) bot.section = updates.section;
		if (updates.draftsEnabled !== undefined) bot.draftsEnabled = updates.draftsEnabled;
		if (updates.enabledSkills !== undefined) bot.enabledSkills = updates.enabledSkills;
		if (updates.sharedDescription !== undefined) {
			bot.sharedDescription = updates.sharedDescription;
		}
		bot.updatedAt = new Date().toISOString();
		this.store.save();
		return bot;
	}

	/**
	 * Duplicates a Bot to reuse a role for a different scope (e.g., one Account Health Bot per region).
	 * Copies profile, settings, enabled skills, routines, and avatar, but NOT conversation history,
	 * learned memory, or attachments (matching Grok Bot specification).
	 */
	duplicateBot(botIdOrName: string, newName?: string): BotProfile {
		const source = this.getBot(botIdOrName);
		if (!source) throw new Error(`Bot "${botIdOrName}" not found`);

		const duplicated = this.createBot({
			name: newName?.trim() || `${source.name} (Copy)`,
			label: source.label,
			job: source.job,
			avatar: { ...source.avatar },
			section: source.section,
			pinned: source.pinned,
			isPrimary: false,
			enabledSkills: [...source.enabledSkills],
		});
		duplicated.draftsEnabled = source.draftsEnabled;

		// Copy routines belonging to the source Bot
		const sourceRoutines = this.routines.listRoutines(source.id);
		for (const r of sourceRoutines) {
			this.routines.createRoutine({
				botId: duplicated.id,
				name: r.name,
				instructions: r.instructions,
				skillName: r.skillName,
				triggerType: r.trigger.type,
				scheduleText: r.trigger.type === "schedule" ? r.trigger.scheduleText : undefined,
				timezone: r.trigger.type === "schedule" ? r.trigger.timezone : undefined,
				eventType: r.trigger.type === "event" ? r.trigger.eventType : undefined,
				eventFilter: r.trigger.type === "event" ? r.trigger.filter : undefined,
				inputSource: r.inputSource,
				expectedResult: r.expectedResult,
				approvalBoundary: r.approvalBoundary,
				onMissingSource: r.onMissingSource,
			});
		}

		this.store.save();
		return duplicated;
	}

	/**
	 * Deletes a Bot and permanently erases its profile, conversations, memory (including shared facts
	 * it saved), routines, and drafts, while leaving shared `/workspace` files intact.
	 */
	deleteBot(botIdOrName: string): boolean {
		const bot = this.getBot(botIdOrName);
		if (!bot) return false;

		const runtime = this.botSessions.get(bot.id);
		if (runtime) {
			runtime.dispose();
			this.botSessions.delete(bot.id);
		}

		const state = this.store.getState();
		state.bots = state.bots.filter((b) => b.id !== bot.id);
		delete state.transcripts[bot.id];
		state.routines = state.routines.filter((r) => r.botId !== bot.id);
		state.drafts = state.drafts.filter((d) => d.botId !== bot.id);
		state.approvalCards = state.approvalCards.filter((c) => c.botId !== bot.id);
		this.memory.deleteBotMemories(bot.id);

		const sessionDir = this.store.getBotSessionDir(bot.id);
		if (fs.existsSync(sessionDir)) {
			fs.rmSync(sessionDir, { recursive: true, force: true });
		}

		if (bot.isPrimary && state.bots.length > 0) {
			state.bots[0].isPrimary = true;
		}
		this.store.save();
		return true;
	}

	// =========================================================================
	// 2. BOT TEMPLATES (SHARE & IMPORT)
	// =========================================================================

	exportBotAsTemplate(
		botIdOrName: string,
		visibility: "public" | "team" = "public",
	): BotTemplate {
		const bot = this.getBot(botIdOrName);
		if (!bot) throw new Error(`Bot "${botIdOrName}" not found`);

		const botSkills = this.skills
			.listSkills()
			.filter((s) => bot.enabledSkills.includes(s.slug));
		const botRoutines = this.routines.listRoutines(bot.id).map((r) => ({
			name: r.name,
			instructions: r.instructions,
			skillName: r.skillName,
			trigger: r.trigger,
			inputSource: r.inputSource,
			expectedResult: r.expectedResult,
			approvalBoundary: r.approvalBoundary,
			onMissingSource: r.onMissingSource,
			enabled: r.enabled,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}));

		const template: BotTemplate = {
			id: `tpl-${crypto.randomUUID().slice(0, 8)}`,
			name: bot.name,
			label: bot.label,
			avatar: { ...bot.avatar },
			job: bot.job,
			skills: botSkills,
			routines: botRoutines,
			visibility,
			createdAt: new Date().toISOString(),
		};

		this.store.getState().templates.push(template);
		this.store.save();
		return template;
	}

	importBotFromTemplate(
		templateIdOrTemplate: string | BotTemplate,
		customName?: string,
	): BotProfile {
		const template =
			typeof templateIdOrTemplate === "string"
				? this.store.getState().templates.find((t) => t.id === templateIdOrTemplate)
				: templateIdOrTemplate;
		if (!template) {
			throw new Error(`Bot template "${String(templateIdOrTemplate)}" not found`);
		}

		const skillSlugs: string[] = [];
		for (const skill of template.skills) {
			const saved = this.skills.saveSkill({
				name: skill.name,
				description: skill.description,
				whenToUse: skill.whenToUse,
				requiredInputsAndAccess: skill.requiredInputsAndAccess,
				steps: skill.steps,
				validation: skill.validation,
				expectedOutput: skill.expectedOutput,
				approvalBoundaries: skill.approvalBoundaries,
			});
			skillSlugs.push(saved.slug);
		}

		const bot = this.createBot({
			name: customName?.trim() || template.name,
			label: template.label,
			job: template.job,
			avatar: { ...template.avatar },
			enabledSkills: skillSlugs,
		});

		for (const r of template.routines) {
			this.routines.createRoutine({
				botId: bot.id,
				name: r.name,
				instructions: r.instructions,
				skillName: r.skillName,
				triggerType: r.trigger.type,
				scheduleText: r.trigger.type === "schedule" ? r.trigger.scheduleText : undefined,
				timezone: r.trigger.type === "schedule" ? r.trigger.timezone : undefined,
				eventType: r.trigger.type === "event" ? r.trigger.eventType : undefined,
				eventFilter: r.trigger.type === "event" ? r.trigger.filter : undefined,
				inputSource: r.inputSource,
				expectedResult: r.expectedResult,
				approvalBoundary: r.approvalBoundary,
				onMissingSource: r.onMissingSource,
			});
		}

		return bot;
	}

	// =========================================================================
	// 3. BOT RUNTIME SESSIONS, MESSAGING, HANDOFFS & PARALLEL WORK
	// =========================================================================

	getOrCreateBotSession(botIdOrName: string): BotRuntimeSession {
		const bot = this.getBot(botIdOrName);
		if (!bot) {
			throw new Error(`Bot "${botIdOrName}" not found`);
		}
		let runtime = this.botSessions.get(bot.id);
		if (!runtime) {
			runtime = new BotRuntimeSession({
				botId: bot.id,
				store: this.store,
				memory: this.memory,
				vault: this.vault,
				autoReview: this.autoReview,
				skills: this.skills,
				routines: this.routines,
				inMemorySession: this.options.inMemorySessions,
				model: this.options.model,
				extraExtensionFactories: this.options.extraExtensionFactories,
				onApprovalCardCreated: this.options.onApprovalCardCreated,
				onHandoffToBot: async (fromBotId, targetBotNameOrId, taskMessage) => {
					return this.handoffBetweenBots(fromBotId, targetBotNameOrId, taskMessage);
				},
			});
			this.botSessions.set(bot.id, runtime);
		}
		return runtime;
	}

	async chatWithBot(
		botIdOrName: string,
		message: string,
		options?: SendMessageOptions,
	): Promise<SendMessageResult> {
		// Auto-wake sleeping computer when a message or call arrives
		const comp = this.store.getState().computer;
		if (comp.status === "asleep") {
			comp.status = "awake";
			this.store.save();
		}
		const runtime = this.getOrCreateBotSession(botIdOrName);
		return runtime.sendMessage(message, options);
	}

	async handoffBetweenBots(
		fromBotIdOrName: string,
		targetBotIdOrName: string,
		taskMessage: string,
	): Promise<{ botName: string; botId: string; reply: string }> {
		const state = this.store.getState();
		if (!state.computer.messagingBetweenBotsEnabled) {
			throw new Error("Messaging between Bots is disabled by team admin.");
		}
		const fromBot = this.getBot(fromBotIdOrName);
		const targetBot = this.getBot(targetBotIdOrName);
		if (!targetBot) {
			throw new Error(`Target Bot "${targetBotIdOrName}" not found on roster`);
		}

		const senderTitle = fromBot ? `${fromBot.name} (${fromBot.label})` : fromBotIdOrName;
		const handoffPrompt = `[Teammate Handoff from ${senderTitle}]\n${taskMessage}`;
		const res = await this.chatWithBot(targetBot.id, handoffPrompt, {
			origin: "user_chat",
			chatId: `handoff-${fromBot?.id ?? "sys"}-to-${targetBot.id}`,
		});

		return {
			botName: `${targetBot.name} (${targetBot.label})`,
			botId: targetBot.id,
			reply: res.reply,
		};
	}

	/**
	 * Runs tasks across multiple Bots in parallel on the shared cloud computer.
	 * Each Bot gets its own virtual screen while sharing `/workspace`.
	 */
	async runParallelBotTasks(
		tasks: Array<{ botIdOrName: string; task: string }>,
	): Promise<Array<{ bot: BotProfile; result: SendMessageResult }>> {
		const results = await Promise.all(
			tasks.map(async (item) => {
				const bot = this.getBot(item.botIdOrName);
				if (!bot) throw new Error(`Bot "${item.botIdOrName}" not found`);
				const result = await this.chatWithBot(bot.id, item.task);
				return { bot, result };
			}),
		);
		return results;
	}

	// =========================================================================
	// 4. MULTI-BOT GROUP CHATS
	// =========================================================================

	listGroupChats(): GroupChat[] {
		return this.store.getState().groupChats;
	}

	createGroupChat(input: {
		name: string;
		description?: string;
		botIdsOrNames: string[];
	}): GroupChat {
		const resolvedBots = input.botIdsOrNames
			.map((id) => this.getBot(id))
			.filter((b): b is BotProfile => Boolean(b));
		if (resolvedBots.length === 0) {
			throw new Error("A group chat requires at least one Bot.");
		}

		const now = new Date().toISOString();
		const group: GroupChat = {
			id: `group-${crypto.randomUUID().slice(0, 8)}`,
			name: input.name.trim(),
			description: input.description?.trim(),
			botIds: resolvedBots.map((b) => b.id),
			activeOwnerBotId: resolvedBots[0].id,
			messages: [],
			createdAt: now,
			updatedAt: now,
		};
		this.store.getState().groupChats.push(group);
		this.store.save();
		return group;
	}

	/**
	 * Posts a user message to a Group Chat and coordinates responses from mentioned Bots
	 * (or the group's active owner Bot).
	 */
	async postUserMessageInGroup(
		groupId: string,
		content: string,
		userName = "You",
	): Promise<{
		userMessage: GroupChatMessage;
		botReplies: GroupChatMessage[];
	}> {
		const group = this.store.getState().groupChats.find((g) => g.id === groupId);
		if (!group) throw new Error(`Group chat ${groupId} not found`);

		const mentions = Array.from(content.matchAll(/@([A-Za-z0-9_-]+)/g)).map((m) => m[1]);
		const userMsg: GroupChatMessage = {
			id: `gmsg-${crypto.randomUUID().slice(0, 8)}`,
			groupId: group.id,
			senderType: "user",
			senderId: "user",
			senderName: userName,
			content: content.trim(),
			mentions,
			assignedOwnerBotId: group.activeOwnerBotId,
			createdAt: new Date().toISOString(),
		};
		group.messages.push(userMsg);
		group.updatedAt = userMsg.createdAt;
		this.store.save();

		// Determine which Bots in the group should respond:
		// If @BotName mentions match bots in the group, run those; otherwise run the activeOwnerBotId
		const groupBots = group.botIds
			.map((id) => this.getBot(id))
			.filter((b): b is BotProfile => Boolean(b));

		let respondingBots = groupBots.filter((b) =>
			mentions.some(
				(m) =>
					b.name.toLowerCase() === m.toLowerCase() ||
					b.label.toLowerCase().includes(m.toLowerCase()),
			),
		);
		if (respondingBots.length === 0) {
			const owner =
				groupBots.find((b) => b.id === group.activeOwnerBotId) ?? groupBots[0];
			if (owner) respondingBots = [owner];
		}

		const botReplies: GroupChatMessage[] = [];
		for (const bot of respondingBots) {
			const recentHistory = group.messages
				.slice(-8)
				.map((m) => `${m.senderName}: ${m.content}`)
				.join("\n");
			const groupPrompt = `[Group Chat "${group.name}" — Participants: ${groupBots
				.map((b) => `@${b.name} (${b.label})`)
				.join(", ")}]\nRecent thread:\n${recentHistory}\n\nRespond to ${userName}'s message as ${bot.name}. Coordinate with other Bots in the group if needed.`;

			const res = await this.chatWithBot(bot.id, groupPrompt, {
				origin: "group_chat",
				chatId: group.id,
				requestedByUser: userName,
			});

			const replyMentions = Array.from(res.reply.matchAll(/@([A-Za-z0-9_-]+)/g)).map(
				(m) => m[1],
			);
			const nextOwner = groupBots.find((b) =>
				replyMentions.some((m) => b.name.toLowerCase() === m.toLowerCase()),
			);
			if (nextOwner) {
				group.activeOwnerBotId = nextOwner.id;
			}

			const botMsg: GroupChatMessage = {
				id: `gmsg-${crypto.randomUUID().slice(0, 8)}`,
				groupId: group.id,
				senderType: "bot",
				senderId: bot.id,
				senderName: `${bot.name} (${bot.label})`,
				content: res.reply,
				mentions: replyMentions,
				assignedOwnerBotId: group.activeOwnerBotId,
				createdAt: new Date().toISOString(),
			};
			group.messages.push(botMsg);
			group.updatedAt = botMsg.createdAt;
			botReplies.push(botMsg);
		}

		this.store.save();
		return { userMessage: userMsg, botReplies };
	}

	// =========================================================================
	// 5. TAG @bot ON X
	// =========================================================================

	/**
	 * Implements Grok Bot's "Tag @bot on X":
	 * Tagging @bot in a post or reply confirms with a short public reply while the user's
	 * Primary Bot picks up the post as a task in private chat.
	 */
	async handleXTagMention(input: {
		authorHandle: string;
		postText: string;
		postUrl?: string;
	}): Promise<{
		publicConfirmationReply: string;
		primaryBot: BotProfile;
		taskResult: SendMessageResult;
	}> {
		const primaryBot = this.getPrimaryBot();
		const cleanTask = input.postText.replace(/@bot\b/gi, "").trim();
		const publicConfirmationReply = `On it, @${input.authorHandle.replace(/^@/, "")}! Handed this off to ${primaryBot.name} in your Grok Bot workspace.`;

		const prompt = `[Task picked up from @bot mention on X by @${input.authorHandle}${
			input.postUrl ? ` (${input.postUrl})` : ""
		}]\nPost content: "${cleanTask}"\nComplete this task on the shared computer and summarize the finished result.`;

		const taskResult = await this.chatWithBot(primaryBot.id, prompt, {
			origin: "x_tag",
			chatId: `x-tag-${Date.now()}`,
		});

		return {
			publicConfirmationReply,
			primaryBot,
			taskResult,
		};
	}

	// =========================================================================
	// 6. AGENT EMAIL, DRAFTS & COLLABORATIVE PAGES
	// =========================================================================

	claimAgentEmailAddress(desiredName: string): string {
		const clean = desiredName.trim().toLowerCase();
		if (!/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(clean)) {
			throw new Error(
				"Invalid email name. Use 3-30 lowercase letters, numbers, dots, hyphens, or underscores.",
			);
		}
		if (["admin", "support", "security", "root", "postmaster", "bot"].includes(clean)) {
			throw new Error(`"${clean}" is a reserved word. Choose a different name.`);
		}
		const address = `${clean}@pibots.local`;
		this.store.getState().computer.agentEmailAddress = address;
		this.store.save();
		return address;
	}

	/**
	 * Receives an incoming email into the Agent Email inbox and triggers any matching
	 * event-based email routines (including tagged addresses like `team+shop@pibots.local`).
	 */
	async receiveInboundEmail(input: {
		from: string;
		to: string;
		subject: string;
		body: string;
		attachments?: string[];
		fromOwner?: boolean;
		authenticatedSender?: boolean;
	}): Promise<{ email: AgentEmailMessage; triggeredRoutineRuns: number }> {
		const tagMatch = input.to.match(/\+([a-z0-9_-]+)@/i);
		const tag = tagMatch ? tagMatch[1].toLowerCase() : undefined;

		const email: AgentEmailMessage = {
			id: `email-${crypto.randomUUID().slice(0, 8)}`,
			direction: "inbound",
			from: input.from,
			to: [input.to],
			tag,
			subject: input.subject,
			body: input.body,
			attachments: (input.attachments ?? []).slice(0, 10),
			fromOwner: Boolean(input.fromOwner),
			authenticatedSender: input.authenticatedSender ?? true,
			receivedAt: new Date().toISOString(),
		};

		this.store.getState().emails.unshift(email);
		this.store.save();

		const runs = await this.routines.dispatchEvent({
			eventType: "email",
			sender: email.from,
			tag: email.tag,
			payloadSummary: `Email from ${email.from}: "${email.subject}"`,
			authenticatedSender: email.authenticatedSender,
		});

		return { email, triggeredRoutineRuns: runs.length };
	}

	approveAndSendDraft(draftId: string): DraftCard {
		const state = this.store.getState();
		const draft = state.drafts.find((d) => d.id === draftId);
		if (!draft) throw new Error(`Draft ${draftId} not found`);
		if (draft.status !== "needs_approval") {
			throw new Error(`Draft ${draftId} is already ${draft.status}`);
		}
		draft.status = "sent";
		draft.sentAt = new Date().toISOString();

		if (draft.channel === "email") {
			state.emails.unshift({
				id: `email-${crypto.randomUUID().slice(0, 8)}`,
				direction: "outbound",
				from: state.computer.agentEmailAddress,
				to: draft.to,
				subject: draft.subject || "(no subject)",
				body: draft.body,
				attachments: draft.attachments ?? [],
				fromOwner: true,
				authenticatedSender: true,
				receivedAt: draft.sentAt,
			});
		}

		this.store.save();
		return draft;
	}

	discardDraft(draftId: string): DraftCard {
		const draft = this.store.getState().drafts.find((d) => d.id === draftId);
		if (!draft) throw new Error(`Draft ${draftId} not found`);
		draft.status = "discarded";
		this.store.save();
		return draft;
	}

	listPages(): CollaborativePage[] {
		const pages = this.store.getState().pages;
		return [...pages].sort((a, b) => {
			if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
			return b.updatedAt.localeCompare(a.updatedAt);
		});
	}

	// =========================================================================
	// 7. SHARED CLOUD COMPUTER (/workspace) & VOICE CALLS
	// =========================================================================

	requestComputerTakeover(botId: string, reason: string) {
		const comp = this.store.getState().computer;
		comp.handoverState = {
			active: true,
			botId,
			reason,
			requestedAt: new Date().toISOString(),
		};
		this.store.save();
		return comp.handoverState;
	}

	completeComputerTakeover() {
		const comp = this.store.getState().computer;
		comp.handoverState = undefined;
		this.store.save();
		return comp;
	}

	listWorkspaceFiles(subDir = ""): Array<{
		name: string;
		relativePath: string;
		isDirectory: boolean;
		sizeBytes: number;
	}> {
		const target = path.resolve(this.store.workspaceDir, subDir);
		if (!target.startsWith(this.store.workspaceDir) || !fs.existsSync(target)) {
			return [];
		}
		const entries = fs.readdirSync(target, { withFileTypes: true });
		return entries
			.filter((e) => e.name !== ".pi" && e.name !== "node_modules")
			.map((entry) => {
				const fullPath = path.join(target, entry.name);
				const stat = fs.statSync(fullPath);
				return {
					name: entry.name,
					relativePath: path.relative(this.store.workspaceDir, fullPath),
					isDirectory: entry.isDirectory(),
					sizeBytes: stat.size,
				};
			});
	}

	startVoiceCall(
		botIdOrName: string,
		options?: { voice?: string; speed?: number; language?: string },
	): VoiceCallSession {
		const bot = this.getBot(botIdOrName);
		if (!bot) throw new Error(`Bot "${botIdOrName}" not found`);

		const state = this.store.getState();
		// Wake sleeping computer on voice call
		if (state.computer.status === "asleep") {
			state.computer.status = "awake";
		}

		// Only one voice call runs at a time; end any existing active call
		for (const call of state.voiceCalls) {
			if (call.status === "active") {
				call.status = "ended";
				call.endedAt = new Date().toISOString();
			}
		}

		const call: VoiceCallSession = {
			id: `call-${crypto.randomUUID().slice(0, 8)}`,
			botId: bot.id,
			status: "active",
			muted: false,
			voice: options?.voice ?? "Grok Natural",
			speed: options?.speed ?? 1.0,
			language: options?.language ?? "auto-detect",
			transcript: [],
			startedAt: new Date().toISOString(),
		};
		state.voiceCalls.push(call);
		this.store.save();
		return call;
	}

	endVoiceCall(callId: string): VoiceCallSession {
		const state = this.store.getState();
		const call = state.voiceCalls.find((c) => c.id === callId);
		if (!call) throw new Error(`Voice call ${callId} not found`);
		call.status = "ended";
		call.endedAt = new Date().toISOString();

		const durationSeconds = Math.max(
			1,
			Math.round(
				(new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000,
			),
		);
		const transcriptText =
			call.transcript.map((t) => `${t.speaker}: ${t.text}`).join("\n") ||
			"Voice chat completed.";

		if (!state.transcripts[call.botId]) {
			state.transcripts[call.botId] = [];
		}
		state.transcripts[call.botId].push({
			id: `msg-${crypto.randomUUID().slice(0, 8)}`,
			botId: call.botId,
			role: "system",
			content: `Voice chat (${durationSeconds}s)`,
			origin: "user_chat",
			voiceMemo: {
				durationSeconds,
				transcript: transcriptText,
			},
			createdAt: call.endedAt,
		});

		this.store.save();
		return call;
	}

	dispose(): void {
		this.routines.stopBackgroundTicker();
		for (const session of this.botSessions.values()) {
			session.dispose();
		}
		this.botSessions.clear();
	}
}
