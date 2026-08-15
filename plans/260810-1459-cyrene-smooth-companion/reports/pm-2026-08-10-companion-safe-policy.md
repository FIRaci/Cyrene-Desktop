# Companion-safe policy progress

Status: implemented and under final verification as part of the broader in-progress Cyrene plan.

Delivered:

- Network and registered read/observation/input tools remain available.
- Filesystem-write, shell, and arbitrary MCP-install tools are hidden from interactive and scheduled model catalogs.
- Permission checks deny filesystem mutation and command execution even if a tool call bypasses catalog generation.
- Persisted elevated agent permission is migrated back to the fixed companion-safe profile.
- Screen observation is session-authorized per the owner's explicit request; system-audio metadata awareness defaults on for new/unconfigured settings and remains revocable.
- Tool risk classification fails closed when omitted.

Verification evidence:

- Focused policy/sensory tests: 17 passed.
- Main TypeScript build: passed.
- Full-suite and adversarial re-review delegated; final results pending at report creation.

The overall six-phase plan remains in progress; this report does not mark unrelated persona, idle/emotion, performance, or packaging acceptance items complete.
