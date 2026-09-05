// THE EVIDENCE BOARD — headless coverage of the pure core (axes, verb, layout, strings, VM, seal).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const eb = await import('../scripts/evidence-board.mjs');
const core = await import('../scripts/rippers-deeper-bonds.mjs');
const { axisValue, boardVerb, boardLayout, stringGeometry, matchActorByName, buildBoardVM, cycleSelection, EB_AXES } = eb;

const bond = (o = {}) => ({ name: 'X', admInf: '', loyMis: '', affHat: '', bonus: 0, ...o });

test('axisValue: FU pole-name strings map to +1/-1/0, case-insensitive', () => {
	assert.equal(axisValue(bond({ admInf: 'Admiration' }), 'admInf'), 1);
	assert.equal(axisValue(bond({ admInf: 'inferiority' }), 'admInf'), -1);
	assert.equal(axisValue(bond(), 'admInf'), 0);
	assert.equal(axisValue(bond({ loyMis: 'Mistrust' }), 'loyMis'), -1);
	assert.equal(axisValue(bond({ affHat: 'Affection' }), 'affHat'), 1);
});

test('boardVerb: positive→Deepen, hostile→Reconcile(disabled+owed), neutral→Invoke, mixed→Invoke+owed', () => {
	const deepen = boardVerb(bond({ admInf: 'Admiration' }));
	assert.equal(deepen.verb, 'deepen'); assert.equal(deepen.enabled, true); assert.equal(deepen.owed, null);
	const rec = boardVerb(bond({ affHat: 'Hatred' }));
	assert.equal(rec.verb, 'reconcile'); assert.equal(rec.enabled, false); assert.match(rec.owed, /unruled/);
	const inv = boardVerb(bond());
	assert.equal(inv.verb, 'invoke'); assert.equal(inv.owed, null);
	const mixed = boardVerb(bond({ admInf: 'Admiration', affHat: 'Hatred' }));
	assert.equal(mixed.verb, 'invoke'); assert.match(mixed.owed, /mixed/);
	// labels are natural case (Pirata never all-caps)
	for (const v of [deepen, rec, inv, mixed]) assert.doesNotMatch(v.label, /^[A-Z]+$/);
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
	assert.equal(player.hopAllowed, false); // permission rule owed — no hop for players
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
	assert.equal(p.verb.verb, 'invoke'); // mixed
	assert.match(p.verb.owed, /mixed/);
});
