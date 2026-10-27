import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import { AppError } from './store.mjs'
const adapters = ['none', 'thinking_type', 'enable_thinking', 'reasoning_effort']
const secretFields = new Set(['api_key', 'api_key_env', 'base_url', 'extra_body'])
export const publicModel = m => ({ _id: m._id, display_name: m.display_name, avatar_url: m.avatar_url || '', enabled: m.enabled, can_play: m.can_play, can_commentate: m.can_commentate, allow_vote: m.allow_vote, sort_order: m.sort_order || 0, demo: !!m.demo })
export function adminModel(m) { const safe = { ...m }; delete safe.api_key; safe.has_api_key = !!(m.api_key || m.api_key_env); return safe }
export function modelSnapshot(m) { return { model_id: m._id, display_name: m.display_name, avatar_url: m.avatar_url || '', model_name: m.model_name, model_revision: m.revision || 1, thinking_mode: m.thinking_mode || 'default', reasoning_effort: m.reasoning_effort || '' } }
export function encryptKey(key, master) {
	if (!master) return key
	const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(master).digest(), iv)
	const content = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()])
	return 'enc:v1:' + [iv, cipher.getAuthTag(), content].map(b => b.toString('base64url')).join(':')
}
export function resolveKey(model, master, env = process.env) {
	const key = model.api_key_env ? env[model.api_key_env] : model.api_key
	if (!key) throw new AppError('模型未配置有效凭据', 'MODEL_CONFIG', 503)
	if (!key.startsWith('enc:v1:')) return key
	if (!master) throw new AppError('服务端未配置密钥解密主密钥', 'MODEL_CONFIG', 503)
	try { const [iv, tag, content] = key.slice(7).split(':').map(x => Buffer.from(x, 'base64url')); const d = crypto.createDecipheriv('aes-256-gcm', crypto.createHash('sha256').update(master).digest(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(content), d.final()]).toString('utf8') }
	catch { throw new AppError('模型凭据无法解密', 'MODEL_CONFIG', 503) }
}
function privateAddress(ip) {
	if (net.isIPv4(ip)) { const [a, b] = ip.split('.').map(Number); return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 }
	const s = ip.toLowerCase(); return s === '::' || s === '::1' || /^(fc|fd|fe[89ab])/.test(s) || s.startsWith('::ffff:')
}
export async function validateTarget(base, allowPrivate = false) {
	let url
	try { url = new URL(base) } catch { throw new AppError('模型接口地址无效') }
	if (url.username || url.password || url.search || url.hash || !['https:', ...(allowPrivate ? ['http:'] : [])].includes(url.protocol)) throw new AppError('模型地址必须是无鉴权信息的 HTTPS 基址')
	if (!allowPrivate) {
		const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }).catch(() => { throw new AppError('模型域名无法解析', 'MODEL_CONFIG', 503) })
		if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new AppError('不允许访问内网模型地址')
	}
	return url
}
export function validateModel(input, previous = {}, master) {
	const keys = ['_id', 'display_name', 'avatar_url', 'provider', ...secretFields, 'model_name', 'enabled', 'can_play', 'can_commentate', 'allow_vote', 'sort_order', 'thinking_mode', 'thinking_adapter', 'reasoning_effort', 'disabled_effort', 'temperature', 'max_tokens', 'token_limit_field', 'timeout_ms', 'max_attempts']
	const m = { ...previous }
	for (const k of keys) if (Object.hasOwn(input, k) && !(k === 'api_key' && !input[k])) m[k] = input[k]
	if (!/^[\w-]{1,80}$/.test(m._id || '') || ['__proto__', 'constructor', 'prototype'].includes(m._id) || typeof m.display_name !== 'string' || !m.display_name.trim() || m.display_name.length > 80 || typeof m.model_name !== 'string' || !m.model_name.trim()) throw new AppError('模型 ID、显示名称和实际模型名必填')
	m.thinking_mode ||= 'default'; m.thinking_adapter ||= 'none'; m.token_limit_field ||= 'max_tokens'
	if (!['default', 'enabled', 'disabled'].includes(m.thinking_mode) || !adapters.includes(m.thinking_adapter) || !['max_tokens', 'max_completion_tokens'].includes(m.token_limit_field)) throw new AppError('模型参数类型无效')
	if (m.thinking_mode !== 'default' && m.thinking_adapter === 'none') throw new AppError('请先选择该供应商支持的思考参数适配器')
	if (m.thinking_adapter === 'reasoning_effort' && ((m.thinking_mode === 'disabled' && !m.disabled_effort) || (m.thinking_mode === 'enabled' && !m.reasoning_effort))) throw new AppError('请设置思考强度或关闭时对应的参数值')
	for (const [k, fallback, min, max] of [['timeout_ms', 45000, 1000, 300000], ['max_attempts', 3, 1, 5], ['max_tokens', 4096, 1, 262144], ['sort_order', 0, -100000, 100000]]) { m[k] ??= fallback; if (!Number.isInteger(m[k]) || m[k] < min || m[k] > max) throw new AppError(k + ' 超出范围') }
	for (const k of ['enabled', 'can_play', 'can_commentate', 'allow_vote']) { m[k] ??= ['can_play', 'allow_vote'].includes(k); if (typeof m[k] !== 'boolean') throw new AppError(k + ' 必须为布尔值') }
	if (m.temperature != null && (typeof m.temperature !== 'number' || m.temperature < 0 || m.temperature > 2)) throw new AppError('温度应在 0 到 2 之间')
	if (typeof m.base_url !== 'string' || m.base_url.length > 1000) throw new AppError('模型地址无效')
	if (m.avatar_url && (!/^\/(?!\/)/.test(m.avatar_url) && !/^https:\/\//.test(m.avatar_url))) throw new AppError('形象地址需为 HTTPS 或本项目静态路径')
	if (Object.hasOwn(input, 'api_key') && input.api_key) { if (typeof input.api_key !== 'string' || input.api_key.length > 4096) throw new AppError('密钥格式无效'); m.api_key = encryptKey(input.api_key, master) }
	if (m.api_key_env && !/^[A-Z_][A-Z0-9_]{0,100}$/.test(m.api_key_env)) throw new AppError('密钥环境变量名称无效')
	const extra = m.extra_body || {}
	if (typeof extra !== 'object' || Array.isArray(extra) || JSON.stringify(extra).length > 8000) throw new AppError('扩展参数必须是 JSON 对象且不超过 8KB')
	const reserved = ['model', 'messages', 'stream', 'thinking', 'enable_thinking', 'reasoning_effort', 'authorization', 'api_key', 'max_tokens', 'max_completion_tokens', '__proto__', 'constructor', 'tools', 'tool_choice']
	if (Object.keys(extra).some(k => reserved.includes(k.toLowerCase()))) throw new AppError('扩展参数包含保留字段')
	m.extra_body = extra
	return m
}
export function requestBody(model, messages) {
	const m = validateModel(model), body = { ...m.extra_body, model: m.model_name, messages, stream: false, [m.token_limit_field]: m.max_tokens }
	if (m.temperature != null && m.thinking_mode !== 'enabled') body.temperature = m.temperature
	if (m.thinking_mode !== 'default') {
		if (m.thinking_adapter === 'thinking_type') body.thinking = { type: m.thinking_mode }
		if (m.thinking_adapter === 'enable_thinking') body.enable_thinking = m.thinking_mode === 'enabled'
		if (m.thinking_adapter === 'reasoning_effort') body.reasoning_effort = m.thinking_mode === 'disabled' ? m.disabled_effort : m.reasoning_effort
	}
	if (m.reasoning_effort && m.thinking_mode === 'enabled' && m.thinking_adapter !== 'reasoning_effort') body.reasoning_effort = m.reasoning_effort
	return body
}

export async function callModel(model, messages, config, fetcher = fetch) {
	await validateTarget(model.base_url, config.allowPrivateModels)
	const key = resolveKey(model, config.masterKey), body = requestBody(model, messages)
	const base = model.base_url.replace(/\/$/, ''), url = base.endsWith('/chat/completions') ? base : base + '/chat/completions'
	let response
	try { response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(model.timeout_ms || 45000) }) }
	catch (error) { throw new AppError(error.name === 'TimeoutError' ? '模型请求超时' : '模型连接失败', error.name === 'TimeoutError' ? 'MODEL_TIMEOUT' : 'MODEL_UNAVAILABLE', 503) }
	if (!response.ok) { await response.body?.cancel(); throw new AppError('模型接口返回 HTTP ' + response.status, [400, 401, 403, 404].includes(response.status) ? 'MODEL_CONFIG' : 'MODEL_UNAVAILABLE', 503) }
	const chunks = []; let size = 0
	for await (const chunk of response.body) { size += chunk.length; if (size > 2 * 1024 * 1024) { await response.body.cancel().catch(() => {}); throw new AppError('模型响应过大', 'MODEL_OUTPUT') } chunks.push(chunk) }
	let result
	try { result = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new AppError('模型响应不是 JSON', 'MODEL_OUTPUT') }
	const text = result.choices?.[0]?.message?.content
	if (typeof text !== 'string' || !text.trim()) throw new AppError('模型未返回最终回答，请检查输出上限和思考设置', 'MODEL_OUTPUT')
	// Deliberately discard reasoning_content; never persist or return private reasoning.
	return { text, usage: result.usage || {}, request_id: result.id || response.headers.get('x-request-id') || '' }
}
