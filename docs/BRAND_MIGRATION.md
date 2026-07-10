# Echo To Margin Compatibility Notes

Margin is the only current product name.

The following legacy identifiers remain temporarily because changing them without a data migration could break existing installations or stored records:

- `ECHO_DB_PATH`, `ECHO_LLM_PROVIDER`, and `ECHO_LOG_LEVEL`
- the default local database filename `data/echo.sqlite`
- persisted fields such as `echo_response` and `echo_reflection`
- internal modules such as `echoStateEngine.js` and `echoAgent.js`

Preferred configuration now uses:

- `MARGIN_DB_PATH`
- `MARGIN_LLM_PROVIDER`
- `MARGIN_LOG_LEVEL`

New user-facing text, logs, package metadata, backups, desktop bridges, and documentation must use Margin. A future schema migration may rename persisted identifiers only after backup, migration, rollback, and compatibility tests exist.
