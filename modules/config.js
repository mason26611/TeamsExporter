import path from 'node:path';

export const defaultDbPath = path.resolve('database', 'database.db');
export const defaultStorageStatePath = path.resolve('teams-state.json');
export const teamsBaseUrl = 'https://teams.cloud.microsoft';
export const meUrl = `${teamsBaseUrl}/api/csa/amer/api/v3/teams/users/me?isPrefetch=false&enableMembershipSummary=true&supportsAdditionalSystemGeneratedFolders=true&supportsSliceItems=true&enableEngageCommunities=false`;
export const profileUrl = `${teamsBaseUrl}/api/mt/amer/beta/users/fetchShortProfile?isMailAddress=false&enableGuest=true&skypeTeamsInfo=true&canBeSmtpAddress=false&includeIBBarredUsers=true&includeDisabledAccounts=true`;
export const initialMessagesUrl = `${teamsBaseUrl}/api/chatsvc/amer/v1/users/ME/conversations/IDHERE/messages?pageSize=200`;
export const messageRequestPrefix = `${teamsBaseUrl}/api/chatsvc/amer/v1/users/ME/conversations/`;
