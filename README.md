# agent-manager

A terminal app to see and change what your coding harnesses load: memory files, skills, MCP servers and plugins. It reads the real config files of Claude Code, Codex, OpenCode and omp, shows which harness loads each item, and finds problems such as secrets written into config. Every change shows a diff first, keeps a backup, and can be undone.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Memory ────────────────────────────────────────────────────────── 12 files · 3 entries ─╮
│▌   All harnesses       16││  FILE                          LOADED BY             NOTE                                │
│  ● Claude Code         11││ GLOBAL ──────────────────────────────────────────────────────────────────────── 7 files █│
│  ● Codex                5││▌ AGENTS.md                     nobody                ▲ shadowed by AGENTS.override.md   █│
│  ○ OpenCode     not found││  AGENTS.override.md            Codex                                                    █│
│  ○ omp          not found││  CLAUDE.md                     Claude Code                                              █│
╰──────────────────────────╯│  rules/sub/style.md            Claude Code                                              █│
╭─ Project ────────────────╮│  rules/testing.md              Claude Code                                              █│
│ ▸ shop                   ││  summary.md                    Codex                 generated memory                   █│
│ ~/repos/shop             ││  topics/tools.md               Codex                 generated memory                   █│
│ p switch project         ││ PROJECT  ~/repos/shop ───────────────────────────────────────────────────────── 5 files █│
╰──────────────────────────╯│  .claude/CLAUDE.md             Claude Code                                              █│
╭─ Legend ─────────────────╮│  .claude/rules/api.md          Claude Code                                              █│
│ ✓ loaded                 ││  AGENTS.md                     Codex                                                    ▀│
│ ○ installed, turned off  ││  CLAUDE.local.md               Claude Code           private to you                      │
│ · not read by harness    ││  CLAUDE.md                     Claude Code                                               │
│                          ││ AUTO MEMORY ───────────────────────────────────────────────────────────────── 3 entries  │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ AGENTS.md  Codex · global · loaded at start ✗                                            │
│                          ││ ~/.codex/AGENTS.md                                                                       │
│ here uses in this project││ ▲ shadowed by AGENTS.override.md                                                         │
│ all  uses in all projects││ Global memory                                                                            │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 a add  e edit  d delete  │  / filter  u undo  ? all keys                                                   row 1 of 15
```

## Contents

- [Install and run](#install-and-run)
- [Supported harnesses](#supported-harnesses)
- [The screen](#the-screen)
- [Memory](#memory)
- [Skills](#skills)
- [MCP servers](#mcp-servers)
- [Plugins](#plugins)
- [Health](#health)
- [Projects](#projects)
- [Review, backup and undo](#review-backup-and-undo)
- [Keys](#keys)
- [Environment variables](#environment-variables)
- [Development](#development)

## Install and run

You need [Bun](https://bun.sh).

```sh
git clone https://github.com/andytavares/agent-manager.git
cd agent-manager
bun install --frozen-lockfile
bun run start
```

The project is the folder you start it in. To open another project, pass its path:

```sh
bun src/main.tsx --project ~/repos/shop
```

Press `p` in the app to switch project, `?` for every key, and `q` to quit.

## Supported harnesses

agent-manager finds each harness by its config folder. A harness that is not found shows `not found` in the Harnesses panel, and nothing is written for it.

| Harness | Found by | Memory | MCP servers | Skills | Plugins |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `~/.claude` or `~/.claude.json` (or `CLAUDE_CONFIG_DIR`) | `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md`, project `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md`, `CLAUDE.local.md`, `AGENTS.md` when no `CLAUDE.md` exists, and auto memory | `~/.claude.json` (user and local), `.mcp.json` (project) | `~/.claude/skills`, `.claude/skills`, plugin skills (read-only) | install, turn on/off, update, uninstall, marketplaces, through the `claude plugin` command |
| Codex | `~/.codex` (or `CODEX_HOME`) | `AGENTS.md`, `AGENTS.override.md` (global and project), generated memories (read and delete only) | `~/.codex/config.toml`, `.codex/config.toml` (no SSE) | `~/.agents/skills`, `.agents/skills`, `~/.codex/skills` | install, uninstall, turn on/off, marketplaces, through `codex plugin` and `config.toml` |
| OpenCode | `~/.config/opencode` (or `XDG_CONFIG_HOME`) | `~/.config/opencode/AGENTS.md`, project `AGENTS.md`, Claude Code fallbacks | `opencode.json` or `opencode.jsonc` (global and project) | `~/.config/opencode/skills`, `.opencode/skills`, `.agents/skills`, `.claude/skills` | install and uninstall in `opencode.json`; local plugin files can only be uninstalled; OpenCode 1.x cannot turn a plugin off |
| omp | `~/.omp/agent` (or `OMP_PROFILE`, `PI_CODING_AGENT_DIR`) | `AGENTS.md`, `RULES.md` (global and `.omp`), Claude Code files when its settings allow | `~/.omp/agent/mcp.json`, `.omp/mcp.json` | `.omp/skills`, `.agents/skills`, `.claude/skills` when allowed | install, turn on/off, upgrade, uninstall, marketplaces, through `omp plugin` |

Words used in this README:

- **Harness**: a coding-agent program that loads config from files, such as Claude Code or Codex.
- **Scope**: where an item applies. Global is your home folder. Project is one repo. Claude Code also has local, a private project scope.
- **Loaded by**: the harnesses that read an item, after each harness's own settings. An item that no harness loads shows `nobody`.
- **Write plan**: the file edits and commands a change needs. You review it before anything is written.

## The screen

The header shows the project and the harness filter. The tab row shows each tab's item count, and the Health tab's issue count. On the left, the Harnesses panel filters the list by harness, the Project panel shows where you are, and the Legend explains the marks:

- `✓` loaded, `○` installed but turned off, `·` not read by that harness.
- `CC` Claude Code, `Cx` Codex, `OC` OpenCode, `omp` omp.
- `here` and `all` count uses in Claude Code transcripts, in this project and in all projects.

The list shows GLOBAL items, then PROJECT items. The highlighted row (`▌`) is always the item that the next key acts on, and the strip under the list shows its detail. The key bar at the bottom shows the keys for what has focus.

### Filter by name or harness

Press `/` and type to filter by name. Matches are highlighted, and each group shows how many rows match. Press `⏎` to keep the filter or `esc` to clear it.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Memory ───────────────────────────────────────────────────────────── / clau▌ · 5 of 15 ─╮
│▌   All harnesses       16││  FILE                          LOADED BY             NOTE                                │
│  ● Claude Code         11││ GLOBAL ───────────────────────────────────────────────────────────────────────── 1 of 7  │
│  ● Codex                5││▌ CLAUDE.md                     Claude Code                                               │
│  ○ OpenCode     not found││ PROJECT  ~/repos/shop ────────────────────────────────────────────────────────── 4 of 5  │
│  ○ omp          not found││  .claude/CLAUDE.md             Claude Code                                               │
╰──────────────────────────╯│  .claude/rules/api.md          Claude Code                                               │
╭─ Project ────────────────╮│  CLAUDE.local.md               Claude Code           private to you                      │
│ ▸ shop                   ││  CLAUDE.md                     Claude Code                                               │
│ ~/repos/shop             ││ AUTO MEMORY ──────────────────────────────────────────────────────────────────── 0 of 3  │
│ p switch project         ││  No entry matches “clau”.                                                                │
╰──────────────────────────╯│                                                                                          │
╭─ Legend ─────────────────╮│                                                                                          │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││                                                                                          │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ CLAUDE.md  Claude Code · global · loaded at start ✓                                      │
│                          ││ ~/.claude/CLAUDE.md                                                                      │
│ here uses in this project││ # Global                                                                                 │
│ all  uses in all projects││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 ⏎ keep filter  esc clear  ↑↓ move                                                                           row 1 of 5
```

Press `s` to step through the harnesses, or `tab` to focus the Harnesses panel and choose one with `↑↓`. With a harness chosen, the list shows only what that harness reads.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  Codex                                          p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Memory ─────────────────────────────────────────────────────────────────────── 5 files ─╮
│    All harnesses       16││  FILE                          LOADED BY             NOTE                                │
│  ● Claude Code         11││ GLOBAL ──────────────────────────────────────────────────────────────────────── 4 files  │
│▌ ● Codex                5││▌ AGENTS.md                     nobody                ▲ shadowed by AGENTS.override.md    │
│  ○ OpenCode     not found││  AGENTS.override.md            Codex                                                     │
│  ○ omp          not found││  summary.md                    Codex                 generated memory                    │
╰──────────────────────────╯│  topics/tools.md               Codex                 generated memory                    │
╭─ Project ────────────────╮│ PROJECT  ~/repos/shop ────────────────────────────────────────────────────────── 1 file  │
│ ▸ shop                   ││  AGENTS.md                     Codex                                                     │
│ ~/repos/shop             ││                                                                                          │
│ p switch project         ││                                                                                          │
╰──────────────────────────╯│                                                                                          │
╭─ Legend ─────────────────╮│                                                                                          │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││  Showing Codex. Hidden: auto memory is a Claude Code feature.                            │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ AGENTS.md  Codex · global · loaded at start ✗                                            │
│                          ││ ~/.codex/AGENTS.md                                                                       │
│ here uses in this project││ ▲ shadowed by AGENTS.override.md                                                         │
│ all  uses in all projects││ Global memory                                                                            │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 ↑↓ choose harness  tab back to list  s next harness                                                         row 1 of 5
```

### Small terminals

Under 100 columns the left panels fold away. The header keeps the harness filter, the list scrolls, and the detail strip drops to three lines.

```text
 ◆ agent-manager  ╱  shop  ╱  All harnesses                              ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────
╭─ Memory ────────────────────────────────────────────── 12 files · 3 entries ─╮
│  FILE                          LOADED BY             NOTE                    │
│ GLOBAL ──────────────────────────────────────────────────────────── 7 files █│
│▌ AGENTS.md                     nobody                ▲ shadowed by AGENTS.ov█│
│  AGENTS.override.md            Codex                                        █│
│  CLAUDE.md                     Claude Code                                  █│
│  rules/sub/style.md            Claude Code                                  █│
│  rules/testing.md              Claude Code                                  █│
│  summary.md                    Codex                 generated memory       █│
│  topics/tools.md               Codex                 generated memory       ▀│
│ PROJECT  ~/repos/shop ───────────────────────────────────────────── 5 files  │
│  .claude/CLAUDE.md             Claude Code                                   │
│  .claude/rules/api.md          Claude Code                                   │
│  AGENTS.md                     Codex                                         │
│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ AGENTS.md  Codex · global · loaded at start ✗                                │
│ ▲ shadowed by AGENTS.override.md                                             │
│ Global memory                                                                │
╰──────────────────────────────────────────────────────────────────────────────╯

 a add  e edit  d delete  │  / filter  u undo  ? all keys           row 1 of 15
```

### Help

Press `?` on any screen to see every key, grouped by where it works. Any key closes it. In a text field, `?` types a question mark.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                ╭─ Keys ───────────────────────────────────────────────────────────────────────────────╮
                │ Every key, grouped by where it works. Press any key to close.                        │
                │                                                                                      │
                │ MOVE AROUND                                                                          │
                │ 1-5 switch tab              tab harnesses ↔ list        ↑↓ move                      │
                │ s next harness              p switch project            / filter by name             │
                │                                                                                      │
                │ MEMORY                                                                               │
                │ a add file or entry         e ⏎ edit                    d delete                     │
                │                                                                                      │
                │ SKILLS                                                                               │
                │ a new skill                 ⏎ edit SKILL.md             c copy to                    │
                │ m move to                   d delete                                                 │
                │                                                                                      │
                │ MCP                                                                                  │
                │ a add server                e edit                      c copy to                    │
                │ space turn on/off           d delete                                                 │
                │                                                                                      │
                │ PLUGINS                                                                              │
                │ i install                   space turn on/off           U update                     │
                │ x uninstall                 m marketplaces                                           │
                │                                                                                      │
                │ HEALTH                                                                               │
                │ f fix                       r unlink                    e edit file                  │
                │                                                                                      │
                │ ANYWHERE                                                                             │
                │ u undo last change          ? this help                 q quit                       │
                │                                                                                      │
                ╰──────────────────────────────────────────────────────────────────────────────────────╯

 any key close
```

## Memory

The Memory tab lists the instruction files each harness loads, and Claude Code's auto memory entries.

- The LOADED BY column names the harnesses that load a file. `nobody` and a note explain a file that is not loaded, for example `▲ shadowed by AGENTS.override.md`.
- AUTO MEMORY lists the entries in the project's Claude Code memory folder, with their type and flags. The last row is the `MEMORY.md` budget: Claude Code loads at most 200 lines or 25 KB of it at start.
- The detail strip of an entry shows its description, its links to other entries, broken links, and the entries that link to it.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Memory ────────────────────────────────────────────────────────── 12 files · 3 entries ─╮
│▌   All harnesses       16││  FILE                          LOADED BY             NOTE                                │
│  ● Claude Code         11││  AGENTS.md                     nobody                ▲ shadowed by AGENTS.override.md    │
│  ● Codex                5││  AGENTS.override.md            Codex                                                    █│
│  ○ OpenCode     not found││  CLAUDE.md                     Claude Code                                              █│
│  ○ omp          not found││  rules/sub/style.md            Claude Code                                              █│
╰──────────────────────────╯│  rules/testing.md              Claude Code                                              █│
╭─ Project ────────────────╮│  summary.md                    Codex                 generated memory                   █│
│ ▸ shop                   ││  topics/tools.md               Codex                 generated memory                   █│
│ ~/repos/shop             ││ PROJECT  ~/repos/shop ───────────────────────────────────────────────────────── 5 files █│
│ p switch project         ││  .claude/CLAUDE.md             Claude Code                                              █│
╰──────────────────────────╯│  .claude/rules/api.md          Claude Code                                              █│
╭─ Legend ─────────────────╮│  AGENTS.md                     Codex                                                    █│
│ ✓ loaded                 ││  CLAUDE.local.md               Claude Code           private to you                     █│
│ ○ installed, turned off  ││  CLAUDE.md                     Claude Code                                              ▀│
│ · not read by harness    ││ AUTO MEMORY ───────────────────────────────────────────────────────────────── 3 entries  │
│                          ││▌ project     Release process                                                             │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ Release process  project · MEMORY.md line 1 · loaded at start ✓                          │
│                          ││ ~/.claude/projects/-Users-dev-repos-shop/memory/release-process.md                       │
│ here uses in this project││ tag, changelog, then publish                                                             │
│ all  uses in all projects││ links out   [[prefers-bun]]  [[deploy-checklist]] ▲ no such entry                        │
│                          ││ linked from nothing                                                                      │
│                          ││ 5 open Health to unlink the broken link                                                  │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 a add  e edit  d delete  │  / filter  u undo  ? all keys                                                  row 13 of 15
```

How to:

1. Add a file or an entry: press `a`, then answer the steps. The editor opens with the new file.
2. Edit: highlight a row and press `e` or `⏎`. Press `ctrl+s` to review the change, or `esc` to discard it.
3. Delete: highlight a row and press `d`, then review.

<details><summary>Add memory wizard</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────










                       ╭─ Add memory ───────────────────────────────────────────────────────────╮
                       │ Step 1 of 5                                                            │
                       │ ● Harness  ○ File  ○ Name  ○ Type  ○ Description                       │
                       │                                                                        │
                       │ Which harness should load it?                                          │
                       │ Only harnesses found on this machine are listed.                       │
                       │                                                                        │
                       │ ▌ Claude Code   CLAUDE.md, rules/<name>.md                             │
                       │   Codex         AGENTS.md, AGENTS.override.md                          │
                       ╰────────────────────────────────────────────────────────────────────────╯










 ↑↓ choose  ⏎ next  esc cancel                                                      nothing is written until you review
```

</details>

<details><summary>Editor</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ AGENTS.md ──────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│                                                                                                        Codex · global│
│ 1  Global memory                                                                                                     │
│ 2                                                                                                                    │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────── line 1, col 1 · 2 lines ─╯

 ctrl+s review and save  esc discard
```

</details>

## Skills

The Skills tab lists every skill folder each harness reads, with a mark per harness and the folder it is in. Plugin skills are read-only. The NOTE column shows read-only skills and skills that fail a harness's checks, such as a missing description.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Skills ────────────────────────────────────────────────────────────────────── 7 skills ─╮
│▌   All harnesses        7││  SKILL         FOLDER                        CC   Cx   OC   omp  here  all   NOTE        │
│  ● Claude Code          3││ GLOBAL ─────────────────────────────────────────────────────────────────────── 5 skills  │
│  ● Codex                4││▌ lint          plugin alpha@mkt              ✓    ·    ·    ·    0     0     read-only   │
│  ○ OpenCode     not found││  old-skill     ~/.codex/skills               ·    ✓    ·    ·    –     –     ▲ 1 check   │
│  ○ omp          not found││  pdf           ~/.claude/skills              ✓    ·    ·    ·    0     0                 │
╰──────────────────────────╯│  pdf           ~/.agents/skills              ·    ○    ·    ·    –     –     ▲ 1 check   │
╭─ Project ────────────────╮│  research      ~/.agents/skills              ·    ✓    ·    ·    –     –     ▲ 1 check   │
│ ▸ shop                   ││ PROJECT  ~/repos/shop ──────────────────────────────────────────────────────── 2 skills  │
│ ~/repos/shop             ││  research      .claude/skills                ✓    ·    ·    ·    0     0                 │
│ p switch project         ││  root-skill    .agents/skills                ·    ✓    ·    ·    –     –     ▲ 1 check   │
╰──────────────────────────╯│                                                                                          │
╭─ Legend ─────────────────╮│                                                                                          │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││  here / all count Claude Code transcripts since 2026-11-24.                              │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ lint  Claude Code · global                                                               │
│                          ││ ~/.claude/plugins/cache/mkt/alpha/skills/lint                                            │
│ here uses in this project││ read-only from plugin alpha@mkt                                                          │
│ all  uses in all projects││ ---                                                                                      │
│                          ││ name: lint                                                                               │
│                          ││ ---                                                                                      │
│                          ││ Lint skill                                                                               │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 a new  ⏎ edit SKILL.md  c copy to  m move to  d delete  │  / filter  u undo  ? all keys                     row 1 of 7
```

How to:

1. Create a skill: press `a`, then give a name, a description and a folder.
2. Edit `SKILL.md`: press `⏎`.
3. Copy or move a skill to another harness's folder: press `c` or `m`, then choose the folder. Moving a plugin skill makes a copy that you own.
4. Delete: press `d`.

<details><summary>Move skill wizard</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────









                       ╭─ Move skill lint ──────────────────────────────────────────────────────╮
                       │ Step 1 of 1                                                            │
                       │ ● Destination                                                          │
                       │                                                                        │
                       │ Move it to which folder?                                               │
                       │ lint comes from plugin alpha@mkt. Moving it makes a copy you own.      │
                       │                                                                        │
                       │ ▌ ~/.claude/skills   read by Claude Code                               │
                       │   ~/.agents/skills   read by Codex                                     │
                       │   ~/.codex/skills    read by Codex                                     │
                       ╰────────────────────────────────────────────────────────────────────────╯










 ↑↓ choose  ⏎ next  esc cancel                                                      nothing is written until you review
```

</details>

## MCP servers

The MCP tab lists each MCP server, its type, the file that defines it, and which harnesses load it. A server that holds a literal secret shows `▲ secret`. The detail strip masks secret values and shows `${VAR}` references, which the harness reads from your environment.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ MCP servers ──────────────────────────────────────────────────────────────── 6 servers ─╮
│▌   All harnesses        6││  SERVER        TYPE   DEFINED IN            CC   Cx   OC   omp  here  last used  NOTE    │
│  ● Claude Code          3││ GLOBAL ────────────────────────────────────────────────────────────────────── 2 servers  │
│  ● Codex                3││▌ files         stdio  ~/.codex/config.toml  ·    ○    ·    ·    –     –          ▲ secre │
│  ○ OpenCode     not found││  linear        http   ~/.codex/config.toml  ·    ✓    ·    ·    –     –          ▲ secre │
│  ○ omp          not found││ PROJECT  ~/repos/shop ─────────────────────────────────────────────────────── 4 servers  │
╰──────────────────────────╯│  files         stdio  .mcp.json             ✓    ·    ·    ·    0     never              │
╭─ Project ────────────────╮│  off-server    stdio  .mcp.json             ○    ·    ·    ·    –     –          off     │
│ ▸ shop                   ││  repo          stdio  .codex/config.toml    ·    ○    ·    ·    –     –          off     │
│ ~/repos/shop             ││  sentry        http   .mcp.json             ✓    ·    ·    ·    0     never      ▲ secre │
│ p switch project         ││                                                                                          │
╰──────────────────────────╯│                                                                                          │
╭─ Legend ─────────────────╮│                                                                                          │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││  here / all count Claude Code transcripts since 2026-11-24.                              │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ files  Codex · global · off ○                                                            │
│                          ││ ~/.codex/config.toml · mcp_servers.files                                                 │
│ here uses in this project││ command   npx -y server-files                                                            │
│ all  uses in all projects││ env       ROOT = ••••••••                                                                │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 a add  e edit  c copy to  space turn on  d delete  │  / filter  u undo  ? all keys                          row 1 of 6
```

How to:

1. Add a server: press `a`. Fill in the name, the type (`stdio`, `http` or `sse`), the command or URL, and the env or headers as `KEY=VALUE, KEY2=VALUE2`. Then check each harness to write it to, choose the scope with `←→`, and press `⏎`. The form marks each missing field.
2. Edit: press `e`. An edit stays in the server's own file.
3. Copy a server to another harness: press `c`.
4. Turn a server on or off: press `space`.
5. Delete: press `d`.

Write `${VAR}` in env and header values to keep a secret out of the file. The form marks a literal value, and Health can replace it for you.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────







            ╭─ Add MCP server ─────────────────────────────────────────────────────────────────────────────╮
            │                                                                                              │
            │ SERVER                                                                                       │
            │ ▌Name                                                                                        │
            │  Type         stdio  http  sse   ←→ change                                                   │
            │  Command                                                                                     │
            │  Args                                                                                        │
            │  Env                                                             KEY=VALUE, comma separated  │
            │              Write ${VAR} to keep a secret out of the file.                                  │
            │  Enabled     [x] on                                                                          │
            │                                                                                              │
            │ WRITE TO                                                                                     │
            │    [ ] Claude Code   ‹ Global ›  claude mcp add-json -s user                                 │
            │    [ ] Codex         ‹ Global ›  ~/.codex/config.toml                                        │
            │                                                                                              │
            ╰──────────────────────────────────────────────────────────────────────────────────────────────╯







 tab next field  space toggle  ←→ change  ⏎ review  esc cancel
```

<details><summary>Edit form</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────







            ╭─ Edit MCP server files ──────────────────────────────────────────────────────────────────────╮
            │                                                                                              │
            │ SERVER                                                                                       │
            │ ▌Name        files                                                                           │
            │  Type         stdio  http  sse   ←→ change                                                   │
            │  Command     files-mcp                                                                       │
            │  Args        --root .                                                                        │
            │  Env         TOKEN=${TOKEN}                                      KEY=VALUE, comma separated  │
            │              Write ${VAR} to keep a secret out of the file.                                  │
            │  Enabled     [x] on                                                                          │
            │                                                                                              │
            │ WRITE TO  an edit stays in its file                                                          │
            │    [x] Claude Code   Project     claude mcp add-json -s project                              │
            │                                                                                              │
            ╰──────────────────────────────────────────────────────────────────────────────────────────────╯








 tab next field  space toggle  ←→ change  ⏎ review  esc cancel
```

</details>

## Plugins

The Plugins tab lists installed plugins with their harness, state, version and marketplace. The version shows for Claude Code, which records it at install.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Plugins ───────────────────────────────────────────────────────────── 6 plugins · 3 on ─╮
│▌   All harnesses        6││  PLUGIN              HARNESS       STATE     VERSION   MARKETPLACE                       │
│  ● Claude Code          3││ GLOBAL ────────────────────────────────────────────────────────────────────── 5 plugins  │
│  ● Codex                3││▌ alpha               Claude Code   ● on      1.4.0     mkt                               │
│  ○ OpenCode     not found││  beta                Claude Code   ○ off     0.9.2     mkt                               │
│  ○ omp          not found││  github              Codex         ● on      –         official                          │
╰──────────────────────────╯│  linear              Codex         ○ off     –         official                          │
╭─ Project ────────────────╮│  slack               Codex         ○ off     –         official                          │
│ ▸ shop                   ││ PROJECT  ~/repos/shop ──────────────────────────────────────────────────────── 1 plugin  │
│ ~/repos/shop             ││  gamma               Claude Code   ● on      2.0.0     mkt                               │
│ p switch project         ││                                                                                          │
╰──────────────────────────╯│                                                                                          │
╭─ Legend ─────────────────╮│                                                                                          │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││                                                                                          │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ alpha@mkt  Claude Code · global · on ●                                                   │
│                          ││ ~/.claude/plugins/installed_plugins.json · plugins["alpha@mkt"][0]                       │
│ here uses in this project││ version   1.4.0                                                                          │
│ all  uses in all projects││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 i install  space turn off  U update  x uninstall  m marketplaces  │  / filter  u undo  ? all keys           row 1 of 6
```

How to:

1. Install: press `i`, choose the harness and the scope, then type `name@marketplace`.
2. Turn a plugin on or off: press `space`.
3. Update: press `U`.
4. Uninstall: press `x`.
5. Manage marketplaces: press `m`, then `a` to add one from a source or `d` to remove one.

Plugin changes run the harness's own command (for example `claude plugin install`). The review shows the command before it runs. Restart the harness, or start a new session, to load the change.

<details><summary>Install plugin wizard</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────










                       ╭─ Install plugin ───────────────────────────────────────────────────────╮
                       │ Step 1 of 3                                                            │
                       │ ● Harness  ○ Scope  ○ Plugin                                           │
                       │                                                                        │
                       │ Install for which harness?                                             │
                       │ Each harness shows how many marketplaces it knows.                     │
                       │                                                                        │
                       │ ▌ Claude Code   2 marketplaces                                         │
                       │   Codex         0 marketplaces                                         │
                       ╰────────────────────────────────────────────────────────────────────────╯










 ↑↓ choose  ⏎ next  esc cancel                                                      nothing is written until you review
```

</details>

<details><summary>Marketplaces</summary>

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────











            ╭─ Marketplaces ───────────────────────────────────────────────────────────────────────────────╮
            │                                                                                              │
            │  NAME          HARNESS       SOURCE                                  INSTALLED               │
            │ ▌ mkt           Claude Code   acme/claude-plugins                     3 plugins              │
            │   official      Claude Code   anthropics/claude-plugins-official      0 plugins              │
            │                                                                                              │
            ╰──────────────────────────────────────────────────────────────────────────────────────────────╯












 a add  d remove  esc back to plugins
```

</details>

## Health

The Health tab finds problems in the files your harnesses load, groups them, and fixes most of them for you:

| Group | Problem | Key |
| --- | --- | --- |
| Secrets in config | An MCP env or header value holds a literal secret | `f` replaces it with `${NAME}` |
| Auto memory | A `[[link]]` points to no entry | `r` turns it into plain text |
| Auto memory | An entry is missing from `MEMORY.md`, so it does not load at start | `f` adds its line |
| Auto memory | A `MEMORY.md` line points to a missing file | `f` drops the line |
| Auto memory | An index line is past the load limit, a header is not valid YAML, or a file is over its line budget | `e` opens the file |
| Skills | A skill fails a harness's checks | `e` opens `SKILL.md` |

Every fix opens the review first.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Health ───────────────────────────────────────────────────────────────────── 10 issues ─╮
│▌   All harnesses       16││ SECRETS IN CONFIG ─────────────────────────────────────────────────────────────────── 3  │
│  ● Claude Code         11││▌ ROOT holds a literal value                        ~/.codex/config.toml        f fix     │
│  ● Codex                5││  X-Team holds a literal value                      ~/.codex/config.toml        f fix     │
│  ○ OpenCode     not found││  Authorization holds a literal value               ~/repos/shop/.mcp.json      f fix     │
│  ○ omp          not found││ AUTO MEMORY ───────────────────────────────────────────────────────────────────────── 3  │
╰──────────────────────────╯│  [[deploy-checklist]] links to no entry            release-process.md          r unlink  │
╭─ Project ────────────────╮│  code-owners is missing from MEMORY.md             code-owners.md              f add     │
│ ▸ shop                   ││  MEMORY.md line 3 points to a missing file         MEMORY.md · staging-db.md   f drop    │
│ ~/repos/shop             ││ SKILLS ────────────────────────────────────────────────────────────────────────────── 4  │
│ p switch project         ││  Codex: description is required                    ~/.codex/skills/old-skill   e edit    │
╰──────────────────────────╯│  Codex: description is required                    ~/.agents/skills/pdf        e edit    │
╭─ Legend ─────────────────╮│  Codex: description is required                    ~/.agents/skills/research   e edit    │
│ ✓ loaded                 ││  Codex: description is required                    ~/repos/…/skills/root-skill e edit    │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││                                                                                          │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ Secret in config  ROOT holds a literal value.                                            │
│                          ││ f replaces it with ${NAME}, which the harness reads from your environment. You review it │
│ here uses in this project││ ~/.codex/config.toml                                                                     │
│ all  uses in all projects││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯

 f fix  r unlink  e edit file  │  u undo  ? all keys                                             3 secrets · 7 warnings
```

## Projects

Press `p` to see every project that Claude Code keeps data for. Press `⏎` to open one. To free space, mark projects with `space` and press `d`: this deletes their Claude Code data (transcripts and auto memory) after you review it.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────










            ╭─ Projects ───────────────────────────────────────────────────────────────────────────────────╮
            │                                                                                              │
            │     PROJECT                       CLAUDE CODE DATA                                           │
            │     /Users/dev/repos/api          ~/.claude/projects/-Users-dev-repos-api                    │
            │ ▌   ~/repos/shop                  ~/.claude/projects/-Users-dev-repos-shop    ● current      │
            │                                                                                              │
            │ d deletes the Claude Code data of the marked projects (transcripts, auto memory). You review │
            │ it first.                                                                                    │
            ╰────────────────────────────────────────────────────────────────────── 2 projects · 0 marked ─╯











 ⏎ open  space mark  d delete data  esc keep current
```

## Review, backup and undo

Nothing is written until you press `⏎` on the Review screen. It shows a summary, the diff of each file with 3 lines of context, and any command that will run. Press `↑↓` to scroll, `r` to show masked secrets, or `esc` to go back.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Review changes ─────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ 1 file edited · 1 line changed                                                                                       │
│ Nothing is written until you press ⏎. Backup: ~/.local/state/agent-manager/backups/…. Undo with u, even after you    │
│ quit.                                                                                                                │
│                                                                                                                      │
│  edit  ~/.claude/projects/-Users-dev-repos-shop/memory/release-process.md                                            │
│  3   description: tag, changelog, then publish                                                                       │
│  4   type: project                                                                                                   │
│  5   ---                                                                                                             │
│  6 - Tag first, then write the changelog. See [[prefers-bun]] and [[deploy-checklist]].                              │
│  6 + Tag first, then write the changelog. See [[prefers-bun]] and deploy-checklist.                                  │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 ⏎ apply  esc back  ↑↓ scroll
```

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲10
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Review changes ─────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ 1 file edited · 6 lines removed                                                                                      │
│ Nothing is written until you press ⏎. Backup: ~/.local/state/agent-manager/backups/…. Undo with u, even after you    │
│ quit.  r shows secrets                                                                                               │
│                                                                                                                      │
│  edit  ~/.codex/config.toml                                                                                          │
│   4   [features]                                                                                                     │
│   5   memories = true # generated memories are on                                                                    │
│   6                                                                                                                  │
│   7 - [mcp_servers.linear]                                                                                           │
│   8 - url = "https://mcp.linear.app/mcp"                                                                             │
│   9 - bearer_token_env_var = "LINEAR_TOKEN"                                                                          │
│  10 - http_headers = { "X-Team" = "••••••••" }                                                                       │
│  11 - startup_timeout_sec = 20                                                                                       │
│  12 -                                                                                                                │
│   7   [mcp_servers.files]                                                                                            │
│   8   command = "npx"                                                                                                │
│   9   args = ["-y", "server-files"]                                                                                  │
│                                                                                                                      │
│  note  Start a new Codex session to load this change.                                                                │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
│                                                                                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 ⏎ apply  esc back  ↑↓ scroll
```

When you apply a change, agent-manager saves a backup of each file it touches in `~/.local/state/agent-manager/backups` (or `$XDG_STATE_HOME/agent-manager/backups`). Press `u` on a list to undo the last change, even after you quit and start again. Undo does not reverse a command that ran, such as a plugin install, and it stops if the file changed since.

```text
 ◆ agent-manager  ╱  shop  ~/repos/shop  ╱  All harnesses                                  p project  s harness  ? keys
  1 Memory 16    2 Skills 7    3 MCP 6    4 Plugins 6    5 Health ▲9
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭─ Harnesses ──────────────╮╭─ Health ────────────────────────────────────────────────────────────────────── 9 issues ─╮
│▌   All harnesses       16││ SECRETS IN CONFIG ─────────────────────────────────────────────────────────────────── 3  │
│  ● Claude Code         11││  ROOT holds a literal value                        ~/.codex/config.toml        f fix     │
│  ● Codex                5││  X-Team holds a literal value                      ~/.codex/config.toml        f fix     │
│  ○ OpenCode     not found││  Authorization holds a literal value               ~/repos/shop/.mcp.json      f fix     │
│  ○ omp          not found││ AUTO MEMORY ───────────────────────────────────────────────────────────────────────── 2  │
╰──────────────────────────╯│▌ code-owners is missing from MEMORY.md             code-owners.md              f add     │
╭─ Project ────────────────╮│  MEMORY.md line 3 points to a missing file         MEMORY.md · staging-db.md   f drop    │
│ ▸ shop                   ││ SKILLS ────────────────────────────────────────────────────────────────────────────── 4  │
│ ~/repos/shop             ││  Codex: description is required                    ~/.codex/skills/old-skill   e edit    │
│ p switch project         ││  Codex: description is required                    ~/.agents/skills/pdf        e edit    │
╰──────────────────────────╯│  Codex: description is required                    ~/.agents/skills/research   e edit    │
╭─ Legend ─────────────────╮│  Codex: description is required                    ~/repos/…/skills/root-skill e edit    │
│ ✓ loaded                 ││                                                                                          │
│ ○ installed, turned off  ││                                                                                          │
│ · not read by harness    ││                                                                                          │
│                          ││                                                                                          │
│ CC Claude Code  Cx Codex ││┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ OC OpenCode  omp omp     ││ Not in MEMORY.md  code-owners is missing from MEMORY.md.                                 │
│                          ││ f adds its line at the top of MEMORY.md, so it loads at start. You review it first.      │
│ here uses in this project││ ~/.claude/projects/-Users-dev-repos-shop/memory/code-owners.md                           │
│ all  uses in all projects││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
│                          ││                                                                                          │
╰──────────────────────────╯╰──────────────────────────────────────────────────────────────────────────────────────────╯
 Saved. Backup › ~/.local/state/agent-manager/backups/2026-11-23T23-46-33
 f fix  r unlink  e edit file  │  u undo  ? all keys                                             3 secrets · 6 warnings
```

## Keys

| Where | Key | Action |
| --- | --- | --- |
| Everywhere | `1`–`5` | Switch tab |
| | `↑` `↓` | Move |
| | `tab` | Switch between the Harnesses panel and the list |
| | `s` | Next harness |
| | `p` | Switch project |
| | `/` | Filter by name |
| | `u` | Undo the last change |
| | `?` | Show every key |
| | `q` | Quit |
| Memory | `a` / `e` `⏎` / `d` | Add / edit / delete |
| Skills | `a` / `⏎` / `c` / `m` / `d` | New / edit `SKILL.md` / copy to / move to / delete |
| MCP | `a` / `e` / `c` / `space` / `d` | Add / edit / copy to / turn on or off / delete |
| Plugins | `i` / `space` / `U` / `x` / `m` | Install / turn on or off / update / uninstall / marketplaces |
| Health | `f` / `r` / `e` | Fix / unlink / edit file |
| Editor | `ctrl+s` / `esc` | Review and save / discard |
| MCP form | `tab` / `space` / `←→` / `⏎` | Next field / toggle / change / review |
| Review | `⏎` / `esc` / `r` | Apply / back / show secrets |
| Projects | `⏎` / `space` / `d` / `esc` | Open / mark / delete data / keep current |

## Environment variables

agent-manager reads the same variables as each harness, so it finds the same files:

| Variable | Effect |
| --- | --- |
| `CLAUDE_CONFIG_DIR` | Claude Code config folder instead of `~/.claude` |
| `CODEX_HOME` | Codex folder instead of `~/.codex` |
| `CODEX_SYSTEM_SKILLS` | Codex system skills folder instead of `/etc/codex/skills` |
| `XDG_CONFIG_HOME` | Parent of the OpenCode config folder instead of `~/.config` |
| `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` | OpenCode stops reading Claude Code files and skills |
| `OMP_PROFILE`, `PI_CODING_AGENT_DIR` | omp profile or agent folder instead of `~/.omp/agent` |
| `XDG_STATE_HOME` | Parent of the backup folder instead of `~/.local/state` |

## Development

```sh
bun test            # unit tests
bun run typecheck   # tsc --noEmit
bun run check       # both; must exit 0 before a PR
```

The code is in `src`: `adapters` holds one module per harness (it lists, reads and plans changes, but never writes), `core` applies write plans and keeps the undo log, `memory` holds the auto memory and Health checks, and `app` is the OpenTUI screen. The renderings in this README are captures of the real app from OpenTUI's test renderer (`testRender` in `@opentui/react/test-utils`), run against a demo home folder built from `test/fixtures`.
