import chalk from 'chalk';

/**
 * Formats an unknown error value into a readable message.
 *
 * @param {unknown} error - Error-like value to format.
 * @returns {string} Human-readable error text.
 */
function formatError(error) {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }

    return String(error);
}

export const Logger = {
    /**
     * Prints a colored section header.
     *
     * @param {string} title - Header text to print.
     * @returns {void}
     */
    header(title) {
        console.log(chalk.bold.cyan(`\n${title}`));
        console.log(chalk.cyan('='.repeat(title.length)));
    },

    /**
     * Prints an informational message.
     *
     * @param {string} message - Message to print.
     * @returns {void}
     */
    info(message) {
        console.log(`${chalk.blue('info')} ${message}`);
    },

    /**
     * Prints a success message.
     *
     * @param {string} message - Message to print.
     * @returns {void}
     */
    success(message) {
        console.log(`${chalk.green('done')} ${message}`);
    },

    /**
     * Prints a warning message.
     *
     * @param {string} message - Message to print.
     * @returns {void}
     */
    warning(message) {
        console.warn(`${chalk.yellow('warn')} ${message}`);
    },

    /**
     * Prints an error message.
     *
     * @param {unknown} error - Error-like value to print.
     * @returns {void}
     */
    error(error) {
        console.error(`${chalk.red('error')} ${formatError(error)}`);
    },
};