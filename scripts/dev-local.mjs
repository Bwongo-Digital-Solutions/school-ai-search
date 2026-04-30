import { spawn } from 'node:child_process';

const children = [];

const spawnProcess = (label, command, args) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`${label} exited with signal ${signal}`);
    } else if (code !== 0) {
      console.error(`${label} exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
};

const shutdown = (exitCode = 0) => {
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  process.exit(exitCode);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

spawnProcess('backend', 'npm', ['run', 'dev:server']);
spawnProcess('frontend', 'npm', ['run', 'dev:client']);
