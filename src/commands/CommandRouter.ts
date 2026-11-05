import { CommandContext, HandlerResult } from './CommandContext';
import * as H from './handlers';
import { t } from '../i18n';

// Canonical command list used by /help and the inline suggestion popup.
export const COMMAND_LIST: string[] = [
  '/help', '/exit', '/models', '/thinking', '/system', '/memory', '/api-key',
  '/permissions', '/tool-limit', '/max-tool-call', '/max-token', '/privacy-policy',
  '/provider', '/clear', '/conversation', '/language', '/feedback', '/access', '/acces',
];

export class CommandRouter {
  async route(input: string, ctx: CommandContext): Promise<HandlerResult> {
    const line = input.trim();
    if (!line.startsWith('/')) return {};
    const [cmdRaw, ...rest] = line.slice(1).split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    ctx.args = rest.join(' ');

    switch (cmd) {
      case 'feedback':
        return (await H.handleFeedback(ctx)) || {};
      case 'acces':
      case 'access':
        return (await H.handleAccess(ctx)) || {};
      case 'tool-limit':
      case 'tool-calls':
      case 'max-tool-call':
        return (await H.handleToolLimit(ctx)) || {};
      case 'max-token':
        return (await H.handleMaxToken(ctx)) || {};
      case 'privacy-policy':
        return (await H.handlePrivacyPolicy(ctx)) || {};
      case 'models':
        return (await H.handleModels(ctx)) || {};
      case 'thinking':
        return (await H.handleThinking(ctx)) || {};
      case 'system':
      case 'system-prompt':
      case 'instructions':
        return (await H.handleSystemPrompt(ctx)) || {};
      case 'memory':
        return (await H.handleMemory(ctx)) || {};
      case 'api-key':
      case 'apikey':
        return (await H.handleApiKey(ctx)) || {};
      case 'permissions':
        return (await H.handlePermissions(ctx)) || {};
      case 'provider':
        return (await H.handleProvider(ctx)) || {};
      case 'clear':
        return (await H.handleClear(ctx)) || {};
      case 'conversation':
      case 'conversations':
        return (await H.handleConversation(ctx)) || {};
      case 'language':
      case 'lang':
        return (await H.handleLanguage(ctx)) || {};
      case 'help':
      case '?':
        return (await H.handleHelp(ctx)) || {};
      case 'exit':
      case 'quit':
        return H.handleExit();
      default:
        ctx.repl.print(t('err.unknownCmd', { cmd }));
        return {};
    }
  }
}