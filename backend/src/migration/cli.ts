import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { migrateFromKanboard } from './migrate.js';

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        args[key] = 'true';
      } else {
        args[key] = value;
        i++;
      }
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.source || args.help) {
  console.log(`
Usage: npm run migrate:kanboard --workspace backend -- --source <path-to-kanboard-db.sqlite> [--app-url <url>]

Runs a one-time, read-only export/import from a Kanboard SQLite database
into this KanLite instance's own database (DATA_DIR env var, or ./data).

Stop the KanLite dev server first -- this writes directly to the same
SQLite file it uses. The source file is opened read-only and is never
modified (see design doc, Migration: "keep the old Kanboard container and
its data around, stopped but intact").
`);
  process.exit(args.help ? 0 : 1);
}

const sourcePath = path.resolve(args.source);
if (!fs.existsSync(sourcePath)) {
  console.error(`Source database not found: ${sourcePath}`);
  process.exit(1);
}

const appUrl = args['app-url'] ?? config.appUrl;

getDb(); // ensure the destination schema exists before migrating into it
const report = migrateFromKanboard(sourcePath, appUrl);

console.log('\n=== Boards ===');
for (const b of report.boards) {
  console.log(
    `  ${b.name}${b.archived ? ' (archived)' : ''} -- ${b.cardCount} card(s), ${b.columnCount} column(s) -- needs Backlog/Done assigned in Board Settings`,
  );
}

console.log('\n=== Users (fresh invite links -- no password carried over) ===');
for (const u of report.users) {
  console.log(`  ${u.username} <${u.email}>\n    ${u.inviteLink}`);
}

if (report.usernameCollisions.length > 0) {
  console.log('\n=== Username collisions (renamed to avoid clashing with an existing KanLite account) ===');
  for (const c of report.usernameCollisions) {
    console.log(`  "${c.original}" -> "${c.renamedTo}"`);
  }
}

if (report.warnings.length > 0) {
  console.log('\n=== Warnings ===');
  for (const w of report.warnings) {
    console.log(`  - ${w}`);
  }
}

const reportPath = path.join(config.dataDir, `migration-report-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\nFull report written to ${reportPath}`);
console.log(
  '\nEach migrated board needs a Backlog and Done column chosen in its Board Settings before recurrence/notifications activate.',
);
