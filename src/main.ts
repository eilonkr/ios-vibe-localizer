import * as core from '@actions/core';
import * as github from '@actions/github';
import * as exec from '@actions/exec';

async function run(): Promise<void> {
  try {
    const appStringsFilePath = core.getInput('app_strings_file_path', { required: false }) || 'AppStrings.swift';
    core.info(`Monitoring changes for: ${appStringsFilePath}`);

    const context = github.context;
    let baseSha = '';
    let headSha = '';

    switch (context.eventName) {
      case 'pull_request':
        baseSha = context.payload.pull_request?.base.sha;
        headSha = context.payload.pull_request?.head.sha;
        core.info(`Pull Request event: Base SHA is ${baseSha}, Head SHA is ${headSha}`);
        break;
      case 'push':
        baseSha = context.payload.before;
        headSha = context.payload.after;
        core.info(`Push event: Base SHA is ${baseSha}, Head SHA is ${headSha}`);
        break;
      default:
        core.setFailed(
          `Unsupported event: ${context.eventName}. This action currently only supports 'pull_request' and 'push' events.`
        );
        return;
    }

    if (!baseSha || !headSha) {
      core.setFailed('Could not determine base or head SHA.');
      return;
    }

    core.info(`Base SHA: ${baseSha}`);
    core.info(`Head SHA: ${headSha}`);
    core.info(`Checking diff for file: ${appStringsFilePath}`);

    let diffOutput = '';
    const options: exec.ExecOptions = {};
    options.listeners = {
      stdout: (data: Buffer) => {
        diffOutput += data.toString();
      },
      stderr: (data: Buffer) => {
        core.error(data.toString()); // Log stderr as errors
      }
    };
    options.ignoreReturnCode = true; // Handle non-zero exit codes manually if needed

    const exitCode = await exec.exec('git', [
      'diff',
      '--unified=0', // Shows no context lines, just changes
      baseSha,
      headSha,
      '--',
      appStringsFilePath
    ], options);

    if (exitCode !== 0 && diffOutput.length === 0) {
        // git diff exits with 1 if there are differences, 0 if no differences.
        // If it's non-zero and no output, it might be an actual error or file not found in one of the SHAs.
        core.info(`Git diff command exited with code ${exitCode} and no output. This might mean the file does not exist in one of the commits or no changes were found.`);
    } 

    if (diffOutput) {
      core.info(`--- Changes to ${appStringsFilePath} ---`);
      core.info(diffOutput);
      core.info(`--- End of Changes to ${appStringsFilePath} ---`);
    } else {
      core.info(`No changes detected in ${appStringsFilePath} between ${baseSha} and ${headSha}.`);
    }

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run(); 