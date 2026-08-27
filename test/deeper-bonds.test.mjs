import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	TIER,
	CLOCK_SECTIONS,
	DEFAULT_SOLID_CAP,
	emotionCount,
	deeperStrength,
	advanceClock,
	resolveFullClock,
	fillBondClock,
	makeRecord,
	solidBondCount,
	canAddSolid,
	reconcileRecords,
	canInvokeOnCheck,
} from '../scripts/rippers-deeper-bonds.mjs';

const bond = (o = {}) => ({ name: 'X', admInf: '', loyMis: '', affHat: '', bonus: 0, ...o });

/* -------- emotions & strength (strength-through-bonus) -------- */

test('emotionCount counts set axes 0..3', () => {
	assert.equal(emotionCount(bond()), 0);
	assert.equal(emotionCount(bond({ admInf: 'Admiration' })), 1);
	assert.equal(emotionCount(bond({ admInf: 'Admiration', loyMis: 'Loyalty', affHat: 'Hatred' })), 3);
});

test('deeperStrength = emotions + bonus (mirrors FU getter)', () => {
	assert.equal(deeperStrength(bond({ admInf: 'Admiration', loyMis: 'Loyalty' })), 2);
	assert.equal(deeperStrength(bond({ admInf: 'Admiration', loyMis: 'Loyalty', affHat: 'Hatred', bonus: 2 })), 5); // 3 emotions + 2 clock bonus
});

/* -------- clocks -------- */

test('advanceClock wraps and counts completions', () => {
	assert.deepEqual(advanceClock(0, 1), { clock: 1, completions: 0 });
	assert.deepEqual(advanceClock(3, 1), { clock: 0, completions: 1 });
	assert.deepEqual(advanceClock(2, 6), { clock: 0, completions: 2 });
	assert.equal(CLOCK_SECTIONS, 4);
});

test('resolveFullClock adds an emotion under 3, else bumps bonus; always +1 strength', () => {
	assert.deepEqual(resolveFullClock({ emotions: 1, bonus: 0 }), { addEmotion: true, bonusDelta: 0, strengthDelta: 1 });
	assert.deepEqual(resolveFullClock({ emotions: 3, bonus: 0 }), { addEmotion: false, bonusDelta: 1, strengthDelta: 1 });
});

test('fillBondClock: partial fill, no completion', () => {
	assert.deepEqual(fillBondClock({ clock: 0, emotions: 2, bonus: 0 }, 1), { clock: 1, completions: 0, emotionDelta: 0, bonusDelta: 0, strengthDelta: 0 });
});

test('fillBondClock: completing a clock under 3 emotions adds an emotion (+1 strength)', () => {
	assert.deepEqual(fillBondClock({ clock: 3, emotions: 1, bonus: 0 }, 1), { clock: 0, completions: 1, emotionDelta: 1, bonusDelta: 0, strengthDelta: 1 });
});

test('fillBondClock: completing at 3 emotions bumps bonus (+1 strength)', () => {
	assert.deepEqual(fillBondClock({ clock: 3, emotions: 3, bonus: 0 }, 1), { clock: 0, completions: 1, emotionDelta: 0, bonusDelta: 1, strengthDelta: 1 });
});

test('fillBondClock: two completions from 0 emotions add two emotions', () => {
	const r = fillBondClock({ clock: 0, emotions: 0, bonus: 0 }, 8);
	assert.equal(r.completions, 2);
	assert.equal(r.emotionDelta, 2);
	assert.equal(r.bonusDelta, 0);
	assert.equal(r.strengthDelta, 2);
});

/* -------- tiers & caps -------- */

test('solid bonds count toward the cap; fleeting/eternal do not', () => {
	const recs = [makeRecord('a', TIER.SOLID), makeRecord('b', TIER.SOLID), makeRecord('c', TIER.FLEETING), makeRecord('d', TIER.ETERNAL)];
	assert.equal(solidBondCount(recs), 2);
	assert.equal(canAddSolid(recs, 6), true);
	assert.equal(DEFAULT_SOLID_CAP, 6);
});

test('canAddSolid is false at the cap', () => {
	const recs = Array.from({ length: 6 }, (_, i) => makeRecord(`s${i}`, TIER.SOLID));
	assert.equal(canAddSolid(recs, 6), false);
	// eternal bonds are off the count, so they never block a new solid
	const withEternal = [...recs.slice(0, 5), makeRecord('e', TIER.ETERNAL)];
	assert.equal(canAddSolid(withEternal, 6), true); // only 5 solid
});

/* -------- reconcile (rename-safe) -------- */

test('reconcileRecords preserves tier/clock by name', () => {
	const records = [makeRecord('Ada', TIER.SOLID, 2), makeRecord('Bo', TIER.FLEETING, 0)];
	const bonds = [{ name: 'Bo' }, { name: 'Ada' }];
	const out = reconcileRecords(records, bonds);
	assert.deepEqual(out, [makeRecord('Bo', TIER.FLEETING, 0), makeRecord('Ada', TIER.SOLID, 2)]);
});

test('reconcileRecords maps a rename by slot index', () => {
	const records = [makeRecord('Ada', TIER.SOLID, 3)];
	const bonds = [{ name: 'Adaline' }]; // renamed in the same slot
	const out = reconcileRecords(records, bonds);
	assert.deepEqual(out, [makeRecord('Adaline', TIER.SOLID, 3)]); // tier/clock carried across the rename
});

test('reconcileRecords defaults an APPENDED new bond to fleeting', () => {
	const records = [makeRecord('Ada', TIER.SOLID, 1)];
	const bonds = [{ name: 'Ada' }, { name: 'New' }]; // New appended beyond the record list
	const out = reconcileRecords(records, bonds);
	assert.deepEqual(out, [makeRecord('Ada', TIER.SOLID, 1), makeRecord('New', TIER.FLEETING, 0)]);
});

test('reconcileRecords drops a removed bond (keeps only live ones)', () => {
	const records = [makeRecord('Ada', TIER.SOLID, 1), makeRecord('Bo', TIER.SOLID, 2)];
	const bonds = [{ name: 'Ada' }]; // Bo removed
	const out = reconcileRecords(records, bonds);
	assert.deepEqual(out, [makeRecord('Ada', TIER.SOLID, 1)]);
});

// NOTE (documented fragility, ⚠ owed): deleting a bond and adding another in the SAME slot is
// indistinguishable from a rename at the flag level, so same-slot replacement carries tier/clock.

/* -------- invoke: one per Check -------- */

test('canInvokeOnCheck: only the first invoke on a Check', () => {
	assert.equal(canInvokeOnCheck([]), true);
	assert.equal(canInvokeOnCheck(['Ada']), false);
});

/* -------- P1.1: solidify button state (pure UI logic) -------- */

import { solidifyButtonState } from '../scripts/rippers-deeper-bonds.mjs';

test('solidifyButtonState: shown+enabled for a fleeting bond under cap', () => {
	const records = [makeRecord('a', TIER.SOLID), makeRecord('f', TIER.FLEETING)];
	assert.deepEqual(solidifyButtonState(records[1], records, 6), { show: true, disabled: false, reason: '' });
});

test('solidifyButtonState: shown+disabled for a fleeting bond at cap', () => {
	const solids = Array.from({ length: 6 }, (_, i) => makeRecord(`s${i}`, TIER.SOLID));
	const fleeting = makeRecord('f', TIER.FLEETING);
	const st = solidifyButtonState(fleeting, [...solids, fleeting], 6);
	assert.equal(st.show, true);
	assert.equal(st.disabled, true);
	assert.match(st.reason, /cap reached/i);
});

test('solidifyButtonState: hidden for a solid or eternal bond', () => {
	assert.equal(solidifyButtonState(makeRecord('s', TIER.SOLID), []).show, false);
	assert.equal(solidifyButtonState(makeRecord('e', TIER.ETERNAL), []).show, false);
});

/* -------- invoke: FU check-push bond name (item 6 fix) -------- */

import { pushBondName } from '../scripts/rippers-deeper-bonds.mjs';

test('pushBondName reads FU 4.16.2 additionalData.push.with', () => {
	assert.equal(pushBondName({ with: 'Ada', feelings: ['Loyalty'], strength: 3, ignoreFp: false }), 'Ada');
	assert.equal(pushBondName({ bond: { name: 'Legacy' } }), 'Legacy');
	assert.equal(pushBondName({ name: 'Old' }), 'Old');
	assert.equal(pushBondName({}), null);
	assert.equal(pushBondName(undefined), null);
});
