import { ProviderChatOptions, ProviderChatResult } from '../../types';

export interface BaseProvider {
  chat(opts: ProviderChatOptions): Promise<ProviderChatResult>;
}