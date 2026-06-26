# Nostrich Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Design and implement a nostrich mascot icon set for scrollstr at multiple sizes (favicon, 192x192, 512x512) with SVG primary and PNG fallback formats, conveying vertical scrolling through a diving pose.

**Architecture:** Design the nostrich character in Figma with a diving pose at 75-80° angle and motion lines. Export a high-resolution 512x512 SVG as the source, then create simplified variants (192x192, favicon) by reducing detail and motion lines. Generate PNG fallbacks from each SVG using ImageMagick. Deploy to `public/` and verify PWA manifest integration.

**Tech Stack:** Figma (design), SVG optimization, ImageMagick (PNG generation), Vite PWA plugin

## Global Constraints

- **Icon sizes:** 16-32px (favicon), 192x192px, 512x512px
- **Color palette:** Primary nostrich tan (#D4B895), purple (#863bff, #7e14ff), cyan (#47bfff), dark (#09090b)
- **Nostrich pose:** Diving headfirst at 75-80° angle downward
- **Motion lines:** 512px=4 lines, 192px=3 lines, favicon=2 lines, with fade gradient
- **SVG target:** <50KB uncompressed, optimized code
- **PNG targets:** <15KB each, 24-bit with alpha transparency
- **Formats:** SVG primary, PNG fallback, maskable variant support

---

## Task 1: Design Nostrich Character in Figma

**Files:**
- Create: Figma design file (cloud-based, no local file)

**Interfaces:**
- Produces: High-resolution SVG exports (512x512, 192x192, favicon) with:
  - Nostrich character at 75-80° dive angle
  - 4 motion lines with purple gradient (#863bff → #7e14ff)
  - Facial features (eyes, beak) visible at 192px+ sizes
  - Tan/beige nostrich body (#D4B895 or similar)

- [ ] **Step 1: Open or create Figma file**

Go to [figma.com](https://figma.com), create a new file named "scrollstr-nostrich-icons".

- [ ] **Step 2: Design the nostrich base character**

Create the nostrich shape with:
- **Head:** Stylized nostrich profile, facing downward/leftward at 75-80° angle
- **Eyes:** Two small circles or dots, expressive but simple
- **Beak:** Pointed, angled downward in dive direction
- **Body:** Simplified bird body following dive vector
- **Colors:** Warm tan/beige (#D4B895 suggested, adjust to match nostrich community artwork)
- **Strokes:** 2-3px rounded stroke weight for 512px canvas
- Reference existing Nostr nostrich art (available on Nostr community sites/Imgur)

- [ ] **Step 3: Add motion lines**

Create 4 curved motion lines flowing upward/backward from nostrich:
- **Line 1 (closest):** Solid purple (#863bff)
- **Line 2:** 80% opacity purple
- **Line 3:** 60% opacity purple → cyan (#47bfff) gradient
- **Line 4 (farthest):** 30% opacity, fades out
- **Curve shape:** Smooth arcs following nostrich dive trajectory (convex)
- **Stroke:** 1.5-2.5px rounded caps
- **Spacing:** Evenly distributed along dive path

- [ ] **Step 4: Create 512x512 artboard and refine**

Set Figma artboard to 512x512px, place nostrich composition centered. Refine proportions and spacing. Ensure all elements visible and balanced.

- [ ] **Step 5: Export SVG (512x512)**

File > Export > SVG format, name `nostrich-512.svg`. Verify file opens in browser correctly, no rendering issues.

---

## Task 2: Create 192x192 SVG Variant

**Files:**
- Modify: SVG exported from Task 1
- Create: `public/favicon-192.svg`

**Interfaces:**
- Consumes: `nostrich-512.svg` from Task 1
- Produces: `public/favicon-192.svg` (192x192 SVG with 3 motion lines, adjusted stroke weights)

- [ ] **Step 1: Duplicate 192x192 artboard in Figma (or export variant)**

In Figma, create a new 192x192px artboard. Copy nostrich and motion lines (4 lines) onto this artboard, but scale down the entire composition to fit the smaller canvas while maintaining proportions.

- [ ] **Step 2: Simplify for 192px size**

- Remove the 4th (farthest) motion line or reduce to 3 total lines
- Adjust stroke weights: reduce from 2-3px to 1.5-2px to maintain visual weight at smaller size
- Simplify nostrich face details slightly (eyes/beak still visible but cleaner lines)
- Keep all core elements visible

- [ ] **Step 3: Export as SVG**

File > Export > SVG, name `nostrich-192.svg`.

- [ ] **Step 4: Hand-optimize SVG code (optional but recommended)**

Open `nostrich-192.svg` in a text editor. Check for:
- Remove unnecessary groups or metadata
- Consolidate similar paths if possible
- Verify viewBox is `0 0 192 192`
- Remove Figma-specific attributes (data-*, etc.)
- Keep stroke weights relative/scalable

Save optimized version to `public/favicon-192.svg`.

---

## Task 3: Create Favicon SVG (16-32px variant)

**Files:**
- Modify: SVG from Task 2 or Task 1
- Create: `public/favicon.svg`

**Interfaces:**
- Consumes: `nostrich-192.svg` or `nostrich-512.svg`
- Produces: `public/favicon.svg` (scalable favicon with 2-3 motion lines, strong silhouette)

- [ ] **Step 1: Create favicon artboard in Figma**

Create a new 48x48px (or 64x64px) artboard. The favicon needs to work at 16px and up, so design for clarity at small scales.

- [ ] **Step 2: Simplify nostrich for favicon**

- **Reduce to 2-3 motion lines** (remove farthest/faintest lines)
- **Simplify nostrich features:** Bold strokes only, minimal detail
- **Strong silhouette:** Ensure nose/beak and body are immediately recognizable
- **Adjust proportions:** May need to exaggerate head/beak slightly for visibility at 16px
- **Stroke weight:** 1.5px for crisp rendering at small sizes

- [ ] **Step 3: Export as SVG**

File > Export > SVG with proper viewBox, name `nostrich-favicon.svg`.

- [ ] **Step 4: Optimize and finalize favicon**

Open in text editor and optimize:
- ViewBox: Adjust to match exported artboard (e.g., `0 0 64 64` or similar)
- Remove Figma metadata
- Ensure stroke weights are clean (1.5-2px at standard size)
- Test at 16px in browser DevTools (Inspect > zoom to 16px or use favicon preview tools)

Save to `public/favicon.svg` (this is the primary source file that scales to all sizes).

---

## Task 4: Generate PNG Fallbacks (192x192)

**Files:**
- Create: `public/favicon-192.png`

**Interfaces:**
- Consumes: `public/favicon-192.svg` from Task 2
- Produces: `public/favicon-192.png` (192x192 PNG, 24-bit RGBA, <15KB)

- [ ] **Step 1: Install ImageMagick (if not present)**

```bash
# macOS
brew install imagemagick

# Linux (Ubuntu/Debian)
sudo apt-get install imagemagick

# Verify installation
convert --version
```

- [ ] **Step 2: Render SVG to PNG**

```bash
cd /home/mattthomson/workspace/scrollstr
convert -density 192 -background none public/favicon-192.svg public/favicon-192.png
```

**Expected output:** `public/favicon-192.png` created, ~4-10KB in size.

- [ ] **Step 3: Verify PNG quality**

```bash
file public/favicon-192.png
identify public/favicon-192.png
```

Expected output should show `192x192` dimensions and `PNG` format. Visual check: open in image viewer, verify nostrich and motion lines are clear and colors match SVG.

- [ ] **Step 4: Optimize PNG file size (optional)**

If PNG >15KB, optimize further:

```bash
optipng -o2 public/favicon-192.png
# or
pngquant --force --ext .png public/favicon-192.png
```

Verify size remains <15KB and visual quality is acceptable.

---

## Task 5: Generate PNG Fallbacks (512x512)

**Files:**
- Create: `public/favicon-512.png`

**Interfaces:**
- Consumes: `public/favicon-512.svg` or `public/favicon.svg` (scaled to 512x512)
- Produces: `public/favicon-512.png` (512x512 PNG, 24-bit RGBA, <15KB)

- [ ] **Step 1: Export 512x512 from Figma or use favicon.svg**

Use the high-detail 512x512 SVG created in Task 1. Ensure it's saved as `public/favicon-512.svg` in the repository.

- [ ] **Step 2: Render SVG to PNG**

```bash
cd /home/mattthomson/workspace/scrollstr
convert -density 192 -background none -resize 512x512 public/favicon-512.svg public/favicon-512.png
```

**Expected output:** `public/favicon-512.png` created, ~8-15KB in size.

- [ ] **Step 3: Verify PNG**

```bash
identify public/favicon-512.png
```

Expected: `512x512` dimensions, `PNG` format. Visual: open in image viewer, all 4 motion lines visible, nostrich details clear.

- [ ] **Step 4: Optimize if needed**

```bash
optipng -o2 public/favicon-512.png
```

Ensure <15KB, acceptable quality.

---

## Task 6: Deploy Icons to Public Directory

**Files:**
- Create: Multiple SVG and PNG files in `public/`
- Verify: `vite.config.ts` (no changes needed)
- Verify: `index.html` (no changes needed)

**Interfaces:**
- Consumes: All SVG and PNG files generated in Tasks 1-5
- Produces: Deployed asset files in `public/`

- [ ] **Step 1: Copy SVG files to public/**

```bash
cd /home/mattthomson/workspace/scrollstr

# Copy all SVG variants
cp nostrich-512.svg public/favicon-512.svg  # or move from Figma export location
cp nostrich-192.svg public/favicon-192.svg
cp nostrich-favicon.svg public/favicon.svg

# Verify files exist and are readable
ls -lh public/favicon*.svg
```

Expected: Three SVG files in `public/`, each <50KB.

- [ ] **Step 2: Verify PNG files are in place**

```bash
ls -lh public/favicon*.png
```

Expected: `favicon-192.png` and `favicon-512.png` present, <15KB each.

- [ ] **Step 3: Verify existing files (no overwrites)**

```bash
ls -la public/ | grep favicon
```

Check if `icons.svg` from original project is still there. If we're not using it, that's fine; if we are, leave it alone.

- [ ] **Step 4: Clean up any old/temporary files**

```bash
# Remove temporary files (optional, if any backup/old versions exist)
rm -f public/favicon-backup.svg  # if you created backups
```

---

## Task 7: Verify PWA Integration & Browser Testing

**Files:**
- Verify: `vite.config.ts` (should already be configured)
- Verify: `index.html` (should already reference favicon)

**Interfaces:**
- Consumes: All deployed icons from Task 6
- Produces: Verified working favicon and PWA install icon setup

- [ ] **Step 1: Check current vite config**

Verify `vite.config.ts` includes PWA plugin with icon definitions (should already be configured from existing setup):

```typescript
VitePWA({
  manifest: {
    icons: [
      {
        src: 'favicon.svg',
        sizes: '192x192',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: 'favicon.svg',
        sizes: '512x512',
        type: 'image/svg+xml',
        purpose: 'any maskable',
      },
    ],
  },
})
```

No changes needed if already present. If manifest is missing icon entries, add them.

- [ ] **Step 2: Verify index.html favicon link**

Check `index.html` has:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```

Already present in current setup, no change needed.

- [ ] **Step 3: Build the project**

```bash
cd /home/mattthomson/workspace/scrollstr
npm run build
```

Expected: Build succeeds without errors. Check `dist/` has favicon files copied.

- [ ] **Step 4: Start dev server and test favicon**

```bash
npm run dev
```

Open browser to `http://localhost:5173` (or whatever port Vite uses). 

**Check:**
- Browser tab shows nostrich icon (favicon)
- Icon is recognizable at 16x16px size
- Right-click tab > "Inspect" > check `<link rel="icon">` points to `/favicon.svg`

- [ ] **Step 5: Test PWA install prompt (optional)**

On mobile or emulated mobile:
- Open DevTools
- Go to Application > Manifest
- Verify icons array shows 192x192 and 512x512 entries
- Test "Add to Home Screen" or install prompt
- Verify home screen icon shows nostrich design

- [ ] **Step 6: Verify file sizes**

```bash
ls -lh public/favicon*
wc -c public/favicon.svg
```

Expected:
- `favicon.svg`: <50KB
- `favicon-192.png`: <15KB
- `favicon-512.png`: <15KB

- [ ] **Step 7: Commit all icon files**

```bash
git add public/favicon.svg public/favicon-192.svg public/favicon-512.svg
git add public/favicon-192.png public/favicon-512.png
git commit -m "feat: replace abstract icon with nostrich mascot design

- Design nostrich diving at 75-80 angle with motion lines
- Maintain purple/blue brand colors
- Create SVG variants for favicon, 192x192, 512x512
- Generate PNG fallbacks for older devices
- Supports PWA maskable icon requirement"
```

---

## Summary of Deliverables

✅ **SVG Icons:**
- `public/favicon.svg` — primary scalable icon (tested at 16-512px)
- `public/favicon-192.svg` — explicit 192x192 variant
- `public/favicon-512.svg` — explicit 512x512 variant

✅ **PNG Fallbacks:**
- `public/favicon-192.png` — 192x192 rasterized
- `public/favicon-512.png` — 512x512 rasterized

✅ **Verification:**
- Browser favicon works and displays nostrich
- PWA manifest integrates correctly
- App install icon shows on mobile
- File sizes within targets

✅ **Git Commit:** Icon files committed with descriptive message
