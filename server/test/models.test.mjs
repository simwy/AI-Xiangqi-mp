import test from 'node:test'
import assert from 'node:assert/strict'
import { validateModel, requestBody, encryptKey, resolveKey, callModel, adminModel, publicModel } from '../models.mjs'
const base = { _id: 'test', display_name: '测试模型', base_url: 'http://127.0.0.1:9999/v1', model_name: 'test-model', api_key: 'fixture-not-a-real-key', thinking_mode: 'default', thinking_adapter: 'none' }
test('不同供应商思考开关独立映射，默认不额外传值', () => {
	assert(!Object.hasOwn(requestBody(base, []), 'thinking'))
	assert.deepEqual(requestBody({ ...base, thinking_mode: 'disabled', thinking_adapter: 'thinking_type' }, []).thinking, { type: 'disabled' })
	assert.equal(requestBody({ ...base, thinking_mode: 'enabled', thinking_adapter: 'enable_thinking' }, []).enable_thinking, true)
	assert.equal(requestBody({ ...base, thinking_mode: 'disabled', thinking_adapter: 'reasoning_effort', disabled_effort: 'none' }, []).reasoning_effort, 'none')
	assert.throws(() => requestBody({ ...base, thinking_mode: 'disabled' }, []), /适配器/)
	assert.throws(() => validateModel({ ...base, extra_body: { messages: [] } }), /保留字段/)
})
test('Key 可加密与保留，管理及公开接口不返回 Key', () => {
	const encrypted = encryptKey(base.api_key, 'fixture-master')
	assert.notEqual(encrypted, base.api_key); assert.equal(resolveKey({ api_key: encrypted }, 'fixture-master'), base.api_key)
	assert.throws(() => resolveKey({ api_key: encrypted }, 'wrong'), /解密/)
	assert.equal(validateModel({ ...base, api_key: '' }, { ...base }).api_key, base.api_key)
	assert(!Object.hasOwn(adminModel(base), 'api_key')); assert(!Object.hasOwn(publicModel(base), 'api_key'))
})
test('真实适配器请求与最终回答解析，丢弃 reasoning_content', async () => {
	let sent
	const result = await callModel({ ...base, thinking_mode: 'enabled', thinking_adapter: 'thinking_type' }, [{ role: 'user', content: 'fixture' }], { allowPrivateModels: true }, async (url, options) => {
		sent = JSON.parse(options.body); assert.equal(url, base.base_url + '/chat/completions')
		return new Response(JSON.stringify({ id: 'fixture-request', choices: [{ message: { content: '{"move_id":"17-47"}', reasoning_content: 'must-not-be-saved' } }], usage: { total_tokens: 25 } }), { headers: { 'content-type': 'application/json' } })
	})
	assert.equal(sent.thinking.type, 'enabled'); assert.equal(result.usage.total_tokens, 25); assert(!JSON.stringify(result).includes('must-not-be-saved'))
})
