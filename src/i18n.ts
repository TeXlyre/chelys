// src/i18n.ts
import i18next from '@texlyre/i18n';
import languagesConfig from '../external/texlyre/translations/locales.config.json';
import en from '../translations/locales/en.json';
import ar from '../translations/locales/ar.json';
import de from '../translations/locales/de.json';
import es from '../translations/locales/es.json';
import it from '../translations/locales/it.json';
import zh from '../translations/locales/zh-CN.json';

const resources = { en, ar, de, es, it, zh };
export const languages = languagesConfig.languages;
const languageKey = 'chelys-interface-language';

for (const [language, bundle] of Object.entries(resources)) {
	i18next.addResourceBundle(language, 'translation', bundle, true, false);
}

export const t = (key: string, options?: Record<string, unknown>): string =>
	i18next.t(key, {
		defaultValue: options
			? key.replace(/(?<!\{)\{(\w+)\}(?!\})/g, '{{$1}}')
			: key,
		keySeparator: false,
		nsSeparator: false,
		...options,
	}) as string;

export function getLanguage(): string {
	try {
		const saved = localStorage.getItem(languageKey);
		return saved && languages.some((language) => language.code === saved)
			? saved
			: 'en';
	} catch {
		return 'en';
	}
}

export async function initializeLanguage(): Promise<void> {
	const language = getLanguage();
	await i18next.changeLanguage(language);
	document.documentElement.lang = language;
	document.documentElement.dir =
		languages.find((item) => item.code === language)?.direction ?? 'ltr';
}

export async function setLanguage(language: string): Promise<void> {
	if (
		!languages.some((item) => item.code === language) ||
		language === getLanguage()
	)
		return;
	localStorage.setItem(languageKey, language);
	const { flushSharedStorage } = await import('./runtime/storageMirror');
	await flushSharedStorage();
	window.location.reload();
}

export default i18next;
