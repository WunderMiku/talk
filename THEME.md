# Theme, copy, and prompt architecture

## Files

| File | Responsibility |
| --- | --- |
| `styles.css` | Component layout and behavior |
| `theme.css` | Theme token contract + theme overrides |
| `theme.js` | Theme registry, persistence, `data-theme` application |
| `content.js` | UI copy, module labels, translator styles |
| `prompts.js` | Static model system prompts |
| `app.js` | Product logic and rendering |

The browser loads `theme.js`, `content.js`, and `prompts.js` before `app.js`.
`theme.css` loads after `styles.css`, so a theme may override both tokens and,
when necessary, component geometry.

## Adding a theme

1. Add a `[data-theme="your-theme"]` block to `theme.css`.
2. Override the semantic tokens first:
   - surfaces: `--paper`, `--card`, `--surface-*`
   - text: `--ink`, `--muted`, `--muted-2`, `--text-*`
   - accents: `--lime`, `--lime-deep`, `--lime-wash`, `--coral`, `--lavender`
   - shape: `--radius-*`
   - rhythm: `--space-*`, `--page-gutter`, `--sheet-gutter`
   - typography: `--font`, `--mono`
   - motion: `--motion-*`
3. Register it in `theme.js`:

```js
constructivist: {
  id: "constructivist",
  label: "构成主义",
  themeColor: "#d23b2f"
}
```

The theme selector in **设置 → 数据 → 外观主题** is generated from this registry.
The selection is stored in `talk.theme.v1`; `theme.js` applies it before the app
renders and updates the browser `theme-color` meta tag.

Only add component overrides for geometry that cannot be expressed through
tokens. Prefer `.tone-*` variables and the shared `.translation-card` /
`.translation-detail` structures for translation themes.

## Copy rules

- Chinese-first, concise, no meta commentary about being an AI.
- Product copy and translator style metadata belong in `content.js`.
- Static model instructions belong in `prompts.js`; do not interpolate user
  input into the system prompt. Dynamic text goes last in the user message.
- A new translator style needs an entry in `content.js` with `id`, `name`,
  `emoji`, `tone`, and `hint`. The prompt's style list should be updated in
  `prompts.js` at the same time.

## Current themes

- **Paper** — default warm paper/lime editorial look.
- **构成主义** — red/black/cream, hard edges, offset blocks, condensed display
  type, and a local geometric palette.

The constructivist theme is intentionally more opinionated; the Paper theme is
the baseline visual language.
