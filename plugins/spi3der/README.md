# spi3der — Claude plugin

Packages the remote spi3der MCP server (`https://spi3der.cloud.run/mcp`, no authentication) together with a skill that teaches Claude the shared-workshop workflow: `open_workshop` → `workshop_state` → `workshop_edit` on the same inline editor.

## Install

**Claude Code**

```
/plugin marketplace add Pengeszikra/spi3der
/plugin install spi3der@spi3der
```

**Claude app (web / desktop)**: upload a zip of this folder (`plugins/spi3der/`) as a `.plugin` file, or keep using the custom connector (Settings → Connectors → Add custom connector, URL above).

## Contents

| Path | Purpose |
| --- | --- |
| `.claude-plugin/plugin.json` | Claude plugin manifest |
| `.mcp.json` | the remote spi3der MCP endpoint |
| `skills/spi3der/SKILL.md` | when and how Claude uses the spi3der tools |

The plugin version (semver) is independent of spi3der's date-based npm version. The repository-root `plugin.json` / `mcp.json` remain the OpenAI / agent-plugins package.
