# Quiet Workbench

Quiet Workbench is a local-first Obsidian plugin for managing projects, tasks,
clients, suppliers, meetings, and knowledge without moving business data out of
Markdown files.

## Safety model

- The first launch is read-only.
- Business writes must be enabled explicitly in settings.
- Multi-file changes use preflight checks, receipts, and compensating restore.
- The plugin has no telemetry, accounts, network calls, or self-updater.

## Local installation

Run `pnpm install && pnpm verify`, then copy `main.js`, `manifest.json`, and
`styles.css` into `<vault>/.obsidian/plugins/quiet-workbench/`.

## Development

Use a separate test vault containing only fictitious data. Node.js 22 LTS and
pnpm are the supported development toolchain.
