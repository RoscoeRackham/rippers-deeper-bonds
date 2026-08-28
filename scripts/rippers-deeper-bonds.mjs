/**
 * rippers-deeper-bonds — the campaign's Deeper Bonds system (Aaron Jolliffe playtest, adopted) for
 * Project FU (Foundry v13). Replaces FU's core bond mechanic with tiers + clocks + a strength ladder.
 *
 * ARCHITECTURE (EXTEND, verified against projectfu 4.16.2 — do NOT fork the system):
 *   - Bonds stay in `actor.system.bonds` (FU's BondDataModel: {name, admInf, loyMis, affHat, bonus}).
 *     FU's sheet, party bond-chart, expressions.mjs countBonds/maximumBondStrength and the `strength`
 *     getter all keep working.
 *   - BondDataModel is a DataModel that STRIPS unknown inline keys, so our per-bond data (tier, clock)
 *     lives in a MODULE FLAG `flags.rippers-deeper-bonds.bonds`, keyed by bond name (+ index tiebreak),
 *     reconciled on rename.
 *   - Clock-earned strength is pushed into the bond's own `bonus` field so FU's `strength` getter
 *     returns the Deeper strength with ZERO FU change (Penny Knight etc. keep reading `strength`).
 *
 * This file is split into a PURE CORE (headless-testable, no Foundry globals) and GUARDED FOUNDRY GLUE
 * (only wires up when `globalThis.Hooks?.once` exists). Under `node --test` a bare import is inert.
 * SOURCING: adapts FU integration LOGIC only (MIT — THIRD-PARTY-NOTICES.md); no FU prose, no invented
 * rules value. Mechanics are canon from lodge-docs/RULE-deeper-bonds.md.
 */

/* ============================================================ *
 *  Constants
 * ============================================================ */

export const MODULE_ID = 'rippers-deeper-bonds';
export const SYSTEM_ID = 'projectfu';
export const BONDS_FLAG = 'bonds';

export const TIER = Object.freeze({ FLEETING: 'fleeting', SOLID: 'solid', ETERNAL: 'eternal' });
export const CLOCK_SECTIONS = 4;
export const MAX_EMOTIONS = 3;
export const DEFAULT_SOLID_CAP = 6; // ruling 2: 6 -> 8 with Power of Friendship + Empathetic (P3 detection)

/* ============================================================ *
 *  Pure core — emotions & strength
 * ============================================================ */

/** Emotion count of a FU bond (0..3) — the Adm/Inf, Loy/Mis, Aff/Hat axes that are set. */
export function emotionCount(bond) {
	return [bond?.admInf, bond?.loyMis, bond?.affHat].filter(Boolean).length;
}

/**
 * Deeper strength as FU's own getter computes it: emotions + local `bonus` (+ FU global bondStrength,
 * added by FU at runtime). We write clock-earned strength into `bonus`, so this mirrors FU exactly.
 */
export function deeperStrength(bond) {
	return emotionCount(bond) + (Number(bond?.bonus) || 0);
}

/* ============================================================ *
 *  Pure core — clocks
 * ============================================================ */

/** Advance a 4-section clock by `n`, wrapping; returns the new position and how many times it filled. */
export function advanceClock(clock, n = 1) {
	let c = (Number(clock) || 0) + (Number(n) || 0);
	let completions = 0;
	while (c >= CLOCK_SECTIONS) {
		c -= CLOCK_SECTIONS;
		completions++;
	}
	return { clock: c, completions };
}

/**
 * Full-clock resolution (ruling per SPEC/god): erase -> if emotions < 3 add an emotion, else +1 to the
 * bond's `bonus`; either way strength +1.
 */
export function resolveFullClock({ emotions = 0, bonus = 0 } = {}) {
	const addEmotion = emotions < MAX_EMOTIONS;
	return { addEmotion, bonusDelta: addEmotion ? 0 : 1, strengthDelta: 1 };
}

/**
 * Fill a solid bond's clock by `sections` and resolve any completions. Returns the new clock position
 * and the deltas the caller must apply to the FU bond: how many emotions to add (player-chosen axis),
 * how much to bump `bonus`, and the total strength change.
 * @returns {{ clock:number, completions:number, emotionDelta:number, bonusDelta:number, strengthDelta:number }}
 */
export function fillBondClock({ clock = 0, emotions = 0, bonus = 0 } = {}, sections = 1) {
	const adv = advanceClock(clock, sections);
	let emotionDelta = 0;
	let bonusDelta = 0;
	let strengthDelta = 0;
	for (let k = 0; k < adv.completions; k++) {
		const r = resolveFullClock({ emotions: emotions + emotionDelta, bonus: bonus + bonusDelta });
		strengthDelta += r.strengthDelta;
		if (r.addEmotion) emotionDelta += 1;
		else bonusDelta += r.bonusDelta;
	}
	return { clock: adv.clock, completions: adv.completions, emotionDelta, bonusDelta, strengthDelta };
}

/* ============================================================ *
 *  Pure core — records, tiers & caps
 * ============================================================ */

/** A per-bond Deeper record (the flag payload). Strength/emotions live on the FU bond; this is tier+clock. */
export function makeRecord(name, tier = TIER.FLEETING, clock = 0) {
	return { name: name ?? '', tier, clock: Math.max(0, Math.min(CLOCK_SECTIONS, Number(clock) || 0)) };
}

export function isSolid(record) {
	return record?.tier === TIER.SOLID;
}
export function isEternal(record) {
	return record?.tier === TIER.ETERNAL;
}

/** Solid bonds count toward the cap; fleeting is unlimited; eternal is OFF the count (ruling). */
export function solidBondCount(records = []) {
	return records.filter(isSolid).length;
}
export function canAddSolid(records = [], cap = DEFAULT_SOLID_CAP) {
	return solidBondCount(records) < cap;
}

/**
 * Reconcile flag records against the live FU bond array (rename-safe): align 1:1 with `bonds`, preserving
 * tier/clock by name first, then by slot index (a rename keeps its slot), defaulting brand-new bonds to
 * fleeting. Drops records whose bond is gone.
 */
export function reconcileRecords(records = [], bonds = []) {
	const used = new Set();
	return bonds.map((bond, i) => {
		let idx = records.findIndex((r, ri) => !used.has(ri) && r.name === bond.name);
		if (idx === -1 && records[i] && !used.has(i)) idx = i; // rename: same slot, new name
		if (idx !== -1) {
			used.add(idx);
			return makeRecord(bond.name, records[idx].tier, records[idx].clock);
		}
		return makeRecord(bond.name, TIER.FLEETING, 0);
	});
}

/** One bond may be invoked per Check (ruling F11). */
export function canInvokeOnCheck(invokedThisCheck = []) {
	return (invokedThisCheck?.length ?? 0) === 0;
}

/**
 * The invoked bond's NAME out of FU's check-push payload. Verified against projectfu 4.16.2
 * (checks/check-push.mjs getPushParams): `additionalData.push = { with, feelings, strength, ignoreFp }`
 * — the bond name is `push.with`. Legacy shapes kept as fallbacks.
 */
export function pushBondName(push) {
	return push?.with ?? push?.bond?.name ?? push?.name ?? null;
}

/**
 * Pure UI state for a bond row's SOLIDIFY button: shown only for fleeting bonds, disabled (with a
 * reason) when the solid cap is reached. Drives the sheet controls without touching the DOM.
 * @returns {{ show: boolean, disabled: boolean, reason: string }}
 */
export function solidifyButtonState(record, records = [], cap = DEFAULT_SOLID_CAP) {
	const show = record?.tier === TIER.FLEETING;
	const disabled = show && !canAddSolid(records, cap);
	return { show, disabled, reason: disabled ? `Solid bond cap reached (${cap})` : '' };
}

/* ============================================================ *
 *  Pure core — P2 strength ladder, limits, cover-regen, solidify
 * ============================================================ */

/** Which ladder abilities a bond has, by strength + tier. Str4 = eternal. */
export function ladderAbilities(strength, tier) {
	const s = Number(strength) || 0;
	return {
		cleanse: s >= 2,
		coverRegen: s >= 2,
		coverRegenMp: s >= 2 ? s * 5 : 0, // strength × 5 MP both ways
		attrDieUp: s >= 3,
		skillGrant: tier === TIER.ETERNAL, // str-4 eternal skill-grant
	};
}

/** Str2 cleanse is usable `strength` times per rest. */
export function cleanseUsesPerRest(strength) {
	return Math.max(0, Number(strength) || 0);
}
export function canCleanse(strength, usesThisRest = 0) {
	return (Number(strength) || 0) >= 2 && (Number(usesThisRest) || 0) < cleanseUsesPerRest(strength);
}

/** Cover-regen MP for a bond of this strength (0 below str2). */
export function coverRegenAmount(strength) {
	const s = Number(strength) || 0;
	return s >= 2 ? s * 5 : 0;
}

/** Ruling 5: one bond's cover-regen per trigger — pick the strongest qualifying bond. */
export function pickCoverRegenBond(candidates = []) {
	const q = candidates.filter((c) => (Number(c?.strength) || 0) >= 2);
	if (!q.length) return null;
	return q.reduce((best, c) => ((Number(c.strength) || 0) > (Number(best.strength) || 0) ? c : best));
}

/** Str3 attribute-die-up is once per scene. */
export function canRaiseDieThisScene(usedThisScene = false) {
	return !usedThisScene;
}

/** FU attribute die ladder; raise one size (capped at d12). */
export const DIE_LADDER = Object.freeze(['d6', 'd8', 'd10', 'd12']);
export function raiseDie(die) {
	const i = DIE_LADDER.indexOf(die);
	return i >= 0 && i < DIE_LADDER.length - 1 ? DIE_LADDER[i + 1] : die;
}

/**
 * Solidify-at-rest: turn selected fleeting bonds solid (respecting the cap), keep solid/eternal, and
 * ERASE every remaining fleeting bond (selected-but-over-cap included). Writing a new solid + changing
 * an emotion are separate manual steps. Returns the new record set (fleeting clocks reset to 0 on solidify).
 */
export function planSolidifyAtRest(records = [], selectedFleeting = [], cap = DEFAULT_SOLID_CAP) {
	const sel = new Set(selectedFleeting);
	let solidCount = records.filter(isSolid).length;
	const out = [];
	for (const r of records) {
		if (r.tier === TIER.FLEETING) {
			if (sel.has(r.name) && solidCount < cap) {
				out.push(makeRecord(r.name, TIER.SOLID, 0));
				solidCount++;
			}
			// every other fleeting is erased (not carried forward)
		} else {
			out.push(r); // solid / eternal survive
		}
	}
	return out;
}

/** Interlude fills a clock once between rests. */
export function canInterludeFill(usedSinceRest = false) {
	return !usedSinceRest;
}

/** Clock-fill trigger labels (for GM controls; all resolve to a one-section fill). */
export const CLOCK_TRIGGER = Object.freeze({
	OPPORTUNITY: 'opportunity',
	INTERLUDE: 'interlude',
	INVOKE: 'invoke',
	NPC_FIRST_APPEARANCE: 'npc-first-appearance',
	VILLAIN_FP: 'villain-fp',
});

/* ============================================================ *
 *  Guarded Foundry / Project FU glue
 * ============================================================ */

function isActiveGM() {
	return !!globalThis.game?.user?.isActiveGM;
}

/** Read our per-bond records for an actor, reconciled against the live bonds. */
export function getRecords(actor) {
	const stored = actor?.getFlag?.(MODULE_ID, BONDS_FLAG);
	const bonds = Array.isArray(actor?.system?.bonds) ? actor.system.bonds : [];
	return reconcileRecords(Array.isArray(stored) ? stored : [], bonds);
}

async function setRecords(actor, records) {
	await actor.setFlag(MODULE_ID, BONDS_FLAG, records);
}

/** Deeper record for a single bond by name (index tiebreak). */
export function recordFor(actor, name, index) {
	const records = getRecords(actor);
	if (Number.isInteger(index) && records[index]?.name === name) return records[index];
	return records.find((r) => r.name === name) ?? null;
}

/* -------- bond CRUD (GM-authoritative, tiered caps) -------- */

/** Create a fleeting bond (unlimited) with one emotion, or bare. Writes the FU bond + our record. */
export async function createFleetingBond(actor, { name, admInf = '', loyMis = '', affHat = '' } = {}) {
	if (!isActiveGM() || !actor || !name) return false;
	const bonds = foundry.utils.deepClone(actor.system.bonds ?? []);
	bonds.push({ name, admInf, loyMis, affHat, bonus: 0 });
	await actor.update({ 'system.bonds': bonds });
	const records = getRecords(actor); // reconciled — new bond defaults fleeting
	await setRecords(actor, records);
	return true;
}

/** Turn a fleeting bond solid, respecting the solid cap. */
export async function solidifyBond(actor, name, { cap = DEFAULT_SOLID_CAP } = {}) {
	if (!isActiveGM() || !actor) return false;
	const records = getRecords(actor);
	const rec = records.find((r) => r.name === name);
	if (!rec || rec.tier === TIER.SOLID || rec.tier === TIER.ETERNAL) return false;
	if (!canAddSolid(records, cap)) return false; // cap reached
	rec.tier = TIER.SOLID;
	await setRecords(actor, records);
	return true;
}

/** Promote a solid bond to eternal (side-quest gated — GM action). Off the six-cap. */
export async function promoteEternal(actor, name) {
	if (!isActiveGM() || !actor) return false;
	const records = getRecords(actor);
	const rec = records.find((r) => r.name === name);
	if (!rec || rec.tier === TIER.ETERNAL) return false;
	rec.tier = TIER.ETERNAL;
	await setRecords(actor, records);
	return true;
}

/**
 * Fill a solid bond's clock by `sections` (opportunity / interlude / invoke / NPC-first / villain-FP).
 * Applies the full-clock resolution: bumps the FU bond's `bonus` and/or leaves an emotion for the player
 * to add (returned in `emotionDelta`), and returns the strength change. Only solid bonds carry clocks.
 */
export async function fillClock(actor, name, sections = 1) {
	if (!isActiveGM() || !actor) return null;
	const records = getRecords(actor);
	const idx = records.findIndex((r) => r.name === name);
	const rec = records[idx];
	if (!rec || rec.tier !== TIER.SOLID) return null;
	const bond = actor.system.bonds.find((b) => b.name === name);
	const result = fillBondClock({ clock: rec.clock, emotions: emotionCount(bond), bonus: Number(bond?.bonus) || 0 }, sections);
	rec.clock = result.clock;
	await setRecords(actor, records);
	if (result.bonusDelta) {
		const bonds = foundry.utils.deepClone(actor.system.bonds);
		const b = bonds.find((x) => x.name === name);
		if (b) b.bonus = (Number(b.bonus) || 0) + result.bonusDelta;
		await actor.update({ 'system.bonds': bonds });
	}
	// emotionDelta emotions are a player choice (which axis/pole) — surfaced to the GM, not auto-picked.
	return result;
}

/* ============================================================ *
 *  P2 — strength-ladder effects, limits, solidify-at-rest
 *  Per-rest / per-scene counters live in flags.rippers-deeper-bonds.limits, reset on FU's REST_EVENT
 *  (cleanse + interlude) and endOfCombat (die-up). Str2 cleanse DEPENDS on rippers-conditions' status
 *  API — it is not duplicated here.
 * ============================================================ */

const LIMITS_FLAG = 'limits';
const CONDITIONS_ID = 'rippers-conditions';
// Status ids the rippers-conditions API keys on (its exported AFFLICTION_STATUS/REGENERATION_STATUS).
// Defined here so cleanseWithBond's default param + status routing resolve at runtime.
const AFFLICTION_STATUS = 'affliction';
const REGENERATION_STATUS = 'regeneration';
const ATTR_KEYS = Object.freeze(['dex', 'ins', 'mig', 'wlp']);

function getLimits(actor) {
	return actor?.getFlag?.(MODULE_ID, LIMITS_FLAG) ?? { cleanse: {}, dieUpScene: false };
}
async function setLimits(actor, limits) {
	await actor.setFlag(MODULE_ID, LIMITS_FLAG, limits);
}

/** Bond strength as FU computes it (emotions + bonus + global), read off the live bond. */
export function bondStrength(actor, name) {
	const bond = actor?.system?.bonds?.find?.((b) => b.name === name);
	if (!bond) return 0;
	return Number(bond.strength) || deeperStrength(bond); // FU getter if present, else our mirror
}

/** Reach the rippers-conditions status API, if installed + active. */
function conditionsApi() {
	return globalThis.game?.modules?.get?.(CONDITIONS_ID)?.api ?? null;
}

/**
 * Str2 — cleanse one status off the bonded character (an action; `strength`× per rest). Depends on
 * rippers-conditions for status removal (clearAffliction / clearRegeneration); a generic FU status
 * falls back to FU's toggleStatusEffect. Enforces the per-rest cap.
 * @returns {'cleansed'|'exhausted'|'too-weak'|'noop'}
 */
export async function cleanseWithBond(actor, name, { statusId = AFFLICTION_STATUS } = {}) {
	if (!isActiveGM() || !actor) return 'noop';
	const strength = bondStrength(actor, name);
	const limits = getLimits(actor);
	const used = Number(limits.cleanse?.[name]) || 0;
	if (strength < 2) return 'too-weak';
	if (!canCleanse(strength, used)) return 'exhausted';
	const targetActor = globalThis.game?.actors?.getName?.(name) ?? actor; // bonded character if it's a world actor
	const cond = conditionsApi();
	let done = false;
	if (cond && statusId === AFFLICTION_STATUS && cond.clearAffliction) done = await cond.clearAffliction(targetActor);
	else if (cond && statusId === REGENERATION_STATUS && cond.clearRegeneration) done = await cond.clearRegeneration(targetActor);
	else {
		// generic FU status — remove the effect carrying it, if present
		const eff = targetActor?.effects?.find?.((e) => e.statuses?.has?.(statusId));
		if (eff) {
			await eff.delete();
			done = true;
		}
	}
	if (!done) return 'noop';
	limits.cleanse = { ...(limits.cleanse ?? {}), [name]: used + 1 };
	await setLimits(actor, limits);
	return 'cleansed';
}

/**
 * Str2 — cover-regen: when cover triggers, ONE qualifying bond regens (strength×5) MP both ways
 * (ruling 5). Applies MP recovery through FU's ResourcePipeline (feature-detected, fail-soft).
 * @param {object} actor  the covering character
 * @param {string[]} candidateNames  bonds that qualify on this cover
 */
export async function coverRegen(actor, candidateNames = []) {
	if (!isActiveGM() || !actor) return null;
	const candidates = candidateNames.map((n) => ({ name: n, strength: bondStrength(actor, n) }));
	const chosen = pickCoverRegenBond(candidates);
	if (!chosen) return null;
	const amount = coverRegenAmount(chosen.strength);
	const other = globalThis.game?.actors?.getName?.(chosen.name) ?? null;
	const fu = await getFuPipelines();
	if (fu) {
		for (const who of [actor, other].filter(Boolean)) {
			try {
				const req = new fu.ResourceRequest(fu.InlineSourceInfo.fromInstance(who), [who], 'mp', amount, false);
				await fu.ResourcePipeline.processRecovery(req);
			} catch (err) {
				console.warn(`${MODULE_ID} | cover-regen MP apply failed`, err);
			}
		}
	}
	return { bond: chosen.name, amount };
}

/**
 * Str3 — on invoke, once per scene, raise one Attribute die one size for the scene. Applies a tagged
 * update to `system.attributes.<attr>.current`, recording the original to revert at scene end.
 * @param {string} attr  one of dex/ins/mig/wlp
 */
export async function raiseAttributeDie(actor, name, attr) {
	if (!isActiveGM() || !actor) return 'noop';
	if (bondStrength(actor, name) < 3) return 'too-weak';
	const limits = getLimits(actor);
	if (!canRaiseDieThisScene(limits.dieUpScene)) return 'used-this-scene';
	const cur = actor?.system?.attributes?.[attr]?.current;
	const next = raiseDie(cur);
	if (!cur || next === cur) return 'noop';
	// record original for scene-end revert
	const scene = { ...(limits.dieUp ?? {}), attr, from: cur };
	await actor.update({ [`system.attributes.${attr}.current`]: next });
	await setLimits(actor, { ...limits, dieUpScene: true, dieUp: scene });
	return 'raised';
}

/** Str4 eternal — store the GM-chosen granted-skill slot on the bond record (pick + apply is manual). */
export async function setEternalSkillGrant(actor, name, { skillName = '', skillUuid = '' } = {}) {
	if (!isActiveGM() || !actor) return false;
	const records = getRecords(actor);
	const rec = records.find((r) => r.name === name);
	if (!rec || rec.tier !== TIER.ETERNAL) return false;
	rec.grantedSkill = { skillName, skillUuid };
	await setRecords(actor, records);
	return true;
}

/** Solidify-at-rest: apply the plan — solidify selected fleeting (cap), ERASE remaining fleeting bonds. */
export async function solidifyAtRest(actor, selectedFleeting = [], { cap = DEFAULT_SOLID_CAP } = {}) {
	if (!isActiveGM() || !actor) return false;
	const records = getRecords(actor);
	const kept = planSolidifyAtRest(records, selectedFleeting, cap);
	const keptNames = new Set(kept.map((r) => r.name));
	// drop erased fleeting from the FU bond array
	const bonds = (actor.system.bonds ?? []).filter((b) => keptNames.has(b.name));
	await actor.update({ 'system.bonds': bonds });
	await setRecords(actor, kept);
	return true;
}

/** Reset per-rest limits (cleanse uses + interlude flags) — wired to FU's REST_EVENT. */
async function onRest(actor) {
	if (!isActiveGM() || !actor) return;
	const limits = getLimits(actor);
	if (limits.cleanse || limits.interlude) await setLimits(actor, { ...limits, cleanse: {}, interlude: {} });
}

/** Scene end: revert a die-up and clear the per-scene flag — wired to endOfCombat. */
async function onSceneEnd(actor) {
	if (!isActiveGM() || !actor) return;
	const limits = getLimits(actor);
	if (limits.dieUp?.attr) {
		try {
			await actor.update({ [`system.attributes.${limits.dieUp.attr}.current`]: limits.dieUp.from });
		} catch (err) {
			console.warn(`${MODULE_ID} | die-up revert failed`, err);
		}
	}
	if (limits.dieUpScene || limits.dieUp) await setLimits(actor, { ...limits, dieUpScene: false, dieUp: null });
}

/* -------- invoke: piggyback FU check-push -------- */

/**
 * Handle a bond invoke that FU's check-push performed (it already spends the Fabula Point and adds the
 * bond's strength to the roll just made). We enforce one-per-Check and fill the invoked bond's clock.
 * `formedThisCheck` = the free exception (a fleeting bond formed mid-Check by an FP invokes free — the
 * clock still fills, but this is not a second FP charge; FU handled the FP).
 * @returns {'invoked'|'already-invoked'|'noop'}
 */
export async function onBondInvoked(actor, name, { invokedThisCheck = [] } = {}) {
	if (!isActiveGM() || !actor || !name) return 'noop';
	if (!canInvokeOnCheck(invokedThisCheck)) return 'already-invoked';
	const rec = recordFor(actor, name);
	if (rec?.tier === TIER.SOLID) await fillClock(actor, name, 1); // invoking fills a section
	return 'invoked';
}

/* -------- FU cap setting + sheet display + wiring -------- */

/** Raise/disable FU's optionBondMaxLength so it never caps total bonds (fleeting is unlimited). */
async function relaxFuBondCap() {
	try {
		const key = 'optionBondMaxLength';
		if (globalThis.game?.settings?.settings?.has?.(`${SYSTEM_ID}.${key}`)) {
			const current = globalThis.game.settings.get(SYSTEM_ID, key);
			if (typeof current === 'number' && current < 99) await globalThis.game.settings.set(SYSTEM_ID, key, 99);
		}
	} catch (err) {
		console.warn(`${MODULE_ID} | could not relax FU optionBondMaxLength`, err);
	}
}

const TIER_CLASS = { fleeting: 'rdb-tier-fleeting', solid: 'rdb-tier-solid', eternal: 'rdb-tier-eternal' };

const TIER_LABEL = { fleeting: 'Fleeting', solid: 'Solid', eternal: 'Eternal' };

function mkButton(label, title, { disabled = false, onClick, className } = {}) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = className ? `rdb-btn ${className}` : 'rdb-btn';
	b.textContent = label;
	b.title = title;
	if (disabled) {
		b.disabled = true;
		b.classList.add('rdb-disabled');
	} else if (onClick) {
		b.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			onClick();
		});
	}
	return b;
}

/** Light GM feedback for a ladder-effect result string. */
function notifyResult(map, result) {
	const msg = map[result];
	if (!msg) return;
	const kind = result === 'cleansed' || result === 'raised' ? 'info' : 'warn';
	globalThis.ui?.notifications?.[kind]?.(msg);
}

/**
 * Add the strength-ladder action buttons (Cleanse / Cover-Regen / Raise Die / Grant Skill) to a bond's
 * control bar. Each appears only when the bond qualifies; disabled + reason-tooltip when spent this
 * rest/scene (mirrors the Solidify pattern). GM-only; the API functions themselves re-check permissions.
 */
function addLadderButtons(bar, actor, rec) {
	const strength = bondStrength(actor, rec.name);
	const abilities = ladderAbilities(strength, rec.tier);
	const limits = getLimits(actor);

	// Str≥2 — Cleanse one status off the bonded character (an action; strength× per rest).
	if (abilities.cleanse) {
		const uses = cleanseUsesPerRest(strength);
		const used = Number(limits.cleanse?.[rec.name]) || 0;
		const ok = canCleanse(strength, used);
		bar.appendChild(
			mkButton('Cleanse', ok ? `Cleanse one status off ${rec.name} — ${uses - used} of ${uses} left this rest` : `No cleanses left until rest (${used}/${uses} used)`, {
				className: 'rdb-btn--ladder',
				disabled: !ok,
				onClick: async () => {
					const r = await cleanseWithBond(actor, rec.name);
					notifyResult({ cleansed: `Cleansed a status via ${rec.name}.`, exhausted: 'No cleanses left until the next rest.', 'too-weak': 'Bond is too weak to cleanse (needs strength 2).', noop: 'No status to cleanse.' }, r);
				},
			}),
		);
	}

	// Str≥2 — Cover-Regen: one qualifying bond regens strength×5 MP both ways.
	if (abilities.coverRegen) {
		bar.appendChild(
			mkButton('Cover-Regen', `Cover-regen: ${abilities.coverRegenMp} MP to both (strength × 5)`, {
				className: 'rdb-btn--ladder',
				onClick: async () => {
					const r = await coverRegen(actor, [rec.name]);
					globalThis.ui?.notifications?.info?.(r ? `${rec.name}: cover-regen ${r.amount} MP.` : 'Cover-regen did not apply.');
				},
			}),
		);
	}

	// Str≥3 — Raise one Attribute die a size for the scene (once per scene). Pick the attribute.
	if (abilities.attrDieUp) {
		const spent = !canRaiseDieThisScene(limits.dieUpScene);
		bar.appendChild(
			mkButton('Raise Die', spent ? 'Already raised a die this scene' : 'Raise one attribute die a size for the scene (once/scene)', {
				className: 'rdb-btn--ladder',
				disabled: spent,
				onClick: async () => {
					const attr = await pickAttribute(actor);
					if (!attr) return;
					const r = await raiseAttributeDie(actor, rec.name, attr);
					notifyResult({ raised: `Raised ${attr.toUpperCase()} a size for the scene.`, 'used-this-scene': 'Already raised a die this scene.', 'too-weak': 'Bond is too weak (needs strength 3).', noop: 'Could not raise that die (already at d12?).' }, r);
				},
			}),
		);
	}

	// Eternal (str4) — grant one of their skills at SL1 (GM records the chosen skill).
	if (abilities.skillGrant) {
		const granted = rec.grantedSkill?.skillName;
		bar.appendChild(
			mkButton('Grant Skill', granted ? `Granted skill: ${granted} (click to change)` : `Record one of ${rec.name}'s skills as granted at SL1`, {
				className: 'rdb-btn--ladder',
				onClick: async () => {
					const skillName = await pickSkillName(actor, rec);
					if (skillName == null) return;
					const ok = await setEternalSkillGrant(actor, rec.name, { skillName });
					globalThis.ui?.notifications?.[ok ? 'info' : 'warn']?.(ok ? `Recorded granted skill: ${skillName || '(cleared)'}.` : 'Could not record the granted skill.');
				},
			}),
		);
	}
}

/** Small GM picker: which attribute die to raise. Resolves to 'dex'|'ins'|'mig'|'wlp' or null. */
async function pickAttribute(actor) {
	const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
	if (!DialogV2) return null;
	const buttons = ATTR_KEYS.map((a) => ({
		action: a,
		label: `${a.toUpperCase()} (${actor?.system?.attributes?.[a]?.current ?? '?'})`,
		callback: () => a,
	}));
	buttons.push({ action: 'cancel', label: 'Cancel', callback: () => null });
	return DialogV2.wait({ window: { title: 'Raise which attribute die?' }, content: '<p>Raise one attribute die a size for the scene.</p>', buttons });
}

/** Small GM prompt: name one of the bonded character's skills to grant at SL1. Resolves to string or null. */
async function pickSkillName(actor, rec) {
	const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
	if (!DialogV2) return null;
	const current = rec?.grantedSkill?.skillName ?? '';
	return DialogV2.wait({
		window: { title: `Grant a skill from ${rec.name}` },
		content: `<form><p>Name one of ${rec.name}'s skills to grant at SL1 (leave blank to clear).</p><input type="text" name="skill" value="${current}" placeholder="Skill name" style="width:100%"/></form>`,
		buttons: [
			{ action: 'ok', label: 'Record', default: true, callback: (_ev, button) => button.form.querySelector('input[name="skill"]').value.trim() },
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
	});
}

/**
 * Inject the tier gradient, a 4-section clock, and GM tier-CRUD controls onto each bond row, plus a
 * section-level "new fleeting bond" control. Reuses the existing API — no new mechanics. Defensive
 * against FU's bond-row markup.
 */
/**
 * Locate FU's bonds fieldset + its bond rows in the LIVE 4.16.2 sheet (templates/actor/partials/
 * actor-bonds.hbs): a <fieldset> with a <legend class="bond-add">, whose bond rows are child
 * `div.flexrow` elements each carrying a delete `button[data-bond-index]` — the stable row index.
 */
function findBondSection(root) {
	let fieldset = null;
	for (const fs of root.querySelectorAll('fieldset')) {
		if (fs.querySelector('legend.bond-add')) {
			fieldset = fs;
			break;
		}
	}
	if (!fieldset) return { fieldset: null, rows: [] };
	const rows = Array.from(fieldset.querySelectorAll(':scope > div.flexrow')).map((el) => {
		const idxAttr = el.querySelector('button[data-bond-index]')?.getAttribute('data-bond-index');
		return { el, index: idxAttr == null ? null : Number(idxAttr) };
	});
	return { fieldset, rows };
}

/**
 * Inject tier tag + clock + GM tier-CRUD controls onto FU's bond rows, and a section-level new-bond
 * control. Wired to `renderFUStandardActorSheet` (the hook FU's ApplicationV2 sheet actually fires —
 * proven by rippers-guise), resolving the root from `app.element`.
 */
function injectBondControls(app) {
	try {
		const actor = app?.actor ?? app?.document;
		if (!actor || !Array.isArray(actor.system?.bonds)) return;
		const isGM = !!globalThis.game?.user?.isGM;
		const el = app?.element;
		const root = el?.jquery ? el[0] : el; // ApplicationV2 element is a DOM node; tolerate jQuery
		if (!root?.querySelectorAll) return;
		const { fieldset, rows } = findBondSection(root);
		if (!fieldset || !rows.length) return;
		const records = getRecords(actor);
		rows.forEach(({ el: row, index }) => {
			const rec = index == null ? null : records[index];
			// idempotent per row: our bar is a SIBLING after the FU row, not a child of it
			if (!rec || row.nextElementSibling?.classList?.contains?.('rdb-bar')) return;
			row.classList?.add?.(TIER_CLASS[rec.tier] ?? ''); // left-edge accent stays on the FU row

			// A full-width horizontal control BAR beneath the bond's FU row (flex-wrap, no overflow).
			// It is a SIBLING appended after the row — never a child squeezed into FU's flexrow.
			const bar = document.createElement('div');
			bar.className = 'rdb-bar';

			// tier indicator (always visible, at the left of the bar)
			const tag = document.createElement('span');
			tag.className = `rdb-tier-tag ${TIER_CLASS[rec.tier] ?? ''}`;
			tag.textContent = TIER_LABEL[rec.tier] ?? rec.tier;
			bar.appendChild(tag);

			// clock for solid bonds (click to fill, GM)
			if (rec.tier === TIER.SOLID) {
				const clock = document.createElement('span');
				clock.className = 'rdb-clock';
				clock.title = `Bond clock ${rec.clock}/${CLOCK_SECTIONS}${isGM ? ' — click to fill' : ''}`;
				clock.textContent = '●'.repeat(rec.clock) + '○'.repeat(CLOCK_SECTIONS - rec.clock);
				if (isGM) {
					clock.classList.add('rdb-clock--clickable'); // class-driven pointer/hover (CSS tail)
					clock.addEventListener('click', () => fillClock(actor, rec.name, 1));
				}
				bar.appendChild(clock);
			}

			// GM tier-CRUD + strength-ladder buttons
			if (isGM) {
				const sol = solidifyButtonState(rec, records);
				if (sol.show) {
					bar.appendChild(
						mkButton('Solidify', sol.disabled ? sol.reason : 'Make this bond solid (adds a Bond Clock)', {
							disabled: sol.disabled,
							onClick: () => solidifyBond(actor, rec.name),
						}),
					);
				}
				if (rec.tier === TIER.SOLID) {
					bar.appendChild(mkButton('→ Eternal', 'Promote to an eternal bond (off the six-cap, side-quest gated)', { onClick: () => promoteEternal(actor, rec.name) }));
					// clock-fill trigger buttons (each fills one section) — for triggers FU can't auto-detect
					bar.appendChild(mkButton('◷ Opp', 'Fill a clock section — opportunity', { className: 'rdb-btn--tick', onClick: () => fillClock(actor, rec.name, 1) }));
					bar.appendChild(mkButton('◷ Interlude', 'Fill a clock section — interlude (once between rests)', { className: 'rdb-btn--tick', onClick: () => fillClock(actor, rec.name, 1) }));
					bar.appendChild(mkButton('◷ NPC', 'Fill a clock section — NPC first appearance this session', { className: 'rdb-btn--tick', onClick: () => fillClock(actor, rec.name, 1) }));
					bar.appendChild(mkButton('◷ Villain FP', 'Fill a clock section — a Fabula Point from this Villain’s appearance', { className: 'rdb-btn--tick', onClick: () => fillClock(actor, rec.name, 1) }));
				}
				addLadderButtons(bar, actor, rec);
			}

			row.insertAdjacentElement?.('afterend', bar); // sibling bar, full panel width
		});

		// section-level controls (GM), appended once inside the bonds fieldset
		if (isGM && !fieldset.querySelector?.('.rdb-new-bond')) {
			const add = mkButton('+ New fleeting bond', 'Create a new fleeting bond (edit name + emotions in the normal bond fields)', {
				onClick: () => createFleetingBond(actor, { name: 'New Bond' }),
			});
			add.classList.add('rdb-new-bond');
			fieldset.appendChild(add);
			const solidify = mkButton('Solidify at rest…', 'Turn selected fleeting bonds solid (cap-checked); remaining fleeting are erased', {
				onClick: () => openSolidifyDialog(actor),
			});
			solidify.classList.add('rdb-solidify-rest');
			fieldset.appendChild(solidify);
		}
	} catch (err) {
		console.warn(`${MODULE_ID} | sheet injection failed`, err);
	}
}

export function getModuleApi() {
	return {
		getRecords,
		recordFor,
		createFleetingBond,
		solidifyBond,
		promoteEternal,
		fillClock,
		onBondInvoked,
		deeperStrength,
		TIER,
		// P2 — ladder effects, limits, solidify
		bondStrength,
		ladderAbilities,
		cleanseWithBond,
		coverRegen,
		raiseAttributeDie,
		setEternalSkillGrant,
		solidifyAtRest,
	};
}

/** Open a simple solidify-at-rest dialog: pick which fleeting bonds become solid (cap-checked). */
async function openSolidifyDialog(actor) {
	const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
	if (!DialogV2 || !actor) return;
	const records = getRecords(actor);
	const fleeting = records.filter((r) => r.tier === TIER.FLEETING);
	if (!fleeting.length) {
		globalThis.ui?.notifications?.info?.('No fleeting bonds to solidify.');
		return;
	}
	const rows = fleeting.map((r) => `<label style="display:block"><input type="checkbox" name="sol" value="${r.name}"/> ${r.name}</label>`).join('');
	await DialogV2.wait({
		window: { title: `Solidify at rest — ${actor.name}` },
		content: `<form><p>Selected fleeting bonds become solid (cap ${DEFAULT_SOLID_CAP}). <strong>All remaining fleeting bonds are erased.</strong></p>${rows}</form>`,
		buttons: [
			{
				action: 'apply',
				label: 'Solidify',
				default: true,
				callback: (_ev, button) => {
					const chosen = Array.from(button.form.querySelectorAll('input[name="sol"]:checked')).map((el) => el.value);
					return solidifyAtRest(actor, chosen);
				},
			},
			{ action: 'cancel', label: 'Cancel' },
		],
	});
}

/* -------- boot (guarded: inert under `node --test`) -------- */

if (globalThis.Hooks?.once) {
	globalThis.Hooks.once('ready', () => {
		const mod = globalThis.game?.modules?.get?.(MODULE_ID);
		if (mod) mod.api = getModuleApi();
		if (isActiveGM()) relaxFuBondCap();

		// P2 limit resets: per-rest (cleanse/interlude) on FU REST_EVENT; per-scene (die-up) on endOfCombat.
		const FUHooks = globalThis.game?.projectfu?.hooks;
		const REST_EVENT = FUHooks?.REST_EVENT ?? 'projectfu.events.rest';
		const COMBAT_EVENT = FUHooks?.COMBAT_EVENT ?? 'projectfu.events.combat';
		globalThis.Hooks.on(REST_EVENT, (event) => {
			const actor = event?.actor ?? event?.actors?.[0];
			if (actor) onRest(actor);
		});
		globalThis.Hooks.on(COMBAT_EVENT, (event) => {
			if (event?.type !== 'endOfCombat') return;
			for (const actor of Array.isArray(event?.actors) ? event.actors : []) onSceneEnd(actor);
		});
	});

	// FU's ApplicationV2 PC sheet fires its OWN render hook (NOT renderActorSheet) — proven by
	// rippers-guise (Hooks.on('renderFUStandardActorSheet', ...)). Mirror it; keep the NPC variant too.
	globalThis.Hooks.on('renderFUStandardActorSheet', (app) => injectBondControls(app));
	globalThis.Hooks.on('renderFUActorSheet', (app) => injectBondControls(app));

	// Invoke = FU check-push. Hook FU's renderCheck to fill the invoked bond's clock + enforce one/Check.
	// The push data's exact bond-name field is verified at install (⚠ COVERAGE.md), so read defensively.
	globalThis.Hooks.once('ready', () => {
		const renderCheck = globalThis.game?.projectfu?.CheckHooks?.renderCheck ?? `${SYSTEM_ID}.renderCheck`;
		globalThis.Hooks.on(renderCheck, (data, checkResult) => {
			try {
				if (!isActiveGM()) return;
				const push = checkResult?.additionalData?.push;
				if (!push) return;
				const key = checkResult?.id ?? checkResult?.check?.id;
				const seen = (globalThis._rdbInvokedChecks ??= new Set());
				if (key && seen.has(key)) return; // one bond per Check
				const speaker = globalThis.ChatMessage?.getSpeaker?.() ?? {};
				const actor = globalThis.game?.actors?.get?.(speaker.actor);
				const bondName = pushBondName(push); // FU 4.16.2: additionalData.push.with
				if (actor && bondName) {
					onBondInvoked(actor, bondName, { invokedThisCheck: [] });
					if (key) seen.add(key);
				}
			} catch (err) {
				console.warn(`${MODULE_ID} | invoke clock-fill failed`, err);
			}
		});
	});
}
