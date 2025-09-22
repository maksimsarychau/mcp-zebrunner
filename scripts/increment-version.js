#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const packagePath = join(process.cwd(), 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));

const [major, minor, patch] = packageJson.version.split('.');
const newPatch = parseInt(patch, 10) + 1;
const newVersion = `${major}.${minor}.${newPatch}`;

packageJson.version = newVersion;

writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`Version incremented from ${major}.${minor}.${patch} to ${newVersion}`);