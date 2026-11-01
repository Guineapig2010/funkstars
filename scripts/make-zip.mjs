// Packages the project (source + built game) into funkstars.zip, excluding node_modules.
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
if (!existsSync('dist/index.html')) execFileSync('npx', ['vite', 'build'], { stdio: 'inherit' });
if (existsSync('funkstars.zip')) rmSync('funkstars.zip');
execFileSync('zip', ['-r', '-q', 'funkstars.zip', '.', '-x', 'node_modules/*', '.git/*', 'e2e-out/*', 'funkstars.zip'], { stdio: 'inherit' });
console.log('wrote funkstars.zip (source + dist/ production build)');
