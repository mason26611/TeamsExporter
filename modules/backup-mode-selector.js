import chalk from 'chalk';
import readline from 'node:readline';

const modes = [
    {
        description: 'Use saved sync-state per chat; if missing, fall back to full history.',
        key: 'resume',
        label: 'Resume (recommended)',
    },
    {
        description: 'Use saved sync-state per chat; skip chats without one.',
        key: 'backup-new',
        label: 'Backup New',
    },
    {
        description: 'Start at newest page and stop when first saved message is reached.',
        key: 'backup-recent',
        label: 'Backup Recent',
    },
    {
        description: 'Re-run a full historical export from newest to oldest.',
        key: 'fresh',
        label: 'Fresh',
    },
];

function enableRawInput() {
    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
}

function disableRawInput() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
}

export async function selectBackupMode() {
    let cursor = 0;
    enableRawInput();

    function render() {
        console.clear();
        console.log(chalk.bold.cyan('Choose backup mode'));
        console.log(chalk.dim('Up/Down move | Enter confirm | Ctrl+C exit\n'));

        for (let i = 0; i < modes.length; i++) {
            const mode = modes[i];
            const pointer = i === cursor ? chalk.cyan('>') : ' ';
            console.log(`${pointer} ${chalk.white(mode.label)}`);
            console.log(`  ${chalk.dim(mode.description)}`);
        }
    }

    return new Promise((resolve) => {
        function onKeypress(_str, key) {
            if (key.ctrl && key.name === 'c') {
                disableRawInput();
                process.exit();
            }

            if (key.name === 'up') {
                cursor = Math.max(0, cursor - 1);
                render();
            }

            if (key.name === 'down') {
                cursor = Math.min(modes.length - 1, cursor + 1);
                render();
            }

            if (key.name === 'return') {
                process.stdin.off('keypress', onKeypress);
                disableRawInput();
                console.clear();
                resolve(modes[cursor].key);
            }
        }

        render();
        process.stdin.on('keypress', onKeypress);
    });
}
