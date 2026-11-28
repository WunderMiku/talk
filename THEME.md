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

Load order in `index.html`: `css/styles.css` → `css/print-reader.css` → `css/theme.css` →
`css/themes/still.css` → `css/themes/constructivist.css` → `css/themes/swiss-lab.css` →
`css/themes/topo-acid.css` → `css/themes/archive-grid.css` → `css/themes/retro-stub.css`,
then `js/data.js`, `js/theme.js`, `js/content.js`, `js/prompts.js`, `js/llm-client.js`,
`js/i18n.js`, `vendor/idb.js`, `js/wordbooks.js`, `js/doc-parser.js`, `js/doc-reader.js`,
`js/native-bridge.js`, and `<script type="module" src="js/app.js">`. Theme files therefore
win over both base component rules and the token defaults.

Every theme selector is scoped with `[data-theme="<id>"]`, so theme files never
collide with each other or with the base sheet.

## Adding a theme

1. Create `css/themes/<id>.css` starting from the token block below. Override only
   what differs; every token not mentioned falls back to `css/theme.css`.
2. Load it in `index.html` (after `css/theme.css`) and add it to the `SHELL` list in
   `sw.js` (then run `npm run bump` or `npm run check:shell`) so it is cached offline.
3. Register it in `js/theme.js`:

```js
mytheme: {
  id: "mytheme",
  label: "My Theme",
  themeColor: "#101010",
  accent: "#ff5500",
  accentFill: "#ff5500",
  css: "css/themes/mytheme.css",
  copyKey: "mytheme",
  description: "一句话说明它看起来像什么",
  exampleStyle: "默认例句语气描述"
}
```

4. Add `TALK_CONTENT.themeCopy.mytheme` in `js/content.js` when the theme needs its
   own voice. Missing keys fall back to the base copy.

The one-tap theme grid in **设置 → 外观** is generated from the registry, so no UI
change is needed. Selection is stored in `talk.theme.v1`; `js/theme.js` applies it
before the app renders and updates the browser `theme-color` meta tag.

## The seven themes

Constructivist carries one piece of art beyond type and colour: a red silhouette of a
monumental figure, traced from the 80th anniversary emblem and set into the
bottom corner as a multiply-blended watermark.

| id | label | voice | geometry |
| --- | --- | --- | --- |
| `paper` | Paper | paper and highlighter, the default | soft radii, quiet rules |
| `still` | Still | minimal modern: whitespace, one ink, soft shadows | hairline cards, 14-20px radii, press-scale feedback |
| `constructivist` | Constructivist | red/black poster, diagonal blocks | hard cuts, stamps |
| `swiss-lab` | Swiss Lab | lab index, cool and clinical | hairlines, ticks, numbering |
| `topo-acid` | Topo Acid | industrial field terminal | square, cut corners, one signal yellow |
| `archive-grid` | Archive Grid | analysis OS windows, paper + one acid green | square windows, mono labels, scan line |
| `retro-stub` | Retro Stub | ticket stubs and collage, cream + teal + one red stamp | cut corners, double rules, perforations |

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
- rhythm: `--space-*`, `--page-gutter`, `--sheet-gutter`, `--hero-subrow-gap`
- typography: `--font`, `--display`, `--mono`, `--lh-display`, `--lh-display-phrase`, `--lh-ui-single`
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

## Surface roles (for blocks & future modules)

Avoid styling layout wrappers (like `.block`) as bordered/shadowed cards—those
containers carry zero inner padding and will trap child cards in double boxes.
Instead, new modular blocks and views declare one of four semantic surface roles
defined in `css/theme.css`:

- `data-surface="naked"` — unboxed typography directly on `--paper` (lead lines, timelines, headings).
- `data-surface="elevated"` — the theme's signature card surface (shadow-only in Still, ticket border in Retro Stub, heavy ink rule in Constructivist).
- `data-surface="inset"` — softly recessed sub-surface for contrast columns, patterns, or dialogue lines.
- `data-surface="stamp"` — accent-washed marginalia or editorial callout with a left rule.

A new theme only needs to tune these four roles (plus its core tokens) so every
existing and future block inherits the theme's voice without `M × N` overrides.
