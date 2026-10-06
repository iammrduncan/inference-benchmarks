import process from 'node:process';
import { spawn } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { fileURLToPath, URL } from 'node:url';
import { installedNeedle } from './needle-paths.mjs';
import { installedRlcd } from './rlcd-paths.mjs';
// Load the shared root env before launching Next. Passing Node's --env-file flag
// directly to Next leaks it into worker NODE_OPTIONS, where Node rejects it.
try { process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const live = process.argv.includes('--live');
const needle = installedNeedle();
const rlcd = installedRlcd();
const host = process.env.DEMO_HOST ?? '127.0.0.1';
// Tailscale Serve needs a loopback upstream on macOS; keep the public Host
// allowlist separate so existing tailnet URLs continue to pass validation.
const bindHost = process.env.DEMO_BIND_HOST ?? host;
if (bindHost !== host && bindHost !== '127.0.0.1') throw new Error('DEMO_BIND_HOST must be the configured host or 127.0.0.1.');
const octets = host.split('.').map(Number);
const hostname = process.env.DEMO_HOSTNAME;
if (hostname && !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9]+\.ts\.net$/.test(hostname)) {
  throw new Error('DEMO_HOSTNAME must be this machine’s full Tailscale MagicDNS hostname, without scheme or port.');
}
if (!isIPv4(host) || !(host === '127.0.0.1' || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127))) {
  throw new Error('DEMO_HOST must be 127.0.0.1 or this machine’s Tailscale IPv4 address.');
}
if (live && !process.env.CEREBRAS_API_KEY && !process.env.TYPESAFE_API_KEY && !process.env.JEV_KEY && !needle && !rlcd) {
  throw new Error('Live demos require a cloud key in .env or an installed local model.');
}
const child = spawn(process.execPath, [fileURLToPath(import.meta.resolve('next/dist/bin/next')), process.argv[2] ?? 'dev', '--hostname', bindHost, '--port', '3001'], {
  stdio: 'inherit', env: { ...process.env, DEMO_HOST: host, DEMO_MODE: live ? 'live' : 'fixture',
    ...(needle ? { NEEDLE_BINARY: needle.executable, NEEDLE_WEIGHTS: needle.weights } : {}),
    ...(rlcd ? { RLCD_PYTHON: rlcd.python, RLCD_WORKER: rlcd.worker,
      RLCD_SOURCE: rlcd.source, RLCD_WEIGHTS: rlcd.weights } : {}) },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 1; });
