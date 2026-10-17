# Greenfield UX Evaluation Plan

The greenfield client is evaluated with a layered approach:

1. **Task success:** sign in, resume an audit, mark an item, filter gaps, use the buy list, reload, and sign out.
2. **Heuristics:** visibility of system status, user control, consistency, error prevention, recognition over recall, flexibility, minimalism, and recovery.
3. **Accessibility:** semantic landmarks, accessible names, visible focus, keyboard operation, color-independent status labels, and axe-core checks when browser tooling is available.
4. **Responsive behavior:** desktop, tablet, and 390px mobile; no horizontal overflow and no loss of the primary action.
5. **Reliability:** server-authoritative reads, targeted mark writes, optimistic feedback, error recovery, and persistence after reload.
6. **Performance:** measure first usable render and mark-save latency; avoid full-state rewrites for single-item actions.

## Browser agent checklist

- Capture a screenshot and accessibility snapshot at every route.
- Check the console after navigation and interactions.
- Run the same journey at desktop and mobile widths.
- Verify a mark through a fresh server read, not only the DOM.
- Test an empty buy list and a populated buy list.
- Test failed requests and confirm the user receives a usable recovery state.
- Record each finding with severity, URL, steps, expected result, actual result, and evidence.

## MCP integration points

- **Figma MCP:** future source of truth for tokens and component intent.
- **Storybook MCP:** future component stories, interaction tests, and accessibility checks if the app moves to a component framework.
- **Playwright/browser MCP:** real task execution, screenshots, console, network, and responsive checks.
- **axe MCP or axe-core:** automated accessibility regression checks.
- **Project UX resource:** this file and `DESIGN_SYSTEM.md` are the local context the evaluator should read before judging the product.
