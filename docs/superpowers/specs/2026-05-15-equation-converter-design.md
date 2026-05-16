# Equation Converter — Design Spec

**Date:** 2026-05-15
**Project:** `C:\Projects\3dvitreous-grapher` (`3dvit.html`) — browser-based 3D graphing calculator
**Branch:** `fix/equation-input-robustness` (builds on the equation-engine fix already committed there)
**Status:** Approved (verbal), ready for implementation plan

## Problem

Users paste/type equations in everyday or textbook notation (`√(x²+y²)`, `2x`, `x×y`,
`[a+b]`, copy-paste with hidden spaces). The engine already auto-converts much of this,
but the conversion is invisible — there is no way to see *what the calculator will
actually graph* before committing, and no explicit "clean this up and graph it" action.

## Goal

An in-app **Equation Converter**: type/paste messy maths → see the engine-ready form
and a plain-English summary of what changed → one button cleans it, drops it into the
active equation field, and graphs it.

Scope decision (user-selected): **notation cleanup only**. NOT LaTeX, NOT implicit-
equation solving, NOT parametric/function auto-detection.

## Architecture

### 1. Core refactor — single source of truth

Extract the textual-normalisation block currently inside `normalizeEquationCore`
into a pure function:

```
cleanEquationText(raw: string) -> string   // human-readable, engine-ready
```

- Returns a *readable* form: superscripts → `^(2)` (not `**(2)`), `√x` → `sqrt(x)`,
  `[ ] { }` → `( )`, `× · ∗ ⋅` → `*`, `÷ ∕ ⁄` → `/`, `– — −` → `-`, `π τ φ` →
  `pi tau phi`, zero-width / non-breaking junk removed.
- `normalizeEquationCore(expr,args)` calls `cleanEquationText(expr)` as its first
  step, then proceeds exactly as today (assign-strip, `^`→`**`, tokenize, classify).
  Because `^(2)` → `**(2)` downstream, numeric results are unchanged → the existing
  47-test suite must stay green (regression guard).
- Pure, no DOM, independently unit-testable.

### 2. Change summary

`describeEquationChanges(raw, cleaned) -> string`

Lightweight, category-based (not a char diff): inspect which notable source
characters/patterns were present (`× ÷ √ ∛ ²³… [ ] { } π τ φ`, zero-width/nbsp,
missing `*` between number and identifier) and emit a short friendly sentence,
e.g. *"Converted × → \*, ² → ^2, removed hidden spaces."* Empty string if
`raw === cleaned`.

### 3. UI panel

Inside the existing `.equation-helper` block, directly above
`#equation-status` (~line 614), matching current classes/styling:

- `<input type="text" id="converter-input" placeholder="Paste a messy equation…">`
- `<button id="converter-btn">Convert & Graph</button>`
- `<div id="converter-preview"></div>` — shows: cleaned form (monospace),
  the change summary, and a validity line from `analyzeEquation`.

### 4. Data flow

```
input (on type)  -> cleanEquationText -> show cleaned + describeEquationChanges
                  -> analyzeEquation(cleaned, modeArgs)
                     -> "✓ graphable" | "Will add slider for: k" | "Error: …"
Convert & Graph  -> target = activeEquationInput?.el ?? #eq-z   (same fallback
                       and modeArgs rule as existing insertEquationToken)
                  -> target.value = cleaned; dispatch 'input'
                  -> if analyzeEquation has NO hard error: updateActiveLayer()
                     else: leave it in the field, show the error, do NOT graph
                       (never silently graph a wrong surface)
```

`modeArgs`: `['x','y','t']` function, `['u','v','t']` parametric, `['u','t']` curve —
derived from `activeEquationInput.args` when available, else `['x','y','t']`.

## Error handling

- Empty input → preview cleared, button no-op.
- Hard error from `analyzeEquation` (e.g. unsupported `=`, `≤`, unknown function):
  field is still populated and the specific message shown; graphing is skipped.
- `cleanEquationText` never throws (pure string replacement).

## Isolation / boundaries

| Unit | Does | Depends on |
|------|------|-----------|
| `cleanEquationText` | messy text → readable engine-ready text | nothing (pure) |
| `describeEquationChanges` | (raw, cleaned) → friendly summary | nothing (pure) |
| `normalizeEquationCore` | classify/normalise for the engine | `cleanEquationText` |
| converter panel wiring | DOM glue | `cleanEquationText`, `describeEquationChanges`, `analyzeEquation`, `updateActiveLayer`, `activeEquationInput` |

No new dependencies. Stays single-file, offline, GitHub-Pages-safe.

## Testing

Extend `tests/equation_engine.test.mjs` (already extracts the real parser from
`3dvit.html`, so it cannot drift):

- `cleanEquationText` raw → expected-readable cases (superscripts, √/∛, brackets,
  unicode operators, zero-width/nbsp).
- Round-trip guard: for representative messy inputs,
  `analyzeEquation(cleanEquationText(raw), args)` has no error / is graphable.
- Full 47-test regression must stay green (engine numeric results unchanged).
- `node --check` on the full module; HTML structural checks (div balance, BOM,
  one importmap + one module `<script>`, no hardcoded paths).
- Browser smoke (type → preview → Convert & Graph) if the Playwright profile is
  free; otherwise explicitly deferred with a manual-check note.

## Out of scope (YAGNI)

LaTeX parsing; implicit/relational equation rearrangement; auto-detecting
parametric vs function vs curve; degree→radian conversion; history of past
conversions.
