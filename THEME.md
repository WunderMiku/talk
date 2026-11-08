# Theme, copy, and prompt architecture

How the app is put together overall — request pipeline, caches, deployment — is
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); this file only covers themes.

## Files

| File | Responsibility |
| --- | --- |
| `styles.css` | Component layout and behavior; one landscape breakpoint owns the wide layout |
| `theme.css` | Base token contract (Paper) — the palette every theme inherits |
| `themes/<id>.css` | One file per non-default theme; overrides tokens and, when necessary, geometry |
| `theme.js` | Theme registry (label, chrome colour, stylesheet, copy key), persistence, `data-theme` |
| `content.js` | Base UI copy plus `themeCopy[<id>]` voices |
| `prompts.js` | Static model system prompts |
| `app.js` | Product logic and rendering |

Load order in `index.html`: `styles.css` → `theme.css` → `themes/ussr.css` →
`themes/rhine.css`, then `data.js`, `theme.js`, `content.js`, `prompts.js`,
`vendor/idb.js`, `app.js`. Theme files therefore win over both base component
rules and the token defaults.

Every theme selector is scoped with `[data-theme="<id>"]`, so theme files never
collide with each other or with the base sheet.

## Adding a theme

1. Create `themes/<id>.css` starting from the token block below. Override only
   what differs; every token not mentioned falls back to `theme.css`.
2. Load it in `index.html` (after `theme.css`) and add it to the `SHELL` list in
   `sw.js` so it is cached offline.
3. Register it in `theme.js`:

```js
mytheme: {
  id: "mytheme",
  label: "My Theme",
  themeColor: "#101010",
  accent: "#ff5500",
  css: "themes/mytheme.css",
  copyKey: "mytheme",
  description: "一句话说明它看起来像什么"
}
```

4. Add `TALK_CONTENT.themeCopy.mytheme` in `content.js` when the theme needs its
   own voice. Missing keys fall back to the base copy.

The theme selector in **设置 → 数据** is generated from the registry, so no UI
change is needed. Selection is stored in `talk.theme.v1`; `theme.js` applies it
before the app renders and updates the browser `theme-color` meta tag.

## Token contract

Override the semantic tokens, not component colours:

- surfaces: `--paper`, `--card`, `--surface-*`
- text: `--ink`, `--muted`, `--muted-2`, `--text-*`
- accents: `--lime`, `--lime-deep`, `--lime-wash`, `--coral`, `--lavender`
- shape: `--radius-*`
- rhythm: `--space-*`, `--page-gutter`, `--sheet-gutter`
- typography: `--font`, `--display`, `--mono`
- motion: `--motion-*`

Component geometry belongs in `styles.css`. The only per-theme geometry that
still exists is genuinely visual (clipped corners, hard shadows, poster type) and
lives in that theme's file.

## Wide layout

The landscape layout is defined once, in `styles.css`, inside a single
`@media (orientation: landscape) and (min-width: 720px)` block. Word-page
spacing comes from variables there:

```css
:root {
  --word-page-gutter: 30px;
  --word-col-gap: 30px;
  --word-row-gap: 64px;
  --word-family-gap: 42px;
  --word-section-gap: 64px;
  --word-columns-lead: 96px; /* gap under the 同根词 row */
}
```

Change those, not the rules. Themes must not re-declare the word-page grid.

## Theme voice

Base interface copy lives in `TALK_CONTENT`; theme-specific writing lives under
`TALK_CONTENT.themeCopy[<copyKey>]`. `copyFor(section)` in `app.js` merges a
theme's section over the base copy:

```js
const theme = window.TALK_THEME.current(); // { id, copyKey, ... }
const key = theme.copyKey || theme.id;
const override = TALK_CONTENT.themeCopy?.[key]?.[section];
```

Keys omitted by a theme keep the base copy, so a new theme can start with no
copy at all.

## Prompts

`prompts.js` is theme-independent on purpose: the model answers the same
dictionary question no matter which poster is around it. The theme salon prompt
is also static; only the title exclusion list is appended to the user message.
