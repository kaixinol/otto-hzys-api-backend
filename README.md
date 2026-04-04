# otto-hzys Backend

`otto-hzys` 的纯后端 API 包装层。

这个仓库不再提供前端页面，只保留音频生成 API、测试，以及后端包装层。上游源码来源固定为 `submod/`，目标上游仓库是 `https://github.com/hua-zhi-wan/otto-hzys`。

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

### `GET /health`

健康检查。

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

## Notes

- 包管理器统一为 `pnpm`
- 仓库不再包含前端 UI、Vue CLI 配置或浏览器试听能力
- 根仓不再保留 `public/static` 资源副本
