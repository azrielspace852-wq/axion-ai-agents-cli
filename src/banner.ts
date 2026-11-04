import chalk from 'chalk';

export const VERSION = '1.0.0';

// ANSI Shadow style banner: "AXION CLI"
const BANNER = [
   █████╗ ██╗  ██╗██╗ ██████╗ ███╗   ██╗    ██████╗██╗     ██╗
██╔══██╗╚██╗██╔╝██║██╔═══██╗████╗  ██║   ██╔════╝██║     ██║
███████║ ╚███╔╝ ██║██║   ██║██╔██╗ ██║   ██║     ██║     ██║
██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╗██║   ██║     ██║     ██║
██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚████║   ╚██████╗███████╗██║
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝    ╚═════╝╚══════╝╚═╝
];

export function printBanner(): void {
  console.log(chalk.cyan(BANNER.join('\n')));
  console.log(chalk.dim('   AI Agents CLI By AXION Neuralis'));
  console.log(chalk.dim(`   v${VERSION} — type /help for commands, /exit to quit\n`));
}