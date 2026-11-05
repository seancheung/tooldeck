import translations from './locales/ui.zh-CN.json';
import { createContext, useContext } from 'react';

export type Locale = 'en' | 'zh-CN';
export const LocaleContext = createContext<Locale>('en');
const chinese: Record<string, string> = translations;

export function translate(locale: Locale, key: string, values: Record<string, string | number> = {}) {
  const template = locale === 'zh-CN' && Object.hasOwn(chinese, key) ? chinese[key] : key;
  return template.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
}
export function useTranslator() {
  const locale = useContext(LocaleContext);
  return (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
}
