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
│  - 初始化 GroupStorageManager                                       │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          核心管理层                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │                 GroupStorageManager                         │    │
│  │                 （主管理器）                                  │    │
│  │                                                              │    │
│  │  功能：                                                      │    │
│  │  - Tab Group 级别存储隔离                                     │    │
│  │  - Cookies + localStorage + sessionStorage 管理             │    │
│  │  - startUrl 记忆与恢复                                        │    │
│  │  - 创建/打开/关闭/删除/重命名 Group                           │    │
│  │  - 自动切换与自动保存                                         │    │
│  │                                                              │    │
│  │  状态控制：                                                   │    │
│  │  - isCreatingGroup: 创建锁                                   │    │
│  │  - ignoreCookieChange: Cookie 变化忽略                       │    │
│  │  - saveDebounceTimer: 防抖保存                               │    │
│  └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌────────────────────┐    ┌────────────────────┐                  │
│  │   SessionManager   │    │ TabCookieManager   │                  │
│  │  (早期版本管理器)    │    │ Tab级Cookie隔离    │                  │
│  │  已被整合           │    │ 独立运行           │                  │
│  └────────────────────┘    └────────────────────┘                  │
│                                                                      │
│  ┌────────────────────┐    ┌────────────────────┐                  │
│  │   CookieMonitor    │    │  TabSessionBinder  │                  │
│  │   Cookie自动监控    │    │   Tab绑定管理       │                  │
│  │   可选启用          │    │   可选启用          │                  │
│  └────────────────────┘    └────────────────────┘                  │
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
│  - IP 地址检测（新增）     │  - 存储容量检查                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 模块文档列表

### 核心管理模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 01 | GroupStorageManager | [01-GroupStorageManager.md](01-GroupStorageManager.md) | **主管理器**：Tab Group 级别存储隔离，整合 Cookies + localStorage + sessionStorage，支持 startUrl 记忆 |
| 05 | SessionManager | [05-SessionManager.md](05-SessionManager.md) | 早期版本的 Session 管理器，功能已被 GroupStorageManager 整合 |

### 子功能模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 03 | CookieMonitor | [03-CookieMonitor.md](03-CookieMonitor.md) | Cookie 自动监控与同步（可选启用） |
| 04 | TabSessionBinder | [04-TabSessionBinder.md](04-TabSessionBinder.md) | Tab 与 Session 的双向绑定管理（可选启用） |
| 06 | TabCookieManager | [06-TabCookieManager.md](06-TabCookieManager.md) | Tab 级别的 Cookie 隔离（独立运行） |

### 工具模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 02 | DomainMatcher | [02-DomainMatcher.md](02-DomainMatcher.md) | 域名匹配、规范化、根域名提取、**IP 地址检测**（新增） |

### 用户界面

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 07 | UI Layer | [07-UI-Layer.md](07-UI-Layer.md) | Popup 和 Options 页面实现 |

## 模块依赖关系

```
GroupStorageManager（主管理器）
  ├── DomainMatcher (域名匹配)
  │   └── getRootDomain(), isSameSite(), isIPAddress()
  ├── CookieMonitor (Cookie监控) - 可选，未启用
  └── TabSessionBinder (Tab绑定) - 可选，未启用

SessionManager（早期版本）
  ├── DomainMatcher (域名匹配)
  ├── CookieMonitor (Cookie监控)
  └── TabSessionBinder (Tab绑定)

TabCookieManager（独立模块）
  └── DomainMatcher (域名匹配)

CookieMonitor（可选模块）
  ├── SessionManager (Session操作)
  └── DomainMatcher (域名匹配)

TabSessionBinder（可选模块）
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
    ├── 检查 isCreatingGroup（创建时跳过）
    │
    ├── 检查 autoSwitchEnabled 设置
    │
    ├── 检查 Tab 是否在管理的 Group 中
    │   └── 遍历 managedGroups，查询每个 Group 的 tabs
    │
    ├── 如果 Group 变化：
    │   │
    │   ├── 保存上一个 Group 的存储
    │   │   └── autoSaveTabStorage()
    │   │       ├── 获取 Cookies
    │   │       ├── 获取 WebStorage
    │   │       └── saveToNamedStore()（含 startUrl）
    │   │
    │   ├── 更新激活状态
    │   │   └── activeTabId = tabId
    │   │   └── activeGroupName = newGroupName
    │   │
    │   └── 应用新 Group 的存储
    │       └── applyNamedStorage()
    │           ├── clearAllStorage() - 清空浏览器存储
    │           ├── applyCookies() - 应用存储的 Cookies
    │           ├── applyWebStorage() - 应用 WebStorage（含旧数据兼容）
    │           └── 刷新页面
    │
    └── 如果 Group 未变化：仅更新 activeTabId
```

### Session 创建流程（含 isCreatingGroup 保护）

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
    ├── 设置 isCreatingGroup = true（防止 handleTabActivated 干扰）
    │
    ├── 检查名称是否已存在
    │   └── 已打开：激活现有 Group，应用存储，返回
    │
    ├── 确定 URL（优先级：参数 > startUrl > 默认）
    │
    ├── 保存当前 Group 的存储
    │
    ├── 创建新 Tab
    │   └── chrome.tabs.create({ url, active: true })
    │
    ├── 创建 Tab Group
    │   └── chrome.tabs.group({ tabIds: [tab.id] })
    │
    ├── 设置 Group 属性
    │   └── chrome.tabGroups.update({ title: name, color })
    │
    ├── 处理存储
    │   │
    │   ├── 有历史存储：
    │   │   ├── 等待页面加载（waitForTabLoad，最多 8 秒）
    │   │   ├── 重新获取 tab（页面可能已导航）
    │   │   ├── applyNamedStorage() 应用存储
    │   │   └── 更新 activeGroupName
    │   │
    │   └── 新 Session：
    │   │   ├── 等待页面加载（waitForTabLoad，最多 5 秒）
    │   │   ├── 初始化存储记录（含 startUrl）
    │   │   ├── clearAllStorage() 清空当前存储
    │   │   └── 更新 activeGroupName
    │
    ├── 重置 isCreatingGroup = false
    │
    └── 返回 { groupId, name, tabId, isNew: true }
```

### Group 关闭流程（保存后移除）

```
用户关闭 Tab Group 或关闭最后一个 Tab
    │
    ▼
chrome.tabGroups.onRemoved 触发
    │
    ▼
GroupStorageManager.handleGroupRemoved()
    │
    ├── 找到对应的 Group 名称
    │
    ├── 遍历 Group 中的所有 Tab
    │   │
    │   ├── 检查 URL 是否有效
    │   │
    │   ├── 获取 Cookies（getAllCookiesForDomain）
    │   │
    │   ├── 获取 WebStorage
    │   │   └── executeScript 获取 localStorage/sessionStorage
    │   │
    │   ├── 立即保存到存储
    │   │   └── saveToNamedStore(name, domain, cookies, webStorage, tab.url, true)
    │   │       └── immediate=true，立即写入
    │   │
    │   └── 记录最后一个有效 URL 作为 startUrl
    │
    ├── 更新存储的 startUrl
    │   └── store.startUrl = lastValidUrl
    │
    ├── 从 managedGroups 中移除
    │
    ├── 清理激活状态
    │   └── activeGroupName = null
    │   └── activeTabId = null
    │
    └── 立即保存到 chrome.storage.local
```

## 新增功能与更新

### startUrl 记忆机制

当 Group 关闭时，记录最后访问的 URL。下次打开时自动恢复：

```javascript
// 存储结构
{
  name: 'Session 1',
  startUrl: 'https://mail.google.com/mail/u/0/#inbox',
  cookies: { ... },
  localStorage: { ... },
  sessionStorage: { ... }
}

// 创建时恢复
let url = options.url;
if (!url && this.storageByName.has(name)) {
  url = this.storageByName.get(name).startUrl || 'https://www.google.com';
}
```

### isCreatingGroup 保护机制

防止创建 Group 时 `handleTabActivated` 重复触发切换：

```javascript
async handleTabActivated(tabId) {
  if (this.isCreatingGroup) {
    console.log('Ignoring tab activation during group creation');
    return;
  }
  // ... 正常处理
}
```

### IP 地址处理

DomainMatcher 新增 `isIPAddress()` 方法，正确处理本地开发环境：

```javascript
getRootDomain('127.0.0.1') → '127.0.0.1'
getRootDomain('localhost') → 'localhost'
getRootDomain('::1') → '::1'
```

### 旧数据兼容

GroupStorageManager 支持 WebStorage 的旧数据 key 格式：

```javascript
// 尝试查找可能的旧 key（IP 地址可能被错误地转换为段）
isMatchingDomainKey(key, targetDomain) {
  if (key === targetDomain) return true;
  // 如 127.0.0.1 -> 0.1 的兼容
  const parts = targetDomain.split('.');
  if (key === parts.slice(-2).join('.')) return true;
  return false;
}
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

2. 在 GroupStorageManager 类中实现方法

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
| 1.0.0 | 初始版本，基础 Session 管理 |
| 1.1.0 | 整合 localStorage/sessionStorage 支持 |
| 1.1.0 | 添加 GroupStorageManager 替代 SessionManager |
| 1.2.0 | 新增 startUrl 记忆机制 |
| 1.2.0 | 新增 isCreatingGroup 保护机制 |
| 1.2.0 | 新增 IP 地址检测（DomainMatcher） |
| 1.2.0 | 新增旧数据兼容机制 |