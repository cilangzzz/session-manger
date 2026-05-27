/**
 * Options Page Script
 */

/**
 * 发送消息到 Background
 */
async function sendMessage(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, data }, (response) => {
      resolve(response);
    });
  });
}

/**
 * 加载统计信息
 */
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

/**
 * 加载 Sessions 列表
 */
async function loadSessions() {
  const response = await sendMessage('getSessions');

  if (response?.success) {
    const sessions = response.data;
    const container = document.getElementById('sessionsList');

    if (sessions.length === 0) {
      container.innerHTML = '<div style="color: #666">No sessions yet</div>';
      return;
    }

    container.innerHTML = sessions.map(session => {
      const cookiesCount = getTotalCookies(session);
      return `
        <div class="setting-item">
          <div>
            <div class="setting-label">
              <span style="display: inline-block; width: 12px; height: 12px; background: ${session.color}; border-radius: 50%; margin-right: 8px;"></span>
              ${escapeHtml(session.name)}
            </div>
            <div class="setting-desc">${cookiesCount} cookies</div>
          </div>
          <button class="btn btn-secondary" onclick="exportSession('${session.id}')">Export</button>
        </div>
      `;
    }).join('');
  }
}

/**
 * 获取 Session Cookie 总数
 */
function getTotalCookies(session) {
  let count = 0;
  if (session.cookies) {
    for (const domain in session.cookies) {
      count += session.cookies[domain].length;
    }
  }
  return count;
}

/**
 * 导出所有 Sessions
 */
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

/**
 * 导出单个 Session
 */
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

/**
 * 导入 Sessions
 */
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

/**
 * 清除所有数据
 */
async function clearAll() {
  if (!confirm('Are you sure you want to delete all sessions and data? This cannot be undone.')) {
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

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 绑定事件
document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  await loadSessions();

  document.getElementById('exportBtn').addEventListener('click', exportAll);

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importSessions(e.target.files[0]);
    }
  });

  document.getElementById('clearAllBtn').addEventListener('click', clearAll);
});

// 暴露全局函数
window.exportSession = exportSession;