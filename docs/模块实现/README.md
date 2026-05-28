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
│  │  - 创建/打开/关闭/删除/重命名/导入 Group                      │    │
│  │  - 自动切换与自动保存                                         │    │
│  │  - 导航检测，自动应用域名存储                                  │    │
│  │                                                              │    │
│  │  状态控制：                                                   │    │
│  │  - isCreatingGroup: 创建锁                                   │    │
│  │  - isApplyingStorage: 应用存储锁（新增）                      │    │
│  │  - ignoreCookieChange: Cookie 变化忽略                       │    │
│  │  - saveDebounceTimer: 防抖保存                               │    │
│  │                                                              │    │
│  │  容错机制：                                                   │    │
│  │  - getTabGroupName(): 验证 Tab 所属 Group                    │    │
│  │  - 自动修正 activeGroupName                                   │    │
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
│  - IP 地址检测            │  - 存储容量检查                         │
└─────────────────────────────────────────────────────────────────────┘
```

## 模块文档列表

### 核心管理模块

| 序号 | 模块 | 文档 | 功能描述 |
|------|------|------|----------|
| 01 | GroupStorageManager | [01-GroupStorageManager.md](01-GroupStorageManager.md) | **主管理器**：Tab Group 级别存储隔离，整合 Cookies + localStorage + sessionStorage，支持 startUrl 记忆、导入 Session、容错检查 |
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
| 02 | DomainMatcher | [02-DomainMatcher.md](02-DomainMatcher.md) | 域名匹配、规范化、根域名提取、IP 地址检测 |

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
    │   │       ├── 检查 isCreatingGroup / isApplyingStorage
    │   │       ├── 容错检查：getTabGroupName()
    │   │       ├── 获取 Cookies / WebStorage
    │   │       └── saveToNamedStore()
    │   │
    │   ├── 更新激活状态
    │   │
    │   └── 应用新 Group 的存储
    │       └── applyNamedStorage()
    │           ├── 设置 isApplyingStorage = true
    │           ├── clearAllStorage()
    │           ├── applyCookies()
    │           ├── applyWebStorage()
    │           ├── 刷新页面
    │           └── 重置 isApplyingStorage = false
    │
    └── 如果 Group 未变化：仅更新 activeTabId
```

### Tab 更新处理（导航检测）

```
Tab 加载完成（status === 'complete'）
    │
    ├── 自动保存（autoSaveEnabled）
    │   └── autoSaveTabStorage()
    │       ├── 检查 isCreatingGroup / isApplyingStorage
    │       ├── 容错检查：getTabGroupName()
    │       ├── 获取存储数据
    │       └── saveToNamedStore()
    │
    └── 导航检测（activeGroupName 存在）
        └── checkAndApplyDomainStorage()
            └── 导航到新域名时，应用该域名的存储
```

### 自动保存容错机制

```
autoSaveTabStorage(tabId, tab)
    │
    ├── 检查 isCreatingGroup → 跳过
    │
    ├── 检查 isApplyingStorage → 跳过
    │
    ├── 容错检查：验证 Tab 所属 Group
    │   │
    │   ├── getTabGroupName(tabId)
    │   │   └── 遍历 managedGroups 找到 Tab 属于哪个 Group
    │   │
    │   ├── actualGroupName !== activeGroupName
    │   │   └── 更新 activeGroupName = actualGroupName
    │   │
    │   └── actualGroupName === null
    │       └── 跳过保存（Tab 不在任何管理的 Group 中）
    │
    └── 执行保存逻辑
```

### Session 创建流程（含双重保护机制）

```
用户点击"新建 Session"
    │
    ▼
GroupStorageManager.createGroup()
    │
    ├── 设置 isCreatingGroup = true
    │
    ├── 检查名称是否已存在
    │   └── 已打开：激活现有 Group，返回
    │
    ├── 确定 URL（参数 > startUrl > 默认）
    │
    ├── 创建新 Tab 和 Group
    │
    ├── 处理存储
    │   │
    │   ├── 有历史存储：
    │   │   ├── waitForTabLoad(8000ms)
    │   │   ├── applyNamedStorage()
    │   │   │   └── 设置 isApplyingStorage = true
    │   │   └── 更新 activeGroupName
    │   │
    │   └── 新 Session：
    │   │   ├── 初始化存储记录（含 startUrl）
    │   │   ├── clearAllStorage()
    │   │   └── 更新 activeGroupName
    │
    ├── 重置 isCreatingGroup = false
    │
    └── 返回 { groupId, name, tabId, isNew: true }
```

### Session 导入流程（新增）

```
importSession(sessionData)
    │
    ├── 验证 sessionData.name
    │
    ├── 检查是否已存在
    │   │
    │   ├── 已存在：合并数据
    │   │   ├── 合并 cookies（按域名）
    │   │   ├── 合并 localStorage
    │   │   ├── 合并 sessionStorage
    │   │   ├── 合并 domains
    │   │   └── 更新 startUrl（如果没有）
    │   │
    │   └── 不存在：创建新存储
    │       └── 完整复制 sessionData
    │
    └── saveToStorageImmediate()
```

## 新增功能与更新

### isApplyingStorage 保护机制（新增）

防止应用存储后页面刷新触发自动保存：

```javascript
async applyNamedStorage(groupName, tab) {
  this.isApplyingStorage = true;
  try {
    await this.clearAllStorage(tab.id, tab.url);
    // ... 应用存储
    await chrome.tabs.reload(tab.id);
  } finally {
    this.isApplyingStorage = false;
  }
}
```

### getTabGroupName 容错检查（新增）

验证 Tab 真正所属的 Group，防止 activeGroupName 不同步：

```javascript
async getTabGroupName(tabId) {
  const tab = await chrome.tabs.get(tabId);
  for (const [name, groupId] of this.managedGroups) {
    const tabs = await chrome.tabs.query({ groupId });
    if (tabs.some(t => t.id === tabId)) {
      return name;
    }
  }
  return null;
}
```

### 导入 Session 功能（新增）

支持从外部导入 Session 数据：

```javascript
const result = await manager.importSession({
  name: 'Imported Session',
  startUrl: 'https://example.com',
  cookies: { 'example.com': [...] },
  localStorage: { 'example.com': { key: 'value' } },
  sessionStorage: {},
  domains: ['example.com']
});
```

### 导航检测（新增）

Tab 导航到新域名时，检查并应用该域名的存储：

```javascript
if (this.activeGroupName && tab.url) {
  await this.checkAndApplyDomainStorage(tabId, tab);
}
```

## 技术栈

- **Manifest Version**: 3
- **Service Worker**: ES Modules
- **Storage**: chrome.storage.local
- **Cookie API**: chrome.cookies
- **Tab API**: chrome.tabs, chrome.tabGroups
- **Scripting**: chrome.scripting (WebStorage 操作)

## 版本历史

| 版本 | 变更 |
|------|------|
| 1.0.0 | 初始版本，基础 Session 管理 |
| 1.1.0 | 整合 localStorage/sessionStorage 支持 |
| 1.1.0 | 添加 GroupStorageManager 替代 SessionManager |
| 1.2.0 | 新增 startUrl 记忆机制 |
| 1.2.0 | 新增 isCreatingGroup 保护机制 |
| 1.2.0 | 新增 IP 地址检测（DomainMatcher） |
| 1.3.0 | **新增 isApplyingStorage 保护机制** |
| 1.3.0 | **新增 getTabGroupName() 容错检查** |
| 1.3.0 | **新增 importSession() 导入功能** |
| 1.3.0 | **增强自动保存容错逻辑** |
| 1.3.0 | **新增导航检测，自动应用域名存储** |