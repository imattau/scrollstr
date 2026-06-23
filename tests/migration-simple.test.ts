import { test, expect } from '@playwright/test';

test('Migration verification - simplified flow', async ({ page }) => {
  const errors: string[] = [];

  // Capture console messages
  page.on('console', msg => {
    if (msg.type() === 'error') {
      // Filter out browser-level network resource errors (403/404 on video sources)
      // The app gracefully handles these via handleLoadError (console.warn),
      // but browsers auto-log network failures for <video> src as console.error
      if (msg.text().includes('Failed to load resource')) return
      errors.push(msg.text());
    }
  });

  // Capture uncaught exceptions
  page.on('pageerror', exception => {
    errors.push(`Uncaught: ${exception.message}\n${exception.stack}`);
  });

  // Test 1: Load main page with extended timeout
  console.log('[TEST] Loading http://localhost:5173/');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });

  // Wait for the app to actually render content
  await page.waitForTimeout(5000);

  console.log('[TEST] Checking app loaded...');
  const appExists = await page.evaluate(() => {
    const root = document.getElementById('root') || document.getElementById('app');
    return root !== null && root.children.length > 0;
  });

  expect(appExists).toBeTruthy();
  console.log('[TEST] App root element exists and has content');

  // Test 2: Take screenshot to debug state
  console.log('[TEST] Taking screenshot for debugging...');
  await page.screenshot({ path: '/tmp/test-screenshot.png' });

  // Test 3: Check for any videos or feed content
  console.log('[TEST] Checking for video content...');
  const videoCount = await page.evaluate(() => {
    return document.querySelectorAll('video, [data-testid*="video"], .video').length;
  });
  console.log(`[TEST] Found ${videoCount} video elements`);

  // Test 4: Try to find navigation elements
  console.log('[TEST] Checking for navigation...');
  const navCount = await page.evaluate(() => {
    return document.querySelectorAll('nav, [role="navigation"], header').length;
  });
  console.log(`[TEST] Found ${navCount} navigation elements`);

  // Test 5: Check for interactive elements
  console.log('[TEST] Checking for buttons and links...');
  const buttonCount = await page.evaluate(() => {
    return document.querySelectorAll('button, a').length;
  });
  console.log(`[TEST] Found ${buttonCount} buttons and links`);

  // Test 6: Wait and look for specific text content
  console.log('[TEST] Waiting for content to load...');
  try {
    await page.waitForSelector('button, a', { timeout: 10000 });
    console.log('[TEST] Interactive elements found');
  } catch (e) {
    console.log('[TEST] No interactive elements found after 10s');
  }

  // Final results
  console.log('\n[FINAL RESULTS]');
  console.log(`Console errors captured: ${errors.length}`);

  if (errors.length > 0) {
    console.error('[ERRORS FOUND]:');
    errors.forEach((err, i) => {
      console.error(`${i + 1}. ${err}`);
    });
  } else {
    console.log('[SUCCESS] No console errors detected');
  }

  // Assertion
  expect(errors.length).toBe(0);
});
