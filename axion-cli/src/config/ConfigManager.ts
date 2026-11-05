import fs from 'fs';
import {
  AXN_DIR,
  CONFIG_PATH,
  MEMORY_DIR,
  CONVERSATIONS_DIR,
  INSTRUCTIONS_DIR,
} from './paths';
import {
  AxionConfig,
  DEFAULT_PERMISSIONS,
  DEFAULT_MODEL_ID,
  ProviderType,
  ThinkingLevel,
  CustomModel,
} from '../types';
import { ensurePrivateDir, writeJsonAtomically } from '../utils/jsonFile';

export const DEFAULT_CONFIG: AxionConfig = {
  version: 1,
  language: 'en',
  activeProvider: 'google-ai-studio',
  google: { apiKey: '' },
  openaiCompatible: { baseUrl: '', apiKey: '' },
  model: DEFAULT_MODEL_ID,
  customModels: [],
  thinkingLevel: 'medium',
  systemPrompt: '',
  permissions: { ...DEFAULT_PERMISSIONS },
  accessScope: 'workspace',
  maxToolCallsPerRequest: 30,
  maxInputTokens: undefined,
  maxOutputTokens: undefined,
  hasCompletedOnboarding: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeTokenLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  return n >= 1 ? n : undefined;
}

function parseCustomModels(value: unknown): CustomModel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CustomModel => {
    if (!isRecord(item)) return false;
    return typeof item.id === 'string' && item.id.trim().length > 0 &&
      typeof item.label === 'string' &&
      (item.provider === 'google-ai-studio' || item.provider === 'openai-compatible');
  }).map((item) => ({
    id: item.id.trim(),
    label: item.label.trim() || item.id.trim(),
    provider: item.provider,
    ...(typeof item.baseUrl === 'string' && item.baseUrl.trim() ? { baseUrl: item.baseUrl.trim() } : {}),
  }));
}

function normalizeConfig(value: unknown, existingConfig: boolean): AxionConfig {
  const parsed = isRecord(value) ? value : {};
  const google = isRecord(parsed.google) ? parsed.google : {};
  const openai = isRecord(parsed.openaiCompatible) ? parsed.openaiCompatible : {};
  const permissions = isRecord(parsed.permissions) ? parsed.permissions : {};
  const provider: ProviderType = parsed.activeProvider === 'openai-compatible'
    ? 'openai-compatible'
    : 'google-ai-studio';
  const levels: ThinkingLevel[] = ['off', 'low', 'medium', 'high', 'max'];
  const requestedLevel = parsed.thinkingLevel;

  return {
    version: 1,
    language: parsed.language === 'id' ? 'id' : 'en',
    activeProvider: provider,
    google: { apiKey: stringValue(google.apiKey, '') },
    openaiCompatible: {
      baseUrl: stringValue(openai.baseUrl, ''),
      apiKey: stringValue(openai.apiKey, ''),
    },
    model: stringValue(parsed.model, DEFAULT_MODEL_ID).trim() || DEFAULT_MODEL_ID,
    customModels: parseCustomModels(parsed.customModels),
    thinkingLevel: levels.includes(requestedLevel as ThinkingLevel)
      ? requestedLevel as ThinkingLevel
      : DEFAULT_CONFIG.thinkingLevel,
    systemPrompt: stringValue(parsed.systemPrompt, stringValue(parsed.instructions, '')),
    accessScope: parsed.accessScope === 'global' ? 'global' : 'workspace',
    maxToolCallsPerRequest: Number.isInteger(parsed.maxToolCallsPerRequest)
      ? Math.min(100, Math.max(1, Number(parsed.maxToolCallsPerRequest)))
      : DEFAULT_CONFIG.maxToolCallsPerRequest,
    maxInputTokens: normalizeTokenLimit(parsed.maxInputTokens),
    maxOutputTokens: normalizeTokenLimit(parsed.maxOutputTokens),
    // Existing installations are treated as already onboarded; only a fresh config sees first-run help.
    hasCompletedOnboarding: typeof parsed.hasCompletedOnboarding === 'boolean'
      ? parsed.hasCompletedOnboarding
      : existingConfig,
    permissions: {
      webAccess: typeof permissions.webAccess === 'boolean' ? permissions.webAccess : DEFAULT_PERMISSIONS.webAccess,
      searchAccess: typeof permissions.searchAccess === 'boolean' ? permissions.searchAccess : DEFAULT_PERMISSIONS.searchAccess,
      shellExec: typeof permissions.shellExec === 'boolean' ? permissions.shellExec : DEFAULT_PERMISSIONS.shellExec,
      fileRead: typeof permissions.fileRead === 'boolean' ? permissions.fileRead : DEFAULT_PERMISSIONS.fileRead,
      fileWrite: typeof permissions.fileWrite === 'boolean' ? permissions.fileWrite : DEFAULT_PERMISSIONS.fileWrite,
    },
  };
}

export class ConfigManager {
  private config: AxionConfig;

  constructor() {
    this.ensureDirs();
    this.config = this.load();
  }

  private ensureDirs(): void {
    for (const dir of [AXN_DIR, MEMORY_DIR, CONVERSATIONS_DIR, INSTRUCTIONS_DIR]) {
      ensurePrivateDir(dir);
    }
  }

  private load(): AxionConfig {
    if (!fs.existsSync(CONFIG_PATH)) return normalizeConfig(DEFAULT_CONFIG, false);
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return normalizeConfig(JSON.parse(raw) as unknown, true);
    } catch {
      // Preserve a damaged file for diagnosis before falling back to safe defaults.
      try {
        const backup = `${CONFIG_PATH}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.copyFileSync(CONFIG_PATH, backup);
        try { fs.chmodSync(backup, 0o600); } catch { /* best effort */ }
      } catch {
        // The fallback configuration remains usable even if a backup cannot be made.
      }
      return normalizeConfig(DEFAULT_CONFIG, true);
    }
  }

  get(): AxionConfig {
    return this.config;
  }

  needsOnboarding(): boolean {
    return !this.config.hasCompletedOnboarding;
  }

  save(): void {
    this.ensureDirs();
    writeJsonAtomically(CONFIG_PATH, this.config);
  }

  update(patch: Partial<AxionConfig>): void {
    this.config = normalizeConfig({ ...this.config, ...patch }, true);
    this.save();
  }
}
