# Loquent design system

Loquent's chat UI is a quiet instrument: a conversation column with room to breathe, a
sidebar that recedes, and one accent colour that marks what you can act on. It ships four
themes that share one structure and differ in colour, type and the physical feel of surfaces.
This file describes them, and the **styling contract** (named parts, tokens and states) that
your CSS can rely on.

The colour palette and the styling contract below are generated from `frontend/src/themes.ts`
and `frontend/src/parts.ts` (`npm --prefix frontend run gen:design`); a test fails when this
file is out of date. Everything else is written by hand.

## 1. Visual theme and atmosphere

**Graphite** (`graphite`, light, the default light theme). Precise and warm-neutral: chalk
white paper, stone greys that lean slightly brown, and a single indigo accent. Inter for text,
JetBrains Mono for code. Cards are white and sit on the page with a shadow that is barely
there, a warm grey haze rather than a drop. Nothing decorates; hierarchy comes from spacing
and weight.

**Graphite Dark** (`graphite-dark`, dark). The neutral twin: charcoal with surfaces that step
up in small increments, so depth reads as lightness, not as shadow. The indigo is lifted to a
pale periwinkle so dark ink sits on it at full contrast. Shadows are deep near-black falloff
with a faint highlight along the top edge, like light catching a bevel.

**Editorial** (`editorial`, light). Warm paper, all the way through. Ink black text on cream
stock with a terracotta accent, and Newsreader, a serif, for the app name and headings over
Inter body text. Corners are a little softer than elsewhere, shadows are sepia and so faint
the page reads flat, and the send button is a round terracotta seal.

**Midnight** (`midnight`, dark, the default dark theme). Deep navy, lit from within: surfaces
climb through blue-black steps, the accent is an electric teal that glows on focus and on the
send button only, and status dots carry a soft halo of their own colour. Geist for text,
JetBrains Mono for code. Shadows are navy-tinted with a cool highlight on the upper edge.

`default_theme: "system"` resolves to Graphite in a light OS scheme and Midnight in a dark one
(within the allowed `themes`).

## 2. Colour palette and roles

Every theme sets the same 21 colour tokens as `--lq-<token>` custom properties on
`[data-lq-theme="<id>"]`. Text roles meet WCAG AA (4.5:1) on the surfaces they sit on. Two
non-text roles are held to 3:1: `text-subtle` and `border-strong` (outlines that must be seen).
**`text-subtle` is for non-text decoration only** (chevrons, icons): any text, including
hints, list markers and notes, uses `text-muted` or stronger. `accent-soft` and `scrim` are translucent
(`#rrggbbaa`) and never used in contrast pairs.

<!-- gen:palette:start -->

### Graphite (`graphite`, light)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--lq-bg` | Warm Chalk | `#fbfbfa` | page background |
| `--lq-bg-subtle` | Soft Stone | `#f4f4f2` | sidebar and quiet fills |
| `--lq-surface` | Clean White | `#ffffff` | cards, composer, widgets |
| `--lq-surface-raised` | Clean White | `#ffffff` | elevated surfaces, menus |
| `--lq-border` | Pale Pebble | `#e7e6e3` | hairlines and dividers |
| `--lq-border-strong` | Warm Slate | `#8a867f` | input outlines, meaningful borders (3:1 or better) |
| `--lq-text` | Near-Black Ink | `#18181b` | body text and headings |
| `--lq-text-muted` | Quiet Umber | `#5c5a55` | secondary text |
| `--lq-text-subtle` | Faded Pewter | `#85827b` | non-text decoration only: chevrons, icons (3:1, never text) |
| `--lq-accent` | Indigo Ink | `#4f46e5` | primary actions, links, active state |
| `--lq-accent-hover` | Deep Indigo | `#4338ca` | accent on hover or press |
| `--lq-accent-text` | Bright White | `#ffffff` | text on accent fills |
| `--lq-accent-soft` | Indigo Mist | `#4f46e51a` | translucent accent wash (selection, focus halo) |
| `--lq-user-bubble` | Pale Oat | `#f0efec` | the user's message bubble |
| `--lq-user-bubble-text` | Near-Black Ink | `#18181b` | text in the user's bubble |
| `--lq-code-bg` | Light Flint | `#f5f5f3` | code blocks and inline code |
| `--lq-focus-ring` | Indigo Ink | `#4f46e5` | keyboard focus outline |
| `--lq-success` | Forest Green | `#15803d` | completed, approved |
| `--lq-warning` | Burnt Amber | `#b45309` | caution |
| `--lq-danger` | Signal Red | `#c62828` | errors, destructive actions |
| `--lq-scrim` | Smoked Veil | `#18181b52` | overlay behind the drawer and dialogs |

### Graphite Dark (`graphite-dark`, dark)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--lq-bg` | Charcoal | `#111113` | page background |
| `--lq-bg-subtle` | Coal | `#0d0d0f` | sidebar and quiet fills |
| `--lq-surface` | Graphite Slate | `#18181a` | cards, composer, widgets |
| `--lq-surface-raised` | Lifted Slate | `#1f1f22` | elevated surfaces, menus |
| `--lq-border` | Dark Seam | `#28282b` | hairlines and dividers |
| `--lq-border-strong` | Ash Grey | `#67666b` | input outlines, meaningful borders (3:1 or better) |
| `--lq-text` | Soft Bone | `#ededeb` | body text and headings |
| `--lq-text-muted` | Warm Fog | `#a3a19c` | secondary text |
| `--lq-text-subtle` | Dim Smoke | `#77756f` | non-text decoration only: chevrons, icons (3:1, never text) |
| `--lq-accent` | Lifted Periwinkle | `#818cf8` | primary actions, links, active state |
| `--lq-accent-hover` | Pale Periwinkle | `#a5b4fc` | accent on hover or press |
| `--lq-accent-text` | Charcoal Ink | `#111113` | text on accent fills |
| `--lq-accent-soft` | Periwinkle Haze | `#818cf824` | translucent accent wash (selection, focus halo) |
| `--lq-user-bubble` | Raised Basalt | `#232326` | the user's message bubble |
| `--lq-user-bubble-text` | Soft Bone | `#ededeb` | text in the user's bubble |
| `--lq-code-bg` | Coal | `#0d0d0f` | code blocks and inline code |
| `--lq-focus-ring` | Lifted Periwinkle | `#818cf8` | keyboard focus outline |
| `--lq-success` | Fresh Mint | `#4ade80` | completed, approved |
| `--lq-warning` | Warm Amber | `#fbbf24` | caution |
| `--lq-danger` | Coral Red | `#f87171` | errors, destructive actions |
| `--lq-scrim` | Black Veil | `#000000a6` | overlay behind the drawer and dialogs |

### Editorial (`editorial`, light)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--lq-bg` | Warm Paper | `#faf7f2` | page background |
| `--lq-bg-subtle` | Aged Vellum | `#f3eee5` | sidebar and quiet fills |
| `--lq-surface` | Cream Stock | `#fffdf9` | cards, composer, widgets |
| `--lq-surface-raised` | Bright Cream | `#fffefb` | elevated surfaces, menus |
| `--lq-border` | Parchment Edge | `#e6dfd2` | hairlines and dividers |
| `--lq-border-strong` | Driftwood | `#918675` | input outlines, meaningful borders (3:1 or better) |
| `--lq-text` | Press Ink | `#1f1b16` | body text and headings |
| `--lq-text-muted` | Walnut Brown | `#6b6155` | secondary text |
| `--lq-text-subtle` | Weathered Tan | `#8f8474` | non-text decoration only: chevrons, icons (3:1, never text) |
| `--lq-accent` | Terracotta | `#c2410c` | primary actions, links, active state |
| `--lq-accent-hover` | Baked Clay | `#9a3412` | accent on hover or press |
| `--lq-accent-text` | Paper White | `#fffaf5` | text on accent fills |
| `--lq-accent-soft` | Terracotta Wash | `#c2410c1a` | translucent accent wash (selection, focus halo) |
| `--lq-user-bubble` | Oat Linen | `#efe8dc` | the user's message bubble |
| `--lq-user-bubble-text` | Press Ink | `#1f1b16` | text in the user's bubble |
| `--lq-code-bg` | Pale Sand | `#f4efe6` | code blocks and inline code |
| `--lq-focus-ring` | Terracotta | `#c2410c` | keyboard focus outline |
| `--lq-success` | Olive Green | `#3f6212` | completed, approved |
| `--lq-warning` | Ochre | `#a16207` | caution |
| `--lq-danger` | Brick Red | `#b91c1c` | errors, destructive actions |
| `--lq-scrim` | Sepia Veil | `#1f1b1652` | overlay behind the drawer and dialogs |

### Midnight (`midnight`, dark)

| Token | Name | Hex | Role |
|---|---|---|---|
| `--lq-bg` | Deep Navy | `#0b1020` | page background |
| `--lq-bg-subtle` | Abyss Blue | `#0e1428` | sidebar and quiet fills |
| `--lq-surface` | Night Slate | `#121a33` | cards, composer, widgets |
| `--lq-surface-raised` | Lifted Indigo Slate | `#17213d` | elevated surfaces, menus |
| `--lq-border` | Dusk Seam | `#1c2440` | hairlines and dividers |
| `--lq-border-strong` | Steel Lavender | `#5a6792` | input outlines, meaningful borders (3:1 or better) |
| `--lq-text` | Moonlit White | `#e6e9f2` | body text and headings |
| `--lq-text-muted` | Mist Blue | `#9aa3bd` | secondary text |
| `--lq-text-subtle` | Distant Haze | `#6e7896` | non-text decoration only: chevrons, icons (3:1, never text) |
| `--lq-accent` | Electric Teal | `#22d3ee` | primary actions, links, active state |
| `--lq-accent-hover` | Bright Aqua | `#67e8f9` | accent on hover or press |
| `--lq-accent-text` | Abyss Ink | `#04121a` | text on accent fills |
| `--lq-accent-soft` | Teal Glow | `#22d3ee1f` | translucent accent wash (selection, focus halo) |
| `--lq-user-bubble` | Midnight Indigo | `#172039` | the user's message bubble |
| `--lq-user-bubble-text` | Moonlit White | `#e6e9f2` | text in the user's bubble |
| `--lq-code-bg` | Void Navy | `#080c19` | code blocks and inline code |
| `--lq-focus-ring` | Electric Teal | `#22d3ee` | keyboard focus outline |
| `--lq-success` | Sea Green | `#34d399` | completed, approved |
| `--lq-warning` | Gold | `#fbbf24` | caution |
| `--lq-danger` | Rose | `#fb7185` | errors, destructive actions |
| `--lq-scrim` | Ink Veil | `#02040ab3` | overlay behind the drawer and dialogs |

<!-- gen:palette:end -->

## 3. Typography rules

- **Body** (`--lq-font-body`): Inter Variable in Graphite, Graphite Dark and Editorial; Geist
  Variable in Midnight. Each falls back to the system UI stack, so text stays visible while a
  font loads (`font-display: swap`). Fonts are self-hosted and loaded per theme, so a theme
  only downloads the faces it uses.
- **Display** (`--lq-font-display`): the same as body, except Editorial, which sets headings,
  the app name and widget titles in Newsreader (a serif, weight 500 to 600, slightly tightened).
- **Mono** (`--lq-font-mono`): JetBrains Mono Variable for code blocks and inline code.
- **Scale**: `text-xs` 12px, `text-sm` 13px, `text-base` 15px, `text-lg` 17px, `text-xl` 20px,
  `text-2xl` 24px, with `leading-tight` 1.25 and `leading-normal` 1.6. `data-lq-text="s|l"`
  on `<html>` rescales the whole ramp.
- **Weights**: `--lq-weight-normal` 400, `--lq-weight-medium` 500 (labels, buttons, the
  thread list) and `--lq-weight-semibold` 600 (headings, titles). Components use only these.

## 4. Component stylings

- **Radius.** Graphite, Graphite Dark and Midnight use a tight scale: small controls at 6px,
  inputs and buttons at 8px, cards at 12px, the composer at 16px, and fully round pills.
  Editorial softens each step to 8, 10, 14 and 20px. Read them as `--lq-radius-sm|md|lg|xl|pill`.
- **Shadow.** Light themes use layered, low-opacity shadows tinted to the theme (warm stone in
  Graphite, sepia in Editorial): a hairline contact shadow plus a wide, soft fall. Dark themes
  add a 1px inner highlight on the top edge and a deeper, near-black fall. Three steps,
  `--lq-shadow-1` (resting), `-2` (composer, cards) and `-3` (menus, drawer).
  **The only px allowed in a component shadow is the focus halo**: a 3px `accent-soft` ring
  around a focused field. Every other shadow is a `--lq-shadow-*` token.
- **Messages.** The user's text sits in a `user-bubble` pill; the assistant's reply is unboxed
  prose in the conversation column. Finished assistant messages show an action bar.
- **Activity and widgets.** Steps and tool calls are small pills with a status dot (running,
  done, stopped). Widgets (confirm, select, form) are cards on `surface`; Midnight lets them fall
  from `surface-raised` into `surface`.
- **Composer.** A single `surface` card holding pending files, the textarea and the attach and
  send buttons. It gains an accent focus halo while the textarea is focused.
- **Motion.** `--lq-duration-fast` 120ms and `--lq-duration-normal` 200ms on
  `cubic-bezier(0.2, 0, 0, 1)`; both drop to 0 under `prefers-reduced-motion: reduce`.

## 5. Layout principles

- A 4px spacing base (`--lq-space-1` to `-10`: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px).
  `data-lq-density="compact"` tightens the whole scale.
- The conversation is a single centred column, `--lq-content-width` (700px); the sidebar is
  `--lq-sidebar-width` (264px). Below the narrow breakpoint the sidebar becomes a drawer over a
  `scrim`.
- The header is a slim bar: title on the left, actions on the right. The composer is docked
  under the conversation, never floating over it.
- Themes never set `space-*` or `text-*`, so density and text size apply to every theme.

## 6. Styling contract

The contract is what your CSS (and, later, plugins) may depend on: part names, tokens and
state attributes. It is versioned with semver in `STYLE_CONTRACT_VERSION`: removing or
renaming anything is a major bump, adding is a minor bump.

### Selecting a part

Parts are marked with `data-lq-part`, a **space-separated token list**, like `class`. One
element can carry several tokens (`data-lq-part="activity activity-tool"`), so always use the
token-list selector `[data-lq-part~="name"]`, never `=`:

```css
/* Style a part: rounder, flatter assistant code blocks. */
[data-lq-part~="code-block"] {
  border-radius: var(--lq-radius-xl);
  box-shadow: none;
}
/* States are attributes on the same element. */
[data-lq-part~="activity"][data-lq-state="stopped"] {
  border-color: var(--lq-danger);
}
/* Re-colour with tokens, in one theme only. Unlayered CSS beats the brand layer too, so this
   wins over `theme.accent` without !important. Only a locked token (`lock_tokens`) holds. */
[data-lq-theme="midnight"] {
  --lq-accent: #a78bfa;
  --lq-accent-text: #0b0618;
}
```

### Where each part lands, and its states

`PART_TARGETS` in `parts.ts` names the element each part lands on; the table below is
generated from it, including the **conditional parts** (those present only in some situations:
`empty-state`, `message-user`, `message-actions`, `composer-attach`, `appearance-panel`,
`login`, `drawer`). The states a part may carry are listed with it.

- `data-lq-state` is one of `streaming` (assistant message while it arrives), `running`,
  `done`, `error`, `stopped`. It appears on `message` (assistant), `activity` (`running`,
  `done`, or `stopped` when its run ended before it finished), `error`, `attachment` (`error`)
  and the `composer-send` button (`running` while a run is active).
- `data-lq-theme`, `data-lq-scheme`, `data-lq-density` and `data-lq-text` sit on `<html>` and
  are part of the contract, with the values listed below: scope a rule to one theme with
  `[data-lq-theme="midnight"]`, or to dark themes and dark brand palettes with
  `[data-lq-scheme="dark"]`.
- `data-lq-role` is `user` or `assistant`, on `message`.
- `data-lq-active="true"` marks the current `thread-item`.

<!-- gen:contract:start -->

Contract version: **1.0.0**. Select a part with `[data-lq-part~="<name>"]`.

#### Parts

| Part | Lands on |
|---|---|
| `app` | The root element of the whole UI, including the login screen. |
| `sidebar` | The chats nav. |
| `sidebar-header` | The top of the sidebar: the brand (logo and app name, plus the close button when narrow) above new-chat. |
| `new-chat` | The New chat button in the sidebar. |
| `thread-list` | The scrolling container of thread groups. Also holds the empty hint. |
| `thread-item` | One thread row (viewing, renaming or confirming delete). data-lq-active=true on the current thread. |
| `main` | The column holding header, conversation and composer. |
| `header` | The top bar. |
| `header-title` | The header title: the open thread's title, or the app name when no thread is open or it has no title. |
| `header-actions` | The group of header buttons. |
| `conversation` | The scrolling conversation region. |
| `empty-state` | The greeting shown when the thread has no items. Absent otherwise. |
| `message` | A message row, user or assistant. data-lq-role=user\|assistant; assistant rows carry data-lq-state=streaming\|done. |
| `message-user` | The user's text bubble inside a user message row. Absent for attachments-only messages. |
| `message-assistant` | The assistant's body (markdown, or the typing indicator) inside an assistant message row. |
| `message-actions` | The action bar under a finished assistant message. Absent while streaming or empty. |
| `markdown` | The rendered markdown container of an assistant message. |
| `code-block` | A fenced code block, including its header bar. |
| `activity` | One step or tool row (same element as activity-step or activity-tool). data-lq-state=running\|done\|stopped (stopped: it was still running when its run ended, so it will not finish). |
| `activity-step` | Kind token on the activity row for a step. |
| `activity-tool` | Kind token on the activity row for a tool call. |
| `widget` | Every widget element, including the pending and fallback placeholders. Kind tokens widget-confirm\|widget-select\|widget-form sit on the same element once rendered. |
| `widget-confirm` | Kind token on the widget element for a confirm widget. |
| `widget-select` | Kind token on the widget element for a select widget. |
| `widget-form` | Kind token on the widget element for a form widget. |
| `error` | An error item in the conversation. data-lq-state=error. |
| `composer` | The composer card: the visible box around the pending files, the input and its buttons (inside the message form). |
| `composer-input` | The message textarea. |
| `composer-attach` | The attach button. Absent when attachments are disabled. |
| `composer-send` | The send button, or the stop button while a run is active (then data-lq-state=running). |
| `attachment` | An attachment chip in a message. data-lq-state=error when it could not be opened. |
| `appearance-panel` | The appearance settings region. Conditional: only while the panel is open. |
| `login` | The sign-in screen. Conditional: only in password mode without a user. |
| `drawer` | Alias on the sidebar wrapper (the element around sidebar). Conditional: only on narrow screens with the drawer open. |

#### Scale tokens

`--lq-font-body`, `--lq-font-display`, `--lq-font-mono`, `--lq-text-xs`, `--lq-text-sm`, `--lq-text-base`, `--lq-text-lg`, `--lq-text-xl`, `--lq-text-2xl`, `--lq-leading-tight`, `--lq-leading-normal`, `--lq-weight-normal`, `--lq-weight-medium`, `--lq-weight-semibold`, `--lq-space-1`, `--lq-space-2`, `--lq-space-3`, `--lq-space-4`, `--lq-space-5`, `--lq-space-6`, `--lq-space-7`, `--lq-space-8`, `--lq-space-9`, `--lq-space-10`, `--lq-radius-sm`, `--lq-radius-md`, `--lq-radius-lg`, `--lq-radius-xl`, `--lq-radius-pill`, `--lq-shadow-1`, `--lq-shadow-2`, `--lq-shadow-3`, `--lq-duration-fast`, `--lq-duration-normal`, `--lq-ease`, `--lq-content-width`, `--lq-sidebar-width`

#### States

`data-lq-state=streaming`, `data-lq-state=running`, `data-lq-state=done`, `data-lq-state=error`, `data-lq-state=stopped`, `data-lq-role=user`, `data-lq-role=assistant`, `data-lq-active=true`

#### Root attributes (on `<html>`)

| Attribute | Values |
|---|---|
| `data-lq-theme` | `graphite`, `graphite-dark`, `editorial`, `midnight` |
| `data-lq-scheme` | `light`, `dark` |
| `data-lq-density` | `comfortable`, `compact` |
| `data-lq-text` | `s`, `m`, `l` |

#### Theme ids

`graphite`, `graphite-dark`, `editorial`, `midnight`

<!-- gen:contract:end -->

### Cascade layers

Loquent's own CSS lives in cascade layers, declared in this order:

```css
@layer lq.lock, lq.reset, lq.base, lq.components, lq.themes, lq.brand, lq.prefs, lq.utilities;
```

**Developer CSS (`custom_css_path`) and user CSS are unlayered, so they beat every Loquent
layer** regardless of selector specificity: a plain `[data-lq-part~="composer"] { ... }` is
enough, and so is `:root { --lq-accent: ... }`. The full precedence, strongest first:

1. `lq.lock`: `lock_tokens`, written at runtime into `<style id="lq-lock">` as `!important`
   rules on `:root` and every element below it. `!important` reverses layer order, so the
   first layer's `!important` beats every later layer and all unlayered CSS, `!important` or
   not. A locked token (and the tokens derived from it) keeps its brand or theme value.
2. Unlayered developer and user CSS.
3. `lq.utilities`.
4. `lq.prefs`: the user's appearance prefs (reserved; the Appearance panel is coming).
5. `lq.brand`: the `theme` brand keys, written at runtime into `<style id="lq-brand">` as
   `:root` rules.
6. `lq.themes`: the four theme palettes.
7. `lq.components`, `lq.base` (scale tokens), `lq.reset`.

### Internal variables are not API

Variables that start with `--lqi-` (for example `--lqi-glow` or `--lqi-new-chat-bg`) are
**internal and outside semver**. Themes use them as private knobs, and they can change or
disappear in any release. Do not depend on them; use the `--lq-*` tokens and the parts.

### The legacy `theme` keys: a brand layer

The `theme` setting (`accent`, `background`, `surface`, `text`, `muted`, `radius`, `font`) is
a **brand layer** on top of the active theme: it sets the matching `--lq-*` tokens in the
`lq.brand` cascade layer, so it beats the theme but not your unlayered CSS or the user's
(see the precedence above). `font` sets both `--lq-font-body` and `--lq-font-display`.
Text on accent fills is black or white, whichever contrasts more, and `focus-ring` follows the
accent, stepped to at least **3:1** on the background and surfaces when the accent is too
faint.

When you set `background`, the palette is yours in every theme and the remaining surfaces are
derived from it. With the default `system` theme, Loquent then picks the theme that matches
your background's scheme (Graphite for a light one, Midnight for a dark one). In any theme,
the roles a theme would otherwise supply for its own scheme are derived for your surfaces:

- `focus-ring` at least **3:1** on the background and surfaces;
- without an `accent`, the theme's accent, stepped to **4.5:1** (it is also link text);
- `success`, `warning` and `danger` from Graphite's values on a light background (Graphite
  Dark's on a dark one), stepped to at least **4.5:1**;
- code keeps the theme's syntax colours only while each holds 4.5:1 on the derived `code-bg`;
  otherwise code blocks fall back to `text` and `text-muted`.

Readable text is enforced for derived colours: `text` and `text-muted` are stepped to at least
**4.5:1** on the background, `bg-subtle`, the surfaces and `code-bg`, and `text-subtle` to at
least **3:1**. A colour you set explicitly is kept, with a console warning if it falls below
its floor.

### Previewing a theme

`/?theme=<id>` previews a theme without changing any setting. It is honoured only when the id
is in the server's allowed `themes`, it is never stored, and reloading without it returns to
the normal choice. It is meant for previews and screenshots.
