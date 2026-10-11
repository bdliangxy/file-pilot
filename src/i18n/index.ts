import { getLanguage } from 'obsidian';
import { en } from './locales/en';
import { zh } from './locales/zh';

type TranslationKey = keyof typeof en;
type TranslationParams = Record<string, string | number>;



export function t(key: TranslationKey, params: TranslationParams = {}): string {

	const language = getLanguage();
	const locale = language.startsWith('zh') ? zh : en;

	return locale[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined ? placeholder : String(value);
	});
}
