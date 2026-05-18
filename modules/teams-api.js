import { initialMessagesUrl, meUrl, profileUrl } from './config.js';

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
        downloadMedia(url) {
            return requestBinary(url, {
                authorization: auth.messages,
            });
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
