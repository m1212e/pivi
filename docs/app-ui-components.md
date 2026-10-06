# UI components for apps

An app's screen is a tree of nodes (`UiNode`, see `src/lib/apps/ui.ts` and the
generated `app-protocol.schema.json`). Layout nodes place things. Every other
node renders one of the shell's own components, the same ones the home screen is
built from, so an app can't look different from the host. There is no way to ship
markup or styles from an app.

Selecting something either follows an `action` (a link, resolved by the host) or
fires an `onSelect` event id back to the app as a `host/uiEvent`.

| Node        | Renders             | Use it for                                                                                                                                                                            |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container` | layout only         | Rows and columns. `wrap` makes a card grid, `grow`, `sticky` (sidebars), `center` + `panel` (a focused card), `onReachEnd` (infinite scroll). A `title` adds a plain heading.         |
| `text`      | text                | Labels. Variants `display`, `headline`, `title`, `subtitle`, `body`, and `lines` to clamp.                                                                                            |
| `icon`      | `IconBadge`         | A glyph in a round badge, from a 24x24 SVG path.                                                                                                                                      |
| `spinner`   | `LoadingSpinner`    | A screen or section with nothing to show yet.                                                                                                                                         |
| `skeleton`  | `MediaCardSkeleton` | A pulsing card placeholder, e.g. below a grid that has more to load.                                                                                                                  |
| `mediaCard` | `MediaCard`         | A video, poster or round `avatar` with title, meta line, optional badge and watch progress. `stacked` draws a playlist's pile of cards.                                               |
| `shelf`     | `ContentRow`        | A titled, horizontally scrolling row of cards, with the shell's focus behavior.                                                                                                       |
| `hero`      | `HeroBanner`        | The full-width featured banner, with a Play button from its `action`.                                                                                                                 |
| `image`     | `img`               | A bare image, when a card doesn't fit.                                                                                                                                                |
| `button`    | `Button`            | Variants `solid`, `soft`, `nav` (sidebar entry, with `icon` and `selected`), sizes `sm` `md` `lg`.                                                                                    |
| `toggle`    | checkbox            | An on/off setting.                                                                                                                                                                    |
| `textInput` | text field          | One line of input, sent on submit. `search` makes it a full-width search field. `onInput` reports the text while typing and `suggestions` are offered on the TV's on-screen keyboard. |
| `list`      | layout only         | A plain vertical list.                                                                                                                                                                |

## Adding a component

Build it in `src/lib/components` first and use it on a host screen. Then expose it
by adding a node kind, in this order (the checklist is also at the top of
`ui.ts`): the `UiNode` type, its schema branch, `UI_NODE_TYPES`, the renderer in
`UiNodeRenderer.svelte`, a row in the table above, then `bun run apps:protocol`.
The node renders the real component. Never copy its classes into the renderer.
