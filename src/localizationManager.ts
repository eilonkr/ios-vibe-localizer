import * as core from '@actions/core';
import { OpenAIService } from './openaiService';
import { TranslationRequest, BatchTranslationResponse } from './types';

/**
 * Fetches real translations for multiple strings in a single batch API call.
 * @param requests Array of translation requests.
 * @param sourceLanguageCode The source language code (e.g., "en").
 * @param model The OpenAI model to use for translations.
 * @returns A promise that resolves to the batch translation response.
 */
export async function fetchBatchTranslations(requests: TranslationRequest[], sourceLanguageCode: string = "en", model: string): Promise<BatchTranslationResponse> {
  core.info(`Fetching batch translations for ${requests.length} strings from ${sourceLanguageCode} using model ${model}.`);
  const openaiService = new OpenAIService(model);
  try {
    const batchResponse = await openaiService.getBatchTranslations(requests, sourceLanguageCode);
    return batchResponse;
  } catch (error) {
    core.error(`Error fetching batch translations: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
} 