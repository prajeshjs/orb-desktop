const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('taskAPI', {
  saveTask: (taskData) => ipcRenderer.send('task:create', taskData),
  getTodayTasks: () => ipcRenderer.invoke('tasks:getToday'),
  completeTask: (id) => ipcRenderer.invoke('tasks:complete', id),
  deleteTask: (id) => ipcRenderer.invoke('tasks:delete', id),
  editTask: (task) => ipcRenderer.invoke('tasks:open-edit', task),
  saveTaskEdit: (taskData) => ipcRenderer.send('task:edit', taskData),

  // ⭐ PHASE 3: New APIs for carry-over system
  getTodaySeparated: () => ipcRenderer.invoke('task:getTodaySeparated'),
  getPendingAtClosing: () => ipcRenderer.invoke('task:getPendingAtClosing'),
  carryOver: (taskId, newDueAt, newRemindAt, newCount, carryOverType = 'fixed') =>
    ipcRenderer.invoke('task:carryOver', taskId, newDueAt, newRemindAt, newCount, carryOverType),

  getPerformanceReport: () => ipcRenderer.invoke('task:getPerformanceReport'),
  undoCarryOver: (taskId) => ipcRenderer.invoke('task:undoCarryOver', taskId),  // ⭐ ADD THIS
  undoCompleteTask: (taskId) => ipcRenderer.invoke('tasks:undo-complete', taskId), // NEW
  
  // ── NEW: Voice Filter Listener ──
  onVoiceFilter: (cb) => ipcRenderer.on('voice:filter-list', (_event, filterType) => cb(filterType)),
});


// Follow-up popup
contextBridge.exposeInMainWorld('electronFollowup', {
  onData: (cb) => ipcRenderer.on('followup:data', (_event, task) => cb(task)),
  action: (taskId, action, carryOverData = null) => {
    ipcRenderer.send('followup:action', { taskId, action, carryOverData });
  },
  openCarryOverWindow: (task) => ipcRenderer.send('carryover:open-window', task),
});

// Pre-Alert popup
contextBridge.exposeInMainWorld('electronPreAlert', {
  onData: (cb) => ipcRenderer.on('prealert:data', (_event, task) => cb(task)),
  action: (taskId, action) => {
    ipcRenderer.send('prealert:action', { taskId, action });
  }
});

// System off message window
contextBridge.exposeInMainWorld('electronSystemOffMsg', {
  onData: (cb) => ipcRenderer.on('systemoff:data', (_event, msg) => cb(msg))
});

// Unified notification window (reminder, prealert, message)
contextBridge.exposeInMainWorld('notificationAPI', {
  onData: (cb) => ipcRenderer.on('notification:data', (_event, data) => cb(data)),
});

// Carry-over choice window (separate window with two options)
contextBridge.exposeInMainWorld('carryoverAPI', {
  onData: (cb) => ipcRenderer.on('carryover:data', (_event, task) => cb(task)),
  chooseOption: (taskId, carryOverType) => ipcRenderer.send('carryover:choose', { taskId, carryOverType }),
});


// NEW: settings API
contextBridge.exposeInMainWorld('settingsAPI', {
  getClosingTime: () => ipcRenderer.invoke('settings:get', 'closingTime'),
  setClosingTime: (time) => ipcRenderer.invoke('settings:set', 'closingTime', time),
  getFloatingOrbEnabled: () => ipcRenderer.invoke('settings:get', 'floatingOrbEnabled'),
  setFloatingOrbEnabled: (enabled) => ipcRenderer.invoke('orb:set-enabled', enabled),
  getAutoStartEnabled: () => ipcRenderer.invoke('settings:get', 'autoStartEnabled'),
  setAutoStartEnabled: (enabled) => ipcRenderer.invoke('autostart:set-enabled', enabled),
  getTheme: () => ipcRenderer.invoke('settings:get', 'theme'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  onThemeChanged: (cb) => ipcRenderer.on('theme:changed', (_event, theme) => cb(theme)),
  // 🎙️ Voice Assistant
  getVoiceEnabled: () => ipcRenderer.invoke('settings:get', 'voiceEnabled'),
  setVoiceEnabled: (enabled) => ipcRenderer.invoke('settings:set', 'voiceEnabled', enabled ? 'true' : 'false'),
});

// NEW: for edit window
contextBridge.exposeInMainWorld('electronEdit', {
  onData: (cb) => ipcRenderer.on('edit:data', (_event, task) => cb(task))
});

// CALENDAR API
contextBridge.exposeInMainWorld('calendarAPI', {
  getFutureTasks: () => ipcRenderer.invoke('tasks:getFutureTasks'),
});

// History & Report window API
contextBridge.exposeInMainWorld('historyReportAPI', {
  getReportByDate: (dateStr) => ipcRenderer.invoke('report:getByDate', dateStr),
  getHistoryEvents: (filters) => ipcRenderer.invoke('history:getEvents', filters),
  getAnalyticsData: (mode) => ipcRenderer.invoke('analytics:getData', mode),
  getCarryOverTrend: () => ipcRenderer.invoke('analytics:getCarryOverTrend'),
  onTaskUpdated: (cb) => ipcRenderer.on('analytics:taskUpdated', () => cb()),
});// AI Assistant API
contextBridge.exposeInMainWorld('aiAPI', {
  sendMessage: (message) => ipcRenderer.invoke('ai:message', message),
});

// 🔑 API KEY BRIDGE (ADD THIS)
contextBridge.exposeInMainWorld('apiKey', {
  save: (key) => ipcRenderer.invoke('save-api-key', key),
  get: () => ipcRenderer.invoke('get-api-key'),
  delete: () => ipcRenderer.invoke('delete-api-key')
});

// 🔮 FLOATING ORB BRIDGE
contextBridge.exposeInMainWorld('orbAPI', {
  togglePanel: () => ipcRenderer.send('orb:toggle-panel'),
  setOpacity: (value) => ipcRenderer.send('orb:set-opacity', value),
  getOpacity: () => ipcRenderer.invoke('orb:get-opacity'),
  getWindowStates: () => ipcRenderer.invoke('orb:get-window-states'),
  toggleWindow: (name) => ipcRenderer.invoke('orb:toggle-window', name),
  getTodayEvents: () => ipcRenderer.invoke('orb:get-today-events'),
  moveOrb: (x, y) => ipcRenderer.send('orb:move', { x, y }),
  closePanel: () => ipcRenderer.send('orb:close-panel'),
  onWindowStatesUpdated: (cb) => ipcRenderer.on('orb:window-states-updated', (_event, states) => cb(states)),
  onTaskEventsUpdated: (cb) => ipcRenderer.on('orb:task-events-updated', () => cb()),
  onAnimateIn: (cb) => ipcRenderer.on('panel:animate-in', () => cb()),
  onAnimateOut: (cb) => ipcRenderer.on('panel:animate-out', () => cb()),
});

// 🎙️ VOICE ASSISTANT BRIDGE
contextBridge.exposeInMainWorld('voiceAPI', {
  // Called by floatingorb.html on double-click
  activate: () => ipcRenderer.send('orb:voice-activate'),

  // Orb listens for these to control rotation animation
  onStartListening: (cb) => ipcRenderer.on('voice:start-listening', () => cb()),
  onStartSpeaking: (cb) => ipcRenderer.on('voice:start-speaking', () => cb()),
  onStop: (cb) => ipcRenderer.on('voice:stop', () => cb()),
  onPermissionNeeded: (cb) => ipcRenderer.on('voice:permission-needed', () => cb()),

  // Voice.html hidden window uses these:
  onStart: (cb) => ipcRenderer.on('voice:start', () => cb()),
  sendTranscript: (text) => ipcRenderer.send('voice:transcript', text),
  sendAudioBuffer: (buffer) => ipcRenderer.send('voice:audio', buffer),
  onResponse: (cb) => ipcRenderer.on('voice:response', (_e, data) => cb(data)),
  sendDone: () => ipcRenderer.send('voice:done'),
  sendError: (err) => ipcRenderer.send('voice:error', err),
  sendListeningStarted: () => ipcRenderer.send('voice:listening-started'),
  sendSpeakingStarted: () => ipcRenderer.send('voice:speaking-started'),
  onForceStop: (cb) => ipcRenderer.on('voice:force-stop', () => cb()),
});
