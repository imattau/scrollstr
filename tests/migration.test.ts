import { test, expect } from '@playwright/test';

test('Migration verification - full app flow', async ({ page }) => {
  const logs: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'log') logs.push(msg.text());
    if (msg.type() === 'warning') warnings.push(msg.text());
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // Capture uncaught exceptions
  page.on('pageerror', exception => {
    errors.push(`Uncaught exception: ${exception.message}`);
  });

  // Test 1: Load main page
  console.log('[TEST] Loading http://localhost:5173/');
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  let mainFeedVisible = await page.isVisible('[data-testid="video-feed"], .video-feed, video');
  console.log(`[TEST] Main feed loaded: ${mainFeedVisible}`);

  // Test 2: Check for critical elements
  console.log('[TEST] Checking for critical UI elements...');
  const appContainer = await page.$('[id="root"], [id="app"]');
  expect(appContainer).toBeTruthy();
  console.log('[TEST] App container found');

  // Test 3: Navigate to creator profile if possible
  console.log('[TEST] Attempting to navigate to creator profile...');
  const profileLinks = await page.$$('a[href*="/profile"], [data-testid*="profile"], button:has-text("Profile")');
  if (profileLinks.length > 0) {
    await profileLinks[0].click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    console.log('[TEST] Profile page loaded');
  } else {
    console.log('[TEST] No profile link found, skipping profile test');
  }

  // Test 4: Check comments modal
  console.log('[TEST] Testing comments functionality...');
  const commentButtons = await page.$$('button:has-text("Comment"), [data-testid*="comment"]');
  if (commentButtons.length > 0) {
    await commentButtons[0].click();
    await page.waitForTimeout(1000);
    console.log('[TEST] Comments modal opened');
  } else {
    console.log('[TEST] No comment button found, skipping comments test');
  }

  // Test 5: Check zaps sheet
  console.log('[TEST] Testing zaps functionality...');
  const zapButtons = await page.$$('button:has-text("Zap"), button:has-text("zap"), [data-testid*="zap"]');
  if (zapButtons.length > 0) {
    await zapButtons[0].click();
    await page.waitForTimeout(1000);
    console.log('[TEST] Zaps sheet opened');
  } else {
    console.log('[TEST] No zap button found, skipping zaps test');
  }

  // Test 6: Navigate to settings
  console.log('[TEST] Testing settings page...');
  const settingsButtons = await page.$$('a[href*="/settings"], button:has-text("Settings"), [data-testid*="settings"]');
  if (settingsButtons.length > 0) {
    await settingsButtons[0].click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    console.log('[TEST] Settings page loaded');
  } else {
    console.log('[TEST] No settings link found, skipping settings test');
  }

  // Test 7: Navigate to activity/notifications
  console.log('[TEST] Testing activity/notifications page...');
  const activityButtons = await page.$$('a[href*="/activity"], a[href*="/notifications"], button:has-text("Activity"), button:has-text("Notifications"), [data-testid*="activity"]');
  if (activityButtons.length > 0) {
    await activityButtons[0].click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    console.log('[TEST] Activity/notifications page loaded');
  } else {
    console.log('[TEST] No activity/notifications link found, skipping activity test');
  }

  // Final check: Report any errors
  console.log('\n[RESULTS]');
  console.log(`Logs: ${logs.length}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.error('[ERRORS FOUND]');
    errors.forEach((err, i) => console.error(`${i + 1}. ${err}`));
  }

  // Store results for test assertion
  expect(errors.length).toBe(0);
});
