import { gunzipSync, gzipSync } from 'node:zlib';

export function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function booleanToInteger(value) {
    if (value === true) {
        return 1;
    }

    if (value === false) {
        return 0;
    }

    return null;
}

export function gzipJson(value) {
    return gzipSync(Buffer.from(JSON.stringify(value ?? null), 'utf8'));
}

export function gunzipJson(value) {
    return JSON.parse(gunzipSync(value).toString('utf8'));
}

export function stringifyJson(value) {
    if (value === undefined || value === null) {
        return null;
    }

    return JSON.stringify(value);
}

export function firstValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return null;
}
