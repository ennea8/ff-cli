#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read package.json version
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Read cli.ts file
const cliPath = path.join(__dirname, '../cli/src/cli.ts');
const cliContent = fs.readFileSync(cliPath, 'utf8');

// Replace version in cli.ts
const updatedContent = cliContent.replace(
  /\.version\(['"`][\d.]+['"`]\)/,
  `.version('${version}')`
);

// Write back to cli.ts
fs.writeFileSync(cliPath, updatedContent, 'utf8');

console.log(`✅ CLI version synced to ${version}`);
