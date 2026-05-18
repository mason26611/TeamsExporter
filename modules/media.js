import fs from 'node:fs';
import path from 'node:path';

const amsMediaType = 'http://schema.skype.com/AMSImage';
const defaultAmsBaseUrl = 'https://us-api.asm.skype.com';
const defaultDownloadConcurrency = 4;
const extensionByContentType = new Map([
    ['application/msword', 'doc'],
    ['application/pdf', 'pdf'],
    ['application/vnd.ms-excel', 'xls'],
    ['application/vnd.ms-powerpoint', 'ppt'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/zip', 'zip'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/wav', 'wav'],
    ['image/apng', 'apng'],
    ['image/avif', 'avif'],
    ['image/bmp', 'bmp'],
    ['image/gif', 'gif'],
    ['image/heic', 'heic'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/svg+xml', 'svg'],
    ['image/tiff', 'tif'],
    ['image/webp', 'webp'],
    ['text/csv', 'csv'],
    ['text/plain', 'txt'],
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['video/webm', 'webm'],
]);

function parseJsonish(value) {
    if (typeof value !== 'string') {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

function parseJsonishArray(value) {
    const parsed = parseJsonish(value);

    return Array.isArray(parsed) ? parsed : [];
}

function decodeHtmlAttribute(value) {
    return value
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function extractAttributes(tag) {
    const attributes = {};
    const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let match;

    while ((match = attributePattern.exec(tag)) !== null) {
        attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[2] ?? match[3] ?? match[4] ?? '');
    }

    return attributes;
}

function tryParseUrl(value) {
    if (!value) {
        return null;
    }

    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function getAmsObjectIdFromUrl(url) {
    const parsed = tryParseUrl(url);
    const match = parsed?.pathname.match(/\/objects\/([^/]+)/);

    return match ? decodeURIComponent(match[1]) : null;
}

function buildAmsMediaUrl(objectId) {
    return `${defaultAmsBaseUrl}/v1/objects/${encodeURIComponent(objectId)}/views/imgo`;
}

function normalizeMediaExtension(extension) {
    if (!extension) {
        return null;
    }

    const normalized = extension.toLowerCase().replace(/^\./, '');

    return /^[a-z0-9][a-z0-9_-]{0,15}$/.test(normalized) ? normalized : null;
}

function getExtensionFromUrl(url) {
    const parsed = tryParseUrl(url);
    const extension = parsed ? path.extname(parsed.pathname) : '';

    return normalizeMediaExtension(extension);
}

function getExtensionFromContentType(contentType) {
    if (!contentType) {
        return null;
    }

    return extensionByContentType.get(contentType.split(';', 1)[0].toLowerCase()) ?? null;
}

function getExtensionFromPath(filePath) {
    return normalizeMediaExtension(path.extname(filePath ?? ''));
}

function isAmsMediaUrl(url) {
    const parsed = tryParseUrl(url);

    return Boolean(parsed?.hostname.endsWith('asm.skype.com') && parsed.pathname.includes('/objects/') && parsed.pathname.includes('/views/imgo'));
}

function firstString(...values) {
    return values.find((value) => typeof value === 'string' && value.trim()) ?? null;
}

function getFileMediaUrl(file) {
    return firstString(
        file.downloadUrl,
        file.downloadURL,
        file.fileDownloadUrl,
        file.fileDownloadURL,
        file.contentUrl,
        file.objectUrl,
        file.url,
        file.filePreview?.previewUrl,
    );
}

function getFileMediaId(file, url) {
    return firstString(file.itemid, file.id, file.objectId, file.driveItemId, getAmsObjectIdFromUrl(url), url);
}

function addTarget(targetsByKey, target) {
    if (!target.url || !target.mediaId) {
        return;
    }

    targetsByKey.set(`${target.mediaId}\n${target.url}`, target);
}

/**
 * Extracts Teams-hosted media targets from a message payload.
 *
 * @param {object} message - Teams message payload.
 * @returns {Array<object>} Media targets.
 */
export function extractMediaFromMessage(message) {
    const targetsByKey = new Map();
    const content = message.content ?? '';
    const amsReferences = parseJsonishArray(message.amsreferences ?? message.amsReferences);
    const properties = message.properties ?? {};
    const files = parseJsonishArray(properties.files);

    for (const tag of String(content).match(/<img\b[^>]*>/gi) ?? []) {
        const attributes = extractAttributes(tag);
        const url = attributes.src;
        const mediaId = attributes.itemid ?? getAmsObjectIdFromUrl(url);
        const isAmsMedia = attributes.itemtype === amsMediaType || isAmsMediaUrl(url);

        if (!isAmsMedia) {
            continue;
        }

        addTarget(targetsByKey, {
            extension: normalizeMediaExtension(attributes.itemscope) ?? getExtensionFromUrl(url),
            mediaId,
            originalFilename: null,
            raw: attributes,
            source: 'message-html',
            url,
        });
    }

    for (const objectId of amsReferences) {
        if (typeof objectId !== 'string') {
            continue;
        }

        const url = buildAmsMediaUrl(objectId);

        addTarget(targetsByKey, {
            extension: getExtensionFromUrl(url),
            mediaId: objectId,
            originalFilename: null,
            raw: { objectId },
            source: 'ams-reference',
            url,
        });
    }

    for (const file of files) {
        if (!file || typeof file !== 'object') {
            continue;
        }

        const mediaUrl = getFileMediaUrl(file);

        if (!mediaUrl) {
            continue;
        }

        const mediaId = getFileMediaId(file, mediaUrl);
        const originalFilename = firstString(file.fileName, file.name, file.title);

        addTarget(targetsByKey, {
            extension: normalizeMediaExtension(file.fileType ?? file.type) ?? getExtensionFromUrl(originalFilename) ?? getExtensionFromUrl(mediaUrl),
            mediaId,
            originalFilename,
            raw: file,
            source: 'file',
            url: mediaUrl,
        });
    }

    return [...targetsByKey.values()];
}

function sanitizePathSegment(value) {
    const sanitized = String(value)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '');

    return sanitized.slice(0, 100) || 'unknown';
}

function buildOutputPath({ conversationId, conversationName, media, mediaDir, extension }) {
    const conversationFolder = sanitizePathSegment(conversationName ?? conversationId);
    const rawName = media.originalFilename ?? media.mediaId;
    const parsedName = path.parse(sanitizePathSegment(rawName));
    const baseName = parsedName.name || sanitizePathSegment(media.mediaId);
    const existingExtension = normalizeMediaExtension(parsedName.ext);
    const fileName = `${baseName}.${existingExtension ?? extension}`;
    const absolutePath = path.join(mediaDir, conversationFolder, fileName);

    return {
        absolutePath,
        relativePath: path.relative(process.cwd(), absolutePath),
    };
}

function pathsMatch(firstPath, secondPath) {
    return path.normalize(firstPath) === path.normalize(secondPath);
}

async function runWithConcurrency(items, concurrency, worker) {
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, concurrency), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const item = items[nextIndex];
            nextIndex += 1;
            await worker(item);
        }
    });

    await Promise.all(workers);
}

/**
 * Downloads media for Teams messages and records the result in SQLite.
 *
 * @param {object} options - Download options.
 * @param {object} options.api - Teams API client.
 * @param {import('./database.js').TeamsDatabase} options.database - Teams database wrapper.
 * @param {string} options.conversationId - Conversation ID.
 * @param {string | null | undefined} options.conversationName - Conversation display name.
 * @param {number} [options.concurrency] - Maximum simultaneous media downloads.
 * @param {string} options.mediaDir - Output directory.
 * @param {Array<object>} options.messages - Teams message payloads.
 * @returns {Promise<{discovered: number, downloaded: number, failed: number, skipped: number}>} Download totals.
 */
export async function downloadMediaForMessages({
    api,
    concurrency = defaultDownloadConcurrency,
    conversationId,
    conversationName,
    database,
    mediaDir,
    messages,
}) {
    const totals = {
        discovered: 0,
        downloaded: 0,
        failed: 0,
        skipped: 0,
    };
    const downloadTasks = [];

    for (const message of messages) {
        const messageId = String(message.id);
        const mediaTargets = extractMediaFromMessage(message);
        totals.discovered += mediaTargets.length;

        for (const media of mediaTargets) {
            database.upsertMessageMedia(conversationId, messageId, media);

            const existing = database.getMessageMedia(conversationId, messageId, media.mediaId, media.url);
            if (existing?.local_path && fs.existsSync(existing.local_path)) {
                if (existing.download_status !== 'downloaded') {
                    database.markMessageMediaDownloaded(conversationId, messageId, media, {
                        byteSize: fs.statSync(existing.local_path).size,
                        contentType: existing.content_type ?? null,
                        localPath: existing.local_path,
                    });
                }

                totals.skipped += 1;
                continue;
            }

            const existingExtension = getExtensionFromPath(existing?.local_path);
            const expectedPath = buildOutputPath({
                conversationId,
                conversationName,
                extension: media.extension ?? getExtensionFromContentType(existing?.content_type) ?? existingExtension ?? 'bin',
                media,
                mediaDir,
            });

            if (fs.existsSync(expectedPath.absolutePath)) {
                if (!existing?.local_path || !pathsMatch(existing.local_path, expectedPath.relativePath) || existing.download_status !== 'downloaded') {
                    database.markMessageMediaDownloaded(conversationId, messageId, media, {
                        byteSize: fs.statSync(expectedPath.absolutePath).size,
                        contentType: existing?.content_type ?? null,
                        localPath: expectedPath.relativePath,
                    });
                }

                totals.skipped += 1;
                continue;
            }

            downloadTasks.push({ media, messageId });
        }
    }

    await runWithConcurrency(downloadTasks, concurrency, async ({ media, messageId }) => {
        try {
            const response = await api.downloadMedia(media.url);
            const extension = media.extension ?? getExtensionFromContentType(response.contentType) ?? getExtensionFromUrl(response.finalUrl) ?? 'bin';

            const outputPath = buildOutputPath({
                conversationId,
                conversationName,
                extension,
                media,
                mediaDir,
            });

            fs.mkdirSync(path.dirname(outputPath.absolutePath), { recursive: true });
            fs.writeFileSync(outputPath.absolutePath, response.buffer);

            database.markMessageMediaDownloaded(conversationId, messageId, media, {
                byteSize: response.buffer.byteLength,
                contentType: response.contentType,
                localPath: outputPath.relativePath,
            });
            totals.downloaded += 1;
        } catch (error) {
            database.markMessageMediaFailed(conversationId, messageId, media, error);
            totals.failed += 1;
        }
    });

    return totals;
}
