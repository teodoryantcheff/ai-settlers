import { spawn } from 'node:child_process';
const root = new URL('..', import.meta.url).pathname;
const build = spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
const code = await new Promise((resolve) => build.on('exit', resolve));
if (code !== 0) process.exit(Number(code) || 1);
const port = process.env.PROTOTYPE_PORT || '8879';
console.log(
  `Graphics prototype: http://127.0.0.1:${port}/tests/game.html?uitest&graphicsPrototype&round=2&variant=D`,
);
const server = spawn('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'inherit',
});
process.on('SIGINT', () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
