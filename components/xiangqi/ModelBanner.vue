<template>
	<view :class="['hero', side === 'black' ? 'opponent' : 'home']">
		<view class="hero-copy"><text class="role-tag">{{ side === 'red' ? '红方棋手' : '黑方棋手' }}</text><text class="name">{{ player?.display_name || '等待模型配置' }}</text><text class="player-meta">{{ side === 'red' ? '红方' : '黑方' }} · 大模型棋手</text><text class="state">{{ thinking ? '等待模型返回着法…' : '等待回合' }}</text></view>
		<view class="thought-orb"><text class="orb-title">{{ thinking ? '思考中' : '本步用时' }}</text><text class="orb-clock">{{ clock }}</text><text class="orb-status">{{ thinking ? '正在选择着法' : elapsed == null ? '尚未落子' : '已落子 · 等待' }}</text><text class="orb-caption">{{ thinking ? '服务端计时' : '模型决策耗时' }}</text></view>
		<view :class="['model-picture', reference ? 'portrait' : whale ? 'whale-picture' : 'custom-picture']"><image :src="source" :mode="reference || whale ? 'widthFix' : 'aspectFit'" :class="{ 'reference-image': reference }" /></view>
	</view>
</template>
<script>
export default {
	props: { side: String, player: Object, thinking: Boolean, elapsed: { type: Number, default: 0 } },
	computed: {
		source() { return this.player?.avatar_url || (this.side === 'red' ? '/static/xiangqi/reference.png' : '/static/xiangqi/deepseek.svg') },
		reference() { return this.source.endsWith('/reference.png') }, whale() { return this.source.endsWith('/deepseek.svg') },
		clock() { if (this.elapsed == null) return '--:--'; const seconds = Math.max(0, Math.floor(this.elapsed / 1000)); return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0') }
	}
}
</script>
<style src="../../pages/room/room.css"></style>
