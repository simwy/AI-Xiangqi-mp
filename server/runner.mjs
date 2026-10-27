import { performance } from 'node:perf_hooks'
import { parseFen, legalMoves, applyMove, toFen, opposite } from '../common/xiangqi/rules.mjs'
import { newGame, addEvent } from './game.mjs'
import { uid } from './game.mjs'
import { callModel, modelSnapshot } from './models.mjs'
import { loadGame, saveGame, hash } from './archive.mjs'
import { synthesize } from './speech.mjs'
import { AppError } from './store.mjs'

export class Runner {
	constructor(store, config, { modelCall = callModel, speech = synthesize } = {}) {
		this.store = store; this.config = config; this.modelCall = modelCall; this.speech = speech
		this.owner = uid('worker'); this.lease = null; this.stopped = true; this.current = null
		this.state = { status: 'starting', message: '正在连接存储', game: null, mode: config.mode }
	}
	async seedDemo() {
		if (this.config.mode !== 'demo' || (await this.store.request('models.list')).length) return
		for (const [id, name, order] of [['demo-doubao', '豆包 · 演示', 0], ['demo-deepseek', 'DeepSeek · 演示', 1]]) {
			await this.store.request('models.save', { model: { _id: id, display_name: name, avatar_url: id.includes('deepseek') ? '/static/xiangqi/deepseek.svg' : '/static/xiangqi/reference.png', model_name: 'deterministic-demo', base_url: 'https://example.invalid/v1', demo: true, enabled: true, can_play: true, can_commentate: false, allow_vote: true, sort_order: order, thinking_mode: 'default', thinking_adapter: 'none', max_attempts: 1 } })
		}
	}
	publish(game, status, message) { this.current = game ? structuredClone(game) : null; this.state = { game: this.current, status: status || (game?.retry_after > Date.now() ? 'paused' : game?.status) || 'waiting', message: message || game?.pause_reason || '', mode: this.config.mode, server_time: Date.now() } }
	async save(game) {
		if (!this.lease) throw new AppError('调度租约不可用', 'LEASE_LOST', 503)
		await saveGame(this.store, game, this.lease, this.config)
		this.publish(game)
		return game
	}
	async start() {
		await this.seedDemo(); this.stopped = false
		this.renewTimer = setInterval(async () => {
			if (!this.lease || this.renewing) return
			this.renewing = true
			try { await this.store.request('runtime.renew', this.lease) } catch { this.lease = null }
			finally { this.renewing = false }
		}, 20000)
		this.loopPromise = this.loop()
	}
	async stop() {
		this.stopped = true; clearInterval(this.renewTimer)
		await this.loopPromise
		if (this.lease) await this.store.request('runtime.release', this.lease).catch(() => {})
	}
	async loop() {
		while (!this.stopped) {
			try { await this.tick() }
			catch (error) {
				this.publish(this.current, 'paused', error.code === 'CONFLICT' ? '棋局已被后台修改，正在重新同步' : error.code === 'LEASE_BUSY' ? '另一个实例正在调度，本实例等待接管' : '对局暂停：存储或服务暂不可用，正在重试')
				if (['LEASE_LOST', 'LEASE_BUSY'].includes(error.code)) this.lease = null
				console.error('[runner]', error.code || 'ERROR')
			}
			await new Promise(resolve => setTimeout(resolve, this.config.tickMs || 1000))
		}
	}
	async tick() {
		if (this.ticking) return
		this.ticking = true
		try { return await this.performTick() } finally { this.ticking = false }
	}
	async performTick() {
		if (!this.lease) {
			const runtime = await this.store.request('runtime.acquire', { owner: this.owner })
			this.lease = { owner: this.owner, fence: runtime.fence }
		}
		const runtime = await this.store.request('runtime.get')
		let game = runtime?.current_game_id ? await loadGame(this.store, runtime.current_game_id, this.config) : null
		if (game) {
			let recovered = false
			for (const container of [game, ...game.steps]) {
				for (const call of container.calls || []) if (call.status === 'running') { call.status = 'interrupted'; call.finished_at = Date.now(); call.error = { code: 'PROCESS_INTERRUPTED' }; recovered = true }
				for (const comment of container.commentaries || []) {
					if (comment.status === 'pending') { comment.status = 'failed'; recovered = true }
					for (const audio of comment.audio || []) if (['synthesizing', 'uploading'].includes(audio.status)) { audio.status = 'failed'; audio.error = { code: 'PROCESS_INTERRUPTED', message: '进程中断，请在后台重试或按 cloud_path 检查已上传文件' }; recovered = true }
				}
			}
			if (recovered) await this.save(game)
		}
		if (!game || game.status === 'finished') {
			if (game && Date.now() - game.finished_at < this.config.betweenGamesMs) { this.publish(game); return }
			return this.beginGame(runtime, game)
		}
		this.publish(game)
		if (game.status !== 'playing' || game.retry_after > Date.now()) return
		// A pending call from a previous process is retained as interrupted.
		if (game.pending_step?.status === 'running') {
			for (const call of game.pending_step.calls || []) if (call.status === 'running') { call.status = 'interrupted'; call.finished_at = Date.now(); call.error = { code: 'PROCESS_INTERRUPTED', message: '执行中断后恢复' } }
			game.pending_step.status = 'interrupted'; addEvent(game, 'resume', { reason: 'process_recovery' }); await this.save(game)
		}
		if (game.next_move_at > Date.now()) return
		await this.playTurn(game)
	}
	async beginGame(runtime, previous) {
		const models = (await this.store.request('models.list')).filter(m => m.enabled && m.can_play && (m.api_key || m.api_key_env || this.config.mode === 'demo' && m.demo))
		if (models.length < 2) { this.publish(previous, 'needs_configuration', '请在后台配置至少两个可用棋手模型'); return }
		await this.store.request('round.close', this.lease)
		const scores = previous ? await this.store.request('votes.counts', { round_id: previous._id }) : {}
		if (previous) { previous.vote_counts = scores; await this.save(previous) }
		models.sort((a, b) => (scores[b._id] || 0) - (scores[a._id] || 0) || (a.sort_order || 0) - (b.sort_order || 0) || a._id.localeCompare(b._id))
		let selected = models.slice(0, 2)
		if (previous?.players.red.model_id === selected[0]._id) selected.reverse()
		const queued = runtime?.queued_game_id ? await loadGame(this.store, runtime.queued_game_id, this.config) : null
		if (queued?.players?.red?.model_id && queued?.players?.black?.model_id) {
			selected = [models.find(m => m._id === queued.players.red.model_id), models.find(m => m._id === queued.players.black.model_id)]
			if (selected.some(m => !m) || selected[0]._id === selected[1]._id) { this.publish(previous, 'needs_configuration', '待播棋局的双方模型不可用，请修改后台排期'); return }
		}
		const g = newGame({ title: queued?.title || 'AI 象棋持续对局', type: queued?.type || 'standard', fen: queued?.initial_position.fen, red: selected[0], black: selected[1], source: queued ? { ...queued.source, queued_id: queued._id } : { kind: 'new' }, demo: this.config.mode === 'demo' })
		g.status = 'playing'; g.started_at = Date.now(); g.next_move_at = Date.now() + this.config.moveIntervalMs
		addEvent(g, 'resume', { opening: true })
		const saved = await this.store.request('games.create', { game: g, activate: true, ...this.lease })
		this.publish(saved)
		await this.commentate(saved, null, `${selected[0].display_name}执红，${selected[1].display_name}执黑，${queued ? '从指定局面开始。' : '红方先行。'}`)
	}
	async playTurn(game) {
		const position = parseFen(game.current_fen), moves = legalMoves(position)
		if (!moves.length) return this.finish(game, opposite(position.side), '无合法着法')
		const model = (await this.store.request('models.list')).find(m => m._id === game.players[position.side].model_id && m.enabled && m.can_play)
		if (!model) { game.status = 'paused'; game.pause_reason = '当前棋手模型已停用'; await this.save(game); return }
		const retained = game.pending_step?.calls || [], retainedCount = retained.length, started = performance.now()
		game.pending_step = { seq: game.ply_count + 1, side: position.side, status: 'running', started_at: Date.now(), model: modelSnapshot(model), calls: retained }
		addEvent(game, 'thinking_started', { side: position.side, model_id: model._id })
		await this.save(game)
		let selected, lastError
		for (let attempt = 1; attempt <= (model.max_attempts || 3); attempt++) {
			if (this.stopped || !this.lease) throw new AppError('调度已停止', 'LEASE_LOST')
			const call = { id: uid('call'), purpose: 'move', attempt: retainedCount + attempt, model_id: model._id, model_revision: model.revision, thinking_mode: model.thinking_mode || 'default', reasoning_effort: model.reasoning_effort || '', status: 'running', started_at: Date.now() }
			call.model_snapshot = modelSnapshot(model)
			call.request_settings = { thinking_adapter: model.thinking_adapter || 'none', max_tokens: model.max_tokens || 4096, token_limit_field: model.token_limit_field || 'max_tokens', timeout_ms: model.timeout_ms || 45000, temperature: model.temperature, disabled_effort: model.disabled_effort }
			game.pending_step.calls.push(call); await this.save(game)
			const t = performance.now()
			try {
				if (this.config.mode === 'demo' && model.demo) {
					await new Promise(resolve => setTimeout(resolve, this.config.demoThinkMs))
					const ranked = moves.map(m => ({ m, score: (position.board.some(p => p.x === m.to[0] && p.y === m.to[1]) ? 100 : 0) + (4 - Math.abs(4 - m.to[0])) + ((game.ply_count * 17 + Number(m.id.replace(/\D/g, ''))) % 13) }))
					ranked.sort((a, b) => b.score - a.score); selected = ranked[0].m
				} else {
					const result = await this.modelCall(model, [
						{ role: 'system', content: '你是中国象棋棋手。只能从合法候选中选择一步。返回严格 JSON：{"move_id":"候选ID"}。不要返回推理过程。' },
						{ role: 'user', content: JSON.stringify({ side: position.side, fen: game.current_fen, recent_moves: game.steps.slice(-12).map(s => s.notation), legal_moves: moves.map(m => ({ id: m.id, from: m.from, to: m.to })), previous_error: lastError?.code || undefined }) }
					], this.config)
					let parsed
					try { parsed = JSON.parse(result.text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) } catch { throw new AppError('着法回答不是 JSON', 'MODEL_OUTPUT') }
					selected = moves.find(m => m.id === parsed.move_id)
					if (!selected) throw new AppError('模型选择了非法着法', 'ILLEGAL_MOVE')
					call.usage = result.usage; call.provider_request_id = result.request_id; call.final_output = JSON.stringify({ move_id: selected.id })
				}
				call.status = 'succeeded'
			} catch (error) {
				lastError = error; selected = null; call.status = 'failed'; call.error = { code: error.code || 'MODEL_ERROR', message: ['ILLEGAL_MOVE', 'MODEL_OUTPUT', 'MODEL_TIMEOUT'].includes(error.code) ? error.message : '模型调用未成功，请检查服务配置或供应商状态' }
			} finally { call.finished_at = Date.now(); call.duration_ms = Math.round(performance.now() - t) }
			await this.save(game)
			if (selected || lastError?.code === 'MODEL_CONFIG') break
		}
		if (!selected) {
			game.pending_step.status = 'failed'
			if (['ILLEGAL_MOVE', 'MODEL_OUTPUT', 'MODEL_TIMEOUT'].includes(lastError?.code)) return this.finish(game, opposite(position.side), lastError.code === 'MODEL_TIMEOUT' ? '模型超时' : '模型连续返回非法或无效着法')
			game.retry_after = Date.now() + 30000; game.pause_reason = '模型服务不可用，30 秒后重试'; addEvent(game, 'error', { code: lastError?.code || 'MODEL_UNAVAILABLE' }); await this.save(game); return
		}
		const validationStart = performance.now(), result = applyMove(position, selected)
		const step = { seq: game.ply_count + 1, side: position.side, move: { ...selected, ...(result.captured ? { captured_piece_id: result.captured.id } : {}) }, notation: result.notation, fen_before: game.current_fen, fen_after: toFen(result.position), committed_at: Date.now(), decision_ms: Math.round(performance.now() - started), validation_ms: Math.round(performance.now() - validationStart), calls: game.pending_step.calls, commentaries: [], events: [], outcome: { check: result.check, terminal: result.terminal } }
		game.steps.push(step); game.current_fen = step.fen_after; game.ply_count++; delete game.pending_step; delete game.pause_reason; delete game.retry_after
		addEvent(game, 'thinking_finished', { duration_ms: step.decision_ms }, step)
		addEvent(game, 'move', { from: selected.from, to: selected.to, notation: step.notation }, step)
		if (result.captured) addEvent(game, 'capture', { piece: result.captured.type }, step)
		if (result.check) addEvent(game, 'check', { side: result.position.side }, step)
		const key = fen => fen.split(' ').slice(0, 2).join(' '), repeated = [game.initial_position.fen, ...game.steps.map(s => s.fen_after)].filter(f => key(f) === key(game.current_fen)).length
		if (result.terminal) { game.status = 'finished'; game.result = { winner: position.side, reason: result.check ? '将死' : '无合法着法' }; if (result.check) addEvent(game, 'checkmate', { winner: position.side }, step) }
		else if (repeated >= 3 || result.position.halfmove >= 120 || game.ply_count >= 400) { game.status = 'finished'; game.result = { winner: 'draw', reason: repeated >= 3 ? '三次重复局面（简化规则）' : result.position.halfmove >= 120 ? '连续120半回合未吃子' : '达到400半回合上限' } }
		if (game.status === 'finished') { game.finished_at = Date.now(); addEvent(game, 'finished', game.result) }
		game.next_move_at = Date.now() + this.config.moveIntervalMs
		// The new board is published only after this durable commit succeeds.
		await this.save(game)
		await this.commentate(game, step, `${step.notation}。${result.captured ? '吃子。' : ''}${result.check ? '将军！' : ''}${game.status === 'finished' ? '本局结束，' + game.result.reason + '。' : ''}`)
	}
	async finish(game, winner, reason) { game.status = 'finished'; game.result = { winner, reason }; game.finished_at = Date.now(); addEvent(game, 'finished', game.result); await this.save(game); await this.commentate(game, null, '本局结束，' + reason + '。') }
	async commentate(game, step, fallback) {
		const container = step || game, comment = { id: uid('comment'), type: step ? 'move' : game.status === 'finished' ? 'summary' : 'opening', revision: 1, status: 'pending', text: '', created_at: Date.now(), audio: [], selected_for_live: true, is_fallback: true }
		container.commentaries.push(comment); await this.save(game)
		let text = fallback
		const narrator = (await this.store.request('models.list')).find(m => m.enabled && m.can_commentate && (m.api_key || m.api_key_env))
		if (narrator && this.config.mode === 'live') {
			const call = { id: uid('call'), purpose: 'commentary', attempt: 1, model_id: narrator._id, model_revision: narrator.revision, thinking_mode: narrator.thinking_mode, started_at: Date.now(), status: 'running' }
			call.model_snapshot = modelSnapshot(narrator)
			container.calls.push(call); comment.model_call_id = call.id; await this.save(game)
			const t = performance.now()
			try {
				const response = await this.modelCall(narrator, [{ role: 'system', content: '你是女性象棋解说。根据已确认事实用一两句中文解说，不超过70字。不虚构棋力分数、胜率或未经证实的叫杀，不输出推理。' }, { role: 'user', content: JSON.stringify({ fen: game.current_fen, move: step?.notation, facts: fallback }) }], this.config)
				text = response.text.slice(0, 160); comment.is_fallback = false; call.status = 'succeeded'; call.usage = response.usage
			} catch { call.status = 'failed'; call.error = { code: 'COMMENTARY_FAILED', message: '解说调用失败，使用规则报招' } }
			call.finished_at = Date.now(); call.duration_ms = Math.round(performance.now() - t); comment.generation_ms = call.duration_ms
		}
		comment.text = text; comment.status = 'ready'; addEvent(game, 'commentary', { commentary_id: comment.id }, step); await this.save(game)
		if (!this.config.ttsAppId || this.config.mode === 'demo') return
		const audio = { id: uid('audio'), status: 'synthesizing', voice_id: this.config.ttsVoice, tts_model: this.config.ttsResource, format: 'mp3', created_at: Date.now(), played_in_live: false }
		comment.audio.push(audio); await this.save(game)
		const t = performance.now()
		try {
			const result = await this.speech(text, this.config)
			if (!result) throw new Error('语音配置不完整')
			audio.generation_ms = Math.round(performance.now() - t); audio.status = 'uploading'; audio.cloud_path = `xiangqi/${game._id}/${audio.id}.mp3`; await this.save(game)
			const uploadStart = performance.now(), stored = await this.store.request('audio.upload', { path: audio.cloud_path, data: result.data.toString('base64') })
			audio.file_id = stored.file_id; audio.sha256 = hash(result.data); audio.size_bytes = result.data.length; if (result.duration_ms != null) audio.duration_ms = result.duration_ms
			audio.upload_ms = Math.round(performance.now() - uploadStart); audio.status = 'ready'; audio.playback_offset_ms = Date.now() - game.started_at + 1200; audio.played_in_live = true
			const event = addEvent(game, 'audio', { audio_id: audio.id, commentary_id: comment.id }, step); event.offset_ms = audio.playback_offset_ms
		} catch { audio.status = 'failed'; audio.error = { code: 'TTS_FAILED', message: '语音生成或归档失败，可在后台重试' } }
		await this.save(game)
	}
}
