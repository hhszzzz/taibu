<div align="center">

<img src="public/favicon.svg" alt="TaiBu" width="80" height="80">

# TaiBu

**Integrating traditional metaphysics with AI**

[![Next.js](https://img.shields.io/badge/Next.js-16+-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?style=flat-square&logo=tailwind-css)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase)](https://supabase.com/)
[![Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com/)

Language: [中文](README.md) | **English**

[Live Demo](https://www.mingai.fun) · [Report Issues](https://github.com/hhszzzz/taibu/issues)

</div>

---

## Highlights

- **Multiple Metaphysics Systems** - Bazi, Liuyao, Ziwei Doushu, Qimen Dunjia, Da Liu Ren, MeiHua, Tarot, MBTI, Face Reading, Palm Reading, Synastry, Dream Interpretation
- **AI-Powered Analysis** - Export chart/divination text for AI analysis with multi-model support, deep reasoning, and visual recognition
- **MCP Server** - Supports Model Context Protocol (MCP), allowing direct use of metaphysics tools in MCP-compatible agent
- **History, Knowledge Base, and @Mentions** - Store records across all systems, add them into your personal knowledge base, and explicitly reference data sources
- **AI Personalization** - Expression style, user profile, and custom instructions with context/prompt budget visualization
- **Cross-Platform Experience** - Web + iOS/Android clients
- **Community and Incentives** - Metaphysics records, anonymous discussions, and daily check-in rewards

---

## Feature Overview

| Module | Core Capabilities |
| :----: | :--- |
| **Bazi Charting** | · True solar time, solar/lunar calendar charting, instant charting, Four Pillars charting<br/>· Five elements, heavenly stems & earthly branches, Ten Gods, hidden stems, star phases, Na Yin, shensha (51 types), Twelve Growth Phases, clash/harm/combine/punishment<br/>· Stem combinations (wu he), branch half-combinations, branch three-meetings<br/>· Major luck cycles, yearly/monthly/daily luck<br/>· Traditional and blind-school analysis |
| **Ziwei Doushu** | · Twelve palaces, three-way/four-direction structure<br/>· Main/support/minor stars, Four Transformations (incl. self-mutagens)<br/>· Life Master Star, Body Master Star, Small Limit, Scholar Stars (Bo Shi 12)<br/>· Strength/fall states, decadal/yearly/monthly/daily/hourly fortune analysis<br/>· Flying star analysis (mutagen placements, three-way/four-direction) |
| **Qimen Dunjia** | · Nine palaces, heaven/earth stems, eight gates, nine stars, eight deities<br/>· Duty star & duty gate, dun type, ju number<br/>· Formation assessment (auspicious/inauspicious), void, post horse, entombment, strength<br/>· Rotating-plate method, chaibu/maoshan ju methods<br/>· Explicit IANA timezone support |
| **Da Liu Ren** | · Heaven/earth plates, four lessons, three transmissions<br/>· Heavenly generals, hidden stems<br/>· 49 shensha types, lesson-body classification<br/>· Twelve growth phases, five-element strength, jianchu twelve gods<br/>· Explicit timezone, optional natal stem/year support |
| **Liuyao Divination** | · Coin casting, quick casting, selected-hexagram casting, time-based casting, number-based casting<br/>· Explicit and implicit moving lines<br/>· Hexagram text, line text, image text<br/>· Useful spirit, original spirit, hidden spirit, adversary spirit<br/>· Void branches, self/opponent lines, strength states, clash/combine/harm<br/>· Nuclear/opposite/reversed hexagrams<br/>· Timing prediction |
| **Meihua Yishu** | · Time casting, count/sound casting, text casting, measure casting, classifier cues<br/>· Extended two-number / three-number casting<br/>· Original, nuclear, changed, opposite, and reversed hexagrams with moving lines<br/>· Body/use trigrams, generating-controlling analysis, seasonal strength, response hierarchy<br/>· Timing clues and qualitative auspicious/inauspicious judgment |
| **Tarot Reading** | · 9 spreads: single-card, three-card, love, Celtic Cross, horseshoe, decision, mind-body-spirit, situation, yes-no<br/>· Reversed-card judgment, full 78-card interpretation, refined card visuals<br/>· Astrological/elemental correspondences, numerology (personality/soul/yearly cards)<br/>· Daily guidance |
| **Synastry** | · Couple, business, and parent-child analysis<br/>· Future trend lines<br/>· Communication advice |
| **Face & Palm Reading** | · Forehead, nose, eyes, mouth analysis<br/>· Life line, wisdom line, career line, relationship line |
| **Fortune Center** | · Daily and monthly fortune analysis based on natal charts<br/>· Daily almanac (directions, 12 hourly fortunes, 28 mansions)<br/>· Future trend lines |
| **MBTI Test** | · 90+ personality questions<br/>· Comprehensive AI personality analysis |
| **Deep AI Integration** | · Combined analysis based on past readings<br/>· Full-system metaphysics analysis<br/>· Knowledge base, attachments, and search<br/>· Mention all metaphysics systems during AI chat<br/>· Annual metaphysics report |

---

## MCP Server

TaiBu runs a public MCP (Model Context Protocol) server that exposes every metaphysics tool to compatible agents. It now serves MCP `2026-07-28` and keeps stateless compatibility for 2025-era clients.

### Quick Setup

Import this server entry into your MCP client:

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

Modern clients automatically perform `server/discover` and supply the per-request protocol metadata; no OAuth, API key, or session header is required. For a fully local stdio setup, see [`packages/mcp/README.md`](packages/mcp/README.md).

### Supported Tools

| Tool | Function | Example Prompt |
| --- | --- | --- |
| `bazi` | Generate a Bazi chart (solar/lunar supported, 51 shensha types, stem combinations, branch half-combinations/three-meetings, Tai Yuan/Ming Gong) | "I was born at 3:00 PM on May 15, 1990. Please generate my chart." |
| `bazi_pillars_resolve` | Reverse-lookup birth time from Four Pillars (1900-2100) | "My Bazi is 丙午 庚寅 丙辰 癸巳, please analyze it." |
| `bazi_dayun` | Compute major luck cycles (10-year periods with annual transits, Tai Sui annotations, minor luck) | AI automatically calls this based on your Bazi |
| `ziwei` | Generate a Ziwei Doushu chart (Life/Body Master stars, Small Limit, Scholar Stars, San Fang Si Zheng) | "I was born on the 8th day of the 4th lunar month in 1990, please generate my Ziwei chart." |
| `ziwei_horoscope` | Ziwei fortune periods (decadal/small limit/yearly/monthly/daily/hourly with transit stars) | "What are my Ziwei fortune periods for 2026?" |
| `ziwei_flying_star` | Flying star analysis (four transformations, mutagen placements, surrounded palaces) | "Analyze the flying stars of my Life Palace." |
| `liuyao` | Liuyao divination (auto-casting / custom hexagram / time-based / number-based, with nuclear/opposite/reversed hexagrams) | "I want to divine my career luck this year." |
| `meihua` | Meihua Yishu divination (time casting, count/sound, text casting, measure casting, classifier cues, modern number casting) | "Cast a Meihua Yishu reading for whether this cooperation will succeed." |
| `tarot` | Draw Tarot cards (9 spreads, 78 cards with independent reversed keywords, astrological/elemental correspondences) | "Please draw a Tarot card for my recent love fortune." |
| `almanac` | Daily almanac & calendar query (directions, 12 hourly fortunes, 28 mansions) | "How is today's almanac? Is it suitable for a proposal?" |
| `astrology` | Western astrology natal and transit charting (Big Three, natal anchors, major transit triggers) | "What are the key astrology transit themes for me right now?" |
| `qimen` | Qimen Dunjia charting (palaces, gates, stars, gods, dun type, ju number, explicit timezone) | "Use Qimen Dunjia to see whether today's negotiation is favorable." |
| `taiyi` | Taiyi nine-star observation (external temporal environment, nine-star array, energy interaction) | "Use Taiyi nine-star observation to review this project's momentum." |
| `daliuren` | Da Liu Ren charting (four lessons, three transmissions, heavenly plate, generals, explicit timezone) | "Use Da Liu Ren to analyze the outcome of this matter." |
| `xiaoliuren` | Xiao Liu Ren divination (result state, palace landing, core interpretive clues) | "Use Xiao Liu Ren to see whether today's trip will go smoothly." |

### SDK

If you want to call the calculation engine directly in your own Node.js project (without MCP), use the core library:

```bash
npm install taibu-core
```

See [taibu-core on npm](https://www.npmjs.com/package/taibu-core) and [packages/core/README.md](packages/core/README.md) for full API docs and subpath exports.

---

## Quick Start

### Docker Deployment

Three deployment options are supported:

```bash
# Prepare environment variables (first time)
cp .env.example .env

# 1) One-command deployment: start both Web + MCP
docker compose up -d --build

# 2) Web only
docker compose -f docker-compose.web.yml up -d --build

# 3) MCP Server only
docker compose -f docker-compose.mcp.yml up -d --build
```

Default ports:
- Web: `3000` ([http://localhost:3000](http://localhost:3000))
- MCP: `3001` ([http://localhost:3001/mcp](http://localhost:3001/mcp))

### Local Development

Requirements:
- Node.js 18+
- pnpm (recommended) / npm / yarn

```bash
# Clone repository
git clone git@github.com:hhszzzz/taibu.git
cd taibu

# Install dependencies
pnpm install

# Configure environment variables
cp .env.example .env
# Edit .env and fill required API keys

# Start dev server
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000) to view the app.

---

## Developer Documentation

- [Architecture and migration boundaries (Chinese)](docs/manual/Architecture.md): module ownership, AI lifecycle/billing, historical replay, compatibility exceptions, and rollback conditions.
- [Core public API](packages/core/README.md) · [MCP manual](docs/manual/MCP-Server-Manual.md)
- [Refactor and test acceptance record (Chinese)](docs/manual/Refactor-Acceptance.md)

```bash
pnpm test -- src/tests/chat-route.test.ts # Selected tests; builds required packages
pnpm test                                # Default unit, route, protocol and guard tests
pnpm exec playwright install --only-shell chromium # First-time browser setup
pnpm verify                              # Build each package once; full verification (local Docker required)
```

Database and browser checks also run independently with `pnpm test:db` and `pnpm test:browser`. If Chromium downloads are unavailable and Chrome is already installed, explicitly use `pnpm verify -- --chrome`; no browser assertions are skipped. CI uses pinned Chromium and requires both database and browser checks.

---

## Contributing

Issues and Pull Requests are welcome.

---

## License

This repository uses a mixed licensing model:

- `packages/core`
- `packages/mcp`
- `packages/mcp-server`

These three packages are licensed under `MIT`. See the `LICENSE` file inside
each package directory.

All other web app, server, deployment, and runtime code in this repository is
licensed under `AGPL-3.0-only`. See the repository root [LICENSE](LICENSE).

Notes:

- `AGPL-3.0-only` does not prohibit commercial use, but it does require source
  sharing obligations when modified network services are offered to users
- The `MIT` packages allow commercial use, redistribution, and modification,
  subject to preserving the copyright and license notice

---

<div align="center">

**TaiBu** - Interpret destiny with AI, preserve culture with technology

Made with ❤️ by [hhszzzz](https://github.com/hhszzzz)

</div>
