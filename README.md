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

### 本地开发

```bash
git submodule update --init --recursive
pnpm run install:local   # 跳过 Vercel 专用的 JS 音频解码库
pnpm start
```

本地模式默认依赖系统 `ffmpeg` 拼接音频，不需要 `node-wav`/`mpg123-decoder`。`install:local` 等同 `pnpm install --no-optional`，不会安装这两个库。

本地也可以切到纯 JS 远程模式（不调用 ffmpeg）：

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

### Vercel 部署

Vercel 版本始终使用纯 JS 解码 + `fetch` 拉取素材，**不调用 ffmpeg**。

```bash
# 使用默认素材地址（自身 /submod/public/static）
pnpm install
# 设置环境变量后部署
```

Vercel 面板配置：

- Framework Preset: `Other`
- Install Command: `pnpm install`（会安装 `node-wav` 和 `mpg123-decoder`）
- Build Command: 留空
- Output Directory: `.`

如需切换到自定义素材地址，设置 `OTTO_HZYS_ASSET_BASE_URL`：

```bash
OTTO_HZYS_ASSET_BASE_URL=https://otto-hzys.huazhiwan.top/static
```

## Static Assets

**默认**从本地 `submod/public/static` 读取静态素材，需要初始化 submodule。

**远程模式**：设置 `OTTO_HZYS_ASSET_BASE_URL` 后，服务从远程 URL 拉取静态资源（JSON 和音频文件），无需初始化 submodule。

本地版本未设置时默认远程地址为 `https://otto-hzys-api-backend.vercel.app/submod/public/static`。

Vercel 版本未设置时会自动根据当前请求的 host 构造 `https://<host>/submod/public/static`，支持预览部署和自定义域名。

## ffmpeg

- **本地模式**：音频拼接依赖系统中的 `ffmpeg` 可执行文件。
- **本地远程模式**：设置 `OTTO_HZYS_ASSET_BASE_URL` 后，使用纯 JavaScript 解码（`node-wav` + `mpg123-decoder`）+ `fetch` 拉取素材，**不调用 ffmpeg**。
- **Vercel 模式**：始终使用纯 JavaScript 解码 + `fetch` 拉取素材，**不调用 ffmpeg**。

本地启动时会检测 `ffmpeg`；缺失时 `/api/text-to-wav` 返回 `ffmpeg unavailable`。

## 环境变量

```bash
OTTO_HZYS_ASSET_BASE_URL=https://otto-hzys.huazhiwan.top/static
OTTO_HZYS_API_KEY=your-secret-key
OTTO_HZYS_MAX_TEXT_LENGTH=1000
```

说明：

- `OTTO_HZYS_ASSET_BASE_URL` — 设置后启用远程模式。本地版本未设置时默认使用 `https://otto-hzys-api-backend.vercel.app/submod/public/static`；Vercel 版本未设置时自动根据当前请求的 host 构造 `https://<host>/submod/public/static`
- `OTTO_HZYS_API_KEY` — 未配置时不启用认证；配置后请求必须携带 `Authorization: Bearer <key>`
- `OTTO_HZYS_MAX_TEXT_LENGTH` — 文本最大长度，默认 `1000`

## Vercel Version

仓库额外提供了一套单独的 Vercel 版本：

- 入口是 [`api/text-to-wav.js`](api/text-to-wav.js)
- 健康检查是 [`api/health.js`](api/health.js)
- 根路径前端是 [`index.html`](index.html)
- 始终使用纯 JS 解码，**不调用 ffmpeg**
- 素材默认从自身 `/submod/public/static` 拉取，自动适配当前请求域名（支持预览部署和自定义域名），也可通过 `OTTO_HZYS_ASSET_BASE_URL` 切换到自定义地址
- 与本地版本共享 [`lib/remote-audio.js`](lib/remote-audio.js) 中的纯 JS 音频处理逻辑

Vercel 根路径 `/` 提供一个简易前端，可直接输入文本、勾选参数并在页面内播放生成的 `wav`。

前端选项中的 `useNonDdbPinyin` 对应展示文案为"使用非电棍拼音"。
