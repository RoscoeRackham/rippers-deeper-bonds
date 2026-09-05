/**
 * THE EVIDENCE BOARD — a map view of one character's bonds (Austin: "Love it!", built per the
 * design-of-record hive/designed-cards/bond-map/ — cabinet-card revision, 2a Slash register).
 *
 * Semantics (all ruled, nothing invented here):
 *  - Strings: weight = bond strength (2px/point), violet = eternal, dashed = sealed; suit glyphs
 *    ride the string (♦ Adm/Inf · ♣ Loy/Mis · ♥ Aff/Hat), gold = positive pole, red inverted = negative.
 *  - Plates: 1890s cabinet cards; pin color = tier (violet eternal / gold solid / plain fleeting).
 *  - SECRET bond (additive flag, owner/GM-set): non-GM sees the card FACE-DOWN with the wax seal
 *    ("the GM holds it") and cannot select it — the semantics trackers.designed.html already
 *    implements (god, BUILD-EVIDENCE-BOARD-GO: design-of-record precedent, not invention).
 *  - Context verb by axis state: positive → Deepen · hostile → Reconcile · neutral → Invoke;
 *    mixed poles is UNRULED → Invoke + owed chip. Invoke wires to the shipped invoke arm; Deepen
 *    wires to the shipped GM clock-advance; RECONCILE HAS NO MECHANIC YET → disabled + ⚠ owed.
 *  - Focus-hop (selected bond's own strings, one hop out, dimmed): the PERMISSION rule is unruled —
 *    the hop renders for the GM only (who already reads every sheet; no new information) and the
 *    ⚠ owed chip is shown for the player rule. Never a guess.
 *  - Name→actor portrait resolution: bonds are free-text names; exact case-insensitive actor-name
 *    match gets the portrait, anything else gets the studio-imprint placeholder (display-only).
 *
 * PURE core first (layout, VM, verb, axis math — headless-testable); the ApplicationV2 window and
 * hooks only wire up when Foundry globals exist, so a bare `node --test` import is inert.
 */
import { TIER, emotionCount, deeperStrength, getRecords, MODULE_ID, CLOCK_SECTIONS } from './rippers-deeper-bonds.mjs';

export const SECRET_FLAG_KEY = 'secret'; // additive per-bond field on the deeper record

// ── pure: axes ────────────────────────────────────────────────────────────────
/** [key, negative pole, positive pole, suit glyph] — FU BondDataModel pole-name strings. */
export const EB_AXES = [
	['admInf', 'Inferiority', 'Admiration', '♦'],
	['loyMis', 'Mistrust', 'Loyalty', '♣'],
	['affHat', 'Hatred', 'Affection', '♥'],
];
/** +1 positive pole, -1 negative pole, 0 unset — from FU's pole-name string. */
export function axisValue(bond, key) {
	const v = String(bond?.[key] ?? '').toLowerCase();
	if (!v) return 0;
	const ax = EB_AXES.find((a) => a[0] === key);
	return v === ax[2].toLowerCase() ? 1 : v === ax[1].toLowerCase() ? -1 : 0;
}

/** Context verb by axis state (design-of-record rule; mixed is unruled → Invoke + owed). */
export function boardVerb(bond) {
	let pos = 0, neg = 0;
	for (const a of EB_AXES) { const v = axisValue(bond, a[0]); if (v === 1) pos++; else if (v === -1) neg++; }
	if (pos > 0 && neg === 0) return { verb: 'deepen', label: 'Deepen', why: 'positive poles hold it', enabled: true, owed: null };
	if (neg > 0 && pos === 0) return { verb: 'reconcile', label: 'Reconcile', why: 'hostile poles hold it', enabled: false, owed: 'reconcile mechanics unruled' };
	if (pos === 0 && neg === 0) return { verb: 'invoke', label: 'Invoke', why: 'no pole set — neutral', enabled: true, owed: null };
	return { verb: 'invoke', label: 'Invoke', why: 'mixed poles', enabled: true, owed: 'mixed-axis verb unruled' };
}

// ── pure: layout ──────────────────────────────────────────────────────────────
/** Deterministic board layout: owner centered, bonds on an ellipse, alternating rotation jitter. */
export function boardLayout(count, { w = 1200, h = 760 } = {}) {
	const cx = w / 2, cy = h / 2 + 10;
	const rx = w * 0.34, ry = h * 0.33;
	const spots = [];
	for (let i = 0; i < count; i++) {
		const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / Math.max(1, count) + (count > 1 ? Math.PI / count : 0);
		spots.push({
			x: Math.round(cx + rx * Math.cos(angle)),
			y: Math.round(cy + ry * Math.sin(angle)),
			rot: [-2, 1.5, -1, 2, -1.5, 1][i % 6],
		});
	}
	return { owner: { x: cx, y: cy }, spots, w, h };
}

/** Quadratic string path with sag + the suit-glyph positions along it (mirrors the mock's math). */
export function stringGeometry(from, to, bond) {
	const s = Math.max(1, deeperStrength(bond));
	const w = Math.max(2, s * 2);
	const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
	const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const sag = 18 + len * 0.04;
	const path = `M ${from.x} ${from.y} Q ${mx} ${my + sag} ${to.x} ${to.y}`;
	const glyphs = [];
	EB_AXES.forEach((a, i) => {
		const v = axisValue(bond, a[0]);
		if (v === 0) return;
		const t = 0.32 + i * 0.18;
		const px = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * mx + t * t * to.x;
		const py = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * (my + sag) + t * t * to.y;
		glyphs.push({ x: Math.round(px), y: Math.round(py), yText: Math.round(py) + 4, glyph: a[3], positive: v === 1 });
	});
	return { path, width: w, widthOuter: w + 2, glyphs };
}

// ── pure: view-model ──────────────────────────────────────────────────────────
/** Case-insensitive exact actor-name match (display heuristic, approved). Null → placeholder card. */
export function matchActorByName(name, actors) {
	const n = String(name ?? '').trim().toLowerCase();
	if (!n) return null;
	return (actors ?? []).find((a) => String(a?.name ?? '').trim().toLowerCase() === n) ?? null;
}

/**
 * The board VM. `bonds` = actor.system.bonds; `records` = the deeper flag records (tier/clock/secret,
 * index-aligned); `actors` = candidates for portrait match; isGM gates the sealed treatment + hop.
 */
export function buildBoardVM(owner, bonds, records, actors, { isGM = false, isOwner = false, selectedIndex = null } = {}) {
	const layout = boardLayout(bonds.length);
	const plates = bonds.map((b, i) => {
		const rec = records?.[i] ?? {};
		const secret = !!rec[SECRET_FLAG_KEY];
		const sealed = secret && !isGM;
		const match = matchActorByName(b?.name, actors);
		const spot = layout.spots[i];
		const verb = boardVerb(b);
		return {
			index: i, name: String(b?.name ?? ''), tier: rec.tier ?? TIER.FLEETING,
			secret, sealed, selectable: !sealed,
			img: match?.img ?? null, matched: !!match, matchedActorId: match?.id ?? null,
			x: spot.x, y: spot.y, rot: spot.rot,
			strength: deeperStrength(b), emotions: emotionCount(b),
			clock: Number(rec.clock) || 0, clockMax: CLOCK_SECTIONS,
			axes: EB_AXES.map((a) => { const v = axisValue(b, a[0]); return { key: a[0], neg: a[1], pos: a[2], glyph: a[3], value: v, isPos: v === 1, isNeg: v === -1 }; }),
			verb, selected: selectedIndex === i,
			string: stringGeometry(layout.owner, spot, b),
			stringSealed: sealed, stringEternal: (rec.tier ?? '') === TIER.ETERNAL,
		};
	});
	const selectable = plates.filter((p) => p.selectable).map((p) => p.index);
	return {
		owner: { name: owner?.name ?? '', img: owner?.img ?? null, x: layout.owner.x, y: layout.owner.y },
		w: layout.w, h: layout.h, plates, selectable, isGM,
		selected: plates.find((p) => p.selected) ?? null,
		canSeal: isGM || isOwner, // the wax seal is owner/GM-set (trackers.designed.html precedent)
		hopAllowed: isGM, // permission rule ⚠ owed — GM-only until Austin rules (no new info for a GM)
	};
}

/** Up/Down cycle over selectable plates (Esc handled by the app). */
export function cycleSelection(selectable, current, dir) {
	if (!selectable?.length) return null;
	const idx = selectable.indexOf(current);
	if (idx === -1) return dir > 0 ? selectable[0] : selectable[selectable.length - 1];
	return selectable[(idx + dir + selectable.length) % selectable.length];
}

// ── runtime: the ApplicationV2 window + wiring (inert headless) ───────────────
const RT = () => globalThis.foundry?.applications;
export function openEvidenceBoard(actor) {
	const api = RT()?.api;
	if (!api?.ApplicationV2 || !actor) return null;
	const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);
	class EvidenceBoardApp extends Base {
		static DEFAULT_OPTIONS = {
			id: 'rdb-evidence-board', classes: ['rdb-board-app'],
			window: { title: 'The Evidence Board', resizable: true },
			position: { width: 1240, height: 860 },
		};
		static PARTS = { board: { template: `modules/${MODULE_ID}/templates/evidence-board.hbs` } };
		_selected = null;
		async _prepareContext() {
			const bonds = actor.system?.bonds ?? [];
			const records = getRecords(actor);
			const actors = globalThis.game?.actors?.filter?.((a) => a.type === 'character') ?? [];
			return { vm: buildBoardVM(actor, bonds, records, actors, { isGM: !!globalThis.game?.user?.isGM, isOwner: !!actor.isOwner, selectedIndex: this._selected }) };
		}
		_onRender() {
			const root = this.element;
			root.querySelectorAll('[data-plate]').forEach((el) => {
				el.addEventListener('click', () => {
					const i = Number(el.dataset.plate);
					if (el.dataset.selectable === 'true') { this._selected = i; this.render(); }
				});
			});
			root.querySelector('[data-verb-btn]')?.addEventListener('click', () => this.#runVerb());
			this.#keys = (ev) => {
				if (ev.key === 'Escape') { this._selected = null; this.render(); }
				if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
					ev.preventDefault();
					const vmSel = [...root.querySelectorAll('[data-plate][data-selectable="true"]')].map((e) => Number(e.dataset.plate));
					this._selected = cycleSelection(vmSel, this._selected, ev.key === 'ArrowDown' ? 1 : -1);
					this.render();
				}
				if (ev.key === 'Enter' && this._selected != null) this.#runVerb();
			};
			globalThis.addEventListener('keydown', this.#keys);
			// GM/owner: wax-seal toggle on the selected plate
			root.querySelector('[data-seal-toggle]')?.addEventListener('click', async () => {
				const i = this._selected; if (i == null) return;
				const records = getRecords(actor);
				if (!records[i]) return;
				records[i] = { ...records[i], [SECRET_FLAG_KEY]: !records[i][SECRET_FLAG_KEY] };
				await actor.setFlag(MODULE_ID, 'bonds', records);
				this.render();
			});
		}
		#keys = null;
		async close(opts) { if (this.#keys) globalThis.removeEventListener('keydown', this.#keys); return super.close(opts); }
		async #runVerb() {
			const i = this._selected; if (i == null) return;
			const bond = (actor.system?.bonds ?? [])[i]; if (!bond) return;
			const v = boardVerb(bond);
			const modApi = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
			// Only shipped arms — reconcile stays disabled (⚠ owed), nothing invented.
			if (v.verb === 'invoke') await modApi?.onBondInvoked?.(actor, bond.name, {});
			else if (v.verb === 'deepen' && globalThis.game?.user?.isGM) await modApi?.fillClock?.(actor, bond.name, 1);
			this.render();
		}
	}
	const app = new EvidenceBoardApp();
	app.render(true);
	return app;
}

// hooks: sheet-panel header button + api surface (runtime only)
if (globalThis.Hooks?.on) {
	Hooks.once('ready', () => {
		const mod = globalThis.game?.modules?.get?.(MODULE_ID);
		if (mod?.api) mod.api.openEvidenceBoard = openEvidenceBoard;
	});
	Hooks.on('renderFUStandardActorSheet', (app) => {
		try {
			const actor = app?.actor ?? app?.document;
			if (!actor || !Array.isArray(actor.system?.bonds)) return;
			const el = app?.element; const root = el?.jquery ? el[0] : el;
			const bar = root?.querySelector?.('.rdb-bar');
			const host = bar?.parentElement;
			if (!host || host.querySelector('.rdb-board-open')) return;
			const btn = document.createElement('button');
			btn.type = 'button'; btn.className = 'rdb-board-open';
			btn.textContent = globalThis.game?.i18n?.localize?.('RDB.Board.Open') ?? 'The Evidence Board';
			btn.addEventListener('click', () => openEvidenceBoard(actor));
			host.prepend(btn);
		} catch (err) { console.warn('[rippers-deeper-bonds] board button injection failed:', err); }
	});
}
