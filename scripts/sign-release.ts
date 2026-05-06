import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function checkUntrackedSourceFiles(): Promise<void> {
  let untrackedRaw: string;
  try {
    untrackedRaw = execSync('git ls-files --others --exclude-standard', {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return;
  }
  if (!untrackedRaw) return;

  // Signing uses `git ls-files` to enumerate files, but Docker (no .git) uses
  // a filesystem walk. Any untracked file that isn't whitelisted would be
  // included by Docker's walk but missed by `git ls-files` → hash mismatch.
  const { isWhitelisted } = await import('../src/stealth-integrity.js');
  const dangerous = untrackedRaw.split('\n').filter(f => f && !isWhitelisted(f));

  if (dangerous.length > 0) {
    console.error('ERROR: Untracked source files would cause integrity mismatch in Docker/npm:\n');
    for (const f of dangerous) {
      console.error(`  ${f}`);
    }
    console.error('\ngit ls-files (used during signing) excludes them, but Docker\'s filesystem');
    console.error('scan includes them — the integrity hash will differ at runtime.\n');
    console.error('Fix: git add <files>   then re-run npm run sign-release\n');
    process.exit(1);
  }
}

async function main() {
  console.log('Signing mcp-zebrunner release...\n');

  const privateKeyPath = path.join(PROJECT_ROOT, 'private.pem');
  if (!fs.existsSync(privateKeyPath)) {
    console.error('ERROR: private.pem not found in project root.');
    console.error('Generate a key pair first:');
    console.error('  openssl genrsa -out private.pem 4096');
    process.exit(1);
  }

  const { getCoreFiles, computeHash } = await import('../src/stealth-integrity.js');

  const privateKey = fs.readFileSync(privateKeyPath);

  // Compute source hash (same file set used everywhere: local, Docker, npm)
  const sourceFiles = await getCoreFiles(PROJECT_ROOT);

  // Safety: abort if untracked files would cause Docker/npm integrity mismatch
  await checkUntrackedSourceFiles();

  const sourceHash = await computeHash(PROJECT_ROOT, sourceFiles);
  console.log(`Source files: ${sourceFiles.length}`);
  console.log(`Source hash:  ${sourceHash.toString('hex').substring(0, 16)}...`);

  // Sign source hash
  const signer = crypto.createSign('SHA256');
  signer.update(sourceHash);
  const signature = signer.sign(privateKey).toString('base64');

  // Write .integrity-signature
  const sigData = {
    version: 2,
    signature,
  };
  const sigPath = path.join(PROJECT_ROOT, '.integrity-signature');
  fs.writeFileSync(sigPath, JSON.stringify(sigData, null, 2) + '\n');
  console.log(`\nWrote .integrity-signature`);

  // Derive and print public key (for first-time setup)
  const publicKey = crypto.createPublicKey(privateKey).export({ format: 'pem', type: 'spki' });
  const publicKeyB64 = Buffer.from(publicKey as string).toString('base64');

  console.log('\n========================================');
  console.log('PUBLIC KEY BASE64 (for stealth-integrity.ts):');
  console.log('========================================');
  console.log(publicKeyB64);
  console.log('========================================\n');

  console.log('Next steps:');
  console.log('1. If first time: copy PUBLIC_KEY_BASE64 above into src/stealth-integrity.ts');
  console.log('   Then: npm run build && npm run sign-release (re-sign with updated source)');
  console.log('2. If already set up: git add .integrity-signature && git commit');
}

main().catch((err) => {
  console.error('Sign-release failed:', err.message);
  process.exit(1);
});
