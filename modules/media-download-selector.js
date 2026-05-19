import chalk from 'chalk';
import readline from 'node:readline';

const options = [
    {
        description: 'Save attachments and images to disk while exporting messages.',
        key: true,
        label: 'Yes',
    },
    {
        description: 'Export messages only. Use npm run download-media later to fetch media.',
        key: false,
        label: 'No',
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

/**
 * Prompts for whether media should be downloaded during export.
 *
 * @param {boolean} defaultValue - Initial highlighted option.
 * @returns {Promise<boolean>} Whether media downloads are enabled.
 */
export async function selectMediaDownload(defaultValue = true) {
    const defaultIndex = Math.max(0, options.findIndex((option) => option.key === defaultValue));
    let cursor = defaultIndex;
    enableRawInput();

    function render() {
        console.clear();
        console.log(chalk.bold.cyan('Download media while exporting?'));
        console.log(chalk.dim('Up/Down move | Enter confirm | Ctrl+C exit\n'));

        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            const pointer = i === cursor ? chalk.cyan('>') : ' ';
            console.log(`${pointer} ${chalk.white(option.label)}`);
            console.log(`  ${chalk.dim(option.description)}`);
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
                cursor = Math.min(options.length - 1, cursor + 1);
                render();
            }

            if (key.name === 'return') {
                process.stdin.off('keypress', onKeypress);
                disableRawInput();
                console.clear();
                resolve(options[cursor].key);
            }
        }

        render();
        process.stdin.on('keypress', onKeypress);
    });
}
