import type { Locale } from './i18n';
import translations from './locales/native.zh-CN.json';

const messages: Record<string, string> = translations;
const patterns = Object.entries(messages).filter(([key]) => key.includes('{')).map(([key, chinese]) => {
  const parts = key.split(/\{\d\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const slots = Array.from(key.matchAll(/\{(\d)\}/g), match => Number(match[1]));
  return { pattern: new RegExp('^' + parts.join('(.+?)') + '$', 's'), slots, chinese, key };
});

export function nativeMessage(locale: Locale, message: string): string {
  if (locale !== 'zh-CN') return message;
  if (Object.hasOwn(messages, message)) return messages[message];
  for (const { pattern, slots, chinese, key } of patterns) {
    const match = message.match(pattern);
    if (match) return chinese.replace(/\{(\d)\}/g, (_, index) => {
      const value = match[slots.indexOf(Number(index)) + 1];
      // Only the nested condition error is itself a diagnostic.
      return key === 'Invalid availableWhen on {0}: {1}' && index === '1'
        ? nativeMessage(locale, value) : value;
    });
  }
  return message;
}
