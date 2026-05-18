import chalk from 'chalk';

function formatError(error) {
    if (error instanceof Error) {
        return error.stack ?? error.message;
    }

    return String(error);
}

export const Logger = {
    header(title) {
        console.log(chalk.bold.cyan(`\n${title}`));
        console.log(chalk.cyan('='.repeat(title.length)));
    },

    info(message) {
        console.log(`${chalk.blue('info')} ${message}`);
    },

    success(message) {
        console.log(`${chalk.green('done')} ${message}`);
    },

    warning(message) {
        console.warn(`${chalk.yellow('warn')} ${message}`);
    },

    error(error) {
        console.error(`${chalk.red('error')} ${formatError(error)}`);
    },
};