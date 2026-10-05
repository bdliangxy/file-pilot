import { en } from './locales/en';

type TranslationKey = keyof typeof en;
type TranslationParams = Record<string, string | number>;

export function t(key: TranslationKey, params: TranslationParams = {}): string {
	return en[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined ? placeholder : String(value);
	});
}
