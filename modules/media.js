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

function buildAmsMediaUrl(objectId, view = 'imgo') {
    return `${defaultAmsBaseUrl}/v1/objects/${encodeURIComponent(objectId)}/views/${view}`;
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

function encodeSharePointSharingUrl(url) {
    const base64 = Buffer.from(url, 'utf8').toString('base64');
    const base64url = base64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

    return `u!${base64url}`;
}

function buildDriveRootContentUrl(fileUrl) {
    const parsed = tryParseUrl(fileUrl);

    if (!parsed?.pathname.includes('/personal/') || !parsed.pathname.includes('/Documents/')) {
        return null;
    }

    const personalRoot = parsed.pathname.match(/^(\/personal\/[^/]+)/)?.[1];

    if (!personalRoot) {
        return null;
    }

    const filePath = decodeURIComponent(parsed.pathname.slice(`${personalRoot}/`.length));
    const encodedPath = filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');

    return `${parsed.origin}${personalRoot}/_api/v2.0/drive/root:/${encodedPath}:/content`;
}

function buildGraphShareContentUrl(shareUrl) {
    if (!shareUrl) {
        return null;
    }

    try {
        const encoded = encodeSharePointSharingUrl(shareUrl);

        return `https://graph.microsoft.com/v1.0/shares/${encoded}/driveItem/content`;
    } catch {
        return null;
    }
}

function withDownloadQuery(url) {
    const parsed = tryParseUrl(url);

    if (!parsed) {
        return null;
    }

    parsed.searchParams.set('download', '1');

    return parsed.toString();
}

function buildSharePointApiUrls(file) {
    const urls = [];
    const addUrl = (value) => {
        if (typeof value === 'string' && value.trim() && !urls.includes(value)) {
            urls.push(value);
        }
    };

    const baseUrl = firstString(file.baseUrl, file.fileInfo?.siteUrl);
    const shareUrl = file.fileInfo?.shareUrl;
    const itemId = firstString(file.sharepointIds?.listItemUniqueId, file.itemid, file.id);
    const siteId = file.sharepointIds?.siteId;

    for (const fileUrl of [file.objectUrl, file.fileInfo?.fileUrl]) {
        addUrl(buildDriveRootContentUrl(fileUrl));
    }

    if (shareUrl) {
        try {
            const origin = new URL(shareUrl).origin;
            const encoded = encodeSharePointSharingUrl(shareUrl);

            addUrl(`${origin}/_api/v2.0/shares/${encoded}/driveItem/content`);
        } catch {
            // Ignore invalid sharing URLs.
        }
    }

    if (baseUrl && itemId) {
        const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

        addUrl(`${trimmedBase}/_api/v2.0/drive/items/${itemId}/content`);
    }

    if (siteId && itemId && baseUrl) {
        try {
            const origin = new URL(baseUrl).origin;

            addUrl(`${origin}/_api/v2.0/sites/${siteId}/drive/items/${itemId}/content`);
        } catch {
            // Ignore invalid site URLs.
        }
    }

    return urls;
}

function getFileMediaUrl(file) {
    const shareUrl = file.fileInfo?.shareUrl;
    const objectUrl = file.objectUrl;

    return firstString(
        file.filePreview?.previewUrl,
        ...buildSharePointApiUrls(file),
        file.downloadUrl,
        file.downloadURL,
        file.fileDownloadUrl,
        file.fileDownloadURL,
        file.contentUrl,
        file.fileInfo?.fileUrl,
        shareUrl,
        objectUrl,
        file.url,
    );
}

function getFileMediaId(file, url) {
    return firstString(file.itemid, file.id, file.objectId, file.driveItemId, getAmsObjectIdFromUrl(url), url);
}

function getFileDownloadUrls(media) {
    const urls = [];
    const addUrl = (value) => {
        if (typeof value === 'string' && value.trim() && !urls.includes(value)) {
            urls.push(value);
        }
    };

    if (media.source === 'file' && media.raw && typeof media.raw === 'object') {
        const file = media.raw;

        addUrl(buildGraphShareContentUrl(file.fileInfo?.shareUrl));

        for (const apiUrl of buildSharePointApiUrls(file)) {
            addUrl(apiUrl);
        }

        addUrl(withDownloadQuery(file.fileInfo?.shareUrl));
        addUrl(withDownloadQuery(file.objectUrl));
        addUrl(withDownloadQuery(file.fileInfo?.fileUrl));
        addUrl(file.downloadUrl);
        addUrl(file.downloadURL);
        addUrl(file.fileDownloadUrl);
        addUrl(file.fileDownloadURL);
        addUrl(file.contentUrl);
        addUrl(file.fileInfo?.fileUrl);
        addUrl(file.fileInfo?.shareUrl);
        addUrl(file.objectUrl);
        addUrl(file.url);
    }

    addUrl(media.url);

    return urls;
}

function isHtmlPayload(buffer, contentType) {
    if (contentType?.toLowerCase().includes('text/html')) {
        return true;
    }

    const prefix = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();

    return prefix.startsWith('<!doctype html') || prefix.startsWith('<html');
}

function isCorruptDownloadedFile(filePath, expectedExtension) {
    if (!fs.existsSync(filePath)) {
        return false;
    }

    const extension = normalizeMediaExtension(path.extname(filePath));

    if (extension === 'html' || extension === 'htm') {
        return false;
    }

    const sample = Buffer.alloc(256);
    const fd = fs.openSync(filePath, 'r');

    try {
        const bytesRead = fs.readSync(fd, sample, 0, sample.length, 0);
        const content = sample.subarray(0, bytesRead).toString('utf8').trimStart().toLowerCase();

        return content.startsWith('<!doctype html') || content.startsWith('<html');
    } finally {
        fs.closeSync(fd);
    }
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
    const coveredAmsObjectIds = new Set();
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

        if (mediaId) {
            coveredAmsObjectIds.add(mediaId);
        }

        const objectIdFromUrl = getAmsObjectIdFromUrl(url);

        if (objectIdFromUrl) {
            coveredAmsObjectIds.add(objectIdFromUrl);
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
        if (typeof objectId !== 'string' || coveredAmsObjectIds.has(objectId)) {
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

        const previewUrl = firstString(file.filePreview?.previewUrl);
        const mediaUrl = getFileMediaUrl(file);

        if (!mediaUrl && !previewUrl) {
            continue;
        }

        if (previewUrl && isAmsMediaUrl(previewUrl)) {
            const previewMediaId = getFileMediaId(file, previewUrl);

            addTarget(targetsByKey, {
                extension: getExtensionFromUrl(previewUrl),
                mediaId: previewMediaId,
                originalFilename: firstString(file.fileName, file.name, file.title),
                raw: file,
                source: 'file-preview',
                url: previewUrl,
            });
        }

        if (!mediaUrl || (previewUrl && mediaUrl === previewUrl)) {
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

function reportDownloadProgress(onProgress, type, count = 1) {
    if (onProgress && count > 0) {
        onProgress({ count, type });
    }
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
 * @param {(event: {type: 'discovered' | 'downloaded' | 'failed' | 'skipped', count: number}) => void} [options.onProgress] - Progress callback.
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
    onProgress,
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
        reportDownloadProgress(onProgress, 'discovered', mediaTargets.length);

        for (const media of mediaTargets) {
            database.upsertMessageMedia(conversationId, messageId, media);

            const downloadedMedia = database.getDownloadedMessageMedia(conversationId, messageId, media.mediaId);

            if (downloadedMedia?.local_path) {
                const downloadedAbsolutePath = path.isAbsolute(downloadedMedia.local_path)
                    ? downloadedMedia.local_path
                    : path.join(process.cwd(), downloadedMedia.local_path);

                if (fs.existsSync(downloadedAbsolutePath) && !isCorruptDownloadedFile(downloadedAbsolutePath, media.extension)) {
                    totals.skipped += 1;
                    reportDownloadProgress(onProgress, 'skipped');
                    continue;
                }

                if (fs.existsSync(downloadedAbsolutePath)) {
                    fs.unlinkSync(downloadedAbsolutePath);
                }

                database.resetMessageMediaForRetry(conversationId, messageId, media.mediaId);
            }

            const existing = database.getMessageMedia(conversationId, messageId, media.mediaId, media.url);

            if (
                existing?.download_status === 'failed'
                && typeof existing.error === 'string'
                && (
                    (existing.error.includes('(404)') && media.url.includes('asm.skype.com'))
                    || existing.error.includes('SharePoint access denied')
                )
            ) {
                totals.skipped += 1;
                reportDownloadProgress(onProgress, 'skipped');
                continue;
            }

            if (existing?.local_path && fs.existsSync(existing.local_path)) {
                const existingAbsolutePath = path.isAbsolute(existing.local_path)
                    ? existing.local_path
                    : path.join(process.cwd(), existing.local_path);

                if (isCorruptDownloadedFile(existingAbsolutePath, media.extension)) {
                    fs.unlinkSync(existingAbsolutePath);
                } else {
                    if (existing.download_status !== 'downloaded') {
                        database.markMessageMediaDownloaded(conversationId, messageId, media, {
                            byteSize: fs.statSync(existingAbsolutePath).size,
                            contentType: existing.content_type ?? null,
                            localPath: existing.local_path,
                        });
                    }

                    totals.skipped += 1;
                    reportDownloadProgress(onProgress, 'skipped');
                    continue;
                }
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
                if (isCorruptDownloadedFile(expectedPath.absolutePath, media.extension)) {
                    fs.unlinkSync(expectedPath.absolutePath);
                } else {
                    if (!existing?.local_path || !pathsMatch(existing.local_path, expectedPath.relativePath) || existing.download_status !== 'downloaded') {
                        database.markMessageMediaDownloaded(conversationId, messageId, media, {
                            byteSize: fs.statSync(expectedPath.absolutePath).size,
                            contentType: existing?.content_type ?? null,
                            localPath: expectedPath.relativePath,
                        });
                    }

                    totals.skipped += 1;
                    reportDownloadProgress(onProgress, 'skipped');
                    continue;
                }
            }

            downloadTasks.push({ media, messageId });
        }
    }

    await runWithConcurrency(downloadTasks, concurrency, async ({ media, messageId }) => {
        try {
            const urlsToTry = media.source === 'file' ? getFileDownloadUrls(media) : [media.url];
            let response = null;
            let lastError = null;

            for (const downloadUrl of urlsToTry) {
                try {
                    const candidate = await api.downloadMedia(downloadUrl);

                    if (isHtmlPayload(candidate.buffer, candidate.contentType)) {
                        lastError = new Error(`Teams media request returned HTML instead of file content (${downloadUrl})`);
                        continue;
                    }

                    response = candidate;
                    break;
                } catch (error) {
                    lastError = error;
                    const message = error instanceof Error ? error.message : String(error);
                    const isSharePointCandidate = downloadUrl.includes('sharepoint') || downloadUrl.includes('graph.microsoft.com');
                    const isRetriableSharepoint = isSharePointCandidate
                        && media.source === 'file'
                        && !message.includes('SharePoint access denied')
                        && (message.includes('(401)') || message.includes('(403)') || message.includes('(404)'));

                    if (!isRetriableSharepoint) {
                        throw error;
                    }
                }
            }

            if (!response) {
                throw lastError ?? new Error('Teams media download failed.');
            }

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
            reportDownloadProgress(onProgress, 'downloaded');
        } catch (error) {
            database.markMessageMediaFailed(conversationId, messageId, media, error);
            totals.failed += 1;
            reportDownloadProgress(onProgress, 'failed');
        }
    });

    return totals;
}
