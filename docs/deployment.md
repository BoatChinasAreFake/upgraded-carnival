# Deployment and configuration

The local controlled Minecraft checks do not deploy a bot to the owner's live server. Before doing so, configure actual server address/account, permitted guild/channels/roles, reviewed task areas, home and containers, and securely injected Discord and AI credentials. These values were not supplied during implementation. A dedicated Microsoft-authenticated Minecraft account is required for online-mode servers. Login/device authorization and real account access remain untested.

`runtime/auth` may contain Microsoft refresh tokens and is created with owner-only directory permissions. `.env`, local policy, caches and runtime outputs are ignored by Git. Restrict their file permissions and access to the execution host. Do not add secret values to README, policy, scripts, checkpoints, commits, logs or configuration draft text. Rotation/revocation belongs to the service providers. Voice participants must understand the external speech processing; raw audio is not retained by this implementation.

Cloud Node fetch commands use `--use-env-proxy`; this preserves supported HTTPS proxy routing and TLS checks. The saved network draft includes:

- `piston-meta.mojang.com`, `piston-data.mojang.com`, `libraries.minecraft.net` for controlled server downloads.
- `sessionserver.mojang.com`, `api.minecraftservices.com`, `login.microsoftonline.com`, `login.live.com`, `device.auth.xboxlive.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com` for account authentication (provider destinations can change; diagnose actual failures before adding more).
- `discord.com`, `gateway.discord.gg`, `*.discord.media`, `cdn.discordapp.com` for Discord APIs, gateway, voice and attachments.
- `api.openai.com` for the default planner, transcription and speech service.

Minecraft needs TCP access to the selected server and Discord voice needs its actual UDP voice endpoint plus gateway WebSocket connectivity. A list of permitted HTTPS hosts alone does not provide raw TCP/UDP connectivity. Live Discord voice transport on this cloud host has not been established. Run on a host/network that supports those protocols; do not add a custom VPN or evade environment network policy.

Proxy-backed `AI_API_KEY` can be replaced on its configured HTTPS destination. Discord gateway Identify sends the bot token in a WebSocket JSON payload; an HTTPS-only placeholder secret binding does not by itself establish a usable raw Discord token for this operation. `DISCORD_TOKEN` therefore requires a supported secure direct runtime variable binding (or a protected local `.env` on the deployment host). Never paste the token in chat. If the platform only supports HTTPS proxy secrets, live Discord login needs a deployment with direct secret injection; it cannot be declared working here from a successful REST request alone.

The persisted install instructions run frozen `npm ci --ignore-scripts`, syntax/unit tests and local DAVE/codec checks in `/workspace/upgraded-carnival`. Startup instructions require a reviewed policy and direct configuration, start with `npm start`, and check a real Minecraft login and `/status`. Publication and restoration in another cloud task remain product/user operations; neither a saved draft nor local successful tests demonstrates a deployed or restored bot.
