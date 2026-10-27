import crypto from 'node:crypto'
import { INITIAL_FEN, validatePosition, validateGame, toFen } from '../common/xiangqi/rules.mjs'
import { modelSnapshot } from './models.mjs'
import { AppError } from './store.mjs'
export const uid = prefix => prefix + '-' + crypto.randomUUID()
export function newGame({ title = 'AI 象棋对局', type = 'standard', fen = INITIAL_FEN, red, black, source = {}, demo = false }) {
	let position
	try { position = validatePosition(fen) } catch (error) { throw new AppError(error.message) }
	const initial = toFen(position)
	return { _id: uid('game'), schema_version: 1, title: String(title).slice(0, 200), type, status: 'draft', version: 0, players: red && black ? { red: modelSnapshot(red), black: modelSnapshot(black) } : {}, initial_position: { fen: initial, side_to_move: position.side }, current_fen: initial, ply_count: 0, last_event_seq: 0, steps: [], calls: [], commentaries: [], events: [], source, result: {}, archive: { mode: 'inline' }, rules: { id: 'xiangqi-simplified-v1', repetition: 3, no_capture_plies: 120, max_plies: 400 }, demo, created_at: Date.now() }
}
export function addEvent(game, type, data = {}, step) {
	const event = { id: uid('event'), seq: ++game.last_event_seq, type, offset_ms: Math.max(0, Date.now() - (game.started_at || game.created_at)), occurred_at: Date.now(), ...(step ? { step_seq: step.seq } : {}), data }
	;(step ? step.events : game.events).push(event)
	return event
}
export function publicGame(game) {
	if (!game) return null
	const g = structuredClone(game)
	delete g.lease; delete g.export
	const cleanCalls = calls => (calls || []).map(c => { const r = { ...c }; delete r.final_output; return r })
	g.calls = cleanCalls(g.calls)
	for (const step of g.steps) step.calls = cleanCalls(step.calls)
	if (g.pending_step) g.pending_step.calls = cleanCalls(g.pending_step.calls)
	return g
}
export function importGame(input) {
	if (!input || typeof input !== 'object') throw new AppError('棋局 JSON 无效')
	try { validateGame(input) } catch (error) { throw new AppError(error.message) }
	const g = structuredClone(input)
	// Only canonical archive fields are accepted; arbitrary imported config is never executed.
	const allowed = ['schema_version', 'title', 'type', 'players', 'initial_position', 'current_fen', 'steps', 'calls', 'commentaries', 'events', 'result', 'rules', 'demo', 'started_at', 'finished_at']
	const out = Object.fromEntries(allowed.filter(k => Object.hasOwn(g, k)).map(k => [k, g[k]]))
	if (typeof out.title !== 'string' || !out.title.trim()) out.title = '导入棋局'
	out.title = out.title.slice(0, 200); out.type = ['standard', 'endgame', 'continuation'].includes(out.type) ? out.type : 'standard'
	out._id = uid('game'); out.version = 0; out.status = 'imported'; out.ply_count = out.steps.length
	out.calls ||= []; out.commentaries ||= []; out.events ||= []; out.archive = { mode: 'inline' }
	for (const key of ['started_at', 'finished_at']) if (out[key] !== undefined && (!Number.isSafeInteger(out[key]) || out[key] < 0)) throw new AppError('棋局时间戳无效')
	out.source = { kind: 'json', original_id: String(input._id || '').slice(0, 100), imported_at: Date.now() }
	out.created_at = Date.now(); out.last_event_seq = 0
	const ids = new Set(), eventSeqs = new Set()
	const checkEntries = (calls, comments, events) => {
		if (![calls, comments, events].every(x => x === undefined || Array.isArray(x))) throw new AppError('调用、解说和事件必须为数组')
		for (const item of [...(calls || []), ...(comments || []), ...(events || [])]) {
			if (!item || typeof item.id !== 'string' || ids.has(item.id)) throw new AppError('档案资源 ID 重复或无效')
			ids.add(item.id)
			if (JSON.stringify(item).match(/"(?:api_key|authorization|reasoning_content)"\s*:/i)) throw new AppError('导入档案不能包含凭据或私有推理')
		}
		for (const event of events || []) {
			if (!Number.isSafeInteger(event.seq) || event.seq < 1 || eventSeqs.has(event.seq) || !Number.isFinite(event.offset_ms) || event.offset_ms < 0) throw new AppError('事件序号或时间线无效')
			eventSeqs.add(event.seq); out.last_event_seq = Math.max(out.last_event_seq, event.seq)
		}
		for (const comment of comments || []) {
			if (typeof comment.text !== 'string' || comment.text.length > 10000) throw new AppError('解说文本无效')
			if (comment.audio !== undefined && !Array.isArray(comment.audio)) throw new AppError('语音索引必须为数组')
			for (const audio of comment.audio || []) {
				if (!audio.id || ids.has(audio.id)) throw new AppError('音频 ID 重复或无效')
				ids.add(audio.id)
			}
		}
	}
	checkEntries(out.calls, out.commentaries, out.events)
	for (const s of out.steps) checkEntries(s.calls, s.commentaries, s.events)
	for (const side of ['red', 'black']) {
		const player = out.players?.[side]
		if (player) out.players[side] = Object.fromEntries(['model_id', 'display_name', 'avatar_url', 'model_name', 'model_revision', 'thinking_mode', 'reasoning_effort'].filter(k => Object.hasOwn(player, k)).map(k => [k, player[k]]))
	}
	return out
}
export const allCommentaries = game => [...(game.commentaries || []), ...game.steps.flatMap(s => s.commentaries || [])]
export const allEvents = game => [...(game.events || []), ...game.steps.flatMap(s => s.events || [])].sort((a, b) => a.seq - b.seq)
