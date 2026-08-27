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

function mkButton(label, title, { disabled = false, onClick } = {}) {
	const b = document.createElement('button');
	b.type = 'button';
	b.className = 'rdb-btn';
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
			if (!rec || row.querySelector?.('.rdb-controls')) return; // idempotent per row
			row.classList?.add?.(TIER_CLASS[rec.tier] ?? '');

			const controls = document.createElement('span');
			controls.className = 'rdb-controls';

			// tier indicator (always visible)
			const tag = document.createElement('span');
			tag.className = `rdb-tier-tag ${TIER_CLASS[rec.tier] ?? ''}`;
			tag.textContent = TIER_LABEL[rec.tier] ?? rec.tier;
			controls.appendChild(tag);

			// clock for solid bonds (click to fill, GM)
			if (rec.tier === TIER.SOLID) {
				const clock = document.createElement('span');
				clock.className = 'rdb-clock';
				clock.title = `Bond clock ${rec.clock}/${CLOCK_SECTIONS}${isGM ? ' — click to fill' : ''}`;
				clock.textContent = '●'.repeat(rec.clock) + '○'.repeat(CLOCK_SECTIONS - rec.clock);
				if (isGM) {
					clock.style.cursor = 'pointer';
					clock.addEventListener('click', () => fillClock(actor, rec.name, 1));
				}
				controls.appendChild(clock);
			}

			// GM tier-CRUD buttons
			if (isGM) {
				const sol = solidifyButtonState(rec, records);
				if (sol.show) {
					controls.appendChild(
						mkButton('Solidify', sol.disabled ? sol.reason : 'Make this bond solid (adds a Bond Clock)', {
							disabled: sol.disabled,
							onClick: () => solidifyBond(actor, rec.name),
						}),
					);
				}
				if (rec.tier === TIER.SOLID) {
					controls.appendChild(mkButton('→ Eternal', 'Promote to an eternal bond (off the six-cap, side-quest gated)', { onClick: () => promoteEternal(actor, rec.name) }));
				}
			}

			row.appendChild?.(controls);
		});

		// section-level "new fleeting bond" control (GM), appended once inside the bonds fieldset
		if (isGM && !fieldset.querySelector?.('.rdb-new-bond')) {
			const add = mkButton('+ New fleeting bond', 'Create a new fleeting bond (edit name + emotions in the normal bond fields)', {
				onClick: () => createFleetingBond(actor, { name: 'New Bond' }),
			});
			add.classList.add('rdb-new-bond');
			fieldset.appendChild(add);
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
	};
}

/* -------- boot (guarded: inert under `node --test`) -------- */

if (globalThis.Hooks?.once) {
	globalThis.Hooks.once('ready', () => {
		const mod = globalThis.game?.modules?.get?.(MODULE_ID);
		if (mod) mod.api = getModuleApi();
		if (isActiveGM()) relaxFuBondCap();
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
