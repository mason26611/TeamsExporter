import fs from 'fs';
import fetch from 'node-fetch';
import chalk from 'chalk';
import readline from 'readline'
import { chromium } from 'playwright';

const storageStatePath = 'teams-state.json';
const storageStateExists = fs.existsSync(storageStatePath);

// Authorization tokens
// Teams uses multiple different auth tokens for different endpoints; I hate it.
let PRIMARY_AUTH_TOKEN = null;
let ME_AUTH_TOKEN = null;
let MESSAGES_AUTH_TOKEN = null;

// State
let isStarted = false;

// Urls
const meUrl = "https://teams.cloud.microsoft/api/csa/amer/api/v3/teams/users/me?isPrefetch=false&enableMembershipSummary=true&supportsAdditionalSystemGeneratedFolders=true&supportsSliceItems=true&enableEngageCommunities=false";
const profileUrl = "https://teams.cloud.microsoft/api/mt/amer/beta/users/fetchShortProfile?isMailAddress=false&enableGuest=true&skypeTeamsInfo=true&canBeSmtpAddress=false&includeIBBarredUsers=true&includeDisabledAccounts=true";
const initialMessagesUrl = "https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/IDHERE/messages?pageSize=200";

// Initialize a playwright instance to login to Teams
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: storageStateExists ? storageStatePath : undefined });
const page = await context.newPage();
await page.goto('https://teams.cloud.microsoft');

function buildMessagesUrl(chatId) {
    return initialMessagesUrl.replace("IDHERE", chatId);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDirectMessageUsers(chats) {
    const usersMap = new Map();

    for (const chat of chats) {
        if (!chat.isOneOnOne) {
            continue;
        }

        const usersMri = chat.members[0].mri;
        usersMap.set(usersMri, chat.id);
    }

    const profiles = await fetch(profileUrl, {
        method: "POST",
        headers: {
            "authorization": PRIMARY_AUTH_TOKEN,
            "content-type": "application/json;charset=UTF-8",
        },
        body: JSON.stringify(Array.from(usersMap.keys())),
    });

    // Get the profile data and add the chat id to the profile
    const profilesData = await profiles.json();
    for (const profile of profilesData.value) {
        const chatId = usersMap.get(profile.mri);
        profile.id = chatId;
    }

    return profilesData;
}

function getGroupChats(chats) {
    const groupChats = [];
    for (const chat of chats) {
        if (chat.isOneOnOne) {
            continue;
        }

        groupChats.push(chat);
    }

    return groupChats;
}

async function selectChats(combinedChats, pageSize = 10) {
    const processedChats = [];

    for (const chat of combinedChats) {
        if (chat.displayName) {
            processedChats.push({
                name: chat.displayName,
                mri: chat.mri,
                id: chat.id,
            });
        }

        if (chat.title) {
            processedChats.push({
                name: chat.title,
                mri: chat.mri,
                id: chat.id,
            });
        }
    }

    let cursor = 0;
    let page = 0;
    const selected = new Set();

    const totalPages = Math.max(1, Math.ceil(processedChats.length / pageSize));

    readline.emitKeypressEvents(process.stdin);

    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    function getPageItems() {
        const start = page * pageSize;
        const end = start + pageSize;

        return processedChats.slice(start, end).map((chat, offset) => ({
            ...chat,
            index: start + offset,
        }));
    }

    function render() {
        console.clear();

        console.log("Select chats");
        console.log("↑/↓ move | Space select | ←/→ page | Enter confirm | Ctrl+C exit");
        console.log(`Page ${page + 1}/${totalPages} | Selected: ${selected.size}\n`);

        const pageItems = getPageItems();

        for (let i = 0; i < pageItems.length; i++) {
            const chat = pageItems[i];

            const pointer = i === cursor ? "➜" : " ";
            const bubble = selected.has(chat.index) ? "●" : "○";

            console.log(`${pointer} ${bubble} ${chat.name}`);
        }
    }

    return new Promise((resolve) => {
        render();

        process.stdin.on("keypress", (_str, key) => {
            if (key.ctrl && key.name === "c") {
                process.exit();
            }

            const pageItems = getPageItems();

            if (key.name === "up") {
                cursor = Math.max(0, cursor - 1);
                render();
            }

            if (key.name === "down") {
                cursor = Math.min(pageItems.length - 1, cursor + 1);
                render();
            }

            if (key.name === "left") {
                page = Math.max(0, page - 1);
                cursor = 0;
                render();
            }

            if (key.name === "right") {
                page = Math.min(totalPages - 1, page + 1);
                cursor = 0;
                render();
            }

            if (key.name === "space") {
                const selectedIndex = pageItems[cursor]?.index;

                if (selectedIndex !== undefined) {
                    if (selected.has(selectedIndex)) {
                        selected.delete(selectedIndex);
                    } else {
                        selected.add(selectedIndex);
                    }
                }

                render();
            }

            if (key.name === "return") {
                if (process.stdin.isTTY) {
                    process.stdin.setRawMode(false);
                }

                console.clear();

                const chosenChats = [...selected].map(index => processedChats[index]);
                resolve(chosenChats);
            }
        });
    });
}

async function getMessages(chatId) {
    const messagesUrl = buildMessagesUrl(chatId);
    const initialMessagesResponse = await fetch(messagesUrl, {
        method: "GET",
        headers: {
            "authorization": MESSAGES_AUTH_TOKEN,
        }
    });

    const messagesData = await initialMessagesResponse.json();
    let backwardsLink = messagesData._metadata.backwardLink; // Holds the link to the previous page of messages
    let latestMessages = messagesData.messages;

    // Loop through request 
    while (latestMessages.length > 0) {
        const messagesResponse = await fetch(backwardsLink, {
            method: "GET",
            headers: {
                "authorization": MESSAGES_AUTH_TOKEN,
            }
        });

        const messagesData = await messagesResponse.json();

        console.log(messagesData);

        backwardsLink = messagesData._metadata.backwardLink;
        latestMessages = messagesData.messages;
        await sleep(2000);
    }

    return messagesData;
}

async function start() {
    // Save state so that we do not have to login every time we start the script
    await context.storageState({ path: "teams-state.json" });
    browser.close();

    const meResponse = await fetch(meUrl, {
        method: "GET",
        headers: {
            "authorization": ME_AUTH_TOKEN,
        }
    });

    const meData = await meResponse.json();

    // Collect all one-on-one chats for the user
    const chats = meData.chats;
    const directMessageUsers = await getDirectMessageUsers(chats);
    const groupChats = getGroupChats(chats);

    const combinedChats = [];
    combinedChats.push(...directMessageUsers.value);
    combinedChats.push(...groupChats);

    const selectedChats = await selectChats(combinedChats);
    console.log(selectedChats);
    
    for (const chat of selectedChats) {
        const messages = await getMessages(chat.id);
    }    
}

page.on("request", async (request) => {
    const requestUrl = request.url();
    const headers = request.headers();
    if (requestUrl.includes(meUrl)) {
        ME_AUTH_TOKEN = headers.authorization;
    }

    if (requestUrl.includes(profileUrl)) {
        PRIMARY_AUTH_TOKEN = headers.authorization;
    }

    if (requestUrl.includes("https://teams.cloud.microsoft/api/chatsvc/amer/v1/users/ME/conversations/")) {
        MESSAGES_AUTH_TOKEN = headers.authorization;
        console.log("SET");
    }

    if (PRIMARY_AUTH_TOKEN && ME_AUTH_TOKEN && MESSAGES_AUTH_TOKEN && !isStarted) {
        isStarted = true;
        start();
    }
});