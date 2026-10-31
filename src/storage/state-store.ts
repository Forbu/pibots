import fs from "node:fs";
import path from "node:path";
import type {
	BotProfile,
	CollaborativePage,
	PiBotsPersistedState,
	RoutineDefinition,
} from "../types.ts";
import {
	DEFAULT_CONNECTED_APPS,
	DEFAULT_SKILLS,
	STARTER_BOT_TEMPLATES,
} from "./starter-templates.ts";

export interface StateStoreOptions {
	dataDir: string;
	workspaceDir?: string;
}

export class StateStore {
	readonly dataDir: string;
	readonly workspaceDir: string;
	readonly sessionsDir: string;
	readonly skillsDir: string;
	readonly stateFilePath: string;
	private state: PiBotsPersistedState;

	constructor(options: StateStoreOptions) {
		this.dataDir = path.resolve(options.dataDir);
		this.workspaceDir = path.resolve(
			options.workspaceDir ?? path.join(this.dataDir, "workspace"),
		);
		this.sessionsDir = path.join(this.dataDir, "sessions");
		this.skillsDir = path.join(this.workspaceDir, ".pi", "skills");
		this.stateFilePath = path.join(this.dataDir, "pibots-state.json");

		fs.mkdirSync(this.dataDir, { recursive: true });
		fs.mkdirSync(this.workspaceDir, { recursive: true });
		fs.mkdirSync(this.sessionsDir, { recursive: true });
		fs.mkdirSync(this.skillsDir, { recursive: true });

		this.state = this.loadOrCreateInitialState();
		this.ensureWorkspaceSeedFiles();
	}

	getState(): PiBotsPersistedState {
		return this.state;
	}

	save(): void {
		const tmpPath = `${this.stateFilePath}.tmp`;
		fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), "utf8");
		fs.renameSync(tmpPath, this.stateFilePath);
	}

	getBotSessionDir(botId: string): string {
		const dir = path.join(this.sessionsDir, botId);
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	}

	private loadOrCreateInitialState(): PiBotsPersistedState {
		if (fs.existsSync(this.stateFilePath)) {
			try {
				const raw = fs.readFileSync(this.stateFilePath, "utf8");
				const parsed = JSON.parse(raw) as PiBotsPersistedState;
				parsed.computer.workspaceDir = this.workspaceDir;
				return parsed;
			} catch {
				// Fall through to default state if corrupted
			}
		}

		const now = new Date().toISOString();
		const defaultTools = [
			"read",
			"bash",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
			"codemode",
			"tool_search",
		];

		const initialBots: BotProfile[] = [
			{
				id: "bot-chief",
				name: "Atlas",
				label: "Chief of Staff",
				avatar: { shape: "spark", color: "#10B981" },
				job: STARTER_BOT_TEMPLATES[0].job,
				isPrimary: true,
				pinned: true,
				hidden: false,
				section: "Core Team",
				draftsEnabled: true,
				enabledSkills: ["weekly-account-health"],
				allowedTools: defaultTools,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "bot-outbound",
				name: "Sierra",
				label: "Sales Outbound",
				avatar: { shape: "hexagon", color: "#3B82F6" },
				job: STARTER_BOT_TEMPLATES[1].job,
				isPrimary: false,
				pinned: true,
				hidden: false,
				section: "GTM & Revenue",
				draftsEnabled: true,
				enabledSkills: ["outbound-pipeline-prep"],
				allowedTools: defaultTools,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "bot-repro",
				name: "Kestrel",
				label: "Bug Reproduction",
				avatar: { shape: "shield", color: "#F59E0B" },
				job: STARTER_BOT_TEMPLATES[2].job,
				isPrimary: false,
				pinned: false,
				hidden: false,
				section: "Engineering",
				draftsEnabled: true,
				enabledSkills: ["bug-reproduction-pack"],
				allowedTools: defaultTools,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: "bot-health",
				name: "Vesper",
				label: "Account Health",
				avatar: { shape: "diamond", color: "#8B5CF6" },
				job: STARTER_BOT_TEMPLATES[3].job,
				isPrimary: false,
				pinned: false,
				hidden: false,
				section: "GTM & Revenue",
				draftsEnabled: true,
				enabledSkills: ["weekly-account-health"],
				allowedTools: defaultTools,
				createdAt: now,
				updatedAt: now,
			},
		];

		const initialRoutines: RoutineDefinition[] = [
			{
				id: "rtn-morning-briefing",
				botId: "bot-chief",
				name: "Morning briefing & stalled handoff check",
				instructions:
					"Review /workspace tasks, recent Bot handoffs, and unread inbox items. Update the 'Daily Scoreboard' Page with priorities and any blocked approvals.",
				skillName: "weekly-account-health",
				trigger: {
					type: "schedule",
					scheduleText: "every weekday at 8:00 AM",
					intervalMs: 24 * 60 * 60 * 1000,
					timezone: "UTC",
				},
				inputSource: "/workspace and Bot roster activity",
				expectedResult: "Updated Daily Scoreboard Page in the Library",
				approvalBoundary: "Never send external emails or modify external systems without approval.",
				onMissingSource: "Report which source is unavailable rather than guessing.",
				enabled: true,
				createdAt: now,
				updatedAt: now,
				nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
				runs: [],
			},
			{
				id: "rtn-invoice-watcher",
				botId: "bot-chief",
				name: "Incoming invoice & shop tag triage",
				instructions:
					"When an email arrives with tag +shop or from billing vendors, extract vendor, amount, and renewal date into /workspace/expenses/ledger.json and update the Expenses Page.",
				trigger: {
					type: "event",
					eventType: "email",
					filter: "+shop",
				},
				inputSource: "Agent Email inbox (+shop)",
				expectedResult: "Logged invoice entry and draft confirmation",
				approvalBoundary: "Never approve payments or cancel subscriptions without user confirmation.",
				onMissingSource: "Skip and log notice.",
				enabled: true,
				createdAt: now,
				updatedAt: now,
				runs: [],
			},
		];

		const initialPages: CollaborativePage[] = [
			{
				id: "page-daily-scoreboard",
				slug: "daily-scoreboard",
				title: "Monday Pipeline & Operations Scoreboard",
				botId: "bot-chief",
				content: `# Monday Pipeline & Operations Scoreboard

Updated by **Atlas (Chief of Staff)** on the shared computer \`/workspace\`.

## Active Lanes
* **Pipeline Outbound (Sierra):** 5 high-intent accounts queued in \`/workspace/crm/pipeline_review.json\`.
* **Account Health (Vesper):** Watching 2 renewal accounts with open support escalations.
* **Engineering Triage (Kestrel):** Ready to reproduce staging regressions inside \`/workspace/repro\`.

## Approval Boundary Status
* **Auto Review:** Active (Ask first rules enforced before external sends or destructive commands)
* **Agent Email:** \`team@pibots.local\` (Outgoing routine emails always wait as Draft Cards)
`,
				format: "markdown",
				pinned: true,
				visibility: "team",
				createdAt: now,
				updatedAt: now,
			},
		];

		const initialState: PiBotsPersistedState = {
			version: 1,
			computer: {
				status: "awake",
				workspaceDir: this.workspaceDir,
				softwareVersion: "0.78.1-pibots",
				activeScreens: {},
				agentEmailAddress: "team@pibots.local",
				unsubscribedAddresses: [],
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
				messagingBetweenBotsEnabled: true,
			},
			bots: initialBots,
			templates: STARTER_BOT_TEMPLATES,
			memories: [
				{
					id: "mem-1",
					botId: "bot-chief",
					category: "rule",
					content:
						"Always ask before sending external emails or changing production configuration.",
					sharedAcrossBots: false,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "mem-2",
					botId: "bot-outbound",
					category: "preference",
					content:
						"Write outbound emails in a concise, direct founder-to-founder tone under 120 words. Note: Acme Corp only signs annual agreements and Dana approves pricing.",
					sharedAcrossBots: false,
					createdAt: now,
					updatedAt: now,
				},
			],
			sharedFacts: [
				{
					id: "sf-1",
					key: "timezone",
					value: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
					savedByBotId: "bot-chief",
					updatedAt: now,
				},
				{
					id: "sf-2",
					key: "working_style",
					value:
						"Prefer finished work in /workspace and collaborative Pages; only interrupt for consequential approvals.",
					savedByBotId: "bot-chief",
					updatedAt: now,
				},
			],
			autoReview: {
				enabled: true,
				localExecutionPolicy: "ask_every_time",
				customRules: [
					{
						id: "rule-ask-external-email",
						whenAction: "send any external email or customer message",
						behavior: "ask_first",
						createdAt: now,
					},
					{
						id: "rule-ask-production",
						whenAction: "delete files recursively, force push git, or modify production settings",
						behavior: "ask_first",
						createdAt: now,
					},
					{
						id: "rule-allow-git-status",
						whenAction: "run git status, ls, or read files in /workspace",
						behavior: "allow_automatically",
						createdAt: now,
					},
				],
			},
			approvalCards: [],
			vault: [
				{
					id: "vault-contact-primary",
					type: "contact",
					name: "Workspace Owner",
					email: "owner@pibots.local",
					phone: "+1-415-555-0192",
					address: "548 Market St, San Francisco, CA",
					isPrimary: true,
					nickname: "Primary Work Contact",
					hints: "Use for standard work sign-ins and billing contact fields.",
					createdAt: now,
					updatedAt: now,
				},
			],
			secureForms: [],
			skills: [...DEFAULT_SKILLS],
			demonstrations: [],
			routines: initialRoutines,
			drafts: [],
			emails: [
				{
					id: "email-seed-1",
					direction: "inbound",
					from: "dana@acmecorp.example.com",
					to: ["team@pibots.local"],
					subject: "Re: Annual Enterprise Renewal & Seat Expansion",
					body: "Hi team, we are ready to add 25 seats to our annual plan if we can get the SSO provisioning checklist by Friday. Remember we only sign annual terms. — Dana, VP Ops at Acme Corp",
					attachments: [],
					fromOwner: false,
					authenticatedSender: true,
					receivedAt: now,
				},
				{
					id: "email-seed-2",
					direction: "inbound",
					from: "billing@cloudmetrics.example.com",
					to: ["team+shop@pibots.local"],
					tag: "shop",
					subject: "Invoice #INV-2026-8841 — CloudMetrics Pro Renewal ($420.00)",
					body: "Your CloudMetrics Pro subscription renews on Nov 15, 2026 for $420.00/month (up from $350.00/month). Currently 2 of 15 seats are active.",
					attachments: ["INV-2026-8841.pdf"],
					fromOwner: false,
					authenticatedSender: true,
					receivedAt: now,
				},
			],
			pages: initialPages,
			connectedApps: [...DEFAULT_CONNECTED_APPS],
			groupChats: [
				{
					id: "group-launch-ops",
					name: "Pipeline & Customer Watch",
					description:
						"Cross-functional coordination between Chief of Staff, Sales Outbound, and Account Health.",
					botIds: ["bot-chief", "bot-outbound", "bot-health"],
					activeOwnerBotId: "bot-chief",
					messages: [
						{
							id: "gmsg-1",
							groupId: "group-launch-ops",
							senderType: "bot",
							senderId: "bot-chief",
							senderName: "Atlas (Chief of Staff)",
							content:
								"Welcome to the Pipeline & Customer Watch group chat. @Sierra owns outbound pipeline prep and @Vesper owns weekly account-health signals. Hand off tasks here and we will coordinate on `/workspace/crm/pipeline_review.json`.",
							mentions: ["Sierra", "Vesper"],
							assignedOwnerBotId: "bot-chief",
							createdAt: now,
						},
					],
					createdAt: now,
					updatedAt: now,
				},
			],
			transcripts: {},
			voiceCalls: [],
		};

		this.state = initialState;
		this.save();
		return initialState;
	}

	private ensureWorkspaceSeedFiles(): void {
		const crmDir = path.join(this.workspaceDir, "crm");
		const expensesDir = path.join(this.workspaceDir, "expenses");
		const reproDir = path.join(this.workspaceDir, "repro");
		fs.mkdirSync(crmDir, { recursive: true });
		fs.mkdirSync(expensesDir, { recursive: true });
		fs.mkdirSync(reproDir, { recursive: true });

		const pipelinePath = path.join(crmDir, "pipeline_review.json");
		if (!fs.existsSync(pipelinePath)) {
			const samplePipeline = [
				{
					account: "Acme Corp",
					domain: "acmecorp.example.com",
					inActiveSequence: false,
					intentScore: 94,
					primaryContact: "Dana Sterling (VP Operations)",
					email: "dana@acmecorp.example.com",
					signals: "Replied on annual pricing; requested SSO provisioning checklist; expanding by 25 seats.",
					healthStatus: "Expansion Ready",
				},
				{
					account: "Northstar Logistics",
					domain: "northstar.example.com",
					inActiveSequence: false,
					intentScore: 88,
					primaryContact: "Marcus Vance (Head of Platform)",
					email: "mvance@northstar.example.com",
					signals: "Visited enterprise docs 14 times this week; evaluating multi-bot automation.",
					healthStatus: "High Intent",
				},
				{
					account: "Helios Biotech",
					domain: "heliosbio.example.com",
					inActiveSequence: true,
					intentScore: 82,
					primaryContact: "Elena Rostova (CTO)",
					email: "elena@heliosbio.example.com",
					signals: "Already in active sequence (touched 2 days ago — skip in new outbound).",
					healthStatus: "Active Sequence",
				},
				{
					account: "Vanguard FinTech",
					domain: "vanguardfin.example.com",
					inActiveSequence: false,
					intentScore: 76,
					primaryContact: "Liam O'Connor (VP Engineering)",
					email: "liam@vanguardfin.example.com",
					signals: "2 open P1 tickets on webhook latency; usage dropped 18% over 14 days.",
					healthStatus: "Churn Risk",
				},
			];
			fs.writeFileSync(pipelinePath, JSON.stringify(samplePipeline, null, 2), "utf8");
		}

		const ledgerPath = path.join(expensesDir, "subscriptions.json");
		if (!fs.existsSync(ledgerPath)) {
			const sampleSubscriptions = [
				{
					vendor: "CloudMetrics Pro",
					monthlyCostUsd: 420,
					previousCostUsd: 350,
					seatsUsed: 2,
					seatsTotal: 15,
					renewalDate: "2026-11-15",
					status: "active",
					recommendation: "Unused seats & 20% price hike detected",
				},
				{
					vendor: "TestGrid Staging",
					monthlyCostUsd: 89,
					previousCostUsd: 89,
					seatsUsed: 0,
					seatsTotal: 5,
					renewalDate: "2026-11-04",
					status: "trial_ending",
					recommendation: "Trial ends in 4 days; 0 active users",
				},
			];
			fs.writeFileSync(ledgerPath, JSON.stringify(sampleSubscriptions, null, 2), "utf8");
		}
	}
}
