# svelte-deep-dive

## Harness

`tools/verify-snippets.mjs` proves the course's code fences actually compile
(and, for fences that are tests, actually run) against a real SvelteKit
project — this course is *about* Svelte 5 / SvelteKit 2, but the site itself
is Astro/Starlight, so nothing in the site build itself type-checks a lesson
snippet.

### Fence convention

- A ` ```svelte ` fence whose **first line** is `<!-- <path> -->`, with
  `<path>` ending in `.svelte` (e.g. `<!-- src/lib/Counter.svelte -->`), is a
  real component and gets collected.
- A ` ```ts `/` ```js ` fence whose first line is `// <path>`, ending in
  `.ts`/`.js` (this also covers `.svelte.ts`, `.svelte.js`, and `.test.ts` —
  they all end in `.ts`/`.js` too), is a real module and gets collected.
- A first line containing `@expect-error` is a deliberate-error demo and is
  skipped — the lesson prose carries the real error text.
- Anything else (no path comment) is a fragment and is skipped. Most fences
  in this course are fragments today; that's expected until a lesson is
  retrofitted with path comments.
- Fences inside a quiz `export const ... = [...]` array or a
  `<SpotTheBug code={\`...\`}>` prop are never scanned as fences in the first
  place (ported from `tools/check-parity.mjs`'s own string/bracket-aware
  scanner).
- The path-comment line is **kept**, not stripped, for both fence kinds — an
  HTML comment is inert inside `<script>`/markup, and a `//` comment is inert
  at the top of a `.ts`/`.js` module, so stripping it would only cost code
  (re-deriving line numbers) for no benefit.
- Cross-file specifiers (`./x`, `../x`, `$lib/x`) must carry their real, full
  extension (matches the probe's own `rewriteRelativeImportExtensions: true`
  tsconfig option). An extensionless specifier isn't rewritten and may fail
  to resolve — that's a real gap to fix in the lesson, not a harness bug.

### Path / import mapping

Every collected fence is written into `tools/probe/`, namespaced per lesson
as `<module>__<lesson>`:

- Everything **except** route files: `src/<rest>` → `tools/probe/src/lessons/<module>__<lesson>/<rest>`.
  E.g. `src/lib/Counter.svelte` in `reactivity/derived-rune` lands at
  `tools/probe/src/lessons/reactivity__derived-rune/lib/Counter.svelte`.
- **Route files** (`src/routes/**`): `tools/probe/src/routes/__lessons/<module>__<lesson>/<rest-after-routes/>`.
  These land under the probe's *real* `src/routes/` tree (not the inert
  `src/lessons/` tree) specifically so SvelteKit's own router discovers them
  and `svelte-kit sync` generates real `./$types` for each one — a lesson's
  `+page.server.ts` doing `import type { PageServerLoad } from './$types'`
  just works. SvelteKit doesn't special-case leading-underscore directories
  (unlike Next.js's `_` convention), so `__lessons` is an ordinary, harmless
  route segment that's never linked to or built (the harness never runs
  `vite build`/`dev`, only `svelte-check` and `vitest`).
- `$lib/...` and relative (`./`, `../`) specifiers are rewritten to a
  relative path into the resolved owner lesson's own namespace dir — own
  lesson first, else the first lesson (module/file order) that defines that
  exact path. This lets a later lesson reuse a component/hook an earlier
  lesson already defined, the way a real project would.

### Compiler options — `experimental.async`

Async Svelte (`await` in `$derived`/templates/top-level `<script>`) requires
`compilerOptions.experimental.async: true`. This scaffold (`sv create` v0.17,
Svelte 5.57.1) has no `svelte.config.js` — Svelte config lives directly in
the `sveltekit()` Vite plugin call inside `vite.config.ts`, which
`svelte-check` reads. The option **does exist** in the installed Svelte's own
type declarations (`node_modules/svelte/types/index.d.ts`, `@since 5.36`),
confirmed before relying on it. The harness idempotently patches it into
both `tools/probe/vite.config.ts` (read by `svelte-check`) and its own
`tools/probe/vitest.config.ts` (read by `vitest`).

### Commands

- `node tools/verify-snippets.mjs` — default: `svelte-kit sync`, then
  `svelte-check --tsconfig ./tsconfig.json --threshold warning --output
  machine-verbose` once over every collected fence; maps each diagnostic
  back to `<mdx path>:fence #<n> (<probe path>)`. Errors fail the run
  (exit 1); warnings are printed but don't fail unless `--strict` is passed.
- `--refresh` — wipe and rescaffold `tools/probe/` from scratch
  (`npx sv create probe --template minimal --types ts --no-add-ons
  --no-install`, then `npm install`) before checking.
- `--strict` — also fail (exit 1) on warnings.
- `--test [module/lesson]` — `vitest run` in the probe over every collected
  `*.test.ts` fence (all lessons, or just one namespace); prints per-lesson
  pass/fail counts and failing assertion text; exits with vitest's code.
- `--self-test` — harness self-check: a temp lesson with a `.svelte` fence
  that has a real type error in `<script lang="ts">` (must fail
  svelte-check), a good component + a passing test (must pass), and a
  failing test (must fail under `--test`). Prints `PASS`/`FAIL`.

`tools/probe/` is gitignored and safe to delete any time — `--refresh`
rebuilds it from scratch.

## SveltePlayground

A narrow-scope, in-browser Svelte 5 playground (spec §3.3, deep-review §4
"Playground") used in three lessons today —
`reactivity/state-rune`, `reactivity/derived-rune`, `reactivity/effect-rune`
— so readers can see what `$state`/`$derived`/`$effect`/the template
actually compile to, instead of taking the lesson's word for it. Not a
generic "run any Svelte file" sandbox: each embed supplies one
`export const xxxCode` template literal defining a single `.svelte`
component source (mirrors `TSPlayground`/`RenderVisualizer`'s pattern in the
sibling courses).

**Architecture.** `src/components/SveltePlayground.astro` renders the code
statically via Expressive Code (read-only) and wires a toolbar with plain
inline `<script>` — no Preact island needed, since both stages are DOM
toggling/mounting, not framework-level state (matches `TSPlayground.astro`'s
approach, not `RenderVisualizer`'s). Two stages:

- **Stage 1 "Compile"** (always available). Lazily `import()`s
  **`svelte/compiler@5.57.1`** — the exact version this course teaches —
  from `esm.sh` (a plain dynamic `import()`, not a UMD script tag: unlike
  TypeScript, `svelte/compiler` is ESM-only). Runs
  `compile(source, { generate, runes: true, dev, filename: 'Playground.svelte' })`
  with `generate`/`dev` driven by two checkboxes ("Server target", "Dev
  mode"; runes mode is always on — this course only teaches runes). Shows
  the compiled JS in a `<pre>` with a copy button, every warning
  (`line:col code: message`), and on a real `CompileError` its message,
  `line:col`, and Svelte's own source-frame text. The version badge shows
  the actually-loaded `compiler.VERSION` after first use, not just the
  pinned constant.
- **Stage 2 "Run"** — enabled only after a successful **`client`**-target
  compile (a `server`-target compile produces a string-renderer, not
  something mountable in a browser). Strips the compiled output's leading
  `export default` and embeds it in a sandboxed `<iframe srcdoc
  sandbox="allow-scripts">` with an `importmap` pinning `svelte`,
  `svelte/internal/client`, and `svelte/internal/disclose-version` to the
  same `esm.sh` version (the compiled output's own import specifiers — read
  directly off real compiler output, not guessed), then calls
  `mount(Playground, { target })` from `svelte`. Every embed always compiles
  with the same fixed `filename: 'Playground.svelte'`, so the top-level
  exported function is always named `Playground` regardless of the lesson's
  own code comments — Run's mount step depends on this name being
  deterministic, not parsed out of the compiled output. Runtime errors
  (`window.onerror` / `unhandledrejection` inside the iframe) are forwarded
  to the host via `postMessage` and shown in the same error panel Compile
  uses.

**Manually proven in a real browser tab before writing any component code**
(not assumed from the official REPL's behavior): loaded
`svelte/compiler@5.57.1` from `esm.sh` and ran `compile()` on `$state`,
`$derived`, and `$effect` examples — confirmed the exact output markers
(`$.state(`, `$.set(`, `$.derived(`, `$.user_effect(`, `$.template_effect(()
=> $.set_text(...))`), the `CompileError` shape (`code`, `message`, `start`
`{line, column}`, `frame`), and `generate: 'server'`/`dev: true` output —
then separately built the exact import-map + `mount()` iframe srcdoc by hand
and proved a compiled `$state` counter mounted in a sandboxed iframe and
its DOM text genuinely updated after two real clicks (via `flushSync()`)
before wiring any of it into the Astro component.

**Files:** `src/components/SveltePlayground.astro` (wrapper + inline
`<script>` DOM wiring), `src/components/svelte-playground-runtime.ts` (pure
logic: the lazy compiler loader, `compileSvelte()`, the import-map/srcdoc
builder, the `postMessage` protocol type, EN/TH copy) — split the same way
`ts-runner.ts` is split from `TSPlayground.astro`.

**Limitations:**
- Single-file only — one `.svelte` component per embed, no imports beyond
  `svelte` itself.
- `generate: 'server'` output is Compile-only by design; Run is disabled
  for it (a server-target render function needs a real request/response
  cycle, not a browser DOM).
- The lesson `xxxCode` literals are plain string literals (like
  `RenderVisualizer`'s, not `TSPlayground`'s fenced examples) —
  `tools/verify-snippets.mjs` only collects fences, so these aren't (and
  can't be) picked up by that harness. `tools/check-parity.mjs` already had
  a rule for `export const ...Code` literals (byte-identical EN/TH, no
  Thai leak) before this component existed, so parity is still enforced.
- `foundations/why-svelte-the-compiler` (the lesson spec §3.3 named as a
  fourth embed spot) was **skipped**: it was being actively edited by a
  concurrent agent for the entire duration of this work (a live, uncommitted
  165+-line diff, unchanged in size across repeated checks) and, by the time
  this component was ready, that in-progress rewrite had already added its
  own `svelte/compiler`-based demonstration of the same output markers
  (`$.state`/`$.derived`/`$.user_effect`/`$.template_effect`+`set_text`) via
  a real `vitest` test in `## The compiler's output, for real`. Embedding a
  fourth `SveltePlayground` there risked colliding with that in-flight
  content for marginal added value. `<SveltePlayground>` is a generic,
  drop-in component — adding it to that lesson later is a small, isolated
  edit once the concurrent work lands.

**Proof:** `tools/svelte-playground.spec.mjs` is a plain Playwright script
(not a `@playwright/test` suite, matching `render-visualizer.spec.mjs`'s
precedent in `react-deep-dive`) — `node tools/svelte-playground.spec.mjs
<baseUrl>` against a running static build. For all three embedding lessons
(EN + TH, six pages total), it clicks Compile and asserts the output panel
contains that lesson's real compiler marker (`$.state(`, `$.derived(`,
`$.user_effect(`) and a real, non-empty `Svelte 5.57.1` version badge, then
clicks Run and asserts the button rendered *inside the sandboxed iframe*
changes text after a real click (proves compile → mount → live DOM
reactivity, not just a static compile view), and asserts zero page-level
console errors across the whole flow. Verified 6/6 passing against
`astro build` output served locally. `playwright` is a real devDependency
(`^1.63.0`, matching `react-deep-dive`) — run `npx playwright install
chromium` once if the browser binary isn't already cached.
