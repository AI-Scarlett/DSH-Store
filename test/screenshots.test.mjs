import assert from 'node:assert/strict'
import test from 'node:test'
import { validateScreenshots } from '../src/catalog.mjs'
test('screenshots require bounded relative raster assets and exact hashes', () => {
  assert.equal(validateScreenshots([{path:'docs/preview.png',sha256:'a'.repeat(64)}]).length,1)
  for (const path of ['../secret.png','/private.png','image.svg','https://evil/x.png','docs//x.png']) assert.throws(()=>validateScreenshots([{path,sha256:'a'.repeat(64)}]))
  assert.throws(()=>validateScreenshots([{path:'preview.png',sha256:'bad'}]))
})
