# GroupStorageManager - Tab Group 级别存储管理器

## 模块概述

`GroupStorageManager` 是插件的核心管理器，实现了基于 Tab Group 的会话隔离机制。每个 Tab Group 对应一个独立的存储空间，包含 Cookies、localStorage、sessionStorage。

**文件位置**: [multi-session-manager/background/core/GroupStorageManager.js](../../../multi-session-manager/background/core/GroupStorageManager.js)

## 核心设计理念

### 存储标识策略

- **用户自定义名称**: 使用用户为 Group 设置的名称作为存储标识，而非自动生成的 ID
- **永久存储**: 即使 Group 关闭，存储数据仍保留，下次打开可恢复
- **名称同步**: Group 重命名时自动迁移存储数据

### 数据结构

```javascript
// 存储结构
storageByName: Map<name, {
  name: string,           // 存储名称
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
```

## 核心功能实现

### 1. 初始化流程

```
initialize()
  ├── loadFromStorage()      // 从 chrome.storage.local 加载数据
  ├── loadSettings()         // 加载用户设置
  ├── setupListeners()       // 注册事件监听器
  ├── restoreManagedGroups() // 验证并恢复已管理的 Group
  └── 获取当前激活 Tab
```

**关键代码**:

```javascript
async initialize() {
  await this.loadFromStorage();
  await this.loadSettings();
  this.setupListeners();
  await this.restoreManagedGroups();

  // 恢复当前激活状态
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // ... 检查是否在管理的 Group 中
}
```

### 2. Tab 激活处理 - 核心 Cookie 切换逻辑

当用户切换 Tab 时，自动切换对应的存储：

```
handleTabActivated(tabId)
  ├── 检查 Tab 是否在管理的 Group 中
  ├── 如果 Group 变化:
  │   ├── 保存上一个 Group 的存储 (autoSaveTabStorage)
  │   ├── 更新激活状态
  │   └── 应用新 Group 的存储 (applyNamedStorage)
  └── 如果 Group 未变化: 仅更新 activeTabId
```

**关键代码**:

```javascript
async handleTabActivated(tabId) {
  // 1. 保存上一个 Group 的存储
  if (previousGroupName && this.activeTabId) {
    await this.autoSaveTabStorage(this.activeTabId, prevTab);
  }

  // 2. 更新激活状态
  this.activeTabId = tabId;
  this.activeGroupName = newGroupName;

  // 3. 切换存储
  if (newGroupName && tab.url) {
    await this.applyNamedStorage(newGroupName, tab);
  }
}
```

### 3. 创建新 Group

```
createGroup(options)
  ├── 检查名称是否已存在
  │   └── 已存在: 激活现有 Group
  ├── 创建新 Tab 和 Group
  ├── 设置 Group 标题和颜色
  ├── 添加到 managedGroups
  ├── 处理存储:
  │   ├── 有历史存储: 应用存储
  │   └── 新 Session: 清空所有存储
  └── 返回创建结果
```

### 4. 应用存储 - 切换会话核心

```
applyNamedStorage(groupName, tab)
  ├── 获取存储数据
  ├── clearAllStorage(): 清空当前所有存储
  │   ├── 清空 Cookies
  │   ├── 清空 localStorage
  │   └── 清空 sessionStorage
  ├── applyCookies(): 应用存储的 Cookies
  ├── applyWebStorage(): 应用 localStorage/sessionStorage
  └── 刷新页面
```

**清空存储实现**:

```javascript
async clearAllStorage(tabId, url) {
  // 1. 清空 Cookies
  const cookies = await this.getAllCookiesForDomain(domain);
  for (const cookie of cookies) {
    await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
  }

  // 2. 清空 WebStorage
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      localStorage.clear();
      sessionStorage.clear();
    }
  });
}
```

### 5. 自动保存机制

```
autoSaveTabStorage(tabId, tab)
  ├── 检查是否有激活的 Group
  ├── 获取当前域名的所有 Cookies
  ├── 获取 localStorage 和 sessionStorage
  └── saveToNamedStore(): 保存到存储
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

### 6. Cookie 变化监听

```
handleCookieChanged(changeInfo)
  ├── 检查是否忽略变化 (ignoreCookieChange 标志)
  ├── 验证 Cookie 属于当前 Tab 的域名
  └── saveCookieToNamedStore(): 更新存储中的 Cookie
```

**忽略自身修改**:

```javascript
// 应用存储时设置忽略标志，避免触发自动保存
this.ignoreCookieChange = true;
try {
  await this.applyCookies(store, targetDomain);
} finally {
  this.ignoreCookieChange = false;
}
```

### 7. Group 重命名处理

```
handleGroupUpdated(group)
  ├── 检查是否是管理的 Group
  ├── 名称变化时:
  │   ├── 迁移存储数据
  │   ├── 更新 managedGroups 映射
  │   └── 更新 activeGroupName
  └── 保存到存储
```

## 事件监听器

| 事件 | 触发时机 | 处理逻辑 |
|------|----------|----------|
| `chrome.tabs.onActivated` | Tab 激活 | 切换存储 |
| `chrome.tabs.onUpdated` | Tab 加载完成 | 自动保存 |
| `chrome.tabGroups.onUpdated` | Group 更新 | 名称同步迁移 |
| `chrome.tabGroups.onRemoved` | Group 删除 | 保留存储，移除管理 |
| `chrome.cookies.onChanged` | Cookie 变化 | 自动保存 |
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
| `getManagedGroupsList()` | 获取管理列表 | `GroupInfo[]` |
| `manualSave()` | 手动保存 | `{ success, cookieCount, ... }` |

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
  ├── 替代 SessionManager (新版本整合)
  └── 被Background入口调用
```

## 配置项

```javascript
settings = {
  autoSwitchEnabled: true,  // 自动切换存储
  autoSaveEnabled: true     // 自动保存存储
}
```
