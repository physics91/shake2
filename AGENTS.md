# Shake2 restoration

Browser remake of AOZORA's Shake2 (reference build `Shake0311_20020323`). Code in `game/`, extraction tools in `tools/`, reverse-engineering record in `original/FIDELITY.md`.

## UI/UX: Shake2 only

Source: user instruction, 2026-09-29.

- Every visible screen is a Shake2 screen: original art from the extracted assets, drawn on the game canvas at the reverse-engineered coordinates, with the original input, sounds and fades. This includes the entry point: the app opens into the Shake2 start flow (logo → loading → login), not a web menu.
- Do not add visible web UI (headings, paragraphs, buttons, forms, links, styled panels) around or over the canvas.
- Assistive DOM is allowed only when visually hidden (screen-reader text, live regions, keyboard mirrors of on-canvas controls). It mirrors actions the canvas already offers (one control may stand for a sequence of them, such as logging in and choosing the server row); it adds no game feature of its own. The server address field is the one setting kept there, since no Shake2 screen holds it.
- A remake-only feature (for example two players on one keyboard) reuses an existing Shake2 screen and its art, and gets an R row in `original/FIDELITY.md`.
- Where 0311 code expects a screen whose art it lacks (scene 5, the "My Status" menu), use the matching art from another Shake build (Shake1 `status.shk`) and grade it R.
- Exceptions: developer tools reached only by direct URL (`#/viewer`), and the plain-text notice shown when the assets fail to load (no original art can be drawn then).
