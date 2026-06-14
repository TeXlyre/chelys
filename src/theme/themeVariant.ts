// src/theme/themeVariant.ts
const STORAGE_KEY_GLOBAL = "texlyre-settings";
const VARIANT_SETTING_ID = "theme-variant";

const DARK_VARIANTS = new Set(["dark", "monokai", "tomorrow_night_blue"]);

export type ThemeVariant = "dark" | "light";

function getStorageKey(): string {
	const userId = localStorage.getItem("texlyre-current-user");
	return userId ? `texlyre-user-${userId}-settings` : STORAGE_KEY_GLOBAL;
}

function readStoredVariant(): ThemeVariant {
	try {
		const raw = localStorage.getItem(getStorageKey());
		const stored = raw ? JSON.parse(raw)[VARIANT_SETTING_ID] : null;
		if (stored === "system") {
			return window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light";
		}
		return DARK_VARIANTS.has(stored) ? "dark" : "light";
	} catch {
		return "light";
	}
}

export function applyThemeVariant(variant: ThemeVariant): void {
	document.documentElement.setAttribute("data-theme", variant);
	document.documentElement.setAttribute("data-theme-mode", variant);
}

export function getInitialVariant(): ThemeVariant {
	return readStoredVariant();
}

export function setThemeVariant(variant: ThemeVariant): void {
	applyThemeVariant(variant);
	try {
		const key = getStorageKey();
		const raw = localStorage.getItem(key);
		const obj = raw ? JSON.parse(raw) : {};
		obj[VARIANT_SETTING_ID] = variant;
		localStorage.setItem(key, JSON.stringify(obj));
	} catch {}
}
