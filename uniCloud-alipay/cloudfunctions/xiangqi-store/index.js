'use strict'
const crypto = require('crypto')
const { createOperations } = require('./lib/operations.cjs')

function repository(db) {
	const wrap = client => ({
		async get(collection, id) { if (!id || typeof id !== 'string') return null; const r = await client.collection(collection).doc(id).get(); return r.data[0] || null },
		async put(collection, doc) { const { _id, ...body } = doc; await client.collection(collection).doc(_id).set(body) },
		async insert(collection, doc) { await client.collection(collection).add(doc) }
	})
	return {
		...wrap(db),
		async query(collection, filter, options = {}) {
			let q = db.collection(collection).where(filter)
			if (options.sort) q = q.orderBy(...options.sort)
			// Respect provider query limits; caller receives bounded results.
			const result = []; const limit = options.limit || 100
			for (let offset = 0; offset < limit; offset += 100) {
				const r = await q.skip((options.skip || 0) + offset).limit(Math.min(100, limit - offset)).get()
				result.push(...r.data); if (r.data.length < Math.min(100, limit - offset)) break
			}
			return result
		},
		async transaction(fn) {
			if (typeof db.startTransaction !== 'function') throw new Error('服务空间不支持所需事务能力')
			const tx = await db.startTransaction()
			try { const result = await fn(wrap(tx)); await tx.commit(); return result }
			catch (error) { await tx.rollback().catch(() => {}); throw error }
		}
	}
}

exports.createHandler = ({ getConfig = () => require('xiangqi-config')(), getCloud = () => uniCloud, repoFactory = repository } = {}) => async event => {
	try {
		const config = getConfig()
		const secret = config.gatewaySecret
		if (!secret || secret.length < 32) throw new Error('云网关未配置共享密钥')
		if (event.httpMethod !== 'POST' || typeof event.body !== 'string') throw new Error('仅支持签名 HTTP POST')
		const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
		if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('请求体过大')
		const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]))
		const timestamp = headers['x-xq-time'], nonce = headers['x-xq-nonce'], signature = headers['x-xq-signature']
		if (!/^\d{13}$/.test(timestamp || '') || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{32}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '')) throw new Error('签名已过期或无效')
		const expected = crypto.createHmac('sha256', secret).update(`${timestamp}\n${nonce}\n${raw}`).digest('hex')
		if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error('签名无效')
		const request = JSON.parse(raw), cloud = getCloud(), db = cloud.database(), execute = createOperations(repoFactory(db))
		await execute('requests.claim', { id: nonce })
		if (parseInt(nonce.slice(0, 2), 16) === 0) await db.collection('xq_requests').where({ expires_at: db.command.lt(Date.now()) }).remove().catch(() => {})
		if (request.op === 'audio.upload') {
			const { data, path } = request.args || {}
			if (typeof data !== 'string' || data.length > 3000000 || !/^xiangqi\/[a-zA-Z0-9_/-]+\.(mp3|wav|ogg|m4a|aac|pcm|json|json.gz|zip)$/.test(path || '')) throw new Error('归档资源无效')
			const result = await cloud.uploadFile({ cloudPath: path, fileContent: Buffer.from(data, 'base64') })
			return response({ data: { file_id: result.fileID } })
		}
		if (request.op === 'audio.urls') {
			const ids = request.args?.file_ids
			if (!Array.isArray(ids) || ids.length > 100 || ids.some(x => typeof x !== 'string' || x.length > 1000)) throw new Error('资源列表无效')
			const result = await cloud.getTempFileURL({ fileList: ids })
			return response({ data: result.fileList.map(x => ({ file_id: x.fileID, url: x.tempFileURL })) })
		}
		return response({ data: await execute(request.op, request.args) })
	} catch (error) {
		// Never return raw database/provider errors or secret material.
		const known = ['INVALID', 'REPLAY', 'CONFLICT', 'LEASE_LOST', 'LEASE_BUSY', 'ROUND_CLOSED', 'ALREADY_VOTED']
		return response({ error: { code: known.includes(error.code) ? error.code : 'STORE_ERROR', message: known.includes(error.code) ? error.message : '云端操作失败，请检查部署配置与服务日志' } })
	}
}
exports.main = exports.createHandler()
function response(body) { return { mpserverlessComposedResponse: true, statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } }
exports.repository = repository
