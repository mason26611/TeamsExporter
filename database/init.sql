-- Teams Export SQLite schema.
-- The useful queryable fields live in columns, and the full payload stays gzipped in raw_zlib.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- Lightweight versioning for the database file itself.
CREATE TABLE IF NOT EXISTS app_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Parent teams imported from the Teams payload.
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    description TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reusable people directory. This is populated from chats, channels, and messages.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    mri TEXT,
    object_id TEXT,
    display_name TEXT,
    given_name TEXT,
    family_name TEXT,
    email TEXT,
    user_principal_name TEXT,
    tenant_name TEXT,
    user_type TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Conversation containers for both team channels and 1:1 / group chats.
CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('team_channel', 'chat', 'conversation')),
    display_name TEXT,
    title TEXT,
    description TEXT,
    thread_type TEXT,
    thread_sub_type TEXT,
    chat_type TEXT,
    is_general INTEGER CHECK (is_general IN (0, 1) OR is_general IS NULL),
    is_one_on_one INTEGER CHECK (is_one_on_one IN (0, 1) OR is_one_on_one IS NULL),
    is_deleted INTEGER CHECK (is_deleted IN (0, 1) OR is_deleted IS NULL),
    is_archived INTEGER CHECK (is_archived IN (0, 1) OR is_archived IS NULL),
    is_favorite INTEGER CHECK (is_favorite IN (0, 1) OR is_favorite IS NULL),
    is_muted INTEGER CHECK (is_muted IN (0, 1) OR is_muted IS NULL),
    member_role TEXT,
    tenant_id TEXT,
    group_id TEXT,
    creator_id TEXT,
    created_at TEXT,
    last_join_at TEXT,
    version TEXT,
    thread_version TEXT,
    last_message_id TEXT,
    last_message_at TEXT,
    last_message_from TEXT,
    last_message_content TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Membership snapshots for chat-style conversations and team channels.
CREATE TABLE IF NOT EXISTS channel_members (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mri TEXT,
    object_id TEXT,
    role TEXT,
    is_muted INTEGER CHECK (is_muted IN (0, 1) OR is_muted IS NULL),
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel_id, user_id)
);

-- Messages with the fields we expect to query directly.
CREATE TABLE IF NOT EXISTS messages (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    sequence_id INTEGER,
    conversation_id TEXT,
    conversation_link TEXT,
    client_message_id TEXT,
    version TEXT,
    type TEXT,
    content_type TEXT,
    message_type TEXT,
    content TEXT,
    sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    sender_mri TEXT,
    sender_display_name TEXT,
    sender_given_name TEXT,
    sender_family_name TEXT,
    sender_uri TEXT,
    compose_time TEXT,
    original_arrival_time TEXT,
    parent_message_id TEXT,
    reply_to_id TEXT,
    importance TEXT,
    properties_json TEXT,
    mentions_json TEXT,
    cards_json TEXT,
    links_json TEXT,
    files_json TEXT,
    reactions_json TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel_id, id)
);

-- Normalized reactions so we can query them without parsing JSON.
CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    reaction_type TEXT,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_display_name TEXT,
    created_at TEXT,
    raw_zlib BLOB NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (channel_id, message_id) REFERENCES messages(channel_id, id) ON DELETE CASCADE
);

-- Full-text search over message body and sender name.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    sender_display_name,
    channel_id UNINDEXED,
    message_id UNINDEXED
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content, sender_display_name, channel_id, message_id)
    VALUES (new.rowid, COALESCE(new.content, ''), COALESCE(new.sender_display_name, ''), new.channel_id, new.id);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
    INSERT INTO messages_fts(rowid, content, sender_display_name, channel_id, message_id)
    VALUES (new.rowid, COALESCE(new.content, ''), COALESCE(new.sender_display_name, ''), new.channel_id, new.id);
END;

-- Indexes for the common lookup paths.
CREATE INDEX IF NOT EXISTS idx_channels_team_id ON channels(team_id);
CREATE INDEX IF NOT EXISTS idx_channels_source_type ON channels(source_type);
CREATE INDEX IF NOT EXISTS idx_channels_display_name ON channels(display_name);
CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, compose_time);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_message_id ON messages(client_message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(channel_id, message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_type ON message_reactions(reaction_type);

INSERT INTO app_metadata (key, value, updated_at)
VALUES ('schema_version', '3', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;
