import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import release from '../rlcd-release.json' with { type: 'json' };
import { rlcdDirectory, rlcdEnvironment, rlcdPython, rlcdSource, rlcdWeights } from './rlcd-paths.mjs';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The pinned RLCD path requires Apple Silicon and MLX.');
}
const requirements = fileURLToPath(new URL('../rlcd-requirements.lock', import.meta.url));
await mkdir(rlcdDirectory, { recursive: true });
async function run(command, args, message) {
  const child = spawn(command, args, { stdio: 'inherit' });
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (status !== 0) throw new Error(message);
}
await run('uv', ['venv', rlcdEnvironment, '--python', '3.12', '--allow-existing'],
  'RLCD environment creation failed. Install uv and Python 3.12, then retry.');
await run('uv', ['pip', 'sync', '--python', rlcdPython, requirements], 'Pinned RLCD dependency installation failed.');
await run('hf', ['download', release.engineRepository, 'README.md', 'MODEL_CARD.md', 'core/__init__.py',
  'core/engine.py', 'core/engine_mlx.py', 'core/prompt_builder.py', 'core/schema.py', '--revision',
  release.engineRevision, '--local-dir', rlcdSource], 'RLCD engine download failed. Install the Hugging Face hf CLI, then retry.');
await run('hf', ['download', release.weightsRepository, '--revision', release.weightsRevision, '--local-dir', rlcdWeights],
  'RLCD base-weight download failed.');
console.log('Qwen 2.5 1.5B + RLCD installed. Restart the live demo to enable the local model.');
