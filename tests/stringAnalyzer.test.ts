import { analyzeStringsForTranslation } from '../src/helpers/stringAnalyzer';
import { XCStrings } from '../src/types';

describe('analyzeStringsForTranslation', () => {
  const targetLanguages = ['es', 'fr', 'de'];

  test('should identify strings needing translation and handle all edge cases', () => {
    // Test input: XCStrings data with various scenarios
    const xcstringsData: XCStrings = {
      sourceLanguage: 'en',
      version: '1.0',
      strings: {
        // Case 1: String with no localizations (should need all target languages)
        'welcome_message': {
          comment: 'Welcome message for users'
        },
        
        // Case 2: String with partial localizations (should need missing languages)
        'login_button': {
          localizations: {
            'es': {
              stringUnit: {
                state: 'translated',
                value: 'Iniciar sesión'
              }
            }
            // Missing 'fr' and 'de'
          }
        },
        
        // Case 3: String with empty value (should need retranslation)
        'logout_button': {
          localizations: {
            'es': {
              stringUnit: {
                state: 'translated',
                value: '' // Empty value
              }
            },
            'fr': {
              stringUnit: {
                state: 'translated',
                value: 'Se déconnecter'
              }
            }
            // Missing 'de'
          }
        },
        
        // Case 4: String marked as stale (should be removed)
        'old_feature': {
          extractionState: 'stale',
          localizations: {
            'es': {
              stringUnit: {
                state: 'translated',
                value: 'Función antigua'
              }
            }
          }
        },
        
        // Case 5: String with shouldTranslate=false (should be skipped)
        'debug_key': {
          shouldTranslate: false,
          localizations: {
            // No localizations, but should be skipped anyway
          }
        },
        
        // Case 6: Fully translated string (should not need translation)
        'save_button': {
          localizations: {
            'es': {
              stringUnit: {
                state: 'translated',
                value: 'Guardar'
              }
            },
            'fr': {
              stringUnit: {
                state: 'translated',
                value: 'Enregistrer'
              }
            },
            'de': {
              stringUnit: {
                state: 'translated',
                value: 'Speichern'
              }
            }
          }
        }
      }
    };

    const result = analyzeStringsForTranslation(xcstringsData, targetLanguages);

    // Verify translation requests
    expect(result.translationRequests).toHaveLength(3);
    
    // Check welcome_message request (needs all languages)
    const welcomeRequest = result.translationRequests.find(req => req.key === 'welcome_message');
    expect(welcomeRequest).toBeDefined();
    expect(welcomeRequest!.targetLanguages).toEqual(['es', 'fr', 'de']);
    expect(welcomeRequest!.text).toBe('welcome_message');

    // Check login_button request (needs fr and de)
    const loginRequest = result.translationRequests.find(req => req.key === 'login_button');
    expect(loginRequest).toBeDefined();
    expect(loginRequest!.targetLanguages).toEqual(['fr', 'de']);

    // Check logout_button request (needs es retranslation and de)
    const logoutRequest = result.translationRequests.find(req => req.key === 'logout_button');
    expect(logoutRequest).toBeDefined();
    expect(logoutRequest!.targetLanguages).toEqual(['es', 'de']);

    // Verify string translation map
    expect(result.stringTranslationMap.size).toBe(3);
    
    // Check isNew mapping for welcome_message (all should be new)
    const welcomeMapping = result.stringTranslationMap.get('welcome_message');
    expect(welcomeMapping).toBeDefined();
    expect(welcomeMapping!.isNew.get('es')).toBe(true);
    expect(welcomeMapping!.isNew.get('fr')).toBe(true);
    expect(welcomeMapping!.isNew.get('de')).toBe(true);

    // Check isNew mapping for logout_button (es should be update, de should be new)
    const logoutMapping = result.stringTranslationMap.get('logout_button');
    expect(logoutMapping).toBeDefined();
    expect(logoutMapping!.isNew.get('es')).toBe(false); // Update existing
    expect(logoutMapping!.isNew.get('de')).toBe(true);  // New translation

    // Verify stale removal
    expect(result.translationChanges.staleRemoved).toEqual(['old_feature']);
    expect(result.xcstringsModified).toBe(true);
    expect(result.modifiedXcstringsData.strings['old_feature']).toBeUndefined();

    // Verify shouldTranslate=false was skipped
    expect(result.translationRequests.find(req => req.key === 'debug_key')).toBeUndefined();

    // Verify fully translated string was not included
    expect(result.translationRequests.find(req => req.key === 'save_button')).toBeUndefined();

    // Verify original data was not modified (deep copy check)
    expect(xcstringsData.strings['old_feature']).toBeDefined();
    expect(xcstringsData.strings['welcome_message'].localizations).toBeUndefined();
    
    // Verify modified data has proper structure
    expect(result.modifiedXcstringsData.strings['welcome_message'].localizations).toBeDefined();
    expect(result.modifiedXcstringsData.strings['welcome_message'].localizations!['es']).toEqual({
      stringUnit: { state: 'translated', value: '' }
    });
  });

  test('should handle empty strings object', () => {
    const xcstringsData: XCStrings = {
      sourceLanguage: 'en',
      version: '1.0',
      strings: {}
    };

    const result = analyzeStringsForTranslation(xcstringsData, targetLanguages);

    expect(result.translationRequests).toHaveLength(0);
    expect(result.stringTranslationMap.size).toBe(0);
    expect(result.translationChanges.staleRemoved).toHaveLength(0);
    expect(result.xcstringsModified).toBe(false);
  });

  test('should handle empty target languages array', () => {
    const xcstringsData: XCStrings = {
      sourceLanguage: 'en',
      version: '1.0',
      strings: {
        'test_key': {
          comment: 'Test string'
        }
      }
    };

    const result = analyzeStringsForTranslation(xcstringsData, []);

    expect(result.translationRequests).toHaveLength(0);
    expect(result.stringTranslationMap.size).toBe(0);
    expect(result.xcstringsModified).toBe(false);
  });
}); 