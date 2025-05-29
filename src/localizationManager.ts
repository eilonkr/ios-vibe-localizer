import * as core from '@actions/core';
import { OpenAIService } from './openaiService';

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

/**
 * Fetches a real translation for a given key and language code using OpenAI.
 * @param key The original string key (source language string).
 * @param targetLanguageCode The target language code (e.g., "de", "es").
 * @param sourceLanguageCode The source language code (e.g., "en").
 * @returns A promise that resolves to the translated string.
 */
export async function fetchRealTranslation(key: string, targetLanguageCode: string, sourceLanguageCode: string = "en"): Promise<string> {
  core.info(`Fetching real translation for key "${key}" from ${sourceLanguageCode} to ${targetLanguageCode}.`);
  const openaiService = new OpenAIService();
  try {
    const translation = await openaiService.getTranslation(key, targetLanguageCode, sourceLanguageCode);
    return translation;
  } catch (error) {
    core.error(`Error fetching real translation for key "${key}": ${error instanceof Error ? error.message : String(error)}`);
    // Fallback to mock translation in case of error
    return generateMockTranslation(key, targetLanguageCode) + " (fallback due to error)";
  }
} 