import { spawn } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import process from 'node:process';
import console from 'node:console';
import release from '../needle-release.json' with { type: 'json' };
import { needleDirectory, needlePlatform, needleExecutable } from './needle-paths.mjs';

if (!needlePlatform || !needleExecutable) throw new Error('No configured Needle binary for this platform. See the Needle supported-devices guide.');
// Pinned official files only; no training packages or global Python dependencies.
const child = spawn('hf', ['download', release.repository, `${needlePlatform}/${process.platform === 'win32' ? 'needle.exe' : 'needle'}`,
  'needle3.cact', '--revision', release.revision, '--local-dir', needleDirectory], { stdio: 'inherit' });
const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
if (status !== 0) throw new Error('Needle download failed. Install the Hugging Face hf CLI, then retry npm run setup:needle.');
await chmod(needleExecutable, 0o755);
console.log('Needle 3 installed. Restart the demo server to enable the local model.');
