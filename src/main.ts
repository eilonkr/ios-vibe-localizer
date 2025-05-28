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

    // Track if any .strings files were actually changed or created
    let filesChanged = false;
    const changedFilesList: string[] = [];

    for (const lang of targetLanguages) {
      const lprojPath = path.join(localizationDir, `${lang}.lproj`);
      const stringsFilePath = path.join(lprojPath, 'Localizable.strings');
      core.info(`Processing ${stringsFilePath}`);

      const originalContent = fs.existsSync(stringsFilePath) ? fs.readFileSync(stringsFilePath, 'utf-8') : null;
      const existingTranslations = readLocalizationFile(stringsFilePath); // This needs to be called before generate, ensures directory exists for read
      
      const newContent = generateStringsFileContent(existingTranslations, currentStrings, lang);
      
      if (originalContent !== newContent) {
        writeLocalizationFile(stringsFilePath, newContent);
        core.info(`Changes written to ${stringsFilePath}`);
        filesChanged = true;
        changedFilesList.push(stringsFilePath); // Track relative path
      } else {
        core.info(`No changes needed for ${stringsFilePath}`);
      }
    }

    if (filesChanged) {
      core.info('Localization files were updated. Proceeding to create a PR.');
      core.info(`Files changed: ${changedFilesList.join(', ')}`);

      const token = core.getInput('github_token', { required: true });
      const branchPrefix = core.getInput('pr_branch_prefix', { required: false });
      const commitUserName = core.getInput('commit_user_name', { required: false });
      const commitUserEmail = core.getInput('commit_user_email', { required: false });
      const commitMessage = core.getInput('commit_message', { required: false });
      const prTitle = core.getInput('pr_title', { required: false });
      let prBody = core.getInput('pr_body', { required: false });

      // Configure git
      await exec.exec('git', ['config', '--global', 'user.name', commitUserName]);
      await exec.exec('git', ['config', '--global', 'user.email', commitUserEmail]);

      const newBranchName = `${branchPrefix}${context.eventName}-${context.runId}-${Date.now()}`.replace(/\//g, '-');
      core.info(`Creating new branch: ${newBranchName}`);
      await exec.exec('git', ['checkout', '-b', newBranchName]);

      core.info('Adding files to commit...');
      // Add all changed .strings files. We need to be careful with paths if localizationDir is not '.'
      // The changedFilesList contains paths relative to the repo root if localizationDir is used correctly with path.join
      for (const file of changedFilesList) {
        await exec.exec('git', ['add', file]);
      }
      
      core.info('Committing changes...');
      await exec.exec('git', ['commit', '-m', commitMessage]);

      core.info('Pushing new branch...');
      await exec.exec('git', ['push', '-u', 'origin', newBranchName]);

      const octokit = github.getOctokit(token);
      const repoOwner = context.repo.owner;
      const repoName = context.repo.repo;
      
      let baseBranchForPR = context.ref.replace('refs/heads/', '');
      if (context.eventName === 'pull_request') {
        baseBranchForPR = context.payload.pull_request?.base.ref;
        if (!baseBranchForPR) {
            core.setFailed('Could not determine base branch from pull request context for PR creation.');
            return;
        }
      }
      core.info(`Base branch for PR will be: ${baseBranchForPR}`);
      
      prBody += `\n\nUpdated files:\n- ${changedFilesList.join('\n- ')}`;

      core.info(`Creating pull request: ${prTitle}`);
      try {
        const response = await octokit.rest.pulls.create({
          owner: repoOwner,
          repo: repoName,
          title: prTitle,
          head: newBranchName,
          base: baseBranchForPR, // Target the branch the workflow was triggered from
          body: prBody,
          draft: false
        });
        core.info(`Pull request created: ${response.data.html_url}`);
      } catch (e: any) {
        core.error('Error creating pull request:');
        if (e.response) {
          core.error(`Status: ${e.response.status}`);
          core.error(`Data: ${JSON.stringify(e.response.data)}`);
        }
        core.setFailed(e.message);
      }

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