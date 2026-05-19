import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { request as playwrightRequest } from 'playwright';
import { initialMessagesUrl, meUrl, playwrightChannel, playwrightHeadless, profileUrl } from './config.js';

let cookieRequestContext = null;
let cookieRequestContextPath = null;
let browser = null;
let browserContext = null;
let browserContextPath = null;

export function buildMessagesUrl(chatId) {
    return initialMessagesUrl.replace('IDHERE', chatId);
}

async function readJsonResponse(response) {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(`Teams API request failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
    }

    return data;
}

async function requestJson(url, { authorization, body, method = 'GET' }) {
    const response = await fetch(url, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
            authorization,
            ...(body === undefined ? {} : { 'content-type': 'application/json;charset=UTF-8' }),
        },
        method,
    });

    return readJsonResponse(response);
}

async function requestBinary(url, { authorization }) {
    const response = await fetch(url, {
        headers: {
            authorization,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Teams media request failed (${response.status}): ${text.slice(0, 500)}`);
    }

    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type'),
        finalUrl: response.url,
    };
}

function needsCookieAuth(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();

        return (host.includes('sharepoint.com')
            || host.includes('office.com')
            || host.includes('office.net')
            || host.includes('onedrive.com'))
            && !url.includes('graph.microsoft.com');
    } catch {
        return false;
    }
}

async function getCookieRequestContext(storageStatePath) {
    if (!cookieRequestContext || cookieRequestContextPath !== storageStatePath) {
        if (cookieRequestContext) {
            await cookieRequestContext.dispose();
        }

        cookieRequestContext = await playwrightRequest.newContext({ storageState: storageStatePath });
        cookieRequestContextPath = storageStatePath;
    }

    return cookieRequestContext;
}

const browserLikeHeaders = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};
const sharePointAccessDeniedText = 'Sorry, you cannot access this document. Please contact the person who shared it with you.';

function hasSharePointAccessDeniedText(value) {
    return typeof value === 'string' && value.includes(sharePointAccessDeniedText);
}

async function requestBinaryWithCookies(url, storageStatePath) {
    const context = await getCookieRequestContext(storageStatePath);
    const response = await context.get(url, {
        headers: browserLikeHeaders,
        maxRedirects: 10,
    });

    if (!response.ok()) {
        const text = await response.text();
        throw new Error(`Teams media request failed (${response.status()}): ${text.slice(0, 500)}`);
    }

    const headers = response.headers();
    const buffer = Buffer.from(await response.body());

    if (headers['content-type']?.toLowerCase().includes('text/html')) {
        return requestBinaryWithBrowser(url, storageStatePath);
    }

    return {
        buffer,
        contentType: headers['content-type'] ?? null,
        finalUrl: response.url(),
    };
}

function getBrowserLaunchOptions() {
    const options = {
        headless: playwrightHeadless,
    };

    if (playwrightChannel) {
        options.channel = playwrightChannel;
    }

    return options;
}

async function resetCookieRequestContext() {
    if (cookieRequestContext) {
        await cookieRequestContext.dispose();
        cookieRequestContext = null;
        cookieRequestContextPath = null;
    }
}

async function getBrowserContext(storageStatePath) {
    if (!browser) {
        browser = await chromium.launch(getBrowserLaunchOptions());
    }

    if (!browserContext || browserContextPath !== storageStatePath) {
        if (browserContext) {
            await browserContext.close();
        }

        browserContext = await browser.newContext({
            acceptDownloads: true,
            storageState: storageStatePath,
        });
        browserContextPath = storageStatePath;
    }

    return browserContext;
}

async function requestBinaryWithBrowser(url, storageStatePath) {
    const context = await getBrowserContext(storageStatePath);
    const page = await context.newPage();

    try {
        const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const responseContentType = response?.headers()['content-type'] ?? null;

        if (responseContentType?.toLowerCase().includes('text/html')) {
            const bodyText = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');

            if (hasSharePointAccessDeniedText(bodyText)) {
                throw new Error(`SharePoint access denied: ${sharePointAccessDeniedText}`);
            }
        }

        const download = await downloadPromise;

        if (download) {
            const tempPath = path.join(os.tmpdir(), `teams-exporter-${Date.now()}-${download.suggestedFilename()}`);
            await download.saveAs(tempPath);
            const buffer = fs.readFileSync(tempPath);
            fs.unlinkSync(tempPath);
            await context.storageState({ path: storageStatePath });
            await resetCookieRequestContext();

            return {
                buffer,
                contentType: null,
                finalUrl: page.url(),
            };
        }

        if (!response?.ok()) {
            throw new Error(`Teams media request failed (${response?.status() ?? 'unknown'}): browser navigation failed`);
        }

        const headers = response.headers();
        const buffer = Buffer.from(await response.body());

        if (hasSharePointAccessDeniedText(buffer.toString('utf8'))) {
            throw new Error(`SharePoint access denied: ${sharePointAccessDeniedText}`);
        }

        await context.storageState({ path: storageStatePath });
        await resetCookieRequestContext();

        return {
            buffer,
            contentType: headers['content-type'] ?? null,
            finalUrl: response.url(),
        };
    } finally {
        await page.close();
    }
}

function getAmsFallbackUrls(url) {
    if (!url.includes('/views/imgo')) {
        return [url];
    }

    return [url, url.replace('/views/imgo', '/views/original')];
}

async function disposeCookieRequestContext() {
    if (cookieRequestContext) {
        await cookieRequestContext.dispose();
        cookieRequestContext = null;
        cookieRequestContextPath = null;
    }

    if (browserContext) {
        await browserContext.close();
        browserContext = null;
        browserContextPath = null;
    }

    if (browser) {
        await browser.close();
        browser = null;
    }
}

function getOneOnOneChats(chats) {
    return chats.filter((chat) => chat.isOneOnOne);
}

export function getGroupChats(chats) {
    return chats
        .filter((chat) => !chat.isOneOnOne)
        .map((chat) => ({
            ...chat,
            estimatedTotalMessages: chat.lastMessage?.sequenceId ?? null,
        }));
}

export function createTeamsApi(auth) {
    return {
        async downloadMedia(url) {
            const urlsToTry = getAmsFallbackUrls(url);
            let lastError = null;

            for (let index = 0; index < urlsToTry.length; index += 1) {
                const tryUrl = urlsToTry[index];

                try {
                    if (needsCookieAuth(tryUrl) && auth.storageStatePath && fs.existsSync(auth.storageStatePath)) {
                        try {
                            return await requestBinaryWithCookies(tryUrl, auth.storageStatePath);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);

                            if (!message.includes('(401)') && !message.includes('(403)')) {
                                throw error;
                            }

                            return await requestBinaryWithBrowser(tryUrl, auth.storageStatePath);
                        }
                    }

                    return await requestBinary(tryUrl, {
                        authorization: auth.messages,
                    });
                } catch (error) {
                    lastError = error;
                    const message = error instanceof Error ? error.message : String(error);
                    const canRetryAmsView = index < urlsToTry.length - 1 && message.includes('(400)');

                    if (!canRetryAmsView) {
                        throw error;
                    }
                }
            }

            throw lastError ?? new Error('Teams media download failed.');
        },

        async close() {
            await disposeCookieRequestContext();
        },

        getMe() {
            return requestJson(meUrl, {
                authorization: auth.me,
            });
        },

        async getDirectMessageUsers(chats) {
            const chatByMemberMri = new Map();

            for (const chat of getOneOnOneChats(chats)) {
                const memberMri = chat.members?.[0]?.mri;

                if (memberMri) {
                    chatByMemberMri.set(memberMri, chat);
                }
            }

            const profilesData = await requestJson(profileUrl, {
                authorization: auth.primary,
                body: [...chatByMemberMri.keys()],
                method: 'POST',
            });

            profilesData.value = (profilesData.value ?? []).map((profile) => {
                const sourceChat = chatByMemberMri.get(profile.mri);

                return {
                    ...profile,
                    id: sourceChat?.id,
                    estimatedTotalMessages: sourceChat?.lastMessage?.sequenceId ?? null,
                    sourceChat,
                };
            }).filter((profile) => profile.id);

            return profilesData;
        },

        getMessagesPage(url) {
            return requestJson(url, {
                authorization: auth.messages,
            });
        },
    };
}
