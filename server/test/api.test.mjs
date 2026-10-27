import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApplication } from '../index.mjs'
import { configuration } from '../config.mjs'
test('HTTP 管理鉴权、残局创建、导入、投票与后台导出流程', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xq-api-'))
	const config = { ...configuration({}), dataDirectory: dir, port: 0, adminToken: 'fixture-admin-token-not-a-real-secret', visitorSecret: 'fixture-visitor-secret', moveIntervalMs: 600000, demoThinkMs: 0 }
	const app = await createApplication(config)
	await app.start()
	t.after(async () => { await app.stop(); await fs.rm(dir, { recursive: true, force: true }) })
	const base = 'http://127.0.0.1:' + app.server.address().port
	const req = async (url, method = 'GET', data, admin = true, extra = {}) => fetch(base + url, { method, headers: { ...(admin ? { authorization: 'Bearer ' + config.adminToken } : {}), 'content-type': 'application/json', ...extra }, body: data === undefined ? undefined : JSON.stringify(data) })
	assert.equal((await req('/api/admin/models', 'GET', undefined, false)).status, 401)
	assert.equal((await req('/favicon-does-not-exist.ico')).status, 404)
	assert.equal((await req('/api/health')).status, 200)
	const models = await (await req('/api/admin/models')).json(); assert.equal(models.length, 2); assert(!models.some(m => Object.hasOwn(m, 'api_key')))
	const fen = '4k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1'
	const made = await req('/api/admin/games', 'POST', { title: 'API 残局', fen, red: 'demo-doubao', black: 'demo-deepseek' }); assert.equal(made.status, 200)
	const game = await made.json(); assert.equal(game.type, 'endgame'); assert.equal(game.current_fen, fen)
	assert.equal((await req('/api/admin/games/' + game._id + '/queue', 'POST', {})).status, 200)
	const imported = await req('/api/admin/import', 'POST', game); assert.equal(imported.status, 200); assert.notEqual((await imported.json())._id, game._id)
	let live
	for (let i = 0; i < 50; i++) { live = await (await req('/api/live')).json(); if (live.game) break; await new Promise(r => setTimeout(r, 10)) }
	assert(live.game); assert.equal(live.mode, 'demo')
	const session = await (await req('/api/session', 'POST', {}, false)).json()
	const vote = { round_id: live.game._id, model_id: 'demo-doubao' }, headers = { 'x-visitor-token': session.token }
	assert.equal((await req('/api/votes', 'POST', vote, false, headers)).status, 200)
	assert.equal((await req('/api/votes', 'POST', vote, false, headers)).status, 409)
	const refreshed = await (await req('/api/live')).json()
	const unchanged = await (await req('/api/live?game_id=' + refreshed.game._id + '&version=' + refreshed.game.version + '&ply=' + refreshed.game.ply_count)).json()
	assert.equal(unchanged.unchanged, true); assert(!Object.hasOwn(unchanged, 'game'))
	const job = await (await req('/api/admin/games/' + game._id + '/export', 'POST', {})).json()
	let status
	for (let i = 0; i < 50; i++) { status = await (await req('/api/admin/exports/' + job.id)).json(); if (status.status !== 'running') break; await new Promise(r => setTimeout(r, 10)) }
	assert.equal(status.status, 'ready')
	const zipped = await req('/api/admin/exports/' + job.id + '/download'); assert.equal(zipped.status, 200); assert.equal(zipped.headers.get('content-type'), 'application/zip')
})
