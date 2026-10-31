import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createSyntheticSourceInfo, type Skill } from "@earendil-works/pi-coding-agent";
import type { StateStore } from "../storage/state-store.ts";
import type {
	DemonstrationSession,
	DemonstrationStep,
	SkillDefinition,
} from "../types.ts";
import type { VaultManager } from "../vault/vault-manager.ts";

/**
 * SkillsManager manages Grok Bot's shared Skills library, Teach-by-Demonstration
 * workflow recorder, and materializes skills as Pi Agent SDK `SKILL.md` resources.
 */
export class SkillsManager {
	private readonly store: StateStore;
	private readonly vault: VaultManager;

	constructor(store: StateStore, vault: VaultManager) {
		this.store = store;
		this.vault = vault;
		this.syncAllSkillsToDisk();
	}

	private slugify(name: string): string {
		return (
			name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-|-$/g, "") || "skill"
		);
	}

	listSkills(): SkillDefinition[] {
		return this.store.getState().skills;
	}

	getSkillByNameOrSlug(nameOrSlug: string): SkillDefinition | undefined {
		const needle = nameOrSlug.trim().toLowerCase();
		return this.store
			.getState()
			.skills.find(
				(s) => s.name.toLowerCase() === needle || s.slug.toLowerCase() === needle || s.id === needle,
			);
	}

	saveSkill(input: {
		name: string;
		description: string;
		whenToUse: string;
		requiredInputsAndAccess: string[];
		steps: string[];
		validation: string;
		expectedOutput: string;
		approvalBoundaries: string[];
		publishedToTeam?: boolean;
		createdByBotId?: string;
	}): SkillDefinition {
		const slug = this.slugify(input.name);
		const now = new Date().toISOString();
		const skills = this.store.getState().skills;
		const existingIdx = skills.findIndex((s) => s.slug === slug);

		const skill: SkillDefinition = {
			id: existingIdx >= 0 ? skills[existingIdx].id : `skill-${crypto.randomUUID().slice(0, 8)}`,
			name: input.name.trim(),
			slug,
			description: input.description.trim(),
			whenToUse: input.whenToUse.trim(),
			requiredInputsAndAccess: input.requiredInputsAndAccess,
			steps: input.steps,
			validation: input.validation.trim(),
			expectedOutput: input.expectedOutput.trim(),
			approvalBoundaries: input.approvalBoundaries,
			publishedToTeam: Boolean(input.publishedToTeam),
			createdByBotId: input.createdByBotId,
			createdAt: existingIdx >= 0 ? skills[existingIdx].createdAt : now,
			updatedAt: now,
		};

		if (existingIdx >= 0) {
			skills[existingIdx] = skill;
		} else {
			skills.push(skill);
		}

		this.writeSkillMarkdownFile(skill);
		this.store.save();
		return skill;
	}

	publishSkillToTeam(skillIdOrSlug: string): SkillDefinition {
		const skill = this.getSkillByNameOrSlug(skillIdOrSlug);
		if (!skill) {
			throw new Error(`Skill "${skillIdOrSlug}" not found.`);
		}
		if (!skill.description || skill.description.trim().length < 5) {
			throw new Error(
				"A skill needs a description before you can publish it, because teammates and their Bots use the description to decide when it applies.",
			);
		}
		skill.publishedToTeam = true;
		skill.updatedAt = new Date().toISOString();
		this.store.save();
		return skill;
	}

	deleteSkill(skillIdOrSlug: string): boolean {
		const state = this.store.getState();
		const skill = this.getSkillByNameOrSlug(skillIdOrSlug);
		if (!skill) return false;

		state.skills = state.skills.filter((s) => s.id !== skill.id);
		const skillDir = path.join(this.store.skillsDir, skill.slug);
		if (fs.existsSync(skillDir)) {
			fs.rmSync(skillDir, { recursive: true, force: true });
		}
		this.store.save();
		return true;
	}

	/**
	 * Teach a workflow by demonstration:
	 * Starts a recording session where visible computer/workspace actions are logged
	 * and then converted into a reusable Skill draft.
	 */
	startDemonstration(botId: string, goalDescription: string): DemonstrationSession {
		const demo: DemonstrationSession = {
			id: `demo-${crypto.randomUUID().slice(0, 8)}`,
			botId,
			goalDescription: goalDescription.trim(),
			startedAt: new Date().toISOString(),
			steps: [],
			status: "recording",
		};
		this.store.getState().demonstrations.push(demo);
		this.store.save();
		return demo;
	}

	recordDemonstrationStep(
		demoId: string,
		step: Omit<DemonstrationStep, "timestamp">,
	): DemonstrationSession {
		const demo = this.store.getState().demonstrations.find((d) => d.id === demoId);
		if (!demo) {
			throw new Error(`Demonstration session ${demoId} not found`);
		}
		if (demo.status !== "recording") {
			throw new Error(`Demonstration session ${demoId} is already completed`);
		}

		// Never record secrets during a demonstration
		const safeSummary = this.vault.redactSecrets(step.summary);
		demo.steps.push({
			timestamp: new Date().toISOString(),
			kind: step.kind,
			summary: safeSummary,
			target: step.target ? this.vault.redactSecrets(step.target) : undefined,
		});
		this.store.save();
		return demo;
	}

	finishDemonstration(
		demoId: string,
		options?: {
			skillName?: string;
			approvalBoundaries?: string[];
			validation?: string;
			expectedOutput?: string;
		},
	): { demonstration: DemonstrationSession; skill: SkillDefinition } {
		const demo = this.store.getState().demonstrations.find((d) => d.id === demoId);
		if (!demo) {
			throw new Error(`Demonstration session ${demoId} not found`);
		}
		demo.status = "completed";
		demo.endedAt = new Date().toISOString();

		const skillName =
			options?.skillName?.trim() ||
			`Learned: ${demo.goalDescription.slice(0, 48)}`;
		const steps =
			demo.steps.length > 0
				? demo.steps.map(
						(s, idx) =>
							`Step ${idx + 1} (${s.kind}${s.target ? ` on ${s.target}` : ""}): ${s.summary}`,
					)
				: [`Execute workflow for: ${demo.goalDescription}`];

		const skill = this.saveSkill({
			name: skillName,
			description: `Learned by demonstration: ${demo.goalDescription}`,
			whenToUse: `Use when asked to perform: ${demo.goalDescription}`,
			requiredInputsAndAccess: ["Shared computer /workspace", "Connected apps used in demonstration"],
			steps,
			validation:
				options?.validation ||
				"Verify all steps completed cleanly and output matches the demonstrated result.",
			expectedOutput:
				options?.expectedOutput || `Completed result for ${demo.goalDescription}`,
			approvalBoundaries: options?.approvalBoundaries ?? [
				"Ask for approval before sending external messages, modifying billing, or making irreversible changes.",
			],
			createdByBotId: demo.botId,
		});

		demo.synthesizedSkillId = skill.id;
		const bot = this.store.getState().bots.find((b) => b.id === demo.botId);
		if (bot && !bot.enabledSkills.includes(skill.slug)) {
			bot.enabledSkills.push(skill.slug);
		}
		this.store.save();
		return { demonstration: demo, skill };
	}

	/**
	 * Converts our SkillDefinitions into Pi Agent SDK `Skill` objects for `DefaultResourceLoader`.
	 */
	toPiSdkSkills(enabledSlugs?: string[]): Skill[] {
		const skills = this.listSkills().filter((s) =>
			enabledSlugs && enabledSlugs.length > 0 ? enabledSlugs.includes(s.slug) : true,
		);
		return skills.map((s) => {
			const filePath = this.writeSkillMarkdownFile(s);
			return {
				name: s.slug,
				description: s.description,
				filePath,
				baseDir: path.dirname(filePath),
				sourceInfo: createSyntheticSourceInfo(filePath, { source: "sdk" }),
				disableModelInvocation: false,
			};
		});
	}

	syncAllSkillsToDisk(): void {
		for (const skill of this.store.getState().skills) {
			this.writeSkillMarkdownFile(skill);
		}
	}

	private writeSkillMarkdownFile(skill: SkillDefinition): string {
		const dir = path.join(this.store.skillsDir, skill.slug);
		fs.mkdirSync(dir, { recursive: true });
		const filePath = path.join(dir, "SKILL.md");

		const content = `---
name: ${skill.slug}
description: ${JSON.stringify(skill.description)}
---

# ${skill.name}

${skill.description}

## 1. When to use it
${skill.whenToUse}

## 2. Required inputs and access
${skill.requiredInputsAndAccess.map((i) => `- ${i}`).join("\n")}

## 3. Sequence of work
${skill.steps.map((s, idx) => `${idx + 1}. ${s}`).join("\n")}

## 4. How to validate the result
${skill.validation}

## 5. What to return
${skill.expectedOutput}

## 6. What requires approval
${skill.approvalBoundaries.map((b) => `- ${b}`).join("\n")}
`;

		fs.writeFileSync(filePath, content, "utf8");
		return filePath;
	}
}
