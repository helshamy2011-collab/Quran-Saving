// رقم الإصدار في البرنامج = رقم ذاكرة العمل بدون إنترنت، حتى يصل كل تحديث للموبايل
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('APP_VERSION في app.js يساوي رقم CACHE في sw.js', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const a = app.match(/APP_VERSION = (\d+)/)?.[1];
  const c = sw.match(/const CACHE = 'hifz-v(\d+)'/)?.[1];
  assert.ok(a && c);
  assert.equal(a, c);
});
