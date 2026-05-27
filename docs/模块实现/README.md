# 模块实现文档索引

本文档索引整理了 Multi-Session Manager 插件的所有模块实现文档。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          用户界面层                                  │
├─────────────────────────────────────────────────────────────────────┤
│  Popup (popup.js)          │  Options (options.js)                  │
│  - Session 列表管理          │  - 统计信息展示                        │
│  - 快速创建/切换             │  - 数据导出/导入                       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Background 入口                            │
├─────────────────────────────────────────────────────────────────────┤
│  index.js - Service Worker 入口                                     │
│  - 消息路由分发                                                      │
│  - 快捷键处理                                                        │
│  - 初始化管理器                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          核心管理层                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────┐    ┌────────────────────┐                  │
│  │ GroupStorageManager │    │   SessionManager   │                  │
│  │ (主管理器 - 新版)    │    │  (早期版本管理器)   │                  │
│  └────────────────────┘    └────────────────────┘                  │
│           │                         │                               │
│           └───────────┬─────────────┘                               │
│                       ▼                                             │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      子模块层                                 │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │                                                               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │   │
│  │  │CookieMonitor │  │TabSessionBinder│ │ TabCookieManager │  │   │
│  │  │ Cookie监控    │  │ Tab绑定管理    │  │ Tab级Cookie隔离  │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │   │
│  │                                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          工具层                                     │
├─────────────────────────────────────────────────────────────────────┤
│  DomainMatcher          │  utils.js                                │
│  - 域名匹配工具           │  - 通用工具函数                          │
│  - 根域名提取             │  - Cookie 工具                          │
└─────────────────────────────────────────────────────────────────────┘
```

## 模块文档列表

### 核心管理模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 01 | GroupStorageManager | [01-GroupStorageManager.md](01-GroupStorageManager.md) | Tab Group 级别存储管理，整合 Cookies + localStorage + sessionStorage |
| 05 | SessionManager | [05-SessionManager.md](05-SessionManager.md) | 早期版本的 Session 管理器，功能已被 GroupStorageManager 整合 |

### 子功能模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 03 | CookieMonitor | [03-CookieMonitor.md](03-CookieMonitor.md) | Cookie 自动监控与同步 |
| 04 | TabSessionBinder | [04-TabSessionBinder.md](04-TabSessionBinder.md) | Tab 与 Session 的双向绑定管理 |
| 06 | TabCookieManager | [06-TabCookieManager.md](06-TabCookieManager.md) | Tab 级别的 Cookie 隔离 |

### 工具模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 02 | DomainMatcher | [02-DomainMatcher.md](02-DomainMatcher.md) | 域名匹配、规范化、根域名提取 |

### 用户界面

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 07 | UI Layer | [07-UI-Layer.md](07-UI-Layer.md) | Popup 和 Options 页面实现 |

## 模块依赖关系

```
GroupStorageManager
  ├── DomainMatcher (域名匹配)
  ├── CookieMonitor (Cookie监控) - 可选
  └── TabSessionBinder (Tab绑定) - 可选

SessionManager
  ├── DomainMatcher (域名匹配)
  ├── CookieMonitor (Cookie监控)
  └── TabSessionBinder (Tab绑定)

TabCookieManager
  └── DomainMatcher (域名匹配)

CookieMonitor
  ├── SessionManager (Session操作)
  └── DomainMatcher (域名匹配)

TabSessionBinder
  └── SessionManager (Session查询)
```

## 核心数据流

### Tab 切换时的 Cookie 切换流程

```
用户切换 Tab
    │
    ▼
chrome.tabs.onActivated 触发
    │
    ▼
GroupStorageManager.handleTabActivated()
    │
    ├── 保存当前 Tab 的存储
    │   └── autoSaveTabStorage()
    │
    ├── 更新 activeTabId / activeGroupName
    │
    └── 应用新 Tab 的存储
        │
        ├── clearAllStorage() - 清空浏览器存储
        │   ├── 清空 Cookies
        │   ├── 清空 localStorage
        │   └── 清空 sessionStorage
        │
        ├── applyCookies() - 应用存储的 Cookies
        │
        ├── applyWebStorage() - 应用存储的 WebStorage
        │
        └── 刷新页面
```

### Session 创建流程

```
用户点击"新建 Session"
    │
    ▼
Popup.confirmCreate()
    │
    ▼
sendMessage('createGroup', { name, url, color })
    │
    ▼
GroupStorageManager.createGroup()
    │
    ├── 检查名称是否已存在
    │
    ├── 创建新 Tab
    │   └── chrome.tabs.create()
    │
    ├── 创建 Tab Group
    │   └── chrome.tabs.group()
    │
    ├── 设置 Group 属性
    │   └── chrome.tabGroups.update()
    │
    ├── 添加到 managedGroups
    │
    ├── 处理存储
    │   ├── 有历史存储: applyNamedStorage()
    │   └── 新 Session: clearAllStorage()
    │
    └── 返回结果
```

## 技术栈

- **Manifest Version**: 3
- **Service Worker**: ES Modules
- **Storage**: chrome.storage.local
- **Cookie API**: chrome.cookies
- **Tab API**: chrome.tabs, chrome.tabGroups
- **Scripting**: chrome.scripting (WebStorage 操作)

## 开发指南

### 添加新的消息处理

1. 在 `background/index.js` 的 `handleRequest` 函数中添加新的 handler：

```javascript
const handlers = {
  // ...
  'newAction': (data) => manager.newMethod(data),
};
```

2. 在对应的 Manager 类中实现方法

3. 在 UI 层调用：

```javascript
const response = await sendMessage('newAction', { param: value });
```

### 添加新的存储字段

1. 更新数据结构定义

2. 在 `loadFromStorage()` 中添加字段加载

3. 在 `saveToStorage()` 中添加字段保存

4. 更新文档说明

## 版本历史

| 版本 | 变更 |
|------|------|
| 1.0.0 | 初始版本，实现基础 Session 管理 |
| - | 整合 localStorage/sessionStorage 支持 |
| - | 添加 GroupStorageManager 替代 SessionManager |
