import * as core from '@actions/core';
import * as fs from 'fs';
import { fetchRealTranslation } from './localizationManager';
import { XCStrings } from './types';
import { createPullRequest, getShaRefs, getFileContentAtCommit, PrConfig } from './githubService'; // Import functions from githubService

async function run(): Promise<void> {
  try {
    // Input gathering
    const xcstringsFilePath = core.getInput('xcstrings_file_path', { required: false }) || 'Localizable.xcstrings';
    const targetLanguagesInput = core.getInput('target_languages', { required: true });
    const targetLanguages = targetLanguagesInput.split(',').map(lang => lang.trim()).filter(lang => lang);

    core.info(`XCStrings file: ${xcstringsFilePath}`);
    core.info(`Target languages: ${targetLanguages.join(', ')}`);

    if (targetLanguages.length === 0) {
      core.setFailed('No target languages specified.');
      return;
    }

    // SHA determination
    const { baseSha, headSha } = await getShaRefs();
    core.info(`Base SHA: ${baseSha}`);
    core.info(`Head SHA: ${headSha}`);

    // File processing and translation
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

    const translationChanges: { added: string[]; updated: string[];} = { added: [], updated: [] };
    let xcstringsModified = false;

    for (const key in currentXcstringsData.strings) {
      const currentStringEntry = currentXcstringsData.strings[key];
      if (!currentStringEntry.localizations) {
        currentStringEntry.localizations = {};
      }

      for (const lang of targetLanguages) {
        const needsTranslationForLang = 
          !currentStringEntry.localizations[lang] || 
          !currentStringEntry.localizations[lang]?.stringUnit ||
          !currentStringEntry.localizations[lang]?.stringUnit.value;

        if (needsTranslationForLang) {
          const isNewTranslation = !currentStringEntry.localizations[lang];
          core.info(`String key "${key}" needs translation for language "${lang}". Fetching real translation.`);
          
          if (!currentStringEntry.localizations[lang]) {
            currentStringEntry.localizations[lang] = { stringUnit: { state: 'translated', value: '' } };
          }
          
          const translatedValue = await fetchRealTranslation(key, lang, currentXcstringsData.sourceLanguage);
          currentStringEntry.localizations[lang]!.stringUnit = {
            state: "translated",
            value: translatedValue
          };
          xcstringsModified = true;
          
          const changeKey = `${key} (${lang})`;
          if (isNewTranslation) {
            translationChanges.added.push(changeKey);
          } else {
            translationChanges.updated.push(changeKey);
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
    if (translationChanges.added.length === 0 && translationChanges.updated.length === 0) {
      core.info('No new strings requiring translation found in ' + xcstringsFilePath);
    }
    
    const changedFilesList: string[] = [];

    if (xcstringsModified) {
      try {
        fs.writeFileSync(xcstringsFilePath, JSON.stringify(currentXcstringsData, null, 2));
        core.info(`Changes written to ${xcstringsFilePath}`);
        changedFilesList.push(xcstringsFilePath);
      } catch (e:any) {
        core.setFailed(`Error writing updated ${xcstringsFilePath}: ${e.message}`);
        return;
      }
    } else {
      core.info(`No changes needed for ${xcstringsFilePath}`);
    }

    // Git operations and PR creation
    if (changedFilesList.length > 0) {
      core.info(`Localization file ${xcstringsFilePath} was updated. Proceeding to create a PR.`);

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