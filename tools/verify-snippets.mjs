#!/usr/bin/env node
// Snippet-verification harness for the bilingual Svelte Deep Dive course.
//
// This course is ABOUT Svelte 5 / SvelteKit 2 but the site itself is Astro —
// there's no in-browser playground, so the only way to prove a lesson's code
// snippets actually compile (and, for behavior claims — "re-runs once",
// "cleanup runs before the next effect" — actually run) is a real SvelteKit
// project ("the probe", tools/probe/, gitignored) plus `svelte-check` (fast,
// every fence) and `vitest` (for fences that are tests).
//
// Adapted from react-deep-dive/tools/verify-snippets.mjs (per-lesson
// namespaces, --test via vitest, --self-test, relative-import cross-lesson
// resolution) and nextjs-deep-dive/tools/verify-snippets.mjs (bare-alias
// rewrite pattern, used here for `$lib/`). The quiz-array/SpotTheBug-aware
// string scanner (parseStringAt/scanBalanced) is ported from this repo's own
// tools/check-parity.mjs.
//
// Usage:
//   node tools/verify-snippets.mjs                 svelte-check every collected
//                                                   fence from src/content/docs/en
//   node tools/verify-snippets.mjs --refresh        wipe + rescaffold tools/probe first
//   node tools/verify-snippets.mjs --strict         also fail (exit 1) on warnings
//   node tools/verify-snippets.mjs --test [module/lesson]
//                                                   run vitest over collected *.test.ts
//                                                   fences (all, or one lesson's namespace)
//   node tools/verify-snippets.mjs --self-test      harness self-check (see selfTest())
//
// Fence convention (spec §5): a `svelte` fence whose FIRST line is
// `<!-- <path> -->` with path ending `.svelte` is a real component. A `ts`/`js`
// fence whose first line is `// <path>` ending `.ts`/`.js` (which also matches
// `.svelte.ts`/`.svelte.js`/`.test.ts` — they all end in `.ts` or `.js`) is a
// real module. A first line containing `@expect-error` is a deliberate-error
// demo and is skipped (the lesson prose carries the real error). Anything
// else is a fragment with no path comment and is skipped. Fences inside a
// quiz `export const ... = [...]` array or a `<SpotTheBug code={\`...\`}>`
// prop are excluded before fence-scanning even starts (same technique
// check-parity.mjs uses: walk the source honoring string literals so a
// literal ``` inside a quiz string never gets mistaken for a real fence).
//
// Path-comment line: KEPT, not stripped, in both fence kinds. An HTML
// comment is inert inside `<script>`/markup either way, and a `//` comment
// is inert at the top of a `.ts`/`.js` module — stripping it would need to
// re-derive line numbers for diagnostics with no benefit. (react-deep-dive
// and nextjs-deep-dive already do the same — this just documents it.)
//
// Namespacing: every collected fence is written into
// `tools/probe/src/lessons/<module>__<lesson>/<path-without-leading-'src/'>`
// — e.g. `src/lib/Counter.svelte` in lesson `reactivity/derived-rune` lands
// at `src/lessons/reactivity__derived-rune/lib/Counter.svelte`. `$lib/...`
// and relative (`./`, `../`) specifiers that reference another fence in the
// SAME lesson are rewritten to a relative path inside that same namespace
// (so `$lib/Counter.svelte`, which would otherwise resolve to the probe's
// real, empty `src/lib/`, is rewritten to `../lib/Counter.svelte` or
// similar). Cross-lesson: if a lesson references a path it does NOT itself
// define, but an earlier lesson (in module/file order) does, the specifier
// is rewritten to that lesson's copy instead — mirrors both reference repos'
// "first definer wins" rule.
//
// Route files (`src/routes/**`): mapped under the probe's REAL
// `src/routes/__lessons/<ns>/...` tree (not `src/lessons/`), so SvelteKit's
// own router discovers them and `svelte-kit sync` generates real
// `./$types` for each one — a lesson's `+page.server.ts` doing
// `import type { PageServerLoad } from './$types'` just works. SvelteKit
// does not special-case leading-underscore directories (unlike Next.js) —
// `__lessons` is a perfectly ordinary route segment, just never linked to or
// built (the harness never runs `vite build`/`dev`). The alternative — type
// -checking route files as plain floating components under `src/lessons/`
// — was rejected because it starves every `./$types` import of a real
// mapped error, that only surfaces when the snippet is actually executed
// and compared against expected output. — the exact kind of undetected gap
// this harness exists to catch.
//
// Import-specifier convention this harness requires: cross-file specifiers
// must use their real, full extension (`.svelte`, `.svelte.ts`, `.svelte.js`,
// `.ts`, `.js`) — matching the probe's own `rewriteRelativeImportExtensions:
// true` tsconfig option, which already expects this. An extensionless
// relative/`$lib` specifier is not rewritten and may fail to resolve; that's
// a real, reportable gap in the lesson, not a harness bug.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync, globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PROBE_DIR = path.join(REPO_ROOT, 'tools/probe');
const LESSONS_DIR = path.join(PROBE_DIR, 'src/lessons');
const ROUTE_LESSONS_DIR = path.join(PROBE_DIR, 'src/routes/__lessons');
const DOCS_EN = path.join(REPO_ROOT, 'src/content/docs/en');

const FENCE_LANGS = new Set(['svelte', 'ts', 'js']);
// `+` is part of the char class for SvelteKit route files (`+page.svelte`,
// `+page.server.ts`, `+layout.svelte`, `+server.ts`, ...).
const SVELTE_PATH_RE = /^<!-- (src\/[\w@.+\-[\]()/]+\.svelte) -->$/;
const TS_JS_PATH_RE = /^\/\/ (src\/[\w@.+\-[\]()/]+\.(?:ts|js))$/;

const VITEST_CONFIG_SRC = `import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// Generated by tools/verify-snippets.mjs — safe to regenerate, do not hand-edit.
//
// A separate config from vite.config.ts (which the probe's own dev/build/
// svelte-check use) so vitest's own resolution tweaks never leak into those.
// Reuses the full sveltekit() plugin (not the bare svelte() plugin) so a
// lesson test fence can still import $app/state, $env/static/private, etc.
export default defineConfig({
  plugins: [sveltekit({ compilerOptions: { experimental: { async: true } } })],
  resolve: {
    // Svelte ships separate client/server builds; without forcing the
    // browser condition, Vitest (running under Node) resolves the
    // server/SSR build, where effects don't run the way component tests
    // expect.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest-setup.ts'],
    include: ['src/lessons/**/*.test.ts', 'src/routes/__lessons/**/*.test.ts'],
  },
});
`;

const VITEST_SETUP_SRC = `import '@testing-library/jest-dom/vitest';\n`;

// ---------------------------------------------------------------------------
// String/bracket scanning helpers, ported from tools/check-parity.mjs (same
// technique that file uses to keep quiz-array template literals and
// `<SpotTheBug code={\`...\`}>` props from confusing a naive fence regex:
// walk the source honoring string literals so brackets/backticks *inside* a
// string never look like real structure).
// ---------------------------------------------------------------------------

function parseStringAt(text, i) {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) {
      j++;
      break;
    }
    j++;
  }
  return { end: j };
}

function scanBalanced(text, start, open, close) {
  let depth = 1;
  let i = start;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i = parseStringAt(text, i).end;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) depth--;
    i++;
  }
  return i; // index right after the matching close
}

// Ranges of `export const xxx = [ ... ]` (quiz question arrays) and
// `<SpotTheBug code={\` ... \`}>` template literals — the only places a
// fence-looking ``` sequence can hide inside a string in this course.
function findExcludedRanges(src) {
  const ranges = [];
  {
    const re = /export\s+const\s+\w+\s*=\s*\[/g;
    let m;
    while ((m = re.exec(src))) {
      const end = scanBalanced(src, re.lastIndex, '[', ']');
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  {
    const re = /<SpotTheBug\s+code=\{\s*`/g;
    let m;
    while ((m = re.exec(src))) {
      const backtickIdx = m.index + m[0].length - 1;
      const { end } = parseStringAt(src, backtickIdx);
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  return ranges;
}

// Blank out excluded ranges but keep every newline they contain, so line
// numbers computed on the result still match the original file.
function stripExcluded(src, ranges) {
  if (!ranges.length) return src;
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue; // overlapping/malformed match, ignore
    out += src.slice(cursor, start);
    out += src.slice(start, end).replace(/[^\n]/g, '');
    cursor = end;
  }
  out += src.slice(cursor);
  return out;
}

function countNewlinesBefore(s, upto) {
  let n = 0;
  for (let i = 0; i < upto; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

// Collect every fenced code block in one MDX file's source.
// Returns [{ fenceNum, lang, line, category, path?, body? }], fenceNum is
// 1-based over ALL real fences (any language) in document order.
function collectFences(rawSrc) {
  const src = stripExcluded(rawSrc, findExcludedRanges(rawSrc));
  const fenceRe = /```([\w-]*)[^\n]*\n([\s\S]*?)```/g;
  const results = [];
  let fenceNum = 0;
  let m;
  while ((m = fenceRe.exec(src))) {
    fenceNum++;
    const lang = m[1];
    if (!FENCE_LANGS.has(lang)) continue; // out of scope for this harness
    const body = m[2];
    const line = countNewlinesBefore(src, m.index) + 1;
    const firstLine = body.split('\n', 1)[0].trim();
    if (firstLine.includes('@expect-error')) {
      results.push({ fenceNum, lang, line, category: 'expect-error' });
      continue;
    }
    const pm = (lang === 'svelte' ? SVELTE_PATH_RE : TS_JS_PATH_RE).exec(firstLine);
    if (pm) {
      results.push({ fenceNum, lang, line, category: 'collected', path: pm[1], body });
    } else {
      results.push({ fenceNum, lang, line, category: 'skipped-no-path' });
    }
  }
  return results;
}

// Where a collected fence's original `src/...` path lands inside the probe.
// Route files (`src/routes/**`) go under the probe's REAL `src/routes/`
// tree (namespaced under `__lessons/<ns>/`) so SvelteKit's router discovers
// them and generates real `./$types`. Everything else goes under the inert
// `src/lessons/<ns>/` tree. See file-header note for why.
function destRelPath(ns, srcPath) {
  const rest = srcPath.slice('src/'.length);
  if (rest.startsWith('routes/')) {
    return path.posix.join('src/routes/__lessons', ns, rest.slice('routes/'.length));
  }
  return path.posix.join('src/lessons', ns, rest);
}

// Resolve a `./x`, `../x`, or `$lib/x` specifier (found inside a fence
// originally at `fenceSrcPath`) to the `src/...`-rooted path it names —
// exactly the string used as the fence's own `path` / owners-map key, since
// specifiers are required to carry their real extension (see file-header
// note).
function resolveSpecifier(spec, fenceSrcPath) {
  if (spec.startsWith('$lib/')) return 'src/lib/' + spec.slice('$lib/'.length);
  const dir = path.posix.dirname(fenceSrcPath);
  return path.posix.normalize(path.posix.join(dir, spec));
}

// Rewrite `./x`, `../x`, and `$lib/x` specifiers (that carry a real
// extension) into a relative path rooted at the resolved owner lesson's own
// namespace dir — own lesson first, else the first lesson (module/file
// order) that defines that exact path. An unresolvable specifier is left
// untouched, so svelte-check's own "cannot find module" error surfaces —
// which is the correct, honest outcome for a lesson snippet that references
// a file no lesson actually defines.
function rewriteSpecifiers(body, fenceSrcPath, ns, owners, ownKeys) {
  const hereDir = path.posix.dirname(destRelPath(ns, fenceSrcPath));
  return body.replace(
    /\b(from|import|require)(\s*\(?\s*)(['"])(\.\.?\/[^'"]*\.(?:svelte(?:\.[tj]s)?|[tj]s)|\$lib\/[^'"]*\.(?:svelte(?:\.[tj]s)?|[tj]s))\3/g,
    (whole, kw, ws, q, spec) => {
      const key = resolveSpecifier(spec, fenceSrcPath);
      const ownerNs = ownKeys.has(key) ? ns : owners.get(key)?.[0];
      if (!ownerNs) return whole;
      let rel = path.posix.relative(hereDir, destRelPath(ownerNs, key));
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${kw}${ws}${q}${rel}${q}`;
    },
  );
}

// ---------------------------------------------------------------------------
// Probe lifecycle
// ---------------------------------------------------------------------------

function ensureProbe(refresh) {
  if (refresh && existsSync(PROBE_DIR)) rmSync(PROBE_DIR, { recursive: true, force: true });
  if (!existsSync(PROBE_DIR)) {
    console.log('tools/probe missing — scaffolding with `sv create` (minimal, ts)...');
    const create = spawnSync(
      'npx',
      ['-y', 'sv@latest', 'create', 'probe', '--template', 'minimal', '--types', 'ts', '--no-add-ons', '--no-install'],
      { cwd: path.join(REPO_ROOT, 'tools'), stdio: 'inherit' },
    );
    if (create.status !== 0) {
      console.error('probe scaffold failed');
      process.exit(1);
    }
    const install = spawnSync('npm', ['install'], { cwd: PROBE_DIR, stdio: 'inherit' });
    if (install.status !== 0) {
      console.error('probe npm install failed');
      process.exit(1);
    }
  }
  patchViteConfig();
  patchTsconfig();
  writeFileSync(path.join(PROBE_DIR, 'vitest.config.ts'), VITEST_CONFIG_SRC);
  writeFileSync(path.join(PROBE_DIR, 'vitest-setup.ts'), VITEST_SETUP_SRC);
}

// Idempotent text-patch of tools/probe/tsconfig.json (it extends
// .svelte-kit/tsconfig.json and ends in a `//` comment, i.e. JSONC — not
// valid JSON.parse input, so this is a targeted string replace, same
// approach react-deep-dive uses for its own tsconfig.app.json). Without an
// explicit `types` array, a `*.test.ts` fence that uses jest-dom matchers
// (`toBeInTheDocument()`) type-checks clean under vitest (which loads
// vitest-setup.ts's `@testing-library/jest-dom/vitest` import) but FAILS
// under svelte-check (which has no notion of vitest's setupFiles and never
// reaches that import from any individual fence file) with
// `Property 'toBeInTheDocument' does not exist on type 'Assertion'` —
// caught by this harness's own --self-test. Naming the `/vitest` subpath
// specifically in `types` (not the bare package — that resolves to the
// *Jest*-flavored `expect` augmentation, a no-op for vitest's `Assertion`
// type) forces the vitest-flavored matcher augmentation to apply
// project-wide, without needing any individual file to import it.
function patchTsconfig() {
  const p = path.join(PROBE_DIR, 'tsconfig.json');
  let src = readFileSync(p, 'utf8');
  if (!src.includes('"types"')) {
    src = src.replace('"moduleResolution": "bundler"', '"moduleResolution": "bundler",\n\t\t"types": ["@testing-library/jest-dom/vitest", "vitest/globals"]');
  }
  writeFileSync(p, src);
}

// Idempotent text-patch of the probe's own vite.config.ts (real TS source,
// not JSON, so this is a targeted string replace rather than parse/
// stringify) to turn on `compilerOptions.experimental.async` — needed so
// `svelte-check` (which reads Svelte config from vite.config.ts when there's
// no svelte.config.js, confirmed against the installed svelte-check 4.7.6)
// accepts `await` in deriveds/templates/top-level `<script>`. Verified this
// option exists in the installed svelte@5.57.1's own type declarations
// (`node_modules/svelte/types/index.d.ts`, `@since 5.36`) before relying on
// it — see README's Harness section.
function patchViteConfig() {
  const p = path.join(PROBE_DIR, 'vite.config.ts');
  let src = readFileSync(p, 'utf8');
  if (!src.includes('experimental:')) {
    src = src.replace('compilerOptions: {', 'compilerOptions: {\n\t\t\t\texperimental: { async: true },');
  }
  writeFileSync(p, src);
}

// ---------------------------------------------------------------------------
// Lesson discovery
// ---------------------------------------------------------------------------

function discoverLessons() {
  const rels = globSync('**/*.mdx', { cwd: DOCS_EN }).sort();
  return rels.map((rel) => {
    const posixRel = rel.replaceAll('\\', '/');
    return {
      absPath: path.join(DOCS_EN, rel),
      mdxRelPath: `src/content/docs/en/${posixRel}`,
      module: posixRel.split('/')[0],
      lesson: path.basename(posixRel, '.mdx'),
    };
  });
}

// ---------------------------------------------------------------------------
// Shared: collect fences from descriptors + write the probe's lesson trees
// ---------------------------------------------------------------------------

function buildLessonsTree(descriptors) {
  rmSync(LESSONS_DIR, { recursive: true, force: true });
  rmSync(ROUTE_LESSONS_DIR, { recursive: true, force: true });
  mkdirSync(LESSONS_DIR, { recursive: true });

  const fenceMap = new Map(); // namespace -> { mdxRelPath, module, lesson, fences: Map(destRelPath -> fenceNum) }
  const stats = new Map(); // module -> { collected, skippedNoPath, expectError, tests }
  const owners = new Map(); // src-rooted path (with ext) -> [namespace, ...] in module/file order
  const nsKeys = new Map(); // namespace -> Set(src-rooted path) it defines itself
  const pending = []; // [namespace, fence]

  for (const d of descriptors) {
    const counters = stats.get(d.module) ?? { collected: 0, skippedNoPath: 0, expectError: 0, tests: 0 };
    stats.set(d.module, counters);

    const namespace = `${d.module}__${d.lesson}`;
    const nsFences = new Map();
    const keys = new Set();
    const src = readFileSync(d.absPath, 'utf8');

    for (const f of collectFences(src)) {
      if (f.category === 'collected') {
        counters.collected++;
        if (f.path.endsWith('.test.ts')) counters.tests++;
        nsFences.set(destRelPath(namespace, f.path), f.fenceNum);
        keys.add(f.path);
        const list = owners.get(f.path) ?? [];
        if (!list.includes(namespace)) list.push(namespace);
        owners.set(f.path, list);
        pending.push([namespace, f]);
      } else if (f.category === 'skipped-no-path') {
        counters.skippedNoPath++;
      } else if (f.category === 'expect-error') {
        counters.expectError++;
      }
    }
    fenceMap.set(namespace, { mdxRelPath: d.mdxRelPath, module: d.module, lesson: d.lesson, fences: nsFences });
    nsKeys.set(namespace, keys);
  }

  for (const [namespace, f] of pending) {
    const destAbs = path.join(PROBE_DIR, destRelPath(namespace, f.path));
    mkdirSync(path.dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, rewriteSpecifiers(f.body, f.path, namespace, owners, nsKeys.get(namespace)));
  }

  return { fenceMap, stats };
}

function printStats(stats) {
  console.log('\nPer-module fence summary (collected / skipped-no-path / expect-error / tests):');
  const totals = { collected: 0, skippedNoPath: 0, expectError: 0, tests: 0 };
  for (const [module, c] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${module}: ${c.collected} / ${c.skippedNoPath} / ${c.expectError} / ${c.tests}`);
    totals.collected += c.collected;
    totals.skippedNoPath += c.skippedNoPath;
    totals.expectError += c.expectError;
    totals.tests += c.tests;
  }
  console.log(`  TOTAL: ${totals.collected} / ${totals.skippedNoPath} / ${totals.expectError} / ${totals.tests}`);
}

// ---------------------------------------------------------------------------
// Check mode (default): svelte-kit sync once, then svelte-check once
// ---------------------------------------------------------------------------

function mapDiagnosticFile(fenceMap, filename) {
  const norm = filename.replaceAll('\\', '/');
  const lm = /^src\/lessons\/([^/]+)\/(.+)$/.exec(norm) ?? /^src\/routes\/__lessons\/([^/]+)\/(.+)$/.exec(norm);
  if (!lm) return null;
  const info = fenceMap.get(lm[1]);
  if (!info) return null;
  return { mdxRelPath: info.mdxRelPath, relPath: norm, fenceNum: info.fences.get(norm) };
}

function runSvelteCheck(descriptors, { strict = false } = {}) {
  const { fenceMap, stats } = buildLessonsTree(descriptors);

  const sync = spawnSync(path.join(PROBE_DIR, 'node_modules/.bin/svelte-kit'), ['sync'], { cwd: PROBE_DIR, encoding: 'utf8' });
  if (sync.status !== 0) {
    console.error('svelte-kit sync failed:', sync.stdout, sync.stderr);
    process.exit(1);
  }

  const res = spawnSync(
    path.join(PROBE_DIR, 'node_modules/.bin/svelte-check'),
    ['--tsconfig', './tsconfig.json', '--threshold', 'warning', '--output', 'machine-verbose'],
    { cwd: PROBE_DIR, encoding: 'utf8' },
  );
  if (res.error) {
    console.error('failed to run svelte-check in the probe:', res.error.message);
    process.exit(1);
  }

  const diagnostics = [];
  for (const line of (res.stdout ?? '').split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const rest = line.slice(spaceIdx + 1);
    if (!rest.startsWith('{')) continue; // START / COMPLETED / FAILURE lines
    let d;
    try {
      d = JSON.parse(rest);
    } catch {
      continue;
    }
    const mapped = mapDiagnosticFile(fenceMap, d.filename);
    diagnostics.push({
      severity: d.type, // 'ERROR' | 'WARNING'
      file: d.filename,
      line: d.start.line + 1,
      col: d.start.character + 1,
      code: d.code,
      message: d.message,
      mapped,
    });
  }

  const errors = diagnostics.filter((d) => d.severity === 'ERROR');
  const warnings = diagnostics.filter((d) => d.severity === 'WARNING');

  if (diagnostics.length) {
    console.log(`\n${errors.length} error(s), ${warnings.length} warning(s):\n`);
    for (const d of diagnostics) {
      const where = d.mapped
        ? `${d.mapped.mdxRelPath}:fence #${d.mapped.fenceNum} (${d.mapped.relPath})`
        : `[unmapped] ${d.file}`;
      console.log(`${d.severity} ${where} — probe:${d.file}:${d.line}:${d.col} TS${d.code}: ${d.message}`);
    }
  } else {
    console.log('\nno errors, no warnings.');
  }

  printStats(stats);

  const fail = errors.length > 0 || (strict && warnings.length > 0);
  return { errorCount: errors.length, warningCount: warnings.length, diagnostics, stats, fail };
}

// ---------------------------------------------------------------------------
// --test [module/lesson]: vitest over collected *.test.ts fences
// ---------------------------------------------------------------------------

function buildAndRunVitest(descriptors, target) {
  const { fenceMap } = buildLessonsTree(descriptors);

  let filterArg = null;
  if (target) {
    const parts = target.split('/');
    const lesson = parts.pop();
    const module = parts.join('/');
    const namespace = `${module}__${lesson}`;
    if (!fenceMap.has(namespace)) {
      console.error(`no such lesson: ${target}`);
      process.exit(1);
    }
    filterArg = namespace;
  }

  const outFile = path.join(os.tmpdir(), `verify-snippets-vitest-${process.pid}-${Date.now()}.json`);
  const vitestBin = path.join(PROBE_DIR, 'node_modules/.bin/vitest');
  const args = ['run', '--passWithNoTests', '--reporter=json', `--outputFile=${outFile}`];
  if (filterArg) args.push(filterArg);
  const res = spawnSync(vitestBin, args, { cwd: PROBE_DIR, encoding: 'utf8' });

  let report = null;
  if (existsSync(outFile)) {
    try {
      report = JSON.parse(readFileSync(outFile, 'utf8'));
    } catch {
      // leave report null; caller falls back to raw output
    }
    rmSync(outFile, { force: true });
  }

  return { fenceMap, report, status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function testMode(target) {
  const { fenceMap, report, status, stdout, stderr } = buildAndRunVitest(discoverLessons(), target);

  if (!report) {
    console.log((stdout ?? '') + (stderr ?? ''));
    process.exit(status ?? 1);
  }

  const byLesson = new Map(); // "module/lesson" -> testResults[]
  for (const tr of report.testResults ?? []) {
    const norm = (tr.name ?? '').replaceAll('\\', '/');
    const m = /(?:src\/lessons|src\/routes\/__lessons)\/([^/]+)\//.exec(norm);
    const info = m && fenceMap.get(m[1]);
    const label = info ? `${info.module}/${info.lesson}` : m ? m[1] : '[unmapped]';
    const list = byLesson.get(label) ?? [];
    list.push(tr);
    byLesson.set(label, list);
  }

  for (const [label, results] of [...byLesson.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const assertions = results.flatMap((r) => r.assertionResults ?? []);
    const passed = assertions.filter((a) => a.status === 'passed').length;
    console.log(`${label}: ${passed}/${assertions.length} passed`);
    for (const a of assertions.filter((a) => a.status === 'failed')) {
      const firstLine = (a.failureMessages?.[0] ?? '').split('\n')[0];
      console.log(`  FAIL ${(a.fullName ?? a.title).trim()}: ${firstLine}`);
    }
  }

  console.log(`\n${report.numPassedTests ?? 0}/${report.numTotalTests ?? 0} test(s) passed across ${report.testResults?.length ?? 0} file(s).`);
  process.exit(status ?? (report.success ? 0 : 1));
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'verify-snippets-selftest-'));
  const mdxPath = path.join(tmpDir, 'self.mdx');

  writeFileSync(
    mdxPath,
    [
      '---',
      'title: selftest',
      '---',
      '',
      '```svelte',
      '<!-- src/lib/Bad.svelte -->',
      '<script lang="ts">',
      '  let count: number = "oops"; // real type error',
      '</script>',
      '<button>{count}</button>',
      '```',
      '',
      '```svelte',
      '<!-- src/lib/Good.svelte -->',
      '<script lang="ts">',
      '  let count: number = 1;',
      '</script>',
      '<button>{count}</button>',
      '```',
      '',
      '```ts',
      '// src/lib/Good.test.ts',
      "import { describe, it, expect } from 'vitest';",
      "import { render, screen } from '@testing-library/svelte';",
      "import Good from './Good.svelte';",
      "describe('Good', () => {",
      "  it('renders', () => {",
      '    render(Good);',
      "    expect(screen.getByRole('button')).toBeInTheDocument();",
      '  });',
      '});',
      '```',
      '',
      '```ts',
      '// src/lib/Failing.test.ts',
      "import { describe, it, expect } from 'vitest';",
      "describe('failing', () => {",
      "  it('fails on purpose', () => { expect(1).toBe(2); });",
      '});',
      '```',
      '',
    ].join('\n'),
  );

  const descriptors = [{ absPath: mdxPath, mdxRelPath: 'selftest/self.mdx', module: '__selftest__', lesson: 'self' }];

  const { diagnostics } = runSvelteCheck(descriptors);
  const ns = '__selftest____self'; // `${module}__${lesson}` — module itself already ends in `__`
  const badTypeFailed = diagnostics.some((d) => d.severity === 'ERROR' && d.mapped?.relPath === `src/lessons/${ns}/lib/Bad.svelte`);
  const goodTypePassed = !diagnostics.some((d) => d.severity === 'ERROR' && d.mapped?.relPath === `src/lessons/${ns}/lib/Good.svelte`);

  const { report } = buildAndRunVitest(descriptors, '__selftest__/self');
  const byFile = new Map();
  for (const tr of report?.testResults ?? []) {
    byFile.set((tr.name ?? '').replaceAll('\\', '/'), tr.assertionResults ?? []);
  }
  const goodAssertions = [...byFile.entries()].find(([f]) => f.endsWith('lib/Good.test.ts'))?.[1] ?? [];
  const failingAssertions = [...byFile.entries()].find(([f]) => f.endsWith('lib/Failing.test.ts'))?.[1] ?? [];
  const goodTestPassed = goodAssertions.length > 0 && goodAssertions.every((a) => a.status === 'passed');
  const failingTestFailed = failingAssertions.length > 0 && failingAssertions.some((a) => a.status === 'failed');

  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(LESSONS_DIR, { recursive: true, force: true });
  rmSync(ROUTE_LESSONS_DIR, { recursive: true, force: true });

  const ok = badTypeFailed && goodTypePassed && goodTestPassed && failingTestFailed;
  const detail = { badTypeFailed, goodTypePassed, goodTestPassed, failingTestFailed };
  if (ok) {
    console.log('\nself-test: PASS (bad-type fence failed svelte-check, good component+test passed, failing test fence failed vitest)', detail);
    process.exit(0);
  }
  console.error('\nself-test: FAIL', detail);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  ensureProbe(args.includes('--refresh'));

  if (args.includes('--self-test')) return selfTest();

  const testIdx = args.indexOf('--test');
  if (testIdx !== -1) return testMode(args[testIdx + 1]);

  const { fail } = runSvelteCheck(discoverLessons(), { strict: args.includes('--strict') });
  process.exit(fail ? 1 : 0);
}

main();
