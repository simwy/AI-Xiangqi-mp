import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { configuration } from './config.mjs'
import { openStore, AppError } from './store.mjs'
import { Runner } from './runner.mjs'
import { publicGame, newGame, importGame, allCommentaries, uid } from './game.mjs'
import { publicModel, adminModel, validateModel, validateTarget, callModel } from './models.mjs'
import { loadGame, saveGame, createGame, exportZip, importZip, hash } from './archive.mjs'
import { toFen, parseFen } from '../common/xiangqi/rules.mjs'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
const json = (response, value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(value)) }
async function body(request, limit = 4 * 1024 * 1024, raw = false) {
	let size = 0; const chunks = []
	for await (const chunk of request) { size += chunk.length; if (size > limit) throw new AppError('请求体过大', 'TOO_LARGE', 413); chunks.push(chunk) }
	const buffer = Buffer.concat(chunks)
	if (raw) return buffer
	try { return buffer.length ? JSON.parse(buffer.toString()) : {} } catch { throw new AppError('请求 JSON 无效') }
}
export async function createApplication(config, overrides = {}) {
	const store = overrides.store || await openStore(config), runner = overrides.runner || new Runner(store, config)
	await fs.mkdir(config.dataDirectory, { recursive: true })
	let visitorSecret = config.visitorSecret
	if (!visitorSecret && config.mode === 'demo') {
		const file = path.join(config.dataDirectory, '.visitor-secret')
		try { visitorSecret = await fs.readFile(file, 'utf8') } catch { visitorSecret = crypto.randomBytes(32).toString('hex'); await fs.writeFile(file, visitorSecret, { mode: 0o600 }) }
	}
	const sessions = {
		issue() { const value = Buffer.from(JSON.stringify({ id: crypto.randomBytes(24).toString('hex'), exp: Date.now() + 30 * 86400000 })).toString('base64url'); return value + '.' + crypto.createHmac('sha256', visitorSecret).update(value).digest('base64url') },
		read(token) { const [value, sign] = String(token || '').split('.'); if (!value || !same(sign, crypto.createHmac('sha256', visitorSecret).update(value).digest('base64url'))) throw new AppError('请重新获取投票会话', 'SESSION_INVALID', 401); let data; try { data = JSON.parse(Buffer.from(value, 'base64url').toString()) } catch { throw new AppError('投票会话无效') } if (data.exp < Date.now() || !/^[a-f0-9]{48}$/.test(data.id || '')) throw new AppError('投票会话已过期', 'SESSION_INVALID', 401); return crypto.createHash('sha256').update(data.id).digest('hex') }
	}
	const limits = new Map(), jobs = new Map(); let exporting = false
	function rate(key, limit) {
		const now = Date.now(), row = limits.get(key)
		if (!row || row.until < now) limits.set(key, { until: now + 60000, count: 1 })
		else if (++row.count > limit) throw new AppError('操作过于频繁，请稍后再试', 'RATE_LIMIT', 429)
		if (limits.size > 20000) for (const [k, v] of limits) if (v.until < now) limits.delete(k)
	}
	async function fetchGame(id) { const game = await loadGame(store, id, config); if (!game) throw new AppError('棋局不存在', 'NOT_FOUND', 404); return game }
	const server = http.createServer(async (req, res) => {
		try {
			res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer')
			const origin = req.headers.origin
			if (origin && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host && !config.allowedOrigins.includes(origin)) throw new AppError('不允许的网页来源', 'FORBIDDEN', 403)
			if (origin) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); res.setHeader('access-control-allow-headers', 'content-type,authorization,x-visitor-token'); res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS') }
			if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
			const url = new URL(req.url, 'http://localhost'), pathname = url.pathname
			rate(req.socket.remoteAddress || 'local', 600)
			if (pathname.startsWith('/api/admin/')) {
				if (!config.adminToken || !same(req.headers.authorization, 'Bearer ' + config.adminToken)) throw new AppError('管理员身份无效或尚未配置 ADMIN_TOKEN', 'UNAUTHORIZED', 401)
			}
			if (pathname === '/api/health') return json(res, { ok: true, mode: config.mode, status: runner.state.status })
			if (pathname === '/api/live' && req.method === 'GET') {
				const current = runner.current, { game: omitted, ...state } = runner.state
				const previousVersion = Number(url.searchParams.get('version')), previousPly = Number(url.searchParams.get('ply'))
				if (current && url.searchParams.get('game_id') === current._id && previousVersion === current.version) return json(res, { ...state, server_time: Date.now(), unchanged: true })
				const game = publicGame(current)
				let stepsFrom
				if (game && url.searchParams.get('game_id') === game._id && Number.isInteger(previousPly) && previousPly > 0 && previousPly < game.steps.length) { stepsFrom = Math.max(0, previousPly - 1); game.steps = game.steps.slice(stepsFrom) }
				return json(res, { ...state, server_time: Date.now(), game, ...(stepsFrom !== undefined ? { steps_from_index: stepsFrom } : {}) })
			}
			if (pathname === '/api/models' && req.method === 'GET') return json(res, (await store.request('models.list')).filter(m => m.enabled).map(publicModel))
			if (pathname === '/api/games' && req.method === 'GET') return json(res, await store.request('games.list', { skip: Math.max(0, Math.min(100000, Number(url.searchParams.get('skip')) || 0)), limit: 20 }))
			let match = pathname.match(/^\/api\/games\/([\w-]+)$/)
			if (match && req.method === 'GET') return json(res, publicGame(await fetchGame(match[1])))
			match = pathname.match(/^\/api\/games\/([\w-]+)\/audio\/([\w-]+)$/)
			if (match && req.method === 'GET') {
				const game = await fetchGame(match[1]), audio = allCommentaries(game).flatMap(c => c.audio || []).find(a => a.id === match[2] && a.status === 'ready')
				if (!audio?.file_id) throw new AppError('语音文件尚不可用', 'NOT_FOUND', 404)
				const urls = await store.request('audio.urls', { file_ids: [audio.file_id] }); return json(res, { url: urls[0]?.url || '', duration_ms: audio.duration_ms ?? null })
			}
			if (pathname === '/api/session' && req.method === 'POST') { rate('session:' + req.socket.remoteAddress, 20); return json(res, { token: sessions.issue() }) }
			if (pathname === '/api/votes' && req.method === 'GET') {
				const runtime = await store.request('runtime.get'), counts = runtime?.vote_counts || {}
				return json(res, { round_id: runtime?.current_game_id || '', open: !!runtime?.round_open, counts })
			}
			if (pathname === '/api/votes' && req.method === 'POST') {
				rate('vote:' + req.socket.remoteAddress, 10); const input = await body(req, 2048), visitor = sessions.read(req.headers['x-visitor-token'])
				return json(res, await store.request('vote', { round_id: input.round_id, model_id: input.model_id, visitor_hash: visitor }))
			}
			if (pathname === '/api/admin/models' && req.method === 'GET') return json(res, (await store.request('models.list')).map(adminModel))
			if (pathname === '/api/admin/models' && req.method === 'POST') {
				const input = await body(req, 20000), previous = (await store.request('models.list')).find(m => m._id === input._id)
				const model = validateModel(input, previous, config.masterKey)
				if (model.enabled) await validateTarget(model.base_url, config.allowPrivateModels)
				return json(res, adminModel(await store.request('models.save', { model, expected_revision: input.revision ?? previous?.revision ?? 0 })))
			}
			match = pathname.match(/^\/api\/admin\/models\/([\w-]+)\/test$/)
			if (match && req.method === 'POST') {
				const model = (await store.request('models.list')).find(m => m._id === match[1]); if (!model || model.demo) throw new AppError('请选择真实模型配置')
				const t = Date.now(), result = await callModel(model, [{ role: 'user', content: '请只回复 OK。' }], config)
				return json(res, { ok: true, duration_ms: Date.now() - t, text: result.text.slice(0, 300), usage: result.usage })
			}
			if (pathname === '/api/admin/games' && req.method === 'GET') return json(res, await store.request('games.list', { limit: 50 }))
			if (pathname === '/api/admin/games' && req.method === 'POST') {
				const input = await body(req, 4000), models = await store.request('models.list'), red = models.find(m => m._id === input.red), black = models.find(m => m._id === input.black)
				if (!red || !black || red._id === black._id) throw new AppError('请选择两个不同模型')
				const game = newGame({ title: input.title, type: input.fen ? 'endgame' : 'standard', fen: input.fen || undefined, red, black, source: { kind: input.fen ? 'fen' : 'new' }, demo: config.mode === 'demo' })
				return json(res, await createGame(store, game, config))
			}
			if (pathname === '/api/admin/import' && req.method === 'POST') {
				const zipped = req.headers['content-type']?.includes('application/zip')
				const game = zipped ? await importZip(await body(req, 64 * 1024 * 1024, true), store) : importGame(await body(req, 16 * 1024 * 1024))
				if (!zipped && allCommentaries(game).some(c => c.audio?.some(a => a.status === 'ready'))) throw new AppError('带原声的棋局请使用包含音频的 ZIP 导入，以重新关联文件')
				return json(res, await createGame(store, game, config))
			}
			match = pathname.match(/^\/api\/admin\/games\/([\w-]+)(?:\/(queue|continue|export|retry-audio))?$/)
			if (match) {
				const game = await fetchGame(match[1]), action = match[2]
				if (!action && req.method === 'GET') return json(res, game)
				if (!action && req.method === 'PATCH') {
					const input = await body(req, 1000), runtime = await store.request('runtime.get')
					if (!['playing', 'paused'].includes(input.status) || !['playing', 'paused'].includes(game.status) || runtime?.current_game_id !== game._id) throw new AppError('仅可暂停或恢复当前对局')
					game.status = input.status; delete game.retry_after; await saveGame(store, game, null, config); return json(res, { ok: true })
				}
				if (action === 'queue' && req.method === 'POST') return json(res, await store.request('runtime.queue', { game_id: game._id }))
				if (action === 'continue' && req.method === 'POST') {
					const input = await body(req, 3000), seq = input.step_seq ?? game.steps.length
					if (!Number.isInteger(seq) || seq < 0 || seq > game.steps.length) throw new AppError('续弈步号无效')
					const models = await store.request('models.list'), red = models.find(m => m._id === (input.red || game.players?.red?.model_id)), black = models.find(m => m._id === (input.black || game.players?.black?.model_id))
					if (!red || !black || red._id === black._id) throw new AppError('续弈双方模型无效')
					const next = newGame({ title: input.title || game.title + ' · 续弈', type: 'continuation', fen: seq ? game.steps[seq - 1].fen_after : game.initial_position.fen, red, black, source: { kind: 'continuation', source_game_id: game._id, source_step_seq: seq }, demo: config.mode === 'demo' })
					return json(res, await createGame(store, next, config))
				}
				if (action === 'export' && req.method === 'POST') {
					if (exporting) throw new AppError('已有导出任务进行中', 'BUSY', 409)
					exporting = true; const id = uid('export'), snapshot = structuredClone(game), job = { id, status: 'running', game_id: game._id, cutoff_event_seq: game.last_event_seq, created_at: Date.now() }; jobs.set(id, job)
					;(async () => { try { const result = await exportZip(snapshot, store, config); const file = path.join(config.dataDirectory, 'exports', id + '.zip'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, result.data); job.status = result.missing.length ? 'partial' : 'ready'; job.missing = result.missing; job.size_bytes = result.data.length } catch (e) { job.status = 'failed'; job.message = e.code === 'EXPORT_LIMIT' ? e.message : '导出失败，请重试' } finally { exporting = false } })()
					return json(res, job, 202)
				}
				if (action === 'retry-audio' && req.method === 'POST') {
					if (game.status === 'playing') throw new AppError('请先暂停棋局再重试语音，以免覆盖实时状态')
					const input = await body(req, 1000), comment = allCommentaries(game).find(c => c.id === input.commentary_id)
					if (!comment?.text) throw new AppError('解说不存在')
					const audio = { id: uid('audio'), status: 'synthesizing', format: 'mp3', voice_id: config.ttsVoice, created_at: Date.now(), played_in_live: false }; comment.audio.push(audio); await saveGame(store, game, null, config)
					try { const t = Date.now(), result = await runner.speech(comment.text, config); if (!result) throw new Error(); audio.generation_ms = Date.now() - t; const uploaded = await store.request('audio.upload', { path: `xiangqi/${game._id}/${audio.id}.mp3`, data: result.data.toString('base64') }); audio.file_id = uploaded.file_id; audio.sha256 = hash(result.data); audio.size_bytes = result.data.length; if (result.duration_ms != null) audio.duration_ms = result.duration_ms; audio.status = 'ready' } catch { audio.status = 'failed'; audio.error = { code: 'TTS_FAILED' } }
					await saveGame(store, game, null, config); return json(res, audio)
				}
			}
			match = pathname.match(/^\/api\/admin\/exports\/([\w-]+)(\/download)?$/)
			if (match && req.method === 'GET') {
				const job = jobs.get(match[1]); if (!job || Date.now() - job.created_at > 3600000) throw new AppError('任务已失效，请重新导出', 'NOT_FOUND', 404)
				if (!match[2]) return json(res, job)
				if (!['ready', 'partial'].includes(job.status)) throw new AppError('文件尚未生成')
				const bytes = await fs.readFile(path.join(config.dataDirectory, 'exports', job.id + '.zip')); res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${job.game_id}.zip"`, 'cache-control': 'no-store' }); res.end(bytes); return
			}
			if (pathname === '/admin' || pathname === '/admin/') return await serve(res, path.join(root, 'server/public/admin.html'))
			if (pathname.startsWith('/media/') && config.mode === 'demo' && /^\/media\/xiangqi\/[\w/-]+\.(mp3|wav|ogg|m4a|aac|pcm)$/.test(pathname)) return await serve(res, path.join(config.dataDirectory, pathname))
			if (pathname.startsWith('/api/')) throw new AppError('接口不存在', 'NOT_FOUND', 404)
			const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
			if (relative.includes('..') || relative.includes('\\')) throw new AppError('路径无效')
			return await serve(res, path.join(root, 'dist/build/h5', relative))
		} catch (error) {
			if (res.headersSent) { res.destroy(); return }
			const known = error instanceof AppError || ['CONFLICT', 'ALREADY_VOTED', 'ROUND_CLOSED', 'LEASE_LOST'].includes(error.code)
			json(res, { error: { code: known ? error.code : 'SERVER_ERROR', message: known ? error.message : '服务暂不可用，请检查服务端配置' } }, known ? error.status || 409 : 503)
		}
	})
	return { server, runner, store, async start() { await runner.start(); await new Promise(resolve => server.listen(config.port, config.host, resolve)) }, async stop() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runner.stop(); await store.close() } }
}
async function serve(res, file) {
	let bytes
	try { bytes = await fs.readFile(file) } catch { throw new AppError('文件不存在；请先构建 H5', 'NOT_FOUND', 404) }
	const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.json': 'application/json', '.woff2': 'font/woff2' }
	res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('.html') ? 'no-store' : 'public, max-age=300' }); res.end(bytes)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const config = configuration(), app = await createApplication(config)
	await app.start(); console.log(`AI Xiangqi ${config.mode === 'demo' ? '演示' : '正式'}服务：http://${config.host}:${config.port}，管理页 /admin`)
	let stopping = false
	for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (stopping) return; stopping = true; await app.stop(); process.exit(0) })
}
