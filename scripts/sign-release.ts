import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  console.log('Signing mcp-zebrunner release...\n');

  const privateKeyPath = path.join(PROJECT_ROOT, 'private.pem');
  if (!fs.existsSync(privateKeyPath)) {
    console.error('ERROR: private.pem not found in project root.');
    console.error('Generate a key pair first:');
    console.error('  openssl genrsa -out private.pem 4096');
    process.exit(1);
  }

  const distDir = path.join(PROJECT_ROOT, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('ERROR: dist/ directory not found.');
    console.error('Run "npm run build" first.');
    process.exit(1);
  }

  const { getCoreFiles, getDistFiles, computeHash } = await import('../src/stealth-integrity.js');

  const privateKey = fs.readFileSync(privateKeyPath);

  // Compute source hash
  const sourceFiles = await getCoreFiles(PROJECT_ROOT);
  const sourceHash = await computeHash(PROJECT_ROOT, sourceFiles);
  console.log(`Source files: ${sourceFiles.length}`);
  console.log(`Source hash:  ${sourceHash.toString('hex').substring(0, 16)}...`);

  // Compute dist hash
  const distFiles = await getDistFiles(PROJECT_ROOT);
  const distHash = await computeHash(PROJECT_ROOT, distFiles);
  console.log(`Dist files:   ${distFiles.length}`);
  console.log(`Dist hash:    ${distHash.toString('hex').substring(0, 16)}...`);

  // Sign both hashes
  const sourceSigner = crypto.createSign('SHA256');
  sourceSigner.update(sourceHash);
  const sourceSignature = sourceSigner.sign(privateKey).toString('base64');

  const distSigner = crypto.createSign('SHA256');
  distSigner.update(distHash);
  const distSignature = distSigner.sign(privateKey).toString('base64');

  // Write .integrity-signature
  const sigData = {
    version: 1,
    source: sourceSignature,
    dist: distSignature,
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
