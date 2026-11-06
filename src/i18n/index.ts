export type Lang = 'en' | 'id';

const dict: Record<Lang, Record<string, string>> = {
  en: {
    'app.subtitle': 'AI Agents CLI By AXION Neuralis',
    greeting: 'Welcome! Ask anything, or type /help to see commands.',
    bye: 'Goodbye!',
    prompt: 'you ❯ ',
    'agent.thinking': 'thinking…',
    'status.sending': 'Sending request…',
    'status.thinking': 'Thinking…',
    'status.receiving': 'Receiving response…',
    'status.tool': 'Running tool: {tool}…',
    'status.processing': 'Processing tool result…',
    'status.memory': 'Updating memory…',
    'status.current': '(current)',
    'rename.prompt': 'New conversation name',
    'rename.done': 'Conversation renamed.',
    'rename.cancelled': 'Rename cancelled.',
    'help.rename': 'Rename the current conversation',
    'err.noApiKey': 'No API key configured. Use /api-key to set it.',
    'err.unknownCmd': 'Unknown command: /{cmd}. Type /help for a list.',
    'help.title': 'Available commands',
    'help.models': 'List, select, and add custom models',
    'help.thinking': 'Set reasoning budget (off/low/medium/high/max)',
    'help.instructions': 'Set custom instructions (system prompt)',
    'help.memory': 'View and manage long-term memory',
    'help.apikey': 'Set or update the API key',
    'help.permissions': 'Manage agent permissions',
    'help.provider': 'Switch LLM provider',
    'help.clear': 'Clear screen and current context',
    'help.conversation': 'List/open/delete/backup conversations',
    'help.language': 'Change interface language (en/id)',
    'help.help': 'Show this help',
    'help.exit': 'Exit the app safely',
    'help.toolLimit': 'Set the maximum tool calls allowed per request (default: 30)',
    'help.maxToolCall': 'Alias for /tool-limit: maximum tool calls per request',
    'help.maxToken': 'Set optional input-token soft cap and output-token limit',
    'help.privacyPolicy': 'Show security and privacy information',
  },
  id: {
    'app.subtitle': 'AI Agents CLI By AXION Neuralis',
    greeting: 'Selamat datang! Tanyakan apa saja, atau ketik /help untuk melihat perintah.',
    bye: 'Sampai jumpa!',
    prompt: 'anda ❯ ',
    'agent.thinking': 'sedang berpikir…',
    'status.sending': 'Mengirim request…',
    'status.thinking': 'Berpikir…',
    'status.receiving': 'Menerima respons…',
    'status.tool': 'Menjalankan tool: {tool}…',
    'status.processing': 'Memproses hasil tool…',
    'status.memory': 'Memperbarui memori…',
    'status.current': '(saat ini)',
    'rename.prompt': 'Nama percakapan baru',
    'rename.done': 'Percakapan di-rename.',
    'rename.cancelled': 'Rename dibatalkan.',
    'help.rename': 'Ganti nama percakapan saat ini',
    'err.noApiKey': 'API key belum diatur. Gunakan /api-key untuk mengaturnya.',
    'err.unknownCmd': 'Perintah tidak dikenal: /{cmd}. Ketik /help untuk daftar.',
    'help.title': 'Perintah yang tersedia',
    'help.models': 'Lihat, pilih, dan tambah model custom',
    'help.thinking': 'Atur budget reasoning (off/low/medium/high/max)',
    'help.instructions': 'Atur instruksi custom (system prompt)',
    'help.memory': 'Lihat dan kelola memori jangka panjang',
    'help.apikey': 'Atur atau perbarui API key',
    'help.permissions': 'Kelola izin agen',
    'help.provider': 'Ganti provider LLM',
    'help.clear': 'Bersihkan layar dan konteks saat ini',
    'help.conversation': 'Lihat/buka/hapus/backup percakapan',
    'help.language': 'Ganti bahasa antarmuka (en/id)',
    'help.help': 'Tampilkan bantuan ini',
    'help.exit': 'Keluar dari aplikasi dengan aman',
    'help.toolLimit': 'Atur maksimal tool calls per request (default: 30)',
    'help.maxToolCall': 'Alias untuk /tool-limit: maksimal tool calls per request',
    'help.maxToken': 'Atur batas lembut token input dan batas token output',
    'help.privacyPolicy': 'Tampilkan informasi keamanan & privasi',
  },
};

let current: Lang = 'en';

export function setLanguage(lang: Lang): void {
  current = lang === 'id' ? 'id' : 'en';
}

export function getLanguage(): Lang {
  return current;
}

export function t(key: string, vars: Record<string, string> = {}): string {
  let str = (dict[current] && dict[current][key]) || dict.en[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    str = str.split(`{${k}}`).join(v);
  }
  return str;
}