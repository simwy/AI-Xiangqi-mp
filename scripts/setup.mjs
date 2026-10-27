import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const secret = () => crypto.randomBytes(32).toString('hex')
const file = path.join(root, 'server/.env')
let env
try { env = await fs.readFile(file, 'utf8'); console.log('保留已有 server/.env') }
catch {
	env = await fs.readFile(path.join(root, 'server/.env.example'), 'utf8')
	for (const name of ['ADMIN_TOKEN', 'VISITOR_SECRET', 'MODEL_KEY_SECRET', 'UNICLOUD_GATEWAY_SECRET']) env = env.replace(new RegExp('^' + name + '=$', 'm'), name + '=' + secret())
	await fs.writeFile(file, env, { mode: 0o600 }); console.log('已创建 server/.env；随机密钥只写入本地文件，不显示在终端')
}
const cloudDirectory = path.join(root, 'uniCloud-alipay/cloudfunctions/common/xiangqi-config')
await fs.mkdir(cloudDirectory, { recursive: true })
const gateway = env.match(/^UNICLOUD_GATEWAY_SECRET=(.+)$/m)?.[1]?.trim()
if (gateway) {
	try { await fs.access(path.join(cloudDirectory, 'config.json')); console.log('保留已有 xiangqi-config/config.json') }
	catch { await fs.writeFile(path.join(cloudDirectory, 'config.json'), JSON.stringify({ gatewaySecret: gateway }, null, 2) + '\n', { mode: 0o600 }); console.log('已创建本地云网关配置；需自行上传到所选服务空间') }
}
console.log('运行 npm run server；管理员令牌位于 server/.env。正式模式还需配置 uniCloud 与模型。')
