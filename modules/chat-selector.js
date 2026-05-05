import chalk from 'chalk';
import readline from 'node:readline';

/**
 * Converts raw Teams chat/profile objects into selector-friendly rows.
 *
 * @param {Array<object>} combinedChats - Direct-message profiles and group chats.
 * @returns {Array<object>} Normalized selector rows.
 */
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

/**
 * Enables raw keyboard input when the terminal supports it.
 * This allows the app to receive keypress events from the terminal without waiting for the user to press enter.
 *
 * @returns {void}
 */
function enableRawInput() {
    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }
}

/**
 * Restores normal keyboard input when the terminal supports it.
 *
 * @returns {void}
 */
function disableRawInput() {
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
    }
}

/**
 * Shows the interactive bubble selector and resolves with chosen chats.
 *
 * @param {Array<object>} combinedChats - Direct-message profiles and group chat objects.
 * @param {number} [pageSize=10] - Number of chats to show per page.
 * @returns {Promise<Array<object>>} Selected chat objects.
 */
export async function selectChats(combinedChats, pageSize = 10) {
    const processedChats = normalizeSelectableChats(combinedChats);
    let cursor = 0;
    let page = 0;
    const selected = new Set();
    const totalPages = Math.max(1, Math.ceil(processedChats.length / pageSize));

    enableRawInput();

    /**
     * Returns chats visible on the current selector page.
     *
     * @returns {Array<object>} Page chat rows with global indexes.
     */
    function getPageItems() {
        const start = page * pageSize;
        const end = start + pageSize;

        return processedChats.slice(start, end).map((chat, offset) => ({
            ...chat,
            index: start + offset,
        }));
    }

    /**
     * Renders the current selector page.
     *
     * @returns {void}
     */
    function render() {
        console.clear();
        console.log(chalk.bold.cyan('Select chats'));
        console.log(chalk.dim('Up/Down move | Space select | Left/Right page | Enter confirm | Ctrl+C exit'));
        console.log(`${chalk.blue('Page')} ${page + 1}/${totalPages} | ${chalk.green('Selected')} ${selected.size}\n`);

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
    }

    return new Promise((resolve) => {
        /**
         * Handles a single keypress in the selector.
         *
         * @param {string} _str - Raw key string.
         * @param {{ctrl?: boolean, name?: string}} key - Parsed key information.
         * @returns {void}
         */
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
                }

                render();
            }

            if (key.name === 'return') {
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
