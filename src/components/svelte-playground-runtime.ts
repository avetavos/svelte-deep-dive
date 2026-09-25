// Pure logic for <SveltePlayground>. No DOM access at module scope (mirrors
// ts-runner.ts / render-visualizer-runtime.ts) except loadSvelteCompiler(),
// which touches only `import()` — no `document`/`window` — so this file
// stays importable and unit-testable under plain Node (vitest).
//
// Architecture (spec §3.3 "SveltePlayground", deep-review §4 "Playground"):
//   Stage 1 "Compile": lazy-load `svelte/compiler` (an isomorphic package —
//   the official REPL runs it in the browser the same way) from esm.sh,
//   pinned to the exact Svelte version this course teaches, and run
//   `compile()` with the reader's chosen `generate`/`dev` toggles. Shows the
//   real compiled JS, warnings, and errors with line/column — verified live
//   in a browser (not assumed from docs): see the module doc comment in
//   SveltePlayground.astro for the manual proof this was built against.
//   Stage 2 "Run": embeds the compiled `client`-target JS in a sandboxed
//   iframe `srcdoc` with an import map pinning `svelte` / `svelte/internal/client`
//   / `svelte/internal/disclose-version` to the same esm.sh version, mounts
//   it with `mount()` from `svelte`, and forwards runtime errors via
//   `postMessage` (same protocol shape as ts-runner.ts's sandbox). Manually
//   proven end-to-end in a real browser tab: compiling a `$state` counter,
//   mounting it in an iframe this way, and clicking its button through
//   `flushSync()` genuinely updated the mounted DOM text.
//
// Every lesson's `compile()` call always passes the SAME fixed `filename`
// ('Playground.svelte'), so the compiler always derives the same top-level
// component name ('Playground') regardless of what the lesson's own source
// comment says — Run's mount step depends on this being deterministic; it
// never has to parse the compiled output to find the component's name.

export type SvelteCompiler = typeof import('svelte/compiler');
export type SvelteRuntime = { mount: (...args: unknown[]) => unknown; flushSync: () => void };

export const SVELTE_CDN_VERSION = '5.57.1';
const ESM_BASE = `https://esm.sh/svelte@${SVELTE_CDN_VERSION}`;
const COMPILER_URL = `${ESM_BASE}/compiler`;

export const VERSION_BADGE = {
  en: (loaded?: string) => `Svelte ${loaded ?? SVELTE_CDN_VERSION} (esm.sh, pinned) — course targets ${SVELTE_CDN_VERSION}`,
  th: (loaded?: string) => `Svelte ${loaded ?? SVELTE_CDN_VERSION} (esm.sh, ปักหมุดเวอร์ชัน) — คอร์สอิง ${SVELTE_CDN_VERSION}`,
};

// The fixed filename every compile() call uses — see module doc comment.
const PLAYGROUND_FILENAME = 'Playground.svelte';
export const PLAYGROUND_COMPONENT_NAME = 'Playground';

// ---------------------------------------------------------------------------
// Lazy-load svelte/compiler (ESM-only — unlike ts-runner's UMD script-tag
// load, this is a plain dynamic import()).
// ---------------------------------------------------------------------------

let compilerPromise: Promise<SvelteCompiler> | null = null;

export function loadSvelteCompiler(): Promise<SvelteCompiler> {
  if (!compilerPromise) {
    compilerPromise = import(/* @vite-ignore */ COMPILER_URL) as Promise<SvelteCompiler>;
  }
  return compilerPromise;
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export interface CompileSettings {
  server: boolean; // generate: 'server' instead of 'client'
  dev: boolean;
}

export interface DiagnosticLine {
  text: string;
  frame?: string;
}

export type CompileOutcome =
  | { ok: true; js: string; warnings: DiagnosticLine[]; runes: boolean; generate: 'client' | 'server' }
  | { ok: false; error: DiagnosticLine };

interface CompileDiagnosticLike {
  code: string;
  message: string;
  start?: { line: number; column: number };
  frame?: string;
}

function formatDiagnostic(d: CompileDiagnosticLike): DiagnosticLine {
  const loc = d.start ? `${d.start.line}:${d.start.column} ` : '';
  return { text: `${loc}${d.code}: ${d.message}`, frame: d.frame };
}

export function compileSvelte(compiler: SvelteCompiler, source: string, settings: CompileSettings): CompileOutcome {
  const generate: 'client' | 'server' = settings.server ? 'server' : 'client';
  try {
    const result = compiler.compile(source, {
      generate,
      runes: true,
      dev: settings.dev,
      filename: PLAYGROUND_FILENAME,
    });
    return {
      ok: true,
      js: result.js.code,
      warnings: result.warnings.map((w) => formatDiagnostic(w as unknown as CompileDiagnosticLike)),
      runes: result.metadata.runes,
      generate,
    };
  } catch (e) {
    return { ok: false, error: formatDiagnostic(e as CompileDiagnosticLike) };
  }
}

// ---------------------------------------------------------------------------
// Run — mount the compiled `client`-target JS in a sandboxed iframe
// ---------------------------------------------------------------------------

/** Strips a leading `export default ` so the compiled `function Playground(...)` becomes a plain top-level declaration the module script can reference directly (mirrors ts-runner.ts / render-visualizer-runtime.ts's stripExportKeywords). */
export function stripExportDefault(js: string): string {
  return js.replace(/^(\s*)export\s+default\s+/m, '$1');
}

function buildImportMap(): string {
  return JSON.stringify({
    imports: {
      svelte: ESM_BASE,
      'svelte/internal/client': `${ESM_BASE}/internal/client`,
      'svelte/internal/disclose-version': `${ESM_BASE}/internal/disclose-version`,
    },
  });
}

export function buildRunSrcdoc(compiledClientJs: string): string {
  const body = stripExportDefault(compiledClientJs).replace(/<\/script/gi, '<\\/script');
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<script type="importmap">${buildImportMap()}</script>` +
    '<style>body{font-family:system-ui,sans-serif;margin:.75rem;color:#111;background:#fff}button{font:inherit}</style>' +
    '</head><body><div id="app"></div>' +
    '<script type="module">' +
    'function post(type,message){try{parent.postMessage({__svp:true,type:type,message:message},"*")}catch(e){}}' +
    'window.onerror=function(m){post("error",String(m));return true};' +
    'window.addEventListener("unhandledrejection",function(e){post("error",(e.reason&&e.reason.message)||String(e.reason))});' +
    `import { mount } from 'svelte';\n${body}\n` +
    `try{mount(${PLAYGROUND_COMPONENT_NAME},{target:document.getElementById('app')});}` +
    'catch(e){post("error",(e&&e.message)||String(e))}' +
    '</script></body></html>'
  );
}

export interface RunMessage {
  __svp: true;
  type: 'error';
  message: string;
}

export function isRunMessage(data: unknown): data is RunMessage {
  return !!data && typeof data === 'object' && (data as { __svp?: unknown }).__svp === true;
}

// ---------------------------------------------------------------------------
// i18n copy (mirrors ts-runner.ts / render-visualizer-runtime.ts's copyFor)
// ---------------------------------------------------------------------------

export const COPY = {
  en: {
    compile: 'Compile',
    run: 'Run ▸',
    loading: 'Loading Svelte compiler…',
    server: 'Server target',
    dev: 'Dev mode',
    copy: 'Copy',
    copied: 'Copied!',
    output: 'Compiled JS',
    noWarnings: 'No warnings ✓',
    runNotAvailable: 'Run needs a client-target compile — uncheck "Server target" and compile again.',
    runtimeError: 'Runtime error',
  },
  th: {
    compile: 'คอมไพล์',
    run: 'รัน ▸',
    loading: 'กำลังโหลด Svelte compiler…',
    server: 'เป้าหมาย Server',
    dev: 'โหมด Dev',
    copy: 'คัดลอก',
    copied: 'คัดลอกแล้ว!',
    output: 'JS ที่คอมไพล์แล้ว',
    noWarnings: 'ไม่มี warning ✓',
    runNotAvailable: 'รันต้องคอมไพล์แบบ client เป้าหมายก่อน — ยกเลิกติ๊ก "เป้าหมาย Server" แล้วคอมไพล์ใหม่',
    runtimeError: 'Runtime error',
  },
};

export function copyFor(lang: string | undefined): typeof COPY.en {
  return lang?.startsWith('th') ? COPY.th : COPY.en;
}
