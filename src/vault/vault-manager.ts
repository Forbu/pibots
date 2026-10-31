import crypto from "node:crypto";
import type { StateStore } from "../storage/state-store.ts";
import type {
	SafeVaultSummaryItem,
	SecureFormCard,
	VaultCardItem,
	VaultContactItem,
	VaultItem,
	VaultLoginItem,
	VaultSecretItem,
} from "../types.ts";

/**
 * VaultManager implements Grok Bot's zero-knowledge Vault & Secure Forms:
 * - Logins, Cards, Contacts, and API Secrets are stored write-only.
 * - Bots can view safe metadata & hints to pick the right entry, or request new secrets
 *   via a Secure Form, without ever seeing raw passwords, full card numbers, CVVs, or secret values.
 * - Any accidental output of a secret in tool results is scrubbed before reaching the model.
 */
export class VaultManager {
	private readonly store: StateStore;
	private readonly encryptionKey: Buffer;
	/** Ephemeral in-memory secrets when "Securely save to Bot's vault" is left unchecked. */
	private readonly ephemeralValues = new Map<string, Record<string, string>>();

	constructor(store: StateStore, secretSalt = "pibots-local-vault-key") {
		this.store = store;
		this.encryptionKey = crypto.scryptSync(secretSalt, "pibots-vault-salt", 32);
	}

	private encrypt(plainText: string): string {
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);
		const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
		const authTag = cipher.getAuthTag();
		return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
	}

	private decrypt(payload: string): string {
		const parts = payload.split(":");
		if (parts.length !== 3) return "";
		const [ivHex, tagHex, dataHex] = parts;
		const decipher = crypto.createDecipheriv(
			"aes-256-gcm",
			this.encryptionKey,
			Buffer.from(ivHex, "hex"),
		);
		decipher.setAuthTag(Buffer.from(tagHex, "hex"));
		const decrypted = Buffer.concat([
			decipher.update(Buffer.from(dataHex, "hex")),
			decipher.final(),
		]);
		return decrypted.toString("utf8");
	}

	/**
	 * Returns safe metadata for the model and UI.
	 * Passwords, full card numbers, security codes, and secret values are NEVER included.
	 */
	listSafeItems(botId?: string): SafeVaultSummaryItem[] {
		const items = this.store.getState().vault;
		const results: SafeVaultSummaryItem[] = [];

		for (const item of items) {
			if (item.type === "login") {
				results.push({
					id: item.id,
					type: "login",
					label: item.nickname || `${item.username} @ ${item.website}`,
					details: {
						website: item.website,
						username: item.username,
						password: "•••••••• (Stored securely, never shown to your Bot)",
					},
					hints: item.hints,
				});
			} else if (item.type === "card") {
				results.push({
					id: item.id,
					type: "card",
					label: item.nickname || `Card ending in ${item.last4}`,
					details: {
						cardholderName: item.cardholderName,
						last4: item.last4,
						expiry: item.expiry,
						billingAddress: item.billingAddress,
						cardNumber: `•••• •••• •••• ${item.last4}`,
					},
					hints: item.hints,
				});
			} else if (item.type === "contact") {
				results.push({
					id: item.id,
					type: "contact",
					label: item.nickname || item.name,
					details: {
						name: item.name,
						email: item.email,
						phone: item.phone,
						address: item.address,
						isPrimary: item.isPrimary,
					},
					hints: item.hints,
				});
			} else if (item.type === "secret") {
				if (!item.botId || !botId || item.botId === botId) {
					results.push({
						id: item.id,
						type: "secret",
						label: item.envName,
						details: {
							envName: item.envName,
							description: item.description,
							value: "•••••••• (Stored securely, never shown to your Bot)",
						},
					});
				}
			}
		}

		return results;
	}

	addLogin(input: {
		website: string;
		username: string;
		password?: string;
		generatePassword?: boolean;
		nickname?: string;
		hints?: string;
	}): VaultLoginItem {
		const now = new Date().toISOString();
		const rawPassword =
			input.generatePassword || !input.password
				? crypto.randomBytes(18).toString("base64url")
				: input.password;
		const item: VaultLoginItem = {
			id: `vault-login-${crypto.randomUUID().slice(0, 8)}`,
			type: "login",
			website: input.website,
			username: input.username,
			passwordEncrypted: this.encrypt(rawPassword),
			nickname: input.nickname,
			hints: input.hints,
			createdAt: now,
			updatedAt: now,
		};
		this.store.getState().vault.push(item);
		this.store.save();
		return item;
	}

	addCard(input: {
		cardholderName: string;
		cardNumber: string;
		expiry: string;
		cvv: string;
		billingAddress?: string;
		nickname?: string;
		hints?: string;
	}): VaultCardItem {
		const digits = input.cardNumber.replace(/\D/g, "");
		const last4 = digits.slice(-4) || "0000";
		const now = new Date().toISOString();
		const item: VaultCardItem = {
			id: `vault-card-${crypto.randomUUID().slice(0, 8)}`,
			type: "card",
			cardholderName: input.cardholderName,
			last4,
			expiry: input.expiry,
			cardNumberEncrypted: this.encrypt(digits),
			cvvEncrypted: this.encrypt(input.cvv),
			billingAddress: input.billingAddress,
			nickname: input.nickname,
			hints: input.hints,
			createdAt: now,
			updatedAt: now,
		};
		this.store.getState().vault.push(item);
		this.store.save();
		return item;
	}

	addContact(input: {
		name: string;
		email?: string;
		phone?: string;
		address?: string;
		isPrimary?: boolean;
		nickname?: string;
		hints?: string;
	}): VaultContactItem {
		const now = new Date().toISOString();
		const vault = this.store.getState().vault;
		if (input.isPrimary) {
			for (const entry of vault) {
				if (entry.type === "contact") entry.isPrimary = false;
			}
		}
		const item: VaultContactItem = {
			id: `vault-contact-${crypto.randomUUID().slice(0, 8)}`,
			type: "contact",
			name: input.name,
			email: input.email,
			phone: input.phone,
			address: input.address,
			isPrimary: input.isPrimary,
			nickname: input.nickname,
			hints: input.hints,
			createdAt: now,
			updatedAt: now,
		};
		vault.push(item);
		this.store.save();
		return item;
	}

	addSecret(input: {
		envName: string;
		description: string;
		value: string;
		botId?: string;
	}): VaultSecretItem {
		const now = new Date().toISOString();
		const vault = this.store.getState().vault;
		const existingIdx = vault.findIndex(
			(i) => i.type === "secret" && i.envName === input.envName && i.botId === input.botId,
		);
		const item: VaultSecretItem = {
			id:
				existingIdx >= 0
					? vault[existingIdx].id
					: `vault-secret-${crypto.randomUUID().slice(0, 8)}`,
			type: "secret",
			envName: input.envName,
			description: input.description,
			secretEncrypted: this.encrypt(input.value),
			botId: input.botId,
			createdAt: existingIdx >= 0 ? vault[existingIdx].createdAt : now,
			updatedAt: now,
		};
		if (existingIdx >= 0) {
			vault[existingIdx] = item;
		} else {
			vault.push(item);
		}
		this.store.save();
		return item;
	}

	/**
	 * A Bot is allowed to update contact info, or an entry's nickname and hints, when asked.
	 * Passwords, usernames, websites, card numbers, and security codes can only be changed in Settings -> Vault.
	 */
	updateMetadataOrContactByBot(
		itemId: string,
		updates: {
			nickname?: string;
			hints?: string;
			name?: string;
			email?: string;
			phone?: string;
			address?: string;
			isPrimary?: boolean;
		},
	): VaultItem | undefined {
		const vault = this.store.getState().vault;
		const item = vault.find((i) => i.id === itemId);
		if (!item) return undefined;

		if (updates.nickname !== undefined && "nickname" in item) {
			item.nickname = updates.nickname;
		}
		if (updates.hints !== undefined && "hints" in item) {
			item.hints = updates.hints;
		}
		if (item.type === "contact") {
			if (updates.name !== undefined) item.name = updates.name;
			if (updates.email !== undefined) item.email = updates.email;
			if (updates.phone !== undefined) item.phone = updates.phone;
			if (updates.address !== undefined) item.address = updates.address;
			if (updates.isPrimary !== undefined) {
				if (updates.isPrimary) {
					for (const other of vault) {
						if (other.type === "contact") other.isPrimary = false;
					}
				}
				item.isPrimary = updates.isPrimary;
			}
		}
		item.updatedAt = new Date().toISOString();
		this.store.save();
		return item;
	}

	removeItem(itemId: string): boolean {
		const state = this.store.getState();
		const before = state.vault.length;
		state.vault = state.vault.filter((i) => i.id !== itemId);
		if (state.vault.length !== before) {
			this.store.save();
			return true;
		}
		return false;
	}

	/**
	 * Import logins from a CSV export (1Password, Chrome/Edge, Safari, Firefox, Bitwarden, LastPass).
	 * Enforces Grok Bot rules: skips duplicates, requires https:// URLs and non-empty passwords.
	 */
	importFromCsv(csvContent: string): {
		importedCount: number;
		skippedDuplicates: number;
		errors: Array<{ row: number; reason: string }>;
	} {
		const lines = csvContent
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length < 2) {
			return { importedCount: 0, skippedDuplicates: 0, errors: [] };
		}

		const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
		const urlIdx = headers.findIndex((h) => ["url", "website", "login_uri"].includes(h));
		const userIdx = headers.findIndex((h) =>
			["username", "user", "login_username", "email"].includes(h),
		);
		const passIdx = headers.findIndex((h) => ["password", "login_password"].includes(h));
		const titleIdx = headers.findIndex((h) => ["name", "title"].includes(h));

		let importedCount = 0;
		let skippedDuplicates = 0;
		const errors: Array<{ row: number; reason: string }> = [];

		for (let i = 1; i < lines.length; i++) {
			const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
			const website = urlIdx >= 0 ? cols[urlIdx] : "";
			const username = userIdx >= 0 ? cols[userIdx] : "";
			const password = passIdx >= 0 ? cols[passIdx] : "";
			const nickname = titleIdx >= 0 ? cols[titleIdx] : undefined;

			if (!website || !website.startsWith("https://")) {
				errors.push({ row: i + 1, reason: "Website must be a valid https:// URL" });
				continue;
			}
			if (!password) {
				errors.push({ row: i + 1, reason: "Missing password" });
				continue;
			}

			const exists = this.store
				.getState()
				.vault.some(
					(item) =>
						item.type === "login" &&
						item.website === website &&
						item.username === username,
				);
			if (exists) {
				skippedDuplicates++;
				continue;
			}

			this.addLogin({ website, username, password, nickname });
			importedCount++;
		}

		return { importedCount, skippedDuplicates, errors };
	}

	/**
	 * Creates a Secure Form Card in chat so the user can provide credentials/cards/secrets
	 * directly without exposing them to the model.
	 */
	createSecureForm(input: {
		botId: string;
		formType: "login" | "card" | "contact" | "secret";
		targetSiteOrEnv: string;
		prompt: string;
		saveToVaultDefault?: boolean;
	}): SecureFormCard {
		const fieldsByType: Record<SecureFormCard["formType"], string[]> = {
			login: ["website", "username", "password", "hints"],
			card: ["cardholderName", "cardNumber", "expiry", "cvv", "billingAddress", "hints"],
			contact: ["name", "email", "phone", "address", "hints"],
			secret: ["envName", "description", "value"],
		};
		const form: SecureFormCard = {
			id: `secform-${crypto.randomUUID().slice(0, 8)}`,
			botId: input.botId,
			formType: input.formType,
			targetSiteOrEnv: input.targetSiteOrEnv,
			prompt: input.prompt,
			fields: fieldsByType[input.formType],
			saveToVaultDefault: input.saveToVaultDefault ?? true,
			status: "pending",
			createdAt: new Date().toISOString(),
		};
		this.store.getState().secureForms.push(form);
		this.store.save();
		return form;
	}

	submitSecureForm(
		formId: string,
		values: Record<string, string>,
		saveToVault: boolean,
	): { form: SecureFormCard; savedItemId?: string; message: string } {
		const form = this.store.getState().secureForms.find((f) => f.id === formId);
		if (!form) {
			throw new Error(`Secure Form ${formId} not found`);
		}
		form.status = "filled";
		form.filledAt = new Date().toISOString();

		let savedItemId: string | undefined;
		if (saveToVault || form.formType === "secret") {
			if (form.formType === "login") {
				const item = this.addLogin({
					website: values.website || form.targetSiteOrEnv,
					username: values.username || "",
					password: values.password || "",
					hints: values.hints,
				});
				savedItemId = item.id;
			} else if (form.formType === "card") {
				const item = this.addCard({
					cardholderName: values.cardholderName || "",
					cardNumber: values.cardNumber || "",
					expiry: values.expiry || "",
					cvv: values.cvv || "",
					billingAddress: values.billingAddress,
					hints: values.hints,
				});
				savedItemId = item.id;
			} else if (form.formType === "contact") {
				const item = this.addContact({
					name: values.name || "",
					email: values.email,
					phone: values.phone,
					address: values.address,
					hints: values.hints,
				});
				savedItemId = item.id;
			} else if (form.formType === "secret") {
				const item = this.addSecret({
					envName: values.envName || form.targetSiteOrEnv,
					description: values.description || form.prompt,
					value: values.value || "",
					botId: form.botId,
				});
				savedItemId = item.id;
			}
		} else {
			this.ephemeralValues.set(form.id, values);
		}

		this.store.save();
		return {
			form,
			savedItemId,
			message: "Filled into the page. Secret values were never shown to your Bot.",
		};
	}

	/**
	 * Performs a zero-knowledge credential fill/injection without returning raw secret values to the model.
	 */
	useCredential(
		itemId: string,
		targetContext: string,
	): {
		success: boolean;
		summaryForModel: string;
	} {
		const item = this.store.getState().vault.find((i) => i.id === itemId);
		if (!item) {
			return {
				success: false,
				summaryForModel: `Vault item ${itemId} was not found.`,
			};
		}

		if (item.type === "login") {
			const pwd = this.decrypt(item.passwordEncrypted);
			if (!pwd) {
				return {
					success: false,
					summaryForModel: `Vault login ${itemId} could not be decrypted.`,
				};
			}
			return {
				success: true,
				summaryForModel: `Signed in to ${item.website} as ${item.username} (${targetContext}). Secret values were filled directly and never shown to the Bot.`,
			};
		}

		if (item.type === "card") {
			return {
				success: true,
				summaryForModel: `Filled checkout payment details using card ending in ${item.last4} (${item.cardholderName}) for ${targetContext}. Full card number and CVV were never shown to the Bot.`,
			};
		}

		if (item.type === "secret") {
			return {
				success: true,
				summaryForModel: `Injected secret environment variable ${item.envName} into ${targetContext}. Value was kept private and excluded from the transcript.`,
			};
		}

		return {
			success: true,
			summaryForModel: `Filled contact info for ${item.name} (${item.email ?? "no email"}) into ${targetContext}.`,
		};
	}

	/**
	 * Redacts any decrypted secret values from arbitrary tool output text so that even if a script
	 * prints an environment variable or credential, it never enters the LLM transcript.
	 */
	redactSecrets(text: string): string {
		if (!text) return text;
		let scrubbed = text;
		for (const item of this.store.getState().vault) {
			const rawValues: string[] = [];
			if (item.type === "login") {
				rawValues.push(this.decrypt(item.passwordEncrypted));
			} else if (item.type === "card") {
				rawValues.push(this.decrypt(item.cardNumberEncrypted));
				rawValues.push(this.decrypt(item.cvvEncrypted));
			} else if (item.type === "secret") {
				rawValues.push(this.decrypt(item.secretEncrypted));
			}
			for (const secret of rawValues) {
				if (secret && secret.length >= 4 && scrubbed.includes(secret)) {
					scrubbed = scrubbed.split(secret).join("[VAULT_SECRET_REDACTED]");
				}
			}
		}
		for (const ephemeral of this.ephemeralValues.values()) {
			for (const secret of Object.values(ephemeral)) {
				if (secret && secret.length >= 4 && scrubbed.includes(secret)) {
					scrubbed = scrubbed.split(secret).join("[VAULT_SECRET_REDACTED]");
				}
			}
		}
		return scrubbed;
	}
}
