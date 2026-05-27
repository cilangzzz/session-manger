/**
 * Popup Script
 */

let groups = [];
let stats = {};

const elements = {
  groupsList: document.getElementById('groupsList'),
  statsText: document.getElementById('statsText'),
  autoSwitchToggle: document.getElementById('autoSwitchToggle'),
  autoSaveToggle: document.getElementById('autoSaveToggle'),
  newGroupBtn: document.getElementById('newGroupBtn'),
  // Modal
  createModal: document.getElementById('createModal'),
  createModalClose: document.getElementById('createModalClose'),
  createName: document.getElementById('createName'),
  createUrl: document.getElementById('createUrl'),
  createColor: document.getElementById('createColor'),
  createCancel: document.getElementById('createCancel'),
  createConfirm: document.getElementById('createConfirm'),
  // Rename Modal
  renameModal: document.getElementById('renameModal'),
  renameModalClose: document.getElementById('renameModalClose'),
  renameOldName: document.getElementById('renameOldName'),
  renameNewName: document.getElementById('renameNewName'),
  renameCancel: document.getElementById('renameCancel'),
  renameConfirm: document.getElementById('renameConfirm')
};

let currentRenameGroup = null;

async function sendMessage(action, data = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ action, data }, resolve);
  });
}

async function initialize() {
  await loadSettings();
  await loadGroups();
  await loadStats();
  bindEvents();
}

async function loadSettings() {
  const response = await sendMessage('getSettings');
  if (response?.success) {
    const settings = response.data;
    elements.autoSwitchToggle.checked = settings.autoSwitchEnabled !== false;
    elements.autoSaveToggle.checked = settings.autoSaveEnabled !== false;
  }
}

async function loadGroups() {
  const response = await sendMessage('getManagedGroups');
  if (response?.success) {
    groups = response.data || [];
    renderGroups();
  }
}

async function loadStats() {
  const response = await sendMessage('getStats');
  if (response?.success) {
    stats = response.data;
    elements.statsText.textContent = `${stats.openGroupCount} open · ${stats.storeCount} saved · ${stats.totalCookies} cookies`;
  }
}

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

  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = `group-item ${group.isOpen ? 'open' : 'closed'}`;

    const color = colorMap[group.color] || '#9E9E9E';
    const updatedAt = group.updatedAt ? new Date(group.updatedAt).toLocaleDateString() : '-';

    item.innerHTML = `
      <div class="group-color" style="background:${color}"></div>
      <div class="group-info">
        <div class="group-name">${escapeHtml(group.name)}</div>
        <div class="group-meta">
          ${group.isOpen ? `${group.tabCount} tabs` : 'Closed'} · ${group.cookieCount} cookies · ${updatedAt}
        </div>
      </div>
      <div class="group-actions">
        <button class="btn-icon open" data-action="open" title="${group.isOpen ? 'Switch to' : 'Open'}">${group.isOpen ? '🔄' : '▶️'}</button>
        <button class="btn-icon rename" data-action="rename" title="Rename">✏️</button>
        <button class="btn-icon delete" data-action="delete" title="${group.isOpen ? 'Close' : 'Delete'}">${group.isOpen ? '✕' : '🗑️'}</button>
      </div>
    `;

    item.querySelectorAll('.btn-icon').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'open') await openGroup(group.name);
        if (action === 'rename') openRenameModal(group.name);
        if (action === 'delete') await deleteGroup(group);
      });
    });

    item.addEventListener('click', () => openGroup(group.name));

    elements.groupsList.appendChild(item);
  });
}

async function openGroup(name) {
  const response = await sendMessage('openGroup', { name });
  if (response?.success) {
    window.close();
  }
}

async function deleteGroup(group) {
  const action = group.isOpen ? 'close' : 'delete';
  const confirmMsg = group.isOpen
    ? `Close group "${group.name}"? (Storage will be preserved)`
    : `Delete "${group.name}" and all stored data?`;

  if (!confirm(confirmMsg)) return;

  const response = await sendMessage(action === 'close' ? 'closeGroup' : 'deleteGroup', { name: group.name });
  if (response?.success) {
    await loadGroups();
    await loadStats();
  }
}

function openRenameModal(name) {
  currentRenameGroup = name;
  elements.renameOldName.textContent = name;
  elements.renameNewName.value = name;
  elements.renameModal.classList.add('show');
  elements.renameNewName.focus();
}

function closeRenameModal() {
  elements.renameModal.classList.remove('show');
  currentRenameGroup = null;
}

async function confirmRename() {
  const newName = elements.renameNewName.value.trim();
  if (!newName || !currentRenameGroup) return;

  if (newName === currentRenameGroup) {
    closeRenameModal();
    return;
  }

  const response = await sendMessage('renameGroup', {
    oldName: currentRenameGroup,
    newName
  });

  if (response?.success) {
    closeRenameModal();
    await loadGroups();
  }
}

function openCreateModal() {
  elements.createName.value = '';
  elements.createUrl.value = '';
  document.querySelectorAll('.color-option').forEach((btn, i) => {
    btn.classList.toggle('selected', i === 0);
  });
  elements.createModal.classList.add('show');
  elements.createName.focus();
}

function closeCreateModal() {
  elements.createModal.classList.remove('show');
}

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

async function toggleAutoSwitch() {
  await sendMessage('updateSettings', { autoSwitchEnabled: elements.autoSwitchToggle.checked });
}

async function toggleAutoSave() {
  await sendMessage('updateSettings', { autoSaveEnabled: elements.autoSaveToggle.checked });
}

function bindEvents() {
  elements.newGroupBtn.addEventListener('click', openCreateModal);

  elements.autoSwitchToggle.addEventListener('change', toggleAutoSwitch);
  elements.autoSaveToggle.addEventListener('change', toggleAutoSave);

  // Create Modal
  elements.createModalClose.addEventListener('click', closeCreateModal);
  elements.createCancel.addEventListener('click', closeCreateModal);
  elements.createConfirm.addEventListener('click', confirmCreate);

  document.querySelectorAll('.color-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  elements.createName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCreate();
    if (e.key === 'Escape') closeCreateModal();
  });

  // Rename Modal
  elements.renameModalClose.addEventListener('click', closeRenameModal);
  elements.renameCancel.addEventListener('click', closeRenameModal);
  elements.renameConfirm.addEventListener('click', confirmRename);

  elements.renameNewName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
    if (e.key === 'Escape') closeRenameModal();
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', initialize);