# Shop Inventory Greenfield Design Language

This branch uses a small, explicit product language instead of importing a large visual framework. The goal is calm, fast, obvious work.

## Principles

1. **One useful decision at a time.** The primary screen shows progress and sections, not every control.
2. **Status is visible.** Every mark has a text label, color, symbol, and save feedback.
3. **The buy list is derived.** Users mark inventory; the app turns gaps into next actions.
4. **No hidden persistence.** Cloud state is authoritative and saves are reported immediately.
5. **Accessible by default.** Controls have labels, visible focus, semantic landmarks, and keyboard-operable buttons.
6. **Responsive without a separate mobile product.** The same task model works from 390px to desktop.

## Tokens

- Background: `--bg`
- Surfaces: `--surface`, `--surface-2`, `--surface-3`
- Text: `--text`, `--muted`, `--faint`
- Accent/action: `--accent`
- Warning: `--warning`
- Danger/gap: `--danger`
- Informational: `--info`
- One spacing rhythm based on 8px increments.
- Rounded surfaces with restrained shadows; borders carry hierarchy.

## Patterns

- **Overview:** progress summary → sections → search.
- **Section:** breadcrumb → section progress → status filters → checklist.
- **Item:** one large status control, one readable label, secondary metadata.
- **Buy list:** grouped by store; only actionable gaps appear.
- **Auth:** one focused form, clear recovery message, no unnecessary fields during sign-in.
- **Feedback:** optimistic local state, visible `Saving…`, then `Saved` or a spoken error announcement.

## Agent implementation rules

- Prefer visible text and accessible names over icon-only controls.
- Do not add a modal when inline content or a new route is sufficient.
- Do not make a user remember hidden modes or keyboard shortcuts.
- Preserve the current route and scroll context after a local interaction.
- Every destructive or remote action needs an observable result.
