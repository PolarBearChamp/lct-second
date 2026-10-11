# FSP design and requirements review

Sources reviewed: the supplied `ФСП.zip` (special-track requirements PDF and presentation template) and `брендбук.rar` (official FSP artwork, JetBrains Mono 2.304, map and line motifs).

The requirements, section 4, allow design freedom and ask for a quality interface in the FSP palette. The presentation template has its own event palette (Montserrat and pink/purple); it is intended for the submission slides. The web design follows the FSP artwork archive instead.

## Design decisions

- Exact colors embedded in the official SVGs: blue `#402FFF`, graphite `#1B1C21`, light gray `#EDEDED`, gray `#C8C9CA`, red `#EC1D35`.
- Local JetBrains Mono from the archive for section headings, labels and the FSP identity; system sans-serif for body copy, forms and the large public headline. No external font requests.
- Official `logo_02w.svg` on light backgrounds and `logo_01.svg` on graphite backgrounds, with their original colors, proportions and paths preserved. The existing compact favicon remains in place.
- A white public layout with a blue headline accent, fine gray dividers and direct registration actions. The actual event photograph from the archive gives the FSP section context. The wireframe portrait, decorative map and simulated code labels are not used on the public pages.
- Restrained shared cards and controls, compact corners and no card shadows. Login and registration focus on the form. The role workspaces retain a graphite FSP header. Semantic status colors remain distinct for readable feedback.
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
| Readability, contrast and intuitive paths (§6.3) | Readable body type, responsive registration actions, visible keyboard focus, and native expandable answers about privacy and qualification. |

This is a source and interface review, not a new certification of every backend requirement. The existing requirements matrix describes the implementation; database-dependent flows still require a configured hosted API. A Vercel-only frontend does not satisfy the full deployed end-to-end demonstration requirement (§3.3).
