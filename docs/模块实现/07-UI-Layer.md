# UI 层 - Popup 与 Options 页面

## 概述

插件提供了两个用户界面：
- **Popup**: 点击扩展图标弹出，用于快速管理 Session
- **Options**: 右键扩展图标选择"选项"打开，用于高级设置和数据管理

## Popup 页面

**文件位置**: [multi-session-manager/popup/popup.js](../../../multi-session-manager/popup/popup.js)

### 功能概述

1. Session 列表展示
2. 创建新 Session
3. 打开/切换 Session
4. 重命名/关闭/删除 Session
5. 设置开关

### 核心实现

#### 初始化

```javascript
async function initialize() {
  await loadSettings();  // 加载设置
  await loadGroups();    // 加载 Session 列表
  await loadStats();     // 加载统计信息
  bindEvents();          // 绑定事件
}
```

#### 消息通信

```javascript
async function sendMessage(action, data = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action, data }, resolve);
  });
}
```

#### 渲染 Session 列表

```javascript
function renderGroups() {
  elements.groupsList.innerHTML = '';

  if (groups.length === 0) {
    elements.groupsList.innerHTML = `
      <div class="empty-state">
        <div>No sessions yet</div>
        <div style="font-size:11px;margin-top:4px">Click "+ New Session" to create</div>
      </div>
    `;
    return;
  }

  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = `group-item ${group.isOpen ? 'open' : 'closed'}`;

    item.innerHTML = `
      <div class="group-color" style="background:${color}"></div>
      <div class="group-info">
        <div class="group-name">${escapeHtml(group.name)}</div>
        <div class="group-meta">
          ${group.isOpen ? `${group.tabCount} tabs` : 'Closed'} · ${group.cookieCount} cookies
        </div>
      </div>
      <div class="group-actions">
        <button data-action="open">▶️</button>
        <button data-action="rename">✏️</button>
        <button data-action="delete">✕</button>
      </div>
    `;

    elements.groupsList.appendChild(item);
  });
}
```

#### 操作处理

```javascript
// 打开 Session
async function openGroup(name) {
  const response = await sendMessage('openGroup', { name });
  if (response?.success) {
    window.close();
  }
}

// 删除 Session
async function deleteGroup(group) {
  const action = group.isOpen ? 'close' : 'delete';
  const confirmMsg = group.isOpen
    ? `Close group "${group.name}"? (Storage will be preserved)`
    : `Delete "${group.name}" and all stored data?`;

  if (!confirm(confirmMsg)) return;

  const response = await sendMessage(
    action === 'close' ? 'closeGroup' : 'deleteGroup',
    { name: group.name }
  );

  if (response?.success) {
    await loadGroups();
    await loadStats();
  }
}

// 重命名 Session
async function confirmRename() {
  const newName = elements.renameNewName.value.trim();
  if (!newName || !currentRenameGroup) return;

  const response = await sendMessage('renameGroup', {
    oldName: currentRenameGroup,
    newName
  });

  if (response?.success) {
    closeRenameModal();
    await loadGroups();
  }
}
```

#### 创建 Session

```javascript
async function confirmCreate() {
  const name = elements.createName.value.trim() || `Session ${groups.length + 1}`;
  const url = elements.createUrl.value.trim() || 'chrome://newtab/';
  const colorBtn = document.querySelector('.color-option.selected');
  const color = colorBtn?.dataset.color || 'blue';

  const response = await sendMessage('createGroup', { name, url, color });

  if (response?.success) {
    closeCreateModal();
    window.close();
  }
}
```

#### 设置开关

```javascript
async function toggleAutoSwitch() {
  await sendMessage('updateSettings', {
    autoSwitchEnabled: elements.autoSwitchToggle.checked
  });
}

async function toggleAutoSave() {
  await sendMessage('updateSettings', {
    autoSaveEnabled: elements.autoSaveToggle.checked
  });
}
```

### UI 交互

#### Modal 管理

```javascript
// 创建 Modal
function openCreateModal() {
  elements.createName.value = '';
  elements.createUrl.value = '';
  elements.createModal.classList.add('show');
  elements.createName.focus();
}

function closeCreateModal() {
  elements.createModal.classList.remove('show');
}

// 重命名 Modal
function openRenameModal(name) {
  currentRenameGroup = name;
  elements.renameOldName.textContent = name;
  elements.renameNewName.value = name;
  elements.renameModal.classList.add('show');
  elements.renameNewName.focus();
}
```

#### 颜色选择

```javascript
document.querySelectorAll('.color-option').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});
```

## Options 页面

**文件位置**: [multi-session-manager/options/options.js](../../../multi-session-manager/options/options.js)

### 功能概述

1. 统计信息展示
2. Session 列表管理
3. 导出/导入数据
4. 清除所有数据

### 核心实现

#### 加载统计

```javascript
async function loadStats() {
  const response = await sendMessage('getStats');

  if (response?.success) {
    const { sessionCount, bindingCount, totalCookies } = response.data;
    document.getElementById('stats').innerHTML = `
      <strong>${sessionCount}</strong> sessions,
      <strong>${bindingCount}</strong> tab bindings,
      <strong>${totalCookies}</strong> cookies stored
    `;
  }
}
```

#### 加载 Sessions 列表

```javascript
async function loadSessions() {
  const response = await sendMessage('getSessions');

  if (response?.success) {
    const sessions = response.data;
    const container = document.getElementById('sessionsList');

    container.innerHTML = sessions.map(session => {
      const cookiesCount = getTotalCookies(session);
      return `
        <div class="setting-item">
          <div>
            <div class="setting-label">
              <span style="background: ${session.color}"></span>
              ${escapeHtml(session.name)}
            </div>
            <div class="setting-desc">${cookiesCount} cookies</div>
          </div>
          <button onclick="exportSession('${session.id}')">Export</button>
        </div>
      `;
    }).join('');
  }
}
```

#### 导出功能

```javascript
// 导出所有 Sessions
async function exportAll() {
  const response = await sendMessage('getSessions');

  if (response?.success) {
    const data = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      sessions: response.data
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `multi-session-backup-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }
}

// 导出单个 Session
async function exportSession(sessionId) {
  const response = await sendMessage('exportSession', { id: sessionId });

  if (response?.success) {
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${sessionId}-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }
}
```

#### 导入功能

```javascript
async function importSessions(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.sessions || !Array.isArray(data.sessions)) {
        throw new Error('Invalid backup file format');
      }

      let imported = 0;
      for (const session of data.sessions) {
        if (session.id !== 'default') {
          const response = await sendMessage('importSession', { data: session });
          if (response?.success) {
            imported++;
          }
        }
      }

      alert(`Successfully imported ${imported} sessions`);
      await loadStats();
      await loadSessions();
    } catch (error) {
      alert('Failed to import: ' + error.message);
    }
  };

  reader.readAsText(file);
}
```

#### 清除数据

```javascript
async function clearAll() {
  if (!confirm('Are you sure you want to delete all sessions and data?')) {
    return;
  }

  if (!confirm('This will delete all your saved sessions and cookies. Continue?')) {
    return;
  }

  await chrome.storage.local.clear();

  alert('All data has been cleared');
  await loadStats();
  await loadSessions();
}
```

## 工具函数库

**文件位置**: [multi-session-manager/lib/utils.js](../../../multi-session-manager/lib/utils.js)

### 通用工具

```javascript
// 生成唯一 ID
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 延迟执行
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 防抖函数
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 节流函数
export function throttle(fn, limit) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// 深拷贝
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
```

### 日期格式化

```javascript
export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

export function relativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;

  return formatDate(timestamp);
}
```

### Cookie 工具

```javascript
export function cookieToString(cookie) {
  return `${cookie.name}=${cookie.value}`;
}

export function cookiesToHeader(cookies) {
  return cookies.map(cookieToString).join('; ');
}

export function isCookieExpired(cookie) {
  if (!cookie.expirationDate) return false;
  return cookie.expirationDate * 1000 < Date.now();
}

export function filterValidCookies(cookies) {
  return cookies.filter(c => !isCookieExpired(c));
}
```

### URL 工具

```javascript
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}
```

### 存储工具

```javascript
export async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      resolve({
        used: bytes,
        total: chrome.storage.local.QUOTA_BYTES || 5242880,
        percentage: (bytes / (chrome.storage.local.QUOTA_BYTES || 5242880) * 100).toFixed(2)
      });
    });
  });
}
```

## 消息通信协议

### 请求格式

```javascript
{
  action: string,  // 操作名称
  data: object     // 操作参数
}
```

### 响应格式

```javascript
{
  success: boolean,  // 是否成功
  data: any,        // 返回数据（成功时）
  error: string     // 错误信息（失败时）
}
```

### 支持的 Action

| Action | 参数 | 返回值 |
|--------|------|--------|
| `createGroup` | `{ name, url, color }` | `{ groupId, name, tabId, isNew }` |
| `openGroup` | `{ name }` | `{ opened, tabId }` |
| `closeGroup` | `{ name }` | `boolean` |
| `deleteGroup` | `{ name }` | `boolean` |
| `renameGroup` | `{ oldName, newName }` | `boolean` |
| `getManagedGroups` | - | `GroupInfo[]` |
| `getAllStores` | - | `Store[]` |
| `manualSave` | - | `{ success, cookieCount, ... }` |
| `getSettings` | - | `Settings` |
| `updateSettings` | `Settings` | `Settings` |
| `getCurrentState` | - | `State` |
| `getStats` | - | `Stats` |

## 注意事项

1. **XSS 防护**: 使用 `escapeHtml()` 函数对用户输入进行转义
2. **异步处理**: 所有与 Background 的通信都是异步的
3. **错误处理**: 检查 `response?.success` 确保操作成功
4. **窗口关闭**: 操作完成后调用 `window.close()` 关闭 Popup
