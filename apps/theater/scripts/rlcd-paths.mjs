import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

export const rlcdDirectory = fileURLToPath(new URL('../../../.artifacts/rlcd/', import.meta.url));
export const rlcdSource = path.join(rlcdDirectory, 'source');
export const rlcdWeights = path.join(rlcdDirectory, 'model');
export const rlcdEnvironment = path.join(rlcdDirectory, 'venv');
export const rlcdPython = path.join(rlcdEnvironment, 'bin', 'python');
export const rlcdWorker = fileURLToPath(new URL('../python/rlcd_worker.py', import.meta.url));

export function installedRlcd() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return undefined;
  const files = [rlcdPython, rlcdWorker, path.join(rlcdSource, 'core', 'engine_mlx.py'),
    path.join(rlcdWeights, 'model.safetensors'), path.join(rlcdWeights, 'config.json')];
  return files.every(existsSync) ? { python: path.resolve(rlcdPython), worker: path.resolve(rlcdWorker),
    source: path.resolve(rlcdSource), weights: path.resolve(rlcdWeights) } : undefined;
}
