---
name: spi3der
description: Model and edit 3D scenes with the spi3der MCP tools, and work on the same scene as the person in the spi3der editor shown in the conversation. Use when the person asks to open spi3der, build or change a 3D model, or look at something in 3D.
---

# Working in spi3der

spi3der is a 3D workshop. Its MCP server (`spi3der`) relays modelling steps; the geometry is built in the browser, in the real spi3der editor that opens as the conversation view. The person can use the editor's own panels and keys on the same scene you edit.

## Open a scene

Call `open_workshop` with `steps`, a list of `{ tool, args }`. Y is up, the ground is y = 0, sizes are in metres, and mesh faces are counter-clockwise seen from outside.

```json
{ "steps": [
  { "tool": "add_box", "args": { "name": "table_top", "size": [1.2, 0.05, 0.8], "at": [0, 0.75, 0], "color": "#a0764a" } },
  { "tool": "add_box", "args": { "name": "leg_fl", "size": [0.05, 0.75, 0.05], "at": [0.55, 0.375, 0.35], "color": "#6b4a2c" } }
] }
```

- Name every object after what it is (`seat`, `leg_fl`): later steps find objects by name.
- The operations are the ones listed in the tool's description: `add_box`, `add_extrusion`, `add_mesh`, `add_character`, `transform`, `place_on`, `extrude_face`, `move_vertices`, `boolean`, `recolor`, `group`, `connect`, `move_joint`, `remove`, `list`, `inspect`, `pick`, `sense` and the rest.
- To reopen or continue a scene in a new view, pass the previous result's `workshop_token` as `from`.

## Edit the open scene together

The result of `open_workshop` carries a `session_id`. While its view is open:

1. Call `workshop_state` with the `session_id` to read the scene, its revision and the status of the last edit. Use `include_scene: true` when you need exact geometry. Changes the person made in the editor show up here.
2. Call `workshop_edit` with the `session_id`, the `revision` you just read and 1–100 `steps`. The open view applies them.
3. A queued edit is not a finished one. Call `workshop_state` again and check that `last_edit.status` is `applied`; if it was rejected, the reason says which step failed.

If the revision has moved on, read the state again before you edit: the person may have changed the scene.

## Without a view

`build_model` builds a model on the server and returns an SVG render and an `open_url` link; `find` searches the deep-sky catalogue; `sky_scene` turns a star catalogue into a scene. Use these when the person wants a link or a render rather than the live editor.

## Limits

- Sessions live in the running server process and expire; they are not saved. To keep a scene, keep its `workshop_token`.
- Do not tell the person the scene changed until `workshop_state` confirms it.
