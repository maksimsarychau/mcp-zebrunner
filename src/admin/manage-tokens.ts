#!/usr/bin/env node
/**
 * Admin CLI for managing the encrypted per-user token store.
 *
 * Usage:
 *   TOKEN_STORE_PATH=./data/tokens.enc TOKEN_STORE_KEY=<secret> \
 *     npx tsx src/admin/manage-tokens.ts <command> [args]
 *
 * Commands:
 *   list                  List all stored user emails
 *   delete <email>        Delete a single user's stored credentials
 *   delete-all            Delete ALL stored credentials (wipes the store)
 *
 * Inside Docker:
 *   docker exec <container> node dist/admin/manage-tokens.js list
 *   docker exec <container> node dist/admin/manage-tokens.js delete user@example.com
 */

import { FileTokenStore } from '../http/token-store.js';

const USAGE = `
Usage: manage-tokens <command> [args]

Commands:
  list                  List all stored user emails
  delete <email>        Delete a single user's stored credentials
  delete-all            Delete ALL stored credentials

Environment variables (required):
  TOKEN_STORE_PATH      Path to the encrypted token store file
  TOKEN_STORE_KEY       Encryption key for the store
`.trim();

function fatal(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function getStore(): FileTokenStore {
  const path = process.env.TOKEN_STORE_PATH;
  const key = process.env.TOKEN_STORE_KEY;
  if (!path) fatal('TOKEN_STORE_PATH is not set');
  if (!key) fatal('TOKEN_STORE_KEY is not set');
  return new FileTokenStore(path!, key!);
}

async function listUsers(store: FileTokenStore): Promise<void> {
  const emails = await store.list();
  if (emails.length === 0) {
    console.log('Token store is empty — no users registered.');
    return;
  }
  console.log(`Stored credentials (${emails.length} user${emails.length > 1 ? 's' : ''}):\n`);
  for (const email of emails.sort()) {
    console.log(`  ${email}`);
  }
}

async function deleteUser(store: FileTokenStore, email: string): Promise<void> {
  const deleted = await store.delete(email);
  if (deleted) {
    console.log(`Deleted credentials for: ${email}`);
    console.log('The user will be prompted to re-authenticate on next MCP connection.');
  } else {
    console.log(`No credentials found for: ${email}`);
    const all = await store.list();
    if (all.length > 0) {
      console.log(`\nStored emails: ${all.sort().join(', ')}`);
    }
  }
}

async function deleteAll(store: FileTokenStore): Promise<void> {
  const emails = await store.list();
  if (emails.length === 0) {
    console.log('Token store is already empty.');
    return;
  }
  for (const email of emails) {
    await store.delete(email);
  }
  console.log(`Deleted credentials for ${emails.length} user${emails.length > 1 ? 's' : ''}.`);
  console.log('All users will be prompted to re-authenticate on next MCP connection.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const store = getStore();

  switch (command) {
    case 'list':
      await listUsers(store);
      break;

    case 'delete': {
      const email = args[1];
      if (!email) fatal('Usage: manage-tokens delete <email>');
      await deleteUser(store, email);
      break;
    }

    case 'delete-all':
      await deleteAll(store);
      break;

    default:
      fatal(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message ?? err);
  process.exit(1);
});
