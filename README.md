# Teams Exporter

A terminal application for exporting Microsoft Teams chats and channel messages into a local SQLite database. It can also download Teams-hosted media referenced by exported messages.

## Requirements

- Node.js 18 or newer
- npm
- Access to the Microsoft Teams account you want to export

The app uses Playwright to open Teams in a browser, capture the authenticated Teams API requests, and save a reusable browser session in `teams-state.json`.

## Install

```sh
npm install
```

If Playwright cannot find a browser when you start the exporter, install one manually:

```sh
npx playwright install chromium
```

## Initialize The Database

Create the default SQLite database at `database/database.db`:

```sh
npm run init-db
```

To use a different path:

```sh
npm run init-db -- --db path/to/teams.db
```

The init command will not overwrite an existing database.

## Export Teams Messages

Start the interactive exporter:

```sh
npm run start
```

On the first run, a browser opens to Teams. Sign in and let Teams finish loading. After the app captures the required auth tokens, it saves the browser session to `teams-state.json` so later runs can reuse it.

The exporter then prompts you to:

1. Select chats or channels with the keyboard.
2. Choose a backup mode.
3. Choose whether to download media while exporting.

Chat selector controls:

- `Up` / `Down`: move the cursor
- `Space`: select or deselect a chat
- `A`: select all chats
- `Left` / `Right`: change pages
- `Enter`: confirm
- `Ctrl+C`: exit

Backup modes:

- `Resume (recommended)`: use saved sync state when available, otherwise run a full historical export.
- `Backup New`: use saved sync state only and skip chats that do not have one yet.
- `Backup Recent`: start from the newest messages and stop when an already-saved message is reached.
- `Fresh`: re-run a full historical export from newest to oldest.

## Common Options

Pass exporter options after `--`:

```sh
npm run start -- --db database/database.db --media-dir media --page-size 20
```

Available options:

- `--db <path>`: SQLite database path. Default: `database/database.db`.
- `--storage-state <path>`: Playwright storage state path. Default: `teams-state.json`.
- `--download-media`: default the media prompt to Yes.
- `--no-download-media`: default the media prompt to No.
- `--media-dir <path>`: media output directory. Default: `media` or `TEAMS_MEDIA_DIR`.
- `--media-concurrency <n>`: simultaneous media downloads. Default: `4`.
- `--page-size <number>`: chat selector page size. Default: `10`.
- `--help`: show CLI help.

## Download Media Later

If you exported messages without media, scan the database and download media later:

```sh
npm run download-media
```

Useful options:

```sh
npm run download-media -- --db database/database.db --media-dir media --media-concurrency 4
```

- `--db <path>`: SQLite database path.
- `--storage-state <path>`: Playwright storage state path.
- `--media-dir <path>`: media output directory.
- `--media-concurrency <n>`: simultaneous media downloads.
- `--limit <number>`: scan only the first N messages.

## Strip Raw Payloads

The database stores compressed raw Teams payloads in `raw_zlib` columns. To create a smaller copy with those raw payloads removed:

```sh
npm run strip-db
```

By default this reads `database/database.db` and writes `database/database-stripped.db`.

Custom paths:

```sh
npm run strip-db -- --input database/database.db --output database/database-stripped.db
```

## Environment Variables

You can create a local `.env` file for defaults:

```env
TEAMS_DOWNLOAD_MEDIA=true
TEAMS_MEDIA_DIR=media
PLAYWRIGHT_BROWSER=chromium
PLAYWRIGHT_HEADLESS=false
```

Supported variables:

- `TEAMS_DOWNLOAD_MEDIA`: `1`, `true`, `yes`, or `on` enables media downloads by default.
- `TEAMS_MEDIA_DIR`: default media output directory.
- `PLAYWRIGHT_BROWSER`: `chromium`, `firefox`, or `webkit`.
- `PLAYWRIGHT_CHANNEL`: Chromium channel, such as `chrome` or `msedge`.
- `PLAYWRIGHT_HEADLESS`: run the browser headlessly when set to a truthy value.

## Output Files

Generated files are ignored by git:

- `database/*.db`: SQLite export databases.
- `media/`: downloaded media files.
- `teams-state.json`: saved browser session.
- `.env`: local environment settings.

Keep `teams-state.json`, `.env`, and exported databases private. They may contain account/session data or exported Teams content.
