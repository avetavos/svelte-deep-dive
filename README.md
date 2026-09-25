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
