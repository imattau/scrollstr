# Nostrich Icon Design Spec

**Date:** 2026-06-26  
**Author:** Claude Code  
**Project:** scrollstr (Nostr Clips)  
**Status:** Approved

---

## Overview

Redesign scrollstr's app icon system around the nostrich mascot, a beloved Nostr community symbol. The icon should represent the app's core function (vertical video scrolling) through a dynamic diving nostrich pose with motion lines, maintaining consistency with the existing purple/blue brand palette.

## Design Direction

**Core Concept:** A stylized nostrich character diving headfirst downward at a 75-80° angle with 3-4 curved motion lines trailing behind, conveying motion and scrolling action.

**Rationale:** 
- The nostrich is instantly recognizable to Nostr users, providing community connection
- The diving pose naturally represents vertical scrolling/feed consumption
- Motion lines add energy and reinforce the "scroll" metaphor without abstract complexity
- Moderate detail maintains personality while preserving clarity across all icon sizes

## Color Palette

All colors maintained from existing scrollstr brand to ensure consistency:

| Element | Color | Hex | Use |
|---------|-------|-----|-----|
| Nostrich body | Warm tan/beige | #D4B895 (or natural nostrich tone) | Primary character |
| Nostrich details | Dark brown/black | #1a1a1a | Eyes, beak, facial features |
| Motion lines | Purple gradient | #863bff → #7e14ff | Brand integration, energy |
| Accent (optional) | Cyan | #47bfff | Secondary motion line highlights |
| Background (app) | Dark | #09090b | Matches app theme, used in solid contexts |
| Background (icons) | Transparent | N/A | Primary for flexibility |

## Icon Variants & Specifications

### 1. Browser Tab Icon (Favicon)
- **Sizes:** 16px, 32px (rendered at standard 48x46 SVG, scales down)
- **Format:** SVG (primary), PNG (fallback)
- **Complexity:** Simplified
  - Nostrich face simplified to core recognizable features (eyes, beak)
  - 2-3 motion lines only (fewer for clarity at small size)
  - Minimal detail, strong silhouette
  - Stroke weight: 1.5-2px at standard size
- **Purpose:** Tab identification, browser bookmarks, shortcut icons
- **Output file:** `public/favicon.svg`

### 2. PWA App Install Icon (Standard)
- **Size:** 192x192px
- **Format:** SVG (primary), PNG (fallback)
- **Complexity:** Moderate
  - Full nostrich character visible (head through mid-body)
  - 3-4 motion lines with fade effect
  - Visible nostrich facial features (eyes, beak)
  - Consistent stroke weight (2-2.5px at standard size)
- **Purpose:** Home screen icon, app drawer, app switcher
- **Maskable variant:** Safe circular zone (160px diameter) where critical elements (nostrich body) remain; motion lines can extend beyond
- **Output files:** 
  - SVG: `public/favicon-192.svg` or use existing `favicon.svg` scaled
  - PNG: `public/favicon-192.png` (rasterized from SVG)

### 3. High-Resolution App Icon
- **Size:** 512x512px
- **Format:** SVG (primary), PNG (fallback)
- **Complexity:** Detailed
  - Full nostrich character with enhanced detail
  - All 4 motion lines with gradient fade effect
  - Nostrich body language and personality fully visible
  - Subtle shading or gradient on nostrich body for dimension
  - Stroke weight: 2-3px at standard size
- **Purpose:** App stores, large display contexts, branding
- **Output files:**
  - SVG: `public/favicon-512.svg`
  - PNG: `public/favicon-512.png` (rasterized from SVG)

### 4. Alternate: Dark Background Variant (Optional)
- **Size:** Multiple (192, 512)
- **Format:** SVG, PNG
- **Variant:** Nostrich icon on solid #09090b background (9-10% padding)
- **Use:** App store listings, promotional materials
- **Output files:** `public/favicon-*-dark.svg/png`

## Visual Specifications

### Nostrich Pose & Composition
- **Dive angle:** 75-80° downward from horizontal
- **Head position:** Leads the dive (topmost element)
- **Body position:** Follows through on dive vector
- **Pose purpose:** Clear downward motion suggesting scrolling
- **Viewing angle:** Slight 3/4 view or direct side profile

### Motion Lines Design
- **Quantity:** 3-4 curved lines depending on size
  - Favicon: 2-3 lines
  - 192px: 3-4 lines
  - 512px: 4 lines with secondary detail
- **Curve:** Smooth arcs following nostrich trajectory (convex curves)
- **Fade effect:** Lines fade progressively from solid → 60% → 30% opacity
- **Spacing:** Even distribution along nostrich's dive path
- **Color:** Purple gradient (#863bff → #7e14ff), with optional cyan accents
- **Stroke style:** Rounded caps and joins for smoothness

### Typography & Branding
- **No text in icon** (icons work better without embedded text at small sizes)
- **Nostrich character is the brand anchor** (no additional logomark needed)
- **Alternative:** Optional text-based logo ("Nostr Clips") can be used separately in app header/marketing

### Responsive Design Rules

**At 16-32px (Favicon):**
- Eliminate secondary detail, keep silhouette strong
- Reduce motion lines to 2
- Simplify nostrich features to bold strokes

**At 192x192px (Home screen):**
- Balanced detail: character recognizable, motion clear
- 3-4 motion lines, moderate opacity variance
- Full nostrich features visible

**At 512x512px (High res):**
- Full detail expression, all design elements shine
- 4 motion lines with nuanced fade
- Optional subtle gradient/shading for depth

## Implementation Details

### SVG Guidelines
- Clean, optimized SVG code (remove unnecessary groups, consolidate paths where possible)
- Viewbox: `0 0 512 512` (scale down as needed for smaller variants)
- Stroke widths defined in relative units where possible (scale proportionally)
- Use `<symbol>` or separate files for each size variant to ensure crisp rendering

### PNG Fallback Generation
- Rasterize SVG variants at 192x192 and 512x512
- Target: 24-bit PNG with alpha transparency
- Compression: Optimize file size without quality loss
- Tools: ImageMagick, Figma export, or similar

### PWA Manifest Integration
**Current manifest setup (from `vite.config.ts`):**
```json
{
  "icons": [
    {
      "src": "favicon.svg",
      "sizes": "192x192",
      "type": "image/svg+xml",
      "purpose": "any"
    },
    {
      "src": "favicon.svg",
      "sizes": "512x512",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
```

**Updated approach:**
- Keep SVG as primary (scalable, smaller file size)
- Add PNG variants as fallback for older platforms
- Ensure maskable variants have safe circular zone

### Browser Favicon Link
**Current (from `index.html`):**
```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```
**Remains unchanged** — SVG favicon scales automatically to all browser sizes.

### File Structure
```
public/
├── favicon.svg              (primary, scalable 16-512px)
├── favicon-192.svg          (optional explicit 192x192 variant)
├── favicon-192.png          (PNG fallback)
├── favicon-192-dark.svg     (optional: dark background variant)
├── favicon-192-dark.png     (optional: dark background PNG)
├── favicon-512.svg          (optional explicit 512x512 variant)
├── favicon-512.png          (PNG fallback)
├── favicon-512-dark.svg     (optional: dark background variant)
└── favicon-512-dark.png     (optional: dark background PNG)
```

## Success Criteria

✅ Icon is recognizable as nostrich at all sizes (16px-512px)  
✅ Diving pose clearly conveys downward motion/scrolling  
✅ Motion lines add energy without visual clutter  
✅ Purple/blue color palette matches brand consistency  
✅ Works on both light and dark backgrounds  
✅ Maskable variant works on modern Android app stores  
✅ SVG is <50KB uncompressed for favicon.svg  
✅ PNG variants are optimized and <15KB each  
✅ Icon passes PWA compliance requirements  

## Deliverables

1. **Primary SVG files:**
   - `public/favicon.svg` — main scalable icon
   - `public/favicon-192.svg` — explicit 192x192 variant (optional)
   - `public/favicon-512.svg` — explicit 512x512 variant (optional)

2. **PNG fallbacks:**
   - `public/favicon-192.png`
   - `public/favicon-512.png`

3. **Optional variants:**
   - Dark background versions (-dark suffix) for app store listings
   - Maskable variants if distinct from base design

4. **Design source file:** Figma project link for future iterations

## Design Handoff Notes

- **Nostrich character source:** Reference official Nostr nostrich artwork from community resources
- **Maintain brand consistency:** Use purple/blue palette consistently
- **Future updates:** Keep design modular (separate nostrich body, motion lines, background) for easy adjustments
- **Accessibility:** Ensure sufficient contrast for motion lines against backgrounds; test in both light and dark contexts

---

## Approval Sign-Off

- **Requested by:** User (scrollstr maintainer)
- **Designed by:** Claude Code
- **Approved:** Yes ✅
- **Ready for implementation:** Yes ✅
