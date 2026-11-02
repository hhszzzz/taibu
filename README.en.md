<div align="center">

<img src="public/favicon.svg" alt="TaiBu" width="80" height="80">

# TaiBu

**An open-source, self-hostable AI platform for Chinese metaphysics and divination**

Code casts the chart. AI reads it.

[![Release](https://img.shields.io/github/v/release/hhszzzz/taibu?style=flat-square&label=release&color=b5651d)](https://github.com/hhszzzz/taibu/releases)
[![taibu-mcp](https://img.shields.io/npm/v/taibu-mcp?style=flat-square&label=taibu-mcp)](https://www.npmjs.com/package/taibu-mcp)
[![taibu-core](https://img.shields.io/npm/v/taibu-core?style=flat-square&label=taibu-core)](https://www.npmjs.com/package/taibu-core)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](docs/manual/Self-Hosting.md)

[中文](README.md) | **English**

[Live site](https://mingai.fun) · [Changelog](CHANGELOG.md) · [Self-hosting](docs/manual/Self-Hosting.md) · [MCP manual](docs/manual/MCP-Server-Manual.md) · [Issues](https://github.com/hhszzzz/taibu/issues)

</div>

---

## About

TaiBu turns traditional Chinese metaphysics into reproducible, checkable tools, and lets AI interpret their results.

- **Charts are computed, not guessed.** `taibu-core` implements the calendar and casting rules of 11 systems and returns canonical text plus canonical JSON; the rules are documented in [ALGORITHM_RULES.md](packages/core/ALGORITHM_RULES.md). Models never work out stems, hexagrams or stars by hand.
- **AI does the reading.** Chat, the background Agent, collaboration members and scheduled tasks all use the same tools and 15 reading methods.
- **Open to any AI client.** The same implementation is available over MCP, as an offline Skill and as npm packages for Claude, Cursor, Cherry Studio and others.
- **Fully self-hosted.** A Docker Compose stack of Next.js, PostgreSQL and Redis; one image runs both the web app and the worker.

The current version is **v1.0.1**; the first stable release was v1.0.0. See the [changelog](CHANGELOG.md).

The product UI and most documentation are in Chinese.

## Features

### Systems

| System | Highlights |
| :--: | :-- |
| **BaZi** (Four Pillars) | True solar time, solar/lunar input and reverse lookup from pillars; ten gods, hidden stems, na-yin, shensha, twelve growth stages, branch relations; decade, year, month and day luck; pairing; three pillars when the birth hour is unknown, or hour inference with the Agent |
| **Zi Wei Dou Shu** | Twelve palaces, triangle and opposite palaces, major and minor stars, four transformations, decade to hour horoscopes, flying stars, palace drilldown |
| **Liu Yao** | Coin, time, number and manual casting; moving lines, six relations and six spirits, strength, void, hidden lines; nuclear, inverse and reversed hexagrams; timing cues; per-line drilldown |
| **Mei Hua Yi Shu** | Casting by date, objects, sounds, characters, measurements and directions; body/use analysis, seasonal strength, timing cues |
| **Qi Men Dun Jia** | Rotating and flying plates, chai-bu, mao-shan and equal-term methods; nine palaces, gates, stars, spirits, formations; palace drilldown |
| **Da Liu Ren** | Heaven and earth plates, four lessons and three transmissions, twelve generals, hidden stems, spirits; natal and yearly positions; lesson drilldown |
| **Xiao Liu Ren · Tai Yi** | Xiao Liu Ren readings; Tai Yi nine stars and the traditional 72 configurations |
| **Tarot** | Full 78-card deck with reversals, 9 built-in spreads and custom spreads, astrological and elemental correspondences, numerology |
| **Western astrology** | Natal and transit charts, seven house systems, custom orbs, sidereal zodiac; single-point drilldown |
| **Almanac** | Daily dos and don'ts, directions, hourly fortune, 28 mansions; date selection by activity and against several zodiac clashes at once |
| **More** | Relationship pairing (couple, business, family), MBTI, face and palm photo readings, dream interpretation, daily and monthly fortune, annual report |

Result pages cast and display; interpretation always happens in AI chat, where any saved chart or record can be @-mentioned.

### AI chat

- Multiple models, reasoning levels, attachments (PDF, Word, Excel), knowledge-base retrieval and web search. Platform models are billed by actual token usage; bring your own API key (BYOK) to use any feature without being billed.
- 15 built-in chart templates and sandboxed HTML visualizations, quoting a passage into the next turn, and public read-only share links.
- Expression style, user profile, custom instructions and long-term memory; context usage shown in the composer.

### Agent

- **Durable execution**: tasks run in a background worker on [Pi Durable](https://www.npmjs.com/package/@earendil-works/pi-durable); closing the page, losing the network or restarting the service loses no progress.
- **Workspace**: charts open, scroll and highlight to follow what the model is looking at; cast charts, drilldowns, pairings and hour inference can be expanded, pinned and saved.
- **Plan and code modes**: research first and act after the user approves; compose tool calls in a sandbox. Low-frequency tools load on demand and long chats can be `/compact`ed.
- **Collaboration**: members that split and merge work, and persistent background subagents, each with a role (specialist, researcher, verifier or a custom role) that decides its tools, instructions and model.
- **Extensions**: SKILL.md skills, external MCP connectors, web search and page reading routed through MCP services such as Exa and Tavily, and a choice of when external tools ask for consent.
- **Schedules, images and evals**: append a turn to a fixed conversation on a schedule (with a built-in daily briefing), text-to-image generation, run telemetry and a multi-model evaluation leaderboard.

See the [Agent manual](docs/manual/Agent.md) for the full behaviour and limits.

### Accounts, billing and administration

- Email and password, email codes, password reset and Linux.do sign-in.
- US dollar wallet and subscriptions with 5-hour, daily, weekly, monthly or whole-term allowances; redemption codes, admin credits and plans bought from the balance; Epay (Alipay, WeChat Pay) once merchant settings are configured.
- Admin console: announcements, feature switches, billing, AI services (gateways, models, models.dev catalog fill), Agent extensions (MCP services, skills, roles, user extension policy) and a log center (usage, Agent tasks, schedules, deployments).
- Administrators see the running version in the sidebar and can update in one click when a release is published.
- Community, notifications, records and a knowledge base; the web app works on desktop and phones, and there are Android and iOS clients (Capacitor).

## MCP, Skill and SDK

`taibu-core` exposes 26 tools: 11 charting tools and 15 low-frequency tools (drilldowns, luck cycles, reverse lookup, horoscopes, flying stars, date selection, pairing, hour inference). It also ships 15 reading methods: a default method per system, plus the Mangpai BaZi school, dream interpretation (no chart), and the birth-hour and past-events techniques.

### Public MCP server

```json
{
  "mcpServers": {
    "taibu": {
      "type": "streamable-http",
      "url": "https://mcp.mingai.fun/mcp"
    }
  }
}
```

No OAuth, API key or session header is needed. The server implements MCP `2026-07-28` and still accepts stateless 2025-era requests. If your client cannot load tools on demand, use `https://mcp.mingai.fun/mcp/core`: it lists the 11 charting tools and reaches the rest through `tool_search` / `tool_call`, cutting the tool text the model sees by about 60%.

### Local stdio

```json
{
  "mcpServers": {
    "taibu": {
      "command": "npx",
      "args": ["-y", "taibu-mcp"]
    }
  }
}
```

Runs fully offline and only needs Node.js. Set `"env": { "TAIBU_MCP_TOOLS": "core" }` for the same short list as `/mcp/core`; see [taibu-mcp](packages/mcp/README.md).

### Skill

[`skills/taibu-divination`](skills/taibu-divination/SKILL.md) is a self-contained Agent Skill with the calculation engine bundled; it only needs Node.js 18+. Copy the whole directory into your client's skills directory (for Claude Code, `~/.claude/skills/`). The method cards live in `methods/`.

### SDK

```bash
npm install taibu-core
```

```ts
import { calculateBazi, toBaziText } from 'taibu-core/bazi';
import { executeTool, renderToolResult } from 'taibu-core/mcp';

const chart = calculateBazi({ gender: 'male', birthYear: 1990, birthMonth: 1, birthDay: 15, birthHour: 9 });
console.log(toBaziText(chart));

const result = await executeTool('qimen', { year: 2026, month: 3, day: 19, hour: 21, timezone: 'Asia/Shanghai' });
console.log(renderToolResult('qimen', result).content[0].text);
```

Domain subpaths, the output contract and the algorithm rules are documented in [taibu-core](packages/core/README.md).

<details>
<summary><b>All 26 tools</b></summary>

| Tool | Purpose |
| --- | --- |
| `bazi` | BaZi chart (solar/lunar input, shensha, stem and branch combinations, conception and life palaces; three pillars without a birth hour) |
| `bazi_pillars_resolve` | Birth time candidates from four pillars (1900–2100) |
| `bazi_dayun` | Decade luck, minor luck and years |
| `bazi_relations` | Branch and stem relations when decade, year, month or day luck overlay the natal chart |
| `bazi_wuxing` | Five-element strength facts: month command, roots, self-seated stems, adjacent stems, missing elements |
| `bazi_liunian_scan` | Year-by-year scan of up to 30 years against the natal chart and decade luck |
| `bazi_hepan` | Fact-only pairing of two charts |
| `bazi_hour_candidates` | Birth-hour candidates for a day, optionally checked against past events |
| `ziwei` | Zi Wei Dou Shu chart |
| `ziwei_horoscope` | Decade to hour horoscopes |
| `ziwei_flying_star` | Flying and self transformations |
| `ziwei_palace` | One palace in depth: stars, transformations, triangle, flanking palaces, horoscope overlays |
| `liuyao` | Liu Yao casting and analysis |
| `liuyao_line` | One line in depth: na-jia, strength, void, changes |
| `meihua` | Mei Hua Yi Shu casting and reading |
| `tarot` | Tarot draws |
| `almanac` | Daily almanac |
| `almanac_select` | Date selection over a range of up to 92 days |
| `astrology` | Natal chart and transits |
| `astrology_point` | One body or house in depth |
| `qimen` | Qi Men Dun Jia chart |
| `qimen_palace` | One palace in depth |
| `taiyi` | Tai Yi nine stars and the 72 configurations |
| `daliuren` | Da Liu Ren chart |
| `daliuren_lessons` | Lessons and transmissions in depth |
| `xiaoliuren` | Xiao Liu Ren reading |

</details>

## Getting started

### Run locally

Requires Docker with Compose v2, Node.js 24 and pnpm 10.

```bash
git clone https://github.com/hhszzzz/taibu.git
cd taibu
pnpm install
pnpm local:update   # first run: generate config, build the image, start db, redis, web, worker and mailpit
```

Open `http://127.0.0.1:3080`; sign-up emails land in Mailpit at `http://127.0.0.1:8025`. `pnpm local:status` prints the actual ports. Generated secrets and ports live in `.taibu-local/taibu-v2/`; never publish or commit them.

```bash
pnpm local:up       # start with the existing image
pnpm local:status   # ports and health
pnpm local:logs     # follow logs (credentials redacted)
pnpm selfhost down --project taibu-v2   # stop and keep the volumes
```

After signing up, make yourself an administrator and add a gateway and models under Settings → AI 服务; see the [self-hosting manual](docs/manual/Self-Hosting.md#设为管理员).

### Production

Production runs `deploy/compose.base.yml` + `deploy/compose.prod.yml` with images that CI publishes to `ghcr.io/hhszzzz/taibu`; the host pulls and never builds:

```bash
# /opt/taibu/source holds the repository; /opt/taibu/env/ holds compose.env and the per-container secrets
EDGE_MODE=host deploy/deploy.sh v1.0.1   # an existing Caddy or Nginx owns 80/443
deploy/deploy.sh v1.0.1                  # the stack's own Caddy owns 80/443
```

The script backs up the database, runs database setup and migrations, then rolls out with a health check and rolls back on failure. [`.env.example`](.env.example) lists every variable; mail, backups, billing and one-click updates are covered in the [self-hosting manual](docs/manual/Self-Hosting.md), and upgrades from older deployments in the [upgrade guide](docs/UPGRADE.md).

## Architecture

```text
browser / app ──► Caddy ──► web (Next.js: pages, API, SSE)
                              │
            ┌─────────────────┼──────────────────┐
            ▼                 ▼                  ▼
  PostgreSQL 17 + pgvector   Redis 8           file volume
  data · RLS · tasks         limits · cache · BullMQ   attachments · images
            ▲                 ▲                  ▲
            └──────── worker (Agent, documents, mail, schedules, maintenance)

taibu-core ──► in-process for web and Agent · taibu-mcp (stdio) · taibu-mcp-server (HTTP) · Skill
```

| Part | Notes |
| --- | --- |
| Web | Next.js 16 modular monolith (standalone) with React 19, Tailwind CSS 4 and Base UI |
| Auth | Better Auth on its own `identity` schema and connection role |
| Data | Kysely `ScopedDb` sets the role and identity per transaction; PostgreSQL RLS isolates user data |
| Background | The worker from the same image: Pi Durable runs the Agent, BullMQ runs schedules, mail and maintenance |
| Database | `database/` holds the current SQL and numbered migrations; `db:init` migrates, completes and reconciles |
| Releases | Pushing a `v*` tag makes CI build the image and publish a GitHub Release |

See [architecture](docs/manual/Architecture.md) for module boundaries and data access.

## Repository layout

```text
src/                 Next.js app: pages, API routes, components and domain modules
packages/core/       taibu-core: algorithms, tool definitions, methods, canonical output (MIT)
packages/mcp/        taibu-mcp: local stdio MCP server (MIT)
packages/mcp-server/ taibu-mcp-server: public HTTP MCP server (MIT)
skills/              taibu-divination Skill and method card sources
database/            PostgreSQL definitions, role bootstrap and numbered migrations
deploy/              Compose, Caddy, backup, deploy and update scripts
scripts/             build, database tooling, self-hosting, release and tests
docs/                manuals, engineering standards and the upgrade guide
android/ ios/        Capacitor clients
```

## Development

```bash
pnpm test                         # unit, route, protocol and guard tests (builds the packages they need)
pnpm test -- src/tests/chat-route.test.ts   # selected files only
pnpm lint && pnpm typecheck
pnpm test:db                      # SQL, RLS and concurrency in a throwaway PostgreSQL
pnpm exec playwright install --only-shell chromium   # once, before browser tests
pnpm verify                       # everything: builds, tests, database, auth and browser (needs Docker and the local stack)
```

Conventions are in [AGENTS.md](AGENTS.md) and the [engineering standards](docs/engineering/README.md); commits follow Conventional Commits.

## Documentation

| Document | Covers |
| --- | --- |
| [Self-hosting manual](docs/manual/Self-Hosting.md) | Local stack, database, mail, billing, releases, deployment and backups |
| [Upgrade guide](docs/UPGRADE.md) | Moving older deployments to 1.0.0 and later updates |
| [Architecture](docs/manual/Architecture.md) | Runtime parts, module boundaries, data access and billing |
| [Agent manual](docs/manual/Agent.md) | Tasks, tools, extensions, collaboration, schedules and billing |
| [MCP manual](docs/manual/MCP-Server-Manual.md) | Client setup, protocol behaviour, tools and self-hosting the server |
| [taibu-core](packages/core/README.md) · [algorithm rules](packages/core/ALGORITHM_RULES.md) | SDK usage, output contract and calculation rules |
| [Engineering standards](docs/engineering/README.md) | Code, components, frontend, backend, data security, testing and documentation |

## Versioning

The app version lives in the root `package.json` and follows `x.y.z`: x for major architecture changes, y for features, z for fixes. The npm packages are versioned separately; `taibu-core`, `taibu-mcp` and `taibu-mcp-server` are at 4.0.0.

## Contributing

Issues and pull requests are welcome. Please read [AGENTS.md](AGENTS.md) first and describe what changed, why, and how you verified it.

## License

This repository is dual-licensed:

- `packages/core`, `packages/mcp` and `packages/mcp-server` are [MIT](packages/core/LICENSE): commercial use, redistribution and modification are allowed as long as the copyright and license notices are kept.
- Everything else (web app, server, deployment and runtime code) is [AGPL-3.0-only](LICENSE): commercial use is allowed, but if you offer a modified version as a network service you must publish its source.

Third-party licenses are in [licenses/](licenses/) and [THIRD_PARTY_NOTICES.md](packages/core/THIRD_PARTY_NOTICES.md).

---

<div align="center">

**TaiBu** · AI for reading fate, technology for carrying tradition

Made with ❤️ by [hhszzzz](https://github.com/hhszzzz)

</div>
