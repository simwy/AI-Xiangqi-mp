import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { LocalStore } from '../store.mjs'
const { createHandler } = createRequire(import.meta.url)('../../uniCloud-alipay/cloudfunctions/xiangqi-store/index.js')
test('云网关验签、防重放、过期请求及操作白名单', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xq-gateway-')), store = await new LocalStore(dir).open()
	t.after(async () => { await store.close(); await fs.rm(dir, { recursive: true, force: true }) })
	const secret = 'fixture-secret-'.repeat(4)
	const handle = createHandler({ getConfig: () => ({ gatewaySecret: secret }), getCloud: () => ({ database: () => ({}) }), repoFactory: () => store })
	const signed = (op, nonce = 'ab' + crypto.randomBytes(15).toString('hex'), time = Date.now()) => {
		const body = JSON.stringify({ op, args: {} }), stamp = String(time)
		return { httpMethod: 'POST', body, headers: { 'x-xq-time': stamp, 'x-xq-nonce': nonce, 'x-xq-signature': crypto.createHmac('sha256', secret).update(`${stamp}\n${nonce}\n${body}`).digest('hex') } }
	}
	const valid = signed('models.list')
	assert.deepEqual(JSON.parse((await handle(valid)).body).data, [])
	assert.equal(JSON.parse((await handle(valid)).body).error.code, 'REPLAY')
	const tampered = signed('models.list'); tampered.body = '{"op":"models.save"}'
	assert(JSON.parse((await handle(tampered)).body).error)
	assert(JSON.parse((await handle(signed('models.list', undefined, Date.now() - 120000))).body).error)
	assert.equal(JSON.parse((await handle(signed('arbitrary.collection.deleteAll'))).body).error.code, 'INVALID')
})
