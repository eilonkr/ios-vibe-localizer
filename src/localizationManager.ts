import * as core from '@actions/core';
import { OpenAIService } from './openaiService';

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
    throw error; // Propagate the error instead of falling back to mock translation
  }
} 