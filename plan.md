# Plan: Add Profile Navigation on Mobile View

## Objective
Enable mobile users to easily view their logged-in Nostr profile. On mobile view, the bottom tab navigation currently shows "Settings" but has no link to the user's profile. We will replace "Settings" with "Profile" in the mobile bottom navigation bar. Since settings are already accessible via the profile page ("Edit profile settings" button and top-right header options button), this maintains access to settings while aligning with standard mobile social app layouts.

## Strategy
1. **Define Mobile Nav Items**: In MainLayout.tsx, define a `mobileNavItems` array that replaces the Settings route (`/settings`) with the Profile route (`/profile/me`). (Done)
2. **Update Mobile Bottom Nav Bars**: Replace the mapping of `navItems` with `mobileNavItems` in both the immersive mobile bottom navigation bar and the standard mobile bottom navigation bar. (Done)
3. **Verify Layout & Functionality**: Verify that the bottom nav displays the Profile icon (`User` icon from lucide-react) and links to `/profile/me` on mobile devices/simulated screens.
4. **Build and Validate**: Build the application to ensure typescript compiles clean and look for any regressions.

## Tasks

### 1. Planning & Design Audit
- [x] Task 1.1: Verify how the mobile layout is constructed and determine where bottom nav elements are rendered.
- [x] Task 1.2: Check if profile pages are accessible and if settings are reachable from the profile page.

### 2. Implementation
- [x] Task 2.1: Add `mobileNavItems` with Profile route in MainLayout.tsx.
- [x] Task 2.2: Update the immersive and standard mobile navigation menus to map over `mobileNavItems`.

### 3. Verification & Cleanup
- [x] Task 3.1: Build the code locally with `npm run build` or similar scripts to ensure there are no compilation/typescript errors.
- [x] Task 3.2: Confirm changes are clean and run formatting/linting if necessary.
