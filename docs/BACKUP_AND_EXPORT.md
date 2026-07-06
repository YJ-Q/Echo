# Echo Backup And Export

Echo now supports local backup and export tooling for the backend data store.

## What Gets Exported

JSON export includes:

- `conversations`
- `user_states`
- `user_profile`
- `learning_sessions`
- `learning_events`
- `actions`
- `summaries`

SQLite backup includes:

- a full `.sqlite` database snapshot created through SQLite `VACUUM INTO`

## Commands

Create both JSON export and SQLite backup:

```bash
npm run backup
```

Create JSON export only:

```bash
npm run export:data
```

Write files into a custom directory:

```bash
node scripts/backup-data.js --format=both --out-dir=./data/manual-backups
```

Import a JSON snapshot into the current Echo database:

```bash
npm run import:data -- --file=./data/exports/echo-export-2026-07-06T12-42-59-025Z.json
```

Preview an import without writing:

```bash
npm run import:data -- --file=./data/exports/echo-export.json --dry-run
```

Replace the target database contents with a snapshot:

```bash
npm run import:data -- --file=./data/exports/echo-export.json --mode=replace
```

## Output

Default locations:

- JSON export: `data/exports/`
- SQLite backup: `data/backups/`

The script prints a JSON summary with:

- creation time
- output file paths
- table counts for JSON exports
- backup size for SQLite snapshots

## Notes

- if `ECHO_DB_PATH` is set, backup/export follows that database path
- the script fails fast when no database file exists
- JSON export is easier to inspect and migrate
- SQLite backup is better for full local restore
- import currently supports JSON snapshots
- `merge` mode uses upsert-style restore and is the safer default
- `replace` mode clears current Echo tables before restoring the snapshot
