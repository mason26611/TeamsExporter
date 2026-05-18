import chalk from 'chalk';
import { defaultMediaDir } from './config.js';
import { buildMessagesUrl } from './teams-api.js';
import { downloadMediaForMessages } from './media.js';
import { ProgressTui } from './tui.js';
import { sleep } from './utils.js';

const pageDelayMs = 2000;

function getChatName(chat) {
    return chat.name ?? chat.displayName ?? chat.title ?? chat.id;
}

function getEstimatedTotalMessages(chat) {
    const estimate = chat.estimatedTotalMessages ?? chat.lastMessage?.sequenceId ?? chat.sourceChat?.lastMessage?.sequenceId;

    return Number.isFinite(estimate) ? Number(estimate) : null;
}

/**
 * Returns the expected per-chat progress baseline and total for the active mode.
 *
 * @param {object} options - Progress options.
 * @param {object} options.chat - Teams chat-like payload.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {'resume' | 'backup-new' | 'backup-recent' | 'fresh'} options.mode - Export mode.
 * @param {boolean} options.hasSavedSyncState - Whether the chat has a saved sync-state URL.
 * @returns {{chatCurrentMessages: number, chatTotalMessages: number | null}} Per-chat progress seed.
 */
function getChatProgressSeed({ chat, database, mode, hasSavedSyncState }) {
    const estimate = getEstimatedTotalMessages(chat);
    const maxSequence = database.getMaxSequence(chat.id);

    if (mode === 'backup-new' || mode === 'backup-recent' || (mode === 'resume' && hasSavedSyncState)) {
        return {
            chatCurrentMessages: 0,
            chatTotalMessages: estimate === null ? null : Math.max(0, estimate - maxSequence),
        };
    }

    if (mode === 'resume') {
        return {
            chatCurrentMessages: database.getMessageCount(chat.id),
            chatTotalMessages: estimate,
        };
    }

    return {
        chatCurrentMessages: 0,
        chatTotalMessages: estimate,
    };
}

/**
 * Reads the historical previous-page URL from a Teams messages response.
 *
 * @param {object} messagesData - Teams messages payload.
 * @returns {string | null} Next historical page URL, when present.
 */
function getBackwardLink(messagesData) {
    const metadata = messagesData._metadata ?? {};

    return metadata.backwardLink ?? metadata.backwardsLink ?? metadata.prevLink ?? null;
}

function getSyncStateUrl(messagesData) {
    return messagesData._metadata?.syncState ?? null;
}

function persistSyncStateFromPage(database, conversationId, messagesData) {
    database.setConversationSyncStateUrl(conversationId, getSyncStateUrl(messagesData));
}

/**
 * Saves messages and optionally downloads Teams-hosted media referenced by them.
 *
 * @param {object} options - Save options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {string} options.mediaDir - Media output directory.
 * @param {number | undefined} options.mediaConcurrency - Maximum simultaneous media downloads.
 * @param {string} options.chatId - Chat ID.
 * @param {string} options.chatName - Chat display name.
 * @param {Array<object>} options.messages - Teams messages.
 * @param {ProgressTui} options.tui - Live progress UI.
 * @returns {Promise<void>} Resolves after persistence work finishes.
 */
async function saveMessagesPage({ api, database, downloadMedia, mediaConcurrency, mediaDir, chatId, chatName, messages, tui }) {
    if (messages.length === 0) {
        return;
    }

    database.saveMessages(chatId, messages);
    tui.incrementMessages(messages.length);

    if (!downloadMedia) {
        return;
    }

    const mediaTotals = await downloadMediaForMessages({
        api,
        concurrency: mediaConcurrency,
        conversationId: chatId,
        conversationName: chatName,
        database,
        mediaDir,
        messages,
    });

    if (mediaTotals.downloaded > 0 || mediaTotals.failed > 0) {
        tui.addNote(
            `${chalk.blue('media')} ${chatName}: ${mediaTotals.downloaded} item(s) downloaded`
            + (mediaTotals.failed > 0 ? `, ${mediaTotals.failed} failed` : ''),
        );
    }
}

/**
 * Calculates the TUI's initial current count and best available total.
 *
 * @param {Array<object>} selectedChats - Selected chat payloads.
 * @param {import('./database.js').TeamsDatabase} database - Teams database wrapper.
 * @param {'resume' | 'backup-new' | 'backup-recent' | 'fresh'} mode - Export mode.
 * @returns {{currentMessages: number, totalMessages: number | null}} TUI totals.
 */
function calculateTuiTotals(selectedChats, database, mode) {
    let currentMessages = 0;
    let totalMessages = 0;
    let hasUnknownTotal = false;

    for (const chat of selectedChats) {
        const estimate = getEstimatedTotalMessages(chat);
        const hasSavedSyncState = Boolean(database.getConversationSyncStateUrl(chat.id));
        const maxSequence = database.getMaxSequence(chat.id);

        if (estimate === null) {
            hasUnknownTotal = true;
        }

        if (mode === 'backup-new' || mode === 'backup-recent' || (mode === 'resume' && hasSavedSyncState)) {
            totalMessages += estimate === null ? 0 : Math.max(0, estimate - maxSequence);
            continue;
        }

        if (mode === 'resume') {
            currentMessages += database.getMessageCount(chat.id);
        }

        totalMessages += estimate ?? 0;
    }

    return {
        currentMessages,
        totalMessages: hasUnknownTotal || totalMessages === 0 ? null : totalMessages,
    };
}

/**
 * Exports historical pages (newest to oldest) for a chat.
 *
 * @param {object} options - Export options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {string} options.chatId - Chat ID.
 * @param {string} options.chatName - Display chat name.
 * @param {string} options.mediaDir - Media output directory.
 * @param {ProgressTui} options.tui - Live progress UI.
 * @returns {Promise<void>} Resolves when export finishes.
 */
async function exportHistorical({ api, database, downloadMedia, chatId, chatName, mediaConcurrency, mediaDir, tui }) {
    let nextUrl = buildMessagesUrl(chatId);
    const seenUrls = new Set();

    while (nextUrl) {
        if (seenUrls.has(nextUrl)) {
            tui.addNote(`${chalk.yellow('stop')} ${chatName}: Teams returned a repeated continuation URL`);
            break;
        }

        seenUrls.add(nextUrl);

        const messagesData = await api.getMessagesPage(nextUrl);
        const messages = messagesData.messages ?? [];

        persistSyncStateFromPage(database, chatId, messagesData);

        await saveMessagesPage({ api, database, downloadMedia, mediaConcurrency, mediaDir, chatId, chatName, messages, tui });

        if (messages.length === 0) {
            break;
        }

        nextUrl = getBackwardLink(messagesData);

        if (!nextUrl) {
            break;
        }

        await sleep(pageDelayMs);
    }
}

/**
 * Exports only new messages by resuming from the saved sync-state URL.
 *
 * @param {object} options - Export options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {string} options.chatId - Chat ID.
 * @param {string} options.chatName - Display chat name.
 * @param {string} options.mediaDir - Media output directory.
 * @param {ProgressTui} options.tui - Live progress UI.
 * @returns {Promise<void>} Resolves when export finishes.
 */
async function exportFromSyncState({ api, database, downloadMedia, chatId, chatName, mediaConcurrency, mediaDir, tui }) {
    let nextUrl = database.getConversationSyncStateUrl(chatId);

    if (!nextUrl) {
        tui.addNote(`${chalk.yellow('skip')} ${chatName}: no saved sync state yet; run --backup-recent or --fresh first`);
        return;
    }

    const seenUrls = new Set();

    while (nextUrl) {
        if (seenUrls.has(nextUrl)) {
            tui.addNote(`${chalk.yellow('stop')} ${chatName}: sync-state URL repeated without new progress`);
            break;
        }

        seenUrls.add(nextUrl);

        const messagesData = await api.getMessagesPage(nextUrl);
        const messages = messagesData.messages ?? [];
        const syncStateUrl = getSyncStateUrl(messagesData);

        persistSyncStateFromPage(database, chatId, messagesData);

        await saveMessagesPage({ api, database, downloadMedia, mediaConcurrency, mediaDir, chatId, chatName, messages, tui });

        if (messages.length === 0) {
            break;
        }

        if (!syncStateUrl) {
            tui.addNote(`${chalk.yellow('stop')} ${chatName}: sync-state URL missing from response metadata`);
            break;
        }

        nextUrl = syncStateUrl;
        await sleep(pageDelayMs);
    }
}

/**
 * Exports recent messages and stops once an already-saved message is encountered.
 *
 * @param {object} options - Export options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {string} options.chatId - Chat ID.
 * @param {string} options.chatName - Display chat name.
 * @param {string} options.mediaDir - Media output directory.
 * @param {ProgressTui} options.tui - Live progress UI.
 * @returns {Promise<void>} Resolves when export finishes.
 */
async function exportRecentUntilSaved({ api, database, downloadMedia, chatId, chatName, mediaConcurrency, mediaDir, tui }) {
    let nextUrl = buildMessagesUrl(chatId);
    const seenUrls = new Set();

    while (nextUrl) {
        if (seenUrls.has(nextUrl)) {
            tui.addNote(`${chalk.yellow('stop')} ${chatName}: Teams returned a repeated continuation URL`);
            break;
        }

        seenUrls.add(nextUrl);

        const messagesData = await api.getMessagesPage(nextUrl);
        const messages = messagesData.messages ?? [];

        persistSyncStateFromPage(database, chatId, messagesData);

        if (messages.length === 0) {
            break;
        }

        const unsavedMessages = [];
        let reachedSavedMessage = false;

        for (const message of messages) {
            const messageId = String(message.id);

            if (database.hasMessage(chatId, messageId)) {
                reachedSavedMessage = true;
                break;
            }

            unsavedMessages.push(message);
        }

        await saveMessagesPage({ api, database, downloadMedia, mediaConcurrency, mediaDir, chatId, chatName, messages: unsavedMessages, tui });

        if (reachedSavedMessage) {
            break;
        }

        nextUrl = getBackwardLink(messagesData);

        if (!nextUrl) {
            break;
        }

        await sleep(pageDelayMs);
    }
}

/**
 * Exports a single selected chat into the database.
 *
 * @param {object} options - Chat export options.
 * @param {object} options.api - Teams API client.
 * @param {number} options.chatCount - Total selected chats.
 * @param {number} options.chatIndex - 1-based selected chat index.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {'resume' | 'backup-new' | 'backup-recent' | 'fresh'} options.mode - Export mode.
 * @param {string} options.mediaDir - Media output directory.
 * @param {object} options.chat - Selected chat payload.
 * @param {ProgressTui} options.tui - Live progress UI.
 * @returns {Promise<void>} Resolves when the chat export finishes.
 */
async function exportChat({ api, chat, chatCount, chatIndex, database, downloadMedia, mediaConcurrency, mode, mediaDir, tui }) {
    const chatName = getChatName(chat);
    const hasSavedSyncState = Boolean(database.getConversationSyncStateUrl(chat.id));
    const chatProgressSeed = getChatProgressSeed({
        chat,
        database,
        hasSavedSyncState,
        mode,
    });

    database.upsertChannel(chat);
    tui.setChat(chatName, mode, {
        chatCount,
        chatCurrentMessages: chatProgressSeed.chatCurrentMessages,
        chatIndex,
        chatTotalMessages: chatProgressSeed.chatTotalMessages,
    });

    if (mode === 'backup-new') {
        await exportFromSyncState({ api, database, downloadMedia, chatId: chat.id, chatName, mediaConcurrency, mediaDir, tui });
        return;
    }

    if (mode === 'backup-recent') {
        await exportRecentUntilSaved({ api, database, downloadMedia, chatId: chat.id, chatName, mediaConcurrency, mediaDir, tui });
        return;
    }

    if (mode === 'resume' && hasSavedSyncState) {
        await exportFromSyncState({ api, database, downloadMedia, chatId: chat.id, chatName, mediaConcurrency, mediaDir, tui });
        return;
    }

    if (mode === 'resume' && !hasSavedSyncState) {
        tui.addNote(`${chalk.blue('resume')} ${chatName}: no saved sync state, running full historical export`);
    }

    await exportHistorical({ api, database, downloadMedia, chatId: chat.id, chatName, mediaConcurrency, mediaDir, tui });
}

/**
 * Exports all selected chats into the database with a live progress UI.
 *
 * @param {object} options - Export options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {boolean} options.downloadMedia - Whether media download is enabled.
 * @param {string} options.mediaDir - Media output directory.
 * @param {'resume' | 'backup-new' | 'backup-recent' | 'fresh'} options.mode - Export mode.
 * @param {Array<object>} options.selectedChats - Chats selected by the user.
 * @returns {Promise<void>} Resolves when all selected chats finish exporting.
 */
export async function exportSelectedChats({
    api,
    database,
    downloadMedia = false,
    mediaConcurrency,
    mediaDir = defaultMediaDir,
    mode,
    selectedChats,
}) {
    const totals = calculateTuiTotals(selectedChats, database, mode);

    let title = 'Exporting Teams Messages';
    if (mode === 'backup-new') {
        title = 'Backing Up New Teams Messages (Sync State)';
    } else if (mode === 'backup-recent') {
        title = 'Backing Up Recent Teams Messages';
    }

    const tui = new ProgressTui({
        title,
        totalMessages: totals.totalMessages,
    });

    tui.setCurrentMessages(totals.currentMessages);
    tui.start();

    try {
        for (let i = 0; i < selectedChats.length; i++) {
            const chat = selectedChats[i];

            await exportChat({
                api,
                chat,
                chatCount: selectedChats.length,
                chatIndex: i + 1,
                database,
                downloadMedia,
                mediaConcurrency,
                mediaDir,
                mode,
                tui,
            });
        }
    } finally {
        tui.stop();
    }
}
