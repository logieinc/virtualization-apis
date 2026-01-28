#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { registerMongoCommand } from './commands/mongo';
import { registerOpensearchCommand } from './commands/opensearch';

const cwdEnvPath = path.resolve(process.cwd(), '.env');
const localEnvPath = path.resolve(__dirname, '..', '.env');

if (existsSync(cwdEnvPath)) {
  dotenv.config({ path: cwdEnvPath });
} else if (existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
}

const program = new Command();
program
  .name('shell-virtual')
  .description('CLI to drive and inspect virtual APIs')
  .version('0.1.0');

program.configureOutput({
  outputError: (str, write) => {
    write(str.endsWith('\n') ? str : `${str}\n`);
    write('\n');
  }
});

program.showHelpAfterError('\nRun the command again with --help to see available options.\n');
program.hook('postAction', () => console.log());

registerOpensearchCommand(program);
registerMongoCommand(program);

program.parseAsync(process.argv).catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
