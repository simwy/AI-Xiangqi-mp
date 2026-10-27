import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createOperations } = require('../uniCloud-alipay/cloudfunctions/xiangqi-store/lib/operations.cjs')
export const copy = x => x == null ? x : structuredClone(x)
export class AppError extends Error { constructor(message, code = 'INVALID', status = 400) { super(message); this.code = code; this.status = status } }

export class LocalStore {
	constructor(directory) { this.directory = directory; this.file = path.join(directory, 'demo-store.json'); this.data = {}; this.chain = Promise.resolve() }
	async open() {
		await fs.mkdir(this.directory, { recursive: true })
		const lockPath = path.join(this.directory, '.lock')
		try { this.lock = await fs.open(lockPath, 'wx') }
		catch (error) {
			if (error.code !== 'EEXIST') throw error
			let stale = false
			try { const pid = Number(await fs.readFile(lockPath, 'utf8')); if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0) } catch (e) { stale = e.code === 'ESRCH' } } } catch {}
			if (!stale) throw new Error('本地演示数据目录已被另一个进程占用')
			await fs.unlink(lockPath).catch(() => {})
			this.lock = await fs.open(lockPath, 'wx')
		}
		await this.lock.writeFile(String(process.pid))
		try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') { await this.close(); throw error } }
		this.execute = createOperations(this)
		return this
	}
	async close() { await this.chain; if (this.lock) { await this.lock.close(); this.lock = null; await fs.unlink(path.join(this.directory, '.lock')).catch(() => {}) } }
	async get(table, id) { return copy(this.data[table]?.[id] || null) }
	async query(table, filter, { limit = 100, skip = 0, sort } = {}) {
		let rows = Object.values(this.data[table] || {}).filter(r => Object.entries(filter).every(([k, v]) => r[k] === v))
		if (sort) rows.sort((a, b) => ((a[sort[0]] ?? 0) > (b[sort[0]] ?? 0) ? 1 : (a[sort[0]] ?? 0) < (b[sort[0]] ?? 0) ? -1 : 0) * (sort[1] === 'desc' ? -1 : 1))
		return copy(rows.slice(skip, skip + limit))
	}
	transaction(fn) {
		const run = async () => {
			const next = copy(this.data)
			const tx = {
				get: async (t, id) => copy(next[t]?.[id] || null),
				put: async (t, doc) => { (next[t] ||= {})[doc._id] = copy(doc) },
				insert: async (t, doc) => { if (next[t]?.[doc._id]) throw new AppError('记录已存在', 'CONFLICT', 409); (next[t] ||= {})[doc._id] = copy(doc) }
			}
			const result = await fn(tx), temp = this.file + '.' + crypto.randomUUID() + '.tmp'
			const file = await fs.open(temp, 'w', 0o600)
			try { await file.writeFile(JSON.stringify(next)); await file.sync() } finally { await file.close() }
			await fs.rename(temp, this.file)
			this.data = next
			return copy(result)
		}
		const promise = this.chain.then(run); this.chain = promise.catch(() => {}); return promise
	}
	async request(op, args) {
		if (op === 'audio.upload') {
			const relative = args.path
			if (!/^xiangqi\/[\w/-]+\.(mp3|wav|ogg|m4a|aac|pcm|json|json.gz|zip)$/.test(relative)) throw new AppError('资源路径无效')
			const file = path.join(this.directory, 'media', relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, Buffer.from(args.data, 'base64'), { mode: 0o600 })
			return { file_id: 'local:' + relative }
		}
		if (op === 'audio.urls') return args.file_ids.map(id => ({ file_id: id, url: '/media/' + id.slice(6) }))
		return this.execute(op, args)
	}
}

export class CloudStore {
	constructor(url, secret) {
		if (!url?.startsWith('https://') || !secret || secret.length < 32) throw new Error('正式运行必须配置 HTTPS 云网关地址和至少 32 位共享密钥')
		this.url = url; this.secret = secret
	}
	async request(op, args = {}) {
		const body = JSON.stringify({ op, args }), time = String(Date.now()), nonce = crypto.randomBytes(16).toString('hex')
		const signature = crypto.createHmac('sha256', this.secret).update(`${time}\n${nonce}\n${body}`).digest('hex')
		const response = await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-xq-time': time, 'x-xq-nonce': nonce, 'x-xq-signature': signature }, body, signal: AbortSignal.timeout(65000), redirect: 'error' })
		if (!response.ok) throw new AppError('uniCloud 网关连接失败', 'STORE_ERROR', 503)
		let result = await response.json()
		// Some service spaces preserve the composed response envelope.
		if (result.body && typeof result.body === 'string') result = JSON.parse(result.body)
		if (result.error) throw new AppError(result.error.message, result.error.code, result.error.code === 'CONFLICT' ? 409 : 503)
		return result.data
	}
	async close() {}
}

export async function openStore(config) {
	if (config.mode === 'demo') return new LocalStore(config.dataDirectory).open()
	if (config.mode !== 'live') throw new Error('APP_MODE 只能是 demo 或 live')
	return new CloudStore(config.cloudUrl, config.cloudSecret)
}
