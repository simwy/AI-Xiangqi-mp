import path from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = path.dirname(fileURLToPath(import.meta.url))
export function configuration(env = process.env) {
	const number = (key, fallback, min, max) => { const n = Number(env[key] || fallback); if (!Number.isFinite(n) || n < min || n > max) throw new Error(key + ' 无效'); return n }
	const config = { mode: env.APP_MODE || 'demo', host: env.HOST || '127.0.0.1', port: number('PORT', 8787, 1, 65535), dataDirectory: path.resolve(env.DATA_DIRECTORY || path.join(directory, 'data')), cloudUrl: env.UNICLOUD_STORE_URL, cloudSecret: env.UNICLOUD_GATEWAY_SECRET, adminToken: env.ADMIN_TOKEN || '', visitorSecret: env.VISITOR_SECRET || '', masterKey: env.MODEL_KEY_SECRET || '', allowPrivateModels: env.ALLOW_PRIVATE_MODELS === 'true', moveIntervalMs: number('MOVE_INTERVAL_MS', 6000, 100, 600000), betweenGamesMs: number('BETWEEN_GAMES_MS', 10000, 100, 600000), demoThinkMs: number('DEMO_THINK_MS', 1200, 0, 10000), inlineLimit: number('INLINE_ARCHIVE_LIMIT', 1400000, 10000, 1800000), allowedOrigins: (env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','), ttsAppId: env.TTS_APP_ID || '', ttsToken: env.TTS_ACCESS_TOKEN || '', ttsResource: env.TTS_RESOURCE_ID || '', ttsVoice: env.TTS_VOICE_ID || '' }
	if (config.mode === 'live' && (config.adminToken.length < 32 || config.visitorSecret.length < 32)) throw new Error('正式模式必须设置至少32位 ADMIN_TOKEN 和 VISITOR_SECRET')
	return config
}
