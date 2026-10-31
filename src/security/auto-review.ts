import crypto from "node:crypto";
import type { StateStore } from "../storage/state-store.ts";
import type {
	ApprovalCard,
	ApprovalWarning,
	AutoReviewBehavior,
	AutoReviewRule,
	AutoReviewSettings,
	TurnOrigin,
} from "../types.ts";

export interface AutoReviewEvaluation {
	decision: "allow" | "ask_approval" | "deny_previously_rejected";
	actionSummary: string;
	appName?: string;
	warnings: ApprovalWarning[];
	matchedRule?: AutoReviewRule;
	reason: string;
}

const SAFE_READ_ONLY_TOOLS = new Set([
	"read",
	"ls",
	"find",
	"grep",
	"memory_recall",
	"memory_remember",
	"memory_forget",
	"bot_list",
	"bot_create",
	"bot_handoff",
	"group_post",
	"skill_list",
	"skill_save",
	"routine_list",
	"routine_create",
	"page_list",
	"page_upsert",
	"vault_list",
	"email_inbox",
]);

/**
 * AutoReviewEngine implements Grok Bot's model-assisted & rule-based safety gate
 * that inspects every consequential action before execution.
 */
export class AutoReviewEngine {
	private readonly store: StateStore;
	/**
	 * Tracks actions denied during the current turn per botId so the Bot won't retry
	 * a denied action until the user sends a new message.
	 */
	private readonly deniedActionSignaturesByBot = new Map<string, Set<string>>();

	constructor(store: StateStore) {
		this.store = store;
	}

	getSettings(): AutoReviewSettings {
		return this.store.getState().autoReview;
	}

	setEnabled(enabled: boolean): AutoReviewSettings {
		const settings = this.getSettings();
		if (settings.requiredByAdmin && !enabled) {
			throw new Error("Required by your admin. You can't turn this off.");
		}
		settings.enabled = enabled;
		this.expireAllPendingCards();
		this.store.save();
		return settings;
	}

	/**
	 * Adds a Custom Rule ("allow_automatically" or "ask_first").
	 * Up to 20 rules of each type, max 1,000 characters each.
	 * If adding a 21st "allow_automatically" rule, removes the oldest one and returns it.
	 */
	addCustomRule(
		whenAction: string,
		behavior: AutoReviewBehavior,
	): { rule: AutoReviewRule; evictedRule?: AutoReviewRule } {
		const trimmed = whenAction.trim();
		if (!trimmed) {
			throw new Error("Rule description cannot be empty.");
		}
		if (trimmed.length > 1000) {
			throw new Error("Each Auto Review rule can be up to 1,000 characters.");
		}

		const settings = this.getSettings();
		const sameTypeRules = settings.customRules.filter((r) => r.behavior === behavior);
		let evictedRule: AutoReviewRule | undefined;

		if (sameTypeRules.length >= 20) {
			if (behavior === "ask_first") {
				throw new Error("You can have up to 20 'Ask first' rules. Remove one before adding another.");
			}
			// For allow_automatically, evict the oldest non-admin rule to make room
			const oldest = sameTypeRules.find((r) => !r.requiredByAdmin);
			if (oldest) {
				evictedRule = oldest;
				settings.customRules = settings.customRules.filter((r) => r.id !== oldest.id);
			}
		}

		const rule: AutoReviewRule = {
			id: `rule-${crypto.randomUUID().slice(0, 8)}`,
			whenAction: trimmed,
			behavior,
			createdAt: new Date().toISOString(),
		};
		settings.customRules.push(rule);
		this.expireAllPendingCards();
		this.store.save();
		return { rule, evictedRule };
	}

	updateCustomRule(ruleId: string, whenAction: string, behavior: AutoReviewBehavior): AutoReviewRule {
		const settings = this.getSettings();
		const rule = settings.customRules.find((r) => r.id === ruleId);
		if (!rule) throw new Error(`Rule ${ruleId} not found`);
		if (rule.requiredByAdmin) {
			throw new Error("Required by your admin. You can't edit or delete this rule.");
		}
		if (whenAction.trim().length > 1000) {
			throw new Error("Each Auto Review rule can be up to 1,000 characters.");
		}
		rule.whenAction = whenAction.trim();
		rule.behavior = behavior;
		this.expireAllPendingCards();
		this.store.save();
		return rule;
	}

	deleteCustomRule(ruleId: string): boolean {
		const settings = this.getSettings();
		const rule = settings.customRules.find((r) => r.id === ruleId);
		if (!rule) return false;
		if (rule.requiredByAdmin) {
			throw new Error("Required by your admin. You can't edit or delete this rule.");
		}
		settings.customRules = settings.customRules.filter((r) => r.id !== ruleId);
		this.expireAllPendingCards();
		this.store.save();
		return true;
	}

	/**
	 * Called when a user sends a new message in a Bot's chat:
	 * - Clears the per-turn denied actions set for that Bot.
	 * - Closes any open approval cards in that chat as "expired".
	 */
	onNewUserMessage(botId: string, chatId?: string): void {
		this.deniedActionSignaturesByBot.delete(botId);
		const cards = this.store.getState().approvalCards;
		let mutated = false;
		for (const card of cards) {
			if (
				card.status === "pending" &&
				card.botId === botId &&
				(!chatId || card.chatId === chatId)
			) {
				card.status = "expired";
				card.resolvedAt = new Date().toISOString();
				mutated = true;
			}
		}
		if (mutated) {
			this.store.save();
		}
	}

	expireAllPendingCards(): void {
		const cards = this.store.getState().approvalCards;
		const now = new Date().toISOString();
		let mutated = false;
		for (const card of cards) {
			if (card.status === "pending") {
				card.status = "expired";
				card.resolvedAt = now;
				mutated = true;
			}
		}
		if (mutated) {
			this.store.save();
		}
	}

	expireTimedOutCards(): void {
		const nowMs = Date.now();
		let mutated = false;
		for (const card of this.store.getState().approvalCards) {
			if (card.status === "pending" && card.expiresAt) {
				if (new Date(card.expiresAt).getTime() <= nowMs) {
					card.status = "expired";
					card.resolvedAt = new Date().toISOString();
					mutated = true;
				}
			}
		}
		if (mutated) {
			this.store.save();
		}
	}

	/**
	 * Evaluates a proposed tool call against:
	 * 1. Prior denials in the current turn
	 * 2. Explicit stop boundaries in the user's request ("draft only", "do not send", etc.)
	 * 3. Custom Rules ("ask_first" vs "allow_automatically"; if both match, "ask_first" wins!)
	 * 4. Built-in safety checks (destructive commands, external sends, payments, security changes)
	 */
	evaluateAction(params: {
		botId: string;
		toolName: string;
		input: Record<string, unknown>;
		userPromptText?: string;
		origin: TurnOrigin;
	}): AutoReviewEvaluation {
		const { botId, toolName, input, userPromptText, origin } = params;
		const { actionSummary, appName, warnings, isBuiltInRisky } = this.describeAndClassify(
			toolName,
			input,
		);

		const sig = `${toolName}:${JSON.stringify(input)}`;
		const deniedSet = this.deniedActionSignaturesByBot.get(botId);
		if (deniedSet?.has(sig)) {
			return {
				decision: "deny_previously_rejected",
				actionSummary,
				appName,
				warnings,
				reason: "You denied this action earlier in this turn. The Bot will not try it again until you send another message.",
			};
		}

		// Built-in check: If user request explicitly asked to stop before sending/changing
		if (userPromptText && this.userRequestForbidsAction(userPromptText, toolName, input)) {
			return {
				decision: "ask_approval",
				actionSummary,
				appName,
				warnings,
				reason: "Paused because your request specified a boundary before taking this action (e.g., draft only / ask before sending).",
			};
		}

		// Built-in check: Saving routines, skills, pages, memory, or preparing a non-sent Draft Card is never risky by itself
		if (
			SAFE_READ_ONLY_TOOLS.has(toolName) ||
			(toolName === "email_send" && !input.sendImmediately)
		) {
			return {
				decision: "allow",
				actionSummary,
				appName,
				warnings: [],
				reason: "Safe workspace, draft, or routine/memory operation.",
			};
		}

		const settings = this.getSettings();
		if (!settings.enabled) {
			// Built-in hard safety checks still apply for catastrophic commands even if Auto Review is toggled off
			if (this.isCatastrophicCommand(toolName, input)) {
				return {
					decision: "ask_approval",
					actionSummary,
					appName,
					warnings,
					reason: "Paused by built-in safety check (destructive command).",
				};
			}
			return {
				decision: "allow",
				actionSummary,
				appName,
				warnings,
				reason: "Auto Review is turned off.",
			};
		}

		// Evaluate Custom Rules: if both Ask first and Allow automatically match, Ask first wins!
		const matchingAskFirst = settings.customRules.find(
			(r) => r.behavior === "ask_first" && this.ruleMatchesAction(r.whenAction, toolName, input, actionSummary),
		);
		if (matchingAskFirst) {
			return {
				decision: "ask_approval",
				actionSummary,
				appName,
				warnings,
				matchedRule: matchingAskFirst,
				reason: `Paused by your Ask first rule: ${matchingAskFirst.whenAction}`,
			};
		}

		const matchingAllow = settings.customRules.find(
			(r) =>
				r.behavior === "allow_automatically" &&
				this.ruleMatchesAction(r.whenAction, toolName, input, actionSummary),
		);
		if (matchingAllow && !this.isCatastrophicCommand(toolName, input) && origin === "user_chat") {
			return {
				decision: "allow",
				actionSummary,
				appName,
				warnings,
				matchedRule: matchingAllow,
				reason: `Allowed by your Custom Rule: ${matchingAllow.whenAction}`,
			};
		}

		if (isBuiltInRisky) {
			return {
				decision: "ask_approval",
				actionSummary,
				appName,
				warnings,
				reason: "Auto Review requires your approval for this consequential action.",
			};
		}

		return {
			decision: "allow",
			actionSummary,
			appName,
			warnings: [],
			reason: "Action passed Auto Review.",
		};
	}

	createApprovalCard(params: {
		botId: string;
		chatId: string;
		toolName: string;
		input: Record<string, unknown>;
		evaluation: AutoReviewEvaluation;
		origin: TurnOrigin;
		requestedByUser?: string;
	}): ApprovalCard {
		const now = new Date();
		const isBackground = params.origin === "routine" || params.origin === "incoming_email";
		const expiresAt = isBackground
			? new Date(now.getTime() + 30 * 60 * 1000).toISOString()
			: undefined;

		const card: ApprovalCard = {
			id: `apr-${crypto.randomUUID().slice(0, 8)}`,
			botId: params.botId,
			chatId: params.chatId,
			toolName: params.toolName,
			actionSummary: params.evaluation.actionSummary,
			appName: params.evaluation.appName,
			input: params.input,
			warnings: params.evaluation.warnings,
			matchedRuleId: params.evaluation.matchedRule?.id,
			matchedRuleText: params.evaluation.matchedRule?.whenAction,
			origin: params.origin,
			status: "pending",
			requestedByUser: params.requestedByUser,
			// Group chat cards don't offer Always allow
			canAlwaysAllow: params.origin !== "group_chat",
			createdAt: now.toISOString(),
			expiresAt,
		};

		this.store.getState().approvalCards.push(card);
		this.store.save();
		return card;
	}

	resolveApprovalCard(
		cardId: string,
		resolution: "allow_once" | "always_allow" | "deny",
		actingUser?: string,
	): {
		card: ApprovalCard;
		savedRule?: AutoReviewRule;
		evictedRule?: AutoReviewRule;
	} {
		this.expireTimedOutCards();
		const card = this.store.getState().approvalCards.find((c) => c.id === cardId);
		if (!card) {
			throw new Error(`Approval card ${cardId} not found`);
		}
		if (card.status !== "pending") {
			throw new Error(`Approval card ${cardId} is already ${card.status}`);
		}
		if (
			card.origin === "group_chat" &&
			card.requestedByUser &&
			actingUser &&
			card.requestedByUser !== actingUser
		) {
			throw new Error(
				`In a group chat, only ${card.requestedByUser} (whose message the Bot is answering) can approve this card.`,
			);
		}

		card.resolvedAt = new Date().toISOString();

		if (resolution === "allow_once") {
			card.status = "allowed_once";
			this.store.save();
			return { card };
		}

		if (resolution === "always_allow") {
			if (!card.canAlwaysAllow) {
				throw new Error("Group chat approval cards do not support 'Always allow'.");
			}
			card.status = "always_allowed";
			const { rule, evictedRule } = this.addCustomRule(
				card.actionSummary,
				"allow_automatically",
			);
			this.store.save();
			return { card, savedRule: rule, evictedRule };
		}

		card.status = "denied";
		const sig = `${card.toolName}:${JSON.stringify(card.input)}`;
		let set = this.deniedActionSignaturesByBot.get(card.botId);
		if (!set) {
			set = new Set();
			this.deniedActionSignaturesByBot.set(card.botId, set);
		}
		set.add(sig);
		this.store.save();
		return { card };
	}

	private describeAndClassify(
		toolName: string,
		input: Record<string, unknown>,
	): {
		actionSummary: string;
		appName?: string;
		warnings: ApprovalWarning[];
		isBuiltInRisky: boolean;
	} {
		const warnings: ApprovalWarning[] = [];
		let isBuiltInRisky = false;
		let appName: string | undefined;
		let actionSummary = `Run ${toolName}`;

		if (toolName === "bash") {
			const cmd = String(input.command ?? "").trim();
			appName = "Terminal";
			actionSummary = `Run terminal command: ${cmd.slice(0, 120)}`;
			if (
				/\b(rm\s+-rf|rm\s+-r|git\s+push\s+--force|git\s+reset\s+--hard|drop\s+table|mkfs|dd\s+if=|sudo\s+)/i.test(
					cmd,
				)
			) {
				isBuiltInRisky = true;
				warnings.push("This can't be undone");
			}
			if (/\b(chmod|chown|ssh-keygen|passwd|iptables|ufw)\b/i.test(cmd)) {
				isBuiltInRisky = true;
				warnings.push("This changes sign-in or security settings");
			}
			if (/\b(curl\s+.*-X\s+(POST|PUT|DELETE)|scp\s+|rsync\s+)/i.test(cmd)) {
				isBuiltInRisky = true;
				warnings.push("This shares your data outside this chat");
			}
		} else if (toolName === "email_send") {
			appName = "Email";
			const to = Array.isArray(input.to) ? input.to.join(", ") : String(input.to ?? "");
			const subject = String(input.subject ?? "(no subject)");
			const sendNow = Boolean(input.sendImmediately);
			actionSummary = `${sendNow ? "Send" : "Draft"} email to ${to} with subject "${subject}"`;
			if (sendNow) {
				isBuiltInRisky = true;
				warnings.push("This can't be undone");
				warnings.push("This shares your data outside this chat");
			}
		} else if (toolName === "app_invoke") {
			appName = String(input.app ?? "Connected App");
			const action = String(input.action ?? "execute");
			actionSummary = `Use ${appName} to ${action}`;
			if (/\b(send|post|publish|delete|remove|pay|transfer|charge|cancel|update_prod)\b/i.test(action)) {
				isBuiltInRisky = true;
				warnings.push("This shares your data outside this chat");
				if (/\b(delete|remove|pay|transfer|charge|cancel)\b/i.test(action)) {
					warnings.push("This can't be undone");
				}
			}
		} else if (toolName === "vault_use_credential") {
			appName = "Vault";
			const target = String(input.targetContext ?? "external site");
			actionSummary = `Use saved Vault credential on ${target}`;
			if (/\b(pay|checkout|purchase|order|buy)\b/i.test(target)) {
				isBuiltInRisky = true;
				warnings.push("This can't be undone");
			}
		}

		return { actionSummary, appName, warnings, isBuiltInRisky };
	}

	private isCatastrophicCommand(toolName: string, input: Record<string, unknown>): boolean {
		if (toolName !== "bash") return false;
		const cmd = String(input.command ?? "");
		return /\b(rm\s+-rf\s+\/|mkfs|dd\s+if=|git\s+push\s+--force)\b/i.test(cmd);
	}

	private userRequestForbidsAction(
		userPrompt: string,
		toolName: string,
		input: Record<string, unknown>,
	): boolean {
		const lower = userPrompt.toLowerCase();
		if (
			toolName === "email_send" &&
			Boolean(input.sendImmediately) &&
			(lower.includes("only draft") ||
				lower.includes("draft only") ||
				lower.includes("do not send") ||
				lower.includes("don't send") ||
				lower.includes("leave me drafts") ||
				lower.includes("never contact"))
		) {
			return true;
		}
		if (
			(lower.includes("do not change") || lower.includes("don't change") || lower.includes("read-only")) &&
			["write", "edit", "email_send"].includes(toolName)
		) {
			return true;
		}
		return false;
	}

	private ruleMatchesAction(
		ruleText: string,
		toolName: string,
		input: Record<string, unknown>,
		actionSummary: string,
	): boolean {
		const ruleLower = ruleText.toLowerCase();
		const targetText = `${toolName} ${actionSummary} ${JSON.stringify(input)}`.toLowerCase();

		if (
			(ruleLower.includes("email") || ruleLower.includes("message")) &&
			toolName === "email_send" &&
			Boolean(input.sendImmediately)
		) {
			return true;
		}

		if (
			(ruleLower.includes("delete") || ruleLower.includes("force push") || ruleLower.includes("production")) &&
			toolName === "bash" &&
			/\b(rm\s+-r|git\s+push\s+--force|prod)\b/i.test(String(input.command ?? ""))
		) {
			return true;
		}

		// Keyword overlap check for custom plain-word rules
		const tokens = ruleLower
			.replace(/[^a-z0-9_/\s-]/g, " ")
			.split(/\s+/)
			.filter((w) => w.length >= 4 && !["when", "wants", "before", "after", "with", "from", "that", "this"].includes(w));

		if (tokens.length === 0) return false;
		const matchedCount = tokens.filter((t) => targetText.includes(t)).length;
		return matchedCount >= Math.min(2, tokens.length);
	}
}
