# FSP design and requirements review

Sources reviewed: the supplied `ФСП.zip` (special-track requirements PDF and presentation template) and `брендбук.rar` (official FSP artwork, JetBrains Mono 2.304, map and line motifs).

The requirements, section 4, allow design freedom and ask for a quality interface in the FSP palette. The presentation template has its own event palette (Montserrat and pink/purple); it is intended for the submission slides. The web design follows the FSP artwork archive instead.

## Design decisions

- Exact colors embedded in the official SVGs: blue `#402FFF`, graphite `#1B1C21`, light gray `#EDEDED`, gray `#C8C9CA`, red `#EC1D35`.
- Local JetBrains Mono webfonts from the archive; no external font requests.
- Official `logo_02w.svg` on light backgrounds and `logo_01.svg` on graphite backgrounds, with their original colors, proportions and paths preserved. The existing compact favicon remains in place.
- Supplied wireframe portrait, map and connecting line artwork; restrained outlined frames and node accents derived from the supplied example.
- Shared typography, cards, headers and controls apply the identity across both role workspaces, login, registration and public pages. Semantic status colors remain distinct for readable feedback.
- No simulated candidate metrics, achievements or company offers in the marketing artwork.

## Requirements reflected in the interface

| PDF requirement | Design treatment |
| --- | --- |
| Employer-initiated contact is the primary mechanic (§2; 35% scoring weight) | Hero copy and three-step flow emphasize employer invitations. |
| Category comes from survey and grade testing (§2) | Public journey explains profile, specialization, chosen grade and confirmed level. |
| Salary is mandatory and visible before contact (§2.2) | Hero and final journey step explicitly mention salary and terms. |
| No FSP history must be handled (§2) | Trust section explains that candidates without FSP history can still qualify. |
| Separate processing/publication consent and role-based visibility (§2.1, §3.5) | Privacy copy explains anonymized profiles and separate publication consent; existing consent and access controls remain. |
| Two distinct role workspaces (§2.1) | Separate candidate/employer registration actions remain clear. |
| Readability, contrast and intuitive paths (§6.3) | Strong light/dark hierarchy, visible keyboard focus, responsive role cards and menu. |

This is a source and interface review, not a new certification of every backend requirement. The existing requirements matrix describes the implementation; database-dependent flows still require a configured hosted API. A Vercel-only frontend does not satisfy the full deployed end-to-end demonstration requirement (§3.3).
