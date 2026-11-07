# Design notes

How this page looks, why it looks that way, and which current work it is answering.

The brief was blunt: *"take the UI to a whole new level, leave the generic AI theme behind."* The
generic AI theme is easy to name — near-black canvas, a violet-to-cyan radial glow behind the hero,
frosted-glass cards, Inter at 400/600, and a gradient-blurred blob somewhere in the background. It
signals "AI product" and nothing else. It also makes every page look like every other page.

So the target was the opposite: **a printed field guide that happens to run in a browser.**

---

## The reference set

These are the pieces the design is actually answering. Each line is what was taken from it, not just
that it looks good.

| Reference | What was taken |
|---|---|
| **[siena.film](https://siena.film)** (Siena Film Foundation) — the strongest editorial/magazine site of 2024–26 | Asymmetric page rhythm and a serif display face used at magazine scale. Section numbers as real navigational furniture (`§ 00` … `§ 05`), hairline rules doing the work that borders and shadows normally do, and a lot of deliberate empty space at the top of a section. |
| **[Mat Voyce](https://matvoyce.tv)** — Awwwards Site of the Year nominee, 2025 | Kinetic typography that is *load-bearing*: the headline splits into words that rise into place, and display type is allowed to be enormous because it is the content, not decoration around it. Type is also allowed to be the only image on the page. |
| **[Kinetic typography technique index](https://studiomeyer.io/en/blog/kinetische-typografie)** | Concretely: split-text word reveals with a stagger, scroll-triggered reveals, and variable-font axes used for expression rather than novelty. |
| **[Lusion](https://lusion.co)** | Cited everywhere as the restraint benchmark: motion that is smooth and exact, and that stops. Nothing here animates on a loop "for life" — the marquee is the only continuous motion on the page and it is deliberately slow. |
| **[2026 trend survey — Falling Brick](https://www.fallingbrick.co.uk/web-design-trends/)** | Native CSS where CSS can do the job (scroll-driven reveals are IntersectionObserver, but the glow/gradient/blur stack is gone entirely), and brutalism / anti-design as an explicit counter to the AI aesthetic. |
| **[Envato: what's next in web design](https://elements.envato.com/learn/web-design-trends)** | "Motion must earn its place." Decorative loaders and idle animation were dropped; every transition here either establishes hierarchy or explains state. |
| **[Type Tasty — subjective UI, 2026](https://typetasty.com/2026/04/02/web-design-trends-2026-subjective-ui-typography/)** | Tactile digital: grain, paper tones, texture instead of flat fills. The grain layer is 3.5% opacity and is the difference between "beige" and "paper". |
| **[Award-site survey, 2025–2030](https://github.com/coroboros/research/blob/main/articles/award-winning-websites-2025-2030/award-winning-websites-2025-2030.md)** | The archetype scoring: Awwwards weights Design 40 / Usability 30 / Creativity 20 / Content 10. A distinctive identity without usability is not a 7.5+. That is why every motion here degrades to a static state. |
| **[Best award-winning websites, 2026](https://www.hontran.dev/blog/best-award-winning-websites-2026)** | Jurors reward *one signature interaction* over many small ones. The signature here is the token chip: it is a contiguous slice of your own text, it stamps in, and clicking it explains itself. |

---

## What the page is made of

**Palette.** Warm paper, ink, and a single vermilion signal. No blue-purple, no neon, no gradient mesh.
Six muted tints (`--chip-1` … `--chip-6`) mark token boundaries instead of six saturated UI colours.
The dark theme is "Night Press" — warm near-black paper with the same ink and signal, not an invert.

**Type.** Three self-hosted variable faces, no CDN:

| Role | Face | Notes |
|---|---|---|
| Display | [Fraunces](https://fonts.google.com/specimen/Fraunces) | Full variable font — `opsz`, `SOFT`, `WONK`, `wght`. Headlines run at `opsz 140` with `WONK 1` for the editorial sway; **numerals run at `opsz 26`**, because above ~100 the comma in `50,257` renders as a full stop and the `4` opens up. |
| Text | [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | Set on a fluid scale from `--t-display` down to `--t-micro`. |
| Data | [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) | Every ID, score, offset and label. Tabular figures, so columns of numbers line up. |

All three are SIL OFL; licences are in `assets/fonts/`. Total added weight: **183 KB** of woff2.

**Pages, not one long scroll.** The guide is six documents. The landing page carries the hero, the
pipeline diagram and the chapter list — and downloads nothing at all. Each chapter is one idea with
the same three-part shape: a two-sentence explanation, a *try this* list, the demo, then a *what
you're looking at* note. The masthead, chapter index and colophon are identical on every page (there
is no build step to share a partial, so `tests/structure.test.js` compares the chrome across all six
and fails if one drifts). Every chapter ends with a pager, so a reader never dead-ends.

**Structure.** A masthead and sticky bar; an editorial hero whose headline is split into words; a
four-stage pipeline diagram (`text → tokens → ids → vector`) drawn with hairlines and mono captions; a
full-bleed marquee of `·`-marked phrases; then a two-column body — a sticky numbered index on the left
that tracks your position and fills a progress rule, and the six sections on the right, each opened by
a hairline header. The footer is a colophon, because that's what a printed guide has.

**Details.** Near-square 1–3 px radii (nothing is a pill), hard offset shadows on buttons instead of
soft glow, corner ticks on every results plate, `·` for spaces and `⏎` for newlines, dashed outlines
for byte-fallback fragments, and a real `§` numbering scheme.

---

## Motion rules

1. **Nothing animates unless it means something.** Reveals explain reading order; the chip stamp
   explains that a token occupies a contiguous slice; the progress rule explains where you are.
2. **One continuous motion only** — the marquee, at 60 s per cycle, pausable on hover.
3. **Enter once.** Reveals and count-ups fire a single time and then stop being observed.
4. **The state change is the animation.** Theme switching uses the View Transitions API to wipe in a
   circle from the toggle and falls back to an instant swap.
5. **Stagger by index, cap the stagger.** Chips animate with `--i`, clamped at 30, so a 2,000-token
   paragraph doesn't take a minute to appear. Typing never triggers the stamp — only a deliberate
   action (button, or a sample) does.
6. **`prefers-reduced-motion` ends it.** Reveals show immediately, counters jump to their final value,
   the marquee stops, the view transition is skipped.
7. **Content is never hidden behind JS.** `.reveal` only becomes invisible after `reveal-ready` is set
   on `<html>` by the script that is about to un-hide it; in-view elements are revealed synchronously
   before the class is applied. A script that fails to load leaves a fully readable page.

---

## Accessibility, as a constraint rather than a patch

- Contrast on paper: ink 15.7:1, secondary ink 6.4:1, micro-labels 4.7:1, the vermilion signal
  4.7:1 (6.7:1 on night paper). Every text colour clears WCAG AA for its size.
- The token chip row is **one** tab stop with roving focus; `←`/`→` and `Home`/`End` move between
  chips.
- Every dynamic result is announced through a single `aria-live="polite"` region (`#sr-live`).
- Focus is never removed — `:focus-visible` gets a 2 px vermilion outline with a paper offset.
- The rail is a real `<nav>` with `aria-current="true"` tracking the section in view.

---

## What was deliberately not built

Scroll-jacked sections, custom cursors, a preloader, WebGL, GSAP, a physics engine, parallax on
everything, and animated gradients. All of them are in the 2026 trend lists, and each one costs a
dependency, a jank budget, or accessibility — for effect this page doesn't need. The whole motion
layer is ~166 lines of vanilla JS in `src/lib/motion.js` with no runtime dependency at all.
