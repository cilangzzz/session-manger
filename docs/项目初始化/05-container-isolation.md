# Container/容器式隔离方案深度分析

本文档深入分析 Firefox Multi-Account Containers 的技术原理，以及如何在 Chrome 上实现类似功能。

## 目录

1. [Firefox Multi-Account Containers 技术原理](#1-firefox-multi-account-containers-技术原理)
2. [contextualIdentities API 实现](#2-contextualidentities-api-实现)
3. [Chrome 容器功能模拟方案](#3-chrome-容器功能模拟方案)
4. [容器存储隔离实现](#4-容器存储隔离实现)
5. [容器视觉标识实现](#5-容器视觉标识实现)
6. [容器与标签页绑定机制](#6-容器与标签页绑定机制)
7. [容器 Cookie 隔离实现](#7-容器-cookie-隔离实现)
8. [容器间数据隔离最佳实践](#8-容器间数据隔离最佳实践)
9. [Mozilla multi-account-containers 架构分析](#9-mozilla-multi-account-containers-架构分析)
10. [移植到 Chrome 的可行方案](#10-移植到-chrome-的可行方案)

---

## 1. Firefox Multi-Account Containers 技术原理

### 1.1 核心概念

Firefox Containers 是一种浏览器级别的隔离机制，允许用户将浏览活动分离到不同的"容器"中。每个容器拥有独立的：

- **Cookie 存储**：不同容器的 Cookie 完全隔离
- **LocalStorage / SessionStorage**：按容器隔离
- **IndexedDB**：按容器隔离
- **缓存**：HTTP 缓存按容器分区
- **历史记录**：可选择性隔离

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Firefox Browser                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Container 1 │  │ Container 2 │  │ Container 3 │  ...         │
│  │ (Personal)  │  │ (Work)      │  │ (Shopping)  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐              │
│  │ Cookie Jar  │  │ Cookie Jar  │  │ Cookie Jar  │              │
│  │ Storage 1   │  │ Storage 2   │  │ Storage 3   │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Gecko Origin Attributes                   ││
│  │  userContextId = 1, 2, 3, ...                               ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Origin Attributes 机制

Firefox 使用 **Origin Attributes** 系统实现容器隔离。每个浏览器 origin 被扩展为包含额外的属性：

```
传统 Origin: https://example.com
容器 Origin: https://example.com^userContextId=1
```

**核心属性：**
- `userContextId`：容器标识符（1-255）
- `privateBrowsingId`：隐私浏览模式
- `firstPartyDomain`：First-Party Isolation

### 1.4 内部实现（Gecko 层面）

```cpp
// Gecko 源码中的 OriginAttributes 结构
class OriginAttributes {
public:
  uint32_t mUserContextId;
  uint32_t mPrivateBrowsingId;
  nsString mFirstPartyDomain;

  // 创建 origin suffix
  void CreateSuffix(nsACString& aStr) const {
    if (mUserContextId != 0) {
      aStr.AppendPrintf("^userContextId=%u", mUserContextId);
    }
  }
};
```

**关键点：**
1. 每个网络请求都携带 `userContextId`
2. 存储系统根据 `userContextId` 分区
3. Cookie 管理器使用 `userContextId` 隔离 Cookie

---

## 2. contextualIdentities API 实现

### 2.1 API 概述

`contextualIdentities` API 是 Firefox 特有的 WebExtensions API，用于管理容器。

**权限要求：**
```json
{
  "permissions": ["contextualIdentities"]
}
```

### 2.2 API 方法详解

#### 2.2.1 获取容器

```javascript
// 获取所有容器
const containers = await browser.contextualIdentities.query({});

// 返回结构
[
  {
    name: "Personal",
    icon: "fingerprint",
    iconUrl: "resource://usercontext-content/fingerprint.svg",
    color: "blue",
    colorCode: "#37adff",
    cookieStoreId: "firefox-container-1"
  },
  {
    name: "Work",
    icon: "briefcase",
    iconUrl: "resource://usercontext-content/briefcase.svg",
    color: "orange",
    colorCode: "#ffbd4f",
    cookieStoreId: "firefox-container-2"
  }
]
```

#### 2.2.2 创建容器

```javascript
const container = await browser.contextualIdentities.create({
  name: "Shopping",
  color: "green",
  icon: "cart"
});

// 返回创建的容器对象
console.log(container.cookieStoreId); // "firefox-container-3"
```

#### 2.2.3 更新容器

```javascript
const updated = await browser.contextualIdentities.update(
  "firefox-container-1",
  {
    name: "Personal Updated",
    color: "red"
  }
);
```

#### 2.2.4 删除容器

```javascript
const removed = await browser.contextualIdentities.remove(
  "firefox-container-1"
);
```

### 2.3 事件监听

```javascript
// 容器创建事件
browser.contextualIdentities.onCreated.addListener((changeInfo) => {
  console.log("Container created:", changeInfo.contextualIdentity);
});

// 容器更新事件
browser.contextualIdentities.onUpdated.addListener((changeInfo) => {
  console.log("Container updated:", changeInfo.contextualIdentity);
});

// 容器删除事件
browser.contextualIdentities.onRemoved.addListener((changeInfo) => {
  console.log("Container removed:", changeInfo.contextualIdentity);
});
```

### 2.4 cookieStoreId 格式

Firefox 容器的 `cookieStoreId` 格式为：

```
firefox-container-{n}
```

其中 `n` 是 1-255 的数字。

**特殊 cookieStoreId：**
- `firefox-default`：默认容器
- `firefox-private`：隐私浏览模式

### 2.5 与 Tabs API 集成

```javascript
// 在指定容器中创建标签页
const tab = await browser.tabs.create({
  url: "https://example.com",
  cookieStoreId: "firefox-container-1"
});

// 查询特定容器中的标签页
const tabs = await browser.tabs.query({
  cookieStoreId: "firefox-container-1"
});

// 获取当前标签页的容器
const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
console.log("Current container:", currentTab.cookieStoreId);
```

---

## 3. Chrome 容器功能模拟方案

### 3.1 Chrome 的限制

Chrome **没有** `contextualIdentities` API，也没有原生的容器支持。主要限制：

1. **无 cookieStoreId**：Chrome 标签页没有容器标识
2. **无 Cookie 隔离**：所有标签页共享同一 Cookie 存储
3. **无存储隔离**：LocalStorage/IndexedDB 全局共享

### 3.2 模拟方案对比

| 方案 | Cookie 隔离 | 存储隔离 | 复杂度 | 用户体验 |
|------|------------|---------|--------|---------|
| 方案A: 多 Profile | 完全隔离 | 完全隔离 | 低 | 差（需切换窗口） |
| 方案B: Proxy + Header 注入 | 部分 | 无 | 高 | 中 |
| 方案C: Cookie 拦截替换 | 部分 | 部分 | 高 | 中 |
| 方案D: Offscreen Document | 部分 | 部分 | 中 | 中 |
| 方案E: 混合方案 | 较好 | 较好 | 高 | 较好 |

### 3.3 方案A：多 Profile 方案

**原理：** 使用 Chrome 的多用户 Profile 功能实现隔离。

```javascript
// 检测当前 Profile
chrome.identity.getProfileUserInfo((info) => {
  console.log("Current profile:", info);
});

// 创建新 Profile（需要用户手动操作）
// chrome://settings/people
```

**优点：**
- 完全隔离（Cookie、存储、历史）
- 原生支持，稳定可靠

**缺点：**
- 需要切换窗口
- 无法在同一窗口内管理
- 用户体验差

### 3.4 方案B：Proxy + Header 注入

**原理：** 通过代理和请求头注入实现"虚拟隔离"。

```javascript
// manifest.json
{
  "permissions": [
    "proxy",
    "declarativeNetRequest",
    "declarativeNetRequestWithHostAccess"
  ]
}

// background.js - 设置代理
chrome.proxy.settings.set({
  value: {
    mode: "pac_script",
    pacScript: {
      data: `
        function FindProxyForURL(url, host) {
          // 根据标签页 ID 路由到不同代理
          return "PROXY container-proxy.example.com:8080";
        }
      `
    }
  },
  scope: "regular"
});

// 使用 declarativeNetRequest 注入标识头
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{
        header: "X-Container-Id",
        operation: "set",
        value: "${containerId}" // 动态值
      }]
    },
    condition: {
      urlFilter: "*",
      resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"]
    }
  }]
});
```

**服务端配合：**
```
代理服务器根据 X-Container-Id 头
→ 路由到不同的会话池
→ 维护独立的 Cookie 存储
```

**优点：**
- 可实现 Cookie 隔离
- 支持同一窗口多容器

**缺点：**
- 需要外部代理服务
- 本地存储无法隔离
- 复杂度高

### 3.5 方案C：Cookie 拦截替换

**原理：** 拦截网络请求，动态替换 Cookie。

```javascript
// manifest.json
{
  "permissions": [
    "webRequest",
    "webRequestAuthProvider",
    "cookies",
    "storage"
  ],
  "host_permissions": ["<all_urls>"]
}

// background.js
const containerCookies = new Map(); // 容器 Cookie 存储

// 请求前：注入容器 Cookie
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const tabId = details.tabId;
    const containerId = getContainerForTab(tabId);

    if (containerId && containerCookies.has(containerId)) {
      const cookies = containerCookies.get(containerId);
      const domain = new URL(details.url).hostname;

      // 替换为容器 Cookie
      const containerCookie = cookies.get(domain);
      if (containerCookie) {
        // 移除原始 Cookie，注入容器 Cookie
        details.requestHeaders = details.requestHeaders.filter(
          h => h.name.toLowerCase() !== "cookie"
        );
        details.requestHeaders.push({
          name: "Cookie",
          value: containerCookie
        });
      }
    }

    return { requestHeaders: details.requestHeaders };
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

// 响应后：保存容器 Cookie
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabId = details.tabId;
    const containerId = getContainerForTab(tabId);

    const setCookies = details.responseHeaders.filter(
      h => h.name.toLowerCase() === "set-cookie"
    );

    if (containerId && setCookies.length > 0) {
      // 保存到容器 Cookie 存储
      saveContainerCookies(containerId, setCookies);
    }

    // 移除 Set-Cookie，防止写入全局 Cookie
    return {
      responseHeaders: details.responseHeaders.filter(
        h => h.name.toLowerCase() !== "set-cookie"
      )
    };
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);
```

**优点：**
- 纯扩展实现
- Cookie 隔离效果较好

**缺点：**
- 无法处理 HttpOnly Cookie
- JavaScript 设置的 Cookie 难以拦截
- localStorage/sessionStorage 无法隔离

### 3.6 方案D：Offscreen Document（Chrome 109+）

**原理：** 使用 Offscreen Document 创建隔离的执行环境。

```javascript
// manifest.json
{
  "permissions": ["offscreen", "storage", "cookies"],
  "background": {
    "service_worker": "background.js"
  }
}

// background.js
async function createOffscreenDocument(containerId) {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['COOKIES', 'DOM_PARSER'],
      justification: 'Container isolation'
    });
  }

  // 发送消息到 offscreen document
  const response = await chrome.runtime.sendMessage({
    type: 'CONTAINER_REQUEST',
    containerId: containerId,
    url: targetUrl
  });
}

// offscreen.html
<script src="offscreen.js"></script>

// offscreen.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CONTAINER_REQUEST') {
    // 在隔离环境中处理请求
    handleContainerRequest(message.containerId, message.url)
      .then(sendResponse);
    return true;
  }
});
```

**优点：**
- Chrome 原生支持
- 可创建多个隔离环境

**缺点：**
- 仍无法完全隔离 Cookie
- 主要用于后台处理

### 3.7 方案E：混合方案（推荐）

结合多种技术实现最佳效果：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chrome Container Extension                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Tab Management Layer                      ││
│  │  - 标签页分组                                                ││
│  │  - 视觉标识                                                  ││
│  │  - 容器绑定                                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────────────┐│
│  │                    Cookie Isolation Layer                     ││
│  │  - webRequest 拦截                                           ││
│  │  - Cookie 命名空间管理                                       ││
│  │  - 容器 Cookie 存储                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────────────┐│
│  │                    Storage Isolation Layer                    ││
│  │  - chrome.storage 命名空间                                   ││
│  │  - Content Script 注入                                       ││
│  │  - localStorage 拦截                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 容器存储隔离实现

### 4.1 chrome.storage 命名空间管理

```javascript
// 容器存储管理器
class ContainerStorageManager {
  constructor() {
    this.containers = new Map();
    this.init();
  }

  async init() {
    const stored = await chrome.storage.local.get('containers');
    if (stored.containers) {
      this.containers = new Map(Object.entries(stored.containers));
    }
  }

  // 生成容器存储键
  getStorageKey(containerId, key) {
    return `container_${containerId}_${key}`;
  }

  // 容器数据存储
  async set(containerId, key, value) {
    const storageKey = this.getStorageKey(containerId, key);
    await chrome.storage.local.set({ [storageKey]: value });
  }

  // 容器数据读取
  async get(containerId, key) {
    const storageKey = this.getStorageKey(containerId, key);
    const result = await chrome.storage.local.get(storageKey);
    return result[storageKey];
  }

  // 清除容器所有数据
  async clearContainer(containerId) {
    const prefix = `container_${containerId}_`;
    const all = await chrome.storage.local.get(null);

    const keysToRemove = Object.keys(all)
      .filter(key => key.startsWith(prefix));

    await chrome.storage.local.remove(keysToRemove);
  }
}
```

### 4.2 localStorage 拦截方案

通过 Content Script 拦截页面 localStorage 操作：

```javascript
// content-script.js
(function() {
  const containerId = window.__CONTAINER_ID__;
  const prefix = `container_${containerId}_`;

  // 保存原始方法
  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const originalClear = Storage.prototype.clear;
  const originalKey = Storage.prototype.key;

  // 重写 setItem
  Storage.prototype.setItem = function(key, value) {
    const prefixedKey = prefix + key;
    originalSetItem.call(this, prefixedKey, value);
  };

  // 重写 getItem
  Storage.prototype.getItem = function(key) {
    const prefixedKey = prefix + key;
    return originalGetItem.call(this, prefixedKey);
  };

  // 重写 removeItem
  Storage.prototype.removeItem = function(key) {
    const prefixedKey = prefix + key;
    originalRemoveItem.call(this, prefixedKey);
  };

  // 重写 clear（只清除当前容器数据）
  Storage.prototype.clear = function() {
    const keysToRemove = [];
    for (let i = 0; i < this.length; i++) {
      const key = originalKey.call(this, i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => originalRemoveItem.call(this, key));
  };

  // 重写 key
  Storage.prototype.key = function(index) {
    let containerIndex = 0;
    for (let i = 0; i < this.length; i++) {
      const key = originalKey.call(this, i);
      if (key && key.startsWith(prefix)) {
        if (containerIndex === index) {
          return key.substring(prefix.length);
        }
        containerIndex++;
      }
    }
    return null;
  };
})();
```

### 4.3 IndexedDB 隔离方案

```javascript
// IndexedDB 数据库名称前缀
const containerId = window.__CONTAINER_ID__;

// 拦截 indexedDB.open
const originalOpen = indexedDB.open;
indexedDB.open = function(name, version) {
  const prefixedName = `container_${containerId}_${name}`;
  return originalOpen.call(this, prefixedName, version);
};

// 拦截 indexedDB.deleteDatabase
const originalDelete = indexedDB.deleteDatabase;
indexedDB.deleteDatabase = function(name) {
  const prefixedName = `container_${containerId}_${name}`;
  return originalDelete.call(this, prefixedName);
};
```

### 4.4 存储隔离架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Storage Isolation Layer                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   chrome.storage.local                       ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │container_1_ │  │container_2_ │  │container_3_ │          ││
│  │  │  settings   │  │  settings   │  │  settings   │          ││
│  │  │  cookies    │  │  cookies    │  │  cookies    │          ││
│  │  │  data       │  │  data       │  │  data       │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   localStorage (per origin)                  ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │container_1_ │  │container_2_ │  │container_3_ │          ││
│  │  │  prefixed   │  │  prefixed   │  │  prefixed   │          ││
│  │  │  keys       │  │  keys       │  │  keys       │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   IndexedDB (prefixed DB names)              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │container_1_ │  │container_2_ │  │container_3_ │          ││
│  │  │  MyDB       │  │  MyDB       │  │  MyDB       │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. 容器视觉标识实现

### 5.1 Firefox 容器视觉标识

Firefox 容器通过以下方式提供视觉标识：

1. **标签页颜色条**：在标签页顶部显示彩色条纹
2. **容器图标**：在标签页上显示容器图标
3. **地址栏标识**：在地址栏显示容器名称和颜色

### 5.2 Chrome 实现方案

#### 5.2.1 标签页颜色标识

```javascript
// 使用 Tab Groups API（Chrome 85+）
async function createContainerGroup(container) {
  const group = await chrome.tabs.group({
    title: container.name,
    color: container.color
  });

  // 保存分组 ID
  await chrome.storage.local.set({
    [`group_${container.id}`]: group
  });

  return group;
}

// 将标签页添加到容器分组
async function addTabToContainer(tabId, containerId) {
  const groupId = await chrome.storage.local.get(`group_${containerId}`);
  await chrome.tabs.group({
    tabIds: tabId,
    groupId: groupId[`group_${containerId}`]
  });
}
```

#### 5.2.2 页面内视觉标识

通过 Content Script 注入视觉元素：

```javascript
// content-script.js
function injectContainerIndicator(container) {
  // 创建容器指示器
  const indicator = document.createElement('div');
  indicator.id = 'container-indicator';
  indicator.innerHTML = `
    <style>
      #container-indicator {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: 4px;
        background: ${container.color};
        z-index: 2147483647;
        pointer-events: none;
      }
      #container-indicator::after {
        content: '${container.name}';
        position: fixed;
        top: 4px;
        left: 4px;
        background: ${container.color};
        color: white;
        padding: 2px 8px;
        border-radius: 0 0 4px 4px;
        font-size: 12px;
        font-family: system-ui;
        z-index: 2147483647;
        pointer-events: none;
      }
    </style>
  `;
  document.head.appendChild(indicator);
}

// 从 background 获取容器信息
chrome.runtime.sendMessage({ type: 'GET_CONTAINER' }, (response) => {
  if (response.container) {
    injectContainerIndicator(response.container);
  }
});
```

#### 5.2.3 Favicon 修改

```javascript
// 修改 favicon 以显示容器颜色
function modifyFavicon(container) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  // 绘制原始 favicon
  const originalFavicon = document.querySelector('link[rel="icon"]');
  if (originalFavicon) {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 16, 16);

      // 添加容器颜色边框
      ctx.strokeStyle = container.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, 14, 14);

      // 更新 favicon
      const newFavicon = document.createElement('link');
      newFavicon.rel = 'icon';
      newFavicon.href = canvas.toDataURL();
      document.head.appendChild(newFavicon);
    };
    img.src = originalFavicon.href;
  }
}
```

### 5.3 视觉标识架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Visual Identity System                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Browser UI Level                          ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  Tab Groups (Chrome 85+)                                │││
│  │  │  - Group color                                          │││
│  │  │  - Group title                                          │││
│  │  │  - Group collapse                                       │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Page Content Level                        ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  Content Script Injection                               │││
│  │  │  - Top color bar                                        │││
│  │  │  - Container name badge                                 │││
│  │  │  - Modified favicon                                     │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Extension Popup Level                     ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  Popup UI                                               │││
│  │  │  - Container list with colors                           │││
│  │  │  - Current tab container indicator                      │││
│  │  │  - Quick switch buttons                                 │││
│  │  └─────────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 容器与标签页绑定机制

### 6.1 Firefox 绑定机制

Firefox 通过 `cookieStoreId` 属性将标签页与容器绑定：

```javascript
// 标签页对象包含 cookieStoreId
{
  id: 123,
  url: "https://example.com",
  cookieStoreId: "firefox-container-1",  // 容器标识
  // ...其他属性
}
```

### 6.2 Chrome 模拟实现

#### 6.2.1 绑定数据结构

```javascript
// 容器-标签页绑定管理
class TabContainerBinding {
  constructor() {
    this.bindings = new Map(); // tabId -> containerId
    this.init();
  }

  async init() {
    // 从存储加载绑定数据
    const stored = await chrome.storage.local.get('tabBindings');
    if (stored.tabBindings) {
      this.bindings = new Map(Object.entries(stored.tabBindings).map(
        ([k, v]) => [parseInt(k), v]
      ));
    }

    // 监听标签页关闭，清理绑定
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.bindings.delete(tabId);
      this.saveBindings();
    });
  }

  // 绑定标签页到容器
  async bind(tabId, containerId) {
    this.bindings.set(tabId, containerId);
    await this.saveBindings();

    // 更新标签页分组
    await this.updateTabGroup(tabId, containerId);
  }

  // 获取标签页的容器
  getContainer(tabId) {
    return this.bindings.get(tabId);
  }

  // 保存绑定数据
  async saveBindings() {
    const obj = Object.fromEntries(
      Array.from(this.bindings.entries()).map(([k, v]) => [k.toString(), v])
    );
    await chrome.storage.local.set({ tabBindings: obj });
  }
}
```

#### 6.2.2 导航时保持绑定

```javascript
// 监听标签页导航，保持容器绑定
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; // 只处理主框架

  const containerId = tabBinding.getContainer(details.tabId);

  if (containerId) {
    // 注入 Content Script，传递容器信息
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: (containerId) => {
        window.__CONTAINER_ID__ = containerId;
      },
      args: [containerId]
    });
  }
});
```

#### 6.2.3 新标签页继承容器

```javascript
// 监听新标签页创建
chrome.tabs.onCreated.addListener(async (tab) => {
  // 如果是从容器标签页打开的链接，继承容器
  if (tab.openerTabId) {
    const parentContainer = tabBinding.getContainer(tab.openerTabId);
    if (parentContainer) {
      await tabBinding.bind(tab.id, parentContainer);
    }
  }
});
```

### 6.3 绑定机制流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    Tab-Container Binding Flow                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  用户操作                                                        │
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  打开新标签页                                                ││
│  │  - 检查 openerTabId                                         ││
│  │  - 继承父标签页容器                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  绑定到容器                                                  ││
│  │  - 存储绑定关系                                              ││
│  │  - 更新 Tab Group                                           ││
│  │  - 注入容器标识                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  导航到 URL                                                  ││
│  │  - 检查 URL 是否有分配的容器                                 ││
│  │  - 自动切换容器（如果配置）                                  ││
│  │  - 注入 Content Script                                       ││
│  └─────────────────────────────────────────────────────────────┘│
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  应用容器隔离                                                ││
│  │  - Cookie 隔离                                               ││
│  │  - Storage 隔离                                              ││
│  │  - 视觉标识                                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 容器 Cookie 隔离实现

### 7.1 Firefox Cookie 隔离原理

Firefox 在内核层面实现 Cookie 隔离：

```
每个 Cookie 关联 userContextId
Cookie 存储: {name, value, domain, path, userContextId}
查询时: 只返回当前 userContextId 的 Cookie
```

### 7.2 Chrome Cookie 隔离实现

#### 7.2.1 完整 Cookie 管理器

```javascript
// Cookie 隔离管理器
class ContainerCookieManager {
  constructor() {
    this.containerCookies = new Map(); // containerId -> Map<domain, cookies[]>
    this.init();
  }

  async init() {
    // 从存储加载容器 Cookie
    const stored = await chrome.storage.local.get('containerCookies');
    if (stored.containerCookies) {
      for (const [containerId, cookies] of Object.entries(stored.containerCookies)) {
        this.containerCookies.set(containerId, new Map(Object.entries(cookies)));
      }
    }
  }

  // 解析 Set-Cookie 头
  parseSetCookie(setCookieHeader) {
    const parts = setCookieHeader.split(';').map(p => p.trim());
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=');

    const cookie = { name, value };
    for (const attr of attributes) {
      const [key, val] = attr.split('=');
      cookie[key.toLowerCase()] = val || true;
    }

    return cookie;
  }

  // 保存 Cookie 到容器
  async saveCookie(containerId, cookie) {
    if (!this.containerCookies.has(containerId)) {
      this.containerCookies.set(containerId, new Map());
    }

    const containerMap = this.containerCookies.get(containerId);
    const domain = cookie.domain || cookie['domain'];

    if (!containerMap.has(domain)) {
      containerMap.set(domain, []);
    }

    const cookies = containerMap.get(domain);
    // 更新或添加 Cookie
    const existingIndex = cookies.findIndex(c => c.name === cookie.name);
    if (existingIndex >= 0) {
      cookies[existingIndex] = cookie;
    } else {
      cookies.push(cookie);
    }

    await this.saveToStorage();
  }

  // 获取容器的 Cookie 字符串
  getCookieString(containerId, domain) {
    const containerMap = this.containerCookies.get(containerId);
    if (!containerMap) return '';

    const cookies = containerMap.get(domain) || [];
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  // 保存到存储
  async saveToStorage() {
    const obj = {};
    for (const [containerId, map] of this.containerCookies) {
      obj[containerId] = Object.fromEntries(map);
    }
    await chrome.storage.local.set({ containerCookies: obj });
  }

  // 清除容器所有 Cookie
  async clearContainerCookies(containerId) {
    this.containerCookies.delete(containerId);
    await this.saveToStorage();
  }
}
```

#### 7.2.2 请求拦截实现

```javascript
// 请求前注入 Cookie
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const containerId = tabBinding.getContainer(details.tabId);
    if (!containerId) return;

    const url = new URL(details.url);
    const cookieString = cookieManager.getCookieString(containerId, url.hostname);

    if (cookieString) {
      // 移除原有 Cookie
      details.requestHeaders = details.requestHeaders.filter(
        h => h.name.toLowerCase() !== 'cookie'
      );
      // 注入容器 Cookie
      details.requestHeaders.push({
        name: 'Cookie',
        value: cookieString
      });
    }

    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
  ['requestHeaders', 'extraHeaders']
);

// 响应后保存 Cookie
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const containerId = tabBinding.getContainer(details.tabId);
    if (!containerId) return;

    const setCookies = details.responseHeaders.filter(
      h => h.name.toLowerCase() === 'set-cookie'
    );

    for (const setCookie of setCookies) {
      const cookie = cookieManager.parseSetCookie(setCookie.value);
      cookieManager.saveCookie(containerId, cookie);
    }

    // 移除 Set-Cookie，防止写入全局
    return {
      responseHeaders: details.responseHeaders.filter(
        h => h.name.toLowerCase() !== 'set-cookie'
      )
    };
  },
  { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
  ['responseHeaders', 'extraHeaders']
);
```

#### 7.2.3 JavaScript Cookie 拦截

```javascript
// content-script.js - 拦截 JavaScript Cookie 操作
(function() {
  const containerId = window.__CONTAINER_ID__;

  // 保存原始方法
  const originalCookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

  // 重写 cookie 属性
  Object.defineProperty(document, 'cookie', {
    get: function() {
      // 从扩展获取容器 Cookie
      let result = '';
      const xhr = new XMLHttpRequest();
      xhr.open('GET', chrome.runtime.getURL('get-cookies.html'), false);
      xhr.setRequestHeader('X-Container-Id', containerId);
      xhr.send();
      result = xhr.responseText;
      return result;
    },
    set: function(value) {
      // 发送到扩展保存
      fetch(chrome.runtime.getURL('set-cookie'), {
        method: 'POST',
        headers: {
          'X-Container-Id': containerId
        },
        body: value
      });
      return value;
    },
    configurable: true
  });
})();
```

### 7.3 Cookie 隔离架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Cookie Isolation System                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Network Request Layer                     ││
│  │                                                              ││
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   ││
│  │  │ onBeforeSend │───▶│  Inject      │───▶│  HTTP Request │   ││
│  │  │ Headers      │    │  Container   │    │              │   ││
│  │  │              │    │  Cookies     │    │              │   ││
│  │  └──────────────┘    └──────────────┘    └──────────────┘   ││
│  │                                                │             ││
│  │                                                ▼             ││
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   ││
│  │  │ Save to      │◀───│  Parse       │◀───│  HTTP Response│   ││
│  │  │ Container    │    │  Set-Cookie  │    │              │   ││
│  │  │ Storage      │    │  Headers     │    │              │   ││
│  │  └──────────────┘    └──────────────┘    └──────────────┘   ││
│  │                                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    JavaScript Cookie Layer                   ││
│  │                                                              ││
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   ││
│  │  │ document.    │───▶│  Content     │───▶│  Extension   │   ││
│  │  │ cookie getter│    │  Script      │    │  Storage     │   ││
│  │  └──────────────┘    └──────────────┘    └──────────────┘   ││
│  │                                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Container Cookie Storage                  ││
│  │                                                              ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │  Container 1                    Container 2             │││
│  │  │  ┌─────────────────────┐       ┌─────────────────────┐  │││
│  │  │  │ example.com         │       │ example.com         │  │││
│  │  │  │ session_id=abc123   │       │ session_id=xyz789   │  │││
│  │  │  │ user_token=token1   │       │ user_token=token2   │  │││
│  │  │  └─────────────────────┘       └─────────────────────┘  │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │                                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 容器间数据隔离最佳实践

### 8.1 隔离层级设计

```
┌─────────────────────────────────────────────────────────────────┐
│                    Data Isolation Layers                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Level 1: Network Layer (Cookie, HTTP Auth)                     │
│  ├── Cookie 隔离                                                │
│  ├── HTTP 认证隔离                                              │
│  └── SSL Session 隔离                                           │
│                                                                  │
│  Level 2: Storage Layer (Client-side)                           │
│  ├── localStorage 隔离                                          │
│  ├── sessionStorage 隔离                                        │
│  ├── IndexedDB 隔离                                             │
│  └── Cache API 隔离                                             │
│                                                                  │
│  Level 3: Extension Layer (Extension data)                      │
│  ├── chrome.storage 命名空间                                    │
│  ├── Extension state 隔离                                       │
│  └── Background script 状态管理                                 │
│                                                                  │
│  Level 4: UI Layer (Visual separation)                          │
│  ├── Tab Groups                                                 │
│  ├── Visual indicators                                          │
│  └── Popup state                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 数据隔离实现清单

```javascript
// 完整的容器隔离管理器
class ContainerIsolationManager {
  constructor() {
    this.cookieManager = new ContainerCookieManager();
    this.storageManager = new ContainerStorageManager();
    this.tabBinding = new TabContainerBinding();
    this.siteAssignments = new Map(); // domain -> containerId
  }

  // 初始化
  async init() {
    await Promise.all([
      this.cookieManager.init(),
      this.storageManager.init(),
      this.tabBinding.init(),
      this.loadSiteAssignments()
    ]);

    this.setupListeners();
  }

  // 加载站点分配
  async loadSiteAssignments() {
    const stored = await chrome.storage.local.get('siteAssignments');
    if (stored.siteAssignments) {
      this.siteAssignments = new Map(Object.entries(stored.siteAssignments));
    }
  }

  // 设置监听器
  setupListeners() {
    // 标签页创建
    chrome.tabs.onCreated.addListener((tab) => this.handleTabCreated(tab));

    // 标签页更新
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.url) {
        this.handleTabUrlChanged(tabId, changeInfo.url);
      }
    });

    // 导航前
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
      if (details.frameId === 0) {
        this.handleNavigation(details);
      }
    });

    // 请求拦截
    chrome.webRequest.onBeforeSendHeaders.addListener(
      (details) => this.interceptRequest(details),
      { urls: ['<all_urls>'] },
      ['requestHeaders', 'extraHeaders']
    );

    // 响应拦截
    chrome.webRequest.onHeadersReceived.addListener(
      (details) => this.interceptResponse(details),
      { urls: ['<all_urls>'] },
      ['responseHeaders', 'extraHeaders']
    );
  }

  // 处理标签页创建
  async handleTabCreated(tab) {
    if (tab.openerTabId) {
      const parentContainer = this.tabBinding.getContainer(tab.openerTabId);
      if (parentContainer) {
        await this.tabBinding.bind(tab.id, parentContainer);
      }
    }
  }

  // 处理 URL 变化
  async handleTabUrlChanged(tabId, url) {
    const domain = new URL(url).hostname;
    const assignedContainer = this.siteAssignments.get(domain);

    if (assignedContainer) {
      const currentContainer = this.tabBinding.getContainer(tabId);
      if (currentContainer !== assignedContainer) {
        await this.tabBinding.bind(tabId, assignedContainer);
      }
    }
  }

  // 处理导航
  async handleNavigation(details) {
    const containerId = this.tabBinding.getContainer(details.tabId);
    if (containerId) {
      // 注入隔离脚本
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['isolation-script.js'],
        injectImmediately: true
      });
    }
  }

  // 拦截请求
  interceptRequest(details) {
    const containerId = this.tabBinding.getContainer(details.tabId);
    if (!containerId) return;

    const url = new URL(details.url);
    const cookieString = this.cookieManager.getCookieString(containerId, url.hostname);

    if (cookieString) {
      details.requestHeaders = details.requestHeaders.filter(
        h => h.name.toLowerCase() !== 'cookie'
      );
      details.requestHeaders.push({ name: 'Cookie', value: cookieString });
    }

    return { requestHeaders: details.requestHeaders };
  }

  // 拦截响应
  interceptResponse(details) {
    const containerId = this.tabBinding.getContainer(details.tabId);
    if (!containerId) return;

    const setCookies = details.responseHeaders.filter(
      h => h.name.toLowerCase() === 'set-cookie'
    );

    for (const setCookie of setCookies) {
      const cookie = this.cookieManager.parseSetCookie(setCookie.value);
      this.cookieManager.saveCookie(containerId, cookie);
    }

    return {
      responseHeaders: details.responseHeaders.filter(
        h => h.name.toLowerCase() !== 'set-cookie'
      )
    };
  }

  // 分配站点到容器
  async assignSite(domain, containerId) {
    this.siteAssignments.set(domain, containerId);
    await chrome.storage.local.set({
      siteAssignments: Object.fromEntries(this.siteAssignments)
    });
  }

  // 清除容器数据
  async clearContainerData(containerId) {
    await Promise.all([
      this.cookieManager.clearContainerCookies(containerId),
      this.storageManager.clearContainer(containerId)
    ]);
  }
}
```

### 8.3 安全考虑

```javascript
// 安全检查清单
const securityChecks = {
  // 1. 防止跨容器数据泄露
  preventCrossContainerLeak: () => {
    // 确保 Content Script 不访问其他容器数据
    // 使用严格的消息验证
  },

  // 2. 防止容器逃逸
  preventContainerEscape: () => {
    // 监控 window.open 和链接跳转
    // 确保新标签页继承正确容器
  },

  // 3. 防止指纹追踪
  preventFingerprinting: () => {
    // 随机化或统一化浏览器指纹
    // 隔离 canvas 指纹
  },

  // 4. 防止时序攻击
  preventTimingAttacks: () => {
    // 统一化响应时间
    // 避免泄露容器存在性
  }
};
```

---

## 9. Mozilla multi-account-containers 架构分析

### 9.1 项目结构

```
multi-account-containers/
├── src/
│   ├── background/           # 后台脚本
│   │   ├── background.js     # 主后台脚本
│   │   ├── container.js      # 容器管理
│   │   ├── tabs.js           # 标签页管理
│   │   ├── cookies.js        # Cookie 管理
│   │   └── storage.js        # 存储管理
│   ├── popup/                # 弹出窗口 UI
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/              # 内容脚本
│   │   ├── content.js
│   │   └── isolation.js
│   ├── options/              # 选项页面
│   │   ├── options.html
│   │   └── options.js
│   └── utils/                # 工具函数
│       ├── utils.js
│       └── constants.js
├── manifest.json
└── package.json
```

### 9.2 核心模块分析

#### 9.2.1 容器管理模块

```javascript
// container.js - 容器管理核心逻辑
const ContainerManager = {
  // 默认容器配置
  defaultContainers: [
    { name: 'Personal', color: 'blue', icon: 'fingerprint' },
    { name: 'Work', color: 'orange', icon: 'briefcase' },
    { name: 'Banking', color: 'green', icon: 'dollar' },
    { name: 'Shopping', color: 'pink', icon: 'cart' }
  ],

  // 初始化容器
  async init() {
    const containers = await browser.contextualIdentities.query({});
    if (containers.length === 0) {
      // 创建默认容器
      for (const config of this.defaultContainers) {
        await browser.contextualIdentities.create(config);
      }
    }
  },

  // 创建容器
  async create(config) {
    const container = await browser.contextualIdentities.create({
      name: config.name,
      color: config.color,
      icon: config.icon
    });
    return container;
  },

  // 获取容器
  async get(cookieStoreId) {
    const containers = await browser.contextualIdentities.query({});
    return containers.find(c => c.cookieStoreId === cookieStoreId);
  },

  // 列出所有容器
  async list() {
    return await browser.contextualIdentities.query({});
  },

  // 删除容器
  async remove(cookieStoreId) {
    // 先关闭该容器的所有标签页
    const tabs = await browser.tabs.query({ cookieStoreId });
    for (const tab of tabs) {
      await browser.tabs.remove(tab.id);
    }
    // 删除容器
    await browser.contextualIdentities.remove(cookieStoreId);
  }
};
```

#### 9.2.2 标签页管理模块

```javascript
// tabs.js - 标签页管理
const TabManager = {
  // 在容器中打开 URL
  async openInContainer(url, cookieStoreId) {
    const tab = await browser.tabs.create({
      url: url,
      cookieStoreId: cookieStoreId
    });
    return tab;
  },

  // 获取标签页的容器
  async getContainer(tabId) {
    const tab = await browser.tabs.get(tabId);
    return tab.cookieStoreId;
  },

  // 将标签页移动到容器
  async moveToContainer(tabId, cookieStoreId) {
    const tab = await browser.tabs.get(tabId);
    // Firefox 不支持直接移动，需要创建新标签页
    const newTab = await browser.tabs.create({
      url: tab.url,
      cookieStoreId: cookieStoreId,
      index: tab.index
    });
    await browser.tabs.remove(tabId);
    return newTab;
  },

  // 获取容器中的所有标签页
  async getTabsInContainer(cookieStoreId) {
    return await browser.tabs.query({ cookieStoreId });
  }
};
```

#### 9.2.3 站点分配模块

```javascript
// storage.js - 站点分配存储
const SiteAssignment = {
  // 存储键
  STORAGE_KEY: 'siteContainerMap',

  // 获取站点分配
  async get(domain) {
    const data = await browser.storage.local.get(this.STORAGE_KEY);
    const map = data[this.STORAGE_KEY] || {};
    return map[domain];
  },

  // 设置站点分配
  async set(domain, cookieStoreId) {
    const data = await browser.storage.local.get(this.STORAGE_KEY);
    const map = data[this.STORAGE_KEY] || {};
    map[domain] = cookieStoreId;
    await browser.storage.local.set({ [this.STORAGE_KEY]: map });
  },

  // 移除站点分配
  async remove(domain) {
    const data = await browser.storage.local.get(this.STORAGE_KEY);
    const map = data[this.STORAGE_KEY] || {};
    delete map[domain];
    await browser.storage.local.set({ [this.STORAGE_KEY]: map });
  },

  // 获取所有分配
  async getAll() {
    const data = await browser.storage.local.get(this.STORAGE_KEY);
    return data[this.STORAGE_KEY] || {};
  }
};
```

#### 9.2.4 自动容器分配

```javascript
// background.js - 自动分配逻辑
browser.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const url = new URL(details.url);
  const domain = url.hostname;

  // 检查是否有分配的容器
  const assignedContainer = await SiteAssignment.get(domain);

  if (assignedContainer) {
    const tab = await browser.tabs.get(details.tabId);

    // 如果当前不在正确的容器中
    if (tab.cookieStoreId !== assignedContainer) {
      // 在正确的容器中重新打开
      await browser.tabs.create({
        url: details.url,
        cookieStoreId: assignedContainer,
        index: tab.index
      });
      await browser.tabs.remove(details.tabId);
    }
  }
});
```

### 9.3 manifest.json 配置

```json
{
  "manifest_version": 2,
  "name": "Multi-Account Containers",
  "version": "8.0.0",
  "description": "Multi-Account Containers lets you keep parts of your online life separated into color-coded tabs",
  "permissions": [
    "contextualIdentities",
    "tabs",
    "storage",
    "webNavigation",
    "cookies",
    "management"
  ],
  "background": {
    "scripts": ["src/background/background.js"]
  },
  "browser_action": {
    "default_icon": {
      "48": "img/container-48.png"
    },
    "default_title": "Multi-Account Containers",
    "default_popup": "src/popup/popup.html"
  },
  "icons": {
    "48": "img/container-48.png",
    "96": "img/container-96.png"
  }
}
```

### 9.4 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│              Mozilla Multi-Account Containers                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      UI Layer                                ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │   Popup     │  │  Options    │  │  Content    │          ││
│  │  │   Panel     │  │  Page       │  │  Script     │          ││
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          ││
│  └─────────┼────────────────┼────────────────┼──────────────────┘│
│            │                │                │                   │
│            ▼                ▼                ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Background Script                          ││
│  │  ┌─────────────────────────────────────────────────────────┐││
│  │  │                    Message Router                        │││
│  │  └─────────────────────────────────────────────────────────┘││
│  │            │                │                │               ││
│  │  ┌─────────▼─────┐  ┌───────▼───────┐  ┌─────▼─────────┐    ││
│  │  │   Container   │  │     Tab       │  │    Site       │    ││
│  │  │   Manager     │  │   Manager     │  │  Assignment   │    ││
│  │  └───────────────┘  └───────────────┘  └───────────────┘    ││
│  └─────────────────────────────────────────────────────────────┘│
│            │                │                │                   │
│            ▼                ▼                ▼                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   Firefox APIs                               ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │contextual   │  │   tabs      │  │  storage    │          ││
│  │  │Identities   │  │             │  │             │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  │  ┌─────────────┐  ┌─────────────┐                            ││
│  │  │webNavigation│  │   cookies   │                            ││
│  │  │             │  │             │                            ││
│  │  └─────────────┘  └─────────────┘                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. 移植到 Chrome 的可行方案

### 10.1 可行性评估

| 功能 | Firefox 原生支持 | Chrome 可行性 | 实现复杂度 |
|------|-----------------|--------------|-----------|
| 容器管理 | contextualIdentities API | 需自行实现 | 高 |
| Cookie 隔离 | 内核级支持 | webRequest 拦截 | 高 |
| Storage 隔离 | 内核级支持 | Content Script 拦截 | 中 |
| 标签页绑定 | cookieStoreId 属性 | 自定义绑定管理 | 中 |
| 视觉标识 | 原生支持 | Tab Groups + Content Script | 低 |
| 自动分配 | webNavigation | webNavigation | 低 |

### 10.2 推荐架构

```
┌─────────────────────────────────────────────────────────────────┐
│              Chrome Container Extension Architecture             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Manifest V3                               ││
│  │  - Service Worker (background)                              ││
│  │  - declarativeNetRequest (header injection)                 ││
│  │  - webRequest (cookie interception)                         ││
│  │  - scripting (content script injection)                     ││
│  │  - tabGroups (visual grouping)                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Core Modules                              ││
│  │                                                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │ Container   │  │   Cookie    │  │  Storage    │          ││
│  │  │ Manager     │  │  Isolator   │  │  Isolator   │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  │                                                              ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          ││
│  │  │ Tab Binding │  │ Site        │  │ Visual      │          ││
│  │  │ Manager     │  │ Assignment  │  │ Identity    │          ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘          ││
│  │                                                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Storage Layer                             ││
│  │  - chrome.storage.local (container data)                    ││
│  │  - chrome.storage.session (runtime state)                   ││
│  │  - IndexedDB (container cookies)                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.3 完整实现示例

#### 10.3.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Chrome Containers",
  "version": "1.0.0",
  "description": "Firefox-like container isolation for Chrome",
  "permissions": [
    "storage",
    "tabs",
    "tabGroups",
    "webNavigation",
    "webRequest",
    "scripting",
    "cookies"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "48": "icons/container-48.png"
    }
  },
  "icons": {
    "48": "icons/container-48.png",
    "128": "icons/container-128.png"
  }
}
```

#### 10.3.2 background.js

```javascript
// background.js - Service Worker
import { ContainerManager } from './modules/container-manager.js';
import { CookieIsolator } from './modules/cookie-isolator.js';
import { StorageIsolator } from './modules/storage-isolator.js';
import { TabBindingManager } from './modules/tab-binding.js';
import { SiteAssignmentManager } from './modules/site-assignment.js';
import { VisualIdentityManager } from './modules/visual-identity.js';

// 初始化所有模块
const containerManager = new ContainerManager();
const cookieIsolator = new CookieIsolator();
const storageIsolator = new StorageIsolator();
const tabBinding = new TabBindingManager();
const siteAssignment = new SiteAssignmentManager();
const visualIdentity = new VisualIdentityManager();

// 初始化
async function init() {
  await Promise.all([
    containerManager.init(),
    cookieIsolator.init(),
    tabBinding.init(),
    siteAssignment.init()
  ]);

  setupListeners();
}

// 设置监听器
function setupListeners() {
  // 标签页创建
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.openerTabId) {
      const parentContainer = tabBinding.getContainer(tab.openerTabId);
      if (parentContainer) {
        await tabBinding.bind(tab.id, parentContainer);
        await visualIdentity.applyToTab(tab.id, parentContainer);
      }
    }
  });

  // 标签页关闭
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabBinding.unbind(tabId);
  });

  // 导航前
  chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;

    const url = new URL(details.url);
    const assignedContainer = await siteAssignment.get(url.hostname);

    if (assignedContainer) {
      const currentContainer = tabBinding.getContainer(details.tabId);
      if (currentContainer !== assignedContainer) {
        // 重新在正确容器中打开
        const tab = await chrome.tabs.get(details.tabId);
        await chrome.tabs.create({
          url: details.url,
          index: tab.index
        });
        await chrome.tabs.remove(details.tabId);
        await tabBinding.bind(details.tabId, assignedContainer);
      }
    }

    // 注入隔离脚本
    const containerId = tabBinding.getContainer(details.tabId);
    if (containerId) {
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content-scripts/isolation.js'],
        injectImmediately: true
      });
    }
  });

  // 请求拦截
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      const containerId = tabBinding.getContainer(details.tabId);
      if (containerId) {
        return cookieIsolator.injectCookies(details, containerId);
      }
    },
    { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    ['requestHeaders', 'extraHeaders']
  );

  // 响应拦截
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const containerId = tabBinding.getContainer(details.tabId);
      if (containerId) {
        return cookieIsolator.saveCookies(details, containerId);
      }
    },
    { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest'] },
    ['responseHeaders', 'extraHeaders']
  );

  // 消息处理
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
  });
}

// 消息处理
async function handleMessage(message, sender) {
  switch (message.type) {
    case 'GET_CONTAINERS':
      return await containerManager.list();

    case 'CREATE_CONTAINER':
      return await containerManager.create(message.config);

    case 'DELETE_CONTAINER':
      return await containerManager.remove(message.containerId);

    case 'GET_CURRENT_CONTAINER':
      const tab = sender.tab;
      if (tab) {
        return tabBinding.getContainer(tab.id);
      }
      return null;

    case 'ASSIGN_SITE':
      return await siteAssignment.set(message.domain, message.containerId);

    case 'OPEN_IN_CONTAINER':
      const newTab = await chrome.tabs.create({
        url: message.url,
        index: message.index
      });
      await tabBinding.bind(newTab.id, message.containerId);
      await visualIdentity.applyToTab(newTab.id, message.containerId);
      return newTab;
  }
}

// 启动
init();
```

#### 10.3.3 container-manager.js

```javascript
// modules/container-manager.js
export class ContainerManager {
  constructor() {
    this.containers = new Map();
    this.STORAGE_KEY = 'containers';
  }

  async init() {
    const stored = await chrome.storage.local.get(this.STORAGE_KEY);
    if (stored[this.STORAGE_KEY]) {
      this.containers = new Map(Object.entries(stored[this.STORAGE_KEY]));
    } else {
      // 创建默认容器
      await this.createDefaultContainers();
    }
  }

  async createDefaultContainers() {
    const defaults = [
      { id: 'personal', name: 'Personal', color: 'blue', icon: 'fingerprint' },
      { id: 'work', name: 'Work', color: 'orange', icon: 'briefcase' },
      { id: 'banking', name: 'Banking', color: 'green', icon: 'dollar' },
      { id: 'shopping', name: 'Shopping', color: 'pink', icon: 'cart' }
    ];

    for (const config of defaults) {
      await this.create(config);
    }
  }

  async create(config) {
    const container = {
      id: config.id || this.generateId(),
      name: config.name,
      color: config.color,
      icon: config.icon,
      createdAt: Date.now()
    };

    this.containers.set(container.id, container);
    await this.save();
    return container;
  }

  async remove(containerId) {
    // 关闭该容器的所有标签页
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (this.getContainerForTab(tab.id) === containerId) {
        await chrome.tabs.remove(tab.id);
      }
    }

    this.containers.delete(containerId);
    await this.save();
  }

  async list() {
    return Array.from(this.containers.values());
  }

  get(containerId) {
    return this.containers.get(containerId);
  }

  async save() {
    await chrome.storage.local.set({
      [this.STORAGE_KEY]: Object.fromEntries(this.containers)
    });
  }

  generateId() {
    return 'container_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
```

### 10.4 限制与注意事项

1. **Cookie 隔离不完美**
   - HttpOnly Cookie 可能无法完全拦截
   - JavaScript 设置的 Cookie 需要额外处理
   - 某些安全敏感网站可能检测到异常

2. **Storage 隔离有限制**
   - Service Worker 无法拦截 localStorage
   - 需要在每个页面加载时注入脚本
   - 某些框架可能有兼容性问题

3. **性能影响**
   - 每个请求都需要拦截处理
   - 存储操作可能影响页面加载速度
   - 需要优化数据结构和缓存策略

4. **用户体验**
   - 无法像 Firefox 那样无缝集成
   - 需要用户理解扩展的工作原理
   - 某些网站可能需要特殊处理

### 10.5 替代方案

如果完整容器隔离过于复杂，可以考虑以下简化方案：

1. **Tab Groups + 独立 Profile**
   - 使用 Tab Groups 进行视觉分组
   - 关键站点使用独立 Chrome Profile

2. **Session Management**
   - 保存/恢复会话状态
   - 不同会话使用不同 Cookie 集合

3. **Proxy-based Isolation**
   - 使用代理服务器隔离请求
   - 服务端维护独立的会话状态

---

## 总结

Firefox Multi-Account Containers 提供了浏览器级别的容器隔离，其核心技术是 `contextualIdentities` API 和 `userContextId` 机制。Chrome 没有原生支持，但可以通过以下方式模拟：

1. **Cookie 隔离**：使用 webRequest API 拦截请求/响应
2. **Storage 隔离**：使用 Content Script 拦截存储操作
3. **视觉标识**：使用 Tab Groups API 和页面内注入
4. **标签页绑定**：自定义绑定管理系统

虽然 Chrome 的实现无法达到 Firefox 的完美隔离效果，但通过合理的架构设计和实现，可以提供接近的用户体验和隔离效果。

---

## 参考资料

- [Firefox contextualIdentities API - MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/contextualIdentities)
- [Mozilla Multi-Account Containers - GitHub](https://github.com/mozilla/multi-account-containers)
- [Chrome Extensions - webRequest API](https://developer.chrome.com/docs/extensions/reference/webRequest/)
- [Chrome Extensions - Tab Groups API](https://developer.chrome.com/docs/extensions/reference/tabGroups/)
- [Firefox Origin Attributes - Mozilla Wiki](https://wiki.mozilla.org/Security/OriginAttributes)
