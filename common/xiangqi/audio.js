import { request, absoluteMedia } from './api.js'
export function createAudio() {
	const fx = uni.createInnerAudioContext(), voice = uni.createInnerAudioContext()
	fx.src = '/static/xiangqi/wood-stone-impact.wav'
	let enabled = false, generation = 0, playing = false, queue = []
	const next = () => {
		playing = false
		if (!enabled || !queue.length) return
		const item = queue.shift()
		if (item.expires < Date.now()) return next()
		playing = true; voice.src = item.url; voice.play()
	}
	voice.onEnded(next); voice.onError(next)
	return {
		get enabled() { return enabled },
		get busy() { return enabled && (playing || queue.length > 0) },
		toggle() { enabled = !enabled; if (!enabled) this.stop(); return enabled },
		land() { if (!enabled) return; fx.stop(); fx.play() },
		async speak(gameId, audio, replay = false) {
			if (!enabled || audio?.status !== 'ready') return
			const version = generation
			try { const result = await request(`/api/games/${gameId}/audio/${audio.id}`); if (!enabled || version !== generation || !result.url) return; queue.push({ url: absoluteMedia(result.url), expires: Date.now() + (replay ? 60000 : 12000) }); queue = queue.slice(-3); if (!playing) next() } catch { /* A voice failure must not interrupt the board. */ }
		},
		stop() { generation++; queue = []; playing = false; voice.stop(); fx.stop() },
		destroy() { this.stop(); voice.destroy(); fx.destroy() }
	}
}
