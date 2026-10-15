import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const code = await new Promise((resolve) => build.on('exit', resolve));
if (code !== 0) process.exit(Number(code) || 1);
const port = process.env.PROTOTYPE_PORT || '8878';
console.log(`\nUI prototype: http://127.0.0.1:${port}/tests/game.html?uiPrototype&variant=A\n`);
const server = spawn('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
});
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
server.on('exit', (status) => process.exit(status || 0));
