---
"cueloop": patch
---

Test hardening: the inline-compose paint assertion waits on the span color instead of sampling the first frame after the keypress, which raced the anchor repaint on slow runners.
