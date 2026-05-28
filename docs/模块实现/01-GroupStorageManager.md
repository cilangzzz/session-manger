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
isApplyingStorage: boolean   // 应用存储时的锁标志（新增）
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

### 3. Tab 更新处理 - 导航检测

```
onUpdated(changeInfo.status === 'complete')
  ├── 自动保存（autoSaveTabStorage）
  └── 检查并应用域名存储（checkAndApplyDomainStorage）
      └── 导航到新域名时，应用该域名的存储
```

**关键代码**:

```javascript
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // 自动保存
    if (this.settings.autoSaveEnabled) {
      await this.autoSaveTabStorage(tabId, tab);
    }

    // 导航到新域名时，检查并应用该域名的存储
    if (this.activeGroupName && tab.url && !tab.url.startsWith('chrome://')) {
      await this.checkAndApplyDomainStorage(tabId, tab);
    }
  }
});
```

### 4. 创建新 Group

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

### 5. 自动保存机制（增强版）

```
autoSaveTabStorage(tabId, tab)
  ├── 检查 isCreatingGroup（创建时跳过）
  ├── 检查 isApplyingStorage（应用存储时跳过）
  ├── 容错检查：验证 Tab 是否真的属于 activeGroupName
  │   └── 调用 getTabGroupName(tabId) 验证
  │   └── 如果不匹配，更新 activeGroupName 为实际的 Group 名
  ├── 检查 Tab 是否在管理的 Group 中
  │   └── 如果不在，跳过保存
  ├── 获取当前域名的所有 Cookies
  ├── 获取 localStorage 和 sessionStorage
  └── saveToNamedStore(): 保存到存储（传入 tab.url 作为 startUrl）
```

**容错检查机制**:

```javascript
async autoSaveTabStorage(tabId, tab) {
  // 正在创建 Group 时跳过自动保存
  if (this.isCreatingGroup) return;

  // 正在应用存储时跳过（刷新后可能会触发）
  if (this.isApplyingStorage) return;

  // 容错检查：验证 Tab 是否真的属于当前 activeGroupName
  const actualGroupName = await this.getTabGroupName(tabId);
  if (actualGroupName && actualGroupName !== this.activeGroupName) {
    // 更新 activeGroupName 为实际的 Group 名
    this.activeGroupName = actualGroupName;
  }

  // 如果 Tab 不在任何管理的 Group 中，跳过保存
  if (!actualGroupName) return;

  // ... 保存逻辑
}
```

### 6. Cookie 变化处理（增强版）

```
handleCookieChanged(changeInfo)
  ├── 检查 isCreatingGroup（创建时跳过）
  ├── 检查 ignoreCookieChange 标志
  ├── 检查有激活的 Group
  ├── 容错检查：验证当前 Tab 是否属于 activeGroupName
  │   └── 调用 getTabGroupName(activeTabId) 验证
  │   └── 如果不匹配，更新 activeGroupName
  │   └── 如果 Tab 不在任何管理的 Group 中，跳过
  ├── 验证 Cookie 属于当前 Tab 的域名
  └── saveCookieToNamedStore(): 更新存储中的 Cookie
```

### 7. 应用存储 - 切换会话核心（增强版）

```
applyNamedStorage(groupName, tab)
  ├── 获取存储数据
  ├── 设置 isApplyingStorage = true（防止刷新后自动保存）
  ├── clearAllStorage(): 清空当前所有存储
  │   ├── 清空 Cookies
  │   ├── 清空 localStorage
  │   └── 清空 sessionStorage
  ├── applyCookies(): 应用存储的 Cookies
  ├── applyWebStorage(): 应用 localStorage/sessionStorage
  │   ├── 支持旧数据 key 格式兼容
  │   └── 使用 isMatchingDomainKey() 匹配
  ├── 刷新页面
  └── 重置 isApplyingStorage = false
```

**isApplyingStorage 保护机制**:

```javascript
async applyNamedStorage(groupName, tab) {
  this.ignoreCookieChange = true;
  this.isApplyingStorage = true;  // 防止刷新后自动保存

  try {
    await this.clearAllStorage(tab.id, tab.url);
    await this.applyCookies(store, targetDomain);
    await this.applyWebStorage(store, tab.id, targetDomain);
    await chrome.tabs.reload(tab.id);
  } finally {
    this.ignoreCookieChange = false;
    this.isApplyingStorage = false;
  }
}
```

### 8. 获取 Tab 所属的 Group 名称（新增）

```javascript
async getTabGroupName(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return null;

    // 遍历管理的 Group，找到 Tab 属于哪个
    for (const [name, groupId] of this.managedGroups) {
      const tabs = await chrome.tabs.query({ groupId });
      if (tabs.some(t => t.id === tabId)) {
        return name;
      }
    }
  } catch (e) {
    // Tab 可能不存在
  }
  return null;
}
```

### 9. 导入 Session（新增）

```javascript
async importSession(sessionData) {
  if (!sessionData || !sessionData.name) {
    throw new Error('Invalid session data: missing name');
  }

  const name = sessionData.name;

  if (this.storageByName.has(name)) {
    // 已存在，合并数据
    const existingStore = this.storageByName.get(name);

    // 合并 cookies
    if (sessionData.cookies) {
      for (const [domain, cookies] of Object.entries(sessionData.cookies)) {
        existingStore.cookies[domain] = cookies;
      }
    }

    // 合并 localStorage/sessionStorage/domains...
  } else {
    // 不存在，创建新存储
    this.storageByName.set(name, {
      name: name,
      startUrl: sessionData.startUrl || null,
      cookies: sessionData.cookies || {},
      localStorage: sessionData.localStorage || {},
      sessionStorage: sessionData.sessionStorage || {},
      domains: sessionData.domains || [],
      createdAt: sessionData.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  }

  await this.saveToStorageImmediate();
  return { success: true, name };
}
```

### 10. Group 关闭处理 - 保存后移除

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

## 事件监听器

| 事件 | 触发时机 | 处理逻辑 |
|------|----------|----------|
| `chrome.tabs.onActivated` | Tab 激活 | 切换存储（检查 isCreatingGroup） |
| `chrome.tabs.onUpdated` | Tab 加载完成 | 自动保存 + 导航检测 |
| `chrome.tabGroups.onUpdated` | Group 更新 | 名称同步迁移 |
| `chrome.tabGroups.onRemoved` | Group 删除 | 保存存储后移除管理 |
| `chrome.cookies.onChanged` | Cookie 变化 | 自动保存（检查 isCreatingGroup/isApplyingStorage） |
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
| `importSession(sessionData)` | 导入 Session（新增） | `{ success, name }` |
| `getTabGroupName(tabId)` | 获取 Tab 所属 Group（新增） | `string \| null` |

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
  this.isCreatingGroup = true;

  try {
    // ... 创建逻辑
  } finally {
    this.isCreatingGroup = false;
  }
}
```

### isApplyingStorage（新增）

用于防止应用存储后页面刷新触发自动保存：

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

### ignoreCookieChange

用于在应用存储时忽略 Cookie 变化事件：

```javascript
async applyNamedStorage(groupName, tab) {
  this.ignoreCookieChange = true;
  try {
    // ... 应用存储
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
console.log(`[GroupStorageManager] Tab ${tabId} is in group "${actualGroupName}", not "${this.activeGroupName}"`);
console.log(`[GroupStorageManager] Imported session "${name}"`);
```

## 更新历史

| 版本 | 变更 |
|------|------|
| 1.0 | 初始版本，基础存储管理 |
| 1.1 | 新增 startUrl 记忆机制 |
| 1.1 | 新增 isCreatingGroup 保护机制 |
| 1.2 | 新增 isApplyingStorage 保护机制 |
| 1.2 | 新增 getTabGroupName() 容错检查 |
| 1.2 | 新增 importSession() 导入功能 |
| 1.2 | 增强 autoSaveTabStorage() 容错逻辑 |
| 1.2 | 增强 handleCookieChanged() 容错逻辑 |
| 1.2 | 新增导航检测，自动应用域名存储 |
