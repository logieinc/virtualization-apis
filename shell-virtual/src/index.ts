#!/usr/bin/env node
import { Command } from 'commander';
import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { resolveEnvironment } from './config';
import { registerMongoCommand } from './commands/mongo';
import { registerOpensearchCommand } from './commands/opensearch';
import { registerPostgresCommand } from './commands/postgres';

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

program.option('-e, --env <name>', 'Environment name', process.env.VIRT_ENV);

program.configureOutput({
  outputError: (str, write) => {
    write(str.endsWith('\n') ? str : `${str}\n`);
    write('\n');
  }
});

program.showHelpAfterError('\nRun the command again with --help to see available options.\n');
program.hook('postAction', () => console.log());
program.hook('preAction', command => {
  const opts = command.opts?.() ?? {};
  if (opts.env) {
    process.env.VIRT_ENV = String(opts.env);
  }
  const resolved = resolveEnvironment(opts.env);
  if (resolved.env?.apiUrl && !process.env.API_URL) {
    process.env.API_URL = resolved.env.apiUrl;
  }
  if (resolved.env?.projectsDir && !process.env.PROJECTS_DIR) {
    process.env.PROJECTS_DIR = resolved.env.projectsDir;
  }
});

registerOpensearchCommand(program);
registerMongoCommand(program);
registerPostgresCommand(program);

program.parseAsync(process.argv).catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
