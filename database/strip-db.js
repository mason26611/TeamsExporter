import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultInputPath = path.join(__dirname, 'database.db');
const defaultOutputPath = path.join(__dirname, 'database-stripped.db');

const rawTables = [
    'teams',
    'users',
    'channels',
    'channel_members',
    'messages',
    'message_reactions',
];

function parseArgs(argv) {
    let inputPath = defaultInputPath;
    let outputPath = defaultOutputPath;
    let help = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--help' || arg === '-h') {
            help = true;
        } else if (arg === '--input') {
            inputPath = path.resolve(argv[++i]);
        } else if (arg === '--output') {
            outputPath = path.resolve(argv[++i]);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return { help, inputPath, outputPath };
}

function printHelp() {
    console.log(`Usage: npm run strip-db -- [options]

Options:
  --input <path>   Source SQLite database. Default: database/database.db
  --output <path>  Stripped database copy. Default: database/database-stripped.db
  --help           Show this help text
`);
}

function escapeSqlString(value) {
    return String(value).replace(/'/g, "''");
}

function removeIfExists(filePath) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
        fs.rmSync(`${filePath}${suffix}`, { force: true });
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
        printHelp();
        return;
    }

    const inputPath = path.resolve(options.inputPath);
    const outputPath = path.resolve(options.outputPath);

    if (!fs.existsSync(inputPath)) {
        throw new Error(`Source database not found: ${inputPath}`);
    }

    if (inputPath === outputPath) {
        throw new Error('Input and output database paths must be different.');
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    removeIfExists(outputPath);

    const sourceDb = new Database(inputPath, { readonly: true });
    sourceDb.exec(`VACUUM INTO '${escapeSqlString(outputPath)}'`);
    sourceDb.close();

    const strippedDb = new Database(outputPath);
    strippedDb.pragma('foreign_keys = ON');
    strippedDb.exec('BEGIN');

    try {
        for (const table of rawTables) {
            strippedDb.exec(`UPDATE ${table} SET raw_zlib = X''`);
        }

        strippedDb.exec('COMMIT');
    } catch (error) {
        strippedDb.exec('ROLLBACK');
        strippedDb.close();
        throw error;
    }

    strippedDb.exec('VACUUM');
    strippedDb.close();

    console.log(JSON.stringify({
        inputPath,
        outputPath,
        strippedTables: rawTables,
    }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error);
    process.exitCode = 1;
}
