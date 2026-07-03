// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site. Update `site` to your GitHub username and `base`
  // to your repo name if they differ.
  site: 'https://deep-dive.avetavos.com',
  base: '/svelte',
  output: 'static',
  integrations: [starlight({
      title: 'Svelte Deep Dive',
      head: [
        { tag: 'script', attrs: { type: 'module', src: '/svelte/enhance.js' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/svelte/manifest.webmanifest' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/svelte/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/svelte/icon-192.png' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#FF3E00' } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: "Svelte Deep Dive" } },
        { tag: 'script', content: "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/svelte/sw.js',{scope:'/svelte/'}).catch(function(){})})}" },
      ],
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', lang: 'en' },
        th: { label: 'ไทย', lang: 'th' },
      },
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/avetavos/svelte-deep-dive' }],
      sidebar: [
        { label: 'Svelte Foundations & Mental Model', items: [{ autogenerate: { directory: 'foundations' } }] },
        { label: 'Reactivity with Runes', items: [{ autogenerate: { directory: 'reactivity' } }] },
        { label: 'Components & Composition', items: [{ autogenerate: { directory: 'components' } }] },
        { label: 'Bindings, Actions & Transitions', items: [{ autogenerate: { directory: 'bindings-actions-transitions' } }] },
        { label: 'State Management & Stores', items: [{ autogenerate: { directory: 'state-and-stores' } }] },
        { label: 'SvelteKit: Full-Stack Svelte', items: [{ autogenerate: { directory: 'sveltekit' } }] },
        { label: 'Tooling, Testing & Production', items: [{ autogenerate: { directory: 'tooling-and-production' } }] },
      ],
      }), preact()],
});
