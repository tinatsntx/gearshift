> Historical 0.2 implementation notes. For the 0.3 companion architecture and current failed native acceptance, see the repository README and docs/RELEASE.md. Do not treat the routing claims below as verified 0.3 behavior.

# Gearshift

Gearshift is a Codex plugin that picks the model and reasoning effort for every subagent Codex starts. Small jobs go to a fast model, hard ones get deep reasoning, and you stop choosing settings by hand.

Each choice is made by the OpenAI Decisions API using **your own OpenAI API key**. There is no shared key, no publisher account, and no relay server. If you have not connected a key, Gearshift makes no API call at all.

## How it works

Codex runs a small Gearshift script just before each `spawn_agent` call. The script sends a few lines of text to the Decisions API, gets back one of six presets, and adds `model` and `reasoning_effort` to the spawn. The whole step is limited to 1.5 seconds. If anything goes wrong, the spawn goes ahead exactly as Codex wrote it.

| Preset | Model | Effort | Meant for |
|---|---|---|---|
| `luna_fast` | gpt-6-luna | low | Small mechanical or inspection tasks |
| `luna_careful` | gpt-6-luna | high | Focused bounded work with checking |
| `sol_balanced` | gpt-6.1-sol | medium | General implementation and debugging |
| `sol_deep` | gpt-6.1-sol | xhigh | Coupled changes and hard investigations |
| `astra_balanced` | gpt-6-astra | medium | Ambiguous architecture questions |
| `astra_deep` | gpt-6-astra | xhigh | The most demanding cross-system work |

These are starting points written by hand, not measured rankings. They live in the config file and you can change them.

## Two limits set by Codex

**Only bounded spawns can be re-modeled.** Codex refuses a model or effort override on a subagent that forks the parent's full history. Gearshift leaves those spawns alone. At the start of each session it gives Codex a short note asking it to delegate with `fork_turns` set to `"none"` or a small number and a self-contained task message. You can turn that note off with `gearshift config set session_guidance false`.

**The task message is usually unreadable.** On current models Codex receives each subagent's task message already encrypted, so no plugin can read it. Gearshift routes on the subagent's `task_name` instead, and the session note asks Codex to make that name descriptive, for example `refactor_credential_store_and_update_tests`. Gearshift never sends encrypted text anywhere.

## What leaves your computer

Every routing call sends:

- the subagent's task name
- the name of the parent's model
- your optimization goal, which is `balanced` unless you change it
- the list of preset names and their one-line descriptions

It also sends the subagent's task text when Codex leaves that readable, which older models do. It is clipped to 4,000 characters and key-shaped strings are removed first. Turn this off with `gearshift config set send_prompt_text false`.

It sends the message you last typed to Codex only if you turn that on with `gearshift config set include_user_prompt true`. This gives noticeably better choices, because a task name alone says little. It is off by default. While it is on, a clipped copy of your latest prompt per session is kept in the data folder for up to 24 hours.

It never sends files, diffs, the conversation, paths, or session identifiers. OpenAI's data policy for your API project applies to what is sent.

## Two separate bills

- **Decisions calls** bill your OpenAI API project at $0.10 per million input tokens. A routing call is a few hundred tokens. `gearshift status` shows the running total.
- **Coding work** stays on your Codex account, exactly as before. Gearshift never touches your Codex sign-in.

Choosing a larger model for a subagent does use more of your Codex plan than a smaller one would. Gearshift only chooses among models your Codex already offers.

## Install

You need Node 20 or newer and the Codex CLI.

```bash
codex plugin marketplace add <path-or-owner/repo of this repository>
```

```bash
codex plugin add gearshift@gearshift-local
```

Then open Codex, type `/hooks`, and trust the four Gearshift hooks. Codex will not run a plugin's hooks until you do.

Connect your key in a terminal of your own. The key is not shown as you type and is never passed through a chat.

```bash
gearshift connect
```

If `gearshift` is not on your path, run the file directly: `node <plugin folder>/bin/gearshift.mjs connect`. `gearshift doctor` prints the plugin folder.

## Commands

| Command | What it does |
|---|---|
| `gearshift connect` | Saves your API key after one small test call |
| `gearshift disconnect` | Deletes the saved key, the cache, and any saved prompts |
| `gearshift status` | Shows the connection, totals, and recent decisions |
| `gearshift route --task-name some_task` | Shows what would be chosen, without spawning anything |
| `gearshift catalog` | Refreshes the list of models your Codex offers |
| `gearshift doctor` | Checks the install, hook trust, key, and model list |
| `gearshift config` | Prints settings. `config set <key> <value>` changes one |

## Settings

Settings live in `config.json` in the data folder: `%LOCALAPPDATA%\Gearshift` on Windows, `~/.config/gearshift` elsewhere.

| Setting | Default | Meaning |
|---|---|---|
| `mode` | `auto` | `dry_run` decides and logs without changing anything. `off` does nothing |
| `optimization_goal` | `balanced` | Or `quality` or `economy` |
| `include_user_prompt` | `false` | Also send your latest prompt for better choices |
| `send_prompt_text` | `true` | Send the task text when it is readable |
| `session_guidance` | `true` | Give each session the delegation note |
| `min_confidence` | `0.6` | Below this, use the local default. Not yet calibrated |
| `deadline_ms` | `1500` | Total time allowed for a routing call |
| `allowed_models` | `null` | A list of model names to restrict choices to |
| `convert_full_forks` | `false` | Turn full-history forks into bounded ones so they can be routed. This removes context from those subagents |
| `presets`, `fallback_order` | see above | The choices offered and the local default order |

## When there is no answer

| Situation | What happens |
|---|---|
| No key connected | The local default preset is used. A one-time notice says so |
| Key rejected, or quota exhausted | The local default is used. A one-time notice says so |
| Timeout, network error, or an unexpected answer | The local default is used |
| The API abstains or is unsure | The local default is used |
| The API refuses, or returns 403 | The spawn is left unchanged |
| You or a project file set both model and effort | The spawn is left unchanged |
| A full-history fork | The spawn is left unchanged |

A local default is always recorded as a fallback. It is never reported as a Decisions result.

## Where things are stored

Everything is in the data folder on your computer: `credentials.json` holds your key, `ledger.jsonl` holds one line per decision with the task name, preset, timing, and token count, and `cache.json` remembers recent choices for five minutes. The ledger never holds task text or your prompts. On Windows the key file relies on your user profile's own access rules. On other systems it is created readable by you only.

## Development

```bash
npm test
```

The tests use no network. See [docs/spike-findings.md](docs/spike-findings.md) for what was confirmed against a real Codex, and [docs/verification.md](docs/verification.md) for what has and has not been verified.
