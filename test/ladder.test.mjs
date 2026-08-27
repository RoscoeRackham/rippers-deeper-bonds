import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	TIER,
	DEFAULT_SOLID_CAP,
	makeRecord,
	ladderAbilities,
	cleanseUsesPerRest,
	canCleanse,
	coverRegenAmount,
	pickCoverRegenBond,
	canRaiseDieThisScene,
	raiseDie,
	DIE_LADDER,
	planSolidifyAtRest,
	canInterludeFill,
} from '../scripts/rippers-deeper-bonds.mjs';

/* -------- ladder gating -------- */

test('ladderAbilities gates by strength; skill-grant is eternal-only', () => {
	assert.deepEqual(ladderAbilities(1, TIER.SOLID), { cleanse: false, coverRegen: false, coverRegenMp: 0, attrDieUp: false, skillGrant: false });
	assert.deepEqual(ladderAbilities(2, TIER.SOLID), { cleanse: true, coverRegen: true, coverRegenMp: 10, attrDieUp: false, skillGrant: false });
	assert.deepEqual(ladderAbilities(3, TIER.SOLID), { cleanse: true, coverRegen: true, coverRegenMp: 15, attrDieUp: true, skillGrant: false });
	assert.equal(ladderAbilities(4, TIER.ETERNAL).skillGrant, true);
	assert.equal(ladderAbilities(4, TIER.SOLID).skillGrant, false); // strength 4 but not eternal tier
});

/* -------- str2 cleanse: strength× per rest -------- */

test('cleanse is usable strength times per rest', () => {
	assert.equal(cleanseUsesPerRest(3), 3);
	assert.equal(canCleanse(3, 0), true);
	assert.equal(canCleanse(3, 2), true);
	assert.equal(canCleanse(3, 3), false); // exhausted
	assert.equal(canCleanse(1, 0), false); // below str2
});

/* -------- cover-regen: amount + one-per-trigger -------- */

test('coverRegenAmount = strength×5 at str2+, else 0', () => {
	assert.equal(coverRegenAmount(1), 0);
	assert.equal(coverRegenAmount(2), 10);
	assert.equal(coverRegenAmount(4), 20);
});

test('pickCoverRegenBond picks one (strongest) qualifying bond — ruling 5', () => {
	const chosen = pickCoverRegenBond([{ name: 'a', strength: 2 }, { name: 'b', strength: 4 }, { name: 'c', strength: 1 }]);
	assert.equal(chosen.name, 'b');
	assert.equal(pickCoverRegenBond([{ name: 'x', strength: 1 }]), null); // none qualify
	assert.equal(pickCoverRegenBond([]), null);
});

/* -------- str3 die-up: once per scene + ladder -------- */

test('attribute die-up is once per scene, one size up capped at d12', () => {
	assert.equal(canRaiseDieThisScene(false), true);
	assert.equal(canRaiseDieThisScene(true), false);
	assert.deepEqual([...DIE_LADDER], ['d6', 'd8', 'd10', 'd12']);
	assert.equal(raiseDie('d6'), 'd8');
	assert.equal(raiseDie('d10'), 'd12');
	assert.equal(raiseDie('d12'), 'd12'); // capped
	assert.equal(raiseDie('d20'), 'd20'); // unknown unchanged
});

/* -------- solidify at rest -------- */

test('planSolidifyAtRest: selected fleeting -> solid (cap), rest erased, solid/eternal kept', () => {
	const records = [
		makeRecord('Sol', TIER.SOLID, 2),
		makeRecord('Et', TIER.ETERNAL, 0),
		makeRecord('F1', TIER.FLEETING, 0),
		makeRecord('F2', TIER.FLEETING, 0),
		makeRecord('F3', TIER.FLEETING, 0),
	];
	const out = planSolidifyAtRest(records, ['F1', 'F3'], 6);
	assert.deepEqual(out, [
		makeRecord('Sol', TIER.SOLID, 2),
		makeRecord('Et', TIER.ETERNAL, 0),
		makeRecord('F1', TIER.SOLID, 0), // solidified
		makeRecord('F3', TIER.SOLID, 0), // solidified
		// F2 erased (not selected)
	]);
});

test('planSolidifyAtRest: selected-but-over-cap fleeting are erased too', () => {
	const solids = Array.from({ length: 5 }, (_, i) => makeRecord(`s${i}`, TIER.SOLID));
	const records = [...solids, makeRecord('Fa', TIER.FLEETING), makeRecord('Fb', TIER.FLEETING)];
	const out = planSolidifyAtRest(records, ['Fa', 'Fb'], 6); // cap 6, 5 solid -> only 1 slot
	const solidNames = out.filter((r) => r.tier === TIER.SOLID).map((r) => r.name);
	assert.equal(solidNames.length, 6); // 5 + exactly one new
	assert.ok(solidNames.includes('Fa')); // first selected solidified
	assert.ok(!out.some((r) => r.name === 'Fb')); // Fb couldn't fit -> erased
});

test('canInterludeFill: once between rests', () => {
	assert.equal(canInterludeFill(false), true);
	assert.equal(canInterludeFill(true), false);
});
