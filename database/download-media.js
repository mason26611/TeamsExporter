import path from 'node:path';
import chalk from 'chalk';
import { fileURLToPath } from 'node:url';
import { defaultDbPath, defaultMediaDir, defaultStorageStatePath } from '../modules/config.js';
import { openTeamsDatabase } from '../modules/database.js';
import { downloadMediaForMessages } from '../modules/media.js';
import { Logger } from '../modules/logger.js';
import { createTeamsApi } from '../modules/teams-api.js';
import { captureTeamsAuth } from '../modules/teams-auth.js';
import { gunzipJson } from '../modules/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultScriptDbPath = path.join(__dirname, 'database.db');
const messageBatchSize = 500;

function parseArgs(argv) {
    const options = {
        dbPath: defaultDbPath || defaultScriptDbPath,
        help: false,
        limit: null,
        mediaConcurrency: 4,
        mediaDir: defaultMediaDir,
        storageStatePath: defaultStorageStatePath,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--db') {
            options.dbPath = path.resolve(argv[++i]);
        } else if (arg === '--storage-state') {
            options.storageStatePath = path.resolve(argv[++i]);
        } else if (arg === '--media-dir') {
            options.mediaDir = path.resolve(argv[++i]);
        } else if (arg === '--media-concurrency') {
            options.mediaConcurrency = Number.parseInt(argv[++i], 10);
        } else if (arg === '--limit') {
            options.limit = Number.parseInt(argv[++i], 10);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
        throw new Error('--limit must be a positive integer.');
    }

    if (!Number.isInteger(options.mediaConcurrency) || options.mediaConcurrency < 1) {
        throw new Error('--media-concurrency must be a positive integer.');
    }

    return options;
}

function printHelp() {
    console.log(`Usage: npm run download-media -- [options]

Options:
  --db <path>               SQLite database path. Default: database/database.db
  --storage-state <path>    Playwright storage state path. Default: teams-state.json
  --media-dir <path>        Media output directory. Default: media or TEAMS_MEDIA_DIR
  --media-concurrency <n>   Simultaneous media downloads. Default: 4
  --limit <number>          Scan only the first N messages
  --help                    Show this help text
`);
}

function addTotals(totals, result) {
    totals.discovered += result.discovered;
    totals.downloaded += result.downloaded;
    totals.failed += result.failed;
    totals.skipped += result.skipped;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printHelp();
        return;
    }

    Logger.header('Teams Media Downloader');
    Logger.info(`Database: ${chalk.white(options.dbPath)}`);
    Logger.info(`Media directory: ${chalk.white(options.mediaDir)}`);

    const database = openTeamsDatabase(options.dbPath);

    try {
        const auth = await captureTeamsAuth({
            storageStatePath: options.storageStatePath,
            onStatus: Logger.info,
        });
        const api = createTeamsApi(auth);
        const totals = {
            discovered: 0,
            downloaded: 0,
            failed: 0,
            scanned: 0,
            skipped: 0,
        };

        for (let offset = 0; ; offset += messageBatchSize) {
            const remaining = options.limit === null ? messageBatchSize : options.limit - totals.scanned;

            if (remaining <= 0) {
                break;
            }

            const rows = database.getMessagesForMediaDownloadBatch(
                Math.min(messageBatchSize, remaining),
                offset,
            );

            if (rows.length === 0) {
                break;
            }

            const rowsByConversation = new Map();

            for (const row of rows) {
                const key = row.conversation_id;
                const existing = rowsByConversation.get(key);

                if (existing) {
                    existing.rows.push(row);
                } else {
                    rowsByConversation.set(key, {
                        conversationId: row.conversation_id,
                        conversationName: row.conversation_name,
                        rows: [row],
                    });
                }
            }

            for (const group of rowsByConversation.values()) {
                const messages = group.rows.map((row) => gunzipJson(row.raw_zlib));
                const result = await downloadMediaForMessages({
                    api,
                    concurrency: options.mediaConcurrency,
                    conversationId: group.conversationId,
                    conversationName: group.conversationName,
                    database,
                    mediaDir: options.mediaDir,
                    messages,
                });

                totals.scanned += group.rows.length;
                addTotals(totals, result);

                if (result.downloaded > 0 || result.failed > 0) {
                    Logger.info(
                        `${group.conversationName ?? group.conversationId}: ${result.downloaded} downloaded`
                        + (result.failed > 0 ? `, ${result.failed} failed` : ''),
                    );
                } else if (totals.scanned % 500 === 0) {
                    Logger.info(`Scanned ${totals.scanned} messages...`);
                }
            }

        }

        Logger.success(
            `Scanned ${totals.scanned} messages; found ${totals.discovered} media reference(s), `
            + `downloaded ${totals.downloaded}, skipped ${totals.skipped}, failed ${totals.failed}.`,
        );
    } finally {
        database.close();
    }
}

main().catch((error) => {
    Logger.error(error);
    process.exitCode = 1;
});
