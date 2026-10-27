import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const platform = process.argv.includes('-p') ? process.argv[process.argv.indexOf('-p') + 1] : 'h5'
const child = spawn(process.execPath, [path.join(root, 'node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', env: { ...process.env, UNI_INPUT_DIR: root, UNI_OUTPUT_DIR: path.join(root, 'dist', process.argv.includes('build') ? 'build' : 'dev', platform) } })
child.on('exit', code => process.exit(code || 0))
