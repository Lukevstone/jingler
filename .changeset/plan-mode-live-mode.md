---
"@jingler/desktop": patch
---

Agents can now write their plan file and run read-only commands after switching to plan mode partway through a turn. Before, every tool call after the switch failed with "Permission denied". `command_inspect` also accepts more ripgrep flags: `-w`, `-F`, and `-A`/`-B`/`-C` with a line count.
