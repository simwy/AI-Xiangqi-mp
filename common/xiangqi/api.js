// H5 development uses Vite's proxy. Mini programs require an explicit HTTPS base.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
export function request(path, method = 'GET', data, headers = {}) {
	// #ifndef H5
	if (!API_BASE.startsWith('https://')) return Promise.reject(new Error('请先配置小程序的 HTTPS VITE_API_BASE 并重新构建'))
	// #endif
	return new Promise((resolve, reject) => uni.request({ url: API_BASE + path, method, data, timeout: 70000, header: { 'content-type': 'application/json', ...headers }, success(response) {
		if (response.statusCode < 200 || response.statusCode >= 300 || response.data?.error) { const error = new Error(response.data?.error?.message || '连接服务失败'); error.code = response.data?.error?.code; reject(error) }
		else resolve(response.data)
	}, fail() { reject(new Error('连接中断，正在等待重新同步')) } }))
}
export function absoluteMedia(url) { return url.startsWith('/') ? API_BASE + url : url }
export async function vote(round_id, model_id) {
	let token = uni.getStorageSync('xiangqi-voter')
	if (!token) { token = (await request('/api/session', 'POST', {})).token; uni.setStorageSync('xiangqi-voter', token) }
	try { return await request('/api/votes', 'POST', { round_id, model_id }, { 'x-visitor-token': token }) }
	catch (error) { if (error.code === 'SESSION_INVALID') uni.removeStorageSync('xiangqi-voter'); throw error }
}
