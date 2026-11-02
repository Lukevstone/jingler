---
"@jingler/desktop": patch
---

Jingler no longer runs out of GitHub API quota when you have many workspaces open. Finding new pull requests now makes one GitHub call per repository instead of one per workspace, and pauses while the window isn't focused.
