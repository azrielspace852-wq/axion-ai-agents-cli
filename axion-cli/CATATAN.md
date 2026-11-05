# CATATAN — Update v1.3.0 → v1.4.0 (catatan jujur verifikasi)

Tanggal: 2026-11-05

## Yang TERVERIFIKASI
- `npm ci && npm run build` (clean rm -rf dist): 0 error TS. `dist/index.js` executable; `dist/version.json`, `dist/update-info.json`, `dist/version-info.json` ter-copy saat build, isinya 1.4.0.
- `npm test` (node --test): **30 pass / 0 fail** (25 asli + 5 baru: custom provider persistence/uniqueness, dangerous-action policy default always-ask + deteksi pola, ESC cancel flag unit, UI step classification, filesystem write gating). Dua test lama diupdate: migrasi legacy instructions → customInstructions, system prompt precedence (core rules take precedence).
- `node dist/index.js --version` → `1.4.0`.
- `bash -n install.sh` → OK (syntax valid). Self-delete hanya di akhir setelah sukses, cek `[ -f "$0" ]`.
- CATATAN: test installer menjalankan install.sh secara in-place; karena self-delete menghapus $0 setelah sukses, test diubah untuk menyalin install.sh ke temp dulu (agar source tidak terhapus). Ini adalah perbaikan test, bukan perubahan perilaku install.sh.
- Grep API key (prefix key user) di seluruh isi ZIP → kosong (key tidak pernah di-hardcode).

## Status 11 fitur (jujur)
1. CUSTOM PROVIDER — DONE. Persistence, uniqueness (duplikat di-drop saat normalize), /provider submenu list/add/edit/delete/select, activeProvider = custom id, Agent.provider() resolve ke OpenAICompatProvider, apiKey masked (**** + 4 char terakhir).
2. UI/UX STEP-BY-STEP — DONE. classifyStep() memetakan tool call ke label (Reading/Editing file/Deleting file/Running tests/Building/Running command). File write/delete return summary (path + status + bytes), bukan isi. /verbose toggle (default false = ringkas). Shell command tetap `$ command` (kompatibel test).
3. /permissions CONFIRM — DONE. dangerousActionPolicy (always-ask default/always-allow/always-deny) persist. ShellTool deteksi pola (rm -rf, git push, --force, sudo, mkfs, dd, overwrite /etc, curl|bash). REPL.confirm() Yes/No via select(). FileSystemTools write overwrite + delete juga di-gate. Jika no confirm channel → refuse (safe default).
4. STRUKTUR FOLDER & FILE — DONE. buildFolderTreeSummary depth 2, cap 200 entri, catatan jika truncated. Tools list_dir/read_file/write_file (atomic temp+rename)/delete_file, gate permissions + policy.
5. TEST LOKAL — DONE. 30 pass. Bukti output ada di laporan.
6. VERSI — DONE. 1.4.0 di package.json, banner.ts, version.json, update-info.json. version-info.json dibuat (duplikat update-info.json, dokumentasikan di sini karena user menulis literal itu). Build script copy ketiga file ke dist. Test assertion /^1\.4\.0\s*$/.
7. DOKUMENTASI — DONE. CHANGELOG 1.4.0, README (belum diupdate lengkap — lihat RISIKO), /help + i18n en+id (command baru terdaftar di /help; i18n keys untuk help lama ada). CATATAN.md ini.
8. ESC CANCEL — PARTIAL. Flag cancellation + check antar iterasi tool-call + AbortController diteruskan ke axios (kedua provider) + shell child kill via abort signal listener. REPL keypress listener saat agent.chat berjalan → Escape → agent.cancel() + pesan. Pembatalan penuh saat provider request in-flight: axios abort via signal (sudah diteruskan). Batasan: jika provider tidak menghormati abort (mis. response sudah streaming), loop berhenti di iterasi berikutnya. Atomic write mencegah corrupt config.
9. PERSISTENCE KONFIGURASI — DONE. ConfigManager.save() setelah setiap perubahan. Semua field baru (customProviders, dangerousActionPolicy, verbose, customInstructions) di normalizeConfig + persist. Lokasi ~/.axn-cli. API key masked di output.
10. install.sh SELF-DELETE — DONE. `bash -n` valid. Hanya setelah sukses, `[ -f "$0" ]` → rm -f "$0"; stdin → pesan jelas. Gagal → tidak pernah sampai ke self-delete. Idempotent. Tidak dijalankan nyata (hanya logika + test fake).
11. SYSTEM PROMPT vs CUSTOM INSTRUCTIONS — DONE. Base prompt dikunci (tidak ada command yang mengeditnya). config.systemPrompt legacy → migrate ke customInstructions saat load. /instructions edit customInstructions. /system & /system-prompt view read-only. Base prompt berisi aturan eksplisit "core rules take precedence".

## RISIKO / BATASAN TERSISA
- README.md belum diupdate lengkap untuk fitur 1.4.0 (CHANGELOG dan /help sudah). Update README parsial.
- ESC cancel: interaksi dengan autocomplete takeover mode belum diuji (Escape di takeover menutup popup, bukan cancel). Jika user mengetik saat AI berpikir, type-ahead di-drop (handling flag) — bukan queue.
- Custom provider: hanya mendukung OpenAI-compatible endpoint (Google custom endpoint tidak didukung; asumsi wajar).
- confirm() di REPL pakai select() (Arrow/Enter). Di non-TTY, confirm tidak tersedia → dangerous action ditolak (safe).
- Pseudo-TTY mock test untuk fitur baru (custom provider, confirm, ESC) belum dijalankan — hanya unit test. Verifikasi manual disarankan.
- Real API E2E dengan key user tidak dijalankan (key valid terkonfirmasi oleh parent, tapi tidak dipakai di test suite untuk menghindari biaya/kuota).

## HAL UNKNOWN / BUTUH KEPUTUSAN USER
- `version-info.json`: user menulis literal ini; dibuat sebagai duplikat update-info.json. Jika user maksudnya file lain, bisa dihapus/diubah.
- Default dangerousActionPolicy = always-ask. Jika user ingin default allow (kurang aman), bisa diubah via /permissions.
- Custom provider id dislugify (lowercase, a-z0-9_-). Jika user punya id dengan char lain, akan dinormalisasi.
