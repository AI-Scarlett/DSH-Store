import assert from 'node:assert/strict'
import test from 'node:test'
import { registerManagerRoutes, registerInventoryRoute } from '../src/panel.mjs'
function response() { return { status: null, body: '', writeHead(s) { this.status = s }, end(s) { this.body = s } } }
for (const decision of [401, 403, null, false, 500, 'allow']) {
  test(`every manager route rejects authority decision ${decision}`, async () => {
    const routes = []; let calls = 0
    registerManagerRoutes({ register: route => { routes.push(route) } }, { connection: { requestRejection(req) { calls++; assert.equal(req.headers.cookie, 'fixture'); return decision } } })
    for (const route of routes) {
      const res = response()
      await route.handler({ method: 'POST', headers: { cookie: 'fixture', host: '127.0.0.1', 'x-forwarded-for': '127.0.0.1', 'x-dsh-safe-intent': 'execute' } }, res)
      assert.equal(res.status, decision === 401 || decision === 403 ? decision : 503)
      assert.ok(!res.body.includes('fixture'))
    }
    assert.equal(calls, routes.length)
  })
}
test('missing authority and authority errors fail closed, including legacy inventory registration', async () => {
  for (const options of [{}, { connection: { requestRejection() { throw new Error('SECRET') } } }]) {
    const routes = []
    registerInventoryRoute({ register: route => routes.push(route) }, options)
    const res = response(); await routes[0].handler({}, res)
    assert.equal(res.status, 503); assert.ok(!res.body.includes('SECRET'))
  }
})
test('authenticated caller reaches the underlying method gate', async () => {
  const routes = []
  registerManagerRoutes({ register: route => routes.push(route) }, { connection: { requestRejection: () => undefined } })
  const res = response(); await routes[0].handler({ method: 'DELETE' }, res)
  assert.equal(res.status, 405)
})
