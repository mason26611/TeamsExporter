import path from 'node:path';
import chalk from 'chalk';
import { selectBackupMode } from './modules/backup-mode-selector.js';
import { selectChats } from './modules/chat-selector.js';
import { defaultDbPath, defaultMediaDir, defaultStorageStatePath, downloadMediaByDefault } from './modules/config.js';
import { openTeamsDatabase } from './modules/database.js';
import { exportSelectedChats } from './modules/exporter.js';
import { captureTeamsAuth } from './modules/teams-auth.js';
import { createTeamsApi, getGroupChats } from './modules/teams-api.js';
import { Logger } from './modules/logger.js';

/**
 * Parses command line arguments for the exporter.
 *
 * @param {string[]} argv - Command line arguments after the Node executable and script path.
 * @returns {{dbPath: string, downloadMedia: boolean, help: boolean, mediaConcurrency: number, mediaDir: string, pageSize: number, storageStatePath: string}} Parsed options.
 */
function parseArgs(argv) {
    const options = {
        dbPath: defaultDbPath,
        downloadMedia: downloadMediaByDefault,
        help: false,
        mediaConcurrency: 4,
        mediaDir: defaultMediaDir,
        pageSize: 10,
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
        } else if (arg === '--download-media') {
            options.downloadMedia = true;
        } else if (arg === '--no-download-media') {
            options.downloadMedia = false;
        } else if (arg === '--media-dir') {
            options.mediaDir = path.resolve(argv[++i]);
        } else if (arg === '--media-concurrency') {
            options.mediaConcurrency = Number.parseInt(argv[++i], 10);
        } else if (arg === '--page-size') {
            options.pageSize = Number.parseInt(argv[++i], 10);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isInteger(options.pageSize) || options.pageSize < 1) {
        throw new Error('--page-size must be a positive integer.');
    }

    if (!Number.isInteger(options.mediaConcurrency) || options.mediaConcurrency < 1) {
        throw new Error('--media-concurrency must be a positive integer.');
    }

    return options;
}

function printHelp() {
    console.log(`Usage: npm start -- [options]

Options:
  --db <path>               SQLite database path. Default: database/database.db
  --storage-state <path>    Playwright storage state path. Default: teams-state.json
  --download-media          Download Teams-hosted media while exporting
  --no-download-media       Disable media downloads even when TEAMS_DOWNLOAD_MEDIA=true
  --media-dir <path>        Media output directory. Default: media or TEAMS_MEDIA_DIR
  --media-concurrency <n>   Simultaneous media downloads. Default: 4
  --page-size <number>      Chat selector page size. Default: 10
  --help                    Show this help text
`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printHelp();
        return;
    }

    Logger.header('Teams Exporter');
    Logger.info(`Database: ${chalk.white(options.dbPath)}`);
    Logger.info(`Media downloads: ${chalk.white(options.downloadMedia ? `enabled (${options.mediaDir})` : 'disabled')}`);

    const database = openTeamsDatabase(options.dbPath);
    let api = null;

    try {
        const auth = await captureTeamsAuth({
            storageStatePath: options.storageStatePath,
            onStatus: Logger.info,
        });
        api = createTeamsApi(auth);

        Logger.info('Loading chat list from Teams...');
        const meData = await api.getMe();
        const directMessageUsers = await api.getDirectMessageUsers(meData.chats ?? []);
        const groupChats = getGroupChats(meData.chats ?? []);
        const combinedChats = [...directMessageUsers.value, ...groupChats];

        const selectedChats = await selectChats(combinedChats, options.pageSize);

        if (selectedChats.length === 0) {
            Logger.warning('No chats selected. Nothing to export.');
            return;
        }

        const mode = await selectBackupMode();
        Logger.info(`Mode: ${chalk.white(mode)}`);

        await exportSelectedChats({
            api,
            database,
            downloadMedia: options.downloadMedia,
            mediaConcurrency: options.mediaConcurrency,
            mediaDir: options.mediaDir,
            mode,
            selectedChats,
        });

        Logger.success('Export complete.');
    } finally {
        if (api) {
            await api.close();
        }

        database.close();
    }
}

main().catch((error) => {
    Logger.error(error);
    process.exitCode = 1;
});
