# Minecraft survival bot + Discord

A Minecraft **Java Edition 1.20.4** (protocol 765) survival client with a deterministic controller, isolated AI planner, policy-controlled action executor, Discord text commands and DAVE-capable bidirectional voice. It never sleeps. This is a bounded initial implementation, not a general-purpose autonomous Minecraft player; see [support and validation](docs/support.md).

Requires Node **24.17+**, a permitted Minecraft account/server, and owner-reviewed Discord/server policy. Java 21 is used only for the controlled integration server. Use this environment's existing checkout; cloud tasks are already isolated and do not need a Git worktree.

```sh
npm ci --ignore-scripts --cache /workspace/.npm-cache
npm test
npm run voice:check
cp config/policy.example.json config/policy.json
cp .env.example .env
# Edit policy.json and configure .env securely before starting.
npm start
```

Never commit `.env`, Microsoft auth caches, recorded audio, or tokens. The bot defaults to Microsoft authentication. `MC_AUTH=offline` is exclusively for explicitly configured controlled offline servers. Give it a dedicated ordinary account; it needs no OP permissions. Minecraft must be exactly 1.20.4. Choose home/area bounds that include the server's actual spawn and safe walking terrain. Spawn outside policy latches the stop.

Configure guild, text/voice channel IDs, role IDs, construction/mining areas, approved single containers, home, death limits, and autonomy permissions in [policy.example.json](config/policy.example.json). The checked-in example grants no real Discord roles and disables autonomous mining/building/voice recording. A reviewed local `config/policy.json` is required. Policy is loaded once; restart to apply changes. Do not generate policy from conversation or AI responses.

Discord needs a bot token and application ID. Invite the bot with `bot` and `applications.commands` scopes and View Channel, Send Messages, Read Message History, Connect and Speak permissions. Enable Message Content intent in the Developer Portal for mention-based conversation; `/ask` works without message content. Roles configured as admin inherit other capabilities. Enable voice recording only after participants understand that authorized operators' utterances are sent to the configured speech service. Audio/transcripts are kept in memory and not written to audit logs. Bots and unapproved roles cannot control it.

`AI_API_KEY`, `AI_BASE_URL`, `AI_ALLOWED_HOSTS`, `AI_MODEL`, `STT_MODEL`, `TTS_MODEL`, and `TTS_VOICE` configure OpenAI-compatible chat, transcription and speech endpoints. Endpoints must use HTTPS on explicitly allowed hosts; redirects are rejected. Local services need a trusted HTTPS endpoint and compatible response contracts. Raw speech output must be 24 kHz mono signed 16-bit PCM. No planner/speech credential means deterministic survival and explicit slash tasks still work, while conversation/speech fails closed. Configure credentials through secure environment settings or a protected local `.env`; never paste them into chat.

| Command | Access / behavior |
| --- | --- |
| `/stop` | Operator; immediate emergency latch without AI |
| `/resume` | Admin; resumes after owner resolves the cause |
| `/cancel` | Operator; interrupts the active task/voice response |
| `/status` | Operator; reports health, food and runtime state |
| `/ask text` / mention bot | Operator conversation; bounded planner proposals; no destructive authorization |
| `/move x y z` | Operator; safe ordinary walking within approved areas |
| `/mine x y z` | Destroyer + operator; one visible reachable authorized block |
| `/craft item count` | Operator; ordinary recipe repetitions, 1–4 |
| `/voice join/leave` | Operator; allowed voice channel, recording opt-in in policy |
| `/schematic file` | Builder + operator; bounded `.litematic` validation and base material counts |
| `/materials id x y z` | Builder + operator; visible-site plan including support materials |
| `/build id x y z` | Builder + operator; serial placements, verification and resumable checkpoints |

Role membership is refreshed from Discord before each task/build step, with short-lived authorization rechecked at packet dispatch. Survival has its own minimal policy principal and never borrows Discord roles. Administrative policy is never editable by AI or Discord requests.

Emergency stop independent of Discord/AI:

```sh
# From the checkout:
touch runtime/STOP
# Or type stop in the bot's console. SIGINT/SIGTERM stop and disconnect.
```

The local file is checked on every 50 ms survival tick. Stop clears movement, cancels mining/item use, invalidates in-flight operations and queued tasks, interrupts speech and denies stale action packets. Gravity/server knockback can still move a stationary player. Remove `runtime/STOP` and use `/resume` with the admin role after resolving the hazard. A timed-out action disconnects; restart manually. There is no automatic reconnect or unlimited death loop.

## Controlled integration server

The test runner uses its own **disposable** world in ignored `runtime/test-server/`, binds to **127.0.0.1:25575**, has offline authentication, and uses server console commands exclusively to prepare fixtures. These commands are never runtime bot capabilities. Do not use this server configuration on a public interface.

```sh
# Only after accepting https://aka.ms/MinecraftEULA:
npm run server:prepare -- --accept-eula
npm run test:server
```

Downloads use Mojang's authoritative manifests and verify published checksums and sizes, with TLS verification intact. Java runs with a 1 GiB heap and two CPUs. The runner starts/stops its own server, resets fixture terrain, uses a fresh test account, preserves command exit status, and writes current results to `runtime/server-test-results.json`. See [validation](docs/support.md) for evidence and limitations, [architecture](docs/architecture.md) for trust boundaries and [deployment](docs/deployment.md) for configuration/network requirements.
