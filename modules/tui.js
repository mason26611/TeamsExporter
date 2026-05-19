import chalk from 'chalk';
import readline from 'node:readline';

function buildProgressBar(current, total, width) {
    if (!total || total <= 0) {
        const marker = current % width;
        return `${chalk.dim('[')}${Array.from({ length: width }, (_, index) => (index === marker ? chalk.cyan('>') : chalk.dim('-'))).join('')}${chalk.dim(']')}`;
    }

    const ratio = Math.min(1, current / total);
    const filled = Math.round(ratio * width);
    const empty = width - filled;

    return `${chalk.dim('[')}${chalk.green('='.repeat(filled))}${chalk.dim('-'.repeat(empty))}${chalk.dim(']')}`;
}

function formatCount(current, total) {
    if (!total || total <= 0) {
        return `${current} messages`;
    }

    const percent = Math.min(100, Math.round((current / total) * 100));
    return `${current}/${total} messages (${percent}%)`;
}

function formatGenericCount(current, total, label) {
    if (!total || total <= 0) {
        return `${current} ${label}`;
    }

    const percent = Math.min(100, Math.round((current / total) * 100));
    return `${current}/${total} ${label} (${percent}%)`;
}

export class ProgressTui {
    constructor({ title, totalMessages = null }) {
        this.title = title;
        this.totalMessages = totalMessages;
        this.currentMessages = 0;
        this.chatCount = 0;
        this.chatCurrentMessages = 0;
        this.chatIndex = 0;
        this.chatTotalMessages = null;
        this.currentChat = 'Waiting to start';
        this.currentPageMessages = 0;
        this.mode = 'resume';
        this.notes = [];
        this.started = false;
    }

    start() {
        this.started = true;
        this.render();
    }

    stop() {
        this.render();
        this.started = false;
        console.log('');
    }

    setChat(chatName, mode, chatProgress = {}) {
        this.currentChat = chatName;
        this.currentPageMessages = 0;
        this.mode = mode;
        this.chatCount = chatProgress.chatCount ?? this.chatCount;
        this.chatCurrentMessages = chatProgress.chatCurrentMessages ?? 0;
        this.chatIndex = chatProgress.chatIndex ?? this.chatIndex;
        this.chatTotalMessages = chatProgress.chatTotalMessages ?? null;
        this.render();
    }

    setCurrentMessages(count) {
        this.currentMessages = count;
        this.render();
    }

    incrementMessages(count) {
        this.currentMessages += count;
        this.chatCurrentMessages += count;
        this.currentPageMessages = count;
        this.render();
    }

    addNote(note) {
        this.notes = [note, ...this.notes].slice(0, 4);
        this.render();
    }

    render() {
        if (!this.started && this.currentMessages === 0) {
            return;
        }

        if (process.stdout.isTTY) {
            readline.cursorTo(process.stdout, 0, 0);
            readline.clearScreenDown(process.stdout);
        }

        const totalBar = buildProgressBar(this.currentMessages, this.totalMessages, 32);
        const totalCount = formatCount(this.currentMessages, this.totalMessages);
        const chatBar = buildProgressBar(this.chatCurrentMessages, this.chatTotalMessages, 18);
        const chatCount = formatCount(this.chatCurrentMessages, this.chatTotalMessages);
        const chatPosition = this.chatCount > 0 ? `${this.chatIndex}/${this.chatCount}` : '0/0';

        console.log(chalk.bold.cyan(this.title));
        console.log(`${chalk.blue('Total')} ${totalBar} ${chalk.white(totalCount)}`);
        console.log(`${chalk.blue('Chat')} ${chatPosition} ${chalk.white(this.currentChat)}`);
        console.log(`${chalk.blue('Chat Progress')} ${chatBar} ${chalk.white(chatCount)}`);
        console.log(`${chalk.blue('Mode')} ${this.mode} | ${chalk.blue('Last page')} ${this.currentPageMessages} messages`);

        if (!this.totalMessages) {
            console.log(chalk.yellow('Total message count is not exposed by the messages JSON; using discovered messages.'));
        }

        for (const note of this.notes) {
            console.log(chalk.dim(note));
        }
    }
}

export class MediaProgressTui {
    constructor({ title, totalMessages = null }) {
        this.title = title;
        this.totalMessages = totalMessages;
        this.currentConversation = 'Waiting to start';
        this.discoveredMedia = 0;
        this.downloadedMedia = 0;
        this.failedMedia = 0;
        this.notes = [];
        this.scannedMessages = 0;
        this.skippedMedia = 0;
        this.started = false;
    }

    start() {
        this.started = true;
        this.render();
    }

    stop() {
        this.render();
        this.started = false;
        console.log('');
    }

    setConversation(conversationName) {
        this.currentConversation = conversationName;
        this.render();
    }

    incrementMessages(count) {
        this.scannedMessages += count;
        this.render();
    }

    incrementMedia(kind, count = 1) {
        if (kind === 'discovered') {
            this.discoveredMedia += count;
        } else if (kind === 'downloaded') {
            this.downloadedMedia += count;
        } else if (kind === 'failed') {
            this.failedMedia += count;
        } else if (kind === 'skipped') {
            this.skippedMedia += count;
        }

        this.render();
    }

    addNote(note) {
        this.notes = [note, ...this.notes].slice(0, 4);
        this.render();
    }

    render() {
        if (!this.started && this.scannedMessages === 0) {
            return;
        }

        if (process.stdout.isTTY) {
            readline.cursorTo(process.stdout, 0, 0);
            readline.clearScreenDown(process.stdout);
        }

        const scanBar = buildProgressBar(this.scannedMessages, this.totalMessages, 32);
        const scanCount = formatGenericCount(this.scannedMessages, this.totalMessages, 'messages scanned');
        const handledMedia = this.downloadedMedia + this.failedMedia + this.skippedMedia;
        const mediaBar = buildProgressBar(handledMedia, this.discoveredMedia, 32);
        const mediaCount = formatGenericCount(handledMedia, this.discoveredMedia, 'media handled');

        console.log(chalk.bold.cyan(this.title));
        console.log(`${chalk.blue('Scan')} ${scanBar} ${chalk.white(scanCount)}`);
        console.log(`${chalk.blue('Media')} ${mediaBar} ${chalk.white(mediaCount)}`);
        console.log(`${chalk.blue('Current')} ${chalk.white(this.currentConversation)}`);
        console.log(
            `${chalk.green('Downloaded')} ${this.downloadedMedia}`
            + ` | ${chalk.yellow('Skipped')} ${this.skippedMedia}`
            + ` | ${chalk.red('Failed')} ${this.failedMedia}`
            + ` | ${chalk.blue('Found')} ${this.discoveredMedia}`,
        );

        if (!this.totalMessages) {
            console.log(chalk.yellow('Total message count is unknown; using discovered messages.'));
        }

        for (const note of this.notes) {
            console.log(chalk.dim(note));
        }
    }
}
