import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LocalStore } from '../store.mjs'
import { Runner } from '../runner.mjs'
import { loadGame, exportZip, importZip, saveGame, hash } from '../archive.mjs'
import { importGame } from '../game.mjs'
import { validateGame } from '../../common/xiangqi/rules.mjs'
const fixture = async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'xq-test-')), store = await new LocalStore(dir).open()
	t.after(async () => { await store.close(); await fs.rm(dir, { recursive: true, force: true }) })
	const config = { mode: 'demo', dataDirectory: dir, inlineLimit: 1400000, moveIntervalMs: 0, betweenGamesMs: 0, demoThinkMs: 0 }
	const runner = new Runner(store, config); runner.stopped = false; await runner.seedDemo(); await runner.tick()
	return { dir, store, runner, config }
}
test('每步持久化，重启后完整恢复未完成棋局', async t => {
	const { dir, store, runner, config } = await fixture(t)
	await runner.tick(); const runtime = await store.request('runtime.get'), saved = await loadGame(store, runtime.current_game_id, config)
	assert.equal(saved.steps.length, 1); assert.equal(saved.steps[0].calls[0].status, 'succeeded'); validateGame(saved)
	assert(saved.steps[0].decision_ms >= 0); assert.equal(saved.steps[0].fen_after, saved.current_fen)
	await store.request('runtime.release', runner.lease)
	await store.close()
	const reopened = await new LocalStore(dir).open()
	try { const second = new Runner(reopened, config); second.stopped = false; await second.tick(); assert.equal(second.current._id, saved._id); assert.equal(second.current.steps.length, 2) } finally { await reopened.close() }
})
test('落子提交失败不发布新棋盘；旧数据库可以继续恢复', async t => {
	const { store, runner, config } = await fixture(t), actual = store.request.bind(store)
	let injected = false
	store.request = async (op, args) => { if (op === 'games.save' && args.game.ply_count === 1 && !injected) { injected = true; throw new Error('simulated storage failure') } return actual(op, args) }
	await assert.rejects(() => runner.tick(), /simulated/)
	assert.equal(runner.current.ply_count, 0)
	const runtime = await actual('runtime.get'), persisted = await loadGame(store, runtime.current_game_id, config)
	assert.equal(persisted.ply_count, 0); assert.equal(persisted.steps.length, 0); assert.equal(persisted.pending_step.calls.length, 1)
	store.request = actual; await actual('runtime.release', runner.lease)
	const next = new Runner(store, config); next.stopped = false; await next.tick(); assert.equal(next.current.ply_count, 1); validateGame(next.current)
})
test('过期版本、并发实例和重复投票受到保护', async t => {
	const { store, runner, config } = await fixture(t), stale = structuredClone(runner.current)
	await assert.rejects(store.request('runtime.acquire', { owner: 'another-worker' }), { code: 'LEASE_BUSY' })
	await runner.tick()
	await assert.rejects(store.request('games.save', { game: stale, expected_version: stale.version, worker: true, ...runner.lease }), { code: 'CONFLICT' })
	const vote = { round_id: runner.current._id, model_id: 'demo-doubao', visitor_hash: 'a'.repeat(64) }
	const results = await Promise.allSettled([store.request('vote', vote), store.request('vote', vote)])
	assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
	await store.request('round.close', runner.lease)
	await assert.rejects(store.request('vote', { ...vote, visitor_hash: 'b'.repeat(64) }), { code: 'ROUND_CLOSED' })
})
test('一局 JSON 和实际音频 ZIP 可以校验导出再导入', async t => {
	const { store, runner, config } = await fixture(t); await runner.tick()
	const game = structuredClone(runner.current), comment = game.steps[0].commentaries[0], bytes = Buffer.from('fixture-audio-only')
	const asset = await store.request('audio.upload', { path: `xiangqi/${game._id}/sample.mp3`, data: bytes.toString('base64') })
	comment.audio.push({ id: 'sample-audio', status: 'ready', file_id: asset.file_id, sha256: hash(bytes), format: 'mp3', duration_ms: 1200 })
	const result = await exportZip(game, store, config); assert.deepEqual(result.missing, [])
	const imported = await importZip(result.data, store)
	assert.notEqual(imported._id, game._id); assert.equal(imported.steps[0].notation, game.steps[0].notation)
	assert(imported.steps[0].commentaries[0].audio[0].file_id.includes(imported._id)); validateGame(imported)
	assert.throws(() => importGame({ ...game, current_fen: game.initial_position.fen }), /不一致/)
})
test('超大记录外置为带校验的完整档案，仍保持一局一条', async t => {
	const { store, runner, config } = await fixture(t); await runner.tick()
	const game = structuredClone(runner.current); const small = { ...config, inlineLimit: 100 }
	await saveGame(store, game, runner.lease, small)
	const raw = await store.request('games.get', { id: game._id }); assert.equal(raw.archive.mode, 'file'); assert.equal(raw.steps.length, 0)
	const full = await loadGame(store, game._id, small); assert.equal(full.steps.length, 1); validateGame(full)
})
