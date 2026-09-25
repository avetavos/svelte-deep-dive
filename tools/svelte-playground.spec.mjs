#!/usr/bin/env node
// Playwright check for <SveltePlayground> (spec §3.3, deep-review §4 "Playground").
//
// Usage:
//   node tools/svelte-playground.spec.mjs <baseUrl>
//   e.g. node tools/svelte-playground.spec.mjs http://127.0.0.1:4341
//
// Plain script (no @playwright/test runner), matching
// tools/render-visualizer.spec.mjs's precedent in react-deep-dive — needs
// only the `playwright` package (a real devDependency here, see package.json)
// resolvable, plus `npx playwright install chromium` once.
//
// What it checks, per lesson page (EN and TH), for all three embedding
// lessons that are live today (state-rune, derived-rune, effect-rune —
// foundations/why-svelte-the-compiler was skipped this pass, see the
// project's final report for why):
//   1. Navigate to the lesson, wait for the SveltePlayground's Compile button.
//   2. Click Compile — assert the output panel contains a real compiler
//      marker for that lesson (e.g. `$.state(` for state-rune) and that the
//      version badge shows real, non-empty "Svelte 5.57.1" text.
//   3. Click Run — assert the mounted iframe actually renders, then click
//      the button INSIDE the sandboxed iframe and assert its text changes
//      (proves compile -> mount -> real DOM reactivity, not just a static
//      compile view).
//   4. Assert zero page-level console errors accumulated across the flow.

import { chromium } from 'playwright';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('Usage: node tools/svelte-playground.spec.mjs <baseUrl>');
  process.exit(1);
}

const LESSONS = [
  { path: '/svelte/en/reactivity/state-rune/', marker: '$.state(' },
  { path: '/svelte/th/reactivity/state-rune/', marker: '$.state(' },
  { path: '/svelte/en/reactivity/derived-rune/', marker: '$.derived(' },
  { path: '/svelte/th/reactivity/derived-rune/', marker: '$.derived(' },
  { path: '/svelte/en/reactivity/effect-rune/', marker: '$.user_effect(' },
  { path: '/svelte/th/reactivity/effect-rune/', marker: '$.user_effect(' },
];

async function checkLesson(browser, { path, marker }) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  const url = baseUrl.replace(/\/$/, '') + path;
  await page.goto(url, { waitUntil: 'load' });

  const compileBtn = page.locator('.svp__compile').first();
  await compileBtn.waitFor({ state: 'visible', timeout: 15000 });
  await compileBtn.click();

  const outCode = page.locator('.svp__out pre code').first();
  await outCode.waitFor({ state: 'visible', timeout: 15000 });
  const outputText = (await outCode.textContent()) ?? '';
  if (!outputText.includes(marker)) {
    throw new Error(`${path}: compiled output missing marker "${marker}" — got: ${outputText.slice(0, 200)}`);
  }

  const badgeText = (await page.locator('.svp__badge').first().textContent())?.trim() ?? '';
  if (!/Svelte \d/.test(badgeText)) {
    throw new Error(`${path}: version badge missing Svelte version text: "${badgeText}"`);
  }

  // Stage 2 "Run": mount the compiled component in the sandboxed iframe and
  // prove the rendered DOM actually updates on a real click.
  const runBtn = page.locator('.svp__run').first();
  if (await runBtn.isDisabled()) {
    throw new Error(`${path}: Run button stayed disabled after a client-target compile`);
  }
  await runBtn.click();

  const frame = page.frameLocator('.svp__frame');
  const button = frame.locator('button').first();
  await button.waitFor({ state: 'visible', timeout: 10000 });
  const before = (await button.textContent()) ?? '';
  await button.click();
  await page.waitForTimeout(300);
  const after = (await button.textContent()) ?? '';
  if (after === before) {
    throw new Error(`${path}: mounted iframe DOM did not change after clicking its button (before="${before}" after="${after}")`);
  }

  if (consoleErrors.length) {
    throw new Error(`${path}: ${consoleErrors.length} console error(s): ${consoleErrors.join(' | ')}`);
  }

  await page.close();
  return { path, badgeText, before, after };
}

async function main() {
  const browser = await chromium.launch();
  const results = [];
  let failed = false;
  for (const lesson of LESSONS) {
    try {
      const result = await checkLesson(browser, lesson);
      results.push(result);
      console.log(`PASS  ${lesson.path}`);
      console.log(`      badge: ${result.badgeText}`);
      console.log(`      iframe button: "${result.before}" -> "${result.after}"`);
    } catch (err) {
      failed = true;
      console.log(`FAIL  ${lesson.path}`);
      console.log(`      ${err.message}`);
    }
  }
  await browser.close();
  console.log(`\n${results.length}/${LESSONS.length} lesson(s) passed.`);
  process.exit(failed ? 1 : 0);
}

main();
