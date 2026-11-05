# Task Checklist for AXION AI Agents CLI v1.4.0

## 1. Custom Provider (High Priority)
- [ ] Add `CustomProvider` type to types.ts
- [ ] Update ConfigManager to store multiple custom providers
- [ ] Add validation for unique provider names
- [ ] Add persistence for custom providers
- [ ] Update `/provider` command handler for custom providers
- [ ] Add ability to switch between saved providers without re-entering credentials

## 2. UI/UX Output AI (High Priority)
- [ ] Modify Agent.ts to show step-by-step actions instead of raw code
- [ ] Add verbose/debug mode option
- [ ] Ensure sensitive data (API keys, secrets) are not displayed
- [ ] Update messages to use Indonesian

## 3. Confirm/Permissions for Dangerous Actions (High Priority)
- [ ] Add `DangerousActionPermission` type (Always Allow / Always Ask / Always Deny)
- [ ] Update PermissionSettings in types.ts
- [ ] Update ConfigManager to handle new permission structure
- [ ] Update `/permissions` command handler
- [ ] Apply permission checks in ShellTool and other dangerous tools
- [ ] Add audit logging for allowed actions

## 4. Folder/File Structure (Medium Priority)
- [ ] Verify buildSystemPrompt() already provides folder structure (already implemented)
- [ ] Ensure .gitignore is respected
- [ ] Ensure path traversal protection

## 5. Run Tests Locally
- [ ] Run existing tests
- [ ] Add new tests for:
  - [ ] Multiple custom providers
  - [ ] Duplicate provider name rejection
  - [ ] Persistent custom provider storage
  - [ ] Provider switching without re-entry
  - [ ] Step-by-step AI output
  - [ ] /permissions with Allow/Ask/Deny
  - [ ] Folder structure injection
  - [ ] Version bump and documentation

## 6. Update Version Files
- [ ] Update version.json to 1.4.0
- [ ] Update update-info.json to 1.4.0
- [ ] Update package.json version

## 7. Update CHANGELOG, README.md
- [ ] Update CHANGELOG.md with v1.4.0 changes
- [ ] Update README.md with new features
- [ ] Update i18n for new strings

## 8. Final Verification
- [ ] Build project
- [ ] Run all tests
- [ ] Verify no breaking changes
