<template>
	<view :class="['board', { 'landing-jolt': landing }]">
		<view class="grid">
			<view class="palace" /><view class="palace bottom" /><view class="river"><text>楚 河</text><text>汉 界</text></view>
			<view v-if="pathStyle" class="path" :style="pathStyle" />
			<view v-if="originStyle" class="marker" :style="originStyle" />
			<view v-for="p in rendered" :key="p.id" :class="['piece', { fallback: p.side === 'red' && p.type === 'c', active: p.x === lastTo?.[0] && p.y === lastTo?.[1], 'flying-piece': p.id === movingId }]" :style="pieceStyle(p)"><text>{{ label(p) }}</text></view>
			<view v-if="landing" class="landing-impact hit" :style="landingStyle" />
		</view>
		<view v-if="tactic" :class="['battle-effect', tactic === '绝杀' ? 'mate' : 'check']"><view class="battle-ring"/><view class="battle-ring second"/><text>{{ tactic }}</text><text class="tactic-caption">{{ tactic === '绝杀' ? '一锤定音' : '将军' }}</text></view>
	</view>
</template>
<script>
const sprites = { red: { r: [936, 464], n: [938, 929], b: [575, 697], a: [575, 581], k: [575, 464], p: [575, 1173] }, black: { r: [454, 812], n: [210, 811], b: [332, 1530], a: [575, 1412], k: [575, 1530], c: [209, 1290], p: [93, 1174] } }
const labels = { red: { r: '车', n: '马', b: '相', a: '仕', k: '帅', c: '炮', p: '兵' }, black: { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' } }
export default {
	props: { board: Array, step: Object, moveKey: String, animateMove: Boolean, size: Object }, emits: ['land'],
	data() { return { rendered: [], movingId: '', lastTo: null, originStyle: null, pathStyle: null, landingStyle: null, landing: false, tactic: '', timers: [], epoch: 0 } },
	watch: { moveKey: { immediate: true, handler() { this.update() } }, board: { handler() { if (!this.movingId) this.rendered = this.board?.map(p => ({ ...p })) || [] }, deep: false } },
	beforeUnmount() { this.timers.forEach(clearTimeout) },
	methods: {
		label(p) { return labels[p.side][p.type] },
		pieceStyle(p) {
			const s = sprites[p.side][p.type], style = { left: p.x * 12.5 + '%', top: p.y * 100 / 9 + '%' }
			if (s) Object.assign(style, { '--bw': 1152 / 110 * 100 + '%', '--bh': 2376 / 110 * 100 + '%', '--bx': (s[0] - 55) / (1152 - 110) * 100 + '%', '--by': (s[1] - 55) / (2376 - 110) * 100 + '%' })
			return style
		},
		later(fn, ms) { const epoch = this.epoch; this.timers.push(setTimeout(() => { if (epoch === this.epoch) fn() }, ms)) },
		update() {
			this.epoch++; this.timers.forEach(clearTimeout); this.timers = []; this.movingId = ''; this.landing = false; this.tactic = ''
			const next = this.board?.map(p => ({ ...p })) || [], move = this.step?.move
			if (!move) { this.rendered = next; this.originStyle = this.pathStyle = null; return }
			this.lastTo = move.to; this.originStyle = { left: move.from[0] * 12.5 + '%', top: move.from[1] * 100 / 9 + '%' }
			const dx = (move.to[0] - move.from[0]) * this.size.width * .928 * .904 / 8, dy = (move.to[1] - move.from[1]) * this.size.height * .507 * .9 / 9
			this.pathStyle = { ...this.originStyle, width: Math.hypot(dx, dy) + 'px', transform: 'rotate(' + Math.atan2(dy, dx) + 'rad)' }
			const moved = next.find(p => p.x === move.to[0] && p.y === move.to[1])
			if (!this.animateMove || !moved) { this.rendered = next; return }
			this.movingId = moved.id; this.rendered = next.map(p => p.id === moved.id ? { ...p, x: move.from[0], y: move.from[1] } : p)
			this.later(() => { this.rendered = next }, 220)
			this.later(() => { this.landing = true; this.landingStyle = { left: move.to[0] * 12.5 + '%', top: move.to[1] * 100 / 9 + '%' }; this.$emit('land'); this.tactic = this.step.outcome?.terminal && this.step.outcome?.check ? '绝杀' : this.step.outcome?.check ? '将军' : '' }, 925)
			this.later(() => { this.movingId = ''; this.landing = false }, 1130)
			this.later(() => { this.tactic = '' }, 4600)
		}
	}
}
</script>
<style src="../../pages/room/room.css"></style>
