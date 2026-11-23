// build_story: a model + motions -> a valid Spider Build v2 story in a #story= link (both storage modes), and open_workshop story.
import assert from 'node:assert/strict';
import { handleWorkshopMcp } from '../mcp/workshop-app.js';
import { unpack } from '../mcp/http.js';
import { validateBuildDocument, sceneAt } from '../models/spider-build-v2.mjs';

const ctx = { origin: 'https://spi3der.test', fetchText: async () => { throw new Error('no static files in this test'); } };
let id = 0;
const call = async (name, args) => {
  const r = await handleWorkshopMcp({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, ctx);
  return r.result;
};

const list = await handleWorkshopMcp({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, ctx);
assert.ok(list.result.tools.some((t) => t.name === 'build_story'), 'build_story is listed');

// a 3-level pyramid of 14 bricks: one brick + instance copies
const copies = [];
for (let k = 0; k < 3; k++) for (let i = 0; i < 3 - k; i++) for (let j = 0; j < 3 - k; j++) if (k || i || j) copies.push({ at: [i - (2 - k) / 2, k * 0.5, j - (2 - k) / 2] });
const steps = [
  { tool: 'add_box', args: { name: 'brick', size: [0.94, 0.46, 0.94], at: [-1, 0.23, -1], color: '#c8a165' } },
  { tool: 'instance', args: { name: 'pyr', source: 'brick', copies } },
];
const motions = [
  { object: 'pyr-13', keys: [{ t: 0 }, { t: 600, move: [0, 2, 0] }, { t: 1200, move: [4, 0, 0], rotate: [0, 90, 0] }] },
  { objects: ['pyr-1', 'pyr-2'], keys: [{ t: 300 }, { t: 1500, move: [0, 0, 3] }] },
  { match: '*-5', keys: [{ t: 0 }, { t: 900, move: [0, 0, -3] }] },
];

// animation mode (few distinct motions)
let r = await call('build_story', { title: 'Pyramid test', steps, motions, captions: [{ start: 0, end: 1000, text: 'Taking it apart' }] });
assert.ok(!r.isError, r.content?.[0]?.text);
let out = JSON.parse(r.content[0].text);
assert.equal(out.mode, 'animation');
assert.equal(out.objects, 14);
assert.ok(out.animated >= 2);
assert.ok(out.open_url.startsWith('https://spi3der.test/#story='));
assert.ok(out.player_url.startsWith('https://spi3der.test/player.html#story='));
assert.equal(r.content.filter((c) => c.type === 'image').length, 3, 'three preview frames');
let doc = unpack(out.story_token);
validateBuildDocument(doc);
const top = (t) => sceneAt(doc, t).find((o) => o.name === 'pyr-13').mesh.positions.reduce((m, p) => Math.max(m, p[1]), -Infinity);
assert.ok(Math.abs(top(0) - 1.46) < 1e-3, 'the top brick starts in place');
assert.ok(top(600) > 3.4, 'the top brick lifts');

// frames mode (stop-motion), forced
r = await call('build_story', { steps, motions, mode: 'frames', include_doc: true, preview: false });
assert.ok(!r.isError, r.content?.[0]?.text);
out = JSON.parse(r.content[0].text);
assert.equal(out.mode, 'frames');
assert.ok(out.frames > 5);
validateBuildDocument(out.story);
assert.equal(r.content.length, 1);
const endTop = sceneAt(out.story, out.duration_ms).find((o) => o.name === 'pyr-13').mesh.positions.reduce((m, p) => Math.max(m, p[1]), -Infinity);
assert.ok(Math.abs(endTop - 1.46) < 1e-3, 'it lands back on the ground level of its own height');

// auto picks frames above 64 distinct motions
const many = Array.from({ length: 13 }, (_, i) => ({ object: `pyr-${i + 1}`, keys: [{ t: i * 10 }, { t: 400 + i * 10, move: [i, 0, 0] }] }))
  .concat([{ object: 'brick', keys: [{ t: 0 }, { t: 200, move: [0, 1, 0] }] }]);
r = await call('build_story', { steps, motions: many, mode: 'animation', preview: false });
assert.equal(JSON.parse(r.content[0].text).mode, 'animation');

// errors are plain
r = await call('build_story', { steps, motions: [{ object: 'nope', keys: [{ t: 0 }] }] });
assert.ok(r.isError && /no object "nope"/.test(r.content[0].text));
r = await call('build_story', { motions });
assert.ok(r.isError && /give the model/.test(r.content[0].text));

// open_workshop plays a story inline
r = await call('open_workshop', { story: out.open_url ?? '' });
const ok = await call('build_story', { steps, motions, preview: false });
const token = JSON.parse(ok.content[0].text).story_token;
r = await call('open_workshop', { story: token });
assert.ok(!r.isError, r.content?.[0]?.text);
assert.equal(r.structuredContent.story_token, token);
assert.equal(r._meta.ui.resourceUri.startsWith('ui://spi3der/'), true);
r = await call('open_workshop', { story: token, steps: [] });
assert.ok(r.isError);

console.log('story: ok');
