import { XCStrings, TranslationRequest } from '../types';

export interface StringAnalysisResult {
  translationRequests: TranslationRequest[];
  translationChanges: {
    added: string[];
    updated: string[];
    staleRemoved: string[];
  };
  stringTranslationMap: Map<string, { languages: string[], isNew: Map<string, boolean> }>;
  modifiedXcstringsData: XCStrings;
  xcstringsModified: boolean;
}

/**
 * Analyzes XCStrings data to identify strings that need translation and prepares translation requests.
 * This is the core business logic that determines what translations are needed.
 * 
 * @param xcstringsData The parsed XCStrings data
 * @param targetLanguages Array of target language codes to translate to
 * @returns Analysis result containing translation requests and change tracking
 */
export function analyzeStringsForTranslation(
  xcstringsData: XCStrings,
  targetLanguages: string[]
): StringAnalysisResult {
  // Create a deep copy to avoid modifying the original
  const modifiedXcstringsData = JSON.parse(JSON.stringify(xcstringsData));
  
  const translationRequests: TranslationRequest[] = [];
  const translationChanges: { added: string[]; updated: string[]; staleRemoved: string[]; } = { 
    added: [], 
    updated: [], 
    staleRemoved: [] 
  };
  const stringTranslationMap: Map<string, { languages: string[], isNew: Map<string, boolean> }> = new Map();
  let xcstringsModified = false;

  for (const key in modifiedXcstringsData.strings) {
    const currentStringEntry = modifiedXcstringsData.strings[key];
    
    // Initialize localizations if not present
    if (!currentStringEntry.localizations) {
      currentStringEntry.localizations = {};
    }

    // Remove stale entries
    if (currentStringEntry.extractionState === 'stale') {
      delete modifiedXcstringsData.strings[key];
      xcstringsModified = true;
      translationChanges.staleRemoved.push(key);
      continue;
    }

    // Skip strings marked as shouldTranslate=false
    if (currentStringEntry.shouldTranslate === false) {
      continue;
    }

    const languagesNeeded: string[] = [];
    const isNewMap: Map<string, boolean> = new Map();

    // Check each target language to see if translation is needed
    for (const lang of targetLanguages) {
      const needsTranslationForLang = 
        !currentStringEntry.localizations[lang] || 
        !currentStringEntry.localizations[lang]?.stringUnit ||
        !currentStringEntry.localizations[lang]?.stringUnit.value;

      if (needsTranslationForLang) {
        const isNewTranslation = !currentStringEntry.localizations[lang];
        languagesNeeded.push(lang);
        isNewMap.set(lang, isNewTranslation);
        
        // Initialize the localization structure if it doesn't exist
        if (!currentStringEntry.localizations[lang]) {
          currentStringEntry.localizations[lang] = { 
            stringUnit: { state: 'translated', value: '' } 
          };
        }
      }
    }

    // If any languages need translation, add to requests
    if (languagesNeeded.length > 0) {
      translationRequests.push({
        key: key,
        text: key,
        targetLanguages: languagesNeeded,
        comment: currentStringEntry.comment
      });
      stringTranslationMap.set(key, { languages: languagesNeeded, isNew: isNewMap });
    }
  }

  return {
    translationRequests,
    translationChanges,
    stringTranslationMap,
    modifiedXcstringsData,
    xcstringsModified
  };
} 