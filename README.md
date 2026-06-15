# otto-hzys Backend

`otto-hzys` 的纯后端 API 包装层。

上游源码来源固定为 `submod/`，目标上游仓库是 <https://github.com/hua-zhi-wan/otto-hzys>。

测试 Vercel 页面：https://otto-hzys-api-backend.vercel.app/

## API

### `POST /api/text-to-wav`

将文本转换为 `wav` 音频。

请求体：

```json
{
  "text": "要转换的文本内容",
  "isYsdd": false,
  "useNonDdbPinyin": false,
  "isSliced": false
}
```

当配置了 `OTTO_HZYS_API_KEY` 后，请求还需要带上：

```http
Authorization: Bearer <your-key>
```

### `GET /health`

健康检查。

返回当前运行时信息，包括：

- `authEnabled`
- `maxTextLength`
- `remoteMode` — 是否启用远程模式
- `assetBaseUrl`（仅当 `remoteMode` 为 `true` 时返回）

## Setup

```bash
git submodule update --init --recursive
pnpm install
pnpm start
```

默认使用本地 `submod/public/static` 资源，需要初始化 submodule。

如需使用远程资源，设置 `OTTO_HZYS_ASSET_BASE_URL`：

```bash
# 使用默认远程地址（Vercel 部署的 static 目录）
OTTO_HZYS_ASSET_BASE_URL= pnpm start

# 或指定自定义远程地址
OTTO_HZYS_ASSET_BASE_URL=https://otto-hzys.huazhiwan.top/static pnpm start
```

运行测试：

```bash
pnpm test
```

## Static Assets

**默认**从本地 `submod/public/static` 读取静态素材，需要初始化 submodule。

**远程模式**：设置 `OTTO_HZYS_ASSET_BASE_URL` 后，服务从远程 URL 拉取静态资源（JSON 和音频文件），无需初始化 submodule。

本地版本默认远程地址为 `https://otto-hzys-api-backend.vercel.app/submod/public/static`，Vercel 版本无默认远程地址。

## ffmpeg

音频拼接依赖系统中的 `ffmpeg` 可执行文件（**仅在本地模式下需要**）。

- 启动时会检测 `ffmpeg`
- 缺失时会在日志中打印明确错误
- `/api/text-to-wav` 会返回 `ffmpeg unavailable`

在远程模式下，使用纯 JavaScript 解码（`node-wav` + `mpg123-decoder`），**不需要** `ffmpeg`。

## 环境变量

```bash
OTTO_HZYS_ASSET_BASE_URL=https://otto-hzys.huazhiwan.top/static
OTTO_HZYS_API_KEY=your-secret-key
OTTO_HZYS_MAX_TEXT_LENGTH=1000
```

说明：

- `OTTO_HZYS_ASSET_BASE_URL` — 设置后启用远程模式。本地版本未设置时使用默认值 `https://otto-hzys-api-backend.vercel.app/submod/public/static`，Vercel 版本未设置时使用本地 submodule
- `OTTO_HZYS_API_KEY` — 未配置时不启用认证；配置后请求必须携带 `Authorization: Bearer <key>`
- `OTTO_HZYS_MAX_TEXT_LENGTH` — 文本最大长度，默认 `1000`

## Vercel Version

仓库额外提供了一套单独的 Vercel 版本：

- 入口是 [`api/text-to-wav.js`](api/text-to-wav.js)
- 健康检查是 [`api/health.js`](api/health.js)
- 根路径前端是 [`index.html`](index.html)
- **默认**使用本地 `submod/public/static`（需要初始化 submodule）
- 设置 `OTTO_HZYS_ASSET_BASE_URL` 可切换为远程模式，使用 `node-wav` + `mpg123-decoder` 纯 JS 解码
- 与本地版本共享 [`lib/remote-audio.js`](lib/remote-audio.js) 中的远程音频处理逻辑

Vercel 根路径 `/` 提供一个简易前端，可直接输入文本、勾选参数并在页面内播放生成的 `wav`。

前端选项中的 `useNonDdbPinyin` 对应展示文案为"使用非电棍拼音"。

Vercel 面板可直接使用：

- Framework Preset: `Other`
- Install Command: `pnpm install`
- Build Command: 留空
- Output Directory: `.`