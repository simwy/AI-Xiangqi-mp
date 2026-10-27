import test from 'node:test'
import assert from 'node:assert/strict'
import { synthesize } from '../speech.mjs'
test('语音 SSE 数据流合并与供应商错误处理，不用临时 URL 冒充文件', async t => {
	const original = globalThis.fetch; t.after(() => { globalThis.fetch = original })
	const config = { ttsAppId: 'fixture', ttsToken: 'fixture', ttsResource: 'fixture', ttsVoice: 'fixture' }
	globalThis.fetch = async (url, options) => {
		assert.equal(JSON.parse(options.body).req_params.audio_params.format, 'mp3')
		return new Response('data: ' + JSON.stringify({ code: 0, data: Buffer.from('first').toString('base64') }) + '\n\ndata: ' + JSON.stringify({ code: 0, data: Buffer.from('second').toString('base64'), usage: { audio_duration: 1.25 } }) + '\n\ndata: {"code":20000000}\n')
	}
	const audio = await synthesize('测试报招', config)
	assert.equal(audio.data.toString(), 'firstsecond'); assert.equal(audio.duration_ms, 1250)
	globalThis.fetch = async () => new Response('data: {"code":45000000,"message":"fixture-error"}\n')
	await assert.rejects(() => synthesize('测试', config), { code: 'TTS_ERROR' })
})
