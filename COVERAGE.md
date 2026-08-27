# rippers-deeper-bonds — coverage, owed items & Austin's verify checklist

**Status: v0.1.2 — Phase 1 + sheet tier-CRUD buttons, fixed to render on FU's live sheet. 18/18 tests green. Published.**
Deeper Bonds (Aaron Jolliffe playtest) for Project FU v13. Extends FU bonds; does NOT fork projectfu.

## What P1 ships

- **Pure core** (headless, `node --test`): emotions/strength (`deeperStrength` = emotions + `bonus`,
  mirroring FU's getter); clocks (`advanceClock`, `resolveFullClock`, `fillBondClock`); tiers & caps
  (`solidBondCount`, `canAddSolid`); `reconcileRecords` (rename-safe); `canInvokeOnCheck` (one/Check).
- **EXTEND model** (verified 4.16.2): bonds stay in `actor.system.bonds`; our tier+clock live in
  `flags.rippers-deeper-bonds.bonds` keyed by bond **name** (+ index tiebreak), reconciled on rename.
  Clock-earned strength is written into the bond's **`bonus`** field → FU's `strength` getter and
  `maximumBondStrength` return the Deeper strength unchanged, so **Penny Knight keeps working**.
- **Full-clock resolution** (ruling): erase → if emotions < 3 add an emotion (player picks the axis),
  else +1 to `bonus`; either way **strength +1**.
- **Tiered caps**: fleeting **unlimited**; solid cap **6** (P1, manual override; 6→8 detection is P3);
  eternal **off the count**. FU's own `optionBondMaxLength` setting is raised to 99 at ready so it never
  caps total bonds.
- **CRUD** (GM-authoritative): `createFleetingBond`, `solidifyBond` (cap-checked), `promoteEternal`,
  `fillClock`.
- **Invoke = FU check-push** (ruling: invoke costs a Fabula Point): FU's push already spends the FP and
  adds the bond's strength to the roll just made. We hook `CheckHooks.renderCheck` to fill the invoked
  bond's clock and enforce **one bond per Check**; the free exception (a fleeting bond FORMED mid-Check
  by an FP invokes free on that Check) is not double-charged — FU owns the FP.
- **Sheet display**: a `renderActorSheet` hook adds a tier gradient + a 4-section clock (click to fill, GM)
  onto each bond row, plus (v0.1.1) GM tier-CRUD controls: a per-row tier tag, **Solidify** (cap-checked,
  disabled with a tooltip at the six-cap), **→ Eternal**, and a section-level **+ New fleeting bond**. UI
  over the existing API — no new mechanics; name/emotions stay on FU's native bond editing. Injection is
  wired to `renderFUStandardActorSheet` (the hook FU's ApplicationV2 sheet actually fires; `renderActorSheet`
  did not, so v0.1.0/0.1.1 rendered nothing on the live sheet — fixed v0.1.2) against the real 4.16.2
  bonds fieldset (`legend.bond-add`; rows = child `div.flexrow`, indexed by the delete button's
  `data-bond-index`).

## ⚠ Owed / risks (carried per god)

1. **Bond identity (no stable id).** BondDataModel has no id; records key by name + index tiebreak.
   Same-slot delete+add is indistinguishable from a rename, so it carries tier/clock (documented in the
   test). A dedicated stable-id migration is future work.
2. **`optionBondMaxLength` raised to 99** — confirm this doesn't disturb Austin's other bond expectations.
3. **Status = solid count.** FU's `expressions.mjs` `countBonds` = `bonds.length` (ALL tiers). The corpus
   says Status reads **solid** bonds only. A FU expression can't be cleanly overridden, so any
   Status-from-bond-count auto-calc over-counts fleeting until addressed (P3 / a ruling).
4. **FU `matches()` bug (4.16.2).** `BondDataModel.matches()` tests `this.admInf` for ALL emotions, so
   Loyalty/Affection emotion-matching in bond-rule-predicates is broken FU-side. Not ours — flag if an
   adopted class predicates on Loyalty/Affection.
5. **6→8 cap (ruling 2)** needs detecting *Power of Friendship* + *Empathetic* (class skills) — P3.
6. **check-push data shape** — the exact field carrying the invoked bond's name in `additionalData.push`
   is read defensively and must be **verified at install** (same internal-coupling posture as
   rippers-conditions; confirm on Austin's 4.16.2).

## Table-adjudicated (NOT automated — UI hooks only)

Interlude scenes; the solidify CHOICES at rest; the eternal skill-grant PICK + transferability test;
Sever interactions; the half-Miasma-interlude (⚠ unruled — deliberately not implemented).

## Not in P1 (P2/P3)

- **P2**: strength-ladder EFFECTS — str2 cleanse (DEPEND on rippers-conditions' status API), str2
  cover-regen (strength×5 MP, one bond/trigger), str3 attribute-die-up for the scene, str4 skill-grant
  slot; the 5 clock-fill triggers; solidify-at-rest UI.
- **P3**: class integration (Penny Knight strength reads, Naturalist fleeting Quarry bonds, Witness
  Hound bond, Sin-Eater/Cardinal emotion-cost); 6→8 cap detection; Status=solid reconciliation.

## Austin — in-Foundry verify checklist (P1)

1. **Strength through bonus.** On a solid bond, fill its clock to full at 3 emotions → confirm the bond's
   `bonus` bumps +1 and the sheet **strength** shows +1 (and Penny Knight's Shield/Bastion/Source read it).
   At <3 emotions, confirm the full clock prompts you to add an emotion (strength +1 that way).
2. **Caps.** Six solid bonds → a 7th solidify is refused; fleeting bonds beyond that still form (unlimited);
   an eternal bond does not count against the six.
3. **Clocks on the sheet.** Solid bonds show a 4-section clock + tier gradient; clicking a section fills it;
   a full clock resolves (erase → emotion/bonus → strength +1).
4. **Invoke.** Push a check with a bond (FU's Fabula-Point push) → confirm +strength lands on the roll
   just made, the bond's clock fills one section, and a SECOND bond can't be invoked on the same Check.
   A fleeting bond formed mid-Check by an FP invokes free (not double-charged).
5. Report the `additionalData.push` bond-name field shape if the clock-fill-on-invoke doesn't trigger
   (owed item #6).
