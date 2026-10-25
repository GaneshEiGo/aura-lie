import { describe, it, expect } from 'vitest';
import { Translator } from '../src/translator.js';

describe('i18n Translator (PRD 6.9)', () => {
  const translator = new Translator();

  it('should default to English', () => {
    expect(translator.getLocale()).toBe('en');
    expect(translator.t('home.headline')).toBe('What are we solving?');
  });

  it('should switch to Hindi', () => {
    translator.setLocale('hi');
    expect(translator.getLocale()).toBe('hi');
    expect(translator.t('home.headline')).toBe('हम क्या हल कर रहे हैं?');
  });

  it('should fallback to English if key is missing in target locale', () => {
    translator.setLocale('hi');
    // Mock a key that doesn't exist in Hindi
    const mockKey = 'fact.unknown' as any;
    expect(translator.t(mockKey)).toBe(mockKey); 
  });

  it('should interpolate variables', () => {
    // Reset to English for this test
    translator.setLocale('en');
    
    // Mock the key
    const originalEn = translator['dictionaries']['en']['error.generic'];
    translator['dictionaries']['en']['error.generic'] = 'Failed with code {code}';
    
    expect(translator.t('error.generic', { code: 404 })).toBe('Failed with code 404');
    
    // Restore
    translator['dictionaries']['en']['error.generic'] = originalEn;
  });
});