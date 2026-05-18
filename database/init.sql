PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    mri TEXT,
    object_id TEXT,
    display_name TEXT,
    email TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conversations include team channels, group chats, and one-on-one chats.
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    team_id TEXT,
    source_type TEXT NOT NULL CHECK (
        source_type IN ('team_channel', 'chat', 'conversation')
    ),
    display_name TEXT,
    description TEXT,
    created_at TEXT,
    last_message_at TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    sequence_id INTEGER,
    content TEXT,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sender_display_name TEXT,
    compose_time TEXT,
    parent_message_id TEXT,
    reply_to_id TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, id)
);

-- Reactions for querying reactions without parsing message payloads.
CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    reaction_type TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_display_name TEXT,
    created_at TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id, message_id)
        REFERENCES messages(conversation_id, id)
        ON DELETE CASCADE
);

-- Media references extracted from Teams messages and their local downloads.
CREATE TABLE IF NOT EXISTS message_media (
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    original_filename TEXT,
    content_type TEXT,
    byte_size INTEGER,
    local_path TEXT,
    download_status TEXT NOT NULL DEFAULT 'pending' CHECK (
        download_status IN ('pending', 'downloaded', 'failed')
    ),
    error TEXT,
    raw_json TEXT,
    downloaded_at TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, message_id, media_id, url),
    FOREIGN KEY (conversation_id, message_id)
        REFERENCES messages(conversation_id, id)
        ON DELETE CASCADE
);

-- Stores the latest sync-state URL per conversation for incremental backups.
CREATE TABLE IF NOT EXISTS conversation_sync_state (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    sync_state_url TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Full-text search over message content and sender names.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    sender_display_name,
    conversation_id UNINDEXED,
    message_id UNINDEXED
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(
        rowid,
        content,
        sender_display_name,
        conversation_id,
        message_id
    )
    VALUES (
        new.rowid,
        COALESCE(new.content, ''),
        COALESCE(new.sender_display_name, ''),
        new.conversation_id,
        new.id
    );
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts
    WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts
    WHERE rowid = old.rowid;

    INSERT INTO messages_fts(
        rowid,
        content,
        sender_display_name,
        conversation_id,
        message_id
    )
    VALUES (
        new.rowid,
        COALESCE(new.content, ''),
        COALESCE(new.sender_display_name, ''),
        new.conversation_id,
        new.id
    );
END;

CREATE INDEX IF NOT EXISTS idx_conversations_team_id
ON conversations(team_id);

CREATE INDEX IF NOT EXISTS idx_conversations_source_type
ON conversations(source_type);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
ON messages(conversation_id, compose_time);

CREATE INDEX IF NOT EXISTS idx_messages_sender
ON messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message
ON message_reactions(conversation_id, message_id);

CREATE INDEX IF NOT EXISTS idx_message_media_status
ON message_media(download_status);

CREATE INDEX IF NOT EXISTS idx_message_media_message
ON message_media(conversation_id, message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_sync_state_updated
ON conversation_sync_state(updated_at);
