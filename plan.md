# Plan: Support Existing nsec for Passkey Registration

## Objective
Provide the ability to import an existing Nostr private key (nsec) when registering/creating a Passkey identity. If no nsec is provided, the application will default to generating a new keypair.

## Strategy
1. **Context/Provider Update**:
   - Update `registerPasskey` signature in [nostrContext.ts](file:///home/mattthomson/workspace/scrollstr/src/app/nostrContext.ts) to accept `nsec?: string`.
   - Update `registerPasskey` implementation in [providers.tsx](file:///home/mattthomson/workspace/scrollstr/src/app/providers.tsx). Import `importPasskeyIdentityFromNsec` from `nostr-passkey`. If `nsec` is provided, call `importPasskeyIdentityFromNsec(nsec, options)`. Otherwise, call `registerPasskeyIdentity(options)`.
2. **UI Updates in LoginSheet**:
   - Add state for `nsec` in [LoginSheet.tsx](file:///home/mattthomson/workspace/scrollstr/src/features/auth/LoginSheet.tsx).
   - Render a premium-looking input field below the Passkey OptionCard when `!hasPasskey`. This allows users to optionally enter an `nsec` before clicking the "Create Passkey" button.
   - Pass the entered `nsec` string into the updated `registerPasskey` call.
3. **Verification**:
   - Verify TypeScript compilation and building with `npm run build`.

## Tasks

### 1. Research & Audit
- [x] Task 1.1: Verify import capabilities of `nostr-passkey` and design context signatures.
- [x] Task 1.2: Check if inputs are formatted correctly and validate `nsec` structure.

### 2. Implementation
- [x] Task 2.1: Update context signature in `nostrContext.ts`.
- [x] Task 2.2: Implement conditional import logic in `providers.tsx`.
- [x] Task 2.3: Add optional `nsec` input UI and connect to `registerPasskey` in `LoginSheet.tsx`.

### 3. Verification & Hardening
- [x] Task 3.1: Build the code locally with `npm run build` to ensure no typescript/compile errors.
- [x] Task 3.2: Confirm code formatting and linting.
