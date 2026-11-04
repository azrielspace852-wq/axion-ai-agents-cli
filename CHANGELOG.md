# Changelog

## 1.0.1

- Reworked the installer to build and run regression tests in a staging directory, validate the CLI, refuse dangerous targets, and preserve the previous installation as a backup.
- Added a GitHub-ready README and included the complete GPL-3.0 license text.
- Added configuration normalization, corruption backup, atomic writes, and restrictive local file/directory permissions.
- Added safe ID validation and schema checks for conversation and memory storage.
- Added hidden terminal input for provider API keys.
- Preserved Gemini thought-signature parts and function-call IDs across saved conversations, and grouped parallel function responses according to the API protocol.
- Removed Gemini 3 sampling overrides and corrected Gemma 4, Gemini 3, and Gemini 2.5 model-specific thinking behavior.
- Aligned Gemini 3 reasoning configuration with `thinkingLevel`, kept Gemini 2.5 on `thinkingBudget`, and refreshed the built-in Gemini model list.
- Restricted page fetching to public HTTP(S) hosts, pinned validated DNS results to mitigate DNS rebinding, and revalidated redirects to block local/private network destinations.
- Bounded web search results, validated local shell working directories, and added core regression tests.
