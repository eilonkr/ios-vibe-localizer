import * as core from '@actions/core';
import * as fs from 'fs';
import { fetchBatchTranslations } from './localizationManager';
import { XCStrings, TranslationRequest } from './types';
import { createPullRequest, getShaRefs, getFileContentAtCommit, PrConfig } from './githubService';
import { analyzeStringsForTranslation } from './stringAnalyzer';

/**
 * Formats JSON to match Xcode's xcstrings formatting style with spaces before colons.
 * @param obj The object to stringify
 * @returns Formatted JSON string matching Xcode's style
 */
function formatXcstringsJson(obj: any): string {
  const jsonString = JSON.stringify(obj, null, 2);
  // Align with Xcode's xcstrings format style
  return jsonString.replace(/("(?:[^"\\]|\\.)*")\s*:/g, '$1 :');
}

async function run(): Promise<void> {
  try {
    const xcstringsFilePath = core.getInput('xcstrings_file_path', { required: false }) || 'Localizable.xcstrings';
    const targetLanguagesInput = core.getInput('target_languages', { required: true });
    const targetLanguages = targetLanguagesInput.split(',').map(lang => lang.trim()).filter(lang => lang);
    const openaiModel = core.getInput('openai_model', { required: false }) || 'gpt-4o-mini';

    core.info(`XCStrings file: ${xcstringsFilePath}`);
    core.info(`Target languages: ${targetLanguages.join(', ')}`);
    core.info(`OpenAI model: ${openaiModel}`);

    if (targetLanguages.length === 0) {
      core.setFailed('No target languages specified.');
      return;
    }

    const { baseSha, headSha } = await getShaRefs();
    core.info(`Base SHA: ${baseSha}`);
    core.info(`Head SHA: ${headSha}`);

    const currentXcstringsFileContent = await getFileContentAtCommit(headSha, xcstringsFilePath);
    if (currentXcstringsFileContent === null) {
      core.setFailed(`Could not read ${xcstringsFilePath} at HEAD commit ${headSha}.`);
      return;
    }
    
    let currentXcstringsData: XCStrings;
    try {
      currentXcstringsData = JSON.parse(currentXcstringsFileContent);
    } catch (e: any) {
      core.setFailed(`Failed to parse ${xcstringsFilePath} from HEAD commit ${headSha}: ${e.message}`);
      return;
    }
    core.info(`Successfully parsed ${xcstringsFilePath} from HEAD. Found ${Object.keys(currentXcstringsData.strings).length} string keys.`);

    // Analyze strings to determine what needs translation
    const analysisResult = analyzeStringsForTranslation(currentXcstringsData, targetLanguages);
    const { 
      translationRequests, 
      translationChanges, 
      stringTranslationMap, 
      modifiedXcstringsData: updatedXcstringsData, 
      xcstringsModified 
    } = analysisResult;

    for (const key of translationChanges.staleRemoved) {
      core.info(`Removed stale string entry: ${key}`);
    }

    if (translationRequests.length > 0) {
      core.info(`Found ${translationRequests.length} strings requiring translation. Processing in batch...`);

      const batchResponse = await fetchBatchTranslations(translationRequests, updatedXcstringsData.sourceLanguage, openaiModel);

      for (const translationResult of batchResponse.translations) {
        const key = translationResult.key;
        const stringEntry = updatedXcstringsData.strings[key];
        const translationInfo = stringTranslationMap.get(key);
        
        if (!stringEntry || !translationInfo) {
          core.warning(`Received translation for unknown key: ${key}`);
          continue;
        }

        for (const [lang, translatedValue] of Object.entries(translationResult.translations)) {
          if (translationInfo.languages.includes(lang)) {
            stringEntry.localizations![lang]!.stringUnit = {
              state: "translated",
              value: translatedValue
            };
            
            const changeKey = `${key} (${lang})`;
            if (translationInfo.isNew.get(lang)) {
              translationChanges.added.push(changeKey);
            } else {
              translationChanges.updated.push(changeKey);
            }
          }
        }
      }
    }

    if (translationChanges.added.length > 0) {
      core.info(`Added translations for ${translationChanges.added.length} strings: ${translationChanges.added.join(', ')}`);
    }
    if (translationChanges.updated.length > 0) {
      core.info(`Updated translations for ${translationChanges.updated.length} strings: ${translationChanges.updated.join(', ')}`);
    }
    if (translationChanges.staleRemoved.length > 0) {
      core.info(`Removed stale extraction state from ${translationChanges.staleRemoved.length} strings: ${translationChanges.staleRemoved.join(', ')}`);
    }
    if (translationChanges.added.length === 0 && translationChanges.updated.length === 0 && translationChanges.staleRemoved.length === 0) {
      core.info('No new strings requiring translation found in ' + xcstringsFilePath);
    }
    
    const changedFilesList: string[] = [];

    if (xcstringsModified || translationChanges.added.length > 0 || translationChanges.updated.length > 0) {
      try {
        fs.writeFileSync(xcstringsFilePath, formatXcstringsJson(updatedXcstringsData));
        core.info(`Changes written to ${xcstringsFilePath}`);
        changedFilesList.push(xcstringsFilePath);
      } catch (e:any) {
        core.setFailed(`Error writing updated ${xcstringsFilePath}: ${e.message}`);
        return;
      }
    } else {
      core.info(`No changes needed for ${xcstringsFilePath}`);
    }

    if (changedFilesList.length > 0) {
      const totalChanges = translationChanges.added.length + translationChanges.updated.length + translationChanges.staleRemoved.length;
      const changedKeys = [...translationChanges.added, ...translationChanges.updated, ...translationChanges.staleRemoved];
      core.info(`Localization file ${xcstringsFilePath} was updated with ${totalChanges} changes. String keys: [${changedKeys.join(', ')}]. Added: ${translationChanges.added.length}, Updated: ${translationChanges.updated.length}, Stale removed: ${translationChanges.staleRemoved.length}. Proceeding to create a PR.`);

      const token = core.getInput('github_token', { required: true });
      const prConfig: PrConfig = {
        branchPrefix: core.getInput('pr_branch_prefix', { required: false }) || 'localization/',
        commitUserName: core.getInput('commit_user_name', { required: false }) || 'github-actions[bot]',
        commitUserEmail: core.getInput('commit_user_email', { required: false }) || 'github-actions[bot]@users.noreply.github.com',
        commitMessage: core.getInput('commit_message', { required: false }) || 'i18n: Update translations',
        prTitle: core.getInput('pr_title', { required: false }) || 'New Translations Added',
        prBody: core.getInput('pr_body', { required: false }) || 'Automated PR with new translations.'
      };
      
      await createPullRequest(xcstringsFilePath, changedFilesList, token, prConfig);

    } else {
      core.info('No localization files were changed. Skipping PR creation.');
    }

    core.info('');
    core.info('=== Action Summary ===');
    core.info(`Files processed: ${xcstringsFilePath}`);
    core.info(`Target languages: ${targetLanguages.join(', ')}`);
    core.info(`OpenAI model used: ${openaiModel}`);
    
    if (translationChanges.added.length > 0 || translationChanges.updated.length > 0 || translationChanges.staleRemoved.length > 0) {
      core.info(`Translation changes:`);
      if (translationChanges.added.length > 0) {
        core.info(`  - Added: ${translationChanges.added.length} translations`);
      }
      if (translationChanges.updated.length > 0) {
        core.info(`  - Updated: ${translationChanges.updated.length} translations`);
      }
      if (translationChanges.staleRemoved.length > 0) {
        core.info(`  - Removed stale extraction state from: ${translationChanges.staleRemoved.length} strings`);
      }
    } else {
      core.info(`Translation changes: None`);
    }
    
    if (changedFilesList.length > 0) {
      core.info(`Files modified: ${changedFilesList.join(', ')}`);
      core.info(`Pull request: Created for localization updates`);
    } else {
      core.info(`Files modified: None`);
      core.info(`Pull request: Not created (no changes)`);
    }
    core.info('======================');

    core.info('Localization process completed.');

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run();