import { gzipSync } from 'node:zlib';

/**
 * Pauses execution for a fixed number of milliseconds.
 *
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
export function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Converts a value into a SQLite-friendly boolean integer.
 *
 * @param {unknown} value - Value to convert.
 * @returns {0 | 1 | null} Integer boolean or null when the input is not boolean-like.
 */
export function booleanToInteger(value) {
    if (value === true) {
        return 1;
    }

    if (value === false) {
        return 0;
    }

    return null;
}

/**
 * Serializes an object as JSON and compresses it for raw database storage.
 *
 * @param {unknown} value - Value to serialize and compress.
 * @returns {Buffer} Gzipped JSON payload.
 */
export function gzipJson(value) {
    return gzipSync(Buffer.from(JSON.stringify(value ?? null), 'utf8'));
}

/**
 * Stringifies a value for JSON columns while preserving nulls.
 *
 * @param {unknown} value - Value to stringify.
 * @returns {string | null} JSON string or null.
 */
export function stringifyJson(value) {
    if (value === undefined || value === null) {
        return null;
    }

    return JSON.stringify(value);
}

/**
 * Returns the first non-empty value from a list.
 *
 * @template T
 * @param {...(T | null | undefined)} values - Candidate values.
 * @returns {T | null} First non-empty value, or null.
 */
export function firstValue(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return null;
}
