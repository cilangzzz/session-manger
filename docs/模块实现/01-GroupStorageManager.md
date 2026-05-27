# GroupStorageManager - Tab Group 级别存储管理器

## 模块概述

`GroupStorageManager` 是插件的核心管理器，实现了基于 Tab Group 的会话隔离机制。每个 Tab Group 对应一个独立的存储空间，包含 Cookies、localStorage、sessionStorage。

**文件位置**: [multi-session-manager/background/core/GroupStorageManager.js](../../../multi-session-manager/background/core/GroupStorageManager.js)

## 核心设计理念

### 存储标识策略

- **用户自定义名称**: 使用用户为 Group 设置的名称作为存储标识，而非自动生成的 ID
- **永久存储**: 即使 Group 关闭，存储数据仍保留，下次打开可恢复
- **名称同步**: Group 重命名时自动迁移存储数据
- **startUrl 记忆**: 记住最后访问的 URL，下次打开时恢复

### 数据结构

```javascript
// 存储结构
storageByName: Map<name, {
  name: string,           // 存储名称
  startUrl: string,       // 起始 URL（最后访问的页面）
  cookies: {              // 按根域名分组的 Cookies
    [rootDomain]: Cookie[]
  },
  localStorage: {         // 按根域名分组的 localStorage
    [rootDomain]: object
  },
  sessionStorage: {       // 按根域名分组的 sessionStorage
    [rootDomain]: object
  },
  domains: string[],      // 关联域名列表
  createdAt: number,
  updatedAt: number
}>

// Group 管理
managedGroups: Map<name, groupId>

// 状态控制
activeGroupName: string      // 当前激活的 Group 名称
activeTabId: number          // 当前激活的 Tab ID
isCreatingGroup: boolean     // 创建 Group 时的锁标志
ignoreCookieChange: boolean  // 忽略 Cookie 变化标志
```

## 核心功能实现

### 1. 初始化流程

```
initialize()
  ├── loadFromStorage()      // 从 chrome.storage.local 加载数据
  ├── loadSettings()         // 加载用户设置
  ├── setupListeners()       // 注册事件监听器
  ├── restoreManagedGroups() // 验证并恢复已管理的 Group
  └── 获取当前激活 Tab，检查是否在管理的 Group 中
```

**关键代码**:

```javascript
async initialize() {
  await this.loadFromStorage();
  await this.loadSettings();
  this.setupListeners();
  await this.restoreManagedGroups();

  // 获取当前激活的 Tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    this.activeTabId = activeTab.id;
    // 检查是否在管理的 Group 中
    for (const [name, groupId] of this.managedGroups) {
      const tabs = await chrome.tabs.query({ groupId });
      if (tabs.some(t => t.id === activeTab.id)) {
        this.activeGroupName = name;
        break;
      }
    }
  }
}
```

### 2. Tab 激活处理 - 核心 Cookie 切换逻辑

当用户切换 Tab 时，自动切换对应的存储：

```
handleTabActivated(tabId)
  ├── 检查 isCreatingGroup 标志（创建时跳过）
  ├── 检查 autoSwitchEnabled 设置
  ├── 检查 Tab 是否在管理的 Group 中
  ├── 如果 Group 变化:
  │   ├── 保存上一个 Group 的存储 (autoSaveTabStorage)
  │   ├── 更新激活状态
  │   └── 应用新 Group 的存储 (applyNamedStorage)
  └── 如果 Group 未变化: 仅更新 activeTabId
```

**创建 Group 时的保护机制**:

```javascript
async handleTabActivated(tabId) {
  // 正在创建 Group 时跳过，防止重复触发切换
  if (this.isCreatingGroup) {
    console.log(`[GroupStorageManager] Ignoring tab activation during group creation`);
    return;
  }
  // ... 其他处理
}
```

### 3. 创建新 Group

```
createGroup(options)
  ├── 设置 isCreatingGroup = true（防止 handleTabActivated 干扰）
  ├── 检查名称是否已存在
  │   └── 已存在: 激活现有 Group，应用存储
  ├── 确定 URL（优先级：参数 > startUrl > 默认）
  ├── 保存当前 Group 的存储
  ├── 创建新 Tab 和 Group
  ├── 设置 Group 标题和颜色
  ├── 处理存储:
  │   ├── 有历史存储: 等待加载 → 应用存储 → 更新 activeGroupName
  │   └── 新 Session: 初始化存储 → 清空当前存储 → 更新 activeGroupName
  ├── 重置 isCreatingGroup = false
  └── 返回创建结果
```

**startUrl 恢复机制**:

```javascript
// 获取 URL：优先使用传入的 URL，否则使用历史存储的 startUrl
let url = options.url;
if (!url && this.storageByName.has(name)) {
  const store = this.storageByName.get(name);
  url = store.startUrl || 'https://www.google.com';
}
```

### 4. Group 关闭处理 - 保存后移除

```
handleGroupRemoved(group)
  ├── 找到对应的 Group 名称
  ├── 遍历 Group 中的所有 Tab
  │   ├── 获取 Cookies 和 WebStorage
  │   ├── 立即保存到存储（immediate=true）
  │   └── 记录最后一个有效 URL 作为 startUrl
  ├── 更新存储的 startUrl
  ├── 从 managedGroups 中移除
  └── 清理激活状态
```

**关键代码**:

```javascript
async handleGroupRemoved(group) {
  // 关闭前，保存当前 Group 的所有 Tab 存储
  for (const tab of tabs) {
    if (tab.url && !tab.url.startsWith('chrome://')) {
      // 立即保存，传入 tab.url 作为 startUrl
      await this.saveToNamedStore(closedName, domain, cookies, webStorage, tab.url, true);
    }
  }
  // 更新 startUrl 到存储
  if (lastValidUrl && this.storageByName.has(closedName)) {
    const store = this.storageByName.get(closedName);
    store.startUrl = lastValidUrl;
  }
}
```

### 5. 应用存储 - 切换会话核心

```
applyNamedStorage(groupName, tab)
  ├── 获取存储数据
  ├── clearAllStorage(): 清空当前所有存储
  │   ├── 清空 Cookies
  │   ├── 清空 localStorage
  │   └── 清空 sessionStorage
  ├── applyCookies(): 应用存储的 Cookies
  ├── applyWebStorage(): 应用 localStorage/sessionStorage
  │   ├── 支持旧数据 key 格式兼容
  │   └── 使用 isMatchingDomainKey() 匹配
  └── 刷新页面
```

**旧数据兼容机制**:

```javascript
async applyWebStorage(store, tabId, targetDomain) {
  const rootDomain = this.domainMatcher.getRootDomain(targetDomain);
  let ls = store.localStorage[rootDomain] || {};
  let ss = store.sessionStorage[rootDomain] || {};

  // 如果找不到，尝试用旧格式的 key（兼容之前保存的数据）
  if (Object.keys(ls).length === 0 && Object.keys(ss).length === 0) {
    for (const [key, value] of Object.entries(store.localStorage)) {
      if (this.isMatchingDomainKey(key, targetDomain)) {
        ls = value;
        break;
      }
    }
  }
  // ... 应用 WebStorage
}

// 检查存储的 key 是否匹配目标域名（兼容旧数据）
isMatchingDomainKey(key, targetDomain) {
  if (key === targetDomain) return true;
  // IP 地址的段匹配（旧 bug 的兼容）
  const parts = targetDomain.split('.');
  if (parts.length >= 2) {
    if (key === parts.slice(-2).join('.')) return true;
  }
  return false;
}
```

### 6. 自动保存机制

```
autoSaveTabStorage(tabId, tab)
  ├── 检查 isCreatingGroup（创建时跳过）
  ├── 检查是否有激活的 Group
  ├── 检查 URL 是否有效
  ├── 获取当前域名的所有 Cookies
  ├── 获取 localStorage 和 sessionStorage
  └── saveToNamedStore(): 保存到存储（传入 tab.url 作为 startUrl）
```

**WebStorage 获取**:

```javascript
const response = await chrome.scripting.executeScript({
  target: { tabId },
  func: () => ({
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage }
  })
});
```

### 7. 保存到指定名称存储

```javascript
async saveToNamedStore(groupName, domain, cookies, webStorage, startUrl = null, immediate = false) {
  // 初始化存储（如果不存在）
  if (!this.storageByName.has(groupName)) {
    this.storageByName.set(groupName, {
      name: groupName,
      startUrl: startUrl || `https://${domain}`,
      cookies: {},
      localStorage: {},
      sessionStorage: {},
      domains: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  const store = this.storageByName.get(groupName);

  // 更新 startUrl（如果提供了）
  if (startUrl) {
    store.startUrl = startUrl;
  }

  // 保存数据...
  store.updatedAt = Date.now();

  // 根据参数选择立即保存或防抖保存
  if (immediate) {
    await this.saveToStorageImmediate();
  } else {
    this.saveToStorage();
  }
}
```

### 8. Cookie 变化监听

```
handleCookieChanged(changeInfo)
  ├── 检查 isCreatingGroup（创建时跳过）
  ├── 检查 ignoreCookieChange 标志
  ├── 验证有激活的 Group
  ├── 验证 Cookie 属于当前 Tab 的域名
  └── saveCookieToNamedStore(): 更新存储中的 Cookie
```

### 9. Group 重命名处理

```
handleGroupUpdated(group)
  ├── 检查是否是管理的 Group
  ├── 名称变化时:
  │   ├── 更新 Group 标题
  │   ├── 迁移存储数据
  │   ├── 更新 managedGroups 映射
  │   ├── 更新 activeGroupName
  │   └── 立即保存到存储
  └── 打印日志
```

## 事件监听器

| 事件 | 触发时机 | 处理逻辑 |
|------|----------|----------|
| `chrome.tabs.onActivated` | Tab 激活 | 切换存储（检查 isCreatingGroup） |
| `chrome.tabs.onUpdated` | Tab 加载完成 | 自动保存 |
| `chrome.tabGroups.onUpdated` | Group 更新 | 名称同步迁移 |
| `chrome.tabGroups.onRemoved` | Group 删除 | 保存存储后移除管理 |
| `chrome.cookies.onChanged` | Cookie 变化 | 自动保存（检查 isCreatingGroup） |
| `chrome.windows.onFocusChanged` | 窗口切换 | Tab 激活处理 |

## 存储 API

### 主要方法

| 方法 | 功能 | 返回值 |
|------|------|--------|
| `createGroup(options)` | 创建新 Group | `{ groupId, name, tabId, isNew }` |
| `openGroup(name)` | 打开 Group | `{ opened, tabId }` |
| `closeGroup(name)` | 关闭 Group | `boolean` |
| `deleteGroupAndStorage(name)` | 删除 Group 及存储 | `boolean` |
| `renameGroup(oldName, newName)` | 重命名 | `boolean` |
| `getAllStores()` | 获取所有存储 | `Store[]` |
| `getManagedGroupsList()` | 获取管理列表 | `GroupInfo[]`（含 startUrl） |
| `manualSave()` | 手动保存 | `{ success, cookieCount, lsCount, ssCount }` |

### 查询方法

```javascript
// 获取当前状态
getCurrentState() {
  return {
    activeGroupName: this.activeGroupName,
    activeTabId: this.activeTabId,
    settings: this.settings,
    managedGroupsCount: this.managedGroups.size
  };
}

// 获取统计信息
getStats() {
  return {
    storeCount: this.storageByName.size,
    openGroupCount: this.managedGroups.size,
    totalCookies: number,
    activeGroupName: string,
    settings: object
  };
}
```

## 状态控制标志

### isCreatingGroup

用于防止创建 Group 时 `handleTabActivated` 重复触发：

```javascript
async createGroup(options) {
  // 设置创建标志
  this.isCreatingGroup = true;

  try {
    // ... 创建逻辑
  } finally {
    // 重置标志
    this.isCreatingGroup = false;
  }
}
```

### ignoreCookieChange

用于在应用存储时忽略 Cookie 变化事件：

```javascript
async applyNamedStorage(groupName, tab) {
  this.ignoreCookieChange = true;
  try {
    await this.clearAllStorage(tab.id, tab.url);
    await this.applyCookies(store, targetDomain);
    await this.applyWebStorage(store, tab.id, targetDomain);
    await chrome.tabs.reload(tab.id);
  } finally {
    this.ignoreCookieChange = false;
  }
}
```

## 防抖保存

为避免频繁写入存储，使用防抖机制：

```javascript
saveToStorage() {
  if (this.saveDebounceTimer) {
    clearTimeout(this.saveDebounceTimer);
  }

  this.saveDebounceTimer = setTimeout(async () => {
    await this.saveToStorageImmediate();
    this.saveDebounceTimer = null;
  }, 500);
}
```

## 与其他模块的关系

```
GroupStorageManager
  ├── 使用 DomainMatcher 进行域名匹配
  │   └── getRootDomain(), isSameSite()
  ├── 替代 SessionManager (新版本整合)
  └── 被 Background 入口调用
```

## 配置项

```javascript
settings = {
  autoSwitchEnabled: true,  // 自动切换存储
  autoSaveEnabled: true     // 自动保存存储
}
```

## 日志输出

模块在关键操作时会输出详细日志，便于调试：

```javascript
console.log(`[GroupStorageManager] createGroup START for "${name}"`);
console.log(`[GroupStorageManager] Set isCreatingGroup=true for "${name}"`);
console.log(`[GroupStorageManager] Created tab ${tab.id} for "${name}"`);
console.log(`[GroupStorageManager] Applying stored data for "${name}"`);
console.log(`[GroupStorageManager] Saved storage before closing "${closedName}"`);
```
