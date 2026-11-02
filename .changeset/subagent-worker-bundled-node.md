---
"@jingler/desktop": patch
"@jingler/device-agent": patch
---

Fix subagents failing with "invalid x-api-key" or missing tools: the bundled subagent worker can load its Claude provider and Jingler tool extensions again.
