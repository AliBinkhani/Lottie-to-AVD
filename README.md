<img src="assets/icons/favicon.svg" alt="" width="72" height="72">

# Lottie → AnimatedVectorDrawable

**English** | [فارسی](README.fa.md)

### 👉 [Open the converter: alibinkhani.github.io/Lottie-to-AVD](https://alibinkhani.github.io/Lottie-to-AVD/)

[![Tests](https://github.com/AliBinkhani/Lottie-to-AVD/actions/workflows/test.yml/badge.svg)](https://github.com/AliBinkhani/Lottie-to-AVD/actions/workflows/test.yml)

A browser-based converter that turns [Lottie](https://airbnb.io/lottie/) JSON animations into Android
[`AnimatedVectorDrawable`](https://developer.android.com/reference/android/graphics/drawable/AnimatedVectorDrawable)
XML, ready to drop into `res/drawable`.

Everything runs locally in the browser. No files are uploaded anywhere.

## Features

- **Conversion**: shape, solid and precomp layers, parenting, groups, transforms (position, rotation,
  scale, anchor point), fills and strokes, linear and radial gradients, Trim Paths, ellipse /
  rectangle / star shapes, and track mattes and masks (as `<clip-path>`).
- **Faithful timing**: keyframes become `objectAnimator`s, and Lottie easing curves become
  `pathInterpolator`s. Properties with no direct AVD equivalent are sampled and simplified into
  linear keyframes, so the output stays fully vector.
- **Compact output**: exact animators wherever possible (straight motion paths, step changes such
  as layer in/out points), shared parent groups, one visibility toggle per layer, and sampled
  properties simplified with a sub-pixel tolerance.
- **Live comparison**: the original Lottie (via lottie-web) and the generated AVD (via a built-in
  emulator) play side by side or overlaid with a difference blend.
- **Conversion report**: lists unsupported features (masks, mattes, text, images, gradients,
  dashes, expressions and more).
- **Editable output**: edit the XML, re-run it in the preview, then copy or download it.
- **Bilingual UI**: English (default) and Persian with full RTL support. The choice is remembered,
  and `?lang=fa` / `?lang=en` in the URL overrides it.
- **Works offline**: lottie-web and the fonts are bundled, with no CDN dependencies.

## Getting started

The app is plain HTML, CSS and ES modules, so there is no build step. Browsers don't load ES modules
from `file://` URLs, so serve the folder with any static web server:

```bash
# Python
python3 -m http.server 8000

# or Node.js (no install needed)
node tests/server.mjs 8000
```

Then open <http://localhost:8000>.

The site can also be deployed as-is to any static host, such as GitHub Pages, Netlify or Cloudflare Pages.

## Using the output in Android

1. Save the XML as `res/drawable/<name>.xml`.
2. The file uses the inline `aapt:attr` format, which the Android Gradle Plugin compiles.
3. An AVD does not loop by default. For continuous playback:

```kotlin
val avd = AnimatedVectorDrawableCompat.create(context, R.drawable.avd_animation)!!
imageView.setImageDrawable(avd)
avd.registerAnimationCallback(object : Animatable2Compat.AnimationCallback() {
    override fun onAnimationEnd(drawable: Drawable?) {
        imageView.post { avd.start() }   // loop continuously
    }
})
avd.start()
```

### Gradients and minimum SDK

Gradients are written as inline `<gradient>` elements inside `fillColor` / `strokeColor`. They need
Android 7.0 (API 24) or newer, or `AnimatedVectorDrawableCompat`. The **Support gradients (requires
API 24+)** option is on by default. Turn it off when targeting older platform drawables, and each
gradient is replaced with its first colour.

## Limitations

These Lottie features have no AVD equivalent. They are skipped or approximated, and the conversion
report lists any that were found:

| Feature | Behaviour |
| --- | --- |
| Luma track mattes | Converted as alpha mattes |
| Soft mattes and masks (partial opacity, gradients, feather, expansion) | Clipped with hard edges |
| Track mattes made of strokes | Converted to outline polygons; round/bevel joins are approximated |
| Mask modes other than Add → Subtract / Intersect (e.g. Add after Subtract, Lighten, Difference) | Approximated |
| Text and image layers | Skipped (convert text to shapes in After Effects) |
| Animated gradients | Converted using their first frame (AVDs cannot animate gradients) |
| Radial gradient highlight | Ignored; the gradient stays centred |
| Gradients with *Support gradients* turned off | Replaced with their first colour |
| Dashes | Drawn as a solid stroke |
| Merge Paths, Repeater, Round Corners, Twist, Pucker/Bloat, Zig Zag, Offset Path | Ignored |
| 3D layers, skew, time remapping, layer effects | Ignored |
| Expressions | Only the static keyframes are used |
| Shape morphs with differing vertex counts | Morph dropped |
| Compressed `.lottie` files | Not supported yet; use the JSON |

## Project structure

```
.
├── index.html                  # Page markup (text comes from i18n keys), SEO meta tags
├── manifest.webmanifest        # Web app manifest (name, icons)
├── sitemap.xml                 # Sitemap for search engines
├── samples/
│   ├── sample.json             # Demo: basic shapes, morph, trim path
│   ├── gradient.json           # Demo: linear/radial gradient fills and strokes
│   └── mattes.json             # Demo: alpha / inverted mattes and masks
├── src/
│   ├── css/
│   │   ├── fonts.css           # Self-hosted @font-face rules
│   │   └── styles.css          # Theme tokens (light/dark) and layout
│   └── js/
│       ├── core/
│       │   ├── math.js         # Bézier easing, clamp, helpers
│       │   └── format.js       # Number/colour formatting for XML
│       ├── lottie/
│       │   ├── properties.js   # Keyframe evaluation of Lottie properties
│       │   ├── geometry.js     # Shapes → path data
│       │   ├── gradient.js     # Gradient stops, start/end points
│       │   └── transform.js    # Affine matrices for layer / group transforms
│       ├── converter/
│       │   ├── tracks.js       # Property tracks over time
│       │   ├── clipping.js     # Track mattes and masks → clip-path tracks
│       │   ├── converter.js    # Lottie → scene → animators (entry point)
│       │   └── xml-writer.js   # Scene → AnimatedVectorDrawable XML
│       ├── player/
│       │   └── avd-player.js   # In-browser AVD renderer (SVG)
│       ├── i18n/
│       │   ├── i18n.js         # Language switching, DOM translation
│       │   └── locales/        # en.js, fa.js
│       └── ui/
│           ├── app.js          # UI wiring and playback loop
│           └── download.js     # Download / clipboard helpers
├── assets/fonts/               # Vazirmatn, JetBrains Mono (+ OFL licences)
├── assets/icons/               # favicon.svg (source) + generated PNG/ICO and og-image.png
├── scripts/build-icons.mjs     # npm run icons: renders the icons from favicon.svg
├── vendor/lottie-web/          # lottie-web 5.12.2 light player (+ MIT licence)
└── tests/
    ├── run.mjs                 # Regression test runner (Playwright + Chromium)
    ├── server.mjs              # Static server used by the tests and `npm start`
    ├── cases.json              # Test cases and their limits
    ├── golden/                 # Expected XML output per case
    └── fixtures/               # Test-only Lottie files (+ generate.mjs)
```

### Adding a language

1. Copy `src/js/i18n/locales/en.js` to a new file, for example `de.js`, and translate the values.
2. Register it in `LOCALES` in `src/js/i18n/i18n.js` with its text direction and number locale.
3. Update the language switch button in `src/js/ui/app.js` if there are more than two languages.

## Tests

The regression tests convert each sample and test fixture in headless Chromium and check:

1. **Visual match**: the app's difference view (Lottie vs. the AVD preview) at several frames.
   The mean pixel value must stay below the case's `maxDiff` (0 means identical; anti-aliased
   edges alone give about 1.5).
2. **Size**: the number of `objectAnimator`s must stay below `maxAnimators`.
3. **Warnings**: the conversion report must match the expected list.
4. **Output**: the XML must match the golden file in `tests/golden/`.

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # all cases
npm test -- holes                 # cases whose name contains "holes"
npm run test:update               # rewrite golden XML after an intended output change
```

When a check fails, the difference images and the actual XML are saved in `tests/output/`.
The tests run automatically on every pull request through GitHub Actions; on failure those files
are attached to the run as the `test-output` artifact.

The visual check compares against the in-browser AVD emulator, not a real Android device, so
testing on a device is still worthwhile for larger changes.

To add a case, put a Lottie file in `samples/` or `tests/fixtures/`, add an entry to
`tests/cases.json`, then run `npm run test:update` and review the new golden file.

## Third-party components

- [lottie-web](https://github.com/airbnb/lottie-web) 5.12.2, MIT License (`vendor/lottie-web/LICENSE.md`)
- [Vazirmatn](https://github.com/rastikerdar/vazirmatn) font, SIL Open Font License 1.1
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) font, SIL Open Font License 1.1
