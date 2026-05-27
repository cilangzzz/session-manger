# TabCookieManager - Tab 级别 Cookie 隔离管理

## 模块概述

`TabCookieManager` 实现了 Tab 级别的 Cookie 隔离，每个 Tab 拥有独立的 Cookie 存储。当用户切换 Tab 时，自动切换对应的 Cookie，实现同一网站多账号同时在线。

**文件位置**: [multi-session-manager/background/core/TabCookieManager.js](../../../multi-session-manager/background/core/TabCookieManager.js)

## 核心设计

### 隔离机制

```
Tab A (账号1) ← 独立 Cookie 存储 A
Tab B (账号2) ← 独立 Cookie 存储 B
Tab C (账号1) ← 共享 Cookie 存储 A
```

### 数据结构

```javascript
// Tab 存储
tabStores: Map<tabId, {
  id: number,           // Tab ID
  domains: {            // 按域名分组的 Cookie 存储
    [domain]: Cookie[]
  },
  label?: string,       // 可选标签（用于识别）
  createdAt: number,
  updatedAt: number
}>

// 当前状态
activeTabId: number              // 当前激活的 Tab
preservedCookies: Map            // 保留的原始 Cookie
ignoreCookieChange: boolean      // 忽略自身修改标志
```

## 核心功能实现

### 1. 初始化

```javascript
async initialize() {
  await this.loadFromStorage();  // 加载存储数据
  this.setupListeners();         // 注册事件监听

  // 获取当前激活的 Tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    this.activeTabId = activeTab.id;
  }
}
```

### 2. Tab 激活处理 - 核心 Cookie 切换

```javascript
async handleTabActivated(newTabId) {
  if (!this.autoSwitchEnabled) return;

  const previousTabId = this.activeTabId;

  // 1. 保存当前 Tab 的 Cookie 状态
  if (previousTabId && previousTabId !== newTabId) {
    await this.saveCurrentTabCookies(previousTabId);
  }

  // 2. 更新激活 Tab
  this.activeTabId = newTabId;

  // 3. 应用新 Tab 的 Cookie
  await this.applyTabCookies(newTabId);
}
```

### 3. 保存 Tab Cookie

```javascript
async saveCurrentTabCookies(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) return;

  const url = new URL(tab.url);
  const domain = url.hostname;

  // 获取该域名相关的所有 Cookie
  const cookies = await this.getAllCookiesForDomain(domain);

  // 初始化或更新存储
  if (!this.tabStores.has(tabId)) {
    this.tabStores.set(tabId, {
      id: tabId,
      domains: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  const store = this.tabStores.get(tabId);
  store.domains[domain] = cookies;
  store.updatedAt = Date.now();

  await this.saveToStorage();
}
```

### 4. 应用 Tab Cookie

```javascript
async applyTabCookies(tabId) {
  const store = this.tabStores.get(tabId);
  if (!store) return { applied: 0, cleared: 0 };

  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  const targetDomain = url.hostname;

  // 设置忽略标志（避免触发自动保存）
  this.ignoreCookieChange = true;

  try {
    // 1. 清除当前浏览器的相关 Cookie
    const currentCookies = await this.getAllCookiesForDomain(targetDomain);
    for (const c of currentCookies) {
      await chrome.cookies.remove({ url: this.buildCookieUrl(c), name: c.name });
    }

    // 2. 应用 Tab 存储的 Cookie
    const rootDomain = this.domainMatcher.getRootDomain(targetDomain);
    let applied = 0;

    for (const [domain, cookies] of Object.entries(store.domains)) {
      if (!this.domainMatcher.isSameSite(domain, targetDomain)) continue;

      for (const cookie of cookies) {
        await chrome.cookies.set({
          url: this.buildCookieUrl(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          // ... 其他属性
        });
        applied++;
      }
    }

    return { applied, cleared: currentCookies.length };
  } finally {
    this.ignoreCookieChange = false;
  }
}
```

### 5. Cookie 变化处理

```javascript
async handleCookieChanged(changeInfo) {
  // 忽略自身修改
  if (this.ignoreCookieChange) return;
  if (!this.autoSwitchEnabled) return;
  if (!this.activeTabId) return;

  const { cookie, removed } = changeInfo;
  const tab = await chrome.tabs.get(this.activeTabId);

  if (!tab || !tab.url) return;

  // 检查 Cookie 是否属于当前 Tab 的域名
  const url = new URL(tab.url);
  if (!this.domainMatcher.isSameSite(cookie.domain, url.hostname)) {
    return;
  }

  // 保存到当前 Tab 的存储
  await this.saveCookieToTab(this.activeTabId, cookie, removed);
}
```

### 6. 单个 Cookie 保存

```javascript
async saveCookieToTab(tabId, cookie, removed) {
  const domain = this.domainMatcher.normalize(cookie.domain);

  if (!this.tabStores.has(tabId)) {
    this.tabStores.set(tabId, {
      id: tabId,
      domains: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  const store = this.tabStores.get(tabId);

  if (!store.domains[domain]) {
    store.domains[domain] = [];
  }

  if (removed) {
    // 移除 Cookie
    store.domains[domain] = store.domains[domain].filter(
      c => !(c.name === cookie.name && c.domain === cookie.domain)
    );
  } else {
    // 更新或添加 Cookie
    const index = store.domains[domain].findIndex(
      c => c.name === cookie.name && c.domain === cookie.domain
    );

    if (index >= 0) {
      store.domains[domain][index] = { /* cookie data */ };
    } else {
      store.domains[domain].push({ /* cookie data */ });
    }
  }

  store.updatedAt = Date.now();
  await this.saveToStorage();
}
```

### 7. 获取域名相关 Cookies

```javascript
async getAllCookiesForDomain(domain) {
  const cookies = [];
  const seen = new Set();

  // 获取精确域名和通配域名的 Cookie
  const domains = [
    domain,
    `.${domain}`,
    this.domainMatcher.getRootDomain(domain),
    `.${this.domainMatcher.getRootDomain(domain)}`
  ];

  for (const d of domains) {
    const domainCookies = await chrome.cookies.getAll({ domain: d });
    for (const c of domainCookies) {
      const key = `${c.name}@${c.domain}`;
      if (!seen.has(key)) {
        seen.add(key);
        cookies.push(c);
      }
    }
  }

  return cookies;
}
```

## 事件流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tab 切换事件流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户切换 Tab                                                   │
│       │                                                         │
│       ▼                                                         │
│  chrome.tabs.onActivated 触发                                   │
│       │                                                         │
│       ▼                                                         │
│  handleTabActivated(newTabId)                                   │
│       │                                                         │
│       ├── 1. saveCurrentTabCookies(previousTabId)              │
│       │      └── 保存当前 Tab 的 Cookie 到存储                   │
│       │                                                         │
│       ├── 2. this.activeTabId = newTabId                       │
│       │                                                         │
│       └── 3. applyTabCookies(newTabId)                         │
│              ├── 清除浏览器 Cookie                              │
│              └── 应用 Tab 存储 Cookie                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Cookie 变化事件流                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Cookie 变化 (登录/登出)                                         │
│       │                                                         │
│       ▼                                                         │
│  chrome.cookies.onChanged 触发                                  │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────┐                                        │
│  │ ignoreCookieChange? │                                        │
│  └─────────────────────┘                                        │
│       │                                                         │
│    是 │   否                                                    │
│       │    │                                                    │
│       ▼    ▼                                                    │
│    结束   检查域名匹配                                           │
│              │                                                  │
│              ▼                                                  │
│         saveCookieToTab()                                       │
│              └── 更新 Tab 存储                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 高级功能

### 1. Tab 标签

```javascript
async setTabLabel(tabId, label) {
  const store = this.tabStores.get(tabId);
  if (store) {
    store.label = label;
    store.updatedAt = Date.now();
    await this.saveToStorage();
  }
}
```

### 2. 克隆 Tab 存储

```javascript
async cloneTabStore(fromTabId, toTabId) {
  const sourceStore = this.tabStores.get(fromTabId);
  if (!sourceStore) return false;

  this.tabStores.set(toTabId, {
    ...sourceStore,
    id: toTabId,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  await this.saveToStorage();
  return true;
}
```

### 3. 清除 Tab 存储

```javascript
async clearTabStore(tabId, domain = null) {
  const store = this.tabStores.get(tabId);
  if (!store) return false;

  if (domain) {
    delete store.domains[domain];
  } else {
    store.domains = {};
  }

  store.updatedAt = Date.now();
  await this.saveToStorage();
  return true;
}
```

### 4. 手动保存

```javascript
async manualSave(tabId = null) {
  const targetTabId = tabId || this.activeTabId;
  await this.saveCurrentTabCookies(targetTabId);

  const store = this.tabStores.get(targetTabId);
  const cookieCount = store ? Object.values(store.domains).flat().length : 0;

  return { success: true, cookieCount };
}
```

## 统计与查询

```javascript
getStats() {
  let totalCookies = 0;
  for (const store of this.tabStores.values()) {
    for (const cookies of Object.values(store.domains)) {
      totalCookies += cookies.length;
    }
  }

  return {
    tabCount: this.tabStores.size,
    totalCookies,
    activeTabId: this.activeTabId,
    autoSwitchEnabled: this.autoSwitchEnabled
  };
}

getTabStore(tabId) {
  return this.tabStores.get(tabId);
}

getAllTabStores() {
  return Array.from(this.tabStores.entries()).map(([tabId, store]) => ({
    tabId,
    ...store
  }));
}
```

## 配置项

```javascript
autoSwitchEnabled: true  // 是否启用自动切换
```

```javascript
setAutoSwitch(enabled) {
  this.autoSwitchEnabled = enabled;
}
```

## 与其他模块的关系

```
TabCookieManager
  ├── 依赖 DomainMatcher 进行域名匹配
  └── 独立运行（不依赖 SessionManager）
```

## 使用场景

### 场景1: 同一网站多账号

1. Tab A 登录账号1，Cookie 存储到 Tab A 的存储
2. 切换到 Tab B，Cookie 切换为 Tab B 的存储
3. Tab B 登录账号2，Cookie 存储到 Tab B 的存储
4. 在 Tab A 和 Tab B 间切换，自动切换账号状态

### 场景2: 克隆会话

```javascript
// 创建新 Tab 并克隆现有 Tab 的会话
const newTab = await chrome.tabs.create({ url });
await tabCookieManager.cloneTabStore(sourceTabId, newTab.id);
```

## 注意事项

1. **ignoreCookieChange 标志**: 应用 Cookie 时需设置此标志，避免触发自动保存造成循环
2. **Tab 关闭清理**: Tab 关闭后自动清理存储，避免内存泄漏
3. **隐私窗口**: 隐私窗口的 Tab 不受管理
4. **存储容量**: 注意 chrome.storage.local 的容量限制（5MB）

## 与 GroupStorageManager 的区别

| 特性 | TabCookieManager | GroupStorageManager |
|------|------------------|---------------------|
| 隔离粒度 | Tab 级别 | Tab Group 级别 |
| 存储内容 | Cookies | Cookies + localStorage + sessionStorage |
| 适用场景 | 细粒度隔离 | 粗粒度会话管理 |
| 持久性 | Tab 关闭即清除 | Group 关闭后保留 |
