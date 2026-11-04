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
} from '../types';

export const DEFAULT_CONFIG: AxionConfig = {
  version: 1,
  language: 'en',
  activeProvider: 'google-ai-studio',
  google: { apiKey: '' },
  openaiCompatible: { baseUrl: '', apiKey: '' },
  model: DEFAULT_MODEL_ID,
  customModels: [],
  thinkingLevel: 'medium',
  instructions: '',
  permissions: { ...DEFAULT_PERMISSIONS },
};

export class ConfigManager {
  private config: AxionConfig;

  constructor() {
    this.ensureDirs();
    this.config = this.load();
  }

  private ensureDirs(): void {
    for (const dir of [AXN_DIR, MEMORY_DIR, CONVERSATIONS_DIR, INSTRUCTIONS_DIR]) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // ignore; surfaced later on write
      }
    }
  }

  private load(): AxionConfig {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw) as Partial<AxionConfig>;
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          google: { ...DEFAULT_CONFIG.google, ...(parsed.google || {}) },
          openaiCompatible: {
            ...DEFAULT_CONFIG.openaiCompatible,
            ...(parsed.openaiCompatible || {}),
          },
          permissions: { ...DEFAULT_PERMISSIONS, ...(parsed.permissions || {}) },
          customModels: Array.isArray(parsed.customModels) ? parsed.customModels : [],
        };
      }
    } catch {
      // fall back to defaults on corrupt config
    }
    return { ...DEFAULT_CONFIG, permissions: { ...DEFAULT_PERMISSIONS } };
  }

  get(): AxionConfig {
    return this.config;
  }

  save(): void {
    this.ensureDirs();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
  }

  update(patch: Partial<AxionConfig>): void {
    this.config = { ...this.config, ...patch };
    this.save();
  }
}