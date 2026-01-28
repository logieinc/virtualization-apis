import { promises as fs } from 'node:fs';
import path from 'node:path';

import YAML from 'yaml';

import { PartyDocument, SimulationDocument } from '../types';

export function resolveProjectFile(project: string, filename: string): string {
  const projectsRoot = process.env.PROJECTS_DIR || 'projects';
  return path.resolve(process.cwd(), projectsRoot, project, filename);
}

export async function readYamlFile<T>(filePath: string): Promise<T> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const content = await fs.readFile(absolutePath, 'utf-8');
  const parsed = YAML.parse(content) as T | null;

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('YAML file does not contain a valid object.');
  }

  return parsed;
}

export async function readSimulationFile(filePath: string): Promise<SimulationDocument> {
  const parsed = await readYamlFile<SimulationDocument>(filePath);

  if (!parsed.name) {
    throw new Error('Simulation file must include a "name" field.');
  }

  if (!Array.isArray(parsed.parties) || parsed.parties.length === 0) {
    throw new Error('Simulation file must define at least one entry in "parties".');
  }

  return parsed;
}

export async function readPartyFile(filePath: string): Promise<PartyDocument> {
  const parsed = await readYamlFile<PartyDocument>(filePath);

  if (!Array.isArray(parsed.parties) || parsed.parties.length === 0) {
    throw new Error('Party file must define at least one entry in "parties".');
  }

  return parsed;
}
