import * as core from '@actions/core';

// Removed parseStringsFile function

// Removed readLocalizationFile function

// Removed writeLocalizationFile function

/**
 * Generates a mock translation string for a given key and language code.
 * @param key The original string key (source language string).
 * @param languageCode The target language code (e.g., "de", "es").
 * @returns A mock translated string in the format "[languageCode] key".
 */
export function generateMockTranslation(key: string, languageCode: string): string {
  core.info(`Generating mock translation for key "${key}" in language "${languageCode}".`);
  return `[${languageCode}] ${key}`;
} 