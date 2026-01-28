import axios from 'axios';
import { Command } from 'commander';

import { SimulationDocument } from '../types';
import { readSimulationFile } from '../utils/file-utils';

const DEFAULT_API_URL = process.env.API_URL || 'http://localhost:4000';

async function sendToApi(apiBaseUrl: string, payload: SimulationDocument): Promise<void> {
  const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/simulation/run`;
  const response = await axios.post(endpoint, payload);

  console.info('Simulation successfully sent');
  console.table(response.data);
}

export function registerSimulateCommand(program: Command): void {
  program
    .command('simulate <file>')
    .description('Process a simulation YAML file and send it to the local API.')
    .option('-a, --api <url>', 'API base URL', DEFAULT_API_URL)
    .option('--dry-run', 'Preview payload without sending it to the API', false)
    .action(async (file: string, options: { api: string; dryRun?: boolean }) => {
      try {
        const simulation = await readSimulationFile(file);

        if (options.dryRun) {
          console.info('Simulation preview');
          console.dir(simulation, { depth: null });
          return;
        }

        await sendToApi(options.api, simulation);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error while processing the simulation: ${message}`);
        process.exitCode = 1;
      }
    });
}
