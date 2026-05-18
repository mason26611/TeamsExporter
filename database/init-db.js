import fs from 'node:fs';
import path from 'node:path';
import chalk from "chalk";
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { Logger } from '../modules/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDbPath = path.join(__dirname, 'database.db');
const initSqlPath = path.join(__dirname, 'init.sql');

function parseArgs(argv) {
    let dbPath = defaultDbPath;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            help = true;
        } else if (arg === '--db') {
            dbPath = path.resolve(argv[++i]);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return { dbPath, help };
}

function printHelp() {
    console.log(`Usage: npm run init-db -- [options]

Options:
  --db <path>    SQLite database path. Default: database/database.db
  --help         Show this help text
`);
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printHelp();
        return;
    }

    if (!fs.existsSync(initSqlPath)) {
        throw new Error('SQL initialization file not found.');
    }

    fs.mkdirSync(path.dirname(options.dbPath), { recursive: true });

    if (fs.existsSync(options.dbPath)) {
        Logger.warning('Database already exists. Please remove it before initializing a new one.');
        return;
    }

    const database = new Database(options.dbPath);
    database.pragma('foreign_keys = ON');

    const initSql = fs.readFileSync(initSqlPath, 'utf8');
    database.exec(initSql);
    database.close();

    console.log(chalk.green(`Database initialized successfully at ${options.dbPath}`));
    console.log(chalk.yellow(`Run 'npm run strip-db' after exporting to strip the database of unnecessary data`));
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
