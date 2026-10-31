#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline/promises";
import chalk from "chalk";
import { PiBotsHub } from "./core/pibots-hub.ts";
import { startPiBotsServer } from "./server/web-server.ts";

async function main() {
	const args = process.argv.slice(2);
	const cmd = args[0] || "status";
	const dataDir = process.env.PIBOTS_DATA_DIR || path.join(process.cwd(), ".pibots-data");

	const hub = new PiBotsHub({
		dataDir,
		onApprovalCardCreated: async (card) => {
			if (!process.stdin.isTTY) return "defer";
			console.log(
				chalk.yellow(
					`\n[Auto Review Approval Card: ${card.id}] ${card.appName ?? card.toolName}: ${card.actionSummary}`,
				),
			);
			for (const w of card.warnings) {
				console.log(chalk.red(`  Warning: ${w}`));
			}
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				const ans = (
					await rl.question(
						chalk.cyan("Approve action? [o = allow once, a = always allow, d = deny]: "),
					)
				)
					.trim()
					.toLowerCase();
				if (ans === "a" && card.canAlwaysAllow) return "always_allow";
				if (ans === "o" || ans === "y" || ans === "yes") return "allow_once";
				return "deny";
			} finally {
				rl.close();
			}
		},
	});

	try {
		if (cmd === "status") {
			const state = hub.store.getState();
			const primary = hub.getPrimaryBot();
			console.log(chalk.bold.green("PiBots — Open-Source Grok Bot Workspace (Pi Agent SDK)"));
			console.log(
				`Shared Computer : ${chalk.cyan(state.computer.workspaceDir)} (${state.computer.status})`,
			);
			console.log(`Agent Email     : ${chalk.cyan(state.computer.agentEmailAddress)}`);
			console.log(
				`Primary Bot     : ${chalk.bold(primary.name)} (${primary.label}) [${primary.id}]`,
			);
			console.log(
				`Auto Review     : ${state.autoReview.enabled ? chalk.green("Enabled") : chalk.yellow("Disabled")} (${state.autoReview.customRules.length} custom rules)`,
			);
			console.log(`\n${chalk.bold("Bot Roster:")}`);
			for (const b of hub.listBots()) {
				console.log(
					`  • ${chalk.bold(b.name)} (${b.label}) [${b.id}]${b.isPrimary ? chalk.green(" ★ Primary") : ""}${b.pinned ? " 📌" : ""} — ${b.section ?? "General"}`,
				);
			}
			console.log(`\n${chalk.bold("Shared Skills:")} ${hub.skills.listSkills().map((s) => s.slug).join(", ")}`);
			console.log(
				`${chalk.bold("Active Routines:")} ${hub.routines.listRoutines().length} | ${chalk.bold("Pages:")} ${hub.listPages().length} | ${chalk.bold("Vault Items:")} ${hub.vault.listSafeItems().length}`,
			);
			return;
		}

		if (cmd === "list" || cmd === "bots") {
			for (const b of hub.listBots({ includeHidden: true })) {
				console.log(
					`${b.id}\t${b.name}\t${b.label}\t${b.isPrimary ? "PRIMARY" : ""}\t${b.hidden ? "HIDDEN" : "VISIBLE"}`,
				);
			}
			return;
		}

		if (cmd === "create") {
			const [, name, label, ...jobParts] = args;
			if (!name || !label) {
				console.error("Usage: pibots create <name> <label> <job description>");
				process.exitCode = 1;
				return;
			}
			const bot = hub.createBot({
				name,
				label,
				job: jobParts.join(" ") || `Own ${label} tasks on /workspace and ask before external actions.`,
			});
			console.log(chalk.green(`Created Bot ${bot.name} (${bot.label}) [${bot.id}]`));
			return;
		}

		if (cmd === "chat") {
			const botNameOrId = args[1] || hub.getPrimaryBot().id;
			const bot = hub.getBot(botNameOrId);
			if (!bot) {
				console.error(`Bot "${botNameOrId}" not found.`);
				process.exitCode = 1;
				return;
			}
			const inlineMsg = args.slice(2).join(" ").trim();
			if (inlineMsg) {
				process.stdout.write(chalk.bold.green(`${bot.name} (${bot.label}): `));
				const res = await hub.chatWithBot(bot.id, inlineMsg, {
					onTextDelta: (d) => process.stdout.write(d),
				});
				if (!res.reply) {
					process.stdout.write("(completed)");
				}
				console.log();
				return;
			}

			console.log(
				chalk.bold.green(`Chatting with ${bot.name} (${bot.label}). Type 'exit' to quit.`),
			);
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			try {
				while (true) {
					const line = (await rl.question(chalk.cyan("\nYou > "))).trim();
					if (!line || line === "exit" || line === "quit") break;
					process.stdout.write(chalk.bold.green(`\n${bot.name} > `));
					await hub.chatWithBot(bot.id, line, {
						onTextDelta: (d) => process.stdout.write(d),
					});
					console.log();
				}
			} finally {
				rl.close();
			}
			return;
		}

		if (cmd === "group") {
			const groupIdOrName = args[1];
			const msg = args.slice(2).join(" ").trim();
			const group =
				hub
					.listGroupChats()
					.find(
						(g) =>
							g.id === groupIdOrName ||
							g.name.toLowerCase().includes((groupIdOrName || "").toLowerCase()),
					) ?? hub.listGroupChats()[0];
			if (!group || !msg) {
				console.error("Usage: pibots group <groupIdOrName> <message>");
				process.exitCode = 1;
				return;
			}
			const res = await hub.postUserMessageInGroup(group.id, msg);
			for (const reply of res.botReplies) {
				console.log(chalk.bold.green(`\n[${reply.senderName}]:\n`) + reply.content);
			}
			return;
		}

		if (cmd === "routines") {
			for (const r of hub.routines.listRoutines()) {
				const trig =
					r.trigger.type === "schedule"
						? `${r.trigger.scheduleText} (${r.trigger.timezone})`
						: `event:${r.trigger.eventType} (${r.trigger.filter})`;
				console.log(`${r.id}\t[${r.enabled ? "ON" : "OFF"}]\t${r.name}\t-> ${trig}`);
			}
			return;
		}

		if (cmd === "vault") {
			for (const item of hub.vault.listSafeItems()) {
				console.log(`${item.id}\t[${item.type}]\t${item.label}\t${item.hints ?? ""}`);
			}
			return;
		}

		if (cmd === "serve") {
			const portIdx = args.indexOf("--port");
			const port = portIdx >= 0 && args[portIdx + 1] ? Number(args[portIdx + 1]) : 4310;
			hub.routines.startBackgroundTicker();
			const { url } = await startPiBotsServer({ hub, port });
			console.log(chalk.bold.green(`PiBots Workspace Server running at ${url}`));
			await new Promise(() => {});
			return;
		}

		console.log(`Commands:
  pibots status                          Show workspace, computer, and Bot roster status
  pibots list                            List all Bots on the roster
  pibots create <name> <label> <job>     Create a new Bot
  pibots chat [bot] [message]            Message a Bot (interactive or one-shot)
  pibots group <group> <message>         Post a message to a Multi-Bot Group Chat
  pibots routines                        List scheduled and event-driven routines
  pibots vault                           List safe Vault items
  pibots serve [--port 4310]             Launch the PiBots Web UI & REST API server`);
	} finally {
		if (cmd !== "serve") {
			hub.dispose();
		}
	}
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
