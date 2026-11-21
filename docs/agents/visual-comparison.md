# Visual comparison

The visual lane (#257) compares 13 key screens, listed in `tests/visual-lane/screens.json` (capped at 15), each in
Arabic at 1440 and 390, light and dark, byte for byte with its images in `tests/visual-lane/images/`
(`<screen>-ar-<width>-<light|dark>.png`, no platform suffix). One browser pinned by digest draws them, so every machine
makes the same bytes. It runs on `main` only (`./ci.sh visual`); a failure there opens the `visual-regression` issue,
with the difference images in the `lane-screenshots` artifact. `tests/visual-baselines.test.mjs` fails when a screen
lacks an image or an image has no screen.

When a change intentionally alters one of those screens, one command refreshes its images: `./ci.sh visual-update`
(Docker needed). Without Docker, run the `Visual baselines` workflow on the branch and download its `visual-baselines`
artifact into `tests/visual-lane/images/`. Commit the images with the change that caused them.
