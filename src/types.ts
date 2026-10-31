/**
 * Core domain types for PiBots — an open-source implementation of Grok Bot
 * built on the Pi Agent SDK (@earendil-works/pi-coding-agent).
 */

export type BotAvatarShape =
	| "circle"
	| "hexagon"
	| "diamond"
	| "octagon"
	| "shield"
	| "spark"
	| "pumpkin";

export interface BotAvatar {
	shape: BotAvatarShape;
	color: string;
	imageUrl?: string;
}

export interface BotProfile {
	id: string;
	name: string;
	/** Short role title shown under the Bot's name (e.g. "Chief of Staff", "Sales Outbound"). */
	label: string;
	avatar: BotAvatar;
	/** Operational role description, sources, and approval boundaries. */
	job: string;
	/** Primary Bot is the main point of contact that checks in and coordinates other Bots. */
	isPrimary: boolean;
	/** Pinned Bots appear at the top of the sidebar. */
	pinned: boolean;
	/** Hidden Bots are removed from the main sidebar list while keeping history and routines active. */
	hidden: boolean;
	/** Optional sidebar section grouping (e.g. "GTM", "Engineering", "Operations"). */
	section?: string;
	/** Whether outgoing emails/Slack messages prepare drafts for approval by default (default: true). */
	draftsEnabled: boolean;
	/** Enabled skill names from the shared skills library. */
	enabledSkills: string[];
	/** Allowed built-in and custom tool names. */
	allowedTools: string[];
	/** Optional shared-bot description when shared with a team. */
	sharedDescription?: string;
	isSharedBot?: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface BotTemplate {
	id: string;
	name: string;
	label: string;
	avatar: BotAvatar;
	job: string;
	skills: SkillDefinition[];
	routines: Omit<RoutineDefinition, "id" | "botId" | "runs" | "lastRunAt" | "nextRunAt">[];
	visibility: "public" | "team";
	createdAt: string;
}

export type MemoryCategory = "preference" | "rule" | "fact" | "work_log";

export interface MemoryItem {
	id: string;
	botId: string;
	category: MemoryCategory;
	content: string;
	/** If true, this fact about the user (e.g. name, timezone) is shared across all Bots on the account. */
	sharedAcrossBots: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface SharedUserFact {
	id: string;
	key: string;
	value: string;
	savedByBotId: string;
	updatedAt: string;
}

export type AutoReviewBehavior = "allow_automatically" | "ask_first";

export interface AutoReviewRule {
	id: string;
	/** Plain-words description of the action under "When Bot wants to:" (up to 1000 chars). */
	whenAction: string;
	behavior: AutoReviewBehavior;
	requiredByAdmin?: boolean;
	createdAt: string;
}

export type LocalExecutionPolicy = "ask_every_time" | "always_allow" | "never_allow";

export interface AutoReviewSettings {
	enabled: boolean;
	requiredByAdmin?: boolean;
	localExecutionPolicy: LocalExecutionPolicy;
	/** Up to 20 "allow_automatically" and 20 "ask_first" rules. If both match, "ask_first" wins. */
	customRules: AutoReviewRule[];
}

export type ApprovalWarning =
	| "This can't be undone"
	| "This changes sign-in or security settings"
	| "This shares your data outside this chat";

export type TurnOrigin = "user_chat" | "routine" | "incoming_email" | "group_chat" | "x_tag";

export type ApprovalCardStatus =
	| "pending"
	| "allowed_once"
	| "always_allowed"
	| "denied"
	| "expired";

export interface ApprovalCard {
	id: string;
	botId: string;
	chatId: string;
	toolName: string;
	/** One-sentence plain-language summary of the action. */
	actionSummary: string;
	appName?: string;
	input: Record<string, unknown>;
	warnings: ApprovalWarning[];
	matchedRuleId?: string;
	matchedRuleText?: string;
	origin: TurnOrigin;
	status: ApprovalCardStatus;
	requestedByUser?: string;
	canAlwaysAllow: boolean;
	createdAt: string;
	/** Background/routine cards expire after 30 minutes; user_chat cards wait until answered or superseded. */
	expiresAt?: string;
	resolvedAt?: string;
}

export interface VaultLoginItem {
	id: string;
	type: "login";
	website: string;
	username: string;
	/** Stored write-only; never returned to the LLM. */
	passwordEncrypted: string;
	nickname?: string;
	hints?: string;
	createdAt: string;
	updatedAt: string;
}

export interface VaultCardItem {
	id: string;
	type: "card";
	cardholderName: string;
	/** Only last 4 digits are visible in UI/model metadata. */
	last4: string;
	expiry: string;
	cardNumberEncrypted: string;
	cvvEncrypted: string;
	billingAddress?: string;
	nickname?: string;
	hints?: string;
	createdAt: string;
	updatedAt: string;
}

export interface VaultContactItem {
	id: string;
	type: "contact";
	name: string;
	email?: string;
	phone?: string;
	address?: string;
	isPrimary?: boolean;
	nickname?: string;
	hints?: string;
	createdAt: string;
	updatedAt: string;
}

export interface VaultSecretItem {
	id: string;
	type: "secret";
	envName: string;
	description: string;
	secretEncrypted: string;
	botId?: string;
	createdAt: string;
	updatedAt: string;
}

export type VaultItem =
	| VaultLoginItem
	| VaultCardItem
	| VaultContactItem
	| VaultSecretItem;

export interface SafeVaultSummaryItem {
	id: string;
	type: "login" | "card" | "contact" | "secret";
	label: string;
	details: Record<string, string | boolean | undefined>;
	hints?: string;
}

export interface SecureFormCard {
	id: string;
	botId: string;
	formType: "login" | "card" | "contact" | "secret";
	targetSiteOrEnv: string;
	prompt: string;
	fields: string[];
	saveToVaultDefault: boolean;
	status: "pending" | "filled" | "expired";
	createdAt: string;
	filledAt?: string;
}

export interface SkillDefinition {
	id: string;
	name: string;
	slug: string;
	description: string;
	whenToUse: string;
	requiredInputsAndAccess: string[];
	steps: string[];
	validation: string;
	expectedOutput: string;
	approvalBoundaries: string[];
	publishedToTeam: boolean;
	createdByBotId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface DemonstrationStep {
	timestamp: string;
	kind: "command" | "browser" | "file_edit" | "app_action" | "note";
	summary: string;
	target?: string;
}

export interface DemonstrationSession {
	id: string;
	botId: string;
	goalDescription: string;
	startedAt: string;
	endedAt?: string;
	steps: DemonstrationStep[];
	status: "recording" | "completed";
	synthesizedSkillId?: string;
}

export type RoutineTrigger =
	| {
			type: "schedule";
			/** Schedule in plain words, e.g. "every weekday at 8:00 AM" or "every 2 hours". */
			scheduleText: string;
			intervalMs: number;
			timezone: string;
	  }
	| {
			type: "event";
			eventType:
				| "email"
				| "slack"
				| "github"
				| "linear"
				| "sentry"
				| "pagerduty"
				| "webhook";
			/** Optional matching filter (e.g. sender domain, tag "+shop", channel "#escalations"). */
			filter: string;
			webhookKey?: string;
	  };

export interface RoutineRunRecord {
	id: string;
	routineId: string;
	startedAt: string;
	finishedAt?: string;
	triggerReason: string;
	status: "running" | "completed" | "failed" | "blocked_by_approval";
	outputSummary?: string;
	error?: string;
}

export interface RoutineDefinition {
	id: string;
	botId: string;
	name: string;
	instructions: string;
	skillName?: string;
	trigger: RoutineTrigger;
	inputSource?: string;
	expectedResult?: string;
	approvalBoundary: string;
	onMissingSource: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	runs: RoutineRunRecord[];
}

export interface DraftCard {
	id: string;
	botId: string;
	channel: "email" | "slack";
	to: string[];
	cc?: string[];
	subject?: string;
	body: string;
	attachments?: string[];
	includeUnsubscribeLink?: boolean;
	origin: TurnOrigin;
	status: "needs_approval" | "sent" | "discarded";
	createdAt: string;
	sentAt?: string;
}

export interface AgentEmailMessage {
	id: string;
	direction: "inbound" | "outbound";
	from: string;
	to: string[];
	tag?: string;
	subject: string;
	body: string;
	attachments: string[];
	/**
	 * Safety boundary: true only if the message came from the account owner.
	 * External emails are treated strictly as information, never as instructions or approval!
	 */
	fromOwner: boolean;
	authenticatedSender: boolean;
	receivedAt: string;
}

export interface CollaborativePage {
	id: string;
	slug: string;
	title: string;
	botId: string;
	content: string;
	format: "markdown" | "html";
	pinned: boolean;
	visibility: "private" | "team" | "org";
	createdAt: string;
	updatedAt: string;
}

export interface ConnectedApp {
	id: string;
	name: string;
	slug: string;
	category: "productivity" | "engineering" | "crm" | "communication" | "payments" | "mcp";
	status: "connected" | "needs_auth" | "disconnected";
	description: string;
	mcpConfig?: {
		command?: string;
		args?: string[];
		url?: string;
	};
	connectedAt?: string;
}

export interface GroupChatMessage {
	id: string;
	groupId: string;
	senderType: "user" | "bot" | "system";
	senderId: string;
	senderName: string;
	content: string;
	mentions: string[];
	assignedOwnerBotId?: string;
	createdAt: string;
}

export interface GroupChat {
	id: string;
	name: string;
	description?: string;
	botIds: string[];
	messages: GroupChatMessage[];
	activeOwnerBotId?: string;
	createdAt: string;
	updatedAt: string;
}

export interface ChatTranscriptMessage {
	id: string;
	botId: string;
	role: "user" | "assistant" | "system";
	content: string;
	origin: TurnOrigin;
	toolCalls?: Array<{
		toolName: string;
		summary: string;
		status: "completed" | "blocked" | "error";
	}>;
	approvalCardIds?: string[];
	draftCardIds?: string[];
	secureFormIds?: string[];
	voiceMemo?: {
		durationSeconds: number;
		transcript: string;
	};
	createdAt: string;
}

export interface VoiceCallSession {
	id: string;
	botId: string;
	status: "active" | "ended";
	muted: boolean;
	voice: string;
	speed: number;
	language: string;
	transcript: Array<{ speaker: "user" | "bot"; text: string; timestamp: string }>;
	startedAt: string;
	endedAt?: string;
}

export interface SharedComputerState {
	status: "awake" | "asleep" | "updating" | "recovering";
	workspaceDir: string;
	softwareVersion: string;
	activeScreens: Record<
		string,
		{
			botId: string;
			botName: string;
			currentActivity: string;
			updatedAt: string;
		}
	>;
	handoverState?: {
		active: boolean;
		botId: string;
		reason: string;
		requestedAt: string;
	};
	agentEmailAddress: string;
	unsubscribedAddresses: string[];
	timezone: string;
	messagingBetweenBotsEnabled: boolean;
}

export interface PiBotsPersistedState {
	version: number;
	computer: SharedComputerState;
	bots: BotProfile[];
	templates: BotTemplate[];
	memories: MemoryItem[];
	sharedFacts: SharedUserFact[];
	autoReview: AutoReviewSettings;
	approvalCards: ApprovalCard[];
	vault: VaultItem[];
	secureForms: SecureFormCard[];
	skills: SkillDefinition[];
	demonstrations: DemonstrationSession[];
	routines: RoutineDefinition[];
	drafts: DraftCard[];
	emails: AgentEmailMessage[];
	pages: CollaborativePage[];
	connectedApps: ConnectedApp[];
	groupChats: GroupChat[];
	transcripts: Record<string, ChatTranscriptMessage[]>;
	voiceCalls: VoiceCallSession[];
}
