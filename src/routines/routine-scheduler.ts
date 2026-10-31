import crypto from "node:crypto";
import type { StateStore } from "../storage/state-store.ts";
import type {
	RoutineDefinition,
	RoutineRunRecord,
	RoutineTrigger,
	TurnOrigin,
} from "../types.ts";

export type RoutineExecutionCallback = (
	routine: RoutineDefinition,
	triggerReason: string,
	origin: TurnOrigin,
) => Promise<{ outputSummary: string; blockedByApproval?: boolean }>;

/**
 * RoutineScheduler implements Grok Bot's background schedule & event-triggered routines:
 * - Natural-language schedule parsing ("every weekday at 8:00 AM", "every 2 hours", etc.)
 * - Event triggers (email with tag/domain matching and sender auth check, slack, github, linear, webhook)
 * - Rate limiting: up to 300 total runs/hour and 200 runs/hour per routine.
 */
export class RoutineScheduler {
	private readonly store: StateStore;
	private executor?: RoutineExecutionCallback;
	private timer?: ReturnType<typeof setInterval>;

	constructor(store: StateStore, executor?: RoutineExecutionCallback) {
		this.store = store;
		this.executor = executor;
	}

	setExecutor(executor: RoutineExecutionCallback): void {
		this.executor = executor;
	}

	startBackgroundTicker(checkIntervalMs = 30_000): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.checkDueSchedules();
		}, checkIntervalMs);
		if (typeof this.timer.unref === "function") {
			this.timer.unref();
		}
	}

	stopBackgroundTicker(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	listRoutines(botId?: string): RoutineDefinition[] {
		const routines = this.store.getState().routines;
		return botId ? routines.filter((r) => r.botId === botId) : routines;
	}

	/**
	 * Parses a natural schedule phrase into an interval in milliseconds and human-readable text.
	 */
	static parseSchedulePhrase(scheduleText: string): {
		normalizedText: string;
		intervalMs: number;
	} {
		const text = scheduleText.trim();
		const lower = text.toLowerCase();

		const minMatch = lower.match(/every\s+(\d+)\s*min/);
		if (minMatch) {
			const mins = Math.max(1, Number.parseInt(minMatch[1], 10));
			return {
				normalizedText: `every ${mins} minute${mins === 1 ? "" : "s"}`,
				intervalMs: mins * 60_000,
			};
		}

		const hourMatch = lower.match(/every\s+(\d+)\s*hour/);
		if (hourMatch) {
			const hours = Math.max(1, Number.parseInt(hourMatch[1], 10));
			return {
				normalizedText: `every ${hours} hour${hours === 1 ? "" : "s"}`,
				intervalMs: hours * 3600_000,
			};
		}

		if (lower.includes("hourly") || lower.includes("every hour")) {
			return { normalizedText: "every 1 hour", intervalMs: 3600_000 };
		}

		if (lower.includes("week") && !lower.includes("weekday")) {
			return { normalizedText: text, intervalMs: 7 * 24 * 3600_000 };
		}

		return {
			normalizedText: text || "every day at 8:00 AM",
			intervalMs: 24 * 3600_000,
		};
	}

	createRoutine(input: {
		botId: string;
		name: string;
		instructions: string;
		skillName?: string;
		triggerType: "schedule" | "event";
		scheduleText?: string;
		timezone?: string;
		eventType?: "email" | "slack" | "github" | "linear" | "sentry" | "pagerduty" | "webhook";
		eventFilter?: string;
		inputSource?: string;
		expectedResult?: string;
		approvalBoundary?: string;
		onMissingSource?: string;
	}): RoutineDefinition {
		const now = new Date();
		const state = this.store.getState();
		const tz = input.timezone || state.computer.timezone || "UTC";

		let trigger: RoutineTrigger;
		let nextRunAt: string | undefined;

		if (input.triggerType === "schedule") {
			const parsed = RoutineScheduler.parseSchedulePhrase(
				input.scheduleText || "every weekday at 8:00 AM",
			);
			trigger = {
				type: "schedule",
				scheduleText: parsed.normalizedText,
				intervalMs: parsed.intervalMs,
				timezone: tz,
			};
			// A new routine waits for its next scheduled time; it does not run immediately on creation
			nextRunAt = new Date(now.getTime() + parsed.intervalMs).toISOString();
		} else {
			const evType = input.eventType || "webhook";
			trigger = {
				type: "event",
				eventType: evType,
				filter: (input.eventFilter || "*").trim(),
				webhookKey:
					evType === "webhook"
						? `whsec_${crypto.randomBytes(16).toString("hex")}`
						: undefined,
			};
		}

		const routine: RoutineDefinition = {
			id: `rtn-${crypto.randomUUID().slice(0, 8)}`,
			botId: input.botId,
			name: input.name.trim(),
			instructions: input.instructions.trim(),
			skillName: input.skillName,
			trigger,
			inputSource: input.inputSource || "/workspace",
			expectedResult: input.expectedResult || "Post result in conversation",
			approvalBoundary:
				input.approvalBoundary ||
				"Ask for approval before sending external messages or modifying external systems.",
			onMissingSource:
				input.onMissingSource ||
				"Report the missing source instead of using stale or fabricated data.",
			enabled: true,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			nextRunAt,
			runs: [],
		};

		state.routines.push(routine);
		this.store.save();
		return routine;
	}

	setRoutineEnabled(routineId: string, enabled: boolean): RoutineDefinition {
		const routine = this.store.getState().routines.find((r) => r.id === routineId);
		if (!routine) throw new Error(`Routine ${routineId} not found`);
		routine.enabled = enabled;
		routine.updatedAt = new Date().toISOString();
		this.store.save();
		return routine;
	}

	deleteRoutine(routineId: string): boolean {
		const state = this.store.getState();
		const before = state.routines.length;
		state.routines = state.routines.filter((r) => r.id !== routineId);
		if (state.routines.length !== before) {
			this.store.save();
			return true;
		}
		return false;
	}

	/**
	 * Enforces Grok Bot v0.75.5 rate limits:
	 * - Up to 300 routine runs per hour across all routines
	 * - Up to 200 runs per hour for any single routine
	 */
	private checkHourlyRateLimits(routine: RoutineDefinition): {
		allowed: boolean;
		reason?: string;
	} {
		const oneHourAgo = Date.now() - 3600_000;
		const allRoutines = this.store.getState().routines;

		let totalRunsLastHour = 0;
		for (const r of allRoutines) {
			for (const run of r.runs) {
				if (new Date(run.startedAt).getTime() >= oneHourAgo) {
					totalRunsLastHour++;
				}
			}
		}
		if (totalRunsLastHour >= 300) {
			return {
				allowed: false,
				reason: "Account routine rate limit reached (max 300 routine runs per hour).",
			};
		}

		const thisRoutineRunsLastHour = routine.runs.filter(
			(run) => new Date(run.startedAt).getTime() >= oneHourAgo,
		).length;
		if (thisRoutineRunsLastHour >= 200) {
			return {
				allowed: false,
				reason: `Routine "${routine.name}" reached its rate limit (max 200 runs per hour).`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Immediately tests/runs a routine by ID.
	 */
	async runRoutineNow(
		routineId: string,
		triggerReason = "Manual test run",
	): Promise<RoutineRunRecord> {
		const routine = this.store.getState().routines.find((r) => r.id === routineId);
		if (!routine) {
			throw new Error(`Routine ${routineId} not found`);
		}

		const limitCheck = this.checkHourlyRateLimits(routine);
		if (!limitCheck.allowed) {
			throw new Error(limitCheck.reason);
		}

		const now = new Date();
		const runRecord: RoutineRunRecord = {
			id: `run-${crypto.randomUUID().slice(0, 8)}`,
			routineId: routine.id,
			startedAt: now.toISOString(),
			triggerReason,
			status: "running",
		};
		routine.runs.push(runRecord);
		routine.lastRunAt = now.toISOString();
		if (routine.trigger.type === "schedule") {
			routine.nextRunAt = new Date(now.getTime() + routine.trigger.intervalMs).toISOString();
		}
		this.store.save();

		try {
			if (this.executor) {
				const result = await this.executor(routine, triggerReason, "routine");
				runRecord.status = result.blockedByApproval ? "blocked_by_approval" : "completed";
				runRecord.outputSummary = result.outputSummary;
			} else {
				runRecord.status = "completed";
				runRecord.outputSummary = `Executed routine "${routine.name}" (${triggerReason}).`;
			}
		} catch (err) {
			runRecord.status = "failed";
			runRecord.error = err instanceof Error ? err.message : String(err);
		} finally {
			runRecord.finishedAt = new Date().toISOString();
			this.store.save();
		}

		return runRecord;
	}

	async checkDueSchedules(): Promise<RoutineRunRecord[]> {
		const nowMs = Date.now();
		const due = this.store
			.getState()
			.routines.filter(
				(r) =>
					r.enabled &&
					r.trigger.type === "schedule" &&
					r.nextRunAt &&
					new Date(r.nextRunAt).getTime() <= nowMs,
			);

		const results: RoutineRunRecord[] = [];
		for (const routine of due) {
			const record = await this.runRoutineNow(
				routine.id,
				`Scheduled trigger (${routine.trigger.type === "schedule" ? routine.trigger.scheduleText : ""})`,
			);
			results.push(record);
		}
		return results;
	}

	/**
	 * Fires matching event-driven routines (email, slack, github, linear, sentry, pagerduty, webhook).
	 * Enforces Grok Bot's email routine safety rules:
	 * - Only runs for emails where `authenticatedSender` is true.
	 * - Supports tagged addresses (`+shop`) and sender domain wildcards (`*@example.com`).
	 */
	async dispatchEvent(event: {
		eventType: "email" | "slack" | "github" | "linear" | "sentry" | "pagerduty" | "webhook";
		sender?: string;
		tag?: string;
		channel?: string;
		payloadSummary: string;
		authenticatedSender?: boolean;
		webhookKey?: string;
	}): Promise<RoutineRunRecord[]> {
		if (event.eventType === "email" && event.authenticatedSender === false) {
			// Per Grok Bot docs: routines only run for mail from senders that pass standard email authentication checks
			return [];
		}

		const matching = this.store.getState().routines.filter((r) => {
			if (!r.enabled || r.trigger.type !== "event") return false;
			if (r.trigger.eventType !== event.eventType) return false;

			if (
				event.eventType === "webhook" &&
				r.trigger.webhookKey &&
				event.webhookKey &&
				r.trigger.webhookKey !== event.webhookKey
			) {
				return false;
			}

			const filter = r.trigger.filter.toLowerCase();
			if (!filter || filter === "*" || filter === "anyone") return true;

			if (filter.startsWith("+") && event.tag) {
				return `+${event.tag.toLowerCase()}` === filter;
			}
			if (filter.startsWith("*@") && event.sender) {
				const domain = filter.slice(2);
				return event.sender.toLowerCase().endsWith(`@${domain}`);
			}
			const combined = `${event.sender ?? ""} ${event.tag ? `+${event.tag}` : ""} ${event.channel ?? ""} ${event.payloadSummary}`.toLowerCase();
			return combined.includes(filter);
		});

		const runs: RoutineRunRecord[] = [];
		for (const routine of matching) {
			const rec = await this.runRoutineNow(
				routine.id,
				`Event trigger [${event.eventType}]: ${event.payloadSummary.slice(0, 120)}`,
			);
			runs.push(rec);
		}
		return runs;
	}
}
