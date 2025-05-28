import * as core from '@actions/core';

async function run(): Promise<void> {
  try {
    core.info('Test from iOS Localizer'); // This will print to the Actions log
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

run(); 