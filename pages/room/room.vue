<template>
	<view class="screen">
		<view class="phone" :style="stageStyle">
			<view class="topline"><text><text class="live-dot"/>AI 象棋 · {{ state.mode === 'demo' ? '演示对局' : '持续对局' }}</text><text>{{ replaying ? '回放中' : connected ? '已同步' : '连接中断' }}</text><button @click="toggleSound">声音：{{ soundEnabled ? '开' : '关' }}</button></view>
			<ModelBanner side="black" :player="game?.players?.black" :thinking="isThinking('black')" :elapsed="elapsed('black')" />
			<view class="matchbar"><text>{{ replaying ? '回看第 ' + cursor + ' / ' + (game?.steps?.length || 0) + ' 步' : '第 ' + (game?.ply_count || 0) + ' 步' }}</text><text>{{ statusText }}</text></view>
			<XiangqiBoard :board="board" :step="step" :move-key="moveKey" :animate-move="animateMove" :size="size" @land="land" />

			<view class="commentary"><view class="speaker"/><view class="comment-content"><text class="commentator-name">小弈 · 女声解说</text><text class="comment-text">{{ commentary }}</text><view v-if="replaying" class="replay-controls"><button @click="replayStep(-1)">‹ 上一步</button><button @click="toggleAuto">{{ autoPlaying ? '暂停' : '自动播放' }}</button><button @click="replayStep(1)">下一步 ›</button><button @click="returnLive">返回直播</button></view><text v-else class="move-caption">{{ moveDescription }}</text></view><text class="wave">▂▅▃▆▂</text></view>
			<ModelBanner side="red" :player="game?.players?.red" :thinking="isThinking('red')" :elapsed="elapsed('red')" />
			<view class="controls"><button class="game-btn" @click="openHistory"><view class="btn-icon" :style="iconStyle(134)"/><text>历史棋局</text></button><button class="game-btn" @click="sheet = 'replay'"><view class="btn-icon" :style="iconStyle(262)"/><text>从头回看</text></button><button class="game-btn" @click="openVotes"><view class="btn-icon" :style="iconStyle(789)"/><text>下局投票</text></button></view>
			<view v-if="error || (!connected && live)" class="connection-note">{{ error || '连接中断，棋盘保留在最后已确认的局面' }}</view>
			<view v-if="sheet" class="sheet-backdrop open" @click="sheet = ''"><view class="sheet" @click.stop><view class="handle"/><view class="sheet-head"><text class="sheet-title">{{ sheet === 'history' ? '过往棋局' : sheet === 'replay' ? '从头回看' : '下一局，谁来上场？' }}</text><button class="close" @click="sheet = ''">×</button></view>
				<scroll-view scroll-y class="sheet-scroll">
					<template v-if="sheet === 'history'"><view v-if="!history.length" class="hint">暂无历史棋局</view><view v-for="item in history" :key="item._id" class="history-row"><view><text>{{ item.title }}</text><text class="hint">{{ item.players?.red?.display_name }} 对 {{ item.players?.black?.display_name }} · {{ item.ply_count }} 步 · {{ item.result?.reason || item.status }}</text></view><button class="gold-btn" @click="watchHistory(item._id)">回看</button></view><button v-if="history.length >= 20" class="gold-btn" @click="moreHistory">加载更多</button></template>
					<template v-if="sheet === 'replay'"><text class="hint">独立回看，不影响正在进行的对局。字幕与原声使用当时保存的档案。</text><view class="replay-options"><switch :checked="originalTiming" @change="originalTiming = $event.detail.value"/><text>保留原始思考等待</text></view><button class="gold-btn" :disabled="!live" @click="startReplay(live)">从这局第一步看起</button><button class="gold-btn" @click="returnLive">继续看直播</button></template>
					<template v-if="sheet === 'vote'"><text class="hint">每轮一票，前两名进入下一局。匿名投票以当前设备会话去重。</text><view v-for="model in voteModels" :key="model._id" class="vote-row"><view><text>{{ model.display_name }}</text><text class="hint">{{ votes.counts?.[model._id] || 0 }} 票</text></view><button class="gold-btn" :disabled="!votes.open || voting" @click="castVote(model._id)">投一票</button></view><text v-if="!votes.open" class="hint">本轮投票尚未开放或已结束</text></template>
				</scroll-view>
			</view></view>
		</view>
	</view>
</template>
<script>
import ModelBanner from '@/components/xiangqi/ModelBanner.vue'
import XiangqiBoard from '@/components/xiangqi/XiangqiBoard.vue'
import { INITIAL_FEN, parseFen } from '@/common/xiangqi/rules.mjs'
import { request, vote } from '@/common/xiangqi/api.js'
import { createAudio } from '@/common/xiangqi/audio.js'
const clone = x => x ? JSON.parse(JSON.stringify(x)) : null
export default {
	components: { ModelBanner, XiangqiBoard },
	data() { return { size: { width: 375, height: 782 }, state: { mode: 'demo', status: 'starting' }, live: null, replayGame: null, replaying: false, cursor: 0, sheet: '', history: [], models: [], votes: {}, connected: false, error: '', soundEnabled: false, voting: false, clock: Date.now(), serverOffset: 0, animateMove: false, originalTiming: false, autoPlaying: false } },
	computed: {
		stageStyle() { return { width: this.size.width + 'px', height: this.size.height + 'px', '--u': this.size.width / 100 + 'px' } },
		game() { return this.replaying ? this.replayGame : this.live },
		shownPly() { return this.replaying ? this.cursor : this.game?.steps.length || 0 },
		step() { return this.shownPly ? this.game?.steps[this.shownPly - 1] : null },
		moveKey() { return (this.game?._id || 'none') + ':' + this.shownPly },
		board() {
			let board = parseFen(this.game?.initial_position.fen || INITIAL_FEN).board
			for (const s of (this.game?.steps || []).slice(0, this.shownPly)) { const [x, y] = s.move.to, p = board.find(p => p.x === s.move.from[0] && p.y === s.move.from[1]); board = board.filter(q => q.x !== x || q.y !== y).map(q => q === p ? { ...q, x, y } : q) }
			return board
		},
		commentary() { const source = this.step ? this.step.commentaries : this.game?.commentaries; const ready = (source || []).filter(c => c.status === 'ready'); return ready[ready.length - 1]?.text || this.step?.notation || this.state.message || '双方模型正在准备对局。' },
		moveDescription() { if (!this.step) return this.replaying ? '初始局面' : '等待开局'; return this.step.notation + (typeof this.step.decision_ms === 'number' ? ' · 决策 ' + (this.step.decision_ms / 1000).toFixed(1) + ' 秒' : ' · 用时未记录') },
		voteModels() { return this.models.filter(m => m.can_play && m.allow_vote) },
		statusText() { if (this.state.status === 'needs_configuration') return '等待模型配置'; if (this.replaying) return '档案回放'; if (!this.connected) return '等待同步'; if (this.game?.status === 'finished') return this.game.result?.reason; if (this.game?.status === 'paused' || this.state.status === 'paused') return '对局暂停'; return this.game?.pending_step?.status === 'running' ? '模型思考中' : this.state.mode === 'demo' ? '演示 · 非真实 AI 调用' : '服务端持续运行' }
	},
	onLoad() { this.resize(); this.audio = createAudio(); this.seenAudio = new Set(); this.timeouts = []; this.visible = true; this.refresh(); this.poll = setInterval(() => this.refresh(), 2000); this.clockTimer = setInterval(() => { this.clock = Date.now() }, 250) },
	onShow() { this.visible = true; if (this.audio) this.refresh() }, onHide() { this.visible = false; this.replayGeneration = (this.replayGeneration || 0) + 1; this.timeouts?.forEach(clearTimeout); this.timeouts = []; this.audio?.stop(); this.stopAuto() },
	onResize() { this.resize() }, onUnload() { clearInterval(this.poll); clearInterval(this.clockTimer); this.stopAuto(); this.timeouts.forEach(clearTimeout); this.audio.destroy() },
	methods: {
		resize() { const info = uni.getSystemInfoSync(), height = info.windowHeight; const width = Math.min(info.windowWidth, height * 450 / 938); this.size = { width, height: width * 938 / 450 } },
		async refresh() {
			if (!this.visible || this.fetching) return
			this.fetching = true
			try {
				const previous = this.live, query = previous ? '?game_id=' + previous._id + '&version=' + previous.version + '&ply=' + previous.ply_count : ''
				const state = await request('/api/live' + query)
				if (state.unchanged) state.game = previous
				else if (state.steps_from_index !== undefined && previous?._id === state.game?._id) state.game.steps = previous.steps.slice(0, state.steps_from_index).concat(state.game.steps)
				this.serverOffset = state.server_time - Date.now(); this.animateMove = !this.replaying && previous?._id === state.game?._id && state.game?.steps.length === previous.steps.length + 1
				this.state = state; this.live = state.game; this.connected = true; this.error = ''
				if (this.replaying && this.replayGame?._id === state.game?._id) this.replayGame = clone(state.game)
				else if (this.replaying && previous?._id === this.replayGame?._id && previous?._id !== state.game?._id) this.replayGame = await request('/api/games/' + previous._id)
				if (state.game) {
					const audios = [...(state.game.commentaries || []), ...state.game.steps.flatMap(s => s.commentaries || [])].flatMap(c => c.audio || []).filter(a => a.status === 'ready')
					for (const a of audios) { if (this.seenAudio.has(a.id)) continue; this.seenAudio.add(a.id); const age = Date.now() + this.serverOffset - state.game.started_at - (a.playback_offset_ms || 0); if (!this.replaying && previous && age < 12000 && age > -10000) this.timeouts.push(setTimeout(() => { if (this.visible && !this.replaying && this.live?._id === state.game._id) this.audio.speak(state.game._id, a) }, Math.max(0, -age))) }
				}
			} catch (error) { this.connected = false; this.error = error.message }
			finally { this.fetching = false }
		},
		isThinking(side) { return !this.replaying && this.connected && this.state.status === 'playing' && this.game?.status === 'playing' && this.game?.pending_step?.status === 'running' && this.game.pending_step.side === side },
		elapsed(side) { if (this.isThinking(side)) return Math.max(0, this.clock + this.serverOffset - this.game.pending_step.started_at); return [...(this.game?.steps || [])].slice(0, this.shownPly).reverse().find(s => s.side === side)?.decision_ms ?? null },
		iconStyle(x) { return { '--bw': 1152 / 87 * 100 + '%', '--bh': 2376 / 87 * 100 + '%', '--bx': (x - 43.5) / (1152 - 87) * 100 + '%', '--by': (1675 - 43.5) / (2376 - 87) * 100 + '%' } },
		toggleSound() { this.soundEnabled = this.audio.toggle(); if (this.soundEnabled) { this.audio.land(); uni.showToast({ title: '已开启声音', icon: 'none' }) } }, land() { if (this.visible) this.audio.land() },
		async openHistory() { this.sheet = 'history'; try { this.history = await request('/api/games') } catch (e) { this.notify(e) } },
		async moreHistory() { try { this.history.push(...await request('/api/games?skip=' + this.history.length)) } catch (e) { this.notify(e) } },
		async watchHistory(id) { try { this.startReplay(await request('/api/games/' + id)) } catch (e) { this.notify(e) } },
		startReplay(game) { if (!game) return; this.stopAuto(); this.audio.stop(); this.replayGeneration = (this.replayGeneration || 0) + 1; this.replayGame = clone(game); this.replaying = true; this.cursor = 0; this.animateMove = false; this.sheet = ''; this.queueReplayAudio() },
		replayStep(delta) { this.stopAuto(); this.advance(delta) },
		advance(delta) { this.audio.stop(); const next = Math.max(0, Math.min(this.game.steps.length, this.cursor + delta)); this.animateMove = delta === 1 && next !== this.cursor; this.cursor = next; this.queueReplayAudio() },
		queueReplayAudio() {
			this.replayGeneration = (this.replayGeneration || 0) + 1; const generation = this.replayGeneration, gameId = this.game._id, cursor = this.cursor
			this.replayNotBefore = Date.now() + 1200
			if (!this.soundEnabled) return
			const comments = [...(this.game.commentaries || []), ...this.game.steps.flatMap(s => s.commentaries || [])]
			const audios = comments.flatMap(c => (c.audio || []).map(a => ({ ...a, text: c.text })))
			const stepEvents = this.step?.events || [], moveOffset = this.step ? this.step.committed_at - this.game.started_at : 0
			let events = cursor === 0 ? this.game.events.filter(e => e.type === 'audio' && e.offset_ms < (this.game.steps[0]?.committed_at - this.game.started_at || Infinity)) : stepEvents.filter(e => e.type === 'audio')
			if (cursor === this.game.steps.length && cursor > 0) events = events.concat(this.game.events.filter(e => e.type === 'audio' && e.offset_ms >= moveOffset))
			events.sort((a,b) => a.offset_ms - b.offset_ms); let queuedUntil = this.step ? 1150 : 0
			for (const event of events) {
				const audio = audios.find(a => a.id === event.data?.audio_id && a.status === 'ready'); if (!audio) continue
				const delay = this.originalTiming ? Math.max(0, event.offset_ms - moveOffset) : queuedUntil
				queuedUntil = delay + (audio.duration_ms || Math.max(1000, (audio.text || '').length * 220))
				this.replayNotBefore = Math.max(this.replayNotBefore, Date.now() + queuedUntil)
				this.timeouts.push(setTimeout(() => { if (this.visible && this.replaying && this.replayGeneration === generation && this.game._id === gameId && this.cursor === cursor) this.audio.speak(gameId, audio, true) }, delay))
			}
		},
		returnLive() { this.stopAuto(); this.replayGeneration = (this.replayGeneration || 0) + 1; this.audio.stop(); this.replaying = false; this.animateMove = false; this.sheet = ''; this.refresh() },
		toggleAuto() { if (this.autoPlaying) return this.stopAuto(); this.autoPlaying = true; this.scheduleAuto() },
		scheduleAuto() { if (!this.autoPlaying || this.cursor >= this.game.steps.length) return this.stopAuto(); const next = this.game.steps[this.cursor], previous = this.cursor ? this.game.steps[this.cursor - 1].committed_at : this.game.started_at; let delay = this.originalTiming ? Math.max(1200, next.committed_at - (previous || next.committed_at)) : 2200; delay = Math.max(delay, (this.replayNotBefore || 0) - Date.now() + 300); this.autoTimer = setTimeout(() => { if (!this.autoPlaying) return; if (this.audio.busy) { this.autoTimer = setTimeout(() => this.scheduleAuto(), 500); return } this.advance(1); this.scheduleAuto() }, delay) },
		stopAuto() { clearTimeout(this.autoTimer); this.autoPlaying = false },
		async openVotes() { this.sheet = 'vote'; try { [this.models, this.votes] = await Promise.all([request('/api/models'), request('/api/votes')]) } catch (e) { this.notify(e) } },
		async castVote(id) { this.voting = true; try { await vote(this.votes.round_id, id); uni.showToast({ title: '投票成功', icon: 'success' }); this.votes = await request('/api/votes') } catch (e) { this.notify(e) } finally { this.voting = false } },
		notify(error) { uni.showToast({ title: error.message || '操作失败', icon: 'none' }) }
	}
}
</script>
<style src="./room.css"></style>
