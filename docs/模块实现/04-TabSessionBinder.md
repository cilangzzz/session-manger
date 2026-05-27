# TabSessionBinder - Tab 与 Session 绑定管理

## 模块概述

`TabSessionBinder` 管理 Tab 与 Session 之间的绑定关系。当 Tab 属于某个 Tab Group 时，自动将其绑定到对应的 Session，实现 Tab 级别的会话隔离。

**文件位置**: [multi-session-manager/background/core/TabSessionBinder.js](../../../multi-session-manager/background/core/TabSessionBinder.js)

## 核心设计

### 双向映射

```
Tab ID → Session ID (bindings)
Session ID → Set<Tab ID> (sessionTabs)
```

这种双向映射设计支持：
- 快速查询 Tab 属于哪个 Session
- 快速获取 Session 包含的所有 Tab

### 数据结构

```javascript
// Tab ID -> Session ID 映射
bindings: Map<tabId, sessionId>

// Session ID -> Set<Tab ID> 映射
sessionTabs: Map<sessionId, Set<tabId>>
```

## 核心功能实现

### 1. 初始化与恢复

```javascript
async initialize() {
  await this.syncExistingBindings();  // 从 Tab Groups 恢复绑定
  this.setupListeners();              // 注册事件监听
}

async syncExistingBindings() {
  const sessions = this.sessionManager.getAllSessions();

  for (const session of sessions) {
    if (session.id === 'default') continue;

    const groupId = this.sessionManager.tabGroups.get(session.id);
    if (groupId) {
      const tabs = await chrome.tabs.query({ groupId });
      for (const tab of tabs) {
        this.bindings.set(tab.id, session.id);
      }
      this.sessionTabs.set(session.id, new Set(tabs.map(t => t.id)));
    }
  }
}
```

**恢复场景**: 扩展重新加载后，通过 Tab Group 恢复之前的绑定关系。

### 2. 事件监听

```javascript
setupListeners() {
  // Tab 创建 - 自动绑定到 Group 对应的 Session
  chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      const sessionId = this.findSessionByGroupId(tab.groupId);
      if (sessionId) {
        this.bind(tab.id, sessionId);
      }
    }
  });

  // Tab 更新 - 检查 Group 变化
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.groupId !== undefined) {
      this.handleGroupChange(tabId, changeInfo.groupId);
    }
  });

  // Tab 关闭 - 清理绑定
  chrome.tabs.onRemoved.addListener((tabId) => {
    this.unbind(tabId);
  });

  // Tab Group 移除 - 批量解绑
  chrome.tabGroups.onRemoved.addListener(async (group) => {
    const sessionId = this.findSessionByGroupId(group.id);
    if (sessionId) {
      const tabIds = this.sessionTabs.get(sessionId);
      if (tabIds) {
        for (const tabId of tabIds) {
          this.bindings.delete(tabId);
        }
        this.sessionTabs.delete(sessionId);
      }
    }
  });
}
```

### 3. 绑定操作

```javascript
bind(tabId, sessionId) {
  const session = this.sessionManager.getSession(sessionId);
  if (!session) {
    console.warn(`Session ${sessionId} not found`);
    return false;
  }

  // 如果已绑定其他 Session，先解绑
  const currentSessionId = this.bindings.get(tabId);
  if (currentSessionId && currentSessionId !== sessionId) {
    this.unbind(tabId);
  }

  // 建立双向绑定
  this.bindings.set(tabId, sessionId);

  if (!this.sessionTabs.has(sessionId)) {
    this.sessionTabs.set(sessionId, new Set());
  }
  this.sessionTabs.get(sessionId).add(tabId);

  return true;
}
```

### 4. 解绑操作

```javascript
unbind(tabId) {
  const sessionId = this.bindings.get(tabId);
  if (!sessionId) return;

  // 清理双向映射
  this.bindings.delete(tabId);

  const tabs = this.sessionTabs.get(sessionId);
  if (tabs) {
    tabs.delete(tabId);
  }
}
```

### 5. Group 变化处理

```javascript
handleGroupChange(tabId, newGroupId) {
  if (newGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // Tab 离开了 Group，解除绑定
    this.unbind(tabId);
    return;
  }

  // Tab 进入新的 Group，绑定到对应 Session
  const sessionId = this.findSessionByGroupId(newGroupId);
  if (sessionId) {
    this.bind(tabId, sessionId);
  }
}
```

### 6. 查询方法

```javascript
// 获取 Tab 绑定的 Session
getSessionId(tabId) {
  return this.bindings.get(tabId);
}

// 获取 Session 的所有 Tab
getSessionTabIds(sessionId) {
  const tabs = this.sessionTabs.get(sessionId);
  return tabs ? Array.from(tabs) : [];
}

// 通过 Group ID 找到 Session
findSessionByGroupId(groupId) {
  for (const [sessionId, gid] of this.sessionManager.tabGroups) {
    if (gid === groupId) {
      return sessionId;
    }
  }
  return null;
}
```

### 7. 批量操作

```javascript
bindTabs(tabIds, sessionId) {
  for (const tabId of tabIds) {
    this.bind(tabId, sessionId);
  }
}
```

### 8. 统计信息

```javascript
getStats() {
  return {
    totalBindings: this.bindings.size,
    sessions: this.sessionTabs.size
  };
}

getAllBindings() {
  return {
    byTab: Object.fromEntries(this.bindings),
    bySession: Object.fromEntries(
      Array.from(this.sessionTabs.entries()).map(([k, v]) => [k, Array.from(v)])
    )
  };
}
```

## 事件流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tab 绑定事件流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tab 创建                                                       │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────┐                                        │
│  │ tab.groupId 存在?   │                                        │
│  └─────────────────────┘                                        │
│       │                                                         │
│    是 │   否                                                    │
│       │    └──► 结束（不绑定）                                   │
│       ▼                                                         │
│  findSessionByGroupId(groupId)                                  │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────┐                                        │
│  │ Session 存在?       │                                        │
│  └─────────────────────┘                                        │
│       │                                                         │
│    是 │   否                                                    │
│       │    └──► 结束（不绑定）                                   │
│       ▼                                                         │
│  bind(tabId, sessionId)                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Group 变化事件流                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tab 移动到新的 Group                                            │
│       │                                                         │
│       ▼                                                         │
│  onUpdated: changeInfo.groupId 变化                             │
│       │                                                         │
│       ▼                                                         │
│  handleGroupChange(tabId, newGroupId)                           │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────────┐                                       │
│  │ groupId === NONE?    │                                       │
│  └──────────────────────┘                                       │
│       │                                                         │
│    是 │   否                                                    │
│       │    │                                                    │
│       ▼    ▼                                                    │
│  unbind()   bind(newGroup)                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Tab 关闭事件流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Tab 关闭                                                       │
│       │                                                         │
│       ▼                                                         │
│  onRemoved(tabId)                                               │
│       │                                                         │
│       ▼                                                         │
│  unbind(tabId)                                                  │
│       │                                                         │
│       ├── bindings.delete(tabId)                                │
│       └── sessionTabs.get(sessionId).delete(tabId)              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 与其他模块的关系

```
TabSessionBinder
  ├── 依赖 SessionManager 进行 Session 查询
  │   └── sessionManager.getSession(sessionId)
  │   └── sessionManager.tabGroups (Map)
  └── 被 SessionManager 初始化和管理
```

## 典型使用场景

### 场景1: 创建新 Tab

```javascript
// SessionManager 创建 Session 时
const tab = await chrome.tabs.create({ url });
const groupId = await chrome.tabs.group({ tabIds: [tab.id] });

// 自动绑定
if (this.tabBinder) {
  this.tabBinder.bind(tab.id, sessionId);
}
```

### 场景2: Tab 移动到其他 Group

用户将 Tab 拖拽到另一个 Group:
1. `onUpdated` 触发，`changeInfo.groupId` 为新 Group ID
2. `handleGroupChange()` 处理
3. 自动解绑旧 Session，绑定新 Session

### 场景3: Tab Group 关闭

用户关闭整个 Group:
1. `tabGroups.onRemoved` 触发
2. 批量清理该 Session 的所有 Tab 绑定
3. 但 Session 数据保留（存储隔离）

## 设计考量

### 为什么使用双向映射？

1. **快速查询**: O(1) 复杂度查询 Tab 的 Session 或 Session 的 Tabs
2. **批量操作**: 方便获取 Session 的所有 Tab（如关闭 Session 时）
3. **内存效率**: 使用 Set 存储 Tab ID，避免重复

### 为什么从 Tab Group 恢复？

1. **持久性**: Tab Group 信息在浏览器重启后仍然存在
2. **一致性**: 确保扩展重新加载后绑定关系正确
3. **用户体验**: 用户无需手动重新绑定

## 注意事项

1. **Group ID 验证**: Group 可能被用户删除，需要验证是否存在
2. **并发问题**: 快速创建/关闭 Tab 时需注意事件顺序
3. **内存清理**: Tab 关闭后及时清理绑定，避免内存泄漏
