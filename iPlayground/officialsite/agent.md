# Agent Rules: Sponsor Sections

## Scope

This file documents the current styling contract for the sponsor-related sections in `index.html` and `css/main.css`.

When changing these sections, keep edits tightly scoped. Do not change unrelated sections, shared section styles, speaker styles, staff styles, or global dark-mode rules unless the user explicitly asks for that exact change.

## Corporate Sponsors (`#sponsors`)

Markup boundary:

- Section id: `#sponsors`
- Section class: `.section-sponsors`
- Content container: `#sponsorTiers`
- Tier row: `.sponsor-tier-row`
- Tier classes:
  - `.sponsor-tier-diamond`
  - `.sponsor-tier-gold`
  - `.sponsor-tier-silver`
  - `.sponsor-tier-bronze`
- Logo card: `.sponsor-logo-card`

Current visual rules:

- The full `#sponsors.section-sponsors` section must use a light background: `#eef1f4`.
- This light background must also apply in dark mode using `html[data-mode="dark"] #sponsors.section-sponsors`.
- Sponsor section text should be dark: `#111111`.
- The `.wrap` inside `#sponsors` should stay transparent.
- Tier rows must not have their own background, border, or shadow.
- Tier labels are centered between horizontal lines.
- Tier label text is dark.
- Tier rank icons use `--tier-color`.
- Tier colors:
  - Diamond: `#6dd5ff`
  - Gold: `#f2c14e`
  - Silver: `#c8d0da`
  - Bronze: `#c98a57`
- Sponsor logo cards keep a light gray border and transparent background.
- Sponsor logo grid behavior:
  - 1 sponsor: one full-width column
  - 2 sponsors: two equal columns
  - 3 sponsors: three equal columns
  - 4+ sponsors: max four columns per row
  - mobile: two columns

Do not:

- Do not use `.speaker-*` or `.staff-*` selectors for corporate sponsors.
- Do not move personal sponsor rules into the `#sponsors` block.
- Do not remove the light section background unless explicitly asked.
- Do not add dark backgrounds to sponsor tier rows.

## Personal Sponsors (`#personalSponsors`)

Markup boundary:

- Section id: `#personalSponsors`
- Section class: `.section-personal-sponsors`
- Grid id: `#personalSponsorGrid`
- Card class: `.personal-sponsor-card`
- Photo class: `.personal-sponsor-photo`
- Meta class: `.personal-sponsor-meta`
- Name class: `.personal-sponsor-name`
- Role class: `.personal-sponsor-role`

Current visual rules:

- The full `#personalSponsors.section-personal-sponsors` section uses the same light background as corporate sponsors: `#eef1f4`.
- Personal sponsor title/eyebrow/meta text should be dark: `#111111`.
- Personal sponsor cards must use only `.personal-sponsor-*` classes.
- Personal sponsor cards must not use `.speaker-card`, `.speaker-photo`, `.speaker-card-meta`, `.speaker-name`, or `.speaker-role`.
- Personal sponsor cards are not clickable.
- The current sample person is Hokila, using `img/staff/staff_hokila.jpg`.
- The personal sponsor card currently uses a circular avatar style with a dark border.
- The personal sponsor label/badge has been removed.

Do not:

- Do not reuse speaker card classes for personal sponsors.
- Do not add click behavior unless explicitly requested.
- Do not add the removed sponsor badge back unless explicitly requested.
- Do not change corporate sponsor styles when changing personal sponsors.

## Change Discipline

Before editing:

- Inspect the relevant selector block in `css/main.css`.
- Make the smallest possible selector-scoped change.
- Prefer `#sponsors ...` for corporate sponsor edits.
- Prefer `#personalSponsors ...` or `.personal-sponsor-*` for personal sponsor edits.

After editing:

- Run `git diff -- index.html css/main.css agent.md`.
- Verify the diff does not contain unrelated sponsor/personal-sponsor cross-edits.

