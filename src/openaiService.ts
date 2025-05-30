import * as core from '@actions/core';
import OpenAI from 'openai';
import { TranslationRequest, BatchTranslationResponse } from './types';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

let openai: OpenAI | undefined;

if (OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
  });
} else {
  core.warning('OpenAI API key is not set. Real translations will not be available.');
}

export class OpenAIService {
  private model: string;

  constructor(model: string) {
    if (!openai) {
      throw new Error('OpenAI client is not initialized. Please ensure OPENAI_API_KEY environment variable is set with a valid API key.');
    }
    this.model = model;
  }

  /**
   * Translates multiple strings to multiple target languages using OpenAI structured outputs in a single API call.
   * @param requests Array of translation requests containing key, text, and target languages.
   * @param sourceLanguage The language code of the original text (e.g., "en").
   * @returns A promise that resolves to the batch translation response.
   */
  async getBatchTranslations(requests: TranslationRequest[], sourceLanguage: string = "en"): Promise<BatchTranslationResponse> {
    if (!openai) {
      throw new Error('OpenAI client not initialized. Please ensure OPENAI_API_KEY environment variable is set with a valid API key.');
    }

    if (requests.length === 0) {
      return { translations: [] };
    }

    // Get all unique target languages from all requests
    const allTargetLanguages = [...new Set(requests.flatMap(req => req.targetLanguages))];
    
    core.info(`Requesting batch translation for ${requests.length} strings from ${sourceLanguage} to languages: ${allTargetLanguages.join(', ')}`);

    // Create the schema for structured output
    const translationSchema = {
      type: "object",
      properties: {
        translations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description: "The original key/identifier for the string"
              },
              translations: {
                type: "object",
                properties: Object.fromEntries(
                  allTargetLanguages.map(lang => [
                    lang,
                    {
                      type: "string",
                      description: `Translation in ${lang}`
                    }
                  ])
                ),
                required: allTargetLanguages,
                additionalProperties: false
              }
            },
            required: ["key", "translations"],
            additionalProperties: false
          }
        }
      },
      required: ["translations"],
      additionalProperties: false
    };

    const stringsToTranslate = requests.map(req => `Key: "${req.key}"\nText: "${req.text}"`).join('\n\n');
    
    const systemPrompt = `You are a professional translator. Translate the following strings from ${sourceLanguage} to the specified target languages: ${allTargetLanguages.join(', ')}.

For each string, provide accurate, natural translations that preserve the meaning and context. If a string contains placeholders (like %@, %d, {0}, etc.), keep them exactly as they are in the translation.

Return the translations in the exact JSON structure specified.`;

    const userPrompt = `Translate these strings:\n\n${stringsToTranslate}`;

    try {
      const chatCompletion = await openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "batch_translation",
            schema: translationSchema,
            strict: true
          }
        }
      });

      const responseContent = chatCompletion.choices[0]?.message?.content;
      if (!responseContent) {
        throw new Error('No content in OpenAI response');
      }

      const batchResponse: BatchTranslationResponse = JSON.parse(responseContent);
      
      core.info(`Received batch translations for ${batchResponse.translations.length} strings`);
      return batchResponse;

    } catch (error) {
      core.error(`Error in batch translation: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 