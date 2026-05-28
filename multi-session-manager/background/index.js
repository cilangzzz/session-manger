/**
 * Service Worker 入口文件
 */

import { GroupStorageManager } from './core/GroupStorageManager.js';

let manager = null;

async function initialize() {
  if (manager) return;

  console.log('[Background] Initializing...');
  manager = new GroupStorageManager();
  await manager.initialize();
  console.log('[Background] Initialized');
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await initialize();

  if (details.reason === 'install') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: '/icons/icon48.png',
      title: 'Multi-Session Manager',
      message: 'Click to create and manage your sessions!'
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

// 消息处理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!manager) {
    initialize().then(() => handleRequest(request, sendResponse));
    return true;
  }
  return handleRequest(request, sendResponse);
});

function handleRequest(request, sendResponse) {
  const handlers = {
    // Group 管理
    'createGroup': (data) => manager.createGroup(data),
    'openGroup': (data) => manager.openGroup(data.name),
    'closeGroup': (data) => manager.closeGroup(data.name),
    'deleteGroup': (data) => manager.deleteGroupAndStorage(data.name),
    'renameGroup': (data) => manager.renameGroup(data.oldName, data.newName),
    'getManagedGroups': () => manager.getManagedGroupsList(),

    // 存储
    'getAllStores': () => manager.getAllStores(),
    'importSession': (data) => manager.importSession(data.data),
    'manualSave': () => manager.manualSave(),

    // 设置
    'getSettings': () => manager.settings,
    'updateSettings': (data) => manager.updateSettings(data),

    // 状态
    'getCurrentState': () => manager.getCurrentState(),
    'getStats': () => manager.getStats()
  };

  const handler = handlers[request.action];
  if (handler) {
    Promise.resolve(handler(request.data))
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('[Background] Error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  return false;
}

// 快捷键
chrome.commands.onCommand.addListener(async (command) => {
  if (!manager) await initialize();

  if (command === 'create-new-session') {
    await manager.createGroup();
  }
});

initialize().catch(console.error);