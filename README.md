# claude-mods

Mods for [Claude Code](https://claude.com/claude-code) by DFA Course Academy.

| Mod | What it does |
| --- | --- |
| **studio** | Creator HUD above the prompt: live context, 5-hour and weekly limit bars, session cost and a last-turn summary. **REC** mode masks secrets, emails and paths on screen while you record. **Explain** opens a pane that recaps the last turn. |
| **token-meter** | Tokens and estimated API cost of the last prompt and the whole session in the status line. `/token-cost` prints the breakdown. |

## Install

In a Claude Code terminal session, type:

```
/plugin install studio --marketplace krystianwoj22/claude-mods
```

Answer `y` to add the marketplace, then press Enter to install at the user scope (all your sessions). The mod is active right away.

For token-meter:

```
/plugin install token-meter --marketplace krystianwoj22/claude-mods
```

### From a regular shell (or for the Claude desktop app)

The `/plugin` command only works in a terminal session. You can also install from any shell:

```bash
claude plugin marketplace add krystianwoj22/claude-mods
claude plugin install studio@krystian-mods
```

A mod installed at the user scope also loads in the Code tab of the Claude desktop app.

## Using studio

| Control | What it does |
| --- | --- |
| `R` / **REC** button / `/rec` | Toggle REC mode: secrets, API keys, emails and file paths are masked on screen |
| `/rec hide <text>` · `/rec show <text>` · `/rec list` | Add, remove or list your own words to mask |
| `E` / **Explain** button / `/explain` | Recap the last turn in the Explain pane |

REC mode masks what is drawn on screen. It is a recording aid, not a security boundary: always check your recording before publishing.

## Update

```bash
claude plugin marketplace update krystian-mods
```

Then restart Claude Code or run `/reload-plugins`.

## Develop

Each mod is a folder with `.claude-plugin/plugin.json`, `hooks/hooks.json` and a hooks module. Check and test a mod with:

```bash
claude plugin validate studio
claude plugin test studio
```
