# T1 Notes

- Add a repo-root `skills/` catalog so `npx skills add recodeee/` and `npx skills add recodeee/gitguardex` both have a documented path into the Guardex skills picker.
- Keep the existing `gx install-agent-skills` path for Codex/Claude user-home startup files; this change adds a generic skills-installer path, not a replacement.
- Keep the merge-helper runbook and README aligned with the new root skill paths so future skill-only lanes do not miss them.
- Clarify in README that the picker shows `gitguardex`, not a separate `guardex` skill, because `guardex` is a legacy CLI alias rather than a second repo skill entry.
