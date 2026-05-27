/**
 * Options Page Script
 */

// State
let sessions = [];
let stats = {};
let settings = {};
let currentRenameSession = null;

// Elements
const elements = {
  // Settings
  autoSwitchToggle: document.getElementById('autoSwitchToggle'),
  autoSaveToggle: document.getElementById('autoSaveToggle'),
  // Stats
  statSessions: document.getElementById('statSessions'),
  statOpen: document.getElementById('statOpen'),
  statCookies: document.getElementById('statCookies'),
  statDomains: document.getElementById('statDomains'),
  // Storage
  storageUsed: document.getElementById('storageUsed'),
  storageTotal: document.getElementById('storageTotal'),
  storageBar: document.getElementById('storageBar'),
  // Sessions
  sessionsList: document.getElementById('sessionsList'),
  // Export/Import
  exportBtn: document.getElementById('exportBtn'),
  importBtn: document.getElementById('importBtn'),
  importFile: document.getElementById('importFile'),
  // Clear
  clearAllBtn: document.getElementById('clearAllBtn'),
  // Rename Modal
  renameModal: document.getElementById('renameModal'),
  renameOldName: document.getElementById('renameOldName'),
  renameNewName: document.getElementById('renameNewName'),
  renameCancel: document.getElementById('renameCancel'),
  renameConfirm: document.getElementById('renameConfirm')
};

/**
 * Send message to Background
 */
async function sendMessage(action, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, data }, (response) => {
      resolve(response);
    });
  });
}

/**
 * Initialize page
 */
async function initialize() {
  await loadSettings();
  await loadStats();
  await loadSessions();
  await loadStorageUsage();
  bindEvents();
}

/**
 * Load settings
 */
async function loadSettings() {
  const response = await sendMessage('getSettings');
  if (response?.success) {
    settings = response.data;
    elements.autoSwitchToggle.checked = settings.autoSwitchEnabled !== false;
    elements.autoSaveToggle.checked = settings.autoSaveEnabled !== false;
  }
}

/**
 * Update settings
 */
async function updateSettings(key, value) {
  await sendMessage('updateSettings', { [key]: value });
}

/**
 * Load statistics
 */
async function loadStats() {
  const response = await sendMessage('getStats');

  if (response?.success) {
    stats = response.data;

    elements.statSessions.textContent = stats.storeCount || 0;
    elements.statOpen.textContent = stats.openGroupCount || 0;
    elements.statCookies.textContent = stats.totalCookies || 0;

    // Calculate total domains
    const domainsSet = new Set();
    if (stats.domains) {
      stats.domains.forEach(d => domainsSet.add(d));
    }
    elements.statDomains.textContent = domainsSet.size || 0;
  }
}

/**
 * Load storage usage
 */
async function loadStorageUsage() {
  const used = await new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, resolve);
  });

  const total = chrome.storage.local.QUOTA_BYTES || 5242880;
  const percentage = (used / total * 100).toFixed(2);

  elements.storageUsed.textContent = formatBytes(used);
  elements.storageTotal.textContent = formatBytes(total);
  elements.storageBar.style.width = `${percentage}%`;

  // Set color based on usage
  elements.storageBar.classList.remove('warning', 'danger');
  if (percentage > 80) {
    elements.storageBar.classList.add('danger');
  } else if (percentage > 50) {
    elements.storageBar.classList.add('warning');
  }
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/**
 * Load sessions list
 */
async function loadSessions() {
  const response = await sendMessage('getAllStores');

  if (response?.success) {
    sessions = response.data || [];
    renderSessions();
  }
}

/**
 * Render sessions list
 */
function renderSessions() {
  if (sessions.length === 0) {
    elements.sessionsList.innerHTML = `
      <div class="empty-state">
        <div>No sessions saved yet</div>
        <div style="font-size: 12px; margin-top: 4px;">Create sessions using the popup</div>
      </div>
    `;
    return;
  }

  const colorMap = {
    'grey': '#9E9E9E',
    'blue': '#2196F3',
    'red': '#F44336',
    'yellow': '#FFEB3B',
    'green': '#4CAF50',
    'pink': '#E91E63',
    'purple': '#9C27B0',
    'cyan': '#00BCD4',
    'orange': '#FF9800'
  };

  elements.sessionsList.innerHTML = sessions.map(session => {
    const color = colorMap[session.color] || session.color || '#9E9E9E';
    const cookieCount = getTotalCookies(session);
    const domainCount = session.domains?.length || Object.keys(session.cookies || {}).length;
    const updatedAt = session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : '-';
    const createdAt = session.createdAt ? new Date(session.createdAt).toLocaleDateString() : '-';

    // Check if session is currently open
    const isOpen = stats.activeGroupName === session.name;

    return `
      <div class="session-item">
        <div class="session-info">
          <span class="session-color" style="background: ${color}"></span>
          <div>
            <div class="session-name">${escapeHtml(session.name)}</div>
            <div class="session-meta">
              ${cookieCount} cookies · ${domainCount} domains
              <span class="status-badge ${isOpen ? 'status-open' : 'status-closed'}">
                ${isOpen ? 'Active' : 'Saved'}
              </span>
            </div>
            <div class="session-meta" style="font-size: 11px;">
              Created: ${createdAt} · Updated: ${updatedAt}
            </div>
          </div>
        </div>
        <div class="session-actions">
          <button class="btn btn-secondary btn-small" onclick="renameSession('${escapeHtml(session.name)}')">Rename</button>
          <button class="btn btn-secondary btn-small" onclick="exportSession('${escapeHtml(session.name)}')">Export</button>
          <button class="btn btn-danger btn-small" onclick="deleteSession('${escapeHtml(session.name)}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Get total cookies count
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
 * Rename session
 */
function renameSession(name) {
  currentRenameSession = name;
  elements.renameOldName.textContent = name;
  elements.renameNewName.value = name;
  elements.renameModal.classList.add('show');
  elements.renameNewName.focus();
}

/**
 * Close rename modal
 */
function closeRenameModal() {
  elements.renameModal.classList.remove('show');
  currentRenameSession = null;
}

/**
 * Confirm rename
 */
async function confirmRename() {
  const newName = elements.renameNewName.value.trim();
  if (!newName || !currentRenameSession) return;

  if (newName === currentRenameSession) {
    closeRenameModal();
    return;
  }

  const response = await sendMessage('renameGroup', {
    oldName: currentRenameSession,
    newName
  });

  if (response?.success) {
    closeRenameModal();
    await loadStats();
    await loadSessions();
  } else {
    alert(response?.error || 'Failed to rename session');
  }
}

/**
 * Export single session
 */
async function exportSession(name) {
  const session = sessions.find(s => s.name === name);
  if (!session) return;

  const data = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    session: session
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `session-${name.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Delete session
 */
async function deleteSession(name) {
  if (!confirm(`Delete session "${name}" and all its stored data?\n\nThis cannot be undone.`)) {
    return;
  }

  const response = await sendMessage('deleteGroup', { name });

  if (response?.success) {
    await loadStats();
    await loadSessions();
    await loadStorageUsage();
  } else {
    alert(response?.error || 'Failed to delete session');
  }
}

/**
 * Export all sessions
 */
async function exportAll() {
  const data = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    sessions: sessions
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `multi-session-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/**
 * Import sessions
 */
async function importSessions(file) {
  const reader = new FileReader();

  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      // Support both single session and multiple sessions format
      const sessionsToImport = data.session ? [data.session] : (data.sessions || []);

      if (!Array.isArray(sessionsToImport) || sessionsToImport.length === 0) {
        throw new Error('Invalid backup file format');
      }

      let imported = 0;
      let skipped = 0;

      for (const session of sessionsToImport) {
        if (!session.name) {
          skipped++;
          continue;
        }

        const response = await sendMessage('importSession', { data: session });
        if (response?.success) {
          imported++;
        } else {
          skipped++;
        }
      }

      if (imported > 0) {
        alert(`Successfully imported ${imported} session(s)${skipped > 0 ? `, skipped ${skipped}` : ''}`);
        await loadStats();
        await loadSessions();
        await loadStorageUsage();
      } else {
        alert('No sessions were imported. They may already exist or have invalid data.');
      }
    } catch (error) {
      alert('Failed to import: ' + error.message);
    }
  };

  reader.readAsText(file);
}

/**
 * Clear all data
 */
async function clearAll() {
  if (!confirm('Are you sure you want to delete ALL sessions and data?\n\nThis will permanently remove all saved cookies and storage.')) {
    return;
  }

  if (!confirm('This action CANNOT be undone. Type "DELETE" to confirm.')) {
    return;
  }

  // Clear storage
  await chrome.storage.local.clear();

  alert('All data has been cleared');
  await loadStats();
  await loadSessions();
  await loadStorageUsage();
}

/**
 * HTML escape
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Bind events
 */
function bindEvents() {
  // Settings toggles
  elements.autoSwitchToggle.addEventListener('change', () => {
    updateSettings('autoSwitchEnabled', elements.autoSwitchToggle.checked);
  });

  elements.autoSaveToggle.addEventListener('change', () => {
    updateSettings('autoSaveEnabled', elements.autoSaveToggle.checked);
  });

  // Export/Import
  elements.exportBtn.addEventListener('click', exportAll);

  elements.importBtn.addEventListener('click', () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importSessions(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Clear all
  elements.clearAllBtn.addEventListener('click', clearAll);

  // Rename modal
  elements.renameCancel.addEventListener('click', closeRenameModal);
  elements.renameConfirm.addEventListener('click', confirmRename);
  elements.renameNewName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });

  // Close modal on overlay click
  elements.renameModal.addEventListener('click', (e) => {
    if (e.target === elements.renameModal) {
      closeRenameModal();
    }
  });
}

// Expose global functions for onclick handlers
window.renameSession = renameSession;
window.exportSession = exportSession;
window.deleteSession = deleteSession;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', initialize);
