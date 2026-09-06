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
 *  - Context verb by axis state (Austin ruled 5 Sep 2026: "positive and negative bonds work the
 *    same", "Remove reconcile"): positive OR hostile poles → Deepen · neutral or mixed → Invoke.
 *    Invoke wires to the shipped invoke arm; Deepen wires to the shipped GM clock-advance.
 *  - Focus-hop: RULED (Austin, 5 Sep 2026: "Yes.") — any viewer, player or GM, may re-center the
 *    board on a bond's matched actor. Navigation only, never a permission change: the hopped-to
 *    board is built under the SAME visibility rules (sealed cards stay sealed to non-GMs, canSeal
 *    recomputes from the hopped-to actor's ownership).
 *  - Name→actor portrait resolution: bonds are free-text names; exact case-insensitive actor-name
 *    match gets the portrait, anything else shows the studio imprint alone. The imprint itself is
 *    RULED (Austin, 5 Sep 2026: "Works.") — "Bellamy & Sons · Whitechapel" stays permanently.
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

/**
 * Context verb by axis state. Austin ruled (5 Sep 2026): "positive and negative bonds work the
 * same" and "Remove reconcile" — hostile poles Deepen exactly as positive ones do, and mixed
 * poles keep Invoke (ruled, no longer owed).
 */
export function boardVerb(bond) {
	let pos = 0, neg = 0;
	for (const a of EB_AXES) { const v = axisValue(bond, a[0]); if (v === 1) pos++; else if (v === -1) neg++; }
	if (pos > 0 && neg === 0) return { verb: 'deepen', label: 'Deepen', why: 'positive poles hold it', enabled: true, owed: null };
	if (neg > 0 && pos === 0) return { verb: 'deepen', label: 'Deepen', why: 'hostile poles hold it', enabled: true, owed: null };
	if (pos === 0 && neg === 0) return { verb: 'invoke', label: 'Invoke', why: 'no pole set — neutral', enabled: true, owed: null };
	return { verb: 'invoke', label: 'Invoke', why: 'mixed poles', enabled: true, owed: null };
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
 * index-aligned); `actors` = candidates for portrait match; isGM gates the sealed treatment.
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
			// focus-hop target: only an unsealed plate with a resolved actor can be hopped to
			hopTarget: !sealed && match ? match.id : null,
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
		canAct: isGM || isOwner, // verbs run only for GM/owner — a hop is navigation, never new agency
		hopAllowed: true, // Austin ruled (5 Sep 2026): players may focus-hop — navigation, not permission
	};
}

/** Up/Down cycle over selectable plates (Esc handled by the app). */
export function cycleSelection(selectable, current, dir) {
	if (!selectable?.length) return null;
	const idx = selectable.indexOf(current);
	if (idx === -1) return dir > 0 ? selectable[0] : selectable[selectable.length - 1];
	return selectable[(idx + dir + selectable.length) % selectable.length];
}

// ── pure: party web ───────────────────────────────────────────────────────────

/** Sorted edge key for undirected identity — edgeKey('a','b') === edgeKey('b','a'). */
export function edgeKey(a, b) {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Deterministic party-web layout. Character actors go on a circle; leaves fan outward from their
 * connecting actor. Single actor: placed at center. Returns a Map<id, {x, y}>.
 * @param {string[]} actorIds  character actor ids, in stable iteration order
 * @param {{ leafId: string, actorId: string }[]} leafEdgeHints  which actor a leaf hangs off
 * @param {{ w?: number, h?: number }} [opts]
 */
export function partyWebLayout(actorIds, leafEdgeHints, { w = 1200, h = 760 } = {}) {
	const positions = new Map();
	const cx = w / 2, cy = h / 2;
	const n = actorIds.length;
	const r = n <= 1 ? 0 : Math.min(w, h) * 0.28;
	actorIds.forEach((id, i) => {
		const angle = n <= 1 ? 0 : -Math.PI / 2 + (i * 2 * Math.PI) / n;
		positions.set(id, { x: Math.round(cx + r * Math.cos(angle)), y: Math.round(cy + r * Math.sin(angle)) });
	});
	// Group leaves by connecting actor
	const leafByActor = new Map();
	for (const { leafId, actorId } of leafEdgeHints) {
		if (!leafByActor.has(actorId)) leafByActor.set(actorId, []);
		const arr = leafByActor.get(actorId);
		if (!arr.includes(leafId)) arr.push(leafId);
	}
	// Fan each actor's leaves outward from the board center
	for (const [actorId, leaves] of leafByActor) {
		const aPos = positions.get(actorId) ?? { x: cx, y: cy };
		const baseAngle = Math.atan2(aPos.y - cy, aPos.x - cx);
		const leafR = 130;
		const spread = leaves.length > 1 ? Math.PI / 3 : 0;
		leaves.forEach((leafId, li) => {
			if (positions.has(leafId)) return; // multi-actor leaf: first placement wins
			const offset = leaves.length > 1 ? (li - (leaves.length - 1) / 2) * (spread / (leaves.length - 1)) : 0;
			const angle = baseAngle + offset;
			positions.set(leafId, { x: Math.round(aPos.x + leafR * Math.cos(angle)), y: Math.round(aPos.y + leafR * Math.sin(angle)) });
		});
	}
	return positions;
}

/**
 * Build the party-web view-model from pre-fetched actor data (pure — no Foundry globals).
 *
 * @param {{ actor: {id,uuid,name,img}, bonds: object[], records: object[], isOwner: boolean }[]} actorEntries
 * @param {{ isGM?: boolean, resolveUuid?: (uuid: string) => {id: string}|null, w?: number, h?: number }} [opts]
 * @returns {{ actorNodes: object[], leafNodes: object[], edges: object[], w: number, h: number }}
 */
export function buildPartyWebVM(actorEntries, { isGM = false, resolveUuid = null, w = 1200, h = 760 } = {}) {
	// Registry of character actors in this web
	const actorById = new Map();
	for (const { actor } of actorEntries) actorById.set(actor.id, actor);
	const actorList = [...actorById.values()];

	// Enumerate bonds → directed edges; union of A→B + B→A → one undirected edge
	const edgeData = new Map(); // edgeKey → { fromId, toId, bonds: [...] }
	const leafNodes = new Map(); // leafId → { id, name }
	const leafEdgeHints = []; // { leafId, actorId }

	for (const { actor, bonds, records, isOwner } of actorEntries) {
		bonds.forEach((bond, i) => {
			const rec = records?.[i] ?? {};
			if (rec.secret && !isGM && !isOwner) return; // permission: secret hidden from non-GM non-owner

			// Resolve target: stored UUID first, then name-match fallback
			let targetActor = null;
			if (rec.targetUuid && resolveUuid) {
				const resolved = resolveUuid(rec.targetUuid);
				if (resolved && actorById.has(resolved.id)) targetActor = actorById.get(resolved.id);
			}
			if (!targetActor) {
				const matched = matchActorByName(bond.name, actorList);
				if (matched && actorById.has(matched.id)) targetActor = matched;
			}

			const strength = deeperStrength(bond);
			const bondEntry = { fuBond: bond, rec, strength };

			if (targetActor && targetActor.id !== actor.id) {
				// Actor → actor edge
				const key = edgeKey(actor.id, targetActor.id);
				if (!edgeData.has(key)) edgeData.set(key, { fromId: actor.id, toId: targetActor.id, bonds: [] });
				edgeData.get(key).bonds.push(bondEntry);
			} else {
				// Leaf node (free-text name, no matching actor)
				const leafId = 'leaf:' + String(bond.name ?? '').trim().toLowerCase();
				if (!leafNodes.has(leafId)) leafNodes.set(leafId, { id: leafId, name: bond.name });
				const key = edgeKey(actor.id, leafId);
				if (!edgeData.has(key)) {
					edgeData.set(key, { fromId: actor.id, toId: leafId, bonds: [] });
					leafEdgeHints.push({ leafId, actorId: actor.id });
				}
				edgeData.get(key).bonds.push(bondEntry);
			}
		});
	}

	// Layout
	const actorIds = [...actorById.keys()];
	const positions = partyWebLayout(actorIds, leafEdgeHints, { w, h });

	// Actor nodes
	const actorNodes = actorIds.map((id) => {
		const a = actorById.get(id);
		const pos = positions.get(id) ?? { x: Math.round(w / 2), y: Math.round(h / 2) };
		return { id, kind: 'actor', name: a.name, img: a.img ?? null, ...pos };
	});

	// Leaf nodes
	const leafNodeList = [...leafNodes.values()].map((l) => {
		const pos = positions.get(l.id) ?? { x: 0, y: 0 };
		return { id: l.id, kind: 'leaf', name: l.name, ...pos };
	});

	// SVG edges — take geometry from the strongest bond on each edge
	const edges = [];
	for (const [, edge] of edgeData) {
		const fromPos = positions.get(edge.fromId) ?? { x: Math.round(w / 2), y: Math.round(h / 2) };
		const toPos = positions.get(edge.toId) ?? { x: Math.round(w / 2), y: Math.round(h / 2) };
		const strongest = edge.bonds.reduce((best, b) => (b.strength > best.strength ? b : best));
		const geo = stringGeometry(fromPos, toPos, strongest.fuBond);
		const allSealed = edge.bonds.every((b) => !!b.rec.secret);
		const anyEternal = edge.bonds.some((b) => (b.rec.tier ?? '') === TIER.ETERNAL);
		edges.push({ path: geo.path, width: geo.width, widthOuter: geo.widthOuter, glyphs: allSealed ? [] : geo.glyphs, sealed: allSealed, eternal: anyEternal });
	}

	return { actorNodes, leafNodes: leafNodeList, edges, w, h };
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
			window: { title: 'Connections', resizable: true },
			position: { width: 1240, height: 860 },
		};
		static PARTS = { board: { template: `modules/${MODULE_ID}/templates/evidence-board.hbs` } };
		_selected = null;
		_focus = actor; // focus-hop re-centers here (Austin ruled: players may hop — navigation only)
		async _prepareContext() {
			const focus = this._focus;
			const bonds = focus.system?.bonds ?? [];
			const records = getRecords(focus);
			const actors = globalThis.game?.actors?.filter?.((a) => a.type === 'character') ?? [];
			return { vm: buildBoardVM(focus, bonds, records, actors, { isGM: !!globalThis.game?.user?.isGM, isOwner: !!focus.isOwner, selectedIndex: this._selected }) };
		}
		_onRender() {
			const root = this.element;
			root.querySelectorAll('[data-plate]').forEach((el) => {
				el.addEventListener('click', () => {
					const i = Number(el.dataset.plate);
					if (el.dataset.selectable === 'true') { this._selected = i; this.render(); }
				});
			});
			root.querySelector('.rdb-web-btn')?.addEventListener('click', () => openPartyWeb());
			root.querySelector('[data-verb-btn]')?.addEventListener('click', () => this.#runVerb());
			// focus-hop (Austin ruled: any viewer): re-center on the selected bond's matched actor
			root.querySelector('[data-hop]')?.addEventListener('click', () => {
				const id = root.querySelector('[data-hop]')?.dataset.hop;
				const target = globalThis.game?.actors?.get?.(id);
				if (!target) return;
				this._focus = target;
				this._selected = null;
				this.render();
			});
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
				const focus = this._focus;
				const records = getRecords(focus);
				if (!records[i]) return;
				records[i] = { ...records[i], [SECRET_FLAG_KEY]: !records[i][SECRET_FLAG_KEY] };
				await focus.setFlag(MODULE_ID, 'bonds', records);
				this.render();
			});
		}
		#keys = null;
		async close(opts) { if (this.#keys) globalThis.removeEventListener('keydown', this.#keys); return super.close(opts); }
		async #runVerb() {
			const i = this._selected; if (i == null) return;
			const focus = this._focus;
			if (!(globalThis.game?.user?.isGM || focus.isOwner)) return; // hop grants sight, never agency
			const bond = (focus.system?.bonds ?? [])[i]; if (!bond) return;
			const v = boardVerb(bond);
			const modApi = globalThis.game?.modules?.get?.(MODULE_ID)?.api;
			// Only shipped arms — invoke and the GM clock-advance; nothing invented.
			if (v.verb === 'invoke') await modApi?.onBondInvoked?.(focus, bond.name, {});
			else if (v.verb === 'deepen' && globalThis.game?.user?.isGM) await modApi?.fillClock?.(focus, bond.name, 1);
			this.render();
		}
	}
	const app = new EvidenceBoardApp();
	app.render(true);
	return app;
}

/**
 * Open the Party Web window — a multi-actor graph of all world character bonds. Read-only;
 * live-syncs on updateActor. Opens from the Connections board's chrome button.
 */
export function openPartyWeb() {
	const api = RT()?.api;
	if (!api?.ApplicationV2) return null;
	const Base = api.HandlebarsApplicationMixin(api.ApplicationV2);
	class PartyWebApp extends Base {
		static DEFAULT_OPTIONS = {
			id: 'rdb-party-web', classes: ['rdb-board-app'],
			window: { title: 'Party Web', resizable: true },
			position: { width: 1240, height: 860 },
		};
		static PARTS = { board: { template: `modules/${MODULE_ID}/templates/party-web.hbs` } };
		_updateHook = null;
		async _prepareContext() {
			const isGM = !!globalThis.game?.user?.isGM;
			const chars = globalThis.game?.actors?.filter?.((a) => a.type === 'character') ?? [];
			const actorEntries = chars.map((actor) => ({
				actor: { id: actor.id, uuid: actor.uuid, name: actor.name, img: actor.img ?? null },
				bonds: Array.isArray(actor.system?.bonds) ? actor.system.bonds : [],
				records: getRecords(actor),
				isOwner: !!actor.isOwner,
			}));
			const vm = buildPartyWebVM(actorEntries, {
				isGM,
				resolveUuid: (uuid) => globalThis.fromUuidSync?.(uuid) ?? null,
			});
			return { vm };
		}
		_onRender() {
			// Live-sync: re-render on any actor update (bonds are actor data)
			this._updateHook = globalThis.Hooks?.on?.('updateActor', () => this.render());
		}
		async close(opts) {
			if (this._updateHook != null) globalThis.Hooks?.off?.('updateActor', this._updateHook);
			return super.close(opts);
		}
	}
	// Reuse existing instance if open
	const existing = globalThis.ui?.windows?.[PartyWebApp.DEFAULT_OPTIONS.id] ?? Object.values(globalThis.ui?.windows ?? {}).find((w) => w.constructor?.name === 'PartyWebApp');
	if (existing?.rendered) { existing.bringToTop?.(); return existing; }
	const app = new PartyWebApp();
	app.render(true);
	return app;
}

// hooks: sheet-panel header button + api surface (runtime only)
if (globalThis.Hooks?.on) {
	Hooks.once('ready', () => {
		const mod = globalThis.game?.modules?.get?.(MODULE_ID);
		if (mod?.api) { mod.api.openEvidenceBoard = openEvidenceBoard; mod.api.openPartyWeb = openPartyWeb; }
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
			btn.textContent = globalThis.game?.i18n?.localize?.('RDB.Board.Open') ?? 'Connections';
			btn.addEventListener('click', () => openEvidenceBoard(actor));
			host.prepend(btn);
		} catch (err) { console.warn('[rippers-deeper-bonds] board button injection failed:', err); }
	});
}
