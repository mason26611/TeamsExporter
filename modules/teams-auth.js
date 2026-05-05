import fs from 'node:fs';
import { chromium } from 'playwright';
import { meUrl, messageRequestPrefix, profileUrl, teamsBaseUrl } from './config.js';

const meEndpoint = meUrl.split('?')[0];
const profileEndpoint = profileUrl.split('?')[0];

/**
 * Checks whether a request URL is a Teams API URL that can carry a reusable auth token.
 *
 * @param {string} requestUrl - Request URL from Playwright.
 * @returns {boolean} True when the URL belongs to the Teams cloud API.
 */
function isTeamsApiRequest(requestUrl) {
    return requestUrl.startsWith(`${teamsBaseUrl}/api/`);
}

/**
 * Extracts the authorization header from a Playwright request.
 *
 * @param {import('playwright').Request} request - Playwright request object.
 * @returns {string | null} Authorization header, when present.
 */
function getAuthorizationHeader(request) {
    return request.headers().authorization ?? null;
}

/**
 * Determines whether all required Teams tokens have been captured.
 *
 * @param {{me: string | null, messages: string | null, primary: string | null}} tokens - Current token state.
 * @returns {boolean} True when enough tokens are available to use the API.
 */
function hasRequiredTokens(tokens) {
    return Boolean(tokens.me && tokens.messages && (tokens.primary || tokens.me));
}

/**
 * Captures Teams authorization tokens by opening a real Teams browser session.
 *
 * @param {{storageStatePath: string, onStatus?: (message: string) => void}} options - Capture options.
 * @returns {Promise<{me: string, messages: string, primary: string}>} Captured authorization tokens.
 */
export async function captureTeamsAuth({ storageStatePath, onStatus = () => {} }) {
    const storageStateExists = fs.existsSync(storageStatePath);
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        storageState: storageStateExists ? storageStatePath : undefined,
    });
    const page = await context.newPage();
    const tokens = {
        me: null,
        messages: null,
        primary: null,
    };

    onStatus(storageStateExists ? 'Reusing saved Teams browser session...' : 'Opening Teams so you can sign in...');

    try {
        const capturedTokens = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timed out waiting for Teams auth tokens. Sign in to Teams and let the page finish loading, then try again.'));
            }, 180000);

            /**
             * Stores useful authorization tokens from a Teams request.
             *
             * @param {import('playwright').Request} request - Playwright request object.
             * @returns {void}
             */
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

        console.log(capturedTokens);
        return capturedTokens;
    } finally {
        await browser.close();
    }
}
