# Chrome/Edge 扩展开发基础知识

本文档详细介绍 Chrome/Edge 扩展开发的核心概念，基于 Manifest V3 规范。

---

## 目录

1. [Manifest V3 完整结构和配置项详解](#1-manifest-v3-完整结构和配置项详解)
2. [Service Worker (Background Script) 的生命周期、事件处理、持久化问题](#2-service-worker-background-script-的生命周期事件处理持久化问题)
3. [Content Scripts 的注入方式、通信机制、DOM 操作](#3-content-scripts-的注入方式通信机制dom-操作)
4. [Popup 和 Options Page 的开发模式](#4-popup-和-options-page-的开发模式)
5. [权限系统：permissions vs host_permissions 的区别](#5-权限系统permissions-vs-host_permissions-的区别)
6. [消息通信机制：runtime.sendMessage、onMessage、端口通信](#6-消息通信机制runtimesendmessage-onmessage端口通信)
7. [扩展的调试和测试方法](#7-扩展的调试和测试方法)

---

## 1. Manifest V3 完整结构和配置项详解

Manifest V3 是 Chrome 扩展的最新版本规范，于 2024 年完全取代 Manifest V2。Edge 浏览器也采用相同的规范。

### 1.1 基础结构

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "version": "1.0.0",
  "description": "A sample Chrome extension"
}
```

### 1.2 完整配置项详解

```json
{
  // ========== 必需字段 ==========
  "manifest_version": 3,
  "name": "My Extension",
  "version": "1.0.0",

  // ========== 推荐字段 ==========
  "description": "Extension description",
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },

  // ========== Action (工具栏按钮) ==========
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_title": "Click me",
    "default_popup": "popup/popup.html"
  },

  // ========== Background Service Worker ==========
  "background": {
    "service_worker": "background.js",
    "type": "module"  // 支持 ES modules
  },

  // ========== Content Scripts ==========
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "exclude_matches": ["https://example.com/login/*"],
      "js": ["content/content.js"],
      "css": ["content/styles.css"],
      "run_at": "document_idle",  // document_start | document_end | document_idle
      "all_frames": false,
      "match_about_blank": false,
      "world": "ISOLATED"  // ISOLATED | MAIN
    }
  ],

  // ========== 权限配置 ==========
  "permissions": [
    "storage",
    "activeTab",
    "scripting",
    "tabs",
    "alarms",
    "notifications",
    "contextMenus",
    "bookmarks",
    "history",
    "identity",
    "webRequest"
  ],

  "optional_permissions": [
    "tabs",
    "bookmarks"
  ],

  "host_permissions": [
    "https://*.google.com/*",
    "https://api.example.com/*"
  ],

  "optional_host_permissions": [
    "https://*/*"
  ],

  // ========== Options Page ==========
  "options_page": "options/options.html",
  // 或者使用嵌入式选项页
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": false,
    "browser_style": true
  },

  // ========== Web Accessible Resources ==========
  "web_accessible_resources": [
    {
      "resources": ["images/*", "libs/*"],
      "matches": ["https://example.com/*"]
    }
  ],

  // ========== Commands (快捷键) ==========
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Open popup"
    },
    "custom-command": {
      "suggested_key": {
        "default": "Alt+C"
      },
      "description": "Custom action"
    }
  },

  // ========== Omnibox (地址栏关键字) ==========
  "omnibox": {
    "keyword": "myext"
  },

  // ========== Default Locale (国际化) ==========
  "default_locale": "en",

  // ========== Minimum Chrome Version ==========
  "minimum_chrome_version": "88",

  // ========== Offline Enabled ==========
  "offline_enabled": true,

  // ========== Content Security Policy ==========
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'",
    "sandbox": "sandbox allow-scripts allow-forms"
  },

  // ========== Sandbox Pages ==========
  "sandbox": {
    "pages": ["sandbox/sandbox.html"]
  },

  // ========== Cross-Origin Opener Policy ==========
  "cross_origin_opener_policy": {
    "value": "same-origin"
  },

  // ========== Cross-Origin Embedder Policy ==========
  "cross_origin_embedder_policy": {
    "value": "require-corp"
  },

  // ========== Declarative Net Request (替代 webRequest) ==========
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "ruleset_1",
        "enabled": true,
        "path": "rules/rules.json"
      }
    ]
  },

  // ========== Side Panel ==========
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  }
}
```

### 1.3 关键配置项说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `manifest_version` | number | 是 | 必须为 3 |
| `name` | string | 是 | 扩展名称，最多 45 字符 |
| `version` | string | 是 | 版本号，格式：a.b.c.d |
| `description` | string | 否 | 描述，最多 132 字符 |
| `icons` | object | 否 | 扩展图标，推荐提供 16/32/48/128 四种尺寸 |
| `action` | object | 否 | 工具栏按钮配置（MV3 新增，替代 browser_action） |
| `background` | object | 否 | Service Worker 配置 |
| `content_scripts` | array | 否 | 内容脚本配置 |
| `permissions` | array | 否 | 扩展权限 |
| `host_permissions` | array | 否 | 主机权限 |
| `options_page` | string | 否 | 选项页面路径 |
| `options_ui` | object | 否 | 嵌入式选项页配置 |

---

## 2. Service Worker (Background Script) 的生命周期、事件处理、持久化问题

### 2.1 Service Worker 基本概念

Manifest V3 使用 Service Worker 替代了 Manifest V2 的 Background Page。Service Worker 是事件驱动的，会在空闲时自动终止，需要时自动唤醒。

```javascript
// manifest.json
{
  "background": {
    "service_worker": "background.js",
    "type": "module"
  }
}
```

### 2.2 生命周期

```
┌─────────────┐
│   安装阶段   │  chrome.runtime.onInstalled
└──────┬──────┘
       │
       v
┌─────────────┐
│   激活阶段   │  chrome.runtime.onActivated
└──────┬──────┘
       │
       v
┌─────────────┐
│   空闲终止   │  约 30 秒无活动后终止
└──────┬──────┘
       │
       v
┌─────────────┐
│   事件唤醒   │  有事件时自动重新启动
└─────────────┘
```

### 2.3 事件处理

```javascript
// background.js

// ========== 安装事件 ==========
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('扩展首次安装');
    // 初始化默认设置
    chrome.storage.local.set({ settings: { enabled: true } });
  } else if (details.reason === 'update') {
    console.log('扩展更新', details.previousVersion);
    // 执行迁移逻辑
  }
});

// ========== 启动事件 ==========
chrome.runtime.onStartup.addListener(() => {
  console.log('浏览器启动');
});

// ========== 消息处理 ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('收到消息:', message, '来自:', sender.tab?.url);

  // 异步响应
  if (message.type === 'fetchData') {
    fetchDataAsync().then(data => {
      sendResponse({ success: true, data });
    });
    return true; // 保持消息通道开放，等待异步响应
  }

  // 同步响应
  sendResponse({ received: true });
});

// ========== 标签页事件 ==========
chrome.tabs.onCreated.addListener((tab) => {
  console.log('新标签页:', tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('页面加载完成:', tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  console.log('标签页关闭:', tabId);
});

// ========== Action 点击事件 ==========
chrome.action.onClicked.addListener((tab) => {
  // 如果没有 popup，点击图标会触发此事件
  console.log('图标被点击', tab.id);
});

// ========== 上下文菜单 ==========
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log('菜单点击:', info.menuItemId, info.selectionText);
});

// ========== Alarms (定时任务) ==========
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('闹钟触发:', alarm.name);
  if (alarm.name === 'periodicTask') {
    performPeriodicTask();
  }
});

// 创建定时任务
chrome.alarms.create('periodicTask', { periodInMinutes: 30 });
```

### 2.4 持久化问题与解决方案

Service Worker 会在空闲约 30 秒后终止，所有全局变量都会丢失。

#### 问题示例

```javascript
// 错误做法：依赖全局变量
let userSession = null; // Service Worker 终止后会丢失

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'setSession') {
    userSession = message.session; // 不可靠！
  }
});
```

#### 解决方案 1：使用 Storage API

```javascript
// 正确做法：使用 chrome.storage
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.type === 'setSession') {
    await chrome.storage.local.set({ userSession: message.session });
    sendResponse({ success: true });
  }

  if (message.type === 'getSession') {
    const result = await chrome.storage.local.get('userSession');
    sendResponse({ session: result.userSession });
  }
  return true;
});
```

#### 解决方案 2：使用 IndexedDB

```javascript
// indexedDB.js
const DB_NAME = 'extensionDB';
const DB_VERSION = 1;

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
    };
  });
}

async function saveSession(session) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const request = store.put({ id: 'current', ...session });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getSession() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const request = store.get('current');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
```

#### 解决方案 3：保持 Service Worker 活跃（不推荐）

```javascript
// 不推荐：仅用于调试或特殊场景
async function keepAlive() {
  const alarmName = 'keepAlive';
  const alarm = await chrome.alarms.get(alarmName);
  if (!alarm) {
    chrome.alarms.create(alarmName, { periodInMinutes: 0.5 });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // 保持活跃
  }
});
```

### 2.5 Service Worker 最佳实践

```javascript
// background.js

// 1. 初始化时恢复状态
async function initialize() {
  const state = await chrome.storage.local.get('appState');
  if (state.appState) {
    console.log('恢复状态:', state.appState);
  }
}

// 2. 使用模块化组织代码
import { handleTabEvents } from './handlers/tabs.js';
import { handleMessageEvents } from './handlers/messages.js';

handleTabEvents();
handleMessageEvents();

// 3. 错误处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'getData':
      return { data: await fetchData() };
    default:
      throw new Error('Unknown message type');
  }
}
```

---

## 3. Content Scripts 的注入方式、通信机制、DOM 操作

### 3.1 静态注入（通过 manifest.json）

```json
{
  "content_scripts": [
    {
      "matches": ["https://*.example.com/*"],
      "exclude_matches": ["https://example.com/admin/*"],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle",
      "all_frames": true
    }
  ]
}
```

### 3.2 动态注入（通过 scripting API）

```javascript
// background.js 或 popup.js

// ========== 基本注入 ==========
async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    console.log('脚本注入成功');
  } catch (error) {
    console.error('注入失败:', error);
  }
}

// ========== 注入函数 ==========
async function injectFunction(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: (pageTitle) => {
      // 此函数在页面上下文中执行
      document.title = pageTitle;
      return document.body.innerHTML.length;
    },
    args: ['New Title']
  });
  console.log('页面内容长度:', result[0].result);
}

// ========== 注入多个文件 ==========
await chrome.scripting.executeScript({
  target: { tabId, allFrames: true },
  files: ['lib/jquery.min.js', 'content.js']
});

// ========== 注入 CSS ==========
await chrome.scripting.insertCSS({
  target: { tabId },
  files: ['styles.css']
});

// ========== 注入内联 CSS ==========
await chrome.scripting.insertCSS({
  target: { tabId },
  css: 'body { background: #f0f0f0 !important; }'
});

// ========== 注册持久化内容脚本 ==========
await chrome.scripting.registerContentScripts([{
  id: 'my-script',
  matches: ['https://*.example.com/*'],
  js: ['content.js'],
  runAt: 'document_start'
}]);
```

### 3.3 Content Script 示例

```javascript
// content.js

(function() {
  'use strict';

  // ========== DOM 操作 ==========
  function modifyPage() {
    // 创建自定义元素
    const banner = document.createElement('div');
    banner.id = 'extension-banner';
    banner.innerHTML = `
      <div class="extension-content">
        <span>Extension Active</span>
        <button id="extension-close">Close</button>
      </div>
    `;
    document.body.appendChild(banner);

    // 事件监听
    document.getElementById('extension-close').addEventListener('click', () => {
      banner.remove();
    });
  }

  // ========== 监听 DOM 变化 ==========
  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // 处理新添加的元素
            if (node.matches('.target-element')) {
              processElement(node);
            }
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // ========== 与 Background 通信 ==========
  async function sendMessage(message) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'contentMessage',
        data: message
      });
      return response;
    } catch (error) {
      console.error('消息发送失败:', error);
    }
  }

  // ========== 监听来自 Background 的消息 ==========
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'getData':
        const data = extractPageData();
        sendResponse({ data });
        break;

      case 'highlight':
        highlightElements(message.selector);
        sendResponse({ success: true });
        break;

      case 'asyncTask':
        performAsyncTask().then(result => {
          sendResponse({ result });
        });
        return true; // 异步响应
    }
  });

  // ========== 页面数据提取 ==========
  function extractPageData() {
    return {
      title: document.title,
      url: location.href,
      meta: {
        description: document.querySelector('meta[name="description"]')?.content,
        keywords: document.querySelector('meta[name="keywords"]')?.content
      },
      links: Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent,
        href: a.href
      }))
    };
  }

  // ========== 初始化 ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      modifyPage();
      observeDOM();
    });
  } else {
    modifyPage();
    observeDOM();
  }
})();
```

### 3.4 Isolated World vs Main World

Content Scripts 运行在隔离的 JavaScript 环境中（Isolated World），与页面的 JavaScript 隔离。

```javascript
// content.js - Isolated World

// 可以访问 DOM
document.body.style.background = 'red';

// 但不能访问页面的 JavaScript 变量
console.log(window.pageVariable); // undefined（即使页面定义了）

// 页面也不能访问 content script 的变量
```

#### 在 Main World 中执行代码

```javascript
// 方法 1：通过 <script> 标签注入
function injectIntoMainWorld(code) {
  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

injectIntoMainWorld(`
  window.myExtensionData = { version: '1.0' };
  console.log('Running in main world');
`);

// 方法 2：使用 world: 'MAIN' (Chrome 102+)
// manifest.json
{
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["main-world.js"],
    "world": "MAIN"
  }]
}

// 或动态注入
await chrome.scripting.executeScript({
  target: { tabId },
  func: () => {
    // 此代码在 Main World 执行
    window.myExtensionAPI = {
      doSomething: () => console.log('API called')
    };
  },
  world: 'MAIN'
});
```

### 3.5 与页面脚本通信

```javascript
// content.js

// 发送消息到页面
function sendToPage(data) {
  window.postMessage({
    type: 'FROM_EXTENSION',
    data
  }, '*');
}

// 接收页面消息
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data.type === 'FROM_PAGE') {
    console.log('收到页面消息:', event.data);
    // 转发给 background
    chrome.runtime.sendMessage({
      type: 'pageMessage',
      data: event.data
    });
  }
});

// 页面脚本示例
// <script>
// window.postMessage({ type: 'FROM_PAGE', data: 'Hello' }, '*');
// </script>
```

---

## 4. Popup 和 Options Page 的开发模式

### 4.1 Popup 开发

#### manifest.json 配置

```json
{
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    },
    "default_title": "My Extension"
  }
}
```

#### popup.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      width: 320px;
      min-height: 200px;
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .header img {
      width: 32px;
      height: 32px;
    }

    .status {
      padding: 8px 12px;
      border-radius: 4px;
      margin-bottom: 12px;
    }

    .status.active {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .status.inactive {
      background: #ffebee;
      color: #c62828;
    }

    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    button {
      padding: 10px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button.primary {
      background: #1a73e8;
      color: white;
    }

    button.secondary {
      background: #f1f3f4;
      color: #202124;
    }

    button:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="../icons/icon32.png" alt="Logo">
    <h2>My Extension</h2>
  </div>

  <div class="status" id="status">
    Loading...
  </div>

  <div class="actions">
    <button class="primary" id="toggleBtn">Enable</button>
    <button class="secondary" id="optionsBtn">Settings</button>
    <button class="secondary" id="refreshBtn">Refresh Data</button>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

#### popup.js

```javascript
// popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggleBtn');
  const optionsBtn = document.getElementById('optionsBtn');
  const refreshBtn = document.getElementById('refreshBtn');

  // 加载当前状态
  const { enabled } = await chrome.storage.local.get('enabled');
  updateStatus(enabled);

  // 切换状态
  toggleBtn.addEventListener('click', async () => {
    const { enabled } = await chrome.storage.local.get('enabled');
    const newState = !enabled;
    await chrome.storage.local.set({ enabled: newState });
    updateStatus(newState);

    // 通知 content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: 'toggleState',
        enabled: newState
      });
    }
  });

  // 打开设置页
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 刷新数据
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'refreshData' });
      console.log('Data refreshed:', response);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh Data';
    }
  });

  function updateStatus(enabled) {
    statusEl.textContent = enabled ? 'Extension Active' : 'Extension Inactive';
    statusEl.className = `status ${enabled ? 'active' : 'inactive'}`;
    toggleBtn.textContent = enabled ? 'Disable' : 'Enable';
  }
});
```

### 4.2 Options Page 开发

#### manifest.json 配置

```json
{
  "options_page": "options/options.html",
  // 或使用嵌入式选项页
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": false,
    "browser_style": true
  }
}
```

#### options.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Extension Settings</title>
  <style>
    body {
      width: 600px;
      margin: 0 auto;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    h1 {
      margin-bottom: 24px;
    }

    .section {
      margin-bottom: 24px;
      padding: 16px;
      background: #f8f9fa;
      border-radius: 8px;
    }

    .section h3 {
      margin-top: 0;
      margin-bottom: 12px;
    }

    .form-group {
      margin-bottom: 12px;
    }

    label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }

    input[type="text"],
    input[type="number"],
    select,
    textarea {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #dadce0;
      border-radius: 4px;
      font-size: 14px;
      box-sizing: border-box;
    }

    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .checkbox-group input {
      width: auto;
    }

    .actions {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }

    button {
      padding: 10px 24px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    button.save {
      background: #1a73e8;
      color: white;
    }

    button.reset {
      background: #f1f3f4;
      color: #202124;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 24px;
      background: #323232;
      color: white;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.3s;
    }

    .toast.show {
      opacity: 1;
    }
  </style>
</head>
<body>
  <h1>Extension Settings</h1>

  <div class="section">
    <h3>General Settings</h3>

    <div class="form-group">
      <label for="apiKey">API Key</label>
      <input type="text" id="apiKey" placeholder="Enter your API key">
    </div>

    <div class="form-group">
      <label for="refreshInterval">Refresh Interval (minutes)</label>
      <input type="number" id="refreshInterval" min="1" max="60" value="5">
    </div>

    <div class="form-group checkbox-group">
      <input type="checkbox" id="autoStart">
      <label for="autoStart">Auto-start on browser launch</label>
    </div>

    <div class="form-group checkbox-group">
      <input type="checkbox" id="showNotifications">
      <label for="showNotifications">Show notifications</label>
    </div>
  </div>

  <div class="section">
    <h3>Advanced Settings</h3>

    <div class="form-group">
      <label for="theme">Theme</label>
      <select id="theme">
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="auto">Auto (System)</option>
      </select>
    </div>

    <div class="form-group">
      <label for="excludedSites">Excluded Sites (one per line)</label>
      <textarea id="excludedSites" rows="4" placeholder="example.com&#10;test.com"></textarea>
    </div>
  </div>

  <div class="actions">
    <button class="save" id="saveBtn">Save Settings</button>
    <button class="reset" id="resetBtn">Reset to Defaults</button>
  </div>

  <div class="toast" id="toast">Settings saved!</div>

  <script src="options.js"></script>
</body>
</html>
```

#### options.js

```javascript
// options.js

const defaultSettings = {
  apiKey: '',
  refreshInterval: 5,
  autoStart: true,
  showNotifications: true,
  theme: 'auto',
  excludedSites: []
};

document.addEventListener('DOMContentLoaded', async () => {
  // 加载设置
  const settings = await loadSettings();
  populateForm(settings);

  // 保存设置
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const newSettings = getFormValues();
    await saveSettings(newSettings);
    showToast('Settings saved!');

    // 通知 background
    chrome.runtime.sendMessage({
      type: 'settingsUpdated',
      settings: newSettings
    });
  });

  // 重置设置
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (confirm('Reset all settings to defaults?')) {
      await saveSettings(defaultSettings);
      populateForm(defaultSettings);
      showToast('Settings reset!');
    }
  });
});

async function loadSettings() {
  const result = await chrome.storage.sync.get('settings');
  return { ...defaultSettings, ...result.settings };
}

async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

function populateForm(settings) {
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('refreshInterval').value = settings.refreshInterval;
  document.getElementById('autoStart').checked = settings.autoStart;
  document.getElementById('showNotifications').checked = settings.showNotifications;
  document.getElementById('theme').value = settings.theme;
  document.getElementById('excludedSites').value = settings.excludedSites.join('\n');
}

function getFormValues() {
  return {
    apiKey: document.getElementById('apiKey').value,
    refreshInterval: parseInt(document.getElementById('refreshInterval').value),
    autoStart: document.getElementById('autoStart').checked,
    showNotifications: document.getElementById('showNotifications').checked,
    theme: document.getElementById('theme').value,
    excludedSites: document.getElementById('excludedSites').value
      .split('\n')
      .map(s => s.trim())
      .filter(s => s)
  };
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}
```

---

## 5. 权限系统：permissions vs host_permissions 的区别

### 5.1 permissions（扩展权限）

`permissions` 定义扩展可以使用的 Chrome API 功能。

```json
{
  "permissions": [
    // ========== 存储 ==========
    "storage",           // chrome.storage API

    // ========== 标签页 ==========
    "tabs",              // chrome.tabs API（部分功能需要 host_permissions）
    "activeTab",         // 当前活动标签页的临时访问权限

    // ========== 脚本注入 ==========
    "scripting",         // chrome.scripting API

    // ========== 定时任务 ==========
    "alarms",            // chrome.alarms API

    // ========== 通知 ==========
    "notifications",     // chrome.notifications API

    // ========== 上下文菜单 ==========
    "contextMenus",      // chrome.contextMenus API

    // ========== 书签 ==========
    "bookmarks",         // chrome.bookmarks API

    // ========== 历史 ==========
    "history",           // chrome.history API

    // ========== 身份认证 ==========
    "identity",          // chrome.identity API

    // ========== 网络请求 ==========
    "webRequest",        // chrome.webRequest API（MV3 受限）
    "declarativeNetRequest", // chrome.declarativeNetRequest API

    // ========== 其他 ==========
    "clipboardRead",     // 读取剪贴板
    "clipboardWrite",    // 写入剪贴板
    "geolocation",       // 地理位置
    "offscreen",         // offscreen documents
    "sidePanel",         // chrome.sidePanel API
    "system.display"     // 显示器信息
  ]
}
```

### 5.2 host_permissions（主机权限）

`host_permissions` 定义扩展可以访问的网站域名。

```json
{
  "host_permissions": [
    "https://*.google.com/*",     // Google 所有子域名
    "https://api.example.com/*",  // 特定 API 域名
    "https://*/*",                // 所有 HTTPS 网站（需要审核）
    "http://*/*",                 // 所有 HTTP 网站（需要审核）
    "<all_urls>"                  // 所有 URL（需要审核）
  ]
}
```

### 5.3 关键区别

| 特性 | permissions | host_permissions |
|------|-------------|------------------|
| 用途 | 访问 Chrome API | 访问特定网站 |
| 示例 | storage, tabs, scripting | https://google.com/* |
| 审核要求 | 部分需要审核 | 广泛匹配需要审核 |
| 运行时请求 | optional_permissions | optional_host_permissions |
| 影响 | 扩展功能 | 网站数据访问 |

### 5.4 activeTab 权限

`activeTab` 是一个特殊权限，允许扩展临时访问当前活动标签页，无需持久的 host_permissions。

```json
{
  "permissions": ["activeTab", "scripting"]
}
```

```javascript
// 用户点击扩展图标后，临时获得当前标签页的访问权限
chrome.action.onClicked.addListener(async (tab) => {
  // activeTab 授予了当前标签页的临时访问权限
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.body.style.border = '5px solid red';
    }
  });
});
```

### 5.5 可选权限（Optional Permissions）

可选权限允许在运行时请求权限，而不是安装时一次性请求。

```json
{
  "permissions": ["storage"],
  "optional_permissions": ["tabs", "bookmarks"],
  "host_permissions": ["https://api.example.com/*"],
  "optional_host_permissions": ["https://*/*"]
}
```

```javascript
// 请求可选权限
async function requestPermissions() {
  const hasPermission = await chrome.permissions.contains({
    permissions: ['tabs'],
    origins: ['https://*/*']
  });

  if (!hasPermission) {
    const granted = await chrome.permissions.request({
      permissions: ['tabs'],
      origins: ['https://*/*']
    });

    if (granted) {
      console.log('权限已授予');
    } else {
      console.log('权限被拒绝');
    }
  }
}

// 移除权限
async function removePermissions() {
  await chrome.permissions.remove({
    permissions: ['tabs'],
    origins: ['https://*/*']
  });
  console.log('权限已移除');
}

// 监听权限变化
chrome.permissions.onAdded.addListener((permissions) => {
  console.log('新增权限:', permissions);
});

chrome.permissions.onRemoved.addListener((permissions) => {
  console.log('移除权限:', permissions);
});
```

### 5.6 权限审核要求

以下权限在 Chrome Web Store 发布时需要审核：

**permissions:**
- `tabs`（与 host_permissions 配合使用）
- `bookmarks`
- `history`
- `identity`
- `webRequest`
- `debugger`

**host_permissions:**
- `https://*/*`
- `http://*/*`
- `<all_urls>`
- 包含通配符的广泛匹配

---

## 6. 消息通信机制：runtime.sendMessage、onMessage、端口通信

### 6.1 一次性消息通信

#### 发送消息

```javascript
// 从 content script 发送到 background
const response = await chrome.runtime.sendMessage({
  type: 'getData',
  payload: { id: 123 }
});
console.log('Response:', response);

// 从 background 发送到 content script
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const response = await chrome.tabs.sendMessage(tab.id, {
  type: 'updateUI',
  data: { enabled: true }
});

// 从 popup 发送到 background
const response = await chrome.runtime.sendMessage({
  type: 'fetchData',
  url: 'https://api.example.com/data'
});
```

#### 接收消息

```javascript
// background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message:', message);
  console.log('Sender:', sender);

  // sender.tab - 发送消息的标签页（如果来自 content script）
  // sender.id - 发送者的扩展 ID
  // sender.url - 发送者的 URL

  switch (message.type) {
    case 'getData':
      // 同步响应
      sendResponse({ data: 'Hello' });
      break;

    case 'asyncOperation':
      // 异步响应
      fetchData(message.url)
        .then(data => sendResponse({ success: true, data }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 必须返回 true 以保持通道开放

    case 'broadcast':
      // 广播到所有标签页
      broadcastToAllTabs(message.data);
      sendResponse({ broadcasted: true });
      break;
  }
});

// content.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'updateUI') {
    updateUI(message.data);
    sendResponse({ updated: true });
  }
});
```

### 6.2 端口通信（长连接）

端口通信适用于需要持续双向通信的场景。

#### 创建连接

```javascript
// content.js - 创建端口
const port = chrome.runtime.connect({ name: 'content-connection' });

// 发送消息
port.postMessage({ type: 'init', data: { page: location.href } });

// 接收消息
port.onMessage.addListener((message) => {
  console.log('Received from background:', message);
});

// 断开连接
port.onDisconnect.addListener(() => {
  console.log('Port disconnected');
});

// 主动断开
// port.disconnect();
```

#### 接收连接

```javascript
// background.js - 接收端口连接
chrome.runtime.onConnect.addListener((port) => {
  console.log('New connection:', port.name);

  // 保存端口引用
  const connections = new Map();
  connections.set(port.sender.tab.id, port);

  // 接收消息
  port.onMessage.addListener((message) => {
    console.log('Message from port:', message);

    // 回复
    port.postMessage({ type: 'ack', received: true });
  });

  // 处理断开
  port.onDisconnect.addListener(() => {
    console.log('Port disconnected');
    // 清理连接
    for (const [tabId, p] of connections) {
      if (p === port) {
        connections.delete(tabId);
        break;
      }
    }
  });
});
```

### 6.3 标签页端口通信

```javascript
// background.js - 连接到 content script
async function connectToTab(tabId) {
  const port = chrome.tabs.connect(tabId, { name: 'background-to-content' });

  port.postMessage({ type: 'ping' });

  port.onMessage.addListener((message) => {
    console.log('Response from tab:', message);
  });

  return port;
}
```

### 6.4 消息通信最佳实践

```javascript
// ========== 消息类型定义 ==========
// messages.js
export const MessageTypes = {
  // Background -> Content
  UPDATE_STATE: 'UPDATE_STATE',
  GET_PAGE_DATA: 'GET_PAGE_DATA',
  EXECUTE_ACTION: 'EXECUTE_ACTION',

  // Content -> Background
  PAGE_LOADED: 'PAGE_LOADED',
  USER_ACTION: 'USER_ACTION',
  REQUEST_DATA: 'REQUEST_DATA',

  // Popup -> Background
  TOGGLE_FEATURE: 'TOGGLE_FEATURE',
  GET_STATUS: 'GET_STATUS'
};

// ========== 消息处理封装 ==========
// messageHandler.js
class MessageHandler {
  constructor() {
    this.handlers = new Map();
    this.setupListener();
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  setupListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const handler = this.handlers.get(message.type);
      if (handler) {
        const result = handler(message, sender);
        if (result instanceof Promise) {
          result.then(sendResponse).catch(error => {
            sendResponse({ error: error.message });
          });
          return true;
        } else {
          sendResponse(result);
        }
      }
    });
  }
}

// 使用
const handler = new MessageHandler();

handler.on('GET_PAGE_DATA', async (message, sender) => {
  const data = await fetchPageData();
  return { success: true, data };
});

// ========== 广播消息 ==========
async function broadcastToAllTabs(message) {
  const tabs = await chrome.tabs.query({});
  const results = await Promise.allSettled(
    tabs.map(tab =>
      chrome.tabs.sendMessage(tab.id, message).catch(() => null)
    )
  );
  return results.filter(r => r.status === 'fulfilled').length;
}
```

### 6.5 消息通信注意事项

1. **异步响应必须返回 true**
```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  asyncOperation().then(sendResponse);
  return true; // 必须返回 true
});
```

2. **sendResponse 只能调用一次**
```javascript
// 错误：多次调用
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ step: 1 });
  sendResponse({ step: 2 }); // 无效
});
```

3. **消息通道会超时**
```javascript
// 如果异步操作时间过长，消息通道可能已关闭
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  longOperation().then(result => {
    try {
      sendResponse(result);
    } catch (e) {
      // 通道已关闭
      console.error('Response failed:', e);
    }
  });
  return true;
});
```

4. **端口断开后无法重用**
```javascript
port.onDisconnect.addListener(() => {
  // 需要重新创建连接
  port = chrome.runtime.connect({ name: 'new-connection' });
});
```

---

## 7. 扩展的调试和测试方法

### 7.1 加载未打包的扩展

1. 打开 `chrome://extensions/`
2. 启用"开发者模式"（右上角开关）
3. 点击"加载已解压的扩展程序"
4. 选择扩展目录

### 7.2 调试 Service Worker

```
chrome://extensions/ -> 找到扩展 -> 点击 "service worker" 链接
```

这将打开 DevTools，可以查看：
- Console 日志
- Network 请求
- Sources 代码
- Application 存储

### 7.3 调试 Content Script

在目标网页上打开 DevTools：
- Sources -> Content scripts -> 找到扩展名
- 或使用 `console.log()` 在 Console 中查看

### 7.4 调试 Popup

1. 右键点击扩展图标 -> 检查弹出内容
2. 或在 popup 打开时按 F12

### 7.5 调试 Options Page

1. 右键点击设置页面 -> 检查
2. 或在 `chrome://extensions/` 中点击扩展详情 -> 扩展选项

### 7.6 查看扩展存储

```
DevTools -> Application -> Storage
- Local Storage
- Session Storage
- IndexedDB
- Extension Storage (chrome.storage)
```

### 7.7 查看扩展网络请求

Service Worker DevTools -> Network 标签

注意：Content Script 的网络请求会显示在网页的 DevTools 中。

### 7.8 命令行调试

```bash
# 启动 Chrome 并加载扩展
chrome --load-extension=/path/to/extension

# 启动 Chrome 并禁用扩展验证（仅开发用）
chrome --disable-extensions-except=/path/to/extension

# 启用详细日志
chrome --enable-logging --v=1
```

### 7.9 自动化测试

#### 使用 Puppeteer

```javascript
const puppeteer = require('puppeteer');

(async () => {
  const extensionPath = '/path/to/extension';

  const browser = await puppeteer.launch({
    headless: false, // 扩展测试需要非 headless 模式
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await browser.newPage();
  await page.goto('https://example.com');

  // 测试 content script 是否注入
  const result = await page.evaluate(() => {
    return document.querySelector('#extension-element') !== null;
  });
  console.log('Extension element exists:', result);

  // 测试扩展功能
  const backgroundPage = await browser.targets().find(
    target => target.type() === 'service_worker'
  );

  if (backgroundPage) {
    // 与 Service Worker 交互
    const response = await backgroundPage.evaluate(() => {
      return chrome.runtime.sendMessage({ type: 'test' });
    });
    console.log('Background response:', response);
  }

  await browser.close();
})();
```

#### 使用 Playwright

```javascript
const { chromium } = require('playwright');

(async () => {
  const extensionPath = '/path/to/extension';

  const browser = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  const page = await browser.newPage();
  await page.goto('https://example.com');

  // 测试扩展功能
  // ...

  await browser.close();
})();
```

### 7.10 单元测试

```javascript
// 使用 Jest 测试扩展逻辑

// storage.test.js
describe('Storage Operations', () => {
  beforeEach(() => {
    // Mock chrome.storage
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(),
          set: jest.fn(),
          remove: jest.fn(),
          clear: jest.fn()
        }
      }
    };
  });

  test('should save settings', async () => {
    chrome.storage.local.set.mockResolvedValue();

    await saveSettings({ enabled: true });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      settings: { enabled: true }
    });
  });

  test('should load settings', async () => {
    chrome.storage.local.get.mockResolvedValue({
      settings: { enabled: true }
    });

    const settings = await loadSettings();

    expect(settings).toEqual({ enabled: true });
  });
});

// message.test.js
describe('Message Handler', () => {
  let messageHandler;
  let mockListener;

  beforeEach(() => {
    mockListener = jest.fn();
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: mockListener
        }
      }
    };

    messageHandler = new MessageHandler();
  });

  test('should register handler', () => {
    const handler = jest.fn();
    messageHandler.on('TEST', handler);

    expect(mockListener).toHaveBeenCalled();
  });
});
```

### 7.11 调试技巧

#### 强制 Service Worker 保持活跃

```javascript
// 仅用于调试
// 在 Service Worker 中添加
setInterval(() => {
  console.log('Keep alive:', new Date().toISOString());
}, 10000);
```

#### 查看扩展 ID

```javascript
console.log('Extension ID:', chrome.runtime.id);
```

#### 检查权限

```javascript
const hasPermission = await chrome.permissions.contains({
  permissions: ['tabs'],
  origins: ['https://*/*']
});
console.log('Has permission:', hasPermission);
```

#### 查看清单文件

```javascript
const manifest = chrome.runtime.getManifest();
console.log('Manifest:', manifest);
```

#### 获取扩展资源 URL

```javascript
const iconUrl = chrome.runtime.getURL('icons/icon48.png');
console.log('Icon URL:', iconUrl);
```

### 7.12 常见问题排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| Service Worker 不启动 | 无事件触发 | 检查事件监听器是否正确注册 |
| 消息无响应 | 未返回 true | 异步处理时返回 true |
| Content Script 未注入 | 权限不足 | 检查 host_permissions |
| 存储数据丢失 | Service Worker 终止 | 使用 chrome.storage |
| CORS 错误 | 未声明 host_permissions | 添加必要的域名权限 |
| 扩展图标不显示 | manifest 配置错误 | 检查 action.icons 配置 |

---

## 参考资源

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples)
- [MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
- [Microsoft Edge Extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/)

---

*文档生成日期: 2026-05-27*
