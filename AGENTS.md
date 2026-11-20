# spi3der — AI development contract

## Purpose and boundaries
spi3der is the interactive 3D workshop and eyes for AI agents: a bidirectional bridge between AI, a human user, and a shared 3D scene. Its applications include modelling, teaching, scientific visualizations, presentations, simulations, games, and XR.

**3Draft** is the reusable, headless 3D presentation and interaction engine. It must not own keyboard bindings, toolbars, dialogs, or application-specific UI. **spi3der** owns the workshop, viewers, UI input mapping, MCP transports, and human/agent collaboration. Reuse 3Draft rather than fork its core. Changes to engine behavior belong upstream; compatible improvements can later flow to Spider Paint.

## Scene interaction contract
- AI and human must be able to read the same scene, observe changes, edit it, and inspect results.
- Treat the scene as a persistent shared state, not as unrelated screenshots or generated URLs. An `open_url` is a fallback, not the collaboration protocol.
- Keep geometry and scene operations independent of input devices. Keyboard, pointer, XR, and MCP map to the same commands.
- Agent operations should be addressable, inspectable, deterministic where possible, and reversible where feasible. Distinguish commands from observations.
- Separate local MCP (stdio, potentially stateful and connected to a live viewer) from remote HTTP MCP (which may be stateless). Never claim two-way live synchronization unless implemented and tested.
- Preserve the current clean, sharp-edged rendering approach. Texture-heavy/PBR pipelines are not a prerequisite.
- Prefer plain browser ES modules, no bundler, and minimal runtime dependencies. Keep code and docs in English; user-facing discussions may be Hungarian.

## Versioning — mandatory
Use the exact same date-based npm-compatible scheme as 3Draft (see `Pengeszikra/3Draft/scripts/bump.js`):

- Stored semver: `YY.M.DNNN` (three numbers, no leading zeros). The final number = day of month × 1000 + build count for that day.
- Human-readable version: `YY.MM.DD.NNN`, zero-padded. Example: `26.11.20001` displays as `26.11.20.001`.
- Each new release/version bump on the same local calendar day increments the daily build counter; on a different day it starts at 001. Never decrease the version; fail on date rollback, and do not exceed 999 builds/day.
- Run `npm run bump` to bump; `npm run bump -- --dry` to preview. The package.json version is the authoritative source. Keep UI version labels, manifests, and release metadata consistent with it; do not maintain an unrelated hard-coded version.
- A source commit or build is **not** an npm publish: explicitly report which of commit, push, build, test, and publish occurred. Do not publish automatically.

## Development workflow
1. Inspect the relevant source, tests, `APP.md`, `MCP.md`, and `README.md` before changes; legacy project documents can be stale.
2. Prefer small, independently testable changes; run `npm test` when dependencies/environment permit.
3. Verify user-to-agent and agent-to-user scene synchronization before promising inline interactive use in any host.
4. No architectural changes or unrequested product concepts by assumption; document proposed interfaces separately.
5. State clearly what was changed, what was validated, and what remains unfinished.
