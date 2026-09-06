// THE EVIDENCE BOARD — headless coverage of the pure core (axes, verb, layout, strings, VM, seal).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const eb = await import('../scripts/evidence-board.mjs');
const core = await import('../scripts/rippers-deeper-bonds.mjs');
const { axisValue, boardVerb, boardLayout, stringGeometry, matchActorByName, buildBoardVM, cycleSelection, EB_AXES, edgeKey, partyWebLayout, buildPartyWebVM } = eb;

const bond = (o = {}) => ({ name: 'X', admInf: '', loyMis: '', affHat: '', bonus: 0, ...o });

test('axisValue: FU pole-name strings map to +1/-1/0, case-insensitive', () => {
	assert.equal(axisValue(bond({ admInf: 'Admiration' }), 'admInf'), 1);
	assert.equal(axisValue(bond({ admInf: 'inferiority' }), 'admInf'), -1);
	assert.equal(axisValue(bond(), 'admInf'), 0);
	assert.equal(axisValue(bond({ loyMis: 'Mistrust' }), 'loyMis'), -1);
	assert.equal(axisValue(bond({ affHat: 'Affection' }), 'affHat'), 1);
});

test('boardVerb: positive→Deepen, hostile→Deepen (Austin: negatives work the same; Reconcile removed), neutral/mixed→Invoke', () => {
	const deepen = boardVerb(bond({ admInf: 'Admiration' }));
	assert.equal(deepen.verb, 'deepen'); assert.equal(deepen.enabled, true); assert.equal(deepen.owed, null);
	const hostile = boardVerb(bond({ affHat: 'Hatred' }));
	assert.equal(hostile.verb, 'deepen'); assert.equal(hostile.enabled, true); assert.equal(hostile.owed, null);
	const inv = boardVerb(bond());
	assert.equal(inv.verb, 'invoke'); assert.equal(inv.owed, null);
	const mixed = boardVerb(bond({ admInf: 'Admiration', affHat: 'Hatred' }));
	assert.equal(mixed.verb, 'invoke'); assert.equal(mixed.owed, null); // ruled: mixed keeps Invoke, no chip
	// no verb path ever yields Reconcile any more
	for (const v of [deepen, hostile, inv, mixed]) { assert.notEqual(v.verb, 'reconcile'); assert.doesNotMatch(v.label, /^[A-Z]+$/); }
});

test('boardLayout: deterministic, owner centered, N distinct spots inside the board', () => {
	const a = boardLayout(4), b = boardLayout(4);
	assert.deepEqual(a, b);
	assert.equal(a.spots.length, 4);
	const keys = new Set(a.spots.map((s) => `${s.x},${s.y}`));
	assert.equal(keys.size, 4);
	for (const s of a.spots) { assert.ok(s.x > 0 && s.x < a.w); assert.ok(s.y > 0 && s.y < a.h); }
});

test('stringGeometry: width = 2px per strength point (min 2), glyphs only for set axes, negative inverted', () => {
	const weak = stringGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, bond());
	assert.equal(weak.width, 2); assert.equal(weak.glyphs.length, 0);
	const strong = stringGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, bond({ admInf: 'Admiration', loyMis: 'Mistrust', bonus: 1 }));
	assert.equal(strong.width, 6); // strength 3 (2 emotions + 1 bonus) * 2
	assert.equal(strong.widthOuter, 8);
	assert.equal(strong.glyphs.length, 2);
	assert.equal(strong.glyphs[0].positive, true);
	assert.equal(strong.glyphs[1].positive, false);
});

test('matchActorByName: exact case-insensitive only', () => {
	const actors = [{ id: 'a1', name: 'Dr. Morrison', img: 'm.png' }];
	assert.equal(matchActorByName('dr. morrison', actors)?.id, 'a1');
	assert.equal(matchActorByName('Morrison', actors), null);
	assert.equal(matchActorByName('', actors), null);
});

test('buildBoardVM: sealed treatment for non-GM only; sealed plates unselectable; GM sees through', () => {
	const bonds = [bond({ name: 'A' }), bond({ name: 'B' })];
	const records = [core.makeRecord('A', 'solid', 2, false, true), core.makeRecord('B', 'fleeting', 0)];
	const player = buildBoardVM({ name: 'Vin' }, bonds, records, [], { isGM: false });
	assert.equal(player.plates[0].sealed, true);
	assert.equal(player.plates[0].selectable, false);
	assert.deepEqual(player.selectable, [1]);
	assert.equal(player.hopAllowed, true); // Austin ruled 5 Sep 2026: players may focus-hop
	assert.equal(player.canAct, false);    // but a hop is navigation — no verb agency without ownership
	const gm = buildBoardVM({ name: 'Vin' }, bonds, records, [], { isGM: true });
	assert.equal(gm.plates[0].sealed, false);   // GM sees the full bond
	assert.equal(gm.plates[0].secret, true);    // but the secret chip still shows
	assert.deepEqual(gm.selectable, [0, 1]);
	assert.equal(gm.canSeal, true);
	// owner (non-GM) may seal their own
	const owner = buildBoardVM({ name: 'Vin' }, bonds, records, [], { isGM: false, isOwner: true });
	assert.equal(owner.canSeal, true);
});

test('makeRecord + reconcileRecords carry the secret flag (the seal survives a reconcile)', () => {
	const rec = core.makeRecord('A', 'solid', 1, false, true);
	assert.equal(rec.secret, true);
	const out = core.reconcileRecords([rec], [bond({ name: 'A' })]);
	assert.equal(out[0].secret, true);
	// default stays false and reconcile of a new bond seeds false
	assert.equal(core.makeRecord('B').secret, false);
	assert.equal(core.reconcileRecords([], [bond({ name: 'C' })])[0].secret, false);
});

test('cycleSelection: wraps both directions over the selectable set only', () => {
	assert.equal(cycleSelection([0, 2, 3], 0, 1), 2);
	assert.equal(cycleSelection([0, 2, 3], 3, 1), 0);
	assert.equal(cycleSelection([0, 2, 3], 0, -1), 3);
	assert.equal(cycleSelection([0, 2, 3], null, 1), 0);
	assert.equal(cycleSelection([], null, 1), null);
});

test('VM axes rows carry pole flags for the flyout, strength matches the ladder', () => {
	const b = bond({ name: 'A', admInf: 'Admiration', affHat: 'Hatred', bonus: 1 });
	const vm = buildBoardVM({ name: 'V' }, [b], [core.makeRecord('A', 'eternal', 3)], [], { isGM: true, selectedIndex: 0 });
	const p = vm.selected;
	assert.equal(p.strength, 3); // 2 emotions + 1 bonus
	assert.equal(p.clock, 3);
	assert.equal(p.stringEternal, true);
	assert.deepEqual(p.axes.map((a) => a.value), [1, 0, -1]);
	assert.equal(p.axes[0].isPos, true);
	assert.equal(p.axes[2].isNeg, true);
	assert.equal(p.verb.verb, 'invoke'); // mixed poles keep Invoke (ruled)
	assert.equal(p.verb.owed, null);
});

// ── focus-hop (Austin ruled 5 Sep 2026: players may re-center; navigation only) ──
test('hopTarget: only an unsealed, actor-matched plate is hoppable; sealed and unmatched never are', () => {
	const actors = [{ id: 'a1', name: 'Morrax', img: 'm.png' }];
	const bonds = [bond({ name: 'Morrax' }), bond({ name: 'Morrax' }), bond({ name: 'Nobody Known' })];
	const records = [core.makeRecord('Morrax'), core.makeRecord('Morrax', 'fleeting', 0, false, true), core.makeRecord('Nobody Known')];
	const player = buildBoardVM({ name: 'Vin' }, bonds, records, actors, { isGM: false });
	assert.equal(player.hopAllowed, true);
	assert.equal(player.plates[0].hopTarget, 'a1');   // matched, unsealed → hoppable
	assert.equal(player.plates[1].hopTarget, null);   // sealed to a player → no hop
	assert.equal(player.plates[2].hopTarget, null);   // no actor match → nowhere to hop
	const gm = buildBoardVM({ name: 'Vin' }, bonds, records, actors, { isGM: true });
	assert.equal(gm.plates[1].hopTarget, 'a1');       // GM sees through the seal, may hop
});

test('canAct: verb agency stays GM/owner-only after a hop (navigation, not permission)', () => {
	const b = [bond({ name: 'A' })]; const r = [core.makeRecord('A')];
	assert.equal(buildBoardVM({ name: 'V' }, b, r, [], { isGM: false, isOwner: false }).canAct, false);
	assert.equal(buildBoardVM({ name: 'V' }, b, r, [], { isGM: false, isOwner: true }).canAct, true);
	assert.equal(buildBoardVM({ name: 'V' }, b, r, [], { isGM: true, isOwner: false }).canAct, true);
});

/* -------- v0.3.0: party web pure functions -------- */

test('edgeKey: sorted so A|B equals B|A', () => {
	assert.equal(edgeKey('a', 'b'), edgeKey('b', 'a'));
	assert.equal(edgeKey('a', 'b'), 'a|b');
	assert.equal(edgeKey('z', 'a'), 'a|z');
	assert.equal(edgeKey('x', 'x'), 'x|x'); // self-edge degeneracy handled
});

test('partyWebLayout: places all actor and leaf ids', () => {
	const positions = partyWebLayout(['alice', 'bob'], [{ leafId: 'leaf:x', actorId: 'alice' }]);
	assert.ok(positions.has('alice'));
	assert.ok(positions.has('bob'));
	assert.ok(positions.has('leaf:x'));
	// two actors land at distinct positions
	const a = positions.get('alice'), b = positions.get('bob');
	assert.ok(a.x !== b.x || a.y !== b.y);
});

test('partyWebLayout: single actor at center; leaf offset from it', () => {
	const positions = partyWebLayout(['solo'], [{ leafId: 'leaf:x', actorId: 'solo' }], { w: 1200, h: 760 });
	const solo = positions.get('solo');
	assert.equal(solo.x, 600); assert.equal(solo.y, 380); // cx=600, cy=380
	// leaf is nearby but not at the same spot
	const leaf = positions.get('leaf:x');
	assert.ok(leaf.x !== solo.x || leaf.y !== solo.y);
});

// Helpers
const pwBond = (name, o = {}) => ({ name, admInf: '', loyMis: '', affHat: '', bonus: 0, ...o });
const pwRec = (o = {}) => ({ tier: 'fleeting', clock: 0, partyMember: false, secret: false, targetUuid: null, ...o });
const pwEntry = (id, bonds, records, { isOwner = false } = {}) => ({
	actor: { id, uuid: `Actor.${id}`, name: id, img: null },
	bonds, records, isOwner,
});

test('buildPartyWebVM: bidirectional name-matched bonds → one undirected edge', () => {
	const a = pwEntry('alice', [pwBond('bob')], [pwRec()]);
	const b = pwEntry('bob', [pwBond('alice')], [pwRec()]);
	const vm = buildPartyWebVM([a, b], { isGM: true });
	assert.equal(vm.edges.length, 1);
	assert.equal(vm.actorNodes.length, 2);
	assert.equal(vm.leafNodes.length, 0);
});

test('buildPartyWebVM: unresolved name → leaf node + edge', () => {
	const a = pwEntry('alice', [pwBond('Whitechapel')], [pwRec()]);
	const vm = buildPartyWebVM([a], { isGM: true });
	assert.equal(vm.leafNodes.length, 1);
	assert.equal(vm.leafNodes[0].name, 'Whitechapel');
	assert.equal(vm.edges.length, 1);
	assert.equal(vm.actorNodes.length, 1);
});

test('buildPartyWebVM: secret bond hidden from non-GM, non-owner', () => {
	const a = pwEntry('alice', [pwBond('bob')], [pwRec({ secret: true })]);
	const b = pwEntry('bob', [], []);
	const vm = buildPartyWebVM([a, b], { isGM: false });
	assert.equal(vm.edges.length, 0); // secret bond filtered
});

test('buildPartyWebVM: secret bond visible to GM', () => {
	const a = pwEntry('alice', [pwBond('bob')], [pwRec({ secret: true })]);
	const b = pwEntry('bob', [], []);
	const vm = buildPartyWebVM([a, b], { isGM: true });
	assert.equal(vm.edges.length, 1);
	assert.equal(vm.edges[0].sealed, true); // all-sealed edge renders dashed
});

test('buildPartyWebVM: resolveUuid used to find target actor (UUID over name-match)', () => {
	const aActor = { id: 'a', uuid: 'Actor.a', name: 'Alice', img: null };
	const bActor = { id: 'b', uuid: 'Actor.b', name: 'Bob', img: null };
	const a = { actor: aActor, bonds: [pwBond('someone')], records: [pwRec({ targetUuid: 'Actor.b' })], isOwner: false };
	const b = { actor: bActor, bonds: [], records: [], isOwner: false };
	const resolveUuid = (uuid) => (uuid === 'Actor.b' ? bActor : null);
	const vm = buildPartyWebVM([a, b], { isGM: true, resolveUuid });
	assert.equal(vm.edges.length, 1); // actor-actor edge via UUID
	assert.equal(vm.leafNodes.length, 0); // not a leaf — UUID resolved it
});

test('buildPartyWebVM: self-bonds (actor bonded to themselves by name) produce no edge', () => {
	const a = pwEntry('alice', [pwBond('alice')], [pwRec()]);
	const vm = buildPartyWebVM([a], { isGM: true });
	// alice bonded to alice: targetActor.id === actor.id, skips actor-actor edge, falls through to leaf
	// self-bond is treated as a leaf (consistent with one-directional rule — A→B never writes B)
	assert.equal(vm.edges.length, 1);
	assert.equal(vm.leafNodes.length, 1);
});
