import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'src');
const modulesDir = path.join(srcDir, 'modules');
const configDir = path.join(srcDir, 'config');
const mainFile = path.join(process.cwd(), 'main.js');

const filesToCheck = [mainFile];

function findFiles(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findFiles(fullPath);
    } else if (fullPath.endsWith('.js')) {
      filesToCheck.push(fullPath);
    }
  }
}

findFiles(srcDir);

let errors = 0;
for (const file of filesToCheck) {
  try {
    execSync(`node --check "${file}"`);
  } catch (e) {
    console.error(`Syntax error in ${file}:\n${e.stderr.toString()}`);
    errors++;
  }
}

if (errors === 0) {
  console.log('All files passed syntax check.');
} else {
  process.exit(1);
}
