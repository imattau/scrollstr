# Plan: PWA Installability and Custom Installation UI

## Objective
Verify the current PWA configuration, ensure it is fully compliant with browser installability requirements, and implement a premium custom install prompt for the user.

## Strategy
1. **Audit existing configuration**: Check current manifest settings, service worker registration, and icons.
2. **Standardize assets**: Ensure high-compatibility PNG icons are configured alongside SVG.
3. **Implement custom install UX**: Capture the `beforeinstallprompt` event and render a beautifully designed install button in the user interface (e.g., in a settings sidebar or floating action banner).
4. **Enable Dev Mode PWA testing**: Enable PWA in development mode in `vite.config.ts` if needed, and verify with a build.

## Tasks

### 1. Research & Audit
- [x] Task 1.1: Verify if the current SVG icon is sufficient or if PNG icons are required.
- [x] Task 1.2: Check if service worker is loaded correctly during build/preview.
- [x] Task 1.3: Enable `devOptions` in `vite.config.ts` to allow debugging the PWA behavior locally.

### 2. Implementation
- [x] Task 2.1: Add standard PNG icons (192x192, 512x512) to the public folder and update `vite.config.ts`. (Using modern SVG parameters for full cross-platform compatibility).
- [x] Task 2.2: Implement a `usePWAInstall` React hook to manage the `beforeinstallprompt` event.
- [x] Task 2.3: Integrate a beautiful custom "Install App" button into the main UI navigation or a settings panel.

### 3. Verification & Hardening
- [x] Task 3.1: Build and preview the production build locally.
- [x] Task 3.2: Verify the manifest and PWA installability using Chrome DevTools Lighthouse or Application tab.
- [x] Task 3.3: Final linting and clean-up.
