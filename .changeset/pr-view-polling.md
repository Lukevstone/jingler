---
"@jingler/desktop": patch
---

The Pull Request tab no longer uses up GitHub's rate limit. It polls a cheap PR state every 30 seconds and only reloads the full view when something actually changes, and background PR checks pause while the window is unfocused.
