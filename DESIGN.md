---
name: ktv-proxy
description: Phone remote for a KTV box; zinc neutrals, one user-chosen accent, soft tactile controls.
colors:
  accent: "#ec4899"
  accent-blue: "#3b82f6"
  accent-green: "#22c55e"
  accent-amber: "#f59e0b"
  accent-violet: "#8b5cf6"
  queue-sky: "#0ea5e9"
  error-red: "#ef4444"
  paper: "#fafafa"
  ink: "#18181b"
  night: "#09090b"
  night-ink: "#f4f4f5"
  surface-light: "#ffffff"
  surface-dark: "#18181b"
  field-light: "#e4e4e7"
  field-dark: "#27272a"
  muted: "#71717a"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  button-queue:
    backgroundColor: "{colors.queue-sky}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  input:
    backgroundColor: "{colors.field-light}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  popover:
    backgroundColor: "{colors.surface-light}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: ktv-proxy

## Overview

**Creative North Star: "The Party Remote"**

Big friendly tap targets, one bright accent, quick to scan in a dim room. The canvas is quiet zinc so the song list and the accent do the talking. Controls feel soft and tactile: rounded, they lift on hover and squish on press.

Light and dark are both first-class; dark follows the system by default.

**Key Characteristics:**
- Zinc neutrals with a single user-selectable accent (pink, blue, green, amber, violet).
- Rounded-xl controls with lift and press feedback.
- Small uppercase section labels over dense, wrapped Chinese/English song text.
- Popovers float over the list (`rounded-2xl`, ring, shadow).

## Colors

Neutral zinc canvas, one runtime accent, sky blue reserved for queue actions.

### Primary
- **Party Pink** (#ec4899): default accent, exposed as `--accent`. Primary buttons, focus rings, brand title. User can swap it in Settings.

### Secondary
- **Queue Sky** (#0ea5e9): "play next / queued" actions and queue badges. Stays fixed when the accent changes.

### Neutral
- **Paper / Night** (zinc-50 / zinc-950): page background.
- **Surface** (white / zinc-900): popovers and dialogs, with a 10% black/white ring.
- **Field** (zinc-200 / zinc-800): inputs and hover fills.
- **Muted** (zinc-500): secondary text, labels, empty states.
- **Error Red** (red-500): inline errors.

### Named Rules
**The One Accent Rule.** Only `--accent` changes with user choice; never hard-code pink for brand elements. (The favourite heart is the one pink exception.)

## Typography

**Font:** Tailwind default system sans stack; no custom font.

**Character:** Utilitarian and legible; hierarchy comes from weight and size, not family.

### Hierarchy
- **Title** (700, 1.5rem): app name on the connect screen.
- **Song title** (500, base, snug leading): wraps rather than truncates.
- **Meta** (400, base/sm, zinc-500): artist, language.
- **Label** (600, 0.75rem, wide tracking, uppercase, zinc-500): section headings in popovers.
- **Tiny** (600, 9-10px, uppercase): queue badges.

## Layout

Single column, mobile-first. Lists are one column, becoming two at `xl`. Singer grids go 3 to 6 columns by breakpoint. Connect screen is centered, `max-w-md`. Popovers are full width on phones and anchored panels on `md+`. Spacing rhythm is Tailwind's 2/3/4 steps (8/12/16px).

## Elevation & Depth

Mostly flat. Depth comes from rings (1px 10% black/white) and `shadow-xl` on popovers. Primary buttons gain an accent-tinted glow shadow on hover.

## Shapes

Rounded-xl (12px) for buttons and inputs, rounded-2xl (16px) for popovers, rounded-lg (8px) for list rows, full for avatars and chips.

## Components

### Buttons
- **Shape:** 12px radius.
- **Primary:** accent fill, white text, semibold, `px-4 py-3`.
- **Queue:** sky fill, stacked icon and label.
- **Hover / Press:** lift `-0.5` and brightness 110%, tinted shadow; press scales to 90-95%.

### Inputs / Fields
- Zinc-200/800 fill, 12px radius, no border; focus is a 2px accent ring.

### Popovers
- White/zinc-900, ring, `shadow-xl`, `animate-pop` (150ms, 6px drop + 2% scale).

### Favourite heart
- Pop-in (350ms) and burst (600ms) animations, disabled under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** use `bg-accent` / `text-accent` for brand color.
- **Do** keep tap targets at least 44px on phones.
- **Do** wrap long song text (`break-words`) instead of truncating.

### Don't:
- **Don't** add a second user-facing accent; sky is for queue only.
- **Don't** introduce custom fonts or heavy shadows.
