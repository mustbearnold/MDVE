import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

rmSync(join(process.cwd(), 'dist/server'), { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.server.json'], { stdio: 'inherit' });
