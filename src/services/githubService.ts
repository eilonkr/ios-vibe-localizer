import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';
import { generatePrDescription, TranslationChanges } from '../helpers/prDescriptionGenerator';

export interface PrConfig {
  branchPrefix: string;
  commitUserName: string;
  commitUserEmail: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export async function createPullRequest(
  xcstringsFilePath: string,
  changedFilesList: string[],
  token: string,
  prConfig: PrConfig,
  translationChanges?: TranslationChanges,
  targetLanguages?: string[]
): Promise<void> {
  const context = github.context;

  await exec.exec('git', ['config', '--global', 'user.name', prConfig.commitUserName]);
  await exec.exec('git', ['config', '--global', 'user.email', prConfig.commitUserEmail]);

  const newBranchName = `${prConfig.branchPrefix}${context.eventName}-${context.runId}-${Date.now()}`.replace(/\//g, '-');
  core.info(`Creating new branch: ${newBranchName}`);
  await exec.exec('git', ['checkout', '-b', newBranchName]);

  core.info('Adding file to commit...');
  await exec.exec('git', ['add', xcstringsFilePath]);

  core.info('Committing changes...');
  await exec.exec('git', ['commit', '-m', prConfig.commitMessage]);

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

  const finalPrBody = generatePrDescription(
    prConfig.prBody,
    translationChanges,
    targetLanguages,
    changedFilesList
  );

  core.info(`Creating pull request: ${prConfig.prTitle}`);
  try {
    const response = await octokit.rest.pulls.create({
      owner: repoOwner,
      repo: repoName,
      title: prConfig.prTitle,
      head: newBranchName,
      base: baseBranchForPR,
      body: finalPrBody,
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
}

export async function getShaRefs(): Promise<{ baseSha: string, headSha: string }> {
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
      if (/^0+$/.test(baseSha)) {
        core.info('New branch push detected. Comparing against parent of HEAD.');
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
      throw new Error(`Unsupported event: ${context.eventName}.`);
  }

  if (!baseSha || !headSha || /^0+$/.test(headSha)) {
    throw new Error(`Could not determine valid base or head SHA. Base: '${baseSha}', Head: '${headSha}'.`);
  }
  return { baseSha, headSha };
}

export async function getFileContentAtCommit(sha: string, filePath: string): Promise<string | null> {
  let content = '';
  const options: exec.ExecOptions = {};
  options.listeners = {
    stdout: (data: Buffer) => { content += data.toString(); },
    stderr: (data: Buffer) => { core.error(data.toString()); }
  };
  options.ignoreReturnCode = true; 

  const exitCode = await exec.exec('git', ['show', `${sha}:${filePath}`], options);
  if (exitCode !== 0) {
    core.warning(`File ${filePath} not found at commit ${sha} or git show failed.`);
    return null;
  }
  return content;
} 