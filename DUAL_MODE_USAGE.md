# Chrome DevTools MCP 双模式使用指南

## 🎯 概述

支持两种运行模式，通过启动参数切换：

1. **stdio 模式**（默认）- 适合本地使用
2. **HTTP 模式** - 支持远程访问

---

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/your-repo/chrome-devtools-mcp.git
cd chrome-devtools-mcp

# 安装依赖
npm install

# 构建
npm run build
```

---

## 🚀 使用方法

### 1️⃣ stdio 模式（默认）

**直接运行：**
```bash
node build/src/index.js
```

**Cursor 配置：** `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "Chrome DevTools": {
      "command": "node",
      "args": ["/path/to/chrome-devtools-mcp/build/src/index.js"]
    }
  }
}
```

**带参数：**
```json
{
  "mcpServers": {
    "Chrome DevTools": {
      "command": "node",
      "args": [
        "/path/to/chrome-devtools-mcp/build/src/index.js",
        "--browserUrl", "http://127.0.0.1:9222"
      ]
    }
  }
}
```

---

### 2️⃣ HTTP 模式

**启动服务：**
```bash
# 默认端口 8100
node build/src/index.js --http-server

# 自定义端口
node build/src/index.js --http-server --port 3000

# 自定义主机和端口
node build/src/index.js --http-server --host 127.0.0.1 --port 8080
```

**输出示例：**
```
Starting in HTTP server mode
Chrome DevTools MCP Server is running on http://0.0.0.0:8100
Health check: http://0.0.0.0:8100/health
MCP endpoint: http://0.0.0.0:8100/mcp
```

**Cursor 配置：**
```json
{
  "mcpServers": {
    "Chrome DevTools HTTP": {
      "url": "http://localhost:8100/mcp"
    }
  }
}
```

---

## 📋 命令行参数

### HTTP 模式参数

| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `--http-server` | boolean | false | 启用 HTTP 模式 |
| `--port` | number | 8100 | 监听端口 |
| `--host` | string | 0.0.0.0 | 绑定主机 |

### Chrome 相关参数（两种模式都支持）

```bash
--channel <stable|beta|canary|dev>   # Chrome 版本
--executablePath <path>               # Chrome 路径
--browserUrl <url>                    # 连接已运行的 Chrome
--headless                            # 无头模式
--isolated                            # 隔离模式
--viewport <widthxheight>             # 视口大小
```

---

## 💡 使用场景

### 场景 1：本地开发（stdio）

```bash
# 启动
node build/src/index.js --channel canary
```

```json
// Cursor 配置
{
  "mcpServers": {
    "Chrome DevTools": {
      "command": "node",
      "args": [
        "/Users/liuziming/chrome-devtools-mcp/build/src/index.js",
        "--channel", "canary"
      ]
    }
  }
}
```

### 场景 2：远程开发（HTTP）

**场景：** Cursor SSH 连接到远程开发机，但在本地调试浏览器

```bash
# 本地 Mac：启动 HTTP 服务
node build/src/index.js --http-server --host 0.0.0.0 --port 8100
```

```json
// Cursor 配置（本地 Mac）
{
  "mcpServers": {
    "Chrome DevTools": {
      "url": "http://localhost:8100/mcp"
    }
  }
}
```

**架构：**
```
本地 Mac (MCP 服务:8100 + Chrome)
    ↑
    │ HTTP
    │
Cursor (SSH 到远程开发机)
```

### 场景 3：连接已运行的 Chrome

```bash
# 1. 手动启动 Chrome
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222

# 2. 启动 MCP (stdio 模式)
node build/src/index.js --browserUrl http://127.0.0.1:9222

# 或 HTTP 模式
node build/src/index.js --http-server --browserUrl http://127.0.0.1:9222
```

---

## 🧪 测试

### stdio 模式
无法直接测试，需要通过 MCP 客户端使用。

### HTTP 模式

```bash
# 健康检查
curl http://localhost:8100/health

# 预期响应
{
  "status": "ok",
  "service": "Chrome DevTools MCP Server",
  "version": "0.8.1",
  "mode": "http",
  "timestamp": "..."
}

# MCP 初始化
curl -X POST http://localhost:8100/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test", "version": "1.0.0"}
    },
    "id": 1
  }'
```

---

## 🔄 模式对比

| 特性 | stdio 模式 | HTTP 模式 |
|-----|-----------|----------|
| **启动** | `node build/src/index.js` | `node build/src/index.js --http-server` |
| **配置** | `command` + `args` | `url` |
| **远程访问** | ❌ | ✅ |
| **端口** | 无 | 8100（可配置） |
| **适用场景** | 本地开发 | 远程/共享 |

---

## 🔧 开发调试

### 修改代码后重新构建

```bash
npm run build
# 然后重启服务
```

### 查看日志

```bash
# 设置环境变量查看详细日志
DEBUG=* node build/src/index.js --http-server

# 或保存到文件
node build/src/index.js --http-server --logFile /tmp/mcp.log
```

---

## 📝 常见问题

### Q: 如何在 Cursor 中使用本地版本？

**A: stdio 模式（推荐）**
```json
{
  "mcpServers": {
    "Chrome DevTools": {
      "command": "node",
      "args": ["/Users/liuziming/chrome-devtools-mcp/build/src/index.js"]
    }
  }
}
```

**A: HTTP 模式**
1. 启动服务：`node build/src/index.js --http-server`
2. 配置：`{"url": "http://localhost:8100/mcp"}`

### Q: 修改代码后如何生效？

**A:**
```bash
npm run build  # 重新构建
# 然后重启 Cursor 或 HTTP 服务
```

### Q: 找不到 Chrome？

**A:** 指定路径
```bash
node build/src/index.js --executablePath /path/to/chrome
```

### Q: HTTP 模式端口被占用？

**A:** 更换端口
```bash
node build/src/index.js --http-server --port 3000
```

---

## 🎉 快速开始

```bash
# 1. 克隆并构建
git clone <repo>
cd chrome-devtools-mcp
npm install
npm run build

# 2a. stdio 模式（本地）
node build/src/index.js

# 2b. HTTP 模式（远程）
node build/src/index.js --http-server

# 3. 配置 Cursor 后使用
```

---

**核心改动：** 只需在启动命令添加 `--http-server` 即可切换模式！
