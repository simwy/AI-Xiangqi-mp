import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalStore } from '../store.mjs'
import { Runner } from '../runner.mjs'
import { newGame } from '../game.mjs'
import { validateGame } from '../../common/xiangqi/rules.mjs'
test('真实 HTTP 兼容接口驱动双方落子，think 设置随各模型发送并持久化', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xq-provider-')), store = await new LocalStore(dir).open(), seen = []
	const provider = http.createServer(async (req, res) => {
		const chunks = []; for await (const c of req) chunks.push(c)
		const body = JSON.parse(Buffer.concat(chunks).toString()); seen.push(body)
		const choices = JSON.parse(body.messages[1].content).legal_moves
		res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'fixture-provider-request', choices: [{ message: { content: JSON.stringify({ move_id: choices[0].id }), reasoning_content: 'private-fixture-must-not-persist' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }))
	})
	await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
	t.after(async () => { provider.closeAllConnections(); await new Promise(r => provider.close(r)); await store.close(); await fs.rm(dir, { recursive: true, force: true }) })
	const base = 'http://127.0.0.1:' + provider.address().port + '/v1'
	for (const [_id, thinking_mode] of [['red-model', 'enabled'], ['black-model', 'disabled']]) await store.request('models.save', { model: { _id, display_name: _id, base_url: base, model_name: 'fixture-model', api_key: 'fixture-key', enabled: true, can_play: true, thinking_mode, thinking_adapter: 'thinking_type', max_attempts: 1 } })
	const config = { mode: 'live', dataDirectory: dir, inlineLimit: 1400000, moveIntervalMs: 0, betweenGamesMs: 0, allowPrivateModels: true }
	const runner = new Runner(store, config); runner.stopped = false; await runner.tick(); await runner.tick(); await runner.tick()
	assert.equal(runner.current.steps.length, 2); assert.deepEqual(seen.map(b => b.thinking.type).sort(), ['disabled', 'enabled'])
	validateGame(runner.current)
	const runtime = await store.request('runtime.get'), saved = await store.request('games.get', { id: runtime.current_game_id })
	assert(!JSON.stringify(saved).includes('private-fixture-must-not-persist')); assert(!JSON.stringify(saved).includes('fixture-key'))
	assert.equal(saved.steps[0].calls[0].usage.prompt_tokens, 100)
})
