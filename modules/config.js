import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function readBooleanEnv(name, defaultValue) {
    const value = process.env[name];

    if (value === undefined || value === '') {
        return defaultValue;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const defaultDbPath = path.resolve('database', 'database.db');
export const defaultMediaDir = path.resolve(process.env.TEAMS_MEDIA_DIR || 'media');
export const defaultStorageStatePath = path.resolve('teams-state.json');
export const downloadMediaByDefault = readBooleanEnv('TEAMS_DOWNLOAD_MEDIA', true);
export const playwrightBrowserName = (process.env.PLAYWRIGHT_BROWSER || 'chromium').toLowerCase();
export const playwrightChannel = process.env.PLAYWRIGHT_CHANNEL || null;
export const playwrightHeadless = readBooleanEnv('PLAYWRIGHT_HEADLESS', false);
export const teamsBaseUrl = 'https://teams.cloud.microsoft';
export const meUrl = `${teamsBaseUrl}/api/csa/amer/api/v3/teams/users/me?isPrefetch=false&enableMembershipSummary=true&supportsAdditionalSystemGeneratedFolders=true&supportsSliceItems=true&enableEngageCommunities=false`;
export const profileUrl = `${teamsBaseUrl}/api/mt/amer/beta/users/fetchShortProfile?isMailAddress=false&enableGuest=true&skypeTeamsInfo=true&canBeSmtpAddress=false&includeIBBarredUsers=true&includeDisabledAccounts=true`;
export const initialMessagesUrl = `${teamsBaseUrl}/api/chatsvc/amer/v1/users/ME/conversations/IDHERE/messages?pageSize=200`;
export const messageRequestPrefix = `${teamsBaseUrl}/api/chatsvc/amer/v1/users/ME/conversations/`;
