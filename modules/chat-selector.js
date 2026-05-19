import chalk from 'chalk';
import readline from 'node:readline';

function normalizeSelectableChats(combinedChats) {
    const processedChats = [];

    for (const chat of combinedChats) {
        const name = chat.displayName ?? chat.title;

        if (!name || !chat.id) {
            continue;
        }

        processedChats.push({
            ...chat,
            estimatedTotalMessages: chat.estimatedTotalMessages ?? chat.lastMessage?.sequenceId ?? null,
            name,
        });
    }

    return processedChats.sort((a, b) => a.name.localeCompare(b.name));
}

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

export async function selectChats(combinedChats, pageSize = 10) {
    const processedChats = normalizeSelectableChats(combinedChats);
    let cursor = 0;
    let page = 0;
    let errorMessage = '';
    const selected = new Set();
    const totalPages = Math.max(1, Math.ceil(processedChats.length / pageSize));

    enableRawInput();

    function getPageItems() {
        const start = page * pageSize;
        const end = start + pageSize;

        return processedChats.slice(start, end).map((chat, offset) => ({
            ...chat,
            index: start + offset,
        }));
    }

    function render() {
        console.clear();
        console.log(chalk.bold.cyan('Select chats'));
        console.log(chalk.dim('Up/Down move | Space select | A select all | Left/Right page | Enter confirm | Ctrl+C exit'));
        console.log(`${chalk.blue('Page')} ${page + 1}/${totalPages} | ${chalk.green('Selected')} ${selected.size}/${processedChats.length}`);

        const pageItems = getPageItems();

        if (pageItems.length === 0) {
            console.log(chalk.yellow('No chats were found.'));
            return;
        }

        for (let i = 0; i < pageItems.length; i++) {
            const chat = pageItems[i];
            const pointer = i === cursor ? chalk.cyan('>') : ' ';
            const bubble = selected.has(chat.index) ? chalk.green('●') : chalk.dim('○');
            const estimate = chat.estimatedTotalMessages ? chalk.dim(` ~${chat.estimatedTotalMessages} msgs`) : '';

            console.log(`${pointer} ${bubble} ${chat.name}${estimate}`);
        }

        if (errorMessage) {
            console.log(`\n${chalk.red(errorMessage)}`);
        }
    }

    return new Promise((resolve) => {
        function onKeypress(_str, key) {
            if (key.ctrl && key.name === 'c') {
                disableRawInput();
                process.exit();
            }

            const pageItems = getPageItems();

            if (key.name === 'up') {
                cursor = Math.max(0, cursor - 1);
                render();
            }

            if (key.name === 'down') {
                cursor = Math.min(pageItems.length - 1, cursor + 1);
                render();
            }

            if (key.name === 'left') {
                page = Math.max(0, page - 1);
                cursor = 0;
                render();
            }

            if (key.name === 'right') {
                page = Math.min(totalPages - 1, page + 1);
                cursor = 0;
                render();
            }

            if (key.name === 'space') {
                const selectedIndex = pageItems[cursor]?.index;

                if (selectedIndex !== undefined) {
                    if (selected.has(selectedIndex)) {
                        selected.delete(selectedIndex);
                    } else {
                        selected.add(selectedIndex);
                    }

                    errorMessage = '';
                }

                render();
            }

            if (key.name === 'a') {
                for (let i = 0; i < processedChats.length; i++) {
                    selected.add(i);
                }

                errorMessage = '';
                render();
            }

            if (key.name === 'return') {
                if (selected.size === 0) {
                    errorMessage = 'Select at least one chat before continuing.';
                    render();
                    return;
                }

                process.stdin.off('keypress', onKeypress);
                disableRawInput();
                console.clear();

                resolve([...selected].map((index) => processedChats[index]));
            }
        }

        render();
        process.stdin.on('keypress', onKeypress);
    });
}
