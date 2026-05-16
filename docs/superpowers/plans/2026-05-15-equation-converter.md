# Equation Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app converter that turns messy/textbook equation notation into the calculator's engine-ready form, previews it, and graphs it on one click.

**Architecture:** Extract the existing textual-normalisation block out of `normalizeEquationCore` into a pure, reusable `cleanEquationText(raw)` (single source of truth shared by the engine and the converter). Add a pure `describeEquationChanges(raw, cleaned)`. Add a small converter panel in the Equation Helper that calls these plus the existing `analyzeEquation` / `updateActiveLayer`.

**Tech Stack:** Single-file vanilla-JS HTML app (`3dvit.html`); Node-based drift-proof test harness (`tests/equation_engine.test.mjs`) that extracts and runs the real parser from the HTML.

**Branch:** `fix/equation-input-robustness` (already checked out; builds on commits `e526850`, `7469010`).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `3dvit.html` | the app: parser + UI | Modify — add `cleanEquationText`, `describeEquationChanges`, refactor `normalizeEquationCore`, add converter CSS/HTML/JS |
| `tests/equation_engine.test.mjs` | drift-proof unit tests | Modify — export + test the two new pure functions |
| `docs/superpowers/specs/2026-05-15-equation-converter-design.md` | design spec | Exists (reference only) |

All new logic is added inside the existing extracted parser range (between `const FUNCTION_NAMES = new Set([` and `function sampleCurvePoints`) so the test harness can reach it.

---

## Task 1: Extract `cleanEquationText` (pure refactor, behaviour-preserving)

**Files:**
- Modify: `3dvit.html` — `normalizeEquationCore` and the area just before it
- Modify: `tests/equation_engine.test.mjs` — harness export line + new tests

- [ ] **Step 1: Add the new pure functions to the test harness export and write failing tests**

In `tests/equation_engine.test.mjs`, find this line:

```js
  `globalThis.__api = { normalizeEquation, createFunction, ` +
  `analyzeEquation: (typeof analyzeEquation === 'function' ? analyzeEquation : null) };`,
```

Replace it with:

```js
  `globalThis.__api = { normalizeEquation, createFunction, ` +
  `analyzeEquation: (typeof analyzeEquation === 'function' ? analyzeEquation : null), ` +
  `cleanEquationText: (typeof cleanEquationText === 'function' ? cleanEquationText : null), ` +
  `describeEquationChanges: (typeof describeEquationChanges === 'function' ? describeEquationChanges : null) };`,
```

And update the destructuring line directly below it:

```js
const { normalizeEquation, createFunction, analyzeEquation } = sandbox.__api;
```

to:

```js
const { normalizeEquation, createFunction, analyzeEquation, cleanEquationText, describeEquationChanges } = sandbox.__api;
```

Then, immediately before the final `console.log(`\n${'='.repeat(56)}...` line, insert:

```js
console.log('\n== cleanEquationText: messy -> readable engine-ready form ==');
{
  const ok2 = (got, exp, msg) => ok(got === exp, msg + ' (got: ' + JSON.stringify(got) + ')');
  ok(typeof cleanEquationText === 'function', 'cleanEquationText() exists');
  ok2(cleanEquationText('x²+y²'), 'x^(2)+y^(2)', 'superscripts -> ^( )');
  ok2(cleanEquationText('x¹⁰'), 'x^(10)', 'superscript run grouped');
  ok2(cleanEquationText('x⁻¹'), 'x^(-1)', 'negative superscript');
  ok2(cleanEquationText('√(x*x+y*y)'), 'sqrt(x*x+y*y)', 'root with parens');
  ok2(cleanEquationText('√x'), 'sqrt(x)', 'root with bare operand');
  ok2(cleanEquationText('√4'), 'sqrt(4)', 'root with number operand');
  ok2(cleanEquationText('∛8'), 'cbrt(8)', 'cube root');
  ok2(cleanEquationText('[x+1]*{y-2}'), '(x+1)*(y-2)', 'brackets -> parens');
  ok2(cleanEquationText('x×y÷2'), 'x*y/2', 'unicode operators');
  ok2(cleanEquationText('2π·r'), '2pi*r', 'greek + middle dot');
  ok2(cleanEquationText('x​^2'), 'x^2', 'zero-width stripped');
  ok2(cleanEquationText('x + y'), 'x + y', 'nbsp -> normal space');
  ok2(cleanEquationText(''), '', 'empty input -> empty');
  ok2(cleanEquationText('  sin(x)  '), 'sin(x)', 'trimmed, untouched when already clean');
  ok2(cleanEquationText('x=y'), 'x=y', '= left intact (still errors downstream, not silently changed)');
}
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node tests/equation_engine.test.mjs`
Expected: FAIL — `cleanEquationText() exists` fails (it's `null`) and the `ok2` cases fail. The pre-existing 47 assertions still PASS.

- [ ] **Step 3: Add `cleanEquationText` and refactor `normalizeEquationCore` in `3dvit.html`**

In `3dvit.html`, find the start of `normalizeEquationCore` and its inline normalisation block. The current code is:

```js
        function normalizeEquationCore(expr, args) {
            const out = { code: '0', error: null, autoParams: [] };
            let cleaned = (expr || '').trim();
            if (!cleaned) return out;

            // Normalise common "natural maths" notation to engine syntax.
            // Only well-defined equivalents are translated; ambiguous symbols
            // (=, <, >, ≤, ≥, ≠, °, …) deliberately still error clearly so a
            // mistyped relation never silently graphs the wrong surface.
            const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
            cleaned = cleaned
                .replace(/[​‌‍﻿]/g, '')      // zero-width junk
                .replace(/[–—−]/g, '-')                           // dashes / minus sign
                .replace(/[×·∗⋅]/g, '*')                          // ×, ·, ∗, ⋅
                .replace(/[÷∕⁄]/g, '/')                            // ÷, division & fraction slash
                .replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/φ/g, 'phi')
                .replace(/[\[{]/g, '(').replace(/[\]}]/g, ')')     // [ ] { } -> ( )
                .replace(/√\s*(\([^()]*\)|[A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'sqrt($1)')
                .replace(/√/g, 'sqrt')                             // bare/nested fallback
                .replace(/∛\s*(\([^()]*\)|[A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'cbrt($1)')
                .replace(/∛/g, 'cbrt')
                .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) =>            // superscript run -> **( … )
                    '**(' + run.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, (c) => SUP[c]) + ')');

            const assignMatch = cleaned.match(/^\s*([xyz])\s*(\([^)]*\))?\s*=\s*(.+)$/i);
```

Replace **everything from `function normalizeEquationCore(expr, args) {` down to (but NOT including) the `const assignMatch = ...` line** with the following (this introduces two new pure functions and slims the core to call `cleanEquationText`):

```js
        // Pure, DOM-free: messy / textbook notation -> readable engine-ready
        // text. Single source of truth shared by the engine and the in-app
        // converter. Only well-defined equivalents are translated; ambiguous
        // symbols (=, <, >, ≤, ≥, ≠, °, …) are left intact so a mistyped
        // relation errors clearly downstream instead of silently graphing the
        // wrong surface. Superscripts become ^( … ) (readable); the engine
        // turns ^ into ** later, so numeric results are unchanged.
        function cleanEquationText(raw) {
            let s = (raw || '').trim();
            if (!s) return '';
            const SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '-' };
            return s
                .replace(/[​‌‍﻿]/g, '')        // zero-width junk
                .replace(/ /g, ' ')                            // non-breaking space
                .replace(/[–—−]/g, '-')                            // dashes / minus sign
                .replace(/[×·∗⋅]/g, '*')                           // ×, ·, ∗, ⋅
                .replace(/[÷∕⁄]/g, '/')                             // ÷, division & fraction slash
                .replace(/π/g, 'pi').replace(/τ/g, 'tau').replace(/φ/g, 'phi')
                .replace(/[\[{]/g, '(').replace(/[\]}]/g, ')')      // [ ] { } -> ( )
                .replace(/√\s*(\([^()]*\)|[A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'sqrt($1)')
                .replace(/√/g, 'sqrt')                              // bare/nested fallback
                .replace(/∛\s*(\([^()]*\)|[A-Za-z_]\w*|\d+(?:\.\d+)?)/g, 'cbrt($1)')
                .replace(/∛/g, 'cbrt')
                .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]+/g, (run) =>             // superscript run -> ^( … )
                    '^(' + run.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, (c) => SUP[c]) + ')');
        }

        // Pure: short, friendly summary of which categories of fix were applied.
        function describeEquationChanges(raw, cleaned) {
            if (!raw || raw === cleaned) return '';
            const n = [];
            if (/[×·∗⋅]/.test(raw)) n.push('× → *');
            if (/[÷∕⁄]/.test(raw)) n.push('÷ → /');
            if (/[–—−]/.test(raw)) n.push('dash → -');
            if (/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/.test(raw)) n.push('superscript → ^( )');
            if (/√/.test(raw)) n.push('√ → sqrt()');
            if (/∛/.test(raw)) n.push('∛ → cbrt()');
            if (/[\[\]{}]/.test(raw)) n.push('[ ] { } → ( )');
            if (/[πτφ]/.test(raw)) n.push('Greek → pi/tau/phi');
            if (/[ ​‌‍﻿]/.test(raw)) n.push('removed hidden spaces');
            if (!n.length) n.push('tidied spacing');
            return 'Converted: ' + n.join(', ') + '.';
        }

        function normalizeEquationCore(expr, args) {
            const out = { code: '0', error: null, autoParams: [] };
            let cleaned = cleanEquationText(expr);
            if (!cleaned) return out;

            const assignMatch = cleaned.match(/^\s*([xyz])\s*(\([^)]*\))?\s*=\s*(.+)$/i);
```

Leave the rest of `normalizeEquationCore` (from `if (assignMatch) cleaned = assignMatch[3];` onward, including `cleaned = cleaned.replace(/\^/g, '**');`) exactly as-is.

- [ ] **Step 4: Run the full test suite to verify green + zero regressions**

Run: `node tests/equation_engine.test.mjs`
Expected: PASS — the 47 pre-existing assertions still pass (numeric results unchanged because `^(2)` → `**(2)` downstream) AND the new `cleanEquationText` block passes. Final line: `RESULT: 62 passed, 0 failed` (47 + 15 new).

- [ ] **Step 5: Syntax + structural verification**

Run:

```bash
cd /c/Projects/3dvitreous-grapher && python -c "import re;src=open('3dvit.html',encoding='utf-8').read();a=src.index('<script type=\"module\">')+22;b=src.index('</script>',a);open('tests/_m.mjs','w',encoding='utf-8').write(src[a:b]);o=len(re.findall(r'<div[\s>]',src));c=len(re.findall(r'</div>',src));print('div',o,c,'BOM',src.startswith('﻿'))" && node --check tests/_m.mjs && echo OK && rm -f tests/_m.mjs
```

Expected: `div 125 125 BOM False` then `OK`.

- [ ] **Step 6: Commit**

```bash
cd /c/Projects/3dvitreous-grapher && git add 3dvit.html tests/equation_engine.test.mjs && git commit --no-gpg-sign -m "refactor(equation-engine): extract pure cleanEquationText + describeEquationChanges

Single source of truth for notation cleanup, shared by the engine and the
upcoming in-app converter. normalizeEquationCore now delegates to it.
Behaviour-preserving (superscripts ^( ) -> ** downstream); 47 prior tests
plus 15 new cleanEquationText tests green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `describeEquationChanges` tests

**Files:**
- Modify: `tests/equation_engine.test.mjs`

(The function was already implemented in Task 1 Step 3; this task locks its behaviour with tests.)

- [ ] **Step 1: Write the failing-then-passing tests**

In `tests/equation_engine.test.mjs`, immediately after the `cleanEquationText` test block added in Task 1, insert:

```js
console.log('\n== describeEquationChanges: friendly summary ==');
{
  ok(typeof describeEquationChanges === 'function', 'describeEquationChanges() exists');
  ok(describeEquationChanges('sin(x)', 'sin(x)') === '', 'no change -> empty string');
  ok(describeEquationChanges('', '') === '', 'empty -> empty string');
  ok(/× → \*/.test(describeEquationChanges('x×y', 'x*y')), 'reports × → *');
  ok(/superscript/.test(describeEquationChanges('x²', 'x^(2)')), 'reports superscript');
  ok(/sqrt/.test(describeEquationChanges('√x', 'sqrt(x)')), 'reports √ → sqrt()');
  ok(/hidden spaces/.test(describeEquationChanges('x​y', 'xy')), 'reports hidden spaces');
  ok(describeEquationChanges('a b', 'a b').length === 0, 'identical (whitespace same) -> empty');
}
```

- [ ] **Step 2: Run the suite**

Run: `node tests/equation_engine.test.mjs`
Expected: PASS — `RESULT: 70 passed, 0 failed` (62 + 8 new). It passes immediately because the function already exists from Task 1; this task is the regression lock.

- [ ] **Step 3: Commit**

```bash
cd /c/Projects/3dvitreous-grapher && git add tests/equation_engine.test.mjs && git commit --no-gpg-sign -m "test(equation-engine): lock describeEquationChanges behaviour

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Converter UI panel (CSS + HTML + wiring)

**Files:**
- Modify: `3dvit.html` — `<style>` (add rules), Equation Helper markup, `uiElements` cache, new functions, init listeners

- [ ] **Step 1: Add CSS**

In `3dvit.html`, find this CSS rule:

```css
        .equation-status { font-size: 0.7rem; color: var(--text-muted); min-height: 1em; }
```

Insert immediately after it:

```css
        .equation-converter { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--section-bg); }
        .converter-row { display: flex; gap: 6px; margin: 4px 0; }
        .converter-row input { flex: 1; min-width: 0; }
        #converter-btn { white-space: nowrap; }
        .converter-preview { font-size: 0.7rem; color: var(--text-muted); min-height: 1em; word-break: break-word; font-family: ui-monospace, Menlo, Consolas, monospace; }
```

- [ ] **Step 2: Add the panel markup**

In `3dvit.html`, find:

```html
                    <div class="equation-status" id="equation-status">Click a field above, then use the chips to insert helpers.</div>
                </div>
```

Replace it with:

```html
                    <div class="equation-status" id="equation-status">Click a field above, then use the chips to insert helpers.</div>
                    <div class="equation-converter">
                        <div class="equation-helper-title">Converter — paste any equation</div>
                        <div class="converter-row">
                            <input type="text" id="converter-input" spellcheck="false" aria-label="Paste a messy or textbook equation to convert" placeholder="e.g.  √(x²+y²)   or   2x³ - [y+1]">
                            <button id="converter-btn" type="button" class="secondary-btn">Convert &amp; Graph</button>
                        </div>
                        <div class="converter-preview" id="converter-preview" aria-live="polite"></div>
                    </div>
                </div>
```

- [ ] **Step 3: Cache the new elements**

In `3dvit.html`, find the line:

```js
                equationStatus: getEl('equation-status'),
```

Insert immediately after it:

```js
                converterInput: getEl('converter-input'),
                converterBtn: getEl('converter-btn'),
                converterPreview: getEl('converter-preview'),
```

- [ ] **Step 4: Add the converter functions**

In `3dvit.html`, find the end of `validateEquationInput` and the `ensureAutoParams` function added earlier; immediately AFTER the closing brace of `ensureAutoParams` (the function that ends with the `for (const name of names) { ... }` loop), insert:

```js
        function currentEquationArgs() {
            return (activeEquationInput && activeEquationInput.args) ? activeEquationInput.args : ['x', 'y', 't'];
        }

        function updateConverterPreview() {
            const el = uiElements.converterPreview;
            if (!el) return;
            const raw = uiElements.converterInput ? uiElements.converterInput.value : '';
            if (!raw.trim()) { el.textContent = ''; return; }
            const cleaned = cleanEquationText(raw);
            const changes = describeEquationChanges(raw, cleaned);
            const a = analyzeEquation(cleaned, currentEquationArgs());
            let status;
            if (a.error) status = 'Error: ' + a.error;
            else if (a.autoParams.length) status = 'OK - adds slider' + (a.autoParams.length > 1 ? 's' : '') + ': ' + a.autoParams.join(', ');
            else status = 'OK - graphable';
            el.textContent = cleaned + (changes ? '   (' + changes + ')' : '') + '  -  ' + status;
        }

        function applyConverter() {
            const raw = uiElements.converterInput ? uiElements.converterInput.value : '';
            if (!raw.trim()) return;
            const cleaned = cleanEquationText(raw);
            const target = (activeEquationInput && activeEquationInput.el) ? activeEquationInput.el : uiElements.eqZ;
            if (!target) return;
            const args = currentEquationArgs();
            target.value = cleaned;
            target.dispatchEvent(new Event('input'));
            updateConverterPreview();
            if (!analyzeEquation(cleaned, args).error) updateActiveLayer();
        }
```

- [ ] **Step 5: Wire the listeners**

In `3dvit.html`, find:

```js
            attach('update-btn', 'click', updateActiveLayer);
```

Insert immediately after it:

```js
            attach('converter-btn', 'click', applyConverter);
            if (uiElements.converterInput) uiElements.converterInput.addEventListener('input', updateConverterPreview);
```

- [ ] **Step 6: Syntax + structural verification**

Run:

```bash
cd /c/Projects/3dvitreous-grapher && python -c "import re;src=open('3dvit.html',encoding='utf-8').read();a=src.index('<script type=\"module\">')+22;b=src.index('</script>',a);open('tests/_m.mjs','w',encoding='utf-8').write(src[a:b]);o=len(re.findall(r'<div[\s>]',src));c=len(re.findall(r'</div>',src));sc=len(re.findall(r'</script>',src,re.I));print('div',o,c,'script',sc,'BOM',src.startswith(chr(0xFEFF)))" && node --check tests/_m.mjs && echo SYNTAX_OK && rm -f tests/_m.mjs && node tests/equation_engine.test.mjs | tail -1
```

Expected: `div 127 127 script 2 BOM False`, then `SYNTAX_OK`, then `RESULT: 70 passed, 0 failed`. (div count rises from 125 to 127 because the panel adds two `<div>`s; `</div>` rises to match.)

- [ ] **Step 7: Commit**

```bash
cd /c/Projects/3dvitreous-grapher && git add 3dvit.html && git commit --no-gpg-sign -m "feat(equation-converter): in-app paste-and-convert panel

Converter panel in the Equation Helper: type/paste messy or textbook
notation -> live preview of the engine-ready form + plain-English summary
+ validity, and Convert & Graph fills the active equation field and graphs
it (skips graphing on a hard error so no silent wrong surface).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Integration verification + browser smoke

**Files:** none modified (verification only)

- [ ] **Step 1: Full regression + syntax (authoritative gate)**

Run:

```bash
cd /c/Projects/3dvitreous-grapher && node tests/equation_engine.test.mjs | tail -1
```

Expected: `RESULT: 70 passed, 0 failed`. If anything fails, STOP and return to systematic-debugging — do not proceed.

- [ ] **Step 2: Attempt the browser smoke**

Try Playwright (it may be unavailable if the profile is locked):

```
mcp__plugin_playwright_playwright__browser_navigate  url: file:///C:/Projects/3dvitreous-grapher/3dvit.html
```

If it navigates, run via `browser_evaluate` (the converter functions are module-scoped, so drive the DOM, not the functions):

```js
() => {
  const inp = document.getElementById('converter-input');
  const btn = document.getElementById('converter-btn');
  const pv  = document.getElementById('converter-preview');
  inp.value = '√(x²+y²)';
  inp.dispatchEvent(new Event('input'));
  const previewAfterType = pv.textContent;
  btn.click();
  return {
    eqZ: document.getElementById('eq-z').value,          // expect "sqrt(x^(2)+y^(2))"
    preview: previewAfterType,                            // expect contains "sqrt(x^(2)+y^(2))" and "graphable"
    errorBox: document.getElementById('error-msg').textContent  // expect "" (no error)
  };
}
```

Expected: `eqZ` = `sqrt(x^(2)+y^(2))`, `preview` contains `sqrt(x^(2)+y^(2))` and `graphable`, `errorBox` empty. Then `mcp__plugin_playwright_playwright__browser_console_messages level:error` → expect none related to the converter. Close with `browser_close`.

- [ ] **Step 3: If the browser profile is locked**

Do NOT kill the other browser session. Record in the final report that the browser smoke was deferred, and give the user this 20-second manual check: open `3dvit.html`, paste `√(x²+y²)` into the Converter box, confirm the preview shows `sqrt(x^(2)+y^(2)) - OK - graphable`, click **Convert & Graph**, confirm the `Equation z =` field now reads `sqrt(x^(2)+y^(2))` and a cone is drawn.

- [ ] **Step 4: Final report**

Report: tasks completed, `RESULT: 70 passed, 0 failed`, `SYNTAX_OK`, structural numbers (`div 127/127`, `script 2`, `BOM False`), browser-smoke outcome (done or deferred-with-manual-steps), and the commit hashes. State plainly if anything was skipped.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Extract pure `cleanEquationText`, core delegates to it, 47 tests stay green | Task 1 |
| Readable `^( )` superscripts, `√`/`∛` operand-wrapped, `[ ]{ }`→`( )`, unicode ops, zero-width/nbsp | Task 1 (cleanEquationText) + tests |
| `describeEquationChanges` category summary | Task 1 (impl) + Task 2 (tests) |
| Converter panel above `#equation-status`, matching styling | Task 3 Steps 1-2 |
| Live preview: cleaned + changes + analyzeEquation validity | Task 3 Step 4 (`updateConverterPreview`) |
| Convert & Graph → active field (fallback `#eq-z`), graph if no hard error, never silently graph on error | Task 3 Step 4 (`applyConverter`) |
| Mode args from `activeEquationInput.args` else `['x','y','t']` | Task 3 Step 4 (`currentEquationArgs`) |
| No deps, single-file, offline | All tasks (vanilla JS only) |
| Tests: cleanEquationText cases, round-trip graphable guard, full 47 regression, node --check, structural, browser smoke (or deferred) | Tasks 1, 2, 4 |
| Out of scope: LaTeX / implicit / mode autodetect | Not implemented (correct) |

Round-trip graphable guard: covered implicitly — Task 1 tests assert exact cleaned strings and the existing 47 include `analyzeEquation`/`createFunction` graphable checks for the equivalent inputs (`x²+y²`, `√(x*x+y*y)`, etc.) already shipped in `e526850`. No separate task needed.

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". Every code step has complete code. ✓

**3. Type consistency:** `cleanEquationText(raw)→string`, `describeEquationChanges(raw,cleaned)→string`, `currentEquationArgs()→string[]`, `updateConverterPreview()→void`, `applyConverter()→void`; element ids `converter-input`/`converter-btn`/`converter-preview` consistent across CSS, HTML, `uiElements` (`converterInput`/`converterBtn`/`converterPreview`), and functions. `analyzeEquation` returns `{error, autoParams}` — used consistently. ✓

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-equation-converter.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?