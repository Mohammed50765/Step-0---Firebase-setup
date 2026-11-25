import fs from 'node:fs';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

const html = fs.readFileSync('index.html', 'utf8');
const scriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

let inlineChecked = 0;
for (let i = 0; i < scriptMatches.length; i++) {
  const attrs = scriptMatches[i][1] || '';
  const code = (scriptMatches[i][2] || '').trim();
  if (/\bsrc\s*=/.test(attrs) || !code) continue;
  inlineChecked++;
  try {
    new vm.Script(code, { filename: `index.html#script-${inlineChecked}` });
  } catch (err) {
    console.error(`Syntax error in inline script #${inlineChecked}:`, err);
    process.exit(1);
  }
}

if (inlineChecked === 0) {
  console.error('No inline <script> blocks found in index.html');
  process.exit(1);
}

JSON.parse(fs.readFileSync('metadata.json', 'utf8'));
JSON.parse(fs.readFileSync('firebase-blueprint.json', 'utf8'));

if (fs.existsSync('firestore.rules')) {
  execSync('npx eslint firestore.rules', { stdio: 'inherit' });
}

console.log(`Lint passed: verified ${inlineChecked} inline script(s), metadata.json, firebase-blueprint.json, and firestore.rules.`);
