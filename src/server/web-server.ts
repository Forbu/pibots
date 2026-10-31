import http from "node:http";
import type { PiBotsHub } from "../core/pibots-hub.ts";
import { renderPiBotsWebAppHtml } from "./ui-html.ts";

export interface PiBotsServerOptions {
	hub: PiBotsHub;
	port?: number;
	host?: string;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	return raw ? JSON.parse(raw) : {};
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	res.end(JSON.stringify(payload, null, 2));
}

export async function startPiBotsServer(options: PiBotsServerOptions): Promise<{
	server: http.Server;
	url: string;
	close: () => Promise<void>;
}> {
	const { hub } = options;
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 4310;

	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", `http://${host}:${port}`);
			const pathname = url.pathname;
			const method = req.method ?? "GET";

			if (method === "GET" && pathname === "/") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(renderPiBotsWebAppHtml());
				return;
			}

			// Full workspace snapshot (with Vault secrets safely masked)
			if (method === "GET" && pathname === "/api/state") {
				const rawState = hub.store.getState();
				sendJson(res, 200, {
					...rawState,
					vault: undefined,
					vaultSafe: hub.vault.listSafeItems(),
					workspaceFiles: hub.listWorkspaceFiles(),
				});
				return;
			}

			// Bots roster
			if (method === "GET" && pathname === "/api/bots") {
				sendJson(res, 200, hub.listBots({ includeHidden: true }));
				return;
			}

			if (method === "POST" && pathname === "/api/bots") {
				const body = await readJsonBody(req);
				const bot = hub.createBot({
					name: String(body.name ?? "New Bot"),
					label: String(body.label ?? "Specialist"),
					job: String(body.job ?? "Complete assigned tasks in /workspace."),
					section: body.section,
					pinned: body.pinned,
					isPrimary: body.isPrimary,
				});
				sendJson(res, 201, bot);
				return;
			}

			// Chat with a specific Bot
			const chatMatch = pathname.match(/^\/api\/bots\/([^/]+)\/chat$/);
			if (method === "POST" && chatMatch) {
				const botId = decodeURIComponent(chatMatch[1]);
				const body = await readJsonBody(req);
				const result = await hub.chatWithBot(botId, String(body.message ?? ""));
				sendJson(res, 200, result);
				return;
			}

			// Reset a Bot's conversation (keeping memory, files, routines)
			const resetMatch = pathname.match(/^\/api\/bots\/([^/]+)\/reset$/);
			if (method === "POST" && resetMatch) {
				const botId = decodeURIComponent(resetMatch[1]);
				const session = hub.getOrCreateBotSession(botId);
				await session.resetConversation();
				sendJson(res, 200, { ok: true });
				return;
			}

			// Duplicate a Bot
			const dupMatch = pathname.match(/^\/api\/bots\/([^/]+)\/duplicate$/);
			if (method === "POST" && dupMatch) {
				const botId = decodeURIComponent(dupMatch[1]);
				const body = await readJsonBody(req);
				const copy = hub.duplicateBot(botId, body.newName);
				sendJson(res, 201, copy);
				return;
			}

			// Start Voice Call with a Bot
			const voiceStartMatch = pathname.match(/^\/api\/bots\/([^/]+)\/voice-call$/);
			if (method === "POST" && voiceStartMatch) {
				const botId = decodeURIComponent(voiceStartMatch[1]);
				const body = await readJsonBody(req);
				const call = hub.startVoiceCall(botId, body);
				sendJson(res, 201, call);
				return;
			}

			const voiceEndMatch = pathname.match(/^\/api\/voice-calls\/([^/]+)\/end$/);
			if (method === "POST" && voiceEndMatch) {
				const callId = decodeURIComponent(voiceEndMatch[1]);
				const call = hub.endVoiceCall(callId);
				sendJson(res, 200, call);
				return;
			}

			// Group Chats
			if (method === "POST" && pathname === "/api/groups") {
				const body = await readJsonBody(req);
				const group = hub.createGroupChat({
					name: String(body.name ?? "Team Group"),
					description: body.description,
					botIdsOrNames: Array.isArray(body.botIdsOrNames) ? body.botIdsOrNames : [],
				});
				sendJson(res, 201, group);
				return;
			}

			const groupMsgMatch = pathname.match(/^\/api\/groups\/([^/]+)\/messages$/);
			if (method === "POST" && groupMsgMatch) {
				const groupId = decodeURIComponent(groupMsgMatch[1]);
				const body = await readJsonBody(req);
				const result = await hub.postUserMessageInGroup(
					groupId,
					String(body.content ?? ""),
					body.userName || "You",
				);
				sendJson(res, 200, result);
				return;
			}

			// Approval Cards
			const aprResolveMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/resolve$/);
			if (method === "POST" && aprResolveMatch) {
				const cardId = decodeURIComponent(aprResolveMatch[1]);
				const body = await readJsonBody(req);
				const resolved = hub.autoReview.resolveApprovalCard(
					cardId,
					body.decision,
					body.actingUser,
				);
				sendJson(res, 200, resolved);
				return;
			}

			// Draft Cards
			const draftSendMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/send$/);
			if (method === "POST" && draftSendMatch) {
				const draftId = decodeURIComponent(draftSendMatch[1]);
				const draft = hub.approveAndSendDraft(draftId);
				sendJson(res, 200, draft);
				return;
			}

			const draftDiscardMatch = pathname.match(/^\/api\/drafts\/([^/]+)\/discard$/);
			if (method === "POST" && draftDiscardMatch) {
				const draftId = decodeURIComponent(draftDiscardMatch[1]);
				const draft = hub.discardDraft(draftId);
				sendJson(res, 200, draft);
				return;
			}

			// Routines
			const routineRunMatch = pathname.match(/^\/api\/routines\/([^/]+)\/run$/);
			if (method === "POST" && routineRunMatch) {
				const routineId = decodeURIComponent(routineRunMatch[1]);
				const run = await hub.routines.runRoutineNow(routineId, "Manual trigger via UI/API");
				sendJson(res, 200, run);
				return;
			}

			// Templates import
			if (method === "POST" && pathname === "/api/templates/import") {
				const body = await readJsonBody(req);
				const bot = hub.importBotFromTemplate(String(body.templateId), body.customName);
				sendJson(res, 201, bot);
				return;
			}

			// Teach by demonstration quick endpoint
			if (method === "POST" && pathname === "/api/demonstrations/quick-teach") {
				const body = await readJsonBody(req);
				const demo = hub.skills.startDemonstration(
					String(body.botId),
					String(body.goalDescription),
				);
				const steps: string[] = Array.isArray(body.steps) ? body.steps : [];
				for (const s of steps) {
					hub.skills.recordDemonstrationStep(demo.id, {
						kind: "command",
						summary: String(s),
					});
				}
				const finished = hub.skills.finishDemonstration(demo.id, {
					skillName: body.skillName,
				});
				sendJson(res, 201, finished);
				return;
			}

			// Tag @bot on X endpoint
			if (method === "POST" && pathname === "/api/x/tag-bot") {
				const body = await readJsonBody(req);
				const resX = await hub.handleXTagMention({
					authorHandle: String(body.authorHandle ?? "user"),
					postText: String(body.postText ?? ""),
					postUrl: body.postUrl,
				});
				sendJson(res, 200, resX);
				return;
			}

			sendJson(res, 404, {
				error: `Route ${method} ${pathname} not found. Return to / for the workspace.`,
			});
		} catch (err) {
			sendJson(res, 400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => resolve());
	});

	const addr = server.address();
	const actualPort = typeof addr === "object" && addr ? addr.port : port;
	const url = `http://${host}:${actualPort}`;

	return {
		server,
		url,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			}),
	};
}
