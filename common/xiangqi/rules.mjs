export const INITIAL_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
export const opposite = side => side === 'red' ? 'black' : 'red'
const inside = (x, y) => x >= 0 && x < 9 && y >= 0 && y < 10
const palace = (side, x, y) => x >= 3 && x <= 5 && (side === 'red' ? y >= 7 && y <= 9 : y >= 0 && y <= 2)
const crossed = p => p.side === 'red' ? p.y <= 4 : p.y >= 5
export const at = (board, x, y) => board.find(p => p.x === x && p.y === y)

export function parseFen(fen) {
	if (typeof fen !== 'string' || fen.length > 300) throw new Error('FEN 格式无效')
	const fields = fen.trim().split(/\s+/), rows = fields[0].split('/')
	if (rows.length !== 10 || !['w', 'r', 'b'].includes(fields[1])) throw new Error('FEN 需要十行棋盘及先走方 w/b')
	const board = [], counts = {}
	rows.forEach((row, y) => {
		let x = 0
		for (const c of row) {
			if (/^[1-9]$/.test(c)) x += Number(c)
			else {
				const type = c.toLowerCase().replace('h', 'n').replace('e', 'b')
				if (!'rnbakcp'.includes(type) || x >= 9) throw new Error('FEN 棋子或行宽无效')
				const side = c === c.toUpperCase() ? 'red' : 'black', key = side + type
				board.push({ id: `${key}-${counts[key] = (counts[key] || 0) + 1}`, type, side, x: x++, y })
			}
		}
		if (x !== 9) throw new Error('FEN 每行必须为九路')
	})
	const halfmove = fields[4] === undefined ? 0 : Number(fields[4]), fullmove = fields[5] === undefined ? 1 : Number(fields[5])
	if (!Number.isSafeInteger(halfmove) || halfmove < 0 || !Number.isSafeInteger(fullmove) || fullmove < 1) throw new Error('FEN 回合计数无效')
	return { board, side: fields[1] === 'b' ? 'black' : 'red', halfmove, fullmove }
}

export function toFen(position) {
	const rows = []
	for (let y = 0; y < 10; y++) {
		let row = '', blank = 0
		for (let x = 0; x < 9; x++) {
			const p = at(position.board, x, y)
			if (!p) blank++
			else { if (blank) row += blank; blank = 0; row += p.side === 'red' ? p.type.toUpperCase() : p.type }
		}
		if (blank) row += blank
		rows.push(row)
	}
	return `${rows.join('/')} ${position.side === 'red' ? 'w' : 'b'} - - ${position.halfmove || 0} ${position.fullmove || 1}`
}

function targets(board, p) {
	const result = []
	const add = (x, y) => { if (inside(x, y) && at(board, x, y)?.side !== p.side) result.push([x, y]) }
	const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
	if (p.type === 'r' || p.type === 'c') {
		for (const [dx, dy] of dirs) {
			let screen = false
			for (let x = p.x + dx, y = p.y + dy; inside(x, y); x += dx, y += dy) {
				const q = at(board, x, y)
				if (p.type === 'r') { add(x, y); if (q) break }
				else if (!screen) { if (q) screen = true; else add(x, y) }
				else if (q) { add(x, y); break }
			}
		}
	} else if (p.type === 'n') {
		for (const [dx, dy] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
			if (!at(board, p.x + (Math.abs(dx) === 2 ? dx / 2 : 0), p.y + (Math.abs(dy) === 2 ? dy / 2 : 0))) add(p.x + dx, p.y + dy)
		}
	} else if (p.type === 'b') {
		for (const dx of [-2, 2]) for (const dy of [-2, 2]) {
			const y = p.y + dy
			if ((p.side === 'red' ? y >= 5 : y <= 4) && !at(board, p.x + dx / 2, p.y + dy / 2)) add(p.x + dx, y)
		}
	} else if (p.type === 'a') {
		for (const dx of [-1, 1]) for (const dy of [-1, 1]) if (palace(p.side, p.x + dx, p.y + dy)) add(p.x + dx, p.y + dy)
	} else if (p.type === 'k') {
		for (const [dx, dy] of dirs) if (palace(p.side, p.x + dx, p.y + dy)) add(p.x + dx, p.y + dy)
		const king = board.find(q => q.type === 'k' && q.side !== p.side)
		if (king && king.x === p.x && !board.some(q => q.x === p.x && q.y > Math.min(p.y, king.y) && q.y < Math.max(p.y, king.y))) add(king.x, king.y)
	} else {
		add(p.x, p.y + (p.side === 'red' ? -1 : 1))
		if (crossed(p)) { add(p.x - 1, p.y); add(p.x + 1, p.y) }
	}
	return result
}

export function inCheck(board, side) {
	const king = board.find(p => p.side === side && p.type === 'k')
	return !king || board.some(p => p.side !== side && targets(board, p).some(([x, y]) => x === king.x && y === king.y))
}
function moveBoard(board, from, to) {
	return board.filter(p => p.x !== to[0] || p.y !== to[1]).map(p => p.x === from[0] && p.y === from[1] ? { ...p, x: to[0], y: to[1] } : { ...p })
}
export const moveId = (from, to) => `${from[0]}${from[1]}-${to[0]}${to[1]}`
export function legalMoves(position) {
	const moves = []
	for (const p of position.board.filter(p => p.side === position.side)) for (const to of targets(position.board, p)) {
		if (at(position.board, ...to)?.type === 'k') continue
		const from = [p.x, p.y]
		if (!inCheck(moveBoard(position.board, from, to), p.side)) moves.push({ id: moveId(from, to), from, to, piece_id: p.id })
	}
	return moves
}

const labels = { red: { r: '车', n: '马', b: '相', a: '仕', k: '帅', c: '炮', p: '兵' }, black: { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' } }
const nums = '〇一二三四五六七八九'
export function notation(position, move) {
	const p = at(position.board, ...move.from)
	if (!p) throw new Error('起点没有棋子')
	const file = x => p.side === 'red' ? 9 - x : x + 1
	const number = n => p.side === 'red' ? nums[n] : String(n)
	const peers = position.board.filter(q => q.side === p.side && q.type === p.type && q.x === p.x).sort((a, b) => p.side === 'red' ? a.y - b.y : b.y - a.y)
	let prefix = labels[p.side][p.type] + number(file(p.x))
	if (peers.length > 1) {
		const index = peers.findIndex(q => q.id === p.id)
		const order = peers.length === 2 ? ['前', '后'] : peers.length === 3 ? ['前', '中', '后'] : peers.length === 4 ? ['前', '二', '三', '后'] : ['前', '二', '三', '四', '后']
		// For multiple pawn files include the file to keep the archive unambiguous.
		prefix = order[index] + labels[p.side][p.type] + (p.type === 'p' && position.board.some(q => q.side === p.side && q.type === 'p' && q.x !== p.x && position.board.some(r => r !== q && r.side === q.side && r.type === 'p' && r.x === q.x)) ? number(file(p.x)) : '')
	}
	const dy = move.to[1] - p.y
	if (!dy) return prefix + '平' + number(file(move.to[0]))
	const advance = p.side === 'red' ? dy < 0 : dy > 0
	return prefix + (advance ? '进' : '退') + number(['n', 'b', 'a'].includes(p.type) ? file(move.to[0]) : Math.abs(dy))
}

export function applyMove(position, input) {
	const id = typeof input === 'string' ? input : moveId(input.from, input.to)
	const move = legalMoves(position).find(m => m.id === id)
	if (!move) throw new Error('非法着法：' + id)
	const captured = at(position.board, ...move.to)
	const next = { board: moveBoard(position.board, move.from, move.to), side: opposite(position.side), halfmove: captured ? 0 : (position.halfmove || 0) + 1, fullmove: (position.fullmove || 1) + (position.side === 'black' ? 1 : 0) }
	return { position: next, move, notation: notation(position, move), captured, check: inCheck(next.board, next.side), terminal: legalMoves(next).length === 0 }
}

export function validatePosition(fen) {
	const p = parseFen(fen), limits = { k: 1, a: 2, b: 2, n: 2, r: 2, c: 2, p: 5 }
	for (const side of ['red', 'black']) {
		for (const [type, max] of Object.entries(limits)) {
			const pieces = p.board.filter(q => q.side === side && q.type === type)
			if ((type === 'k' && pieces.length !== 1) || pieces.length > max) throw new Error('棋子数量无效：' + side + type)
		}
	}
	for (const q of p.board) {
		if (['k', 'a'].includes(q.type) && !palace(q.side, q.x, q.y)) throw new Error('将帅或士必须在九宫内')
		if (q.type === 'a' && ![[3, q.side === 'red' ? 7 : 0], [5, q.side === 'red' ? 7 : 0], [4, q.side === 'red' ? 8 : 1], [3, q.side === 'red' ? 9 : 2], [5, q.side === 'red' ? 9 : 2]].some(([x, y]) => x === q.x && y === q.y)) throw new Error('士的位置不可达')
		if (q.type === 'b' && ![[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]].some(([x, y]) => x === q.x && (q.side === 'red' ? 9 - y : y) === q.y)) throw new Error('象的位置不可达或过河')
		if (q.type === 'p' && ((q.side === 'red' ? q.y > 6 : q.y < 3) || (!crossed(q) && q.x % 2 !== 0))) throw new Error('兵卒的位置不可达')
	}
	if (inCheck(p.board, opposite(p.side))) throw new Error('未轮到走棋的一方不能已经被将军；请检查先走方及将帅照面')
	return p
}

export function validateGame(game) {
	if (!game || game.schema_version !== 1 || !Array.isArray(game.steps) || game.steps.length > 10000) throw new Error('棋局版本或步骤格式无效')
	let p = validatePosition(game.initial_position?.fen)
	if (game.initial_position.side_to_move !== p.side) throw new Error('先走方与 FEN 不一致')
	game.steps.forEach((step, index) => {
		if (step.seq !== index + 1 || step.side !== p.side || step.fen_before !== toFen(p)) throw new Error('棋谱步骤不连续：' + (index + 1))
		const result = applyMove(p, step.move)
		if (step.fen_after !== toFen(result.position)) throw new Error('棋谱局面不匹配：' + step.seq)
		p = result.position
	})
	if (game.current_fen && game.current_fen !== toFen(p)) throw new Error('当前局面与完整棋谱不一致')
	return p
}
