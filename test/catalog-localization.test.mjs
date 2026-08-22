import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { assertCatalogLocalization, localizeCatalogEntry } from '../src/catalog-localization.mjs'
import { searchCatalog, validateCatalog } from '../src/catalog.mjs'

test('localization creates durable Chinese names, descriptions, and search aliases', () => {
  const localized = localizeCatalogEntry({
    id: 'dsh-task-notify', packageName: '@example/dsh-task-notify', name: 'dsh-task-notify',
    description: 'Sends a desktop notification when a task finishes.', categories: ['notifications'],
  }, { notifications: '通知与集成' })
  assert.equal(localized.name, '任务通知提醒（DSH Task Notify）')
  assert.match(localized.description, /为 DSH 提供任务通知提醒能力/)
  assert.ok(localized.searchTerms.includes('任务完成'))
  assert.ok(localized.searchTerms.includes('@example/dsh-task-notify'))
})

test('localization preserves a curated Chinese-English display name', () => {
  const localized = localizeCatalogEntry({
    id: 'demo', packageName: 'dsh-demo', name: '演示助手（Demo Assistant）',
    description: '这是供用户理解的中文说明。', categories: ['tools'],
  })
  assert.equal(localized.name, '演示助手（Demo Assistant）')
  assert.equal(localized.description, '这是供用户理解的中文说明。')
})

test('the production Catalog is fully localized and searchable by Chinese use cases', async () => {
  const source = JSON.parse(await readFile(new URL('../registry/catalog.json', import.meta.url), 'utf8'))
  assertCatalogLocalization(source)
  const catalog = validateCatalog(source)
  assert.ok(searchCatalog(catalog, '任务完成').some(entry => entry.id === 'dsh-task-notify'))
  assert.ok(searchCatalog(catalog, '余额').some(entry => entry.id === 'dsh-balance-monitor'))
  assert.ok(catalog.entries.every(entry => entry.searchTerms.some(term => /[\u3400-\u9fff]/u.test(term))))
})
