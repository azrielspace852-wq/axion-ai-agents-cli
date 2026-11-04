import os from 'os';
import path from 'path';

// AXION_DATA_DIR allows portable/test installations to keep data outside the default home folder.
export const AXN_DIR = path.resolve(
  process.env.AXION_DATA_DIR || path.join(os.homedir(), '.axn-cli'),
);
export const MEMORY_DIR = path.join(AXN_DIR, 'memory');
export const CONVERSATIONS_DIR = path.join(AXN_DIR, 'conversations');
export const INSTRUCTIONS_DIR = path.join(AXN_DIR, 'instructions');
export const CONFIG_PATH = path.join(AXN_DIR, 'config.json');
