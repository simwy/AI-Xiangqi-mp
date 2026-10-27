import crypto from 'node:crypto'
import { AppError } from './store.mjs'
export async function synthesize(text, config) {
	if (!config.ttsAppId || !config.ttsToken || !config.ttsResource || !config.ttsVoice) return null
	const response = await fetch('https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
		method: 'POST', signal: AbortSignal.timeout(45000), redirect: 'error',
		headers: { 'content-type': 'application/json', 'X-Api-App-Id': config.ttsAppId, 'X-Api-Access-Key': config.ttsToken, 'X-Api-Resource-Id': config.ttsResource, 'X-Api-Request-Id': crypto.randomUUID() },
		body: JSON.stringify({ user: { uid: 'xiangqi-commentator' }, req_params: { text: text.slice(0, 500), speaker: config.ttsVoice, audio_params: { format: 'mp3', sample_rate: 24000 }, additions: JSON.stringify({ disable_markdown_filter: false }) } })
	})
	if (!response.ok) { await response.body?.cancel(); throw new AppError('语音接口请求失败', 'TTS_ERROR') }
	let pending = '', received = 0, duration = null
	const chunks = [], decoder = new TextDecoder()
	const consume = line => {
		line = line.trim(); if (!line || line.startsWith('event:') || line.startsWith('id:')) return
		if (line.startsWith('data:')) line = line.slice(5).trim()
		if (line === '[DONE]') return
		let item; try { item = JSON.parse(line) } catch { throw new AppError('语音流格式无效', 'TTS_ERROR') }
		if (item.code && ![0, 20000000].includes(item.code)) throw new AppError('语音服务返回错误', 'TTS_ERROR')
		if (item.data) { const data = Buffer.from(item.data, 'base64'); received += data.length; if (received > 1800000) throw new AppError('语音文件过大', 'TTS_ERROR'); chunks.push(data) }
		if (Number.isFinite(item.usage?.audio_duration)) duration = Math.round(item.usage.audio_duration * 1000)
	}
	for await (const chunk of response.body) {
		pending += decoder.decode(chunk, { stream: true })
		if (pending.length > 3000000) throw new AppError('语音响应过大', 'TTS_ERROR')
		const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(consume)
	}
	pending += decoder.decode(); if (pending.trim()) consume(pending)
	if (!received) throw new AppError('语音服务未返回音频', 'TTS_ERROR')
	return { data: Buffer.concat(chunks), duration_ms: duration, format: 'mp3' }
}
