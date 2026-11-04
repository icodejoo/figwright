# Figwright 安装 / Install（{{TAG}}）

两部分：**MCP 服务端**（给 Claude Code、Cursor、Codex 等用）和 **Figma 插件**（在 Figma 桌面端运行）。需要 Node.js 20 或更新版本。

Two parts: the **MCP server** (for Claude Code, Cursor, Codex and other MCP clients) and the **Figma plugin** (runs in the Figma desktop app). Node.js 20 or newer is required.

## 1. 解压 / Unzip

解压到一个固定的位置，之后不要移动，例如 `E:\tools\figwright\`。

Unzip somewhere permanent, for example `E:\tools\figwright\`, and do not move it afterwards.

## 2. 装 MCP 服务端 / Install the MCP server

```sh
cd mcp
npm install --omit=dev
```

在 Claude Code 里注册（路径换成你自己的）：

Register it in Claude Code (use your own path):

```sh
claude mcp add figwright -- node E:/tools/figwright/mcp/dist/index.mjs
```

其他客户端的 JSON 配置：

JSON config for other clients:

```json
{
  "mcpServers": {
    "figwright": {
      "command": "node",
      "args": ["E:/tools/figwright/mcp/dist/index.mjs"]
    }
  }
}
```

改完配置后重启客户端，或在 Claude Code 里输入 `/mcp` 重连。

Restart the client after changing the config, or type `/mcp` in Claude Code to reconnect.

## 3. 装 Figma 插件 / Install the Figma plugin

1. 打开 Figma 桌面端，打开任意设计文件。Open the Figma desktop app and any design file.
2. 菜单 **Plugins → Development → Import plugin from manifest…**，选 `plugin/manifest.json`。Menu **Plugins → Development → Import plugin from manifest…**, then pick `plugin/manifest.json`.
3. 在要操作的文件里运行 **Plugins → Development → Figwright**，让面板一直开着。In each file you want to drive, run **Plugins → Development → Figwright** and keep the panel open.

## 4. 验证 / Verify

在客户端里让它调用 `ping`，返回 `plugin` 信息就说明连通了。

Ask the client to call `ping`; a `plugin` block in the result means it is connected.

## 常见问题 / Tips

- **同时开了多个文件**：不在前台的标签页会被 Figma 限速，读写可能卡 10 秒后报 `Unable to establish connection to Figma after 10 seconds`。把要操作的文件切到前台再试。
  **Several files open**: Figma throttles tabs that are not in front, so calls can stall for 10 seconds and then fail. Bring the target file to the front and retry.
- **用 `focus_file` 自动切前台（仅 Windows，会抢焦点）**：在 `~/.figwright/files.json` 里写 `{"文件名": "fileKey"}`，fileKey 是文件链接 `figma.com/design/<fileKey>/…` 里的那一段。
  **`focus_file` brings a file to the front (Windows only, it takes keyboard focus)**: put `{"file name": "fileKey"}` in `~/.figwright/files.json`; the fileKey is the segment in `figma.com/design/<fileKey>/…`.
- **升级**：下载新版 zip，覆盖 `mcp/` 和 `plugin/`，在 `mcp/` 里重新 `npm install --omit=dev`，重启客户端并重新运行插件。
  **Upgrade**: download the new zip, replace `mcp/` and `plugin/`, run `npm install --omit=dev` again in `mcp/`, restart the client and re-run the plugin.
