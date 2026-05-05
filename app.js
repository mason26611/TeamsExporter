import path from 'node:path';
import chalk from 'chalk';
import { selectBackupMode } from './modules/backup-mode-selector.js';
import { selectChats } from './modules/chat-selector.js';
import { defaultDbPath, defaultStorageStatePath } from './modules/config.js';
import { openTeamsDatabase } from './modules/database.js';
import { exportSelectedChats } from './modules/exporter.js';
import { captureTeamsAuth } from './modules/teams-auth.js';
import { createTeamsApi, getGroupChats } from './modules/teams-api.js';
import { Logger } from './modules/logger.js';

/**
 * Parses command line arguments for the exporter.
 *
 * @param {string[]} argv - Command line arguments after the Node executable and script path.
 * @returns {{dbPath: string, help: boolean, pageSize: number, storageStatePath: string}} Parsed options.
 */
function parseArgs(argv) {
    const options = {
        dbPath: defaultDbPath,
        help: false,
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
        } else if (arg === '--page-size') {
            options.pageSize = Number.parseInt(argv[++i], 10);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isInteger(options.pageSize) || options.pageSize < 1) {
        throw new Error('--page-size must be a positive integer.');
    }

    return options;
}

/**
 * Prints CLI usage information.
 *
 * @returns {void}
 */
function printHelp() {
    console.log(`Usage: npm start -- [options]

Options:
  --db <path>               SQLite database path. Default: database/database.db
  --storage-state <path>    Playwright storage state path. Default: teams-state.json
  --page-size <number>      Chat selector page size. Default: 10
  --help                    Show this help text
`);
}

/**
 * Runs the Teams exporter from authentication through selected chat export.
 *
 * @returns {Promise<void>} Resolves when the export finishes.
 */
async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printHelp();
        return;
    }

    Logger.header('Teams Exporter');
    Logger.info(`Database: ${chalk.white(options.dbPath)}`);

    const database = openTeamsDatabase(options.dbPath);

    try {
        const auth = await captureTeamsAuth({
            storageStatePath: options.storageStatePath,
            onStatus: Logger.info,
        });
        const api = createTeamsApi(auth);

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
            mode,
            selectedChats,
        });

        Logger.success('Export complete.');
    } finally {
        database.close();
    }
}

main().catch((error) => {
    Logger.error(error);
    process.exitCode = 1;
});
