export interface XCStrings {
  sourceLanguage: string;
  strings: {
    [key: string]: {
      comment?: string;
      extractionState?: string;
      shouldTranslate?: boolean;
      localizations?: {
        [lang: string]: {
          stringUnit: {
            state: string;
            value: string;
          };
        };
      };
    };
  };
  version: string;
}

export interface TranslationRequest {
  key: string;
  text: string;
  targetLanguages: string[];
  comment?: string;
}

export interface TranslationResult {
  key: string;
  translations: {
    [languageCode: string]: string;
  };
}

export interface BatchTranslationResponse {
  translations: TranslationResult[];
} 