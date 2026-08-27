# Rippers — Deeper Bonds

A Foundry VTT v13 module for [Project FU](https://github.com/League-of-Fabulous-Developers/FoundryVTT-Fabula-Ultima)
that implements the **Rippers Unmasked** campaign's Deeper Bonds system (Aaron Jolliffe playtest, ©2026
Aaron Jolliffe). It **extends** FU's bonds (no fork).

- **Tiers** — fleeting (unlimited, one emotion, invoke +1), solid (cap 6, carries a 4-section Bond
  Clock), eternal (str-4, side-quest gated, off the cap, unseverable).
- **Bond Clocks** on solid bonds — fill by opportunity / interlude / invoking / an NPC's first
  appearance / a Villain's Fabula-Point appearances. Full clock → erase, add an emotion, **strength +1**.
- **Strength ladder** — invoke bonus = strength; str2 cleanse + cover-regen, str3 attribute-die-up,
  str4 eternal skill-grant (ladder EFFECTS are Phase 2).
- **Invoke** = +strength retroactive to the roll just made, one bond per Check — via FU's own
  check-push (spends the Fabula Point, adds the bond's strength).

Bonds stay in `actor.system.bonds`; tier/clock live in a module flag; clock-earned strength is written
into each bond's `bonus` field, so FU's `strength` getter, party chart, and Penny Knight keep working.

## Install

Foundry → Add-on Modules → Install Module → Manifest URL:

```
https://github.com/RoscoeRackham/rippers-deeper-bonds/releases/latest/download/module.json
```

## Status

v0.1.0 = Phase 1 (data model + clocks + tiered caps + invoke wiring + sheet display), for in-Foundry
verification. Phase 2 (ladder effects) and Phase 3 (class integration) follow. See `COVERAGE.md`.

## Tests

`npm test` (`node --test`) — the pure clock/ladder/cap/reconcile logic runs headless, no Foundry.

## Licensing

Module code: MIT (`LICENSE`). Third-party notices: `THIRD-PARTY-NOTICES.md`.
