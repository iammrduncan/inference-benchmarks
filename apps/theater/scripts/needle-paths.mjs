import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

export const needleDirectory = fileURLToPath(new URL('../../../.artifacts/needle/', import.meta.url));
export const needlePlatform = { 'darwin-arm64': 'macos-arm64', 'linux-x64': 'linux-x86_64',
  'linux-arm64': 'linux-arm64', 'win32-x64': 'windows-x86_64', 'win32-arm64': 'windows-arm64' }[`${process.platform}-${process.arch}`];
export const needleExecutable = needlePlatform ? path.join(needleDirectory, needlePlatform, process.platform === 'win32' ? 'needle.exe' : 'needle') : undefined;
export const needleWeights = path.join(needleDirectory, 'needle3.cact');
export function installedNeedle() {
  const executable = needleExecutable;
  const weights = needleWeights;
  return executable && existsSync(executable) && existsSync(weights) ? { executable: path.resolve(executable), weights: path.resolve(weights) } : undefined;
}
