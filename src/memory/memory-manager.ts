import crypto from "node:crypto";
import type { StateStore } from "../storage/state-store.ts";
import type { MemoryCategory, MemoryItem, SharedUserFact } from "../types.ts";

/**
 * MemoryManager implements Grok Bot's compounding memory architecture:
 * - Bot-specific memory (preferences, lasting rules, facts, and a dated work log)
 *   that survives conversation resets.
 * - Account-wide shared facts about the user (such as name, time zone, working style)
 *   shared across every personal Bot on the account.
 */
export class MemoryManager {
	private readonly store: StateStore;

	constructor(store: StateStore) {
		this.store = store;
	}

	remember(params: {
		botId: string;
		category: MemoryCategory;
		content: string;
		sharedAcrossBots?: boolean;
		sharedKey?: string;
	}): { memory: MemoryItem; sharedFact?: SharedUserFact } {
		const now = new Date().toISOString();
		const state = this.store.getState();

		const memory: MemoryItem = {
			id: `mem-${crypto.randomUUID().slice(0, 8)}`,
			botId: params.botId,
			category: params.category,
			content: params.content.trim(),
			sharedAcrossBots: Boolean(params.sharedAcrossBots || params.sharedKey),
			createdAt: now,
			updatedAt: now,
		};
		state.memories.push(memory);

		let sharedFact: SharedUserFact | undefined;
		if (params.sharedAcrossBots || params.sharedKey) {
			const key = (
				params.sharedKey ||
				params.content.split(":")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 32) ||
				"user_fact"
			).trim();
			const existing = state.sharedFacts.find((f) => f.key === key);
			if (existing) {
				existing.value = params.content.trim();
				existing.savedByBotId = params.botId;
				existing.updatedAt = now;
				sharedFact = existing;
			} else {
				sharedFact = {
					id: `sf-${crypto.randomUUID().slice(0, 8)}`,
					key,
					value: params.content.trim(),
					savedByBotId: params.botId,
					updatedAt: now,
				};
				state.sharedFacts.push(sharedFact);
			}
		}

		this.store.save();
		return { memory, sharedFact };
	}

	recall(
		botId: string,
		query?: string,
	): {
		botMemories: MemoryItem[];
		sharedFacts: SharedUserFact[];
	} {
		const state = this.store.getState();
		const q = query?.trim().toLowerCase();

		const botMemories = state.memories.filter((m) => {
			if (m.botId !== botId) return false;
			if (!q) return true;
			return m.content.toLowerCase().includes(q) || m.category.toLowerCase().includes(q);
		});

		const sharedFacts = state.sharedFacts.filter((f) => {
			if (!q) return true;
			return f.key.toLowerCase().includes(q) || f.value.toLowerCase().includes(q);
		});

		return { botMemories, sharedFacts };
	}

	updateOrCorrect(
		botId: string,
		matchTextOrId: string,
		newContent: string,
	): { updatedCount: number } {
		const state = this.store.getState();
		const needle = matchTextOrId.trim().toLowerCase();
		const now = new Date().toISOString();
		let updatedCount = 0;

		for (const mem of state.memories) {
			if (
				mem.botId === botId &&
				(mem.id.toLowerCase() === needle || mem.content.toLowerCase().includes(needle))
			) {
				mem.content = newContent.trim();
				mem.updatedAt = now;
				updatedCount++;
			}
		}

		for (const fact of state.sharedFacts) {
			if (
				fact.id.toLowerCase() === needle ||
				fact.key.toLowerCase().includes(needle) ||
				fact.value.toLowerCase().includes(needle)
			) {
				fact.value = newContent.trim();
				fact.updatedAt = now;
				updatedCount++;
			}
		}

		if (updatedCount > 0) {
			this.store.save();
		}
		return { updatedCount };
	}

	forget(botId: string, matchTextOrId: string): { removedCount: number } {
		const state = this.store.getState();
		const needle = matchTextOrId.trim().toLowerCase();

		const beforeMem = state.memories.length;
		state.memories = state.memories.filter((m) => {
			if (m.botId !== botId) return true;
			return !(m.id.toLowerCase() === needle || m.content.toLowerCase().includes(needle));
		});

		const beforeFacts = state.sharedFacts.length;
		state.sharedFacts = state.sharedFacts.filter((f) => {
			return !(
				f.id.toLowerCase() === needle ||
				f.key.toLowerCase() === needle ||
				f.value.toLowerCase().includes(needle)
			);
		});

		const removedCount =
			beforeMem - state.memories.length + (beforeFacts - state.sharedFacts.length);
		if (removedCount > 0) {
			this.store.save();
		}
		return { removedCount };
	}

	/**
	 * Erases all memories of a deleted Bot, including shared facts saved by that Bot
	 * (per Grok Bot specification).
	 */
	deleteBotMemories(botId: string): void {
		const state = this.store.getState();
		state.memories = state.memories.filter((m) => m.botId !== botId);
		state.sharedFacts = state.sharedFacts.filter((f) => f.savedByBotId !== botId);
		this.store.save();
	}

	/**
	 * Imports memory exported from another AI assistant into the user's Primary Bot.
	 */
	importFromOtherAssistant(
		primaryBotId: string,
		exportedText: string,
	): { importedMemories: MemoryItem[]; importedSharedFacts: SharedUserFact[] } {
		const lines = exportedText
			.split(/\r?\n/)
			.map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
			.filter((l) => l.length > 3);

		const importedMemories: MemoryItem[] = [];
		const importedSharedFacts: SharedUserFact[] = [];

		for (const line of lines) {
			const lower = line.toLowerCase();
			const isShared =
				lower.includes("name is") ||
				lower.includes("timezone") ||
				lower.includes("time zone") ||
				lower.includes("based in") ||
				lower.includes("role is");
			const category: MemoryCategory =
				lower.includes("always") || lower.includes("never")
					? "rule"
					: lower.includes("prefer") || lower.includes("like")
						? "preference"
						: "fact";

			const res = this.remember({
				botId: primaryBotId,
				category,
				content: line,
				sharedAcrossBots: isShared,
			});
			importedMemories.push(res.memory);
			if (res.sharedFact) {
				importedSharedFacts.push(res.sharedFact);
			}
		}

		return { importedMemories, importedSharedFacts };
	}

	/**
	 * Formats the Bot's private memories and account-wide shared facts for injection
	 * into the Bot's system prompt.
	 */
	formatMemoryForPrompt(botId: string): string {
		const { botMemories, sharedFacts } = this.recall(botId);
		const sections: string[] = [];

		if (sharedFacts.length > 0) {
			sections.push(
				"### Shared Account Facts (known across all your user's Bots)\n" +
					sharedFacts.map((f) => `- **${f.key}**: ${f.value}`).join("\n"),
			);
		}

		const rules = botMemories.filter((m) => m.category === "rule");
		const prefs = botMemories.filter((m) => m.category === "preference");
		const facts = botMemories.filter((m) => m.category === "fact");
		const workLogs = botMemories.filter((m) => m.category === "work_log").slice(-10);

		if (rules.length > 0) {
			sections.push(
				"### Lasting Rules & Approval Boundaries\n" +
					rules.map((r) => `- ${r.content}`).join("\n"),
			);
		}
		if (prefs.length > 0) {
			sections.push(
				"### Working Style & Preferences\n" + prefs.map((p) => `- ${p.content}`).join("\n"),
			);
		}
		if (facts.length > 0) {
			sections.push("### Learned Role Facts\n" + facts.map((f) => `- ${f.content}`).join("\n"));
		}
		if (workLogs.length > 0) {
			sections.push(
				"### Recent Work Log\n" +
					workLogs
						.map((w) => `- [${w.createdAt.slice(0, 10)}] ${w.content}`)
						.join("\n"),
			);
		}

		return sections.length > 0
			? sections.join("\n\n")
			: "No saved memories yet. Save durable preferences, rules, and work summaries using `memory_remember`.";
	}
}
