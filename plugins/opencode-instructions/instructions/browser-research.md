# Browser Research

- Prefer the Browser MCP for web research when a plain HTTP request is unreliable.
- Use it when a site returns HTTP 403/401, shows Cloudflare or anti-bot checks, requires login or existing cookies, serves JavaScript-rendered content, or blocks API documentation pages.
- Reuse the available authenticated browser session through the Browser MCP; do not assume every browser integration shares the user's cookies.
- Use only agent-owned tabs or tabs the user explicitly shares.
- Do not conclude a site is inaccessible because one direct request failed.
- Use navigation, clicking, scrolling and page inspection instead of guessing page contents.
- When a CAPTCHA, login, 2FA or other interactive challenge blocks progress, use the available browser handoff tool or ask the user to complete it.
- Wait for the user, inspect the page again to verify access, then continue the original task.
- Never bypass security restrictions or CAPTCHA protections programmatically.
- Never expose cookies, session tokens or credentials in output, logs or commits.
