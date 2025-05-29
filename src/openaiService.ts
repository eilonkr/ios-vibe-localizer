import * as core from '@actions/core';
import OpenAI from 'openai';

/**
 * Placeholder for OpenAI API key.
 * In a real scenario, this should be securely retrieved, e.g., from environment variables or action inputs.
 */
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
  constructor() {
    if (!openai) {
      core.warning('OpenAI client is not initialized. This might be due to a missing API key. Real translations will not be available.');
    }
  }

  /**
   * Translates a given text to the target language using OpenAI.
   * @param text The text to translate.
   * @param targetLanguage The language code to translate to (e.g., "es", "de").
   * @param sourceLanguage The language code of the original text (e.g., "en").
   * @returns A promise that resolves to the translated string.
   */
  async getTranslation(text: string, targetLanguage: string, sourceLanguage: string = "en"): Promise<string> {
    if (!openai) {
      core.warning(`OpenAI client not initialized. Returning mock translation for text: "${text}" to ${targetLanguage}.`);
      return `[${targetLanguage}] ${text} (mock - OpenAI not configured)`;
    }

    core.info(`Requesting translation for: "${text}" from ${sourceLanguage} to ${targetLanguage}`);

    try {
      const chatCompletion = await openai.chat.completions.create({
        messages: [
          { role: 'system', content: `Translate the following text from ${sourceLanguage} to ${targetLanguage}. Only return the translated text, without any additional explanations, formatting, or conversational fluff. If you cannot perform the translation, return the original text.` },
          { role: 'user', content: text }
        ],
        model: 'gpt-3.5-turbo', // Or any other suitable model
      });

      const translatedText = chatCompletion.choices[0]?.message?.content?.trim();

      if (!translatedText) {
        core.error(`Failed to translate text: "${text}". No content in response. Returning original text.`);
        return text; // Fallback to original text if translation fails
      }

      core.info(`Received translation: "${translatedText}"`);
      return translatedText;

    } catch (error) {
      core.error(`Error translating text "${text}" to ${targetLanguage}: ${error instanceof Error ? error.message : String(error)}`);
      // Fallback to the original text in case of an error during API call
      return text;
    }
  }
} 