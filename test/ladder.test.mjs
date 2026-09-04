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
	cleanseWithBond,
	sharedResolve,
	isPartyMemberBond,
	setBondPartyMember,
	qualifyingCleanseStatuses,
	FU_AFFLICTION_STATUSES,
	CLEANSABLE_STATUSES,
} from '../scripts/rippers-deeper-bonds.mjs';

/** Minimal FU-ish actor stub. statuses is a Set; toggleStatusEffect records removals. */
function stubActor({ strength = 3, statuses = [], attrs = { dex: 8, ins: 8, mig: 8, wlp: 8 }, limits = { cleanse: {}, dieUpScene: false }, partyMember = true } = {}) {
	const removed = [];
	const flag = { ...limits };
	// v0.2.3: the bonds flag now carries per-bond records incl. partyMember. getFlag is key-sensitive:
	// 'bonds' → the record array, anything else (limits) → the mutable limits object.
	let bondRecords = [{ name: 'x', tier: 'fleeting', clock: 0, partyMember }];
	return {
		removed,
		name: 'x',
		system: { bonds: [{ name: 'x', strength }], attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, { base: v }])) },
		statuses: new Set(statuses),
		effects: [],
		getFlag: (_m, k) => (k === 'bonds' ? bondRecords : flag),
		setFlag: async (_m, k, v) => { if (k === 'bonds') bondRecords = v; else Object.assign(flag, v); },
		update: async () => {},
		toggleStatusEffect: async (id) => { removed.push(id); return true; },
	};
}

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

/* -------- FU-integration regressions (v0.2.2: the three live-verified ladder bugs) -------- */

function withGame(fn) {
	globalThis.game = { user: { isActiveGM: true }, modules: { get: () => null }, actors: { getName: () => null } };
	globalThis.ui = { notifications: { info: () => {}, warn: () => {} } };
	return fn();
}

// BUG 2 — die stored as a NUMBER at .base; raise 8->10, cap 12 (was reading .current -> undefined -> 'maxed').
test('raiseDie handles numeric base dice: 8->10, 12->noop (v0.2.2)', () => {
	assert.equal(raiseDie(8), 10);
	assert.equal(raiseDie(10), 12);
	assert.equal(raiseDie(12), 12); // d12 cap
	assert.equal(raiseDie('d8'), 'd10'); // string form still works
});

// v0.2.3 — SHARED RESOLVE (was coverRegen): per-bond, party-member only, once per scene, holder MP recovery.
// Resolves (no ReferenceError) when FU pipelines are unavailable (dynamic import fails in node).
test('sharedResolve: party bond str3 recovers 15 MP to the holder; second use this scene is refused', async () => {
	await withGame(async () => {
		const actor = stubActor({ strength: 3, partyMember: true });
		const r = await sharedResolve(actor, 'x');
		assert.deepEqual(r, { bond: 'x', amount: 15 });          // str3 -> 15 MP; MP apply skipped (no FU), no throw
		const again = await sharedResolve(actor, 'x');
		assert.equal(again, 'used-this-scene');                  // once per scene
	});
});

test('sharedResolve + cleanseWithBond are gated to PARTY-MEMBER bonds (v0.2.3 Austin ruling)', async () => {
	await withGame(async () => {
		const npc = stubActor({ strength: 3, partyMember: false, statuses: ['weak'] });
		assert.equal(await sharedResolve(npc, 'x'), 'not-party');
		assert.equal(await cleanseWithBond(npc, 'x'), 'not-party'); // status-recover hidden/refused for non-party bonds
	});
});

test('setBondPartyMember toggles the flag; isPartyMemberBond reads it', async () => {
	const actor = stubActor({ partyMember: false });
	assert.equal(isPartyMemberBond(actor, 'x'), false);
	assert.equal(await setBondPartyMember(actor, 'x', true), true);
	assert.equal(isPartyMemberBond(actor, 'x'), true);
	assert.equal(await setBondPartyMember(actor, 'nope', true), false); // unknown bond
});

// BUG 3 — cleanse the FU affliction set + our custom 'affliction', not only 'affliction'.
test('qualifyingCleanseStatuses reads the FU affliction set (v0.2.2)', () => {
	assert.ok(FU_AFFLICTION_STATUSES.includes('weak'));
	assert.ok(CLEANSABLE_STATUSES.includes('affliction'));
	assert.deepEqual(qualifyingCleanseStatuses(stubActor({ statuses: ['weak', 'ko'] })), ['weak']); // 'ko' not cleansable
});

test('cleanseWithBond removes a single active FU status and spends one budget (v0.2.2)', async () => {
	await withGame(async () => {
		const actor = stubActor({ strength: 2, statuses: ['weak'] });
		const r = await cleanseWithBond(actor, 'x');
		assert.equal(r, 'cleansed');
		assert.deepEqual(actor.removed, ['weak']);
		assert.equal(actor.getFlag().cleanse.x, 1); // budget spent only on success
	});
});

test('cleanseWithBond returns noop with no qualifying status (v0.2.2)', async () => {
	await withGame(async () => {
		const actor = stubActor({ strength: 2, statuses: [] });
		assert.equal(await cleanseWithBond(actor, 'x'), 'noop');
		assert.equal(actor.getFlag().cleanse.x ?? 0, 0); // nothing spent
	});
});

test('cleanseWithBond returns ambiguous with several statuses and spends nothing (v0.2.2)', async () => {
	await withGame(async () => {
		const actor = stubActor({ strength: 3, statuses: ['weak', 'slow', 'poisoned'] });
		assert.equal(await cleanseWithBond(actor, 'x'), 'ambiguous');
		assert.deepEqual(actor.removed, []);
		assert.equal(actor.getFlag().cleanse.x ?? 0, 0);
		// caller re-calls with the picked status:
		assert.equal(await cleanseWithBond(actor, 'x', { statusId: 'slow' }), 'cleansed');
		assert.deepEqual(actor.removed, ['slow']);
	});
});
