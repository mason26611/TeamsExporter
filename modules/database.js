import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { firstValue, gzipJson } from './utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const initSqlPath = path.resolve(__dirname, '..', 'database', 'init.sql');

/**
 * Extracts a Teams MRI from a contact URL when Teams returns a URL instead of a plain MRI.
 *
 * @param {string | null | undefined} value - Contact URL or MRI value.
 * @returns {string | null} Extracted MRI or the original value.
 */
function extractMri(value) {
    if (!value) {
        return null;
    }

    const marker = '/contacts/';
    const markerIndex = value.indexOf(marker);

    if (markerIndex === -1) {
        return value;
    }

    return decodeURIComponent(value.slice(markerIndex + marker.length));
}

/**
 * Creates a stable database user ID from a Teams user-like object.
 *
 * @param {object} user - Teams user-like payload.
 * @returns {string} Stable user identifier.
 */
function getUserId(user) {
    return firstValue(
        user.id,
        user.objectId,
        user.object_id,
        user.mri,
        extractMri(user.from),
        user.userPrincipalName,
        user.email,
    ) ?? 'unknown-user';
}

/**
 * Maps a Teams user-like payload to database columns.
 *
 * @param {object} user - Teams user-like payload.
 * @returns {object} User row values.
 */
function mapUserRow(user) {
    return {
        display_name: firstValue(user.displayName, user.imdisplayname, user.imDisplayName, user.fromDisplayNameInToken),
        email: firstValue(user.email, user.mail),
        id: getUserId(user),
        mri: firstValue(user.mri, extractMri(user.from)),
        object_id: firstValue(user.objectId, user.object_id),
        raw_zlib: gzipJson(user),
    };
}

/**
 * Returns the most useful last-message object from a chat-like payload.
 *
 * @param {object} chat - Teams chat-like payload.
 * @returns {object | null} Last-message payload or null.
 */
function getLastMessage(chat) {
    return chat.lastMessage ?? chat.sourceChat?.lastMessage ?? null;
}

/**
 * Maps a Teams chat-like payload to database conversation columns.
 *
 * @param {object} chat - Teams chat-like payload.
 * @returns {object} Conversation row values.
 */
function mapConversationRow(chat) {
    const sourceChat = chat.sourceChat ?? chat;
    const lastMessage = getLastMessage(chat);

    return {
        created_at: firstValue(sourceChat.createdTime, sourceChat.createdAt),
        description: firstValue(sourceChat.description),
        display_name: firstValue(chat.displayName, sourceChat.displayName, chat.title),
        id: chat.id,
        last_message_at: firstValue(lastMessage?.composeTime, lastMessage?.originalArrivalTime),
        raw_zlib: gzipJson(chat),
        source_type: 'chat',
        team_id: firstValue(sourceChat.teamId, sourceChat.team_id),
    };
}

/**
 * Maps a Teams message payload to database message columns.
 *
 * @param {string} conversationId - Conversation ID that owns the message.
 * @param {object} message - Teams message payload.
 * @param {string | null} senderId - Normalized sender ID.
 * @returns {object} Message row values.
 */
function mapMessageRow(conversationId, message, senderId) {
    return {
        compose_time: firstValue(message.composetime, message.composeTime),
        content: firstValue(message.content),
        conversation_id: conversationId,
        id: String(message.id),
        parent_message_id: firstValue(message.parentMessageId),
        raw_zlib: gzipJson(message),
        reply_to_id: firstValue(message.replyToId),
        sender_display_name: firstValue(message.imdisplayname, message.imDisplayName, message.fromDisplayNameInToken),
        sender_id: senderId,
        sequence_id: firstValue(message.sequenceId),
    };
}

/**
 * Maps a Teams reaction payload to database reaction columns.
 *
 * @param {string} conversationId - Conversation ID that owns the message.
 * @param {string} messageId - Message ID that owns the reaction.
 * @param {object} reaction - Teams reaction payload.
 * @returns {object} Reaction row values.
 */
function mapReactionRow(conversationId, messageId, reaction) {
    const user = reaction.user ?? reaction.from ?? {};
    const userId = firstValue(
        reaction.userId,
        reaction.userMri,
        typeof user === 'object' ? getUserId(user) : null,
    );

    return {
        conversation_id: conversationId,
        created_at: firstValue(reaction.createdDateTime, reaction.createdAt, reaction.time),
        message_id: messageId,
        raw_zlib: gzipJson(reaction),
        reaction_type: firstValue(reaction.reactionType, reaction.type),
        user_display_name: firstValue(reaction.userDisplayName, user.displayName),
        user_id: userId === 'unknown-user' ? null : userId,
    };
}

/**
 * Expands annotationsSummary emotion counts into normalized reaction entries.
 *
 * @param {object} message - Teams message payload.
 * @returns {Array<object>} Expanded reaction payloads.
 */
function expandAnnotationSummaryReactions(message) {
    const emotions = message.annotationsSummary?.emotions;

    if (!emotions || typeof emotions !== 'object') {
        return [];
    }

    const expanded = [];

    for (const [reactionType, countValue] of Object.entries(emotions)) {
        const count = Number.parseInt(String(countValue), 10);
        const safeCount = Number.isFinite(count) && count > 0 ? count : 1;

        for (let i = 0; i < safeCount; i++) {
            expanded.push({
                createdAt: firstValue(message.composetime, message.composeTime),
                reactionType,
                source: 'annotationsSummary.emotions',
            });
        }
    }

    return expanded;
}

/**
 * Returns normalized message reactions from the best available payload shape.
 *
 * @param {object} message - Teams message payload.
 * @returns {Array<object>} Reaction payloads to persist.
 */
function getMessageReactions(message) {
    const summaryReactions = expandAnnotationSummaryReactions(message);

    if (summaryReactions.length > 0) {
        return summaryReactions;
    }

    return message.reactions ?? [];
}

/**
 * Opens and initializes the Teams SQLite database.
 *
 * @param {string} dbPath - SQLite database path.
 * @returns {TeamsDatabase} Database wrapper.
 */
export function openTeamsDatabase(dbPath) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const database = new Database(dbPath);
    database.pragma('foreign_keys = ON');
    database.exec(fs.readFileSync(initSqlPath, 'utf8'));

    return new TeamsDatabase(database);
}

/**
 * Thin persistence wrapper for Teams export data.
 */
export class TeamsDatabase {
    /**
     * Creates a Teams database wrapper.
     *
     * @param {Database.Database} database - better-sqlite3 database instance.
     */
    constructor(database) {
        this.database = database;
        this.upsertUserStatement = database.prepare(`
            INSERT INTO users (id, mri, object_id, display_name, email, raw_zlib)
            VALUES (@id, @mri, @object_id, @display_name, @email, @raw_zlib)
            ON CONFLICT(id) DO UPDATE SET
                mri = COALESCE(excluded.mri, users.mri),
                object_id = COALESCE(excluded.object_id, users.object_id),
                display_name = COALESCE(excluded.display_name, users.display_name),
                email = COALESCE(excluded.email, users.email),
                raw_zlib = excluded.raw_zlib,
                imported_at = CURRENT_TIMESTAMP
        `);
        this.upsertConversationStatement = database.prepare(`
            INSERT INTO conversations (
                id, team_id, source_type, display_name, description, created_at,
                last_message_at, raw_zlib
            )
            VALUES (
                @id, @team_id, @source_type, @display_name, @description, @created_at,
                @last_message_at, @raw_zlib
            )
            ON CONFLICT(id) DO UPDATE SET
                team_id = COALESCE(excluded.team_id, conversations.team_id),
                source_type = COALESCE(excluded.source_type, conversations.source_type),
                display_name = COALESCE(excluded.display_name, conversations.display_name),
                description = COALESCE(excluded.description, conversations.description),
                created_at = COALESCE(excluded.created_at, conversations.created_at),
                last_message_at = COALESCE(excluded.last_message_at, conversations.last_message_at),
                raw_zlib = excluded.raw_zlib,
                imported_at = CURRENT_TIMESTAMP
        `);
        this.upsertMessageStatement = database.prepare(`
            INSERT INTO messages (
                conversation_id, id, sequence_id, content, sender_id, sender_display_name,
                compose_time, parent_message_id, reply_to_id, raw_zlib
            )
            VALUES (
                @conversation_id, @id, @sequence_id, @content, @sender_id, @sender_display_name,
                @compose_time, @parent_message_id, @reply_to_id, @raw_zlib
            )
            ON CONFLICT(conversation_id, id) DO UPDATE SET
                sequence_id = COALESCE(excluded.sequence_id, messages.sequence_id),
                content = COALESCE(excluded.content, messages.content),
                sender_id = COALESCE(excluded.sender_id, messages.sender_id),
                sender_display_name = COALESCE(excluded.sender_display_name, messages.sender_display_name),
                compose_time = COALESCE(excluded.compose_time, messages.compose_time),
                parent_message_id = COALESCE(excluded.parent_message_id, messages.parent_message_id),
                reply_to_id = COALESCE(excluded.reply_to_id, messages.reply_to_id),
                raw_zlib = excluded.raw_zlib,
                imported_at = CURRENT_TIMESTAMP
        `);
        this.deleteReactionsStatement = database.prepare('DELETE FROM message_reactions WHERE conversation_id = ? AND message_id = ?');
        this.insertReactionStatement = database.prepare(`
            INSERT INTO message_reactions (
                conversation_id, message_id, reaction_type, user_id, user_display_name, created_at, raw_zlib
            )
            VALUES (
                @conversation_id, @message_id, @reaction_type, @user_id, @user_display_name, @created_at, @raw_zlib
            )
        `);
        this.getMessageCountStatement = database.prepare('SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?');
        this.getMessageExistsStatement = database.prepare('SELECT 1 FROM messages WHERE conversation_id = ? AND id = ? LIMIT 1');
        this.getMaxSequenceStatement = database.prepare('SELECT MAX(sequence_id) AS maxSequence FROM messages WHERE conversation_id = ?');
        this.getConversationSyncStateStatement = database.prepare('SELECT sync_state_url FROM conversation_sync_state WHERE conversation_id = ?');
        this.upsertConversationSyncStateStatement = database.prepare(`
            INSERT INTO conversation_sync_state (conversation_id, sync_state_url, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id) DO UPDATE SET
                sync_state_url = excluded.sync_state_url,
                updated_at = CURRENT_TIMESTAMP
        `);
        this.saveMessageBatch = database.transaction((conversationId, messages) => {
            let saved = 0;

            for (const message of messages) {
                this.upsertMessage(conversationId, message);
                saved += 1;
            }

            return saved;
        });
    }

    /**
     * Closes the underlying SQLite database.
     *
     * @returns {void}
     */
    close() {
        this.database.close();
    }

    /**
     * Inserts or updates a Teams user.
     *
     * @param {object} user - Teams user-like payload.
     * @returns {string} Stable user ID.
     */
    upsertUser(user) {
        const row = mapUserRow(user);
        this.upsertUserStatement.run(row);
        return row.id;
    }

    /**
     * Inserts or updates a Teams chat as a database conversation.
     *
     * @param {object} chat - Teams chat-like payload.
     * @returns {void}
     */
    upsertChannel(chat) {
        this.upsertConversationStatement.run(mapConversationRow(chat));

        const sourceChat = chat.sourceChat ?? chat;
        for (const member of sourceChat.members ?? []) {
            this.upsertUser(member);
        }

        const identityKeys = [chat.id, chat.mri, chat.objectId, chat.displayName];
        if (identityKeys.some((value) => value != null)) {
            this.upsertUser(chat);
        }
    }

    /**
     * Inserts or updates a Teams message and its normalized reactions.
     *
     * @param {string} conversationId - Conversation ID that owns the message.
     * @param {object} message - Teams message payload.
     * @returns {void}
     */
    upsertMessage(conversationId, message) {
        const senderMri = extractMri(message.from);
        const senderId = this.upsertUser({
            displayName: firstValue(message.imdisplayname, message.imDisplayName, message.fromDisplayNameInToken),
            email: null,
            familyName: message.fromFamilyNameInToken,
            from: message.from,
            givenName: message.fromGivenNameInToken,
            mri: senderMri,
        });
        const messageId = String(message.id);

        this.upsertMessageStatement.run(mapMessageRow(conversationId, message, senderId));
        this.deleteReactionsStatement.run(conversationId, messageId);

        for (const reaction of getMessageReactions(message)) {
            const userPayload = reaction.user ?? reaction.from;

            if (userPayload && typeof userPayload === 'object') {
                this.upsertUser(userPayload);
            } else {
                const reactionUserId = firstValue(reaction.userId, reaction.userMri);

                if (reactionUserId) {
                    this.upsertUser({
                        displayName: reaction.userDisplayName,
                        id: reactionUserId,
                        mri: reaction.userMri,
                    });
                }
            }

            this.insertReactionStatement.run(mapReactionRow(conversationId, messageId, reaction));
        }
    }

    /**
     * Saves a batch of messages in one SQLite transaction.
     *
     * @param {string} conversationId - Conversation ID that owns the messages.
     * @param {Array<object>} messages - Teams message payloads.
     * @returns {number} Number of messages saved.
     */
    saveMessages(conversationId, messages) {
        return this.saveMessageBatch(conversationId, messages);
    }

    /**
     * Checks whether a message is already present in the database.
     *
     * @param {string} conversationId - Conversation ID.
     * @param {string} messageId - Message ID.
     * @returns {boolean} True when the message already exists.
     */
    hasMessage(conversationId, messageId) {
        return Boolean(this.getMessageExistsStatement.get(conversationId, String(messageId)));
    }

    /**
     * Reads the saved sync-state URL for a conversation.
     *
     * @param {string} conversationId - Conversation ID.
     * @returns {string | null} Sync-state URL, when present.
     */
    getConversationSyncStateUrl(conversationId) {
        return this.getConversationSyncStateStatement.get(conversationId)?.sync_state_url ?? null;
    }

    /**
     * Saves or updates the sync-state URL for a conversation.
     *
     * @param {string} conversationId - Conversation ID.
     * @param {string | null | undefined} syncStateUrl - Sync-state URL from Teams metadata.
     */
    setConversationSyncStateUrl(conversationId, syncStateUrl) {
        if (!syncStateUrl) {
            return;
        }

        this.upsertConversationSyncStateStatement.run(conversationId, syncStateUrl);
    }

    /**
     * Returns historical progress metadata for compatibility with old callers.
     *
     * @param {string} conversationId - Conversation ID.
     * @returns {{sync_state_url: string} | undefined} Legacy-shaped progress metadata.
     */
    getProgress(conversationId) {
        const syncStateUrl = this.getConversationSyncStateUrl(conversationId);
        return syncStateUrl ? { sync_state_url: syncStateUrl } : undefined;
    }

    /**
     * Counts saved messages for a conversation.
     *
     * @param {string} conversationId - Conversation ID.
     * @returns {number} Message count.
     */
    getMessageCount(conversationId) {
        return this.getMessageCountStatement.get(conversationId)?.count ?? 0;
    }

    /**
     * Reads the largest saved Teams sequence ID for a conversation.
     *
     * @param {string} conversationId - Conversation ID.
     * @returns {number} Largest sequence ID, or zero when no messages are saved.
     */
    getMaxSequence(conversationId) {
        return this.getMaxSequenceStatement.get(conversationId)?.maxSequence ?? 0;
    }

    /**
     * Persists progress metadata for compatibility with old callers.
     *
     * @returns {void}
     */
    updateProgress(progress = {}) {
        if (progress.channelId) {
            this.setConversationSyncStateUrl(progress.channelId, progress.syncStateUrl);
        }
    }
}
