import type { Locale, Dictionary, CopyKey } from './types.js';
import { en } from './locales/en.js';
import { hi } from './locales/hi.js';

export class Translator {
  private dictionaries: Record<Locale, Dictionary> = { en, hi };
  private currentLocale: Locale = 'en';

  public setLocale(locale: Locale): void {
    if (this.dictionaries[locale]) {
      this.currentLocale = locale;
    }
  }

  public getLocale(): Locale {
    return this.currentLocale;
  }

  public t(key: CopyKey, params?: Record<string, string | number>): string {
    let text = this.dictionaries[this.currentLocale][key] || this.dictionaries['en'][key] || key;

    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
      }
    }

    return text;
  }
}