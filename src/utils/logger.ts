import chalk from 'chalk';

export const log = {
  info: (m: string) => console.log(chalk.cyan('ℹ'), m),
  success: (m: string) => console.log(chalk.green('✔'), m),
  warn: (m: string) => console.log(chalk.yellow('⚠'), m),
  error: (m: string) => console.error(chalk.red('✖'), m),
  dim: (m: string) => console.log(chalk.dim(m)),
};