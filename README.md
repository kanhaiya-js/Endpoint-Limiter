# Discord Garena OTP Limiter Bot

A dedicated Node.js Discord bot that allows authorized users/servers to manage a list of email addresses and triggers Garena's account recovery / swap OTP endpoint in real-time and continuously.

> **Note:** The bot does **not** send emails itself. Instead, it sends requests to Garena's official API endpoint (`swap:send_otp`), causing Garena's servers to dispatch the OTP recovery email directly to the target address.

---

## Features

- **Real-time Add & Stop**:
  - As soon as you add an email, an OTP request is dispatched immediately, and recurring requests begin.
  - As soon as you remove an email, OTP requests stop immediately in real time.
- **Continuous Loop**: Loops through all active emails and triggers Garena's OTP endpoint.
- **Clean Command Set**: Only `/mail add`, `/mail remove`, `/mail list`, and `/sendnow`.
- **Instant Slash Command Refresh**: Overwrites guild commands on startup so your Discord UI updates immediately without duplicates.
- **Server & User Restrictions**: Configure specific Guild (Server) IDs and User IDs in `.env` to restrict command execution.
- **Persistent Storage**: Saved emails persist across restarts in `data.json`.

---

## Commands

### Slash Commands:
- `/mail add email: <email>` -- Adds an email, sends an immediate OTP request in real-time, and continues recurring requests.
- `/mail remove email: <email>` -- Removes an email and stops all further OTP requests in real-time.
- `/mail list` -- Displays all actively registered emails.
- `/sendnow [email]` -- Triggers an instant OTP request on demand without waiting for the timer.

### Text Prefix Commands (Chat):
- `!mail add <email>`
- `!mail remove <email>`
- `!mail list`
- `!sendnow [email]`

---

## Setup & Running

```bash
cd discord-otp-bot
npm install
npm start
```
