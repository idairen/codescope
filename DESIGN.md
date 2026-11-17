# CodeScope design context

## Scope and ownership

The standalone Business Flow report is an offline developer tool. Its canonical UI is `skills/business-flow/assets/report.html` (styles and native controls), `viewer.js` (SVG interactions), and `locales.json` (all interface text). The React application's styles and components remain separate because the skill must work without the application or a build step. Native buttons, selects, and checkboxes accept platform geometry and provide keyboard operation.

## Visual language

Runtime CSS is the source of truth; this document records its intent rather than generating tokens. Preserve the existing dark canvas (#10141c), panel surface (#151b25), system fonts, and restrained borders. Process nodes use lavender, data uses teal, and rules use amber. Red remains reserved for impact, with solid and dashed outlines distinguishing direct and indirect effects. Playback uses a white traveling marker and a heavier edge, retaining impact colors.

## Layout and interaction

A spherical projection provides the default overview. Playback follows one source-supported directed path from an explicit entry or a topological root. It is a demonstration, never execution evidence. Clicking a node pauses playback, selects both directions, and uses the existing label-aware layout for inspection. Direction and depth controls can then narrow the view. The evidence sidebar remains alongside the canvas on desktop and below it on narrow screens. No network assets or fonts are required.

## Motion and accessibility

Provide explicit pause/resume and random-entry controls. Pause on selection, drag, hidden document, or a newly enabled reduced-motion preference. Reduced motion starts paused; explicit playback advances discrete steps without rotating the sphere or moving the particle. SVG nodes support Enter and Space. Status messages and control labels follow the report locale; source symbols remain unchanged. Live status updates occur on path steps, not animation frames.

## Verification

`tests/business-flow/viewer.test.mjs` exercises interactions with a simulated DOM; Python tests validate and render the offline report. These checks do not prove browser rendering. Inspect overview, focused rules, impact colors, keyboard navigation, long labels, mobile layout, and reduced motion in a real browser when available.

| Capability     | Canonical owner                             | Source of truth                           | Allowed variants    | Verification                                               |
| -------------- | ------------------------------------------- | ----------------------------------------- | ------------------- | ---------------------------------------------------------- |
| Select/Listbox | Native HTML select in the standalone report | `skills/business-flow/assets/report.html` | Direction and depth | Simulated DOM tests; browser keyboard verification pending |
