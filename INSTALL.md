# Multi-Session Manager v1.0.0 - 安装说明

## 文件清单

```
multi-session-manager-v1.0.0.zip (28 KB)
├── manifest.json           # 扩展配置
├── README.md               # 使用说明
├── background/
│   ├── index.js            # Service Worker 入口
│   ├── core/
│   │   ├── TabSessionManager.js
│   │   ├── SessionStorageManager.js
│   │   └── CookieInjector.js
│   └── handlers/
│       ├── TabLifecycleHandler.js
│       └── ContextMenuHandler.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   └── options.js
├── lib/
│   └── utils.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 安装步骤

### 方法一：开发者模式（推荐用于测试）

1. 解压 `multi-session-manager-v1.0.0.zip` 到任意目录
2. 打开 Chrome/Edge 浏览器
3. 地址栏输入 `chrome://extensions/` 并回车
4. 开启右上角的 **"开发者模式"** 开关
5. 点击 **"加载已解压的扩展程序"** 按钮
6. 选择解压后的文件夹
7. 扩展图标会出现在浏览器工具栏

### 方法二：拖放安装

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 直接将 zip 文件拖放到扩展页面

### 方法三：企业部署

通过 Windows 组策略部署：
1. 将扩展文件放到网络共享或本地目录
2. 配置 ExtensionInstallForcelist 策略
3. 扩展将自动安装并具有完整权限

## 使用方法

### 基本操作

1. **创建 Session**
   - 点击扩展图标打开 Popup
   - 点击 "+ New" 按钮创建新 Session
   - 输入 Session 名称，选择颜色

2. **分配标签页**
   - 在 Popup 中选择一个 Session
   - 点击 "Assign Current Tab" 按钮
   - 当前标签页会刷新并使用该 Session

3. **同时多开账号**
   - 打开网站（如 gmail.com）
   - 创建两个不同的 Session
   - 在两个标签页中分别分配不同 Session
   - 分别登录不同账号

### 快捷键

- `Ctrl+Shift+S` - 创建新 Session
- `Ctrl+Shift+M` - 切换到下一个 Session

### 右键菜单

在任意页面右键可以看到：
- Create New Session
- Assign to Session
- Open New Tab in [Session]

## 功能说明

### Session 隔离原理

```
┌─────────────────────────────────────────┐
│  Tab 1 (Session: Work)                  │
│  Request → Intercept → Inject Cookie W  │
│  Response → Capture → Store to Session W│
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  Tab 2 (Session: Personal)              │
│  Request → Intercept → Inject Cookie P  │
│  Response → Capture → Store to Session P│
└─────────────────────────────────────────┘
```

每个 Session 维护独立的 Cookie 存储，通过请求拦截实现隔离。

### 数据存储

- 所有数据存储在 `chrome.storage.local`
- 数据仅保存在本地，不会上传到服务器
- 建议定期导出备份（设置页面）

## 故障排除

### 扩展无法加载

- 检查 manifest.json 是否存在
- 确认图标文件存在（icon16.png, icon48.png, icon128.png）
- 查看扩展页面的错误信息

### Cookie 不隔离

- 确认标签页已分配到非 Default Session
- 刷新页面后检查
- 某些网站使用 localStorage，可能需要额外处理

### Session 丢失

- 检查 `chrome://settings/content/cookies` 确认未清除扩展数据
- 使用设置页面的导出功能定期备份

## 技术支持

如遇问题，请提供：
1. Chrome/Edge 版本
2. 扩展错误信息（扩展页面 → 错误按钮）
3. Service Worker 日志（扩展页面 → Service worker 链接）

---

版本: 1.0.0
构建时间: 2026-05-27
