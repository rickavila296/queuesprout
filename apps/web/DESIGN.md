---
name: QueueSprout Publisher
description: A calm operations studio for freelancers and small agencies who publish for several clients.
colors:
  pine: '#182b25'
  pine-hover: '#223a32'
  pine-border: '#2a443b'
  pine-text: '#b9c7bf'
  pine-strong: '#f6f5ef'
  lime: '#d1f279'
  paper: '#f6f5ef'
  stone: '#e7e8e0'
  stone-hover: '#dee0d6'
  sheet: '#ffffff'
  rule: '#d9dbd1'
  control-edge: '#737f78'
  ink: '#182b25'
  ink-muted: '#55635c'
  selected: '#e9f2c9'
  link: '#2f5d46'
  success: '#2f6b3f'
  success-tint: '#e1eee2'
  info: '#2d5b8a'
  clay: '#c97958'
  clay-text: '#9a4f33'
  danger: '#b42318'
  night-pine: '#0b1411'
  night-ground: '#101b17'
  night-stone: '#18261f'
  night-sheet: '#1c2b24'
  night-rule: '#2c3b34'
  night-control-edge: '#6b7a72'
  night-ink: '#eceee6'
  night-ink-muted: '#a3ada6'
  night-link: '#c5e37a'
  night-clay: '#e0997a'
  night-danger: '#f07a6e'
typography:
  display:
    fontFamily: 'Archivo, Geist, system-ui, sans-serif'
    fontSize: '22px'
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: '-0.01em'
  title:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '22px'
    fontWeight: 600
    lineHeight: 1.25
  heading:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '16px'
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: 'Geist, Inter, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.5
  time:
    fontFamily: 'Geist Mono, ui-monospace, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: '6px'
  md: '8px'
  lg: '12px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '16px'
  lg: '24px'
components:
  button-primary:
    backgroundColor: '{colors.pine}'
    textColor: '{colors.paper}'
    rounded: '{rounded.sm}'
    height: '32px'
    padding: '0 12px'
  button-secondary:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    height: '32px'
  button-secondary-hover:
    backgroundColor: '{colors.stone-hover}'
  button-danger:
    backgroundColor: '{colors.danger}'
    textColor: '{colors.sheet}'
    rounded: '{rounded.sm}'
  input:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    height: '32px'
  nav-item:
    textColor: '{colors.pine-text}'
    rounded: '{rounded.sm}'
    height: '32px'
  nav-item-active:
    backgroundColor: '{colors.pine-hover}'
    textColor: '{colors.lime}'
  client-chip:
    backgroundColor: '{colors.lime}'
    textColor: '{colors.pine}'
    rounded: '{rounded.sm}'
    size: '20px'
  calendar-chip:
    backgroundColor: '{colors.sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sm}'
    height: '24px'
---

# Design System: QueueSprout Publisher

## Overview

**Running order.** QueueSprout borrows from a broadcast rundown: the sheet a producer reads to know what goes out next, for whom, and whether it is cleared. Every list of work reads in the same order: time, client, slug (the first line of the post), stage, status. The "now" line, today's date in the calendar, is the one place the eye lands first.

The tone is calm and operational. A freelancer juggling several clients should feel in control, never alarmed. The interface is dense where the work is (calendars, lists) and quiet everywhere else. Decoration is not added; hierarchy comes from type, rules and the pine shell.

The look rests on three things:

1. **A pine shell.** The sidebar is a deep pine band that holds identity and navigation. The working ground beside it is warm paper.
2. **Lime is a signal on pine, never on paper.** Lime marks the active nav item, the client chip and selection, and nothing else.
3. **Status is said in words.** An icon and a colour repeat a status label; they never replace it.

A workspace in the data model is shown to people as a **client**. Only interface copy says "client". Routes, schema and APIs keep `workspace`.

## Colors

Tokens live in `packages/ui/src/tokens.css` and map to Tailwind utilities in `packages/ui/src/styles.css` (`bg-shell`, `text-muted`, `border-border-control` and so on). Components use the semantic utilities, never raw hex.

### Primary

- **Pine** (`#182b25`, `--shell`, `--primary`, `--text`): the shell, primary buttons and body text. It is one colour doing three jobs, which keeps the palette small.
- **Lime** (`#d1f279`, `--accent`): active navigation, the client chip, text selection and the focus ring on pine. Lime on pine is 11.8:1. Lime on paper is 1.15:1, so lime never carries text, icons or edges on the light ground. In dark mode lime is also the primary button fill, with pine text.

### Secondary

- **Clay** (`#c97958`, `--attention`): anything that needs a person, such as awaiting approval or a post whose time has passed. Clay on paper is only 3.0:1, so clay words use `--attention-text` (`#9a4f33`, 5.4:1). The base clay is for edges and marks only.

### Neutral

- **Paper** (`#f6f5ef`, `--bg`): the working ground.
- **Stone** (`#e7e8e0`, `--surface`): panels, form groups, days outside the month shown.
- **Sheet** (`#ffffff`, `--surface-raised`): inputs, calendar chips, menus. A sheet sits on paper the way a card sits on a desk.
- **Rule** (`#d9dbd1`, `--border`): dividers and container edges. **Control edge** (`#737f78`, `--border-control`, 3.8:1 on paper) outlines inputs and secondary buttons so they pass the 3:1 non-text contrast rule.
- **Ink muted** (`#55635c`, `--text-muted`): secondary text, 5.8:1 on paper and 5.1:1 on stone.

Status colours: success `#2f6b3f`, info `#2d5b8a`, danger `#b42318`. Each has a dark-mode value in `tokens.css`.

### Named Rules

- **Lime lives on pine.** If lime would touch paper, use pine instead.
- **Words carry the meaning.** Every status colour sits next to its label.
- **AA or it doesn't ship.** Every text pair is at least 4.5:1, and every control edge at least 3:1, in both themes. The values above were checked on rendered pages.

### Dark mode

Dark mode is set with `<html data-theme="dark">` before paint. The ground becomes night pine (`#101b17`), the shell goes darker still (`#0b1411`), and lime becomes the primary action colour. In dark mode the shell recedes into the ground on purpose; the rule between them and the lime active item keep the structure readable.

## Typography

- **Geist** is the working face for every interface word, at a 14 px base.
- **Archivo**, a variable face set semi-condensed (`font-stretch: 88%`), is the display face. It is used only for the calendar's date line, report titles and marketing headlines (`.font-display`). It reads like a rundown's caption strip. It is self-hosted from `apps/web/src/fonts/` under the SIL Open Font License.
- **Geist Mono** is used for times in the calendar and list, with tabular figures, so a column of times lines up.

### Hierarchy

| Role    | Size                                             | Weight | Use                                             |
| ------- | ------------------------------------------------ | ------ | ----------------------------------------------- |
| Display | Archivo, 28 px on marketing, 18–22 px in the app | 600    | Calendar range, landing headline, report titles |
| Title   | 22 px Geist                                      | 600    | Page titles (Channels, Members)                 |
| Heading | 16 px                                            | 600    | Section headings                                |
| Body    | 14 px                                            | 400    | Everything else                                 |
| Small   | 12–13 px                                         | 400    | Meta lines, hints, chips                        |

### Named Rules

- **One display line per screen.** Archivo marks the headline of a screen, never a section inside it.
- **No eyebrows.** No small all-caps kicker above a heading.
- **Times are mono.** Anything a person scans down a column (times, counts) uses tabular figures.

## Layout

- The app frame is a 240 px pine sidebar plus a fluid working area. Below `md` (768 px) the sidebar becomes a sheet that opens from a menu button, and the header keeps the client name.
- The working area is padded 16 px on mobile and 24 px from `md`. Reading pages (channels, members, a post) are capped at `max-w-3xl`; the calendar takes the full width.
- Spacing steps are 4, 8, 16 and 24 px. Lists separate rows with rules, not gaps.
- No page scrolls sideways at 390 px. This was checked on every app page in both themes.

## Elevation & Depth

The design is flat. Depth comes from the paper, stone and sheet layers, not from shadow. The only shadow is `shadow-md` on things that float above the page: the client switcher and the user menu. Modals use a 40% black scrim.

## Shapes

Radii are small and practical: 6 px for buttons and chips, 8 px for inputs, panels and menus, 12 px for large containers. Status icons are lucide line icons at 14 px. There are no pill buttons and no decorative shapes.

## Components

- **Sidebar (shell).** Pine band, logo mark in lime, a client switcher, then the navigation: Calendar, Channels, Media, Members, Settings (marked Soon until it exists). The active item is a pine-hover fill with lime text and `aria-current="page"`. Calendar stays active while composing or opening a post from it.
- **Client switcher.** A `<details>` disclosure on the shell, showing the current client's initial in a lime chip. The list is labelled "Clients", marks the current client with a check and `aria-current`, and ends with "New client".
- **Buttons.** Primary is pine (lime in dark). Secondary is a sheet with a control edge. Ghost is text only, for quiet row actions. Danger is red, used only to confirm destructive actions.
- **Inputs.** Sheet fill, control-edge border, 8 px radius, 32 px tall.
- **Status.** One vocabulary everywhere (`apps/web/src/components/post-status.tsx`):

  | Status                         | Label                          | Icon          | Tone    |
  | ------------------------------ | ------------------------------ | ------------- | ------- |
  | draft                          | Draft                          | circle-dashed | muted   |
  | pending_approval               | Awaiting approval              | hourglass     | clay    |
  | scheduled                      | Scheduled                      | clock         | info    |
  | queued, publishing, processing | Queued, Publishing, Processing | loader-circle | info    |
  | published                      | Published                      | circle-check  | success |
  | failed                         | Failed                         | circle-alert  | danger  |
  | cancelled                      | Cancelled                      | circle-slash  | muted   |
  | scheduled, time passed         | Waiting to send                | clock-alert   | clay    |

  `PostStatusDot` shows icon plus label. `PostStatusIcon` is the icon alone, for calendar chips, where the chip's accessible name carries the label.

- **Calendar chip.** A sheet on the day cell: status icon, mono time, channel, first line. At least 24 px tall. The ⋯ move button is revealed on hover where there is a pointer, and is always shown on touch.
- **Today.** Today's date in the calendar is a pine tag with paper text (lime with pine text in dark), the running order's "now" line.
- **Focus.** A 2 px ring offset 2 px, pine on paper and lime on the shell and in dark mode.

## Do's and Don'ts

**Do**

- Say "client" in interface copy, and keep `workspace` in code and URLs.
- Pair every status colour with its label.
- Use the semantic utilities (`bg-surface`, `text-muted`, `border-border-control`) so dark mode follows.
- Label sample data as sample data, in the client name and in the post text.
- Check new colour pairs on a rendered page in both themes.

**Don't**

- Put lime on paper, or use lime for anything but signals on pine.
- Dim text further with opacity on top of a muted colour or a stone surface. That is how the out-of-month day numbers fell to 2.4:1 before this system fixed them.
- Use a coloured left border thicker than 1 px as an accent, or a kicker above a heading.
- Add shadows to cards. Only floating menus get one.
- Show made-up figures as if they were a real client's results.
