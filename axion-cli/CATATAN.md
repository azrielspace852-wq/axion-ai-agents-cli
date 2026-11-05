# CATATAN — Update v1.1.0 → v1.2.0 (catatan jujur verifikasi)

Tanggal: 2026-11-05

## Yang TERVERIFIKASI di lingkungan ini (sandbox, Node v22, tanpa API key, tanpa TTY interaktif)

- `npm run build` lolos 0 error TypeScript; `dist/index.js` ada + executable (mode 755).
- `dist/version.json` dan `dist/update-info.json` ter-copy ke dist saat build.
- `npm test` lolos SEMUA 21 test (termasuk assertion versi 1.2.0 dan gemma-4 off tanpa thinkingConfig).
- `node dist/index.js --version` mencetak `1.2.0` (dibaca dari `dist/version.json`, fallback ke konstanta VERSION).
- `node dist/index.js update` dengan `AXION_UPDATE_DRY_RUN=1` mencetak perintah persis:
  `curl -fsSL https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/install.sh | bash`
  (URL persis sesuai spesifikasi). Eksekusi nyata TIDAK dijalankan agar tidak mengubah environment.
- `install.sh` lolos regression test bawaan (fake node/fake npm, staging/backup, symlink axion-cli exit 0).
  Symlink `axn-cli` ditambahkan di samping `axion-cli`; logika staging/backup tidak diubah.
- Non-TTY smoke: pipe `/exit` ke `node dist/index.js` → banner, onboarding help, prompt, exit 0.
- API `appendMessage()` di ConversationStore dipertahankan apa adanya (test mengandalkannya).

## Yang TIDAK dapat diverifikasi nyata di lingkungan ini (perlu environment nyata)

1. **Provider API nyata**: Google AI Studio / OpenAI-compatible `chat()` membutuhkan API key valid +
   jaringan. Di sini hanya diuji dengan mock `axios.post` (test Gemini/OpenAI-compatible lolos).
   Perilaku `maxOutputTokens` yang diteruskan, `thinking off` untuk gemma-4, dan trimming
   `maxInputTokens` belum diuji terhadap API sungguhan.
2. **Interaksi TUI manual (TTY)**: cleanup menu `select()` setelah dipilih, popup saran command
   (ArrowUp/ArrowDown/Enter), spinner thinking, dan persistent input prompt — secara logika kode
   sudah ditulis untuk membersihkan baris (`\x1b[J`, cursor-up) dan memulihkan raw mode/keypress,
   tapi tidak bisa diverifikasi visual di sandbox non-interaktif. Disarankan uji manual di terminal nyata.
3. **Fetch remote `update-info.json`**: URL
   `https://raw.githubusercontent.com/azrielspace852-wq/axion-ai-agents-cli/main/update-info.json`
   adalah path yang masuk akal tetapi TIDAK diverifikasi benar-benar ada di repo (repo mungkin belum
   mem-publish file itu). Fallback ke `dist/update-info.json` lokal sudah diimplementasikan dan
   didokumentasikan; jika remote gagal/timeout, cek versi diam-diam menggunakan file lokal.
4. **`axn-cli update` nyata (curl | bash)**: hanya dry-run yang diuji. Menjalankan sungguhan akan
   meng-install/menimpa instalasi; tidak dilakukan di sini.
5. **Estimasi token `maxInputTokens`**: memakai pendekatan jujur `karakter/4`, bukan tokenizer asli
   (tidak ada dependensi tiktoken). Akurasi tidak dijamin; keterbatasan dicetak di output `/max-token`.
6. **Instalasi nyata via install.sh di Termux/Linux**: hanya diuji dengan fake node/npm. Instalasi
   sungguhan (download source, npm ci, build, symlink) tidak dijalankan.

## Keputusan implementasi (sesuai spesifikasi)

- `buildThinkingConfig`: untuk gemma-4 saat `off` → `return undefined` (tidak kirim thinkingConfig).
  Gemini 2.5 Flash `off` tetap mengirim `{thinkingBudget: 0}` (perilaku lama dipertahankan karena
  test tidak memintanya diubah dan itu cara valid mematikan thinking untuk family tersebut).
- OpenAICompatProvider tidak pernah mengirim parameter thinking (tidak ada perubahan).
- Buffering percakapan: pesan ditambah ke `conversation.messages` di memori (numbering benar),
  `flushConversation()` dipanggil di exit, SIGINT, newConversation, openConversation, /clear,
  dan sebelum list/backup/delete di handleConversation.
- `/models` memfilter `[...DEFAULT_MODELS, ...customModels]` berdasarkan `activeProvider`.
- `maxOutputTokens` diteruskan ke `provider.chat` (kedua provider sudah menghormatinya).
