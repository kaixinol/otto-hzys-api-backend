# otto-hzys Backend

`otto-hzys` 的纯后端 API 包装层。

上游源码来源固定为 `submod/`，目标上游仓库是  https://github.com/hua-zhi-wan/otto-hzys 。

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
- `assetBaseUrl`（Vercel 版本）

## Setup

```bash
git submodule update --init --recursive
pnpm install
pnpm start
```

运行测试：

```bash
pnpm test
```

## Static Assets

后端只从 `submod/public/static` 读取静态素材。

如果 `submod` 尚未初始化，服务会启动失败，并提示先执行：

```bash
git submodule update --init --recursive
```

## ffmpeg

音频拼接依赖系统中的 `ffmpeg` 可执行文件。

- 启动时会检测 `ffmpeg`
- 缺失时会在日志中打印明确错误
- `/api/text-to-wav` 会返回 `ffmpeg unavailable`

## Vercel Version

仓库额外提供了一套单独的 Vercel 版本：

- 入口是 [`api/text-to-wav.js`](/mnt/data/Project/otto-hzys-api-backend/api/text-to-wav.js)
- 健康检查是 [`api/health.js`](/mnt/data/Project/otto-hzys-api-backend/api/health.js)
- 根路径前端是 [`index.html`](/mnt/data/Project/otto-hzys-api-backend/index.html)
- 不依赖本地 `submod/public/static`
- 不依赖系统 `ffmpeg`
- 改为从 `https://otto-hzys.huazhiwan.top/static` 拉取远程资源
- `wav` 使用 `node-wav`
- `mp3` 使用 `mpg123-decoder`

可选环境变量：

```bash
OTTO_HZYS_ASSET_BASE_URL=https://otto-hzys.huazhiwan.top/static
OTTO_HZYS_API_KEY=your-secret-key
OTTO_HZYS_MAX_TEXT_LENGTH=1000
```

说明：

- 未配置 `OTTO_HZYS_ASSET_BASE_URL` 时，会默认使用 `https://otto-hzys.huazhiwan.top/static`
- 如果默认资源地址或自定义资源地址不可访问，`/health` 会返回 `503`，音频生成也会失败
- 未配置 `OTTO_HZYS_API_KEY` 时，不启用认证
- 配置 `OTTO_HZYS_API_KEY` 后，`POST /api/text-to-wav` 必须携带 `Authorization: Bearer <key>`
- `OTTO_HZYS_MAX_TEXT_LENGTH` 控制文本最大长度，默认 `1000`
- Vercel 根路径 `/` 现在提供一个简易前端，可直接输入文本、勾选参数并在页面内播放生成的 `wav`
- 前端选项中的 `useNonDdbPinyin` 对应展示文案为“使用非电棍拼音”

Vercel 面板可直接使用：

- Framework Preset: `Other`
- Install Command: `pnpm install`
- Build Command: 留空
- Output Directory: `.`
