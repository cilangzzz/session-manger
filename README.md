# Multi-Session Manager

<p align="center">
  <strong>📦 Chrome/Edge 扩展 - 多账号会话隔离管理器</strong>
</p>

<p align="center">
  同一网站，多账号同时登录 | 标签页级别会话隔离 | 数据安全存储
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-88+-green?logo=google-chrome" alt="Chrome 88+">
  <img src="https://img.shields.io/badge/Edge-88+-blue?logo=microsoft-edge" alt="Edge 88+">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
</p>

---

## ✨ 功能特性

- 🔄 **会话隔离** - 每个标签页独立管理 Cookies 和 Web Storage
- 👤 **多账号登录** - 同一网站可同时登录多个账号
- 🎨 **可视化标识** - 彩色标签组区分不同会话
- 💾 **数据持久化** - 会话数据安全保存，关闭后可恢复
- 🔒 **隐私保护** - 所有数据本地存储，不上传任何服务器
- ⌨️ **快捷键支持** - 快速创建和切换会话

## 📸 截图预览

<!-- 截图占位 - 使用以下方式添加截图:
     1. 在浏览器中安装扩展后截图
     2. 将截图保存到 screenshots/ 目录
     3. 更新下面的图片路径
-->

| 弹出窗口 | 设置页面 |
|:-------:|:-------:|
| ![Popup](screenshots/popup.png) | ![Options](screenshots/options.png) |

| 创建会话 | 会话列表 |
|:-------:|:-------:|
| ![Create](screenshots/create.png) | ![List](screenshots/list.png) |

## 🚀 快速开始

### 安装方式

#### 方式一：开发者模式（推荐）

1. 下载或克隆本项目
   ```bash
   git clone https://github.com/cilangzzz/session-manger.git
   cd session-manger
   ```

2. 生成图标文件
   - 在浏览器中打开 `multi-session-manager/icons/generate-icons.html`
   - 图标会自动下载
   - 将 `icon16.png`、`icon48.png`、`icon128.png` 移动到 `icons/` 目录

3. 加载扩展
   - 打开 Chrome/Edge，访问 `chrome://extensions/`
   - 开启右上角「开发者模式」
   - 点击「加载已解压的扩展程序」
   - 选择 `multi-session-manager` 文件夹

#### 方式二：直接安装 CRX

如果已有 `.crx` 文件：
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 将 `.crx` 文件拖放到扩展页面

## 📖 使用指南

### 基本操作

#### 创建新会话

1. 点击扩展图标打开弹出窗口
2. 点击右上角 **+ New** 按钮
3. 输入会话名称（如"工作账号"）
4. 可选：设置起始 URL 和标签组颜色
5. 点击 **Create** 创建

#### 切换会话

- **方式一**：点击弹出窗口中的会话项
- **方式二**：使用快捷键 `Ctrl+Shift+M` 切换下一个会话
- **方式三**：点击 Chrome 标签组切换

#### 关闭/删除会话

- **关闭会话**：保留存储数据，点击会话项的 ✕ 按钮
- **删除会话**：彻底删除数据和标签组（仅对已关闭的会话）

### 设置选项

| 选项 | 说明 |
|-----|------|
| Auto-switch cookies | 自动切换标签页的 Cookies |
| Auto-save (invisible) | 自动保存在后台标签页的存储数据 |

### 快捷键

| 快捷键 | 功能 |
|-------|------|
| `Ctrl+Shift+S` | 创建新会话 |
| `Ctrl+Shift+M` | 切换到下一个会话 |

> 可在 `chrome://extensions/shortcuts` 自定义快捷键

## 🏗️ 项目结构

```
multi-session-manager/
├── manifest.json              # 扩展配置
├── background/
│   ├── index.js               # Service Worker 入口
│   └── core/
│       ├── GroupStorageManager.js   # 会话存储管理
│       ├── DomainMatcher.js         # 域名匹配
│       ├── CookieMonitor.js         # Cookie 监控
│       ├── TabSessionBinder.js      # 标签页绑定
│       ├── SessionManager.js        # 会话生命周期
│       └── TabCookieManager.js      # Cookie 操作
├── popup/
│   ├── popup.html             # 弹出窗口
│   ├── popup.js               # 弹出窗口逻辑
│   └── popup.css              # 样式
├── options/
│   ├── options.html           # 设置页面
│   └── options.js             # 设置逻辑
├── lib/
│   └── utils.js               # 工具函数
└── icons/                     # 扩展图标
```

## 🔧 技术实现

### Cookie 隔离机制

```
┌─────────────────────────────────────────────────────────┐
│                    浏览器请求流程                         │
├─────────────────────────────────────────────────────────┤
│  Tab (Session A)                                        │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────┐    Cookie 替换    ┌─────────────────┐     │
│  │ Request │ ───────────────▶ │ Target Server   │     │
│  └─────────┘                   └─────────────────┘     │
│       │                              │                  │
│       │         Set-Cookie 拦截      │                  │
│       ◀─────────────────────────────┘                  │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────┐                                   │
│  │ Session Storage │  ← 存储到对应会话                  │
│  └─────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

### 数据存储结构

```javascript
{
  "sessions": {
    "工作账号": {
      "startUrl": "https://example.com",
      "cookies": {
        "example.com": [...],
        "api.example.com": [...]
      },
      "localStorage": {
        "example.com": { "key": "value" }
      },
      "sessionStorage": {
        "example.com": { "key": "value" }
      },
      "updatedAt": 1716789123456
    }
  }
}
```

### IP 地址支持

支持以下特殊域名：
- IPv4 地址（如 `192.168.1.1`、`127.0.0.1`）
- IPv6 地址（包含 `:` 的地址）
- `localhost`

## 🐛 常见问题

### 扩展无法加载

1. 确保已生成图标 PNG 文件
2. 检查 `manifest.json` 是否有效
3. 查看 `chrome://extensions/` 中的错误信息

### Cookies 未隔离

1. 确认标签页已分配到会话
2. 检查弹出窗口显示的 Cookie 数量
3. 某些网站使用 `localStorage` 可能需要刷新

### 会话数据丢失

1. 检查 `chrome.storage.local` 配额
2. 定期导出会话数据备份
3. 避免清除浏览器数据时删除扩展数据

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE) 许可证。

## 🙏 致谢

- Chrome Extensions API 文档
- 所有贡献者和用户反馈

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/cilangzzz">cilangzzz</a>
</p>
