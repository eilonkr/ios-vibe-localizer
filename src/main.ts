import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import { parseAppStrings } from './appStringsParser';
import { readLocalizationFile, generateStringsFileContent, writeLocalizationFile } from './localizationManager';

async function getFileContentAtCommit(sha: string, filePath: string): Promise<string | null> {
  let content = '';
  const options: exec.ExecOptions = {};
  options.listeners = {
    stdout: (data: Buffer) => { content += data.toString(); },
    stderr: (data: Buffer) => { core.error(data.toString()); }
  };
  options.ignoreReturnCode = true; // We need to check the exit code to see if the file exists

  // Ensure GITHUB_TOKEN has permissions to read contents
  // This command shows the content of the file at a specific commit
  const exitCode = await exec.exec('git', ['show', `${sha}:${filePath}`], options);
  if (exitCode !== 0) {
    core.warning(`File ${filePath} not found at commit ${sha} or git show failed.`);
    return null;
  }
  return content;
}

async function run(): Promise<void> {
  try {
    const appStringsFilePath = core.getInput('app_strings_file_path', { required: false }) || 'AppStrings.swift';
    const targetLanguagesInput = core.getInput('target_languages', { required: true });
    const targetLanguages = targetLanguagesInput.split(',').map(lang => lang.trim()).filter(lang => lang);
    const localizationDir = core.getInput('localization_files_directory', { required: false }) || '.';

    core.info(`AppStrings file: ${appStringsFilePath}`);
    core.info(`Target languages: ${targetLanguages.join(', ')}`);
    core.info(`Localization directory: ${localizationDir}`);

    if (targetLanguages.length === 0) {
      core.setFailed('No target languages specified.');
      return;
    }

    const context = github.context;
    let baseSha = '';
    let headSha = '';

    switch (context.eventName) {
      case 'pull_request':
        baseSha = context.payload.pull_request?.base.sha;
        headSha = context.payload.pull_request?.head.sha;
        break;
      case 'push':
        baseSha = context.payload.before;
        headSha = context.payload.after;
        // For push to new branch, context.payload.before is all zeros
        if (/^0+$/.test(baseSha)) {
          core.info(`New branch push detected. Comparing against parent of HEAD.`);
          // Attempt to get the parent of the first commit in the push if baseSha is 0000... (new branch)
          // This is a common scenario for new branches. We diff against the parent of the first commit.
          // Note: This might not cover all edge cases for new branches perfectly.
          // A more robust solution might involve finding the common ancestor with the target branch if applicable.
          const firstCommitSha = context.payload.commits?.[0]?.id;
          if (firstCommitSha) {
            try {
                let parentShaOutput = '';
                await exec.exec('git', ['rev-parse', `${firstCommitSha}^`], {
                    listeners: { stdout: (data: Buffer) => { parentShaOutput += data.toString(); } },
                    ignoreReturnCode: true
                });
                baseSha = parentShaOutput.trim();
                if (!baseSha) core.warning("Could not determine parent SHA for new branch's first commit.");
            } catch (e: any) {
                core.warning(`Could not get parent of first commit ${firstCommitSha} for new branch: ${e.message}`);
            }
          } else {
            core.warning('Could not determine first commit SHA for new branch push with zero base SHA.');
          }
        }
        break;
      default:
        core.setFailed(`Unsupported event: ${context.eventName}.`);
        return;
    }

    if (!baseSha || !headSha || /^0+$/.test(headSha)) { // headSha can be all zeros if branch is deleted
      core.setFailed(`Could not determine valid base or head SHA. Base: '${baseSha}', Head: '${headSha}'.`);
      return;
    }

    core.info(`Base SHA: ${baseSha}`);
    core.info(`Head SHA: ${headSha}`);

    const currentAppStringsContent = await getFileContentAtCommit(headSha, appStringsFilePath);
    if (currentAppStringsContent === null) {
      core.setFailed(`Could not read ${appStringsFilePath} at HEAD commit ${headSha}.`);
      return;
    }
    const currentStrings = parseAppStrings(currentAppStringsContent);
    core.info(`Found ${Object.keys(currentStrings).length} strings in current ${appStringsFilePath}`);

    let previousStrings: Record<string, string> = {};
    if (!/^0+$/.test(baseSha)) { // Don't try to read from a zero SHA (e.g., initial commit to new branch)
        const previousAppStringsContent = await getFileContentAtCommit(baseSha, appStringsFilePath);
        if (previousAppStringsContent !== null) {
            previousStrings = parseAppStrings(previousAppStringsContent);
            core.info(`Found ${Object.keys(previousStrings).length} strings in previous ${appStringsFilePath} at ${baseSha}`);
        } else {
            core.info(`${appStringsFilePath} not found at base commit ${baseSha}. Assuming all current strings are new.`);
        }
    } else {
        core.info(`Base SHA is zero (${baseSha}), assuming all current strings in ${appStringsFilePath} are new.`);
    }

    const stringsToTranslate: Record<string, string> = {};
    let changesDetected = false;
    for (const key in currentStrings) {
      if (!previousStrings[key] || previousStrings[key] !== currentStrings[key]) {
        stringsToTranslate[key] = currentStrings[key];
        core.info(`Change detected for key "${key}": value "${currentStrings[key]}" (previously: "${previousStrings[key] || '[not present]'}")`);
        changesDetected = true;
      }
    }

    if (!changesDetected) {
      core.info('No translatable changes detected in AppStrings.swift.');
      // Even if no changes to AppStrings.swift, we might need to update .strings files
      // if AppStrings.swift has keys not present in them (e.g. a new language was added)
      // or if .strings files are missing entirely.
    }

    // For now, we consider all currentStrings as the source for .strings files,
    // ensuring all keys in AppStrings.swift are present in each Localizable.strings file.
    // The generateStringsFileContent function will use mock translations for new/modified ones.

    for (const lang of targetLanguages) {
      const lprojPath = path.join(localizationDir, `${lang}.lproj`);
      const stringsFilePath = path.join(lprojPath, 'Localizable.strings');
      core.info(`Processing ${stringsFilePath}`);

      const existingTranslations = readLocalizationFile(stringsFilePath);
      
      // The generateStringsFileContent will use currentStrings as the master list.
      // It will take values from existingTranslations if they exist and are not considered outdated by its internal logic.
      // For keys in currentStrings but not in existingTranslations (or new/modified), it generates mocks.
      const newContent = generateStringsFileContent(existingTranslations, currentStrings, lang);
      writeLocalizationFile(stringsFilePath, newContent);
    }

    core.info('Localization process completed with mock translations.');

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run(); 