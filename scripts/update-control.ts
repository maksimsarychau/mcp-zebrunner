import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--') && i + 1 < args.length) {
      const key = arg.slice(2);
      result[key] = args[++i];
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const privateKeyPath = path.join(PROJECT_ROOT, 'private.pem');
  if (!fs.existsSync(privateKeyPath)) {
    console.error('ERROR: private.pem not found in project root.');
    console.error('Generate a key pair first:');
    console.error('  openssl genrsa -out private.pem 4096');
    process.exit(1);
  }

  // Read current version from package.json for defaults
  const pkgPath = path.join(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version || '0.0.0';

  const status = args['status'] || 'active';
  const minVersion = args['min-version'] || currentVersion;
  const message = args['message'] || '';

  if (!['active', 'disabled', 'maintenance'].includes(status)) {
    console.error('ERROR: --status must be one of: active, disabled, maintenance');
    process.exit(1);
  }

  console.log('Updating .mcp-status control file...\n');
  console.log(`  Status:      ${status}`);
  console.log(`  Min version: ${minVersion}`);
  console.log(`  Message:     ${message || '(none)'}`);

  const payload = {
    status,
    minVersion,
    message,
    updatedAt: new Date().toISOString(),
  };

  const payloadStr = JSON.stringify(payload);
  const privateKey = fs.readFileSync(privateKeyPath);
  const signer = crypto.createSign('SHA256');
  signer.update(Buffer.from(payloadStr));
  const signature = signer.sign(privateKey).toString('base64');

  const controlFile = {
    payload,
    signature,
  };

  const controlPath = path.join(PROJECT_ROOT, '.mcp-status');
  fs.writeFileSync(controlPath, JSON.stringify(controlFile, null, 2) + '\n');
  console.log(`\nWrote .mcp-status`);

  console.log('\nNext steps:');
  console.log('  git add .mcp-status && git commit -m "chore: update control" && git push');
}

main().catch((err) => {
  console.error('Update-control failed:', err.message);
  process.exit(1);
});
