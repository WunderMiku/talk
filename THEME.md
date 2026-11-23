# Theme, copy, and prompt architecture

How the app is put together overall — request pipeline, caches, deployment — is
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); this file only covers themes.

## Files

| File | Responsibility |
| --- | --- |
| `css/styles.css` | Component layout and behavior; one landscape breakpoint owns the wide layout |
| `css/theme.css` | Base token contract (Paper) — the palette every theme inherits |
| `css/themes/<id>.css` | One file per non-default theme; overrides tokens and, when necessary, geometry |
| `js/theme.js` | Theme registry (label, chrome colour, stylesheet, copy key), persistence, `data-theme` |
| `js/content.js` | Base UI copy plus `themeCopy[<id>]` voices |
| `js/prompts.js` | Static model system prompts |
| `js/app.js` | Product logic and rendering |

Load order in `index.html`: `css/styles.css` → `css/theme.css` → `css/themes/constructivist.css` →
`css/themes/swiss-lab.css` → `css/themes/topo-acid.css` → `css/themes/retro-stub.css`, then `js/data.js`, `js/theme.js`, `js/content.js`, `js/prompts.js`,
`vendor/idb.js`, `js/app.js`. Theme files therefore win over both base component
rules and the token defaults.

Every theme selector is scoped with `[data-theme="<id>"]`, so theme files never
collide with each other or with the base sheet.

## Adding a theme

1. Create `css/themes/<id>.css` starting from the token block below. Override only
   what differs; every token not mentioned falls back to `css/theme.css`.
2. Load it in `index.html` (after `css/theme.css`) and add it to the `SHELL` list in
   `sw.js` so it is cached offline.
3. Register it in `js/theme.js`:

```js
mytheme: {
  id: "mytheme",
  label: "My Theme",
  themeColor: "#101010",
  accent: "#ff5500",
  css: "css/themes/mytheme.css",
  copyKey: "mytheme",
  description: "一句话说明它看起来像什么"
}
```

4. Add `TALK_CONTENT.themeCopy.mytheme` in `js/content.js` when the theme needs its
   own voice. Missing keys fall back to the base copy.

The theme selector in **设置 → 数据** is generated from the registry, so no UI
change is needed. Selection is stored in `talk.theme.v1`; `js/theme.js` applies it
before the app renders and updates the browser `theme-color` meta tag.

## The five themes

Constructivist carries one piece of art beyond type and colour: a red silhouette of a
monumental figure, traced from the 80th anniversary emblem and set into the
bottom corner as a multiply-blended watermark.

| id | label | voice | geometry |
| --- | --- | --- | --- |
| `paper` | Paper | paper and highlighter, the default | soft radii, quiet rules |
| `constructivist` | Constructivist | red/black poster, diagonal blocks | hard cuts, stamps |
| `swiss-lab` | Swiss Lab | lab index, cool and clinical | hairlines, ticks, numbering |
| `topo-acid` | Topo Acid | industrial field terminal | square, cut corners, one signal yellow |
| `retro-stub` | Retro Stub | ticket stubs and collage, cream + teal + one red stamp | cut corners, double rules, perforations |
| `archive-grid` | Archive Grid | analysis OS windows, paper + one acid green | square windows, mono labels, scan line |

Topo Acid is the most opinionated one, so it is the best example of what a theme
may own: it flattens every radius with a single `[data-theme="topo-acid"] *`
rule, clips card corners with `clip-path`, prints a faint 45° hatch on
`.screen`, and turns the module bar's top edge into the only magenta / yellow /
mint strip in the product. Every surface carries survey-map etching: contour
rings in paper-grey (about 4–5% ink) on the screen, the archive sheet and the
word hero, tiny registration marks at the sheet corners, and the same rings in
signal yellow inside the poster masthead.
Its yellow (`#fffa00`) is a fill for "current" only — labels, numbers and rules
stay ink. When adding a theme like this, keep
the same split: colour and shape in the theme file, layout and rhythm in
`css/styles.css`.

## Token contract

Override the semantic tokens, not component colours:

- surfaces: `--paper`, `--card`, `--surface-*`
- text: `--ink`, `--muted`, `--muted-2`, `--text-*`
- accents: `--lime`, `--lime-deep`, `--lime-wash`, `--coral`, `--lavender`
- shape: `--radius-*`
- rhythm: `--space-*`, `--page-gutter`, `--sheet-gutter`
- typography: `--font`, `--display`, `--mono`
- motion: `--motion-*`

Component geometry belongs in `css/styles.css`. The only per-theme geometry that
still exists is genuinely visual (clipped corners, hard shadows, poster type) and
lives in that theme's file.

## Wide layout

The landscape layout is defined once, in `css/styles.css`, inside a single
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
`TALK_CONTENT.themeCopy[<copyKey>]`. `copyFor(section)` in `js/app.js` merges a
theme's section over the base copy:

```js
const theme = window.TALK_THEME.current(); // { id, copyKey, ... }
const key = theme.copyKey || theme.id;
const override = TALK_CONTENT.themeCopy?.[key]?.[section];
```

Keys omitted by a theme keep the base copy, so a new theme can start with no
copy at all.

## Prompts

`js/prompts.js` is theme-independent on purpose: the model answers the same
dictionary question no matter which poster is around it. The theme salon prompt
is also static; only the title exclusion list is appended to the user message.
