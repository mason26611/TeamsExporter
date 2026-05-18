import fs from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import {
    meUrl,
    messageRequestPrefix,
    playwrightBrowserName,
    playwrightChannel,
    playwrightHeadless,
    profileUrl,
    teamsBaseUrl,
} from './config.js';

const meEndpoint = meUrl.split('?')[0];
const profileEndpoint = profileUrl.split('?')[0];
const browserTypes = {
    chromium,
    firefox,
    webkit,
};

function getConfiguredBrowserType() {
    const browserType = browserTypes[playwrightBrowserName];

    if (!browserType) {
        throw new Error(`Unsupported PLAYWRIGHT_BROWSER "${playwrightBrowserName}". Use chromium, firefox, or webkit.`);
    }

    return browserType;
}

function getLaunchOptions() {
    const options = {
        headless: playwrightHeadless,
    };

    if (playwrightChannel) {
        if (playwrightBrowserName !== 'chromium') {
            throw new Error('PLAYWRIGHT_CHANNEL is only supported when PLAYWRIGHT_BROWSER=chromium.');
        }

        options.channel = playwrightChannel;
    }

    return options;
}

function isTeamsApiRequest(requestUrl) {
    return requestUrl.startsWith(`${teamsBaseUrl}/api/`);
}

function getAuthorizationHeader(request) {
    return request.headers().authorization ?? null;
}

function hasRequiredTokens(tokens) {
    return Boolean(tokens.me && tokens.messages && (tokens.primary || tokens.me));
}

export async function captureTeamsAuth({ storageStatePath, onStatus = () => {} }) {
    const storageStateExists = fs.existsSync(storageStatePath);
    const browserType = getConfiguredBrowserType();
    const browser = await browserType.launch(getLaunchOptions());
    const context = await browser.newContext({
        storageState: storageStateExists ? storageStatePath : undefined,
    });
    const page = await context.newPage();
    const tokens = {
        me: null,
        messages: null,
        primary: null,
    };

    onStatus(
        storageStateExists
            ? `Reusing saved Teams browser session in ${playwrightBrowserName}...`
            : `Opening Teams in ${playwrightBrowserName} so you can sign in...`,
    );

    try {
        const capturedTokens = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for Teams auth tokens. Sign in to Teams and let the page finish loading, then try again.'));
            }, 180000);

            function onRequest(request) {
                const requestUrl = request.url();
                const authorization = getAuthorizationHeader(request);

                if (!authorization || !isTeamsApiRequest(requestUrl)) {
                    return;
                }

                tokens.primary ??= authorization;

                if (requestUrl.startsWith(meEndpoint)) {
                    tokens.me = authorization;
                }

                if (requestUrl.startsWith(profileEndpoint)) {
                    tokens.primary = authorization;
                }

                if (requestUrl.startsWith(messageRequestPrefix)) {
                    tokens.messages = authorization;
                }

                if (hasRequiredTokens(tokens)) {
                    clearTimeout(timeout);
                    page.off('request', onRequest);
                    resolve({
                        me: tokens.me,
                        messages: tokens.messages,
                        primary: tokens.primary ?? tokens.me,
                    });
                }
            }

            page.on('request', onRequest);
            page.goto(teamsBaseUrl).catch(reject);
        });

        await context.storageState({ path: storageStatePath });
        onStatus('Teams auth tokens captured and browser session saved.');

        return capturedTokens;
    } finally {
        await browser.close();
    }
}
