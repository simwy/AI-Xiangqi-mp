'use strict'
const crypto = require('crypto')
const clone = value => JSON.parse(JSON.stringify(value))
function fault(message, code = 'INVALID') { const error = new Error(message); error.code = code; throw error }
const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id)
const gameSummary = g => ({ _id: g._id, title: g.title, type: g.type, status: g.status, players: g.players, ply_count: g.ply_count, created_at: g.created_at, result: g.result, demo: g.demo })

// Shared by the real uniCloud gateway and the explicitly separate local demo adapter.
exports.createOperations = repo => async function execute(op, args = {}) {
	const now = Date.now()
	if (op === 'models.list') return repo.query('xq_models', {}, { limit: 100, sort: ['sort_order', 'asc'] })
	if (op === 'games.get') return repo.get('xq_games', args.id)
	if (op === 'games.list') return (await repo.query('xq_games', {}, { limit: Math.min(50, args.limit || 20), skip: args.skip || 0, sort: ['created_at', 'desc'] })).map(gameSummary)
	if (op === 'runtime.get') return repo.get('xq_runtime', 'global')
	if (op === 'votes.list') return repo.query('xq_votes', { round_id: args.round_id }, { limit: 10000 })
	if (op === 'votes.counts') { const runtime = await repo.get('xq_runtime', 'global'); return runtime?.current_game_id === args.round_id ? runtime.vote_counts || {} : {} }
	if (!['models.save', 'games.create', 'games.save', 'runtime.acquire', 'runtime.renew', 'runtime.release', 'runtime.queue', 'round.close', 'vote', 'requests.claim'].includes(op)) fault('不支持的存储操作')
	return repo.transaction(async tx => {
		if (op === 'requests.claim') {
			if (!idOK(args.id)) fault('请求编号无效')
			if (await tx.get('xq_requests', args.id)) fault('请求已使用', 'REPLAY')
			await tx.insert('xq_requests', { _id: args.id, expires_at: now + 300000 })
			return true
		}
		if (op === 'models.save') {
			if (!idOK(args.model?._id)) fault('模型 ID 无效')
			const previous = await tx.get('xq_models', args.model._id)
			if (args.expected_revision !== undefined && args.expected_revision !== (previous?.revision || 0)) fault('模型配置已变更', 'CONFLICT')
			const model = { ...args.model, revision: (previous?.revision || 0) + 1, updated_at: now, created_at: previous?.created_at || now }
			await tx.put('xq_models', model)
			return model
		}
		let runtime = await tx.get('xq_runtime', 'global') || { _id: 'global', version: 0, owner: '', lease_until: 0, fence: 0, current_game_id: '', queued_game_id: '', round_open: false }
		const assertLease = () => { if (runtime.owner !== args.owner || runtime.fence !== args.fence || runtime.lease_until <= now) fault('调度租约失效', 'LEASE_LOST') }
		const putRuntime = async () => { runtime.version++; await tx.put('xq_runtime', runtime); return runtime }
		if (op === 'runtime.acquire') {
			if (!idOK(args.owner)) fault('运行实例 ID 无效')
			if (runtime.lease_until > now && runtime.owner !== args.owner) fault('已有调度实例运行', 'LEASE_BUSY')
			if (runtime.owner !== args.owner || runtime.lease_until <= now) runtime.fence++
			runtime.owner = args.owner; runtime.lease_until = now + 90000
			return putRuntime()
		}
		if (op === 'runtime.renew') { assertLease(); runtime.lease_until = now + 90000; return putRuntime() }
		if (op === 'runtime.release') { assertLease(); runtime.lease_until = 0; return putRuntime() }
		if (op === 'runtime.queue') {
			const game = await tx.get('xq_games', args.game_id)
			if (!game || !['draft', 'queued', 'imported'].includes(game.status) || game.ply_count) fault('请选择尚未开始的棋局草稿')
			runtime.queued_game_id = game._id
			return putRuntime()
		}
		if (op === 'round.close') { assertLease(); runtime.round_open = false; return putRuntime() }
		if (op === 'games.create') {
			const game = clone(args.game)
			if (!idOK(game?._id) || await tx.get('xq_games', game._id)) fault('棋局 ID 已存在或无效', 'CONFLICT')
			if (args.activate) {
				assertLease()
				const current = runtime.current_game_id && await tx.get('xq_games', runtime.current_game_id)
				if (current && current.status !== 'finished') fault('当前棋局尚未结束', 'CONFLICT')
				runtime.current_game_id = game._id; runtime.round_open = true; runtime.vote_counts = {}
				if (runtime.queued_game_id === game.source?.queued_id) runtime.queued_game_id = ''
				await putRuntime()
			}
			game.version = 0; game.created_at = now; game.updated_at = now
			await tx.insert('xq_games', game)
			return game
		}
		if (op === 'games.save') {
			if (args.worker) assertLease()
			const old = await tx.get('xq_games', args.game?._id)
			if (!old || old.version !== args.expected_version) fault('棋局版本冲突', 'CONFLICT')
			if (args.worker && runtime.current_game_id !== old._id) fault('当前局已改变', 'CONFLICT')
			const game = { ...clone(args.game), version: old.version + 1, updated_at: now }
			await tx.put('xq_games', game)
			return game
		}
		if (op === 'vote') {
			if (!runtime.round_open || runtime.current_game_id !== args.round_id) fault('本轮投票已结束', 'ROUND_CLOSED')
			if (!/^[a-f0-9]{64}$/.test(args.visitor_hash || '')) fault('投票身份无效')
			const model = await tx.get('xq_models', args.model_id)
			if (!model?.enabled || !model.can_play || !model.allow_vote || (!model.api_key && !model.api_key_env && !model.demo)) fault('该模型不参与本轮投票')
			const voteId = crypto.createHash('sha256').update(args.round_id + ':' + args.visitor_hash).digest('hex')
			if (await tx.get('xq_votes', voteId)) fault('本轮已经投过票', 'ALREADY_VOTED')
			await tx.insert('xq_votes', { _id: voteId, round_id: args.round_id, model_id: args.model_id, created_at: now })
			runtime.vote_counts ||= {}; runtime.vote_counts[args.model_id] = (runtime.vote_counts[args.model_id] || 0) + 1
			await putRuntime()
			return { accepted: true }
		}
	})
}

exports.gameSummary = gameSummary
