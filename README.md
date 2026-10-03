# usage-band

A Claude Code mod that draws a quiet instrument strip above the prompt:

![usage-band in the Claude Code desktop app](docs/usage-band-desktop.png)

<sub>The strip above the prompt in the Claude Code desktop app.</sub>

| Cell | What it shows |
| --- | --- |
| **5H** | Share of your 5-hour rate-limit window used. The grey tick marks how far through the window you are, so a fill past the tick means you're ahead of pace. |
| **7D** | The same for the 7-day window, one dot per day. |
| **↑ ━ ↓** | Input and output tokens this session (subagents included). The line between them shows the split. |
| **$** | Session cost so far. |

Everything stays monochrome. A meter turns **amber** at 75% (or when well ahead of pace) and **red** at 90%.

Works in the desktop Code tab (drawn as SVG) and the terminal (one text line). The 5H/7D cells appear on subscription plans once the first response arrives.

## Install

```
/plugin marketplace add DoingSomethinh/usage-band-marketplace
/plugin install usage-band@usage-band
/reload-plugins
```

`/usage-band` shows or hides the strip.

## Notes

- Token counts come from each model request the session makes; background requests such as auto-compaction aren't included, while cost is.
- ↑ counts uncached input plus cache writes; cache reads aren't added.
- `/clear` resets the token counts.

## Develop

```
claude --plugin-dir ./plugins/usage-band
claude plugin validate ./plugins/usage-band
claude plugin test ./plugins/usage-band
```
