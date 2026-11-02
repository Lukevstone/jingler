---
"@jingler/desktop": patch
---

Cleaner session chrome: the Jingler logo is back in the sidebar, the header no longer repeats the session name and branch, multi-repo sessions switch repos from the composer, sidebar rows drop metadata that only repeats the obvious, and icon buttons now show tooltips. Jingler now respects GitHub's rate limits: it pauses GitHub calls until the limit resets, reuses unchanged responses, and stops PR polling from retrying while limited.
