import { execFileSync } from 'node:child_process';

const output = execFileSync(
  'npm',
  ['ls', '--omit=dev', '--all', '--json', '--long', '--loglevel=error'],
  { encoding: 'utf8' },
);
const tree = JSON.parse(output);
const packages = new Map();

function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.name && node.version) packages.set(`${node.name}@${node.version}`, node);
  for (const dependency of Object.values(node.dependencies ?? {})) visit(dependency);
}

visit(tree);
const missing = [...packages.values()]
  .filter((pkg) => !pkg.license || String(pkg.license).trim().toLowerCase() === 'unknown')
  .map((pkg) => `${pkg.name}@${pkg.version}`)
  .sort();

if (missing.length > 0) {
  throw new Error(`Production dependencies with missing or unknown licenses: ${missing.join(', ')}`);
}

const licenses = {};
for (const pkg of packages.values()) {
  const license = String(pkg.license).trim();
  licenses[license] = (licenses[license] ?? 0) + 1;
}

console.log(JSON.stringify({ packages: packages.size, licenses }, null, 2));
