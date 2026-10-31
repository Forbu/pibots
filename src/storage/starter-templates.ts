import type { BotTemplate, ConnectedApp, SkillDefinition } from "../types.ts";

export const DEFAULT_SKILLS: SkillDefinition[] = [
	{
		id: "skill-weekly-account-health",
		name: "Weekly account health",
		slug: "weekly-account-health",
		description:
			"Pull product usage and support signals, flag evidence of churn or expansion, and produce a linked watch list for the team.",
		whenToUse:
			"Use during weekly customer account health reviews or when asked to evaluate churn and expansion signals across accounts.",
		requiredInputsAndAccess: [
			"Account list in /workspace/accounts or connected CRM",
			"Support ticket history or usage metrics",
		],
		steps: [
			"Read the current account list and recent support/usage metrics from /workspace or connected apps.",
			"Score each account for churn risk (declining usage, open P1 tickets, stalled renewals) and expansion signals (seat growth, feature adoption).",
			"Compile a Markdown report and live Page summarizing red-flag accounts, expansion candidates, and recommended next actions.",
			"Prepare draft follow-up emails for at-risk accounts without sending them.",
		],
		validation:
			"Verify every flagged account includes a concrete metric or support citation and that no external messages were sent.",
		expectedOutput:
			"A linked watch list Page in the Library plus draft outreach cards waiting for approval.",
		approvalBoundaries: [
			"Never contact a customer or modify CRM stage/billing fields without explicit approval.",
		],
		publishedToTeam: true,
		createdAt: "2026-10-01T09:00:00.000Z",
		updatedAt: "2026-10-01T09:00:00.000Z",
	},
	{
		id: "skill-bug-repro-pack",
		name: "Bug reproduction pack",
		slug: "bug-reproduction-pack",
		description:
			"Reproduce a reported issue in the shared workspace, capture minimal reproduction steps and logs, and prepare a fix handoff.",
		whenToUse:
			"Use when a bug report, support escalation, or failing test needs reproduction and root-cause isolation.",
		requiredInputsAndAccess: [
			"Shared computer /workspace repository access",
			"Issue description or stack trace",
		],
		steps: [
			"Inspect the reported error, stack trace, or ticket details.",
			"Create or run a minimal reproduction script or test in /workspace.",
			"Capture exact terminal output, failing assertions, and offending file/line locations.",
			"Write a structured repro summary Page and optionally hand off to a debugging Bot.",
		],
		validation:
			"Confirm the reproduction command deterministically triggers the issue and all paths exist.",
		expectedOutput:
			"A reproducible test case in /workspace and a concise root-cause brief.",
		approvalBoundaries: [
			"Do not push to production branches, deploy, or close external tickets without approval.",
		],
		publishedToTeam: true,
		createdAt: "2026-10-02T11:30:00.000Z",
		updatedAt: "2026-10-02T11:30:00.000Z",
	},
	{
		id: "skill-outbound-pipeline-prep",
		name: "Outbound pipeline prep",
		slug: "outbound-pipeline-prep",
		description:
			"Research target accounts, skip active sequences, identify decision-makers, and draft personalized outreach in the owner's voice.",
		whenToUse:
			"Use when preparing weekly outbound campaigns or account research briefs.",
		requiredInputsAndAccess: [
			"Target account list in /workspace",
			"Owner voice preferences in Bot memory",
		],
		steps: [
			"Load the pipeline review list and filter out accounts already in an active sequence.",
			"Research the top accounts and identify primary contacts and recent company signals.",
			"Draft personalized outreach emails in the user's voice and save them as Draft Cards for review.",
		],
		validation:
			"Ensure active-sequence accounts are excluded and every email is saved as a draft rather than sent directly.",
		expectedOutput:
			"Account research table and ready-to-approve email Draft Cards.",
		approvalBoundaries: [
			"Always leave outbound emails as drafts for approval; never send external messages unattended.",
		],
		publishedToTeam: true,
		createdAt: "2026-10-05T14:15:00.000Z",
		updatedAt: "2026-10-05T14:15:00.000Z",
	},
];

export const STARTER_BOT_TEMPLATES: BotTemplate[] = [
	{
		id: "tpl-chief-of-staff",
		name: "Chief of Staff",
		label: "Primary Coordinator",
		avatar: { shape: "spark", color: "#10B981" },
		job: `You are the Primary Bot (Chief of Staff). You are the user's main point of contact.
Own end-to-end coordination across the user's Bot roster. Break multi-step projects into specialist lanes, hand off work to specialist Bots on the shared computer (/workspace), synthesize their results, keep collaborative Pages updated, and only interrupt the user when a judgment call or approval is required.`,
		skills: [DEFAULT_SKILLS[0]],
		routines: [
			{
				name: "Morning briefing & stalled handoff check",
				instructions:
					"Review /workspace tasks, recent Bot handoffs, and unread inbox items. Update the 'Daily Scoreboard' Page with priorities and any blocked approvals.",
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
			},
		],
		visibility: "public",
		createdAt: "2026-10-01T08:00:00.000Z",
	},
	{
		id: "tpl-sales-outbound",
		name: "Sales Outbound",
		label: "Pipeline & Outreach Specialist",
		avatar: { shape: "hexagon", color: "#3B82F6" },
		job: `Own outbound pipeline research and personalized outreach drafting.
Pull target accounts from /workspace or CRM connectors, skip anyone already in an active sequence, score contacts with intent, and draft concise outreach emails in the user's voice. Always create Draft Cards for approval before sending any external communication.`,
		skills: [DEFAULT_SKILLS[2]],
		routines: [],
		visibility: "public",
		createdAt: "2026-10-02T08:00:00.000Z",
	},
	{
		id: "tpl-bug-reproduction",
		name: "Bug Reproduction",
		label: "QA & Triage Engineer",
		avatar: { shape: "shield", color: "#F59E0B" },
		job: `Own bug triage, deterministic reproduction in /workspace, and root-cause analysis.
When given an issue or stack trace, reproduce it on the shared computer, isolate the offending code, build a clean repro script, and prepare a patch or hand off to engineering. Never push to production or close customer tickets without approval.`,
		skills: [DEFAULT_SKILLS[1]],
		routines: [],
		visibility: "public",
		createdAt: "2026-10-03T08:00:00.000Z",
	},
	{
		id: "tpl-account-health",
		name: "Account Health",
		label: "Customer Success Analyst",
		avatar: { shape: "diamond", color: "#8B5CF6" },
		job: `Own the weekly account-health review. Pull product usage and support signals from /workspace, flag evidence of churn or expansion, and produce a linked watch list Page for the customer-success team. Never contact a customer or change an account without approval.`,
		skills: [DEFAULT_SKILLS[0]],
		routines: [],
		visibility: "public",
		createdAt: "2026-10-04T08:00:00.000Z",
	},
	{
		id: "tpl-expense-manager",
		name: "Expense Manager",
		label: "Finance & Ops Specialist",
		avatar: { shape: "octagon", color: "#EC4899" },
		job: `Own invoice processing, subscription tracking, and expense reconciliation.
Monitor incoming invoices in the Agent Email inbox, extract vendor, amount, renewal date, and line items into /workspace/expenses, flag unused subscriptions or price increases, and ask for approval before any payment or cancellation.`,
		skills: [],
		routines: [],
		visibility: "public",
		createdAt: "2026-10-05T08:00:00.000Z",
	},
	{
		id: "tpl-talent-scout",
		name: "Talent Scout",
		label: "Recruiting Partner",
		avatar: { shape: "circle", color: "#14B8A6" },
		job: `Own candidate sourcing, portfolio evaluation, and outreach drafting.
Evaluate candidate profiles and repositories in /workspace, write structured candidate scorecards as Pages, and prepare personalized outreach drafts waiting for approval.`,
		skills: [],
		routines: [],
		visibility: "public",
		createdAt: "2026-10-06T08:00:00.000Z",
	},
];

export const DEFAULT_CONNECTED_APPS: ConnectedApp[] = [
	{
		id: "app-gmail",
		name: "Gmail",
		slug: "gmail",
		category: "communication",
		status: "connected",
		description: "Read threads, create reply drafts, attach workspace files, and send approved emails.",
		connectedAt: "2026-10-10T10:00:00.000Z",
	},
	{
		id: "app-slack",
		name: "Slack",
		slug: "slack",
		category: "communication",
		status: "connected",
		description: "Read public/shared channels, answer thread replies, and post team updates.",
		connectedAt: "2026-10-10T10:05:00.000Z",
	},
	{
		id: "app-github",
		name: "GitHub",
		slug: "github",
		category: "engineering",
		status: "connected",
		description: "List repositories, compare commits, inspect PRs, and read issue comments.",
		connectedAt: "2026-10-10T10:10:00.000Z",
	},
	{
		id: "app-linear",
		name: "Linear",
		slug: "linear",
		category: "engineering",
		status: "connected",
		description: "Track engineering issues, triage escalations, and link bug repro packs.",
		connectedAt: "2026-10-10T10:15:00.000Z",
	},
	{
		id: "app-calendar",
		name: "Google Calendar",
		slug: "google-calendar",
		category: "productivity",
		status: "connected",
		description: "Check availability and schedule or update calendar events in one step.",
		connectedAt: "2026-10-10T10:20:00.000Z",
	},
	{
		id: "app-x",
		name: "X (Twitter)",
		slug: "x",
		category: "communication",
		status: "connected",
		description: "Search public posts, read mentions, and pick up @bot tagged tasks.",
		connectedAt: "2026-10-10T10:25:00.000Z",
	},
	{
		id: "app-crm",
		name: "Salesforce / Zoho CRM",
		slug: "crm",
		category: "crm",
		status: "needs_auth",
		description: "Pull pipeline review lists, update call transcript notes, and flag commit risk.",
	},
	{
		id: "app-shop-pay",
		name: "Shop Pay & Link",
		slug: "shop-pay",
		category: "payments",
		status: "needs_auth",
		description: "One-time virtual card checkout and subscription tracking with approval cards.",
	},
];
