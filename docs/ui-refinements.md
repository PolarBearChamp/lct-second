# UI refinements from screenshot review

The review used `menu.jpg`, `mobile.jpg`, `chips.jpg`, `button.jpg`, `salary.jpg`, `buttons.jpg`, `grades.jpg` and `drag.jpg` supplied by the user.

- During an assessment, workspace navigation is hidden and the runner gets the full content width. Outside an assessment, desktop navigation can be collapsed from the header; the existing mobile menu opens as a vertical list.
- Ordering questions support dragging by the handle with mouse or touch, arrow buttons, and keyboard ArrowUp/ArrowDown on the handle. Reordering uses the existing answer/autosave path. Cancelled gestures and drops outside the list do not change the answer. Expired/finishing attempts disable the control.
- Available grades in results link to the corresponding level and specialization in the assessment overview. The target card is highlighted; starting a timed attempt still requires explicit confirmation. Locked levels retain their server-provided dates and messages.
- Need and vacancy lists reserve a salary column on wide screens and a separated salary area on narrow screens. Chips wrap inside the description column instead of moving the salary between rows.
- FSP achievement descriptions and relevance badges occupy separate layout areas. Company verification aligns its action with the input rather than the hint. Vacancy prerequisite actions wrap with a consistent gap.
- Shared buttons have visible hover, pressed and focus states, while disabled controls do not react to pointers.
- The public journey switches between concrete candidate and employer workflows, retaining the supplied FSP typography and colors.

## Verification

After building the frontend, run `pnpm --filter @fsp/e2e test:ui` for isolated frontend regression checks. The suite starts a local test-only auth fixture and mocks browser API responses; no real accounts or database are needed. It covers mouse/touch reordering and saved payloads, keyboard ordering, menu visibility, grade navigation, salary columns with many chips, mobile overflow, and verification button alignment/hover.

Run `pnpm --filter @fsp/e2e test:ux` against a running frontend for public registration and password controls. Full backend integration tests require the normal database and API infrastructure; these frontend tests do not certify the live backend.
