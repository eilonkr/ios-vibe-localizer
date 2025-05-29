import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import * as fs from 'fs';
// import *path from 'path'; // No longer needed directly in main.ts for path.join for .lproj
import { generateMockTranslation } from './localizationManager';
// Imports for appStringsParser and localizationManager will be removed or changed later
// import { parseAppStrings } from './appStringsParser';
// import { readLocalizationFile, generateStringsFileContent, writeLocalizationFile } from './localizationManager';

// Define the structure for XCStrings content (simplified)
interface XCStrings {
  sourceLanguage: string;
  strings: {
    [key: string]: {
      comment?: string;
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
    const xcstringsFilePath = core.getInput('xcstrings_file_path', { required: false }) || 'Localizable.xcstrings';
    const targetLanguagesInput = core.getInput('target_languages', { required: true });
    const targetLanguages = targetLanguagesInput.split(',').map(lang => lang.trim()).filter(lang => lang);
    // const localizationDir = core.getInput('localization_files_directory', { required: false }) || '.'; // No longer needed

    core.info(`XCStrings file: ${xcstringsFilePath}`);
    core.info(`Target languages: ${targetLanguages.join(', ')}`);
    // core.info(`Localization directory: ${localizationDir}`); // No longer needed

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

    const stringsToMockTranslate: string[] = []; // Store keys of strings that need mock translation
    let xcstringsModified = false;

    for (const key in currentXcstringsData.strings) {
      const currentStringEntry = currentXcstringsData.strings[key];
      if (!currentStringEntry.localizations) {
        currentStringEntry.localizations = {}; // Initialize if completely new string from Xcode
      }

      for (const lang of targetLanguages) {
        const needsTranslationForLang = 
          !currentStringEntry.localizations[lang] || 
          !currentStringEntry.localizations[lang]?.stringUnit ||
          !currentStringEntry.localizations[lang]?.stringUnit.value;

        if (needsTranslationForLang) {
          core.info(`String key "${key}" needs mock translation for language "${lang}".`);
          if (!currentStringEntry.localizations[lang]) {
            currentStringEntry.localizations[lang] = { stringUnit: { state: 'translated', value: '' } }; // Initialize structure
          }
          currentStringEntry.localizations[lang]!.stringUnit = {
            state: "translated", // Or a custom state like "needs_review"
            value: generateMockTranslation(key, lang) // Use the imported function
          };
          xcstringsModified = true;
          if (!stringsToMockTranslate.includes(key)) {
            stringsToMockTranslate.push(key);
          }
        }
      }
    }

    if (stringsToMockTranslate.length > 0) {
      core.info(`Found ${stringsToMockTranslate.length} string keys requiring mock translations: ${stringsToMockTranslate.join(', ')}`);
    } else {
      core.info('No new strings requiring mock translation found in ' + xcstringsFilePath);
    }
    
    // Track if any .strings files were actually changed or created -> now only one xcstrings file
    const changedFilesList: string[] = []; // Will contain only xcstringsFilePath if modified

    if (xcstringsModified) {
      try {
        // Ensure the directory for xcstringsFilePath exists (it should, as we read from it)
        // but good practice if the path could be arbitrary, though not the case here.
        // const outputDir = path.dirname(xcstringsFilePath);
        // if (!fs.existsSync(outputDir)) {
        //   fs.mkdirSync(outputDir, { recursive: true });
        // }
        fs.writeFileSync(xcstringsFilePath, JSON.stringify(currentXcstringsData, null, 2));
        core.info(`Changes written to ${xcstringsFilePath}`);
        changedFilesList.push(xcstringsFilePath); // Track relative path
      } catch (e:any) {
        core.setFailed(`Error writing updated ${xcstringsFilePath}: ${e.message}`);
        return;
      }
    } else {
      core.info(`No changes needed for ${xcstringsFilePath}`);
    }


    if (changedFilesList.length > 0) { // Replaces old 'filesChanged' logic
      core.info(`Localization file ${xcstringsFilePath} was updated. Proceeding to create a PR.`);
      // core.info(`Files changed: ${changedFilesList.join(', ')}`); // Now only one file

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

      core.info('Adding file to commit...');
      await exec.exec('git', ['add', xcstringsFilePath]); // Only one file
      
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
          base: baseBranchForPR,
          body: prBody, // prBody was already updated with changedFilesList
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