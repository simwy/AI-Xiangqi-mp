import test from 'node:test'
import assert from 'node:assert/strict'
import { INITIAL_FEN, parseFen, validatePosition, legalMoves, applyMove, toFen, inCheck, notation, validateGame } from '../../common/xiangqi/rules.mjs'

test('标准开局 FEN、44 个合法着法及两层 1920 个节点', () => {
	const p = validatePosition(INITIAL_FEN)
	assert.equal(p.board.length, 32); assert.equal(toFen(p), INITIAL_FEN)
	const moves = legalMoves(p); assert.equal(moves.length, 44)
	assert.equal(moves.reduce((n, m) => n + legalMoves(applyMove(p, m).position).length, 0), 1920)
})
test('炮二平五，FEN 与走方准确更新', () => {
	const p = parseFen(INITIAL_FEN), r = applyMove(p, { from: [7, 7], to: [4, 7] })
	assert.equal(r.notation, '炮二平五'); assert.equal(r.position.side, 'black')
	assert.match(toFen(r.position), /1C2C4\/9\/RNBAKABNR b/)
	assert.equal(toFen(p), INITIAL_FEN)
})
test('蹩马腿、炮架与炮不能无架吃子', () => {
	const p = parseFen('4k4/9/9/9/4p4/9/9/1C1p3n1/9/4K4 w - - 0 1')
	assert(legalMoves(p).some(m => m.id === '17-77'))
	p.board = p.board.filter(q => !(q.x === 3 && q.y === 7))
	assert(!legalMoves(p).some(m => m.id === '17-77'))
	const start = parseFen(INITIAL_FEN); start.board.push({ id: 'block', type: 'p', side: 'red', x: 1, y: 8 })
	assert(!legalMoves(start).some(m => m.id === '19-27'))
})
test('将帅照面时不能移开遮挡子', () => {
	const p = parseFen('4k4/9/9/9/9/4R4/9/9/9/4K4 w - - 0 1')
	assert(!legalMoves(p).some(m => m.id === '45-35'))
	assert(legalMoves(p).some(m => m.id === '45-44'))
})
test('兵卒过河之前不能横走，过河后不能后退', () => {
	const p = parseFen(INITIAL_FEN)
	assert(!legalMoves(p).some(m => m.id === '06-16'))
	const q = p.board.find(q => q.type === 'p' && q.side === 'red' && q.x === 0); q.y = 4
	assert(legalMoves(p).some(m => m.id === '04-14')); assert(!legalMoves(p).some(m => m.id === '04-05'))
})
test('将死与残局的先走方校验', () => {
	const p = validatePosition('3k5/3RR4/9/9/9/9/9/9/9/4K4 b - - 0 1')
	assert(inCheck(p.board, 'black')); assert.equal(legalMoves(p).length, 0)
	assert.throws(() => validatePosition(toFen({ ...p, side: 'red' })), /未轮到/)
	assert.doesNotThrow(() => validatePosition('4k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1'))
})
test('异常 FEN、士象位置、将帅照面和棋子过量被拒绝', () => {
	for (const fen of ['9/9 w', '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1', '4k4/9/9/9/4p4/9/9/9/2A6/4K4 w - - 0 1', '4k4/9/9/9/4p4/3B5/9/9/9/4K4 w - - 0 1', '4k4/9/9/9/4p4/9/9/9/NNN6/4K4 w - - 0 1']) assert.throws(() => validatePosition(fen))
})
test('同路前后车着法及导入历史逐步校验', () => {
	const p = parseFen('4k4/9/9/9/4p4/9/R8/9/R8/4K4 w - - 0 1')
	assert.equal(notation(p, { from: [0, 6], to: [1, 6] }), '前车平八')
	const result = applyMove(parseFen(INITIAL_FEN), { from: [7, 7], to: [4, 7] })
	const game = { schema_version: 1, initial_position: { fen: INITIAL_FEN, side_to_move: 'red' }, current_fen: toFen(result.position), steps: [{ seq: 1, side: 'red', move: result.move, fen_before: INITIAL_FEN, fen_after: toFen(result.position) }] }
	assert.doesNotThrow(() => validateGame(game)); game.steps[0].seq = 2; assert.throws(() => validateGame(game), /不连续/)
})
