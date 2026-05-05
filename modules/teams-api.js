import { initialMessagesUrl, meUrl, profileUrl } from './config.js';

/**
 * Builds the initial Teams messages URL for a chat.
 *
 * @param {string} chatId - Teams chat or conversation ID.
 * @returns {string} Messages API URL.
 */
export function buildMessagesUrl(chatId) {
    return initialMessagesUrl.replace('IDHERE', chatId);
}

/**
 * Reads JSON from a fetch response and throws helpful errors for failed requests.
 *
 * @param {Response} response - Fetch response object.
 * @returns {Promise<object>} Parsed JSON payload.
 */
async function readJsonResponse(response) {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(`Teams API request failed (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
    }

    return data;
}

/**
 * Requests JSON from Teams with an authorization token.
 *
 * @param {string} url - Request URL.
 * @param {{authorization: string, body?: unknown, method?: string}} options - Request options.
 * @returns {Promise<object>} Parsed JSON response.
 */
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

/**
 * Returns one-on-one chats from the Teams chat list.
 *
 * @param {Array<object>} chats - Raw Teams chats.
 * @returns {Array<object>} One-on-one chats.
 */
function getOneOnOneChats(chats) {
    return chats.filter((chat) => chat.isOneOnOne);
}

/**
 * Returns group chats from the Teams chat list.
 *
 * @param {Array<object>} chats - Raw Teams chats.
 * @returns {Array<object>} Group chat objects.
 */
export function getGroupChats(chats) {
    return chats
        .filter((chat) => !chat.isOneOnOne)
        .map((chat) => ({
            ...chat,
            estimatedTotalMessages: chat.lastMessage?.sequenceId ?? null,
        }));
}

/**
 * Creates a small Teams API client around captured auth tokens.
 *
 * @param {{me: string, messages: string, primary: string}} auth - Captured Teams authorization tokens.
 * @returns {{getDirectMessageUsers: (chats: Array<object>) => Promise<object>, getMe: () => Promise<object>, getMessagesPage: (url: string) => Promise<object>}} Teams API client.
 */
export function createTeamsApi(auth) {
    return {
        /**
         * Loads the signed-in user's Teams bootstrap payload.
         *
         * @returns {Promise<object>} Teams user payload.
         */
        getMe() {
            return requestJson(meUrl, {
                authorization: auth.me,
            });
        },

        /**
         * Fetches short profiles for one-on-one chat members and attaches chat metadata.
         *
         * @param {Array<object>} chats - Raw Teams chats.
         * @returns {Promise<object>} Teams profile response with chat IDs attached.
         */
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

        /**
         * Fetches a single messages page from Teams.
         *
         * @param {string} url - Messages page or sync-state URL.
         * @returns {Promise<object>} Messages payload.
         */
        getMessagesPage(url) {
            return requestJson(url, {
                authorization: auth.messages,
            });
        },
    };
}
