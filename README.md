# AI 象棋直播间

uni-app / Vue 3 竖屏观战应用。全站共享一场持续运行的对局，支持 OpenAI 兼容模型、思考开关、残局、回放、投票、原声归档和整局导入导出。

## 本地运行

需要 Node.js 22 或 24（建议 24 LTS）。

```sh
npm ci
npm run setup
npm run build:h5
npm run server
```

打开 [观战页](http://127.0.0.1:8787/) 和 [后台](http://127.0.0.1:8787/admin)。管理员令牌从本地 `server/.env` 的 `ADMIN_TOKEN` 读取，输入后台；不会在页面中保存令牌。

默认是**明确标注的本地演示模式**：规则引擎选择合法着法，数据保存在 `server/data/`，不调用付费模型，不冒充真实 AI 对战。关闭页面不影响服务端继续下棋。

开发前端可另开终端运行 `npm run dev:h5`，访问 5173 端口，由 Vite 转发 API 至 8787。

## 正式运行

正式数据使用 **uniCloud**，不使用 SQLite 或 MySQL。常驻 Node.js 服务负责调用模型和推进对局；云函数负责持久化。

1. 在 HBuilderX 关联自己的服务空间。
2. 上传 `uniCloud-alipay/database/` 下的 schema 和索引。
3. 运行 `npm run setup`，检查 `server/.env` 与 `cloudfunctions/common/xiangqi-config/config.json` 中的网关密钥一致。
4. 上传公共模块 `xiangqi-config` 与云函数 `xiangqi-store`，启用后者的 URL 化。
5. 在 `server/.env` 设置 `APP_MODE=live`、`UNICLOUD_STORE_URL`，保留生成的管理员令牌、访客签名密钥和加密主密钥。
6. 从后台或 uniCloud 控制台在 `xq_models` 中配置至少两个棋手，启用后服务自动开始对局。
7. 配置 HTTPS 域名和反向代理。也可使用 `docker compose up -d --build` 运行常驻服务。

必须先确认服务空间支持 `startTransaction`。服务拒绝绕过版本及租约校验；云端失败不会降级写入本地文件。

## 模型配置与 think

`xq_models` 每个模型一条记录，可直接在数据库后台维护，字段示例见 [model-config.json](docs/examples/model-config.json)。

- `base_url`、`model_name`、`api_key` 配置 OpenAI 兼容 Chat Completions 接口；基址可以包含 `/v1` 或供应商的实际路径。
- `thinking_mode`：`default` / `enabled` / `disabled`。
- `thinking_adapter`：`none` / `thinking_type` / `enable_thinking` / `reasoning_effort`，按供应商能力选择。
- `reasoning_effort`、`disabled_effort`、`max_tokens`、`token_limit_field`、`temperature`、`timeout_ms`、`max_attempts` 可配置。
- `can_play`、`can_commentate`、`allow_vote` 分别控制参赛、解说和投票资格。
- 密钥仅服务端读取。后台接口写入时使用 `MODEL_KEY_SECRET` 加密；也允许受信任的数据库后台直接维护明文或 `api_key_env` 引用。管理接口不回显 Key，留空保留旧值。
- 默认不允许访问内网模型地址；本机代理调试可显式设置 `ALLOW_PRIVATE_MODELS=true`，正式部署保持关闭。

接口连接测试会发起真实模型调用。思考能力和强度不是所有供应商统一支持的参数，需与所选模型文档一致。

## 每步保存、恢复及回放

`xq_games` **一局一条 JSON 记录**，内含 `steps[]`、调用与重试、解说、语音索引和播放事件。

1. 调用模型前保存 `pending_step` 和本次调用。
2. 保存请求结果与耗时。
3. 校验着法，原子提交新局面、棋步和版本。
4. 提交成功后更新观战画面，继续生成并保存解说与语音。

进程重启后恢复未完局，中断调用保留标记；存储失败暂停推进，不能展示未保存落子。调度租约防止两个实例同时下棋。

回放使用原始初始局面和步骤，可逐步观看或自动播放，可选择保留思考等待。原声按归档播放计划关联；未生成或失败的声音不会伪装成功。

## 残局、导入与导出

在后台手动摆棋或填写 FEN，选择双方模型及先走方，保存残局草稿后点“下局播出”。FEN 中 `w` 是红先、`b` 是黑先；先走方和局面会校验。

- 标准开局：[示例](docs/examples/standard-game.json)。
- 残局：[示例](docs/examples/endgame.json)。
- 完整单步档案：[示例](docs/examples/game-with-step.json)。
- JSON 导入用于纯棋谱；包含音频时使用完整 ZIP 导入。
- 从任意历史步创建续弈新局，来源棋局保留。
- 导出包包含一份 `game.json`、`manifest.json` 和实际 `audio/` 文件；记录缺失资源，不会只下载临时 URL。
- 导出在后台异步处理，一次一个任务，最多 64MB 原声资源；下载任务保留一小时，进程重启后可重新导出。导出临时包保存在 Node 本地缓存，原始棋谱与音频仍在 uniCloud。
- 超大 JSON 自动压缩外置云存储，棋局仍只有一条主记录；当前网关单个压缩档案或音频上限约 1.8MB，超限会明确报错，已保存棋局保留。

数据库说明见 [database/README.md](uniCloud-alipay/database/README.md)。运行租约、投票去重、防重放使用辅助集合，不拆分每局档案。

## 女声解说和音频

可启用一个 `can_commentate=true` 的模型生成简短解说；失败时保留错误记录并降级为规则报招。

语音使用豆包 TTS V3 流式接口，配置 `TTS_APP_ID`、`TTS_ACCESS_TOKEN`、`TTS_RESOURCE_ID`、`TTS_VOICE_ID`。文本模型 Key 与语音服务凭据分别配置。建议在账号控制台试听女声后填入实际可用音色；未配置语音时仅显示字幕。

音频原文件上传 uniCloud 云存储，保存 fileID、摘要、合成及上传耗时。后台可试听、下载或对失败语音重试；重试当前局的语音前先暂停对局。

## 构建与检查

```sh
npm test
npm run build:h5
VITE_API_BASE=https://your-api.example.com npm run build:mp-weixin
VITE_API_BASE=https://your-api.example.com npm run build:mp-toutiao
```

微信与抖音开发者工具分别导入 `dist/build/mp-weixin` 和 `dist/build/mp-toutiao`。小程序需填写 AppID、配置 HTTPS 请求及音频下载域名并真机验证。编译通过不代表已经完成账号登录、平台审核或自动推流。

## 当前边界

- 和棋采用三次同局面、120 半回合无吃子或400半回合上限的简化规则，未实现完整竞赛长将长捉裁定。
- 匿名投票按签名会话去重，不能保证一人一票；未接平台实名身份。
- 人物、棋子材质仍含用户参考截图的临时素材，正式发布前应替换成独立素材。配置形象图片可直接替换双方角色。
- 密钥及服务空间未提供，真实供应商调用、云端事务/云存储和小程序真机播放需部署后联调。
- 本项目不负责抖音推流；直播软件可采集竖屏网页。

官方接口依据：[uniCloud 云函数 URL 化](https://doc.dcloud.net.cn/uniCloud/http)、[数据库事务](https://doc.dcloud.net.cn/uniCloud/cf-database.html#transaction)、[DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[火山语音接口](https://docs.volcengine.com/docs/DoubaoVoice/HTTPChunkedSSEUnidirectionalStreaming-V3?lang=zh)。
