// Drift-proof regression tests for the 3dvit.html equation engine.
// Extracts the REAL parser block from 3dvit.html and runs it in a vm sandbox,
// so these tests can never silently diverge from the shipped code.
//
// Run: node tests/equation_engine.test.mjs
//
// Covers the three silent-failure defects reported as "inputting an equation
// just creates a regular pane when it is not meant to":
//   D1 unknown coefficient (a*sin(x))     -> auto-slider, NOT a silent flat pane
//   D2 typo'd function name (sine(x))     -> clear error, NOT silent mangling
//   D3 decimal scientific notation (1e-3) -> parsed as a number, NOT corrupted
// Plus controls + false-positive guards (log/1-over-x/tan must still work).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', '3dvit.html'), 'utf8');

const START = 'const FUNCTION_NAMES = new Set([';
const END = 'function sampleCurvePoints';
const s = html.indexOf(START);
const e = html.indexOf(END);
if (s < 0 || e < 0 || e <= s) {
  console.error('FATAL: could not locate parser block in 3dvit.html (markers moved).');
  process.exit(2);
}
const parserSrc = html.slice(s, e);

// Sandbox: mutable userVariables (the fix may auto-register slider params here).
const sandbox = { Math, Object, Array, Set, RegExp, Number, console, userVariables: {} };
vm.createContext(sandbox);
vm.runInContext(
  `var userVariables = userVariables;\n${parserSrc}\n` +
  `globalThis.__api = { normalizeEquation, createFunction, ` +
  `analyzeEquation: (typeof analyzeEquation === 'function' ? analyzeEquation : null), ` +
  `cleanEquationText: (typeof cleanEquationText === 'function' ? cleanEquationText : null), ` +
  `describeEquationChanges: (typeof describeEquationChanges === 'function' ? describeEquationChanges : null) };`,
  sandbox
);
const { normalizeEquation, createFunction, analyzeEquation, cleanEquationText, describeEquationChanges } = sandbox.__api;
const setVars = (o) => { for (const k of Object.keys(sandbox.userVariables)) delete sandbox.userVariables[k]; Object.assign(sandbox.userVariables, o || {}); };

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } };
const near = (a, b, tol = 1e-6) => Number.isFinite(a) && Math.abs(a - b) <= tol;

// Helper: does this equation render a real (non-flat, finite) surface in function mode?
function rendersSurface(expr, vars = {}) {
  setVars(vars);
  const fn = createFunction(expr, ['x', 'y', 't']);
  if (!fn) return { fn: false, finite: 0, flat: true };
  let finite = 0, seen = new Set();
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
    try { const v = fn(x, y, 0, sandbox.userVariables); if (Number.isFinite(v)) { finite++; seen.add(Math.round(v * 1e4)); } } catch {}
  }
  return { fn: true, finite, flat: finite === 0 || seen.size <= 1 };
}

console.log('\n== D3: decimal scientific notation must parse as a number ==');
{
  setVars({});
  const fn = createFunction('1.5e-3*x + y', ['x', 'y', 't']);
  ok(!!fn, 'createFunction("1.5e-3*x + y") is non-null');
  ok(fn && near(fn(1000, 0, 0, sandbox.userVariables), 1.5, 1e-9), '1.5e-3 * 1000 == 1.5 (was silently 1.5*E-3*1000)');
  const fn2 = createFunction('2e3 + x', ['x', 'y', 't']);
  ok(fn2 && near(fn2(0, 0, 0, sandbox.userVariables), 2000, 1e-9), '2e3 == 2000 (unchanged, still works)');
}

console.log('\n== D2: typo / unknown function name must be a clear error, not silent ==');
{
  setVars({});
  const a = analyzeEquation ? analyzeEquation('sine(x) + cos(y)', ['x', 'y', 't']) : null;
  ok(!!analyzeEquation, 'analyzeEquation() exists');
  ok(a && a.error && /sine/i.test(a.error), 'sine(x) -> error message names "sine" (got: ' + (a && a.error) + ')');
  ok(createFunction('sine(x) + cos(y)', ['x', 'y', 't']) === null, 'createFunction rejects sine(x) (no silent mangle to sin(E)(x))');
  const a2 = analyzeEquation && analyzeEquation('lgo(x)', ['x', 'y', 't']);
  ok(a2 && a2.error && /lgo/i.test(a2.error), 'lgo(x) -> error names "lgo"');
}

console.log('\n== D1: unknown single-letter coefficient becomes an auto-slider param ==');
{
  setVars({});
  const a = analyzeEquation && analyzeEquation('a*sin(x) + cos(y)', ['x', 'y', 't']);
  ok(a && Array.isArray(a.autoParams) && a.autoParams.includes('a'), 'a*sin(x) -> autoParams includes "a" (got: ' + JSON.stringify(a && a.autoParams) + ')');
  ok(a && !a.error, 'a*sin(x) is NOT a hard error');
  // Renders immediately with a defaulting to 1 (before any slider is dragged):
  const r = rendersSurface('a*sin(x) + cos(y)', {});
  ok(r.fn && !r.flat && r.finite > 0, 'a*sin(x)+cos(y) renders a real surface (a defaults to 1), not a silent flat pane');
  // Tracks the slider once registered:
  setVars({ a: 5 });
  const fn = createFunction('a*sin(x) + cos(y)', ['x', 'y', 't']);
  ok(fn && near(fn(Math.PI / 2, 0, 0, sandbox.userVariables), 5 * 1 + 1, 1e-9), 'with slider a=5, a*sin(pi/2)+cos(0) == 6');
  // Multi-letter unknown (not a function call) is still a hard error:
  setVars({});
  const a3 = analyzeEquation && analyzeEquation('foo + x', ['x', 'y', 't']);
  ok(a3 && a3.error && /foo/i.test(a3.error), 'multi-letter unknown "foo" -> hard error (not an auto-slider)');
}

console.log('\n== Controls: previously-working input must still work (no regressions) ==');
for (const expr of ['sin(x)*cos(y)', 'x^2 + y^2', 'sqrt(x^2+y^2)', 'pi*x', 'e^x', '2x + y', 'cos(r)', 'theta + x']) {
  const r = rendersSurface(expr, {});
  ok(r.fn && !r.flat, `"${expr}" still renders a real surface`);
}

console.log('\n== False-positive guards: domain-limited fns are valid, must NOT be rejected ==');
for (const expr of ['log(x)', '1/x', 'tan(x)', 'sqrt(x)', 'asin(x)']) {
  setVars({});
  const a = analyzeEquation && analyzeEquation(expr, ['x', 'y', 't']);
  ok(a && !a.error, `"${expr}" is accepted (domain limits are not an error)`);
}

console.log('\n== Parametric / curve modes share the engine and must still work ==');
{
  setVars({});
  const px = createFunction('(2 + cos(v))*cos(u)', ['u', 'v', 't']);
  const py = createFunction('(2 + cos(v))*sin(u)', ['u', 'v', 't']);
  const pz = createFunction('sin(v)', ['u', 'v', 't']);
  ok(px && py && pz, 'torus parametric x/y/z all compile');
  ok(px && Number.isFinite(px(1, 1, 0, sandbox.userVariables)), 'torus x evaluates finite');
  const cx = createFunction('cos(u)', ['u', 't']);
  ok(cx && Number.isFinite(cx(1, 0, sandbox.userVariables)), 'curve x(u)=cos(u) evaluates finite');
}

console.log('\n== Natural-maths auto-conversion (only well-defined equivalents) ==');
{
  setVars({});
  const cf = (s) => createFunction(s, ['x', 'y', 't']);
  const V = sandbox.userVariables;
  let f;
  f = cf('x² + y²');      ok(f && near(f(2, 3, 0, V), 13), 'x²+y² superscript == x^2+y^2 (13 at 2,3)');
  f = cf('2x³ + y');           ok(f && near(f(2, 0, 0, V), 16), '2x³ == 2*x**3 (16 at x=2)');
  f = cf('x¹⁰ + y');      ok(f && near(f(2, 0, 0, V), 1024), 'x¹⁰ == x**(10) NOT (x**1)**0 (1024 at x=2)');
  f = cf('x⁻¹ + y');      ok(f && near(f(2, 1, 0, V), 1.5), 'x⁻¹ == 1/x (1.5 at x=2,y=1)');
  f = cf('[x+1]*y');                ok(f && near(f(1, 3, 0, V), 6), '[ ] -> ( )  ((1+1)*3=6)');
  f = cf('{x+2}*y');                ok(f && near(f(1, 2, 0, V), 6), '{ } -> ( )  ((1+2)*2=6)');
  f = cf('√(x*x + y*y)');      ok(f && near(f(3, 4, 0, V), 5), '√(...) -> sqrt(...) (5 at 3,4)');
  f = cf('√x + y');            ok(f && near(f(9, 1, 0, V), 4), '√x -> sqrt(x)  (sqrt9+1=4)');
  f = cf('√4 + y');            ok(f && near(f(0, 1, 0, V), 3), '√4 -> sqrt(4) NOT unknown "sqrt4"  (2+1=3)');
  f = cf('∛8 + y');            ok(f && near(f(0, 5, 0, V), 7), '∛8 -> cbrt(8)=2  (2+5=7)');
  f = cf('x×y');               ok(f && near(f(3, 4, 0, V), 12), 'x×y -> x*y (still works)');
  f = cf('x÷2 + y');           ok(f && near(f(4, 1, 0, V), 3), 'x÷2 -> x/2 (3 at x=4,y=1)');
  f = cf('x ∗ y');             ok(f && near(f(3, 4, 0, V), 12), 'asterisk operator ∗ -> *');
  f = cf('x + y');        ok(f && near(f(2, 3, 0, V), 5), 'non-breaking space tolerated (2+3=5)');
  f = cf('x​^2 + y');          ok(f && near(f(3, 1, 0, V), 10), 'zero-width space stripped (3^2+1=10)');
}

console.log('\n== Ambiguous/relational symbols still error clearly (NOT silently converted) ==');
for (const expr of ['2 ≤ x', 'x ≥ y', 'x ≠ y', 'x & y']) {
  setVars({});
  const a = analyzeEquation(expr, ['x', 'y', 't']);
  ok(a && a.error && /unsupported/i.test(a.error), `"${expr}" -> clear unsupported-character error (not converted)`);
}

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
  ok2(cleanEquationText('x=y'), 'x=y', '= left intact');
}

console.log(`\n${'='.repeat(56)}\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
