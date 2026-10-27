import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { zipSync, unzipSync } from 'fflate'
import { allCommentaries, publicGame, importGame } from './game.mjs'
import { AppError } from './store.mjs'
export const hash = data => crypto.createHash('sha256').update(data).digest('hex')
export async function readAsset(store, fileId, config) {
	if (config.mode === 'demo' && fileId.startsWith('local:')) {
		const relative = fileId.slice(6)
		if (!/^xiangqi\/[\w/-]+\.(mp3|wav|json|json.gz|zip)$/.test(relative)) throw new AppError('资源路径无效')
		return fs.readFile(path.join(config.dataDirectory, 'media', relative))
	}
	const urls = await store.request('audio.urls', { file_ids: [fileId] }), url = urls[0]?.url
	if (!url?.startsWith('https://')) throw new AppError('归档资源不可用', 'ASSET_MISSING', 404)
	const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(45000) })
	if (!response.ok) throw new AppError('归档资源下载失败', 'ASSET_MISSING', 404)
	const chunks = []; let size = 0
	for await (const chunk of response.body) { size += chunk.length; if (size > 32 * 1024 * 1024) throw new AppError('归档资源过大'); chunks.push(chunk) }
	return Buffer.concat(chunks)
}
export async function loadGame(store, id, config) {
	const record = await store.request('games.get', { id })
	if (!record || record.archive?.mode !== 'file') return record
	const bytes = await readAsset(store, record.archive.file_id, config)
	if (hash(bytes) !== record.archive.sha256) throw new AppError('棋局归档校验失败', 'ARCHIVE_ERROR', 503)
	const json = record.archive.encoding === 'gzip' ? gunzipSync(bytes, { maxOutputLength: 32 * 1024 * 1024 }) : bytes
	const full = JSON.parse(json.toString())
	if (full._id !== record._id || full.version !== record.archive.version) throw new AppError('棋局归档版本不匹配', 'ARCHIVE_ERROR', 503)
	return { ...full, version: record.version, archive: record.archive, updated_at: record.updated_at }
}
export async function saveGame(store, game, lease, config) {
	const expected = game.version
	let record = game
	if (Buffer.byteLength(JSON.stringify(game)) > config.inlineLimit) {
		const full = { ...game, version: expected + 1, archive: { mode: 'inline' } }, bytes = gzipSync(Buffer.from(JSON.stringify(full)))
		if (bytes.length > 1800000) throw new AppError('棋局压缩档案超过上传上限；已暂停，现有档案仍保留', 'ARCHIVE_LIMIT', 503)
		const asset = await store.request('audio.upload', { path: `xiangqi/${game._id}/archive-${expected + 1}-${crypto.randomUUID()}.json.gz`, data: bytes.toString('base64') })
		record = { ...game, steps: [], calls: [], commentaries: [], events: [], pending_step: null, archive: { mode: 'file', file_id: asset.file_id, sha256: hash(bytes), size_bytes: bytes.length, version: expected + 1, encoding: 'gzip' } }
	}
	const saved = await store.request('games.save', { game: record, expected_version: expected, ...(lease ? { worker: true, owner: lease.owner, fence: lease.fence } : {}) })
	game.version = saved.version; game.updated_at = saved.updated_at; game.archive = saved.archive
	return game
}
export async function createGame(store, game, config) {
	let record = game
	if (Buffer.byteLength(JSON.stringify(game)) > config.inlineLimit) {
		const full = { ...game, version: 0, archive: { mode: 'inline' } }, bytes = gzipSync(Buffer.from(JSON.stringify(full)))
		if (bytes.length > 1800000) throw new AppError('导入档案压缩后仍超过单文件归档上限')
		const asset = await store.request('audio.upload', { path: `xiangqi/${game._id}/import-${crypto.randomUUID()}.json.gz`, data: bytes.toString('base64') })
		record = { ...game, steps: [], calls: [], commentaries: [], events: [], archive: { mode: 'file', file_id: asset.file_id, sha256: hash(bytes), size_bytes: bytes.length, version: 0, encoding: 'gzip' } }
	}
	const saved = await store.request('games.create', { game: record })
	return { ...game, version: saved.version, created_at: saved.created_at, updated_at: saved.updated_at, archive: saved.archive }
}
export async function exportZip(game, store, config) {
	const g = publicGame(game), files = {}, missing = [], manifest = { schema_version: 1, game_id: g._id, cutoff_event_seq: g.last_event_seq, finished: g.status === 'finished', files: [], missing }
	let total = 0
	for (const comment of allCommentaries(g)) for (const audio of comment.audio || []) {
		if (!audio.file_id || audio.status !== 'ready') { if (audio.status === 'failed' || audio.status === 'pending') missing.push(audio.id); continue }
		try {
			const bytes = await readAsset(store, audio.file_id, config)
			total += bytes.length; if (total > 64 * 1024 * 1024) throw new AppError('整局资源超过 64MB，请分批下载', 'EXPORT_LIMIT')
			if (audio.sha256 && hash(bytes) !== audio.sha256) throw new Error('校验失败')
			const name = 'audio/' + hash(bytes) + '.' + (audio.format || 'mp3')
			files[name] = bytes; audio.export_path = name
			delete audio.file_id
		} catch (error) { if (error.code === 'EXPORT_LIMIT') throw error; missing.push(audio.id) }
	}
	files['game.json'] = Buffer.from(JSON.stringify(g, null, 2))
	for (const [name, bytes] of Object.entries(files)) manifest.files.push({ path: name, size_bytes: bytes.length, sha256: hash(bytes) })
	files['manifest.json'] = Buffer.from(JSON.stringify(manifest, null, 2))
	return { data: Buffer.from(zipSync(files, { level: 1 })), missing }
}
export async function importZip(bytes, store) {
	if (bytes.length > 64 * 1024 * 1024) throw new AppError('导入包超过 64MB')
	let total = 0, count = 0, files
	try {
		files = unzipSync(new Uint8Array(bytes), { filter: file => {
			count++; total += file.originalSize
			if (count > 3000 || total > 96 * 1024 * 1024 || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(file.name)) throw new Error('压缩包路径或大小无效')
			return true
		} })
	} catch { throw new AppError('导入 ZIP 无效或超过解压限制') }
	if (!files['game.json'] || !files['manifest.json']) throw new AppError('ZIP 缺少 game.json 或 manifest.json')
	let manifest, raw
	try { manifest = JSON.parse(Buffer.from(files['manifest.json']).toString()); raw = JSON.parse(Buffer.from(files['game.json']).toString()) } catch { throw new AppError('导入 JSON 无效') }
	if (!Array.isArray(manifest.files) || manifest.missing?.length) throw new AppError('导入包资源不完整')
	const declared = new Set()
	for (const file of manifest.files) {
		if (declared.has(file.path) || !files[file.path] || files[file.path].length !== file.size_bytes || hash(files[file.path]) !== file.sha256) throw new AppError('导入资源校验失败')
		declared.add(file.path)
	}
	if (!declared.has('game.json')) throw new AppError('清单未包含棋局文件')
	const game = importGame(raw)
	for (const comment of allCommentaries(game)) for (const audio of comment.audio || []) {
		if (audio.status !== 'ready') continue
		if (!/^audio\/[a-f0-9]{64}\.(mp3|wav|ogg|m4a|aac|pcm)$/.test(audio.export_path || '') || !declared.has(audio.export_path)) throw new AppError('音频路径或清单无效')
		const data = Buffer.from(files[audio.export_path])
		if (data.length > 1800000) throw new AppError('单条语音超过导入上限')
		const uploaded = await store.request('audio.upload', { path: `xiangqi/${game._id}/${hash(data)}.${audio.format || 'mp3'}`, data: data.toString('base64') })
		audio.file_id = uploaded.file_id; delete audio.export_path
	}
	return game
}
