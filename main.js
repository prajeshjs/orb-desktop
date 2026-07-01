
const { app, BrowserWindow, globalShortcut, ipcMain, Notification, Tray, Menu, screen, session, shell, nativeTheme } = require('electron');

// Disable hardware acceleration and GPU sandbox to prevent GPU process crashes
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

const path = require('path');

// ✅ ADD THIS BLOCK

// uses the apikey from the .env file to initialize the AI service, which is used for intent parsing and follow-up suggestions

// require('dotenv').config({
//   path: path.join(process.cwd(), '.env')
// });


const dbModule = require('./db');
const db = dbModule;

const { saveApiKey, getApiKey, deleteApiKey } = require('./apiKeyManager');

const { parseIntent } = require('./AIService');
const VoiceController = require('./voice/core/VoiceController');


let mainWindow;
let orbWindow = null;
let orbPanelWindow = null;
let voiceWindow = null;   // 🎙️ Hidden voice processing window
let currentOrbOpacity = 0.5;
let orbPos = { x: 0, y: 0 }; // track orb position reliably
let voiceConversationActive = false; // tracks multi-turn voice conversation state

let tray = null;
let globalAutoStartEnabled = true;

function checkIfShouldQuit() {
  if (globalAutoStartEnabled) return;
  
  // If auto-start is disabled, and no windows are currently visible, quit the app completely
  const anyVisible = BrowserWindow.getAllWindows().some(win => win.isVisible() && !win.isDestroyed());
  if (!anyVisible) {
    app.quit();
  }
}

// in-memory map of timers: taskId -> timeoutId
const reminderTimers = new Map();

// follow-up timers: taskId -> intervalId
const followupTimers = new Map();

const FOLLOWUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (default, overridden per-task)

const os = process.platform;

// When user opens carry-over window from follow-up, we close this after they choose
let followupWindowRef = null;


const appIcon = app.isPackaged
  ? path.join(process.resourcesPath, 'build/icon.ico')
  : path.join(__dirname, 'build/icon.ico');

// ==============================================
// ⭐ GLOBAL POPUP QUEUE SYSTEM
// ==============================================

let popupQueue = [];
let isProcessingPopupQueue = false;
let readyQueue = {}; // { [timeT_minute]: { message: [], prealert: [], reminder: [], followup: [], finalEvents: [] } }
let activeNotification = null;

function normalizeTimeT(timestamp) {
  const d = new Date(timestamp);
  d.setSeconds(0, 0); // floor to nearest minute
  return d.getTime();
}

async function processQueue() {
  if (isProcessingPopupQueue) return;
  isProcessingPopupQueue = true;

  try {
    while (popupQueue.length > 0) {
      const event = popupQueue.shift();
      
      // Safety check for tasks - skip if deleted/completed
      if (event.taskId && (event.type === 'followup' || event.type === 'reminder' || event.type === 'prealert')) {
        const stillPending = await isTaskStillPending(event.taskId);
        if (!stillPending) continue;
      }
      
      await showPopup(event);
    }
  } catch (err) {
    console.error("Popup queue execution error:", err);
  } finally {
    isProcessingPopupQueue = false;
  }
}

function showPopup(event) {
  return new Promise((resolve) => {
    // Explicit global timing rules requested by user
    let durationMs = 8000; // default for reminder, prealert, message
    if (event.type === 'followup') {
      durationMs = 13000; // 13 seconds for custom followup windows
    }
    
    if (event.type === 'message') {
       _showMessagePopup(event.message, event.taskTitle, durationMs, resolve);
    } else if (event.type === 'prealert') {
       _showPreAlertPopup(event.task, durationMs, resolve);
    } else if (event.type === 'reminder') {
       _showReminderPopup(event.task, durationMs, resolve);
    } else if (event.type === 'followup') {
       if (process.platform === 'darwin') {
           _showMacFollowupPopup(event.task, durationMs, resolve);
       } else {
           _showWinFollowupPopup(event.task, durationMs, resolve);
       }
    } else {
       resolve();
    }
  });
}

const MAX_TIMEOUT = 2147483647; // Max 32-bit integer for setTimeout (approx 24.8 days)

function safeSetTimeout(callback, delay) {
  const timerContext = { id: null };
  function schedule(remaining) {
    if (remaining > MAX_TIMEOUT) {
      timerContext.id = setTimeout(() => schedule(remaining - MAX_TIMEOUT), MAX_TIMEOUT);
    } else {
      timerContext.id = setTimeout(callback, remaining);
    }
  }
  schedule(delay);
  return timerContext;
}

function safeClearTimeout(timerContext) {
  if (timerContext && timerContext.id) {
    clearTimeout(timerContext.id);
  }
}

function scheduleQueueEvent(type, task, timeT, duration, priority = 0, message = null) {
  const normalizedT = normalizeTimeT(timeT);
  const now = Date.now();
  
  const event = { 
    type, 
    task, 
    taskId: task ? task.id : null, 
    scheduledTime: timeT, 
    duration, 
    priority: parseInt(priority) || 0, 
    message, 
    taskTitle: task ? task.task || task : null 
  };

  const prepDelay = Math.max(0, normalizedT - 60000 - now);
  const triggerDelay = Math.max(0, normalizedT - now);

  const prepTimer = safeSetTimeout(() => {
    if (!readyQueue[normalizedT]) {
      readyQueue[normalizedT] = { message: [], prealert: [], reminder: [], followup: [] };
    }
    readyQueue[normalizedT][type].push(event);

    // Sort follow-ups by priority: RED(1) -> BLUE(2) -> YELLOW(3) -> GRAY(4).
    // Tasks with priority 0 (unassigned) go to the end.
    readyQueue[normalizedT].followup.sort((a, b) => {
      const prioA = a.priority === 0 ? 99 : a.priority;
      const prioB = b.priority === 0 ? 99 : b.priority;
      return prioA - prioB;
    });
    // Others maintain insertion order automatically

    readyQueue[normalizedT].finalEvents = [
      ...readyQueue[normalizedT].message,
      ...readyQueue[normalizedT].prealert,
      ...readyQueue[normalizedT].reminder,
      ...readyQueue[normalizedT].followup
    ];
  }, prepDelay);

  const triggerTimer = safeSetTimeout(() => {
    if (readyQueue[normalizedT] && readyQueue[normalizedT].finalEvents) {
      popupQueue.push(...readyQueue[normalizedT].finalEvents);
      delete readyQueue[normalizedT];
    }
    
    // Always call processQueue in case it was a late enqueue directly into execution
    processQueue();

    // If it's a follow-up, schedule the NEXT one
    if (type === 'followup') {
      const taskFreqMs = (task.follow_up_frequency || 10) * 60 * 1000;
      const nextT = timeT + taskFreqMs;
      scheduleQueueEvent('followup', task, nextT, 10, priority);
    }
  }, triggerDelay);

  // Return cancel payload
  return {
    clear: () => {
      safeClearTimeout(prepTimer);
      safeClearTimeout(triggerTimer);
    }
  };
}

// Helper: notify the report window that analytics data changed
function notifyAnalyticsUpdate() {
  try {
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      if (!win.isDestroyed()) {
        win.webContents.send('analytics:taskUpdated');
        win.webContents.send('orb:task-events-updated');
      }
    }
  } catch (e) { /* ignore */ }
}


// ⭐ PHASE 3: Calculate next follow-up time based on first follow-up anchor
function calculateNextFollowUpTime(task) {
  if (!task.firstFollowUpAt) {
    console.error('Task missing firstFollowUpAt:', task.id);
    return null;
  }

  const freqMs = (task.follow_up_frequency || 10) * 60 * 1000;
  const firstFollowUpTime = new Date(task.firstFollowUpAt).getTime();
  const nowTime = Date.now();

  // How many intervals have passed?
  const elapsedMs = nowTime - firstFollowUpTime;
  const intervals = Math.floor(elapsedMs / freqMs);
  const nextInterval = intervals + 1;

  // Next follow-up time
  const nextFollowUpTime = firstFollowUpTime + (nextInterval * freqMs);

  console.log(`📋 Task ${task.id}: First FU at ${new Date(firstFollowUpTime).toLocaleTimeString()}, Next FU at ${new Date(nextFollowUpTime).toLocaleTimeString()} (every ${task.follow_up_frequency || 10}m)`);

  return nextFollowUpTime;
}

// ⭐ PHASE 3: On app startup, activate and reschedule carried-over tasks
async function rescheduleCarriedOverTasks() {
  try {
    const carriedOverTasks = await db.getCarriedOverTasks();

    if (carriedOverTasks.length === 0) {
      console.log('✅ No carried-over tasks to reschedule');
      return;
    }

    console.log(`📋 Found ${carriedOverTasks.length} carried-over task(s), activating and rescheduling...`);

    for (const task of carriedOverTasks) {
      console.log(`📋 Activating task ${task.id} (${task.carryOverType})`);

      if (task.carryOverType === 'fixed') {
        // Activate: set status from 'carried_over' back to 'pending'
        await db.activateCarriedOverTask(task.id);
        // Option 1: Fixed tasks use the recovery logic
        recoverTaskPersistence(task);
        console.log(`⏰ Fixed task ${task.id}: reminder & follow-ups rescheduled via Recovery`);
      } else if (task.carryOverType === 'dynamic') {
        // Option 2: Reminder 5 min after power on, first follow-up 10 min after reminder, then every follow_up_frequency min
        const now = Date.now();
        const reminderDelay = 5 * 60 * 1000;
        const defaultFirstFUGap = 10 * 60 * 1000; // 10 minutes after reminder (default for dynamic/auto carry-over)
        const firstFUDelay = reminderDelay + defaultFirstFUGap;  // 5 min + 10 min = 15 min after power on

        const reminderTime = now + reminderDelay;
        const durationMs = (task.duration || 15) * 60 * 1000;
        const dueTime = reminderTime + durationMs;
        const newDueAt = new Date(dueTime).toISOString();
        const newRemindAt = new Date(reminderTime).toISOString();
        const newTime = new Date(dueTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        // Activate and update timing in DB so voice assistant reads the correct time
        await db.activateCarriedOverTask(task.id, newDueAt, newRemindAt, newTime);

        // Update task object in memory for scheduleQueueEvent
        task.dueAt = newDueAt;
        task.remindAt = newRemindAt;
        task.time = newTime;

        const cancelRem = scheduleQueueEvent('reminder', task, reminderTime, 5, 0);
        reminderTimers.set(task.id, cancelRem);

        const firstFUTime = now + firstFUDelay;
        const cancelFU = scheduleQueueEvent('followup', task, firstFUTime, 10, task.quadrant || 0);
        followupTimers.set(task.id, cancelFU);
        
        console.log(`⏰ Dynamic task ${task.id}: Reminder scheduled via queue at ${new Date(reminderTime).toLocaleTimeString()}, first FU at ${new Date(firstFUTime).toLocaleTimeString()}, then every ${task.follow_up_frequency || 10}m`);
      }
    }
  } catch (err) {
    console.error('❌ Error rescheduling carried-over tasks:', err);
  }
}



// Safety check: verify task is still active (pending or carried_over) before sending notification
async function isTaskStillPending(id) {
  const t = await db.getTaskById(id);
  // Active tasks (pending or carried_over) should get follow-ups, but NOT completed tasks
  return t && (t.status === 'pending' || t.status === 'carried_over');
}

// ⭐ PHASE 3: On app startup, safety net to schedule timers for ALL pending tasks today
async function scheduleTodayPendingTasks() {
  try {
    const todayTasks = await db.getTodayTasks();
    const pendingTasks = todayTasks.filter(t => t.status === 'pending' || t.status === 'carried_over');

    if (pendingTasks.length === 0) {
      console.log('✅ No pending tasks for today to schedule');
      return;
    }

    console.log(`📋 Found ${pendingTasks.length} pending task(s) for today, ensuring timers are set...`);

    for (const task of pendingTasks) {
      // Skip if timers are already set (e.g. from rescheduleCarriedOverTasks)
      if (reminderTimers.has(task.id) || followupTimers.has(task.id)) {
        continue;
      }

      console.log(`📋 Auto-scheduling pending task ${task.id}: ${task.task}`);

      if (task.isCarryOver === 1 && task.carryOverType === 'dynamic') {
        const now = Date.now();
        const reminderDelay = 5 * 60 * 1000;
        const defaultFirstFUGap = 10 * 60 * 1000; // 10 minutes after reminder
        const firstFUDelay = reminderDelay + defaultFirstFUGap; // 15 mins after power on
        
        const reminderTime = now + reminderDelay;
        const cancelRem = scheduleQueueEvent('reminder', task, reminderTime, 5, 0);
        reminderTimers.set(task.id, cancelRem);

        const firstFUTime = now + firstFUDelay;
        const cancelFU = scheduleQueueEvent('followup', task, firstFUTime, 10, task.quadrant || 0);
        followupTimers.set(task.id, cancelFU);

        console.log(`⏰ Dynamic task ${task.id}: Reminder scheduled via queue at ${new Date(reminderTime).toLocaleTimeString()}, first FU at ${new Date(firstFUTime).toLocaleTimeString()}, then every ${task.follow_up_frequency || 10}m`);
      } else {
        // Fixed carry-over tasks and normal tasks use the recovery logic
        recoverTaskPersistence(task);
        console.log(`⏰ Normal/Fixed task ${task.id} scheduled via Task Persistence Recovery`);
      }
    }
  } catch (err) {
    console.error('❌ Error in scheduleTodayPendingTasks safety net:', err);
  }
}



function scheduleFollowups(task) {
  const dueTime = new Date(task.dueAt).getTime();

  // We simply kick off the recurring queue loop using dueTime as the first follow up exact timestamp.
  const cancelObj = scheduleQueueEvent('followup', task, dueTime, 10, task.quadrant || 0);
  followupTimers.set(task.id, cancelObj);
  
  console.log('Follow-ups initialized via queue for task', task.id);
}

// ⭐ PHASE 3 RECOVERY: Task Persistence Recovery on Power-On
function recoverTaskPersistence(task) {
  const now = Date.now();
  const remindTime = new Date(task.remindAt).getTime();
  const dueTime = new Date(task.dueAt).getTime();
  const taskFreqMs = (task.follow_up_frequency || 10) * 60 * 1000;

  console.log(`[Task Recovery] id: ${task.id}, title: ${task.task}, remindTime: ${new Date(remindTime).toLocaleTimeString()}, dueTime: ${new Date(dueTime).toLocaleTimeString()}`);

  if (now < remindTime) {
    // Case A: time not yet reached. Go normally.
    console.log(`[Task Recovery] Case A: Normal schedule for ${task.id}`);
    scheduleReminder(task);
    scheduleFollowups(task);
  } else if (now >= remindTime && now < dueTime) {
    // Case B & D: System off during/after reminder, on before 1st follow up.
    // 1st follow up at dueTime correctly.
    const untilDue = dueTime - now;
    const msg = "System is off after giving reminder";
    
    if (untilDue > 60000) {
      // > 1 minute before due time: schedule pre-alert at due - 1min
      console.log(`[Task Recovery] Case B/D: Pre-Alert scheduled via queue for ${task.id}`);
      
      const preAlertTime = dueTime - 60000;
      const msgTime = preAlertTime - 7000;
      
      scheduleQueueEvent('message', task, msgTime, 5, 0, msg);
      const cancelObj = scheduleQueueEvent('prealert', task, preAlertTime, 5);
      reminderTimers.set(task.id, cancelObj);

      scheduleFollowups(task);
    } else {
      // <= 1 minute before due time: skip pre-alert, show message then follow-up
      console.log(`[Task Recovery] Case B/D (late): message then followup for ${task.id}`);
      
      const msgTime = dueTime - 7000;
      scheduleQueueEvent('message', task, msgTime, 5, 0, msg);
      
      const cancelObj = scheduleQueueEvent('followup', task, dueTime, 10, task.quadrant || 0);
      followupTimers.set(task.id, cancelObj);
    }
  } else if (now >= dueTime) {
    // Case C & E: Both reminder and first follow-up missed (or in the past)
    // Find next follow up slot
    const elapsedSinceDue = now - dueTime;
    const intervalsPast = Math.floor(elapsedSinceDue / taskFreqMs);
    const nextSlotInterval = intervalsPast + 1;
    const nextSlotTime = dueTime + (nextSlotInterval * taskFreqMs);
    const untilNextSlot = nextSlotTime - now;
    
    let msg = "";
    if (intervalsPast === 0) {
      msg = "System is off after giving reminder and first follow up time is also crossed";
    } else {
      msg = "System was off after given reminder and follow up and still task is not completed";
    }

    console.log(`[Task Recovery] Case C/E: Next slot via queue for ${task.id} at ${new Date(nextSlotTime).toLocaleTimeString()}`);

    if (untilNextSlot > 60000) {
      // > 1 minute available: give pre-alert at nextSlotTime - 1min
      const preAlertTime = nextSlotTime - 60000;
      const msgTime = preAlertTime - 7000;

      scheduleQueueEvent('message', task, msgTime, 5, 0, msg);
      const cancelObj = scheduleQueueEvent('prealert', task, preAlertTime, 5);
      reminderTimers.set(task.id, cancelObj);

      const cancelFU = scheduleQueueEvent('followup', task, nextSlotTime, 10, task.quadrant || 0);
      followupTimers.set(task.id, cancelFU);
    } else {
      // <= 1 minute available: skip pre-alert, directly give message then follow-up at next slot
      const msgTime = nextSlotTime - 7000;
      scheduleQueueEvent('message', task, msgTime, 5, 0, msg);

      const cancelFU = scheduleQueueEvent('followup', task, nextSlotTime, 10, task.quadrant || 0);
      followupTimers.set(task.id, cancelFU);
    }
  }
}

function _showMacFollowupPopup(task, durationMs, resolve) {
  console.log('FOLLOW-UP (macOS) for task id', task.id, '-', task.task);

  const notif = new Notification({
    title: 'Task follow-up',
    body: `Did you complete: ${task.task}?`,
    icon: appIcon, // ✅ ADD THIS
    silent: false,
    actions: ['Yes ✅', 'No ❌', 'Snooze ⏰'], // macOS only
    timeoutType: 'never'
  });

  let isResolved = false;
  const finish = () => {
    if (!isResolved) {
      isResolved = true;
      notif.close();
      resolve();
    }
  };

  notif.on('action', async (event, key) => {
    if (key === 'Yes ✅') {
      console.log('User marked task COMPLETE via notification:', task.id);
      await db.markTaskCompleted(task.id);

      const reminderTimer = reminderTimers.get(task.id);
      if (reminderTimer && reminderTimer.clear) reminderTimer.clear();
      
      const intervalId = followupTimers.get(task.id);
      if (intervalId && intervalId.clear) intervalId.clear();

      console.log('Task completed via notification, timers cleared');
      finish();
    } else if (key === 'No ❌') {
      console.log('User clicked No for task:', task.id, '- continuing follow-ups');
      finish();
    } else if (key === 'Snooze ⏰') {
      console.log('User snoozed task:', task.id, '- next in 30 min');

      const intervalId = followupTimers.get(task.id);
      if (intervalId && intervalId.clear) intervalId.clear();

      setTimeout(() => {
        console.log('Snooze finished, restarting follow-ups for:', task.id);
        const nextT = Date.now();
        followupTimers.set(task.id, scheduleQueueEvent('followup', task, nextT, 10, task.quadrant || 0));
      }, 30 * 60 * 1000);
      finish();
    }
  });

  notif.on('close', finish);
  notif.show();

  setTimeout(finish, durationMs);
}



function _showMessagePopup(msg, taskTitle, durationMs, resolve) {
  console.log('SYSTEM MESSAGE NOTIFICATION (Queued):', msg);

  const display = screen.getPrimaryDisplay();
  const width = 364;
  const height = 120;

  const win = new BrowserWindow({
    width,
    height,
    icon: appIcon,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#0a0a0a',
    x: display.workArea.x + display.workArea.width - width - 16,
    y: display.workArea.y + display.workArea.height - height - 16,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  let isResolved = false;
  const finish = () => {
    if (!isResolved) {
      isResolved = true;
      if (!win.isDestroyed()) win.close();
      resolve();
    }
  };

  win.on('closed', finish);
  win.loadFile('notification.html');
  win.webContents.on('did-finish-load', () => {
    const bodyText = taskTitle ? `${msg}\nTask: ${taskTitle}` : msg;
    win.webContents.send('notification:data', { type: 'message', title: 'Notification', body: bodyText, duration: durationMs });
    shell.beep();
    win.showInactive();
    setTimeout(finish, durationMs + 500);
  });
}

function _showPreAlertPopup(task, durationMs, resolve) {
  console.log('PRE-ALERT NOTIFICATION (Queued) for task id', task.id);

  const display = screen.getPrimaryDisplay();
  const width = 364;
  const height = 120;

  const win = new BrowserWindow({
    width,
    height,
    icon: appIcon,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#0a0a0a',
    x: display.workArea.x + display.workArea.width - width - 16,
    y: display.workArea.y + display.workArea.height - height - 16,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  let isResolved = false;
  activeNotification = { type: 'prealert', taskId: task.id, windowRef: win };

  const finish = () => {
    if (!isResolved) {
      isResolved = true;
      if (activeNotification && activeNotification.windowRef === win) {
        activeNotification = null;
      }
      if (!win.isDestroyed()) win.close();
      resolve();
    }
  };

  win.on('closed', finish);
  win.loadFile('notification.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('notification:data', { type: 'prealert', title: 'Pre-Alert Reminder', body: task.task, duration: durationMs });
    shell.beep();
    win.showInactive();
    setTimeout(finish, durationMs + 500);
  });
}

function _showWinFollowupPopup(task, durationMs, resolve) {
  console.log('FOLLOW-UP (Windows Queued) for task id', task.id, '-', task.task);

  // Log Follow-up Triggered event
  db.insertTaskEvent({
    task_id: task.id,
    task_title: task.task,
    priority: task.quadrant || null,
    action_type: 'Follow-up Triggered',
    timestamp: new Date().toISOString(),
    notes: null
  }).catch(e => console.error('Event log error:', e));

  const display = screen.getPrimaryDisplay();
  const width = 364;
  const height = 120;

  const win = new BrowserWindow({
    width,
    height,
    icon: appIcon,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#0a0a0a',
    x: display.workArea.x + display.workArea.width - width - 16,
    y: display.workArea.y + display.workArea.height - height - 16,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  followupWindowRef = win;

  let isResolved = false;
  activeNotification = { type: 'followup', taskId: task.id, windowRef: win };

  const finish = () => {
    if (!isResolved) {
      isResolved = true;
      if (activeNotification && activeNotification.windowRef === win) {
        activeNotification = null;
      }
      if (!win.isDestroyed()) win.close();
      resolve();
    }
  };

  win.on('closed', () => {
    if (typeof carryoverWindow !== 'undefined' && carryoverWindow && !carryoverWindow.isDestroyed() && carryoverWindow.isVisible()) {
      carryoverWindow.hide();
    }
    followupWindowRef = null;
    finish();
  });

  win.loadFile('followup.html');

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('followup:data', { task, duration: durationMs });
    shell.beep();
    win.showInactive();
  });

  setTimeout(finish, durationMs);
}

function _showReminderPopup(task, durationMs, resolve) {
  console.log('REMINDER FIRE (Queued) for task id', task.id, '-', task.task);

  // Log reminder triggered event
  db.insertTaskEvent({
    task_id: task.id,
    task_title: task.task,
    priority: task.quadrant || null,
    action_type: 'Reminder Triggered',
    timestamp: new Date().toISOString(),
    notes: null
  }).catch(e => console.error('Event log error:', e));

  const display = screen.getPrimaryDisplay();
  const width = 364;
  const height = 120;

  const win = new BrowserWindow({
    width,
    height,
    icon: appIcon,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#0a0a0a',
    x: display.workArea.x + display.workArea.width - width - 16,
    y: display.workArea.y + display.workArea.height - height - 16,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  let isResolved = false;
  const finish = () => {
    if (!isResolved) {
      isResolved = true;
      if (!win.isDestroyed()) win.close();
      resolve();
    }
  };

  win.on('closed', finish);
  win.loadFile('notification.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('notification:data', { type: 'reminder', title: 'Task Reminder', body: task.task, duration: durationMs });
    shell.beep();
    win.showInactive();
    setTimeout(finish, durationMs + 500);
  });
}

function scheduleReminder(task) {
  const remindTime = new Date(task.remindAt).getTime();
  
  if (Date.now() >= remindTime) {
    console.log('Reminder time already passed for task id', task.id);
    return;
  }

  const cancelObj = scheduleQueueEvent('reminder', task, remindTime, 5, 0);
  reminderTimers.set(task.id, cancelObj);
  console.log('Scheduled reminder (Queued) for task id', task.id, 'at', new Date(remindTime).toLocaleTimeString());
}

// listen for tasks coming from the renderer (index.html)
ipcMain.on('task:create', async (event, taskData) => {
  try {
    const id = await db.insertTask(taskData);
    console.log('Task saved with id:', id);

    // Log Task Created event
    await db.insertTaskEvent({
      task_id: id,
      task_title: taskData.task,
      priority: taskData.quadrant,
      action_type: 'Task Created',
      timestamp: new Date().toISOString(),
      notes: null
    });
    notifyAnalyticsUpdate();

    const taskInfo = {
      id,
      task: taskData.task,
      remindAt: taskData.remindAt,
      dueAt: taskData.dueAt,
      duration: taskData.duration,
      carryOverCount: 0,
      quadrant: taskData.quadrant,
      follow_up_frequency: taskData.followUpFrequency || 10,
    };

    // pre-due reminder
    scheduleReminder(taskInfo);

    // post-due follow-ups every follow_up_frequency minutes
    scheduleFollowups(taskInfo);
  } catch (err) {
    console.error('Failed to save task:', err);
  }
});

ipcMain.handle('tasks:getToday', async () => {
  const tasks = await db.getTodayTasks();
  return tasks;
});

ipcMain.handle('tasks:complete', async (event, id) => {
  // Get task info before completing for event logging
  const taskInfo = await db.getTaskById(id);
  await db.markTaskCompleted(id);

  // Log Marked Completed event
  if (taskInfo) {
    await db.insertTaskEvent({
      task_id: id,
      task_title: taskInfo.task,
      priority: taskInfo.quadrant,
      action_type: 'Marked Completed',
      timestamp: new Date().toISOString(),
      notes: null
    });
    notifyAnalyticsUpdate();
  }

  // stop timers for this task
  const t1 = reminderTimers.get(id);
  if (t1) {
    clearTimeout(t1);
    reminderTimers.delete(id);
  }
  const t2 = followupTimers.get(id);
  if (t2) {
    clearInterval(t2);
    followupTimers.delete(id);
  }

  console.log('Task completed, timers cleared for id', id);
  return true;
});


ipcMain.handle('tasks:delete', async (event, id) => {
  // Get task info before deleting for event logging
  const taskInfo = await db.getTaskById(id);

  // Clear timers FIRST before deleting
  const t1 = reminderTimers.get(id);
  if (t1) {
    clearTimeout(t1);
    reminderTimers.delete(id);
  }
  const t2 = followupTimers.get(id);
  if (t2) {
    clearInterval(t2);
    followupTimers.delete(id);
  }

  // Then delete from DB
  await db.deleteTask(id);

  // Log Deleted event
  if (taskInfo) {
    await db.insertTaskEvent({
      task_id: id,
      task_title: taskInfo.task,
      priority: taskInfo.quadrant,
      action_type: 'Deleted',
      timestamp: new Date().toISOString(),
      notes: null
    });
    notifyAnalyticsUpdate();
  }

  console.log('🗑️ Task fully deleted and timers cleared for id:', id);
  return true;
});

// ⭐ PHASE 3: Undo carry-over
ipcMain.handle('task:undoCarryOver', async (event, taskId) => {
  try {
    console.log('↺ Undo carry-over requested for task:', taskId);

    // Get task info for logging
    const taskBefore = await db.getTaskById(taskId);

    // 1. Undo in DB (restore original dueAt/remindAt, clear carry-over flags)
    const result = await db.undoCarryOver(taskId);

    // Log Undo Carry Over event
    if (taskBefore) {
      await db.insertTaskEvent({
        task_id: taskId,
        task_title: taskBefore.task,
        priority: taskBefore.quadrant,
        action_type: 'Undo Carry Over',
        timestamp: new Date().toISOString(),
        notes: null
      });
    }

    // 2. Clear any existing timers
    const t1 = reminderTimers.get(taskId);
    if (t1) {
      clearTimeout(t1);
      reminderTimers.delete(taskId);
    }
    const t2 = followupTimers.get(taskId);
    if (t2) {
      clearInterval(t2);
      followupTimers.delete(taskId);
    }

    // 3. Re-schedule using restored times (today)
    const rows = await db.getTodayTasks();
    const task = rows.find(t => t.id === taskId);
    if (task && task.status === 'pending') {
      console.log('↺ Rescheduling restored task:', taskId);
      scheduleReminder(task);
      scheduleFollowups(task);
    }

    return result;
  } catch (err) {
    console.error('❌ Error undoing carry-over:', err);
    throw err;
  }
});





// ⭐ PHASE 4: Undo completion
ipcMain.handle('tasks:undo-complete', async (event, taskId) => {
  try {
    const taskInfo = await db.getTaskById(taskId);
    if (!taskInfo) return { success: false, error: 'Task not found' };
    
    const remindTime = new Date(taskInfo.remindAt).getTime();
    const dueTime = new Date(taskInfo.dueAt).getTime();
    const now = Date.now();

    if (now > remindTime && now > dueTime) {
      const { dialog } = require('electron');
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        buttons: ['Update Time', 'Cancel'],
        title: 'Task Timing Finished',
        message: 'This task timing is finished (reminder and follow-up time is over).\nCan I open the edit window for this task so you can update the timing?'
      });
      
      if (choice === 0) { // Yes
        taskInfo.isReopen = true;
        if (editWindow && !editWindow.isDestroyed()) {
           editWindow.webContents.send('edit:data', taskInfo);
           editWindow.show();
           editWindow.focus();
        } else {
           editWindow = new BrowserWindow({
             width: 500, height: 485, icon: appIcon, resizable: true,
             webPreferences: { preload: path.join(__dirname, 'preload.js') }
           });
           editWindow.loadFile('edit.html');
           editWindow.webContents.on('did-finish-load', () => {
             if (!editWindow || editWindow.isDestroyed()) return;
             editWindow.webContents.send('edit:data', taskInfo);
           });
           editWindow.on('closed', () => { editWindow = null; });
        }
        return { success: true, message: 'Opened edit window' };
      } else {
        return { success: true, message: 'Action cancelled' };
      }
    }

    // Reopen task directly
    await db.reopenTask(taskId);
    await db.insertTaskEvent({
        task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
        action_type: 'Task Reopened', timestamp: new Date().toISOString(), notes: 'Undo via Task List'
    });
    
    const restored = await db.getTaskById(taskId);
    if (now <= remindTime) {
       scheduleReminder(restored);
       scheduleFollowups(restored);
    } else {
       const untilDue = dueTime - now;
       if (untilDue > 60000) {
         const preAlertTime = dueTime - 60000;
         const cancelObj = scheduleQueueEvent('prealert', restored, preAlertTime, 5);
         reminderTimers.set(taskId, cancelObj);
       }
       scheduleFollowups(restored);
    }
    
    notifyAnalyticsUpdate();
    return { success: true, message: 'Task reopened' };
  } catch(err) {
    console.error(err);
    return { success: false, error: err.message };
  }
});


// EDIT WINDOW SUPPORT
let editWindow = null;

ipcMain.handle('tasks:open-edit', async (event, task) => {
  console.log('Opening edit window for task:', task.id);

  if (editWindow && !editWindow.isDestroyed()) {
    editWindow.webContents.send('edit:data', task);
    editWindow.show();
    editWindow.focus();
    return;
  }

  editWindow = new BrowserWindow({
    width: 500,
    height: 485,
    icon: appIcon,
    
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  editWindow.loadFile('edit.html');

  editWindow.webContents.on('did-finish-load', () => {
    if (!editWindow || editWindow.isDestroyed()) return;
    editWindow.webContents.send('edit:data', task);
  });

  editWindow.on('closed', () => {
    editWindow = null;
  });
});

ipcMain.on('task:edit', async (event, taskData) => {
  try {
    console.log('✏️ Editing task:', taskData.id);

    // 0. Get old task data for comparison (follow-up frequency change detection)
    const oldTask = await db.getTaskById(taskData.id);
    const oldFreq = oldTask ? (oldTask.follow_up_frequency || 10) : 10;
    const newFreq = taskData.followUpFrequency || 10;

    // 1. Clear ALL old timers for this task
    const t1 = reminderTimers.get(taskData.id);
    if (t1) {
      clearTimeout(t1);
      reminderTimers.delete(taskData.id);
      console.log('⏰ Cleared old reminder for', taskData.id);
    }
    const t2 = followupTimers.get(taskData.id);
    if (t2) {
      clearInterval(t2);
      followupTimers.delete(taskData.id);
      console.log('🔄 Cleared old follow-up interval for', taskData.id);
    }

    // 2. Update DB fields (text, duration, quadrant, time, repeatDaily, followUpFrequency)
    await db.updateTask(taskData.id, {
      task: taskData.task,
      duration: taskData.duration,
      quadrant: taskData.quadrant,
      time: taskData.time,
      repeatDaily: taskData.repeatDaily !== undefined ? taskData.repeatDaily : 0,
      followUpFrequency: newFreq
    });

    // If isReopen is true, actually reopen the task!
    if (taskData.isReopen) {
      await db.reopenTask(taskData.id);
      await db.insertTaskEvent({
          task_id: taskData.id, task_title: taskData.task, priority: taskData.quadrant,
          action_type: 'Task Reopened', timestamp: new Date().toISOString(), notes: 'Via AI (Edit)'
      });
    }

    // Log Task Edited event
    await db.insertTaskEvent({
      task_id: taskData.id,
      task_title: taskData.task,
      priority: taskData.quadrant,
      action_type: 'Task Edited',
      timestamp: new Date().toISOString(),
      notes: null
    });

    // Log Follow-up Frequency Updated event if changed
    if (oldFreq !== newFreq) {
      await db.insertTaskEvent({
        task_id: taskData.id,
        task_title: taskData.task,
        priority: taskData.quadrant,
        action_type: 'Follow-up Frequency Updated',
        timestamp: new Date().toISOString(),
        notes: `Old: ${oldFreq} min → New: ${newFreq} min`
      });
      console.log(`📝 Follow-up frequency changed for task ${taskData.id}: ${oldFreq}m → ${newFreq}m`);
    }

    // 3. Recalculate dueAt & remindAt from NEW values
    const now = new Date();
    const [h, m] = taskData.time.split(':').map(Number);
    const due = new Date();

    if (taskData.date) {
      // User changed the date — use the new date
      const [year, month, day] = taskData.date.split('-').map(Number);
      due.setFullYear(year, month - 1, day);
    }
    due.setHours(h, m, 0, 0);
    // NOTE: Do NOT push to tomorrow on edit — task stays on its date even if time passed
    const remind = new Date(due.getTime() - taskData.duration * 60 * 1000);

    await db.updateTaskTimes(taskData.id, due.toISOString(), remind.toISOString());

    // 4. Schedule NEW timers only if reminder is in the future
    const remindDelay = remind.getTime() - Date.now();
    const taskForTimers = {
      id: taskData.id,
      task: taskData.task,
      dueAt: due.toISOString(),
      remindAt: remind.toISOString(),
      follow_up_frequency: newFreq
    };

    if (remindDelay > 0) {
      scheduleReminder(taskForTimers);
      scheduleFollowups(taskForTimers);
      console.log('✅ Task edited & rescheduled:', taskData.id);
    } else {
      console.log('⚠️ Edited reminder time already passed, not scheduling timers for', taskData.id);
    }
    
    notifyAnalyticsUpdate();
  } catch (err) {
    console.error('❌ Edit failed:', err);
  }
});








// AI Assistant IPC handler — real handler is registered inside app.whenReady()

// ADD THESE TWO right after tasks:complete handler
ipcMain.handle('settings:get', async (event, key) => {
  return await db.getSetting(key);
});

// 🔑 API KEY HANDLERS
ipcMain.handle('save-api-key', async (event, key) => {
  await saveApiKey(key);
  return true;
});

ipcMain.handle('get-api-key', async () => {
  return await getApiKey();
});

ipcMain.handle('delete-api-key', async () => {
  await deleteApiKey();
  return true;
});

ipcMain.handle('settings:set', async (event, key, value) => {
  await db.setSetting(key, value);
  return true;
});

// Theme handler — persists and broadcasts to all windows
ipcMain.handle('theme:set', async (event, theme) => {
  await db.setSetting('theme', theme);
  nativeTheme.themeSource = theme;
  // Broadcast to ALL windows
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send('theme:changed', theme);
    }
  }
  return true;
});


// ⭐ PHASE 3: Get today's tasks separated by carry-over
ipcMain.handle('task:getTodaySeparated', async () => {
  try {
    return await db.getTodayTasksSeparated();
  } catch (err) {
    console.error('Error getting separated tasks:', err);
    throw err;
  }
});

// CALENDAR: Get future tasks
ipcMain.handle('tasks:getFutureTasks', async () => {
  try {
    return await db.getAllFutureTasks();
  } catch (err) {
    console.error('Error getting future tasks:', err);
    throw err;
  }
});

// ⭐ PHASE 3: Get pending tasks at closing time
ipcMain.handle('task:getPendingAtClosing', async () => {
  try {
    return await db.getPendingTasksAtClosing();
  } catch (err) {
    console.error('Error getting pending tasks:', err);
    throw err;
  }
});

// ⭐ PHASE 3: Carry over a task to tomorrow
ipcMain.handle('task:carryOver', async (event, taskId, newDueAt, newRemindAt, newCount, carryOverType = 'fixed') => {
  try {
    console.log('🔄 task:carryOver received:', { taskId, carryOverType });

    // Get task info for event logging
    const taskBefore = await db.getTaskById(taskId);

    // Clear old timers
    const t1 = reminderTimers.get(taskId);
    if (t1) {
      clearTimeout(t1);
      reminderTimers.delete(taskId);
    }
    const t2 = followupTimers.get(taskId);
    if (t2) {
      clearInterval(t2);
      followupTimers.delete(taskId);
    }

    // Call DB with 5 parameters (including carryOverType)
    const result = await db.carryOverTask(taskId, newDueAt, newRemindAt, newCount, carryOverType);

    if (carryOverType === 'fixed') {
      const updatedTask = await db.getTaskById(taskId);
      if (updatedTask) {
        scheduleReminder(updatedTask);
        scheduleFollowups(updatedTask);
      }
    }

    // Log Carry Over Selected event
    if (taskBefore) {
      await db.insertTaskEvent({
        task_id: taskId,
        task_title: taskBefore.task,
        priority: taskBefore.quadrant,
        action_type: 'Carry Over Selected',
        timestamp: new Date().toISOString(),
        notes: `Type: ${carryOverType}`
      });
      notifyAnalyticsUpdate();
    }

    console.log('✅ Task carried over to tomorrow, id:', taskId, 'type:', carryOverType);
    return result;
  } catch (err) {
    console.error('❌ Error carrying over task:', err);
    throw err;
  }
});


// ⭐ PHASE 3: Get today's performance report
ipcMain.handle('task:getPerformanceReport', async () => {
  try {
    return await db.getTodayPerformanceReport();
  } catch (err) {
    console.error('Error getting performance report:', err);
    throw err;
  }
});




async function completeTaskAndClearTimers(taskId) {
  await db.markTaskCompleted(taskId);

  // ⭐ PHASE 3: Add completed timestamp
  //const completedAt = new Date().toISOString();
  //const sql = `UPDATE tasks SET completedAt = ? WHERE id = ?`;
  // This is optional, but helps track when task was completed
  const t1 = reminderTimers.get(taskId);
  if (t1) {
    clearTimeout(t1);
    reminderTimers.delete(taskId);
  }

  const t2 = followupTimers.get(taskId);
  if (t2) {
    clearInterval(t2);
    followupTimers.delete(taskId);
  }

  console.log('Task completed via follow-up, timers cleared for', taskId);
}

ipcMain.on('followup:action', async (event, { taskId, action, carryOverData }) => {
  // Get task info for event logging
  const taskInfo = await db.getTaskById(taskId);

  if (action === 'yes') {
    await completeTaskAndClearTimers(taskId);

    // Log Marked Completed event via follow-up
    if (taskInfo) {
      await db.insertTaskEvent({
        task_id: taskId,
        task_title: taskInfo.task,
        priority: taskInfo.quadrant,
        action_type: 'Marked Completed',
        timestamp: new Date().toISOString(),
        notes: 'Completed via follow-up'
      });
    }

  } else if (action === 'no') {
    console.log('User clicked No in Windows popup for task', taskId);

    // Log Marked Not Completed event
    if (taskInfo) {
      await db.insertTaskEvent({
        task_id: taskId,
        task_title: taskInfo.task,
        priority: taskInfo.quadrant,
        action_type: 'Marked Not Completed',
        timestamp: new Date().toISOString(),
        notes: 'Via follow-up'
      });
    }

  } else if (action === 'snooze') {
    console.log('User snoozed task on Windows:', taskId);

    // Log Snoozed event
    if (taskInfo) {
      await db.insertTaskEvent({
        task_id: taskId,
        task_title: taskInfo.task,
        priority: taskInfo.quadrant,
        action_type: 'Snoozed',
        timestamp: new Date().toISOString(),
        notes: 'Snoozed for 30 minutes'
      });
    }

    const t2 = followupTimers.get(taskId);
    if (t2) {
      clearInterval(t2);
      followupTimers.delete(taskId);
    }

    // restart follow-ups after 30 minutes if still pending
    setTimeout(async () => {
      const rows = await db.getTodayTasks();
      const task = rows.find(t => t.id === taskId);
      if (task && task.status === 'pending') {
        console.log('Windows snooze finished, restarting follow-ups for', taskId);
        scheduleFollowups(task);
      }
    }, 30 * 60 * 1000);

  }
});

ipcMain.on('prealert:action', async (event, { taskId, action }) => {
  if (action === 'ok') {
    console.log('User acknowledged Pre-Alert for task', taskId);
  }
});

// Reuse one carry-over window so it opens instantly (no 1–2 s load each time)
let carryoverWindow = null;

function getOrCreateCarryoverWindow() {
  if (carryoverWindow && !carryoverWindow.isDestroyed()) {
    return carryoverWindow;
  }
  const display = screen.getPrimaryDisplay();
  const w = 320;
  const h = 180;
  carryoverWindow = new BrowserWindow({
    width: w,
    height: h,
    icon: appIcon,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    backgroundColor: '#0a0a0a',
    x: display.workArea.x + display.workArea.width - w - 20,
    y: display.workArea.y + display.workArea.height - h - 20,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  carryoverWindow.loadFile('carryover.html');
  carryoverWindow.on('closed', () => { carryoverWindow = null; });
  return carryoverWindow;
}

ipcMain.on('carryover:open-window', (event, task) => {
  followupWindowRef = BrowserWindow.fromWebContents(event.sender);
  const win = getOrCreateCarryoverWindow();
  const showAndFocus = () => {
    win.webContents.send('carryover:data', task);
    win.show();
    win.focus();
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', showAndFocus);
  } else {
    showAndFocus();
  }
});

// User chose one of the two options in the carry-over window
ipcMain.on('carryover:choose', async (event, { taskId, carryOverType }) => {
  try {
    const task = await db.getTaskById(taskId);
    if (!task) {
      console.error('Carry-over: task not found', taskId);
      return;
    }
    const durationMs = (task.duration || 15) * 60 * 1000;
    let newDueAt, newRemindAt;
    if (carryOverType === 'fixed') {
      const tomorrow = new Date(task.dueAt);
      tomorrow.setDate(tomorrow.getDate() + 1);
      newDueAt = tomorrow.toISOString();
      newRemindAt = new Date(tomorrow.getTime() - durationMs).toISOString();
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      newDueAt = tomorrow.toISOString();
      newRemindAt = new Date(tomorrow.getTime() - durationMs).toISOString();
    }
    const carryOverCount = (task.carryOverCount || 0) + 1;

    const t1 = reminderTimers.get(taskId);
    if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
    const t2 = followupTimers.get(taskId);
    if (t2) { clearInterval(t2); followupTimers.delete(taskId); }

    await db.carryOverTask(taskId, newDueAt, newRemindAt, carryOverCount, carryOverType);

    if (carryOverType === 'fixed') {
      const updatedTask = await db.getTaskById(taskId);
      if (updatedTask) {
        scheduleReminder(updatedTask);
        scheduleFollowups(updatedTask);
      }
    }

    // Log Carry Over Selected event (via carry-over window)
    await db.insertTaskEvent({
      task_id: taskId,
      task_title: task.task,
      priority: task.quadrant,
      action_type: 'Carry Over Selected',
      timestamp: new Date().toISOString(),
      notes: `Type: ${carryOverType} (via carry-over window)`
    });

    console.log('✅ Task carried over:', taskId, carryOverType);

    const carryoverWin = BrowserWindow.fromWebContents(event.sender);
    if (carryoverWin && !carryoverWin.isDestroyed()) carryoverWin.hide();
    if (followupWindowRef && !followupWindowRef.isDestroyed()) followupWindowRef.close();
    followupWindowRef = null;
  } catch (err) {
    console.error('❌ carryover:choose error:', err);
  }
});




function createWindow() {
  mainWindow = new BrowserWindow({
    width: 650,
    height: 470,
    icon: appIcon,
    resizable: true,
    
    show: false, // 🔥 ADD THIS (VERY IMPORTANT)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide(); // 🔥 hide instead of close
    checkIfShouldQuit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}


let homeWindow = null;

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.show();
    homeWindow.focus();
    return;
  }

  homeWindow = new BrowserWindow({
    width: 900,
    height: 620,
    icon: appIcon,
    resizable: true,
    title: "Orb — Home",
    show: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  homeWindow.loadFile('home.html');

  homeWindow.once('ready-to-show', () => {
    homeWindow.show();
    homeWindow.focus();
  });

  homeWindow.on('closed', () => {
    homeWindow = null;
    checkIfShouldQuit();
  });
}

// 🔁 On startup: reset repeat-daily tasks for today
async function rescheduleRepeatDailyTasks() {
  try {
    const repeatTasks = await db.getRepeatDailyTasks();
    if (repeatTasks.length === 0) {
      console.log('✅ No repeat-daily tasks to reschedule');
      return;
    }

    console.log(`🔁 Found ${repeatTasks.length} repeat-daily task(s), checking...`);

    const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    for (const task of repeatTasks) {
      const taskDueDate = new Date(task.dueAt).toISOString().slice(0, 10);

      if (taskDueDate < todayStr) {
        // Task's dueAt is in the past — reset it for today
        console.log(`🔁 Resetting repeat task ${task.id} (${task.task}) for today`);
        await db.resetRepeatTaskForToday(task.id, task.time, task.duration);

        // Re-fetch the updated task and schedule reminders
        const updated = await db.getTaskById(task.id);
        if (updated && updated.status === 'pending') {
          recoverTaskPersistence(updated);
          console.log(`✅ Scheduled reminders for repeat task ${task.id} via Recovery`);
        }
      } else if (taskDueDate === todayStr && task.status === 'pending') {
        // Already set for today and pending — use recovery logic
        recoverTaskPersistence(task);
        console.log(`✅ Repeat task ${task.id} already set for today, scheduling via Recovery`);
      } else {
        console.log(`ℹ️ Repeat task ${task.id} — dueAt is today but status is ${task.status}, skipping`);
      }
    }
  } catch (err) {
    console.error('❌ Error rescheduling repeat-daily tasks:', err);
  }
}

// ⭐ AUTO CARRY-OVER ON STARTUP: Find previous day's incomplete tasks and carry them over
async function autoCarryOverOnStartup() {
  try {
    const previousDayPending = await db.getPreviousDayPendingTasks();

    if (previousDayPending.length === 0) {
      console.log('✅ No previous-day incomplete tasks to auto carry over');
      return;
    }

    console.log(`🔄 Found ${previousDayPending.length} previous-day incomplete task(s), auto-carrying over...`);

    for (const task of previousDayPending) {
      // Clear any existing timers
      const t1 = reminderTimers.get(task.id);
      if (t1) { clearTimeout(t1); reminderTimers.delete(task.id); }
      const t2 = followupTimers.get(task.id);
      if (t2) { clearInterval(t2); followupTimers.delete(task.id); }

      // Carry over with 'dynamic' type
      const durationMs = (task.duration || 10) * 60 * 1000;
      const today = new Date();
      today.setHours(8, 0, 0, 0);
      const newDueAt = today.toISOString();
      const newRemindAt = new Date(today.getTime() - durationMs).toISOString();
      const carryOverCount = (task.carryOverCount || 0) + 1;

      await db.carryOverTask(task.id, newDueAt, newRemindAt, carryOverCount, 'dynamic');

      // Log auto carry-over event
      await db.insertTaskEvent({
        task_id: task.id,
        task_title: task.task,
        priority: task.quadrant,
        action_type: 'Auto Carry Over',
        timestamp: new Date().toISOString(),
        notes: 'Auto carry-over on startup (dynamic)'
      });

      console.log(`✅ Auto-carried over on startup: ${task.id} - ${task.task}`);
    }
  } catch (err) {
    console.error('❌ Error auto-carrying over on startup:', err);
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (homeWindow) {
      if (homeWindow.isMinimized()) homeWindow.restore();
      homeWindow.show();
      homeWindow.focus();
    } else {
      createHomeWindow();
    }
  });

  app.whenReady().then(async () => {
  const isAutoStartInit = process.argv.includes('--autostart');
  if (!isAutoStartInit) {
    // Show window instantly while background tasks load
    createHomeWindow();
  }

  app.setAppUserModelId("com.orb.app");
  Menu.setApplicationMenu(null);
  createWindow();

  mainWindow.hide(); // keep hidden on startup — app runs in background
  await dbModule.initDB();

  const savedTheme = await db.getSetting('theme');
  nativeTheme.themeSource = savedTheme || 'dark';

  // Apply auto-start login setting based on saved user preference
  const autoStartSetting = await db.getSetting('autoStartEnabled');
  // Default to enabled ('true') if setting has never been set
  const autoStartEnabled = autoStartSetting !== 'false';
  globalAutoStartEnabled = autoStartEnabled;
  
  app.setLoginItemSettings({
    openAtLogin: autoStartEnabled,
    args: ['--autostart']
  });

  await autoCarryOverOnStartup();
  await rescheduleCarriedOverTasks();
  await rescheduleRepeatDailyTasks();
  await scheduleTodayPendingTasks();

  // 🎙️ VOICE: Global shortcut to activate voice agent
  globalShortcut.register('CommandOrControl+Shift+V', () => {
    // Re-use the existing orb voice activation logic
    ipcMain.emit('orb:voice-activate');
  });

  // Phase 1: Initialize VoiceController with appAdapter
  const appAdapter = {
    openWindow: async (name) => {
      let resultMessage = [];
      let successCount = 0;
      const lower = (name || '').toLowerCase().trim();

      // ── "all" / "everything" — open all windows EXCEPT edit, skip already-open ──
      if (lower === 'all' || lower === 'everything' || lower.startsWith('all_except') || lower === 'unopened' || lower === 'closed') {
        const states = getWindowStates();
        const windowList = [
          { key: 'ai', winName: 'ai', label: 'AI Chat' },
          { key: 'list', winName: 'list', label: 'Task List' },
          { key: 'task', winName: 'creation', label: 'Task Creation' },
          { key: 'calendar', winName: 'calendar', label: 'Calendar' },
          { key: 'history', winName: 'report', label: 'History & Report' },
          { key: 'home', winName: 'home', label: 'Home' }
        ];
        // Parse "all_except_X" exclusions
        const exclusions = [];
        const exceptMatch = lower.match(/all_except_(\w+)/);
        if (exceptMatch) exclusions.push(exceptMatch[1]);

        const alreadyOpen = [];
        const opened = [];

        for (const win of windowList) {
          // Skip excluded windows
          if (exclusions.includes(win.key) || exclusions.includes(win.winName)) continue;
          
          // Skip already-open windows
          if (states[win.key]) {
            alreadyOpen.push(win.label);
            continue;
          }
          
          // Open the window
          const res = await handleAIIntent({ intent: 'OPEN_WINDOW', window: win.winName }, win.winName);
          if (res && res.success) { successCount++; opened.push(win.label); }
        }

        // Build natural message
        if (opened.length > 0) resultMessage.push(`Opened ${opened.join(', ')}.`);
        if (alreadyOpen.length > 0) resultMessage.push(`${alreadyOpen.join(', ')} ${alreadyOpen.length === 1 ? 'was' : 'were'} already open.`);
        if (opened.length === 0 && alreadyOpen.length > 0) resultMessage.unshift('All windows are already open.');
        
        return { success: successCount > 0 || alreadyOpen.length > 0, message: resultMessage.join(' ') || "No windows to open." };
      }

      // ── Single / multiple named windows ──
      const names = (name || '').split(/,|\band\b/i).map(n => n.trim()).filter(n => n);
      for (const n of names) {
        let winName = null;
        const nLower = n.toLowerCase();
        if (nLower.includes('calendar') || nLower.includes('calender')) winName = 'calendar';
        else if (nLower.includes('ai')) winName = 'ai';
        else if (nLower.includes('create') || nLower.includes('creation') || nLower === 'task' || nLower === 'tasks' || nLower.includes('main')) winName = 'creation';
        else if (nLower.includes('list') || nLower.includes('today')) winName = 'list';
        else if (nLower.includes('report') || nLower.includes('history') || nLower.includes('analytic')) winName = 'report';
        else if (nLower.includes('home') || nLower.includes('dashboard')) winName = 'home';
        else if (nLower.includes('edit')) winName = 'edit';
        else winName = nLower;

        // Check if already open and report it
        const states = getWindowStates();
        const stateKey = { 'ai': 'ai', 'list': 'list', 'creation': 'task', 'calendar': 'calendar', 'report': 'history', 'history': 'history', 'home': 'home' }[winName];
        if (stateKey && states[stateKey]) {
          resultMessage.push(`The ${winName} window is already open.`);
          successCount++;
          continue;
        }

        const res = await handleAIIntent({ intent: 'OPEN_WINDOW', window: winName }, n);
        if (res && res.success) { successCount++; resultMessage.push(res.message); }
        else if (res && res.error) { resultMessage.push(res.error); }
      }
      return { success: successCount > 0, message: resultMessage.join(' ') || "No windows matched." };
    },
    closeWindow: async (name) => {
      let resultMessage = [];
      let successCount = 0;
      const names = (name || '').split(/,|\band\b/i).map(n => n.trim()).filter(n => n);
      for (const n of names) {
        let winName = null;
        const lower = n.toLowerCase();
        if (lower.includes('all') || lower.includes('everything')) winName = 'all';
        else if (lower.includes('calendar') || lower.includes('calender')) winName = 'calendar';
        else if (lower.includes('ai')) winName = 'ai';
        else if (lower.includes('create') || lower.includes('creation') || lower === 'task' || lower === 'tasks' || lower.includes('main')) winName = 'creation';
        else if (lower.includes('list') || lower.includes('today')) winName = 'list';
        else if (lower.includes('report') || lower.includes('history') || lower.includes('analytic')) winName = 'report';
        else if (lower.includes('edit')) winName = 'edit';
        else winName = lower;
        const res = await handleAIIntent({ intent: 'CLOSE_WINDOW', window: winName }, n);
        if (res && res.success) { successCount++; resultMessage.push(res.message); }
        else if (res && res.error) { resultMessage.push(res.error); }
      }
      return { success: successCount > 0, message: resultMessage.join(' ') || "No windows matched." };
    },
    createTask: async (data) => {
      return await executeCreateTask(data);
    },
    deleteTask: async (title, options = {}) => {
      return await resolveTaskAction('DELETE_TASK', title, { forceExecution: options.forceExecution });
    },
    completeTask: async (title, options = {}) => {
      if (options.optionKey === 'reopen') {
        return await resolveTaskAction('REOPEN_TASK', title, { forceExecution: true });
      } else if (options.optionKey === 'cancel') {
        return { success: true, message: 'Action cancelled.' };
      }
      return await resolveTaskAction('COMPLETE_TASK', title, { forceExecution: options.forceExecution });
    },
    editTask: async (title, newFields, options = {}) => {
      if (options.optionKey) {
        return await resolveTaskAction('EDIT_TASK', title, { fields: newFields, optionKey: options.optionKey, forceExecution: true });
      }
      return await resolveTaskAction('EDIT_TASK', title, { fields: newFields, forceExecution: options?.forceExecution });
    },
    carryOverTask: async (title, carryType, options = {}) => {
      if (options.optionKey === 'fixed' || options.optionKey === 'dynamic') {
        return await resolveTaskAction('CARRY_OVER_TASK', title, { carryType: options.optionKey, forceExecution: true });
      } else if (options.optionKey === 'cancel') {
        return { success: true, message: 'Action cancelled.' };
      }
      return await resolveTaskAction('CARRY_OVER_TASK', title, { carryType, forceExecution: options?.forceExecution });
    },
    undoCarryOverTask: async (title, options = {}) => {
      return await resolveTaskAction('UNDO_CARRY_OVER', title, { forceExecution: options?.forceExecution });
    },
    updateTask: async (data, options = {}) => {
      return await resolveTaskAction('UPDATE_TASK', data.title, { ...data, forceExecution: options.forceExecution });
    },
    queryTasks: async (queryType) => {
      try {
        if (queryType === 'history') {
           const history = await db.getHistoryEvents({});
           return { success: true, data: history.slice(0, 50) }; // return top 50
        } else if (queryType === 'today_summary') {
           const separated = await db.getTodayTasksSeparated();
           const report = await db.getTodayPerformanceReport();
           return { success: true, data: { tasks: separated, performance: report } };
        } else if (queryType === 'completed') {
           const report = await db.getTodayPerformanceReport();
           return { success: true, data: report.completed };
        } else {
           // default to pending
           const separated = await db.getTodayTasksSeparated();
           const pending = [...(separated.todayTasks || []), ...(separated.carryOvers || [])].filter(t => t.status === 'pending');
           return { success: true, data: pending };
        }
      } catch (err) {
        console.error('[appAdapter.queryTasks] Error:', err);
        return { error: 'Failed to query tasks.' };
      }
    },
    getTodayTasks: async () => {
      const separated = await db.getTodayTasksSeparated();
      return [...(separated.todayTasks || []), ...(separated.carryOvers || [])];
    },

    // ── NEW: Get live window visibility states ──
    getWindowStates: async () => {
      return getWindowStates();
    },

    // ── NEW: Undo a completed task (reopen it) ──
    undoCompleteTask: async (title, options = {}) => {
      // Find the task — search completed tasks specifically
      const separated = await db.getTodayTasksSeparated();
      const allTasks = [...(separated.todayTasks || []), ...(separated.carryOvers || [])];
      const search = title.toLowerCase().trim();
      const matches = allTasks.filter(t => t.task.toLowerCase().includes(search));

      if (matches.length === 0) {
        return { error: `No task found matching "${title}".` };
      }

      if (matches.length > 1 && !options.taskId) {
        return {
          needsDisambiguation: true,
          matches: matches.map((m, i) => ({ index: i + 1, id: m.id, title: m.task, quadrant: m.quadrant, status: m.status })),
          message: `Multiple tasks found matching "${title}". Which one?\n\n${matches.map((m, i) => `${i + 1}. ${m.task} (${m.status})`).join('\n')}\n\nReply with the number.`
        };
      }

      const task = options.taskId ? matches.find(m => m.id === options.taskId) || matches[0] : matches[0];

      if (task.status !== 'completed') {
        return { error: `Task "${task.task}" is not completed — it's currently ${task.status}.` };
      }

      // Reopen the task
      return await resolveTaskAction('COMPLETE_TASK', task.task, { forceExecution: options.forceExecution, taskId: task.id });
    },

    // ── NEW: Query future tasks ──
    queryFutureTasks: async (timeRange) => {
      try {
        const futureTasks = await db.getAllFutureTasks();
        const now = new Date();
        const lower = (timeRange || 'all').toLowerCase();
        let filtered = futureTasks;

        if (lower.includes('tomorrow')) {
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().slice(0, 10);
          filtered = futureTasks.filter(t => t.dueAt && t.dueAt.slice(0, 10) === tomorrowStr);
        } else if (lower.includes('next week') || lower.includes('this week')) {
          const endOfWeek = new Date(now);
          endOfWeek.setDate(endOfWeek.getDate() + 7);
          filtered = futureTasks.filter(t => {
            const d = new Date(t.dueAt);
            return d >= now && d <= endOfWeek;
          });
        } else if (lower.includes('next month') || lower.includes('this month')) {
          const endOfMonth = new Date(now);
          endOfMonth.setDate(endOfMonth.getDate() + 30);
          filtered = futureTasks.filter(t => {
            const d = new Date(t.dueAt);
            return d >= now && d <= endOfMonth;
          });
        }
        // If it mentions a specific day name, try to filter
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        for (let i = 0; i < dayNames.length; i++) {
          if (lower.includes(dayNames[i])) {
            const today = now.getDay();
            let diff = i - today;
            if (diff <= 0) diff += 7;
            const targetDate = new Date(now);
            targetDate.setDate(targetDate.getDate() + diff);
            const targetStr = targetDate.toISOString().slice(0, 10);
            filtered = futureTasks.filter(t => t.dueAt && t.dueAt.slice(0, 10) === targetStr);
            break;
          }
        }

        return { success: true, data: { tasks: filtered.slice(0, 30), timeRange, totalCount: filtered.length } };
      } catch (err) {
        console.error('[appAdapter.queryFutureTasks] Error:', err);
        return { error: 'Failed to query future tasks.' };
      }
    },

    // ── NEW: Query past analysis data ──
    queryPastAnalysis: async (analysisType) => {
      try {
        const lower = (analysisType || 'overall').toLowerCase();
        let mode = 'date'; // default
        if (lower.includes('week') || lower.includes('weekly')) mode = 'week';
        else if (lower.includes('month') || lower.includes('monthly')) mode = 'month';

        const analytics = await db.getAnalyticsData(mode);
        const todayReport = await db.getTodayPerformanceReport();
        const carryOverTrend = await db.getCarryOverTrend();
        const recentHistory = await db.getHistoryEvents({});

        return {
          success: true,
          data: {
            analytics,
            todayReport,
            carryOverTrend,
            recentHistory: recentHistory.slice(0, 30),
            analysisType: lower,
            mode
          }
        };
      } catch (err) {
        console.error('[appAdapter.queryPastAnalysis] Error:', err);
        return { error: 'Failed to get analysis data.' };
      }
    },

    // ── NEW: Get free time slots for today/tomorrow ──
    getFreeTimeSlots: async (timeRange) => {
      try {
        const lower = (timeRange || 'today').toLowerCase();
        let tasks;

        if (lower.includes('tomorrow')) {
          const allFuture = await db.getAllFutureTasks();
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = tomorrow.toISOString().slice(0, 10);
          tasks = allFuture.filter(t => t.dueAt && t.dueAt.slice(0, 10) === tomorrowStr);
        } else {
          const separated = await db.getTodayTasksSeparated();
          tasks = [...(separated.todayTasks || []), ...(separated.carryOvers || [])];
        }

        // Build busy blocks from tasks
        const busyBlocks = tasks
          .filter(t => t.dueAt && (t.status === 'pending' || t.status === 'carried_over'))
          .map(t => {
            const dueTime = new Date(t.dueAt);
            const duration = (t.duration || 10) * 60000;
            const startTime = new Date(dueTime.getTime() - duration);
            return {
              task: t.task,
              start: startTime,
              end: dueTime,
              quadrant: t.quadrant
            };
          })
          .sort((a, b) => a.start - b.start);

        // Calculate free blocks (between 8 AM and 11 PM)
        const now = new Date();
        const dayStart = new Date(now);
        if (lower.includes('tomorrow')) {
          dayStart.setDate(dayStart.getDate() + 1);
        }
        dayStart.setHours(8, 0, 0, 0);
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 0, 0, 0);

        const freeSlots = [];
        let cursor = Math.max(dayStart.getTime(), now.getTime());

        for (const block of busyBlocks) {
          if (block.start.getTime() > cursor) {
            freeSlots.push({
              start: new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              end: block.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              durationMinutes: Math.round((block.start.getTime() - cursor) / 60000)
            });
          }
          cursor = Math.max(cursor, block.end.getTime());
        }
        // Remaining free time after last task
        if (cursor < dayEnd.getTime()) {
          freeSlots.push({
            start: new Date(cursor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            end: dayEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
            durationMinutes: Math.round((dayEnd.getTime() - cursor) / 60000)
          });
        }

        return {
          success: true,
          data: {
            freeSlots,
            busyBlocks: busyBlocks.map(b => ({
              task: b.task,
              start: b.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              end: b.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
              quadrant: b.quadrant
            })),
            totalFreeMinutes: freeSlots.reduce((sum, s) => sum + s.durationMinutes, 0),
            totalBusyTasks: busyBlocks.length,
            timeRange: lower
          }
        };
      } catch (err) {
        console.error('[appAdapter.getFreeTimeSlots] Error:', err);
        return { error: 'Failed to calculate free time.' };
      }
    },

    // ── NEW: Update Application Settings ──
    updateSetting: async (key, value) => {
      try {
        const strValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
        await db.setSetting(key, strValue);
        
        // Handle side-effects
        if (key === 'theme') {
          // Notify all windows
          const windows = [homeWindow, mainWindow, listWindow, calendarWindow, historyReportWindow, aiWindow, settingsWindow];
          windows.forEach(w => {
            if (w && !w.isDestroyed()) {
              w.webContents.send('settings:changed', { key: 'theme', value });
            }
          });
        } else if (key === 'autoStartEnabled') {
          const isEnabled = strValue === 'true';
          app.setLoginItemSettings({ openAtLogin: isEnabled, args: ['--autostart'] });
          console.log(`🚀 AI updated Auto-start to ${isEnabled ? 'enabled' : 'disabled'}`);
        } else if (key === 'floatingOrbEnabled') {
          const isEnabled = strValue === 'true';
          if (isEnabled) {
            // Can't directly call createOrbWindow here if it's out of scope or we just trigger IPC
            // But createOrbWindow is in scope of main.js
            if (typeof createOrbWindow === 'function') createOrbWindow();
            if (typeof createOrbPanelWindow === 'function') createOrbPanelWindow();
          } else {
            if (orbPanelWindow && !orbPanelWindow.isDestroyed()) { orbPanelWindow.close(); orbPanelWindow = null; }
            if (orbWindow && !orbWindow.isDestroyed()) { orbWindow.close(); orbWindow = null; }
          }
        }
        
        return { success: true };
      } catch (err) {
        console.error('[appAdapter.updateSetting] Error:', err);
        return { error: 'Failed to update setting.' };
      }
    },

    // ── NEW: Filter UI View ──
    filterUI: async (filterType) => {
      // Ensure the window is open
      if (!listWindow || listWindow.isDestroyed()) {
        const states = getWindowStates();
        const display = screen.getPrimaryDisplay();
        const w = 400; const h = 600;
        const targetX = display.workArea.x + 20;
        const targetY = display.workArea.y + Math.floor((display.workArea.height - h) / 2);
        createListWindow(targetX, targetY);
      } else {
        if (!listWindow.isVisible()) listWindow.show();
        if (listWindow.isMinimized()) listWindow.restore();
        listWindow.focus();
      }
      
      // Give the window a moment to load if it was just created, then send the filter
      setTimeout(() => {
        if (listWindow && !listWindow.isDestroyed()) {
          listWindow.webContents.send('voice:filter-list', filterType);
        }
      }, 500);
      
      return { success: true };
    },

    // ── NEW: Handle Active Notification ──
    handleActiveNotification: async (action) => {
      if (!activeNotification) {
        return { success: false, error: 'No active notification to handle right now.' };
      }
      
      const { type, taskId, windowRef } = activeNotification;
      let finalMessage = '';
      
      if (type === 'prealert') {
        // Pre-alerts only have 'ok' (dismiss)
        ipcMain.emit('prealert:action', {}, { taskId, action: 'ok' });
        finalMessage = 'Pre-alert dismissed.';
      } else if (type === 'followup') {
        let act = 'snooze';
        if (action.includes('complete') || action.includes('yes') || action.includes('done')) act = 'yes';
        else if (action.includes('no') || action.includes('not done')) act = 'no';
        
        ipcMain.emit('followup:action', {}, { taskId, action: act, carryOverData: null });
        finalMessage = act === 'yes' ? 'Task marked complete.' : (act === 'no' ? 'Task marked as not completed.' : 'Task snoozed for 30 minutes.');
      }
      
      if (windowRef && !windowRef.isDestroyed()) {
        windowRef.close();
      }
      activeNotification = null;
      
      return { success: true, message: finalMessage };
    },

    getActiveNotification: () => activeNotification,

    // ── NEW: Stop the voice assistant ──
    stopVoice: async () => {
      voiceConversationActive = false;
      notifyOrb('voice:stop');
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:force-stop');
      }
    }
  };

  VoiceController.init(appAdapter);

  // Detect launch mode: system auto-start uses --autostart flag
  const isAutoStart = process.argv.includes('--autostart');

  if (isAutoStart && autoStartEnabled) {
    // Auto-start at login: run in background, do NOT open home page
    // Show background notification + orb only
    _showMessagePopup(
      "Orb is running in the background.",
      "",
      8000,
      () => {} // empty resolve function
    );
  } else {
    // Also show background notification
    _showMessagePopup(
      "Orb is running in the background.",
      "",
      8000,
      () => {} // empty resolve function
    );
  }


  // Pre-create carry-over window so first "Carry Over" click opens instantly
  getOrCreateCarryoverWindow();

  // ✅ Tray Icon Path (works in dev + build)
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'build/icon.ico')
  : path.join(__dirname, 'build/icon.ico');

tray = new Tray(iconPath);

// ✅ Tray Menu
const contextMenu = Menu.buildFromTemplate([
  {
    label: 'Open Home / Settings',
    click: () => {
      createHomeWindow();
    }
  },
  {
    label: 'Open Task Window',
    click: () => {
      if (mainWindow) mainWindow.show();
    }
  },
  {
    label: 'Open Task List',
    click: () => {
      openListWindow();
    }
  },
  {
    label: 'Open History',
    click: () => {
      openHistoryReportWindow();
    }
  },
  {
    label: 'Open AI Assistant',
    click: () => {
      openAIWindow();
    }
  },
  {
    label: 'Open Calendar',
    click: () => {
      openCalendarWindow();
    }
  },
  { type: 'separator' },
  {
    label: 'Exit Orb',
    click: () => app.quit()
  }
]);

// ✅ Tooltip (app name)
tray.setToolTip('Orb');

// ✅ Attach menu
tray.setContextMenu(contextMenu);

// ✅ Click tray → open main window
tray.on('click', () => {
  if (mainWindow) mainWindow.show();
});

  let listWindow = null;

  function openListWindow() {
    if (listWindow && !listWindow.isDestroyed()) {
      if (listWindow.isVisible()) {
        listWindow.hide();        // Hide if visible (toggle)
      } else {
        listWindow.show();        // Show if hidden
        listWindow.focus();
      }
      return;
    }

    listWindow = new BrowserWindow({
      width: 500,
      height: 500,
      icon: appIcon,
      resizable: true,
      title: "Task List",
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),

      },
    });




    listWindow.loadFile('tasks.html');

    listWindow.on('closed', () => {
      listWindow = null;
    });
  }

  const okList = globalShortcut.register('Control+Shift+L', () => {
    openListWindow();
  });

  // ===== CALENDAR WINDOW =====
  let calendarWindow = null;

  function openCalendarWindow() {
    if (calendarWindow && !calendarWindow.isDestroyed()) {
      if (calendarWindow.isVisible()) {
        calendarWindow.hide();
      } else {
        calendarWindow.show();
        calendarWindow.focus();
      }
      return;
    }

    calendarWindow = new BrowserWindow({
      width: 800,
      height: 600,
      icon: appIcon,
      resizable: true,
      title: 'Calendar',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    calendarWindow.loadFile('calendar.html');

    calendarWindow.on('closed', () => {
      calendarWindow = null;
    });
  }

  globalShortcut.register('Control+Shift+C', () => {
    openCalendarWindow();
  });



  // ===== HISTORY REPORT WINDOW =====
  let historyReportWindow = null;

  function openHistoryReportWindow() {
    if (historyReportWindow && !historyReportWindow.isDestroyed()) {
      if (historyReportWindow.isVisible()) {
        historyReportWindow.hide();
      } else {
        historyReportWindow.show();
        historyReportWindow.focus();
      }
      return;
    }

    historyReportWindow = new BrowserWindow({
      width: 720,
      height: 600,
      icon: appIcon,
      resizable: true,
      title: 'History & Report',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    historyReportWindow.loadFile('historyreport.html');

    historyReportWindow.on('closed', () => {
      historyReportWindow = null;
    });
  }

  globalShortcut.register('Control+Shift+H', () => {
    openHistoryReportWindow();
  });

  // ===== AI ASSISTANT WINDOW =====
  let aiWindow = null;

  function openAIWindow() {
    if (aiWindow && !aiWindow.isDestroyed()) {
      if (aiWindow.isVisible()) {
        aiWindow.hide();
      } else {

        aiWindow.show();
        aiWindow.focus();
      }
      return;
    }

    aiWindow = new BrowserWindow({
      width: 550,
      height: 520,
      icon: appIcon,
      resizable: true,
      title: 'AI Assistant',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    aiWindow.loadFile('ai.html');

    aiWindow.on('closed', () => {
      aiWindow = null;
    });
  }

  globalShortcut.register('Control+Shift+A', () => {
    openAIWindow();
  });

  // ===== FLOATING ORB WINDOWS =====
  function createOrbWindow() {
    if (orbWindow && !orbWindow.isDestroyed()) return;

    orbWindow = new BrowserWindow({
      width: 60,
      height: 60,
      icon: appIcon,
      transparent: true,
      frame: false,
      thickFrame: false,  // removes invisible Windows DWM border
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js')
      }
    });

    orbWindow.loadFile('floatingorb.html');
    
    // Default position (bottom right)
    const display = screen.getPrimaryDisplay();
    const startX = display.workArea.x + display.workArea.width - 100;
    const startY = display.workArea.y + display.workArea.height - 100;
    orbWindow.setPosition(startX, startY);
    orbPos = { x: startX, y: startY };

    orbWindow.on('closed', () => {
      orbWindow = null;
    });
  }

  function createOrbPanelWindow() {
    if (orbPanelWindow && !orbPanelWindow.isDestroyed()) return;

    orbPanelWindow = new BrowserWindow({
      width: 300,
      height: 400,
      icon: appIcon,
      transparent: true,
      frame: false,
      thickFrame: false,  // removes invisible Windows DWM border
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js')
      }
    });

    orbPanelWindow.loadFile('floatingorbpanel.html');

    orbPanelWindow.on('closed', () => {
      orbPanelWindow = null;
    });
  }

  // Create Orb on startup (conditional on setting)
  const orbEnabledSetting = await db.getSetting('floatingOrbEnabled');
  // Default to enabled ('true') if setting has never been set
  const orbEnabled = orbEnabledSetting !== 'false';
  if (orbEnabled) {
    createOrbWindow();
    createOrbPanelWindow();
  }

  // Helper to notify orb panel of window state changes
  function notifyWindowStates() {
    if (orbPanelWindow && !orbPanelWindow.isDestroyed() && orbPanelWindow.isVisible()) {
      orbPanelWindow.webContents.send('orb:window-states-updated', getWindowStates());
    }
  }

  // Monitor window visibility changes to update orb panel buttons
  setInterval(() => {
    notifyWindowStates();
  }, 1000);

  // ===== AI INTENT ROUTER =====
  const ALLOWED_INTENTS = [
    'CREATE_TASK', 'EDIT_TASK', 'DELETE_TASK', 'COMPLETE_TASK',
    'CARRY_OVER_TASK', 'UNDO_CARRY_OVER', 'SHOW_TASK_LIST',
    'SHOW_REPORT', 'SHOW_HISTORY', 'GET_TASK_DETAILS',
    'OPEN_TASK_WINDOW', 'OPEN_HISTORY_WINDOW', 'OPEN_REPORT_WINDOW', 'OPEN_CALENDAR_WINDOW', 'OPEN_WINDOW', 'CLOSE_WINDOW',
    'ENABLE_REPEAT_DAILY', 'DISABLE_REPEAT_DAILY', 'CHANGE_FREQUENCY', 'UNKNOWN'
  ];

  let pendingAction = null;
  let pendingInterruptConfirmation = false;

  // ── Keywords that always interrupt CREATE_TASK clarification ──
  const INTERRUPT_KEYWORDS = /^(show|open|delete|complete|enable|disable|carry|undo|edit|history|report|create|close)\b/i;

  // ── Explicit cancel keywords ──
  const CANCEL_KEYWORDS = /^(cancel|stop|never\s*mind|exit)$/i;

  // ── Partial command guidance map ──
  const PARTIAL_COMMAND_MAP = {
    'show': ['show tasks', 'show report', 'show history', 'show details <task>'],
    'open': ['open task window', 'open history window', 'open report window'],
    'delete': ['delete <task name>'],
    'complete': ['complete <task name>'],
    'enable': ['enable repeat daily <task>', 'enable carry over <task>'],
    'disable': ['disable repeat daily <task>', 'disable carry over <task>'],
    'carry': ['carry over <task>'],
    'undo': ['undo carry over <task>'],
    'edit': ['edit <task name>'],
    'history': ['show history'],
    'report': ['show report'],
    'change': ['change frequency <task>'],
    'create': ['create <task name>'],
    'calendar': ['open calendar'],
    'close': ['close ai window', 'close task window', 'close report window', 'close calendar'],
  };

  /**
   * Return guidance text for a partial/ambiguous command keyword.
   * Returns null if the keyword is not recognized.
   */
  function getPartialCommandHelp(keyword) {
    const key = keyword.toLowerCase().trim();
    const commands = PARTIAL_COMMAND_MAP[key];
    if (!commands) return null;
    return `Did you mean one of these?\n\n${commands.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nPlease type the full command.`;
  }


  /**
   * Search today's tasks by partial title match (case-insensitive).
   * Includes both today's tasks and carried-over tasks.
   */
  async function searchTasksByTitle(title) {
    const separated = await db.getTodayTasksSeparated();
    const tasks = [
      ...(separated.todayTasks || []),
      ...(separated.carryOvers || []),
    ];
    // Also include other carried over tasks just in case they are looking for older ones
    const allCarried = await db.getAllCarriedOverTasks();
    const existingIds = new Set(tasks.map(t => t.id));
    for (const t of allCarried) {
      if (!existingIds.has(t.id)) tasks.push(t);
    }
    const search = title.toLowerCase().trim();
    return tasks.filter(t => t.task.toLowerCase().includes(search));
  }

  // ── INTENT FORCING: keyword → intent map ──
  const INTENT_KEYWORDS = [
    { patterns: [/^(delete|remove|erase)\b/i], intent: 'DELETE_TASK' },
    { patterns: [/^(complete|mark\s*complete|finish)\b/i], intent: 'COMPLETE_TASK' },
    { patterns: [/^enable\s*repeat/i, /^repeat\s*daily/i], intent: 'ENABLE_REPEAT_DAILY' },
    { patterns: [/^disable\s*repeat/i, /^stop\s*repeat/i], intent: 'DISABLE_REPEAT_DAILY' },
    { patterns: [/^(enable\s*)?carry\s*over/i], intent: 'CARRY_OVER_TASK' },
    { patterns: [/^(undo\s*carry\s*over|undo\s*carry|disable\s*carry\s*over|disable\s*carry)\b/i], intent: 'UNDO_CARRY_OVER' },
    { patterns: [/^(change|update|set)\s*frequency/i], intent: 'CHANGE_FREQUENCY' },
    { patterns: [/^edit\b/i], intent: 'EDIT_TASK' },
    { patterns: [/^show\s*details/i, /^details\s*(of|for)?/i], intent: 'GET_TASK_DETAILS' },
    { patterns: [/^(close|exit)\b/i], intent: 'CLOSE_WINDOW' },
    { patterns: [/^open\b/i], intent: 'OPEN_WINDOW' },
  ];

  /**
   * Detect forced intent from raw message keywords.
   * Returns { intent, title } or null if no match.
   */
  function detectForcedIntent(msg) {
    const trimmed = msg.trim();
    for (const entry of INTENT_KEYWORDS) {
      for (const pattern of entry.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const title = trimmed.slice(match[0].length).trim() || null;
          return { intent: entry.intent, title };
        }
      }
    }
    return null;
  }

  // ── Intents that require task resolution (confirmation/disambiguation) ──
  const TASK_TARGETING_INTENTS = [
    'DELETE_TASK', 'COMPLETE_TASK', 'ENABLE_REPEAT_DAILY', 'DISABLE_REPEAT_DAILY',
    'CARRY_OVER_TASK', 'UNDO_CARRY_OVER', 'EDIT_TASK', 'GET_TASK_DETAILS', 'CHANGE_FREQUENCY'
  ];

  /**
   * Centralized task resolution: find task by title, return confirmation or disambiguation.
   * @param {string} intent - The intent type
   * @param {string} title - Partial or full task title to search
   * @param {object} extra - Extra data to store in pendingAction (e.g. carryType)
   */
  async function resolveTaskAction(intent, title, extra = {}) {
    let matches = [];
    if (extra.taskId) {
      const taskInfo = await db.getTaskById(extra.taskId);
      if (taskInfo) matches = [taskInfo];
    } else {
      if (!title) return { error: `Please specify which task.` };
      matches = await searchTasksByTitle(title);
    }
    
    if (matches.length === 0) {
      if (intent === 'DELETE_TASK') return { error: `This task doesn't exist or may have been deleted ❌` };
      return { error: `Task not found ❌\nPlease check the name or create it first.` };
    }

    const actionLabel = {
      'DELETE_TASK': 'Delete',
      'COMPLETE_TASK': 'Complete',
      'ENABLE_REPEAT_DAILY': 'Enable repeat daily for',
      'DISABLE_REPEAT_DAILY': 'Disable repeat daily for',
      'CARRY_OVER_TASK': 'Carry over',
      'UNDO_CARRY_OVER': 'Undo carry-over for',
      'EDIT_TASK': 'Edit',
      'GET_TASK_DETAILS': 'Show details for',
      'CHANGE_FREQUENCY': 'Change follow-up frequency for',
    }[intent] || intent;

    if (matches.length === 1) {
      pendingAction = { intent, taskId: matches[0].id, ...extra };
      const matchedTask = matches[0];

      if (intent === 'COMPLETE_TASK' && matchedTask.status === 'completed') {
        pendingAction = { intent: 'REOPEN_TASK', taskId: matchedTask.id, ...extra };
        return {
          needsOptionSelection: true,
          task: { id: matchedTask.id, title: matchedTask.task, quadrant: matchedTask.quadrant, status: matchedTask.status },
          options: [
            { key: 'reopen', label: 'Reopen task', description: '' },
            { key: 'cancel', label: 'Cancel', description: '' }
          ],
          message: `This task is already completed ✅\nDo you want to reopen it?\n\n1. Reopen task\n2. Cancel\n\nReply 1 or 2.`
        };
      }

      if (intent === 'CARRY_OVER_TASK' && (matchedTask.status === 'carried_over' || matchedTask.isCarryOver === 1)) {
        pendingAction = { intent: 'CARRY_OVER_CHANGE', taskId: matchedTask.id, ...extra };
        return {
          needsOptionSelection: true,
          task: { id: matchedTask.id, title: matchedTask.task, quadrant: matchedTask.quadrant, status: matchedTask.status },
          options: [
            { key: 'yes', label: 'Yes', description: '' },
            { key: 'cancel', label: 'Cancel', description: '' }
          ],
          message: `This task is already set to carry over with its current settings.\nDo you want to change it?\n\n1. Yes\n2. Cancel\n\nReply 1 or 2.`
        };
      }

      // CARRY_OVER_TASK: if no carryType specified, ask for it before confirmation
      if (intent === 'CARRY_OVER_TASK' && !extra.carryType) {
        return {
          needsOptionSelection: true,
          task: { id: matches[0].id, title: matches[0].task, quadrant: matches[0].quadrant, status: matches[0].status },
          options: [
            { key: 'fixed', label: 'Fixed', description: 'Move task to tomorrow at the same time' },
            { key: 'dynamic', label: 'Dynamic', description: 'Move task to tomorrow using system startup logic' }
          ],
          message: `How should I carry over "${matches[0].task}"?\n\n1. Fixed — tomorrow at the same time\n2. Dynamic — tomorrow after system starts\n\nReply 1 or 2.`
        };
      }

      // CARRY_OVER_TASK with carryType already set: execute immediately (reversible, no confirmation)
      if (intent === 'CARRY_OVER_TASK' && extra.carryType) {
        pendingAction = null;
        return await executeConfirmedAction(intent, matches[0].id, extra);
      }

      // UNDO_CARRY_OVER: execute immediately (reversible, no confirmation)
      if (intent === 'UNDO_CARRY_OVER') {
        pendingAction = null;
        return await executeConfirmedAction(intent, matches[0].id, extra);
      }

      // CHANGE_FREQUENCY: show frequency options with current selection
      if (intent === 'CHANGE_FREQUENCY') {
        const FREQ_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        const currentFreq = matches[0].follow_up_frequency || 10;
        return {
          needsOptionSelection: true,
          task: { id: matches[0].id, title: matches[0].task, quadrant: matches[0].quadrant, status: matches[0].status },
          options: FREQ_OPTIONS.map((f, i) => ({
            key: String(f),
            label: `${f} minutes`,
            description: f === currentFreq ? '(current)' : ''
          })),
          message: `Follow-up frequency for "${matches[0].task}" (currently ${currentFreq} min):\n\n${FREQ_OPTIONS.map((f, i) => `${i + 1}. Every ${f} minutes${f === currentFreq ? ' ✅ (current)' : ''}`).join('\n')}\n\nReply with the number.`
        };
      }

      const isExactMatch = matchedTask.task.toLowerCase().trim() === title.toLowerCase().trim();
      let msgPrefix = !isExactMatch ? `Did you mean '${matchedTask.task}'?\n\n` : '';

      // TIER 1 vs TIER 2 logic
      // Only DELETE_TASK requires confirmation for a single match
      // If it's NOT an exact match, we MIGHT want confirmation for everything, but let's just confirm DELETE_TASK
      // Wait, Phase 3 says "Fuzzy title matches ... The system halts the pipeline"
      if (!isExactMatch || intent === 'DELETE_TASK') {
        if (extra.forceExecution) {
          pendingAction = null;
          return await executeConfirmedAction(intent, matchedTask.id, extra);
        }
        return {
          needsConfirmation: true,
          task: { id: matchedTask.id, title: matchedTask.task, quadrant: matchedTask.quadrant, status: matchedTask.status },
          message: `${msgPrefix}${actionLabel} "${matchedTask.task}"? Reply yes or no.`
        };
      } else {
        // Exact match and Tier 1 (safe): execute immediately
        pendingAction = null;
        return await executeConfirmedAction(intent, matchedTask.id, extra);
      }
    }

    // Multiple matches → disambiguation
    pendingAction = { intent, matches: matches.map(m => m.id), ...extra };
    const optionsList = matches.map((m, i) => `${i + 1}. ${m.task} (Quadrant ${m.quadrant})`).join('\n');
    return {
      needsDisambiguation: true,
      matches: matches.map((m, i) => ({ index: i + 1, id: m.id, title: m.task, quadrant: m.quadrant, status: m.status })),
      message: `Multiple tasks found. Which one do you want to ${actionLabel.toLowerCase()}?\n\n${optionsList}\n\nReply with the number.`
    };
  }

  /**
   * Return a randomized success message variation.
   */
  function getRandomSuccessMessage(baseMsg) {
    const variations = [
      `${baseMsg} ✅`,
      `Nice! ${baseMsg.replace(/ successfully$/, '')} 🎯`,
      `Great job! ${baseMsg.replace(/ successfully$/, '')} 🔥`,
      `Done! ${baseMsg} 🚀`
    ];
    return variations[Math.floor(Math.random() * variations.length)];
  }

  /**
   * Execute a confirmed task action by intent.
   */
  async function executeConfirmedAction(intent, taskId, extra = {}) {
    const taskInfo = await db.getTaskById(taskId);

    switch (intent) {
      case 'DELETE_TASK': {
        const t1 = reminderTimers.get(taskId);
        if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
        const t2 = followupTimers.get(taskId);
        if (t2) { clearInterval(t2); followupTimers.delete(taskId); }
        await db.deleteTask(taskId);
        if (taskInfo) {
          await db.insertTaskEvent({
            task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
            action_type: 'Deleted', timestamp: new Date().toISOString(), notes: 'Deleted via AI'
          });
        }
        console.log('AI Deleted Task:', taskId);
        return { success: true, message: getRandomSuccessMessage(`Task "${taskInfo ? taskInfo.task : taskId}" deleted.`) };
      }

      case 'COMPLETE_TASK': {
        await db.markTaskCompleted(taskId);
        const t1 = reminderTimers.get(taskId);
        if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
        const t2 = followupTimers.get(taskId);
        if (t2) { clearInterval(t2); followupTimers.delete(taskId); }
        if (taskInfo) {
          await db.insertTaskEvent({
            task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
            action_type: 'Marked Completed', timestamp: new Date().toISOString(), notes: 'Completed via AI'
          });
        }
        console.log('AI Completed Task:', taskId);
        return { success: true, message: getRandomSuccessMessage(`Task "${taskInfo ? taskInfo.task : taskId}" marked as completed.`) };
      }

      case 'REOPEN_TASK': {
        if (!taskInfo) return { error: 'Task not found.' };
        const remindTime = new Date(taskInfo.remindAt).getTime();
        const dueTime = new Date(taskInfo.dueAt).getTime();
        const now = Date.now();
        
        if (now > remindTime && now > dueTime) {
          pendingAction = { intent: 'REOPEN_EDIT_CONFIRM', taskId: taskId };
          return {
             needsConfirmation: true,
             confirmLabel: 'Update Time',
             cancelLabel: 'Cancel',
             message: `This task timing is finished (reminder and follow-up time is over).\nCan I open the edit window for this task so you can update the timing?`
          };
        }

        await db.reopenTask(taskId);
        await db.insertTaskEvent({
            task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
            action_type: 'Task Reopened', timestamp: new Date().toISOString(), notes: 'Via AI'
        });
        
        const restored = await db.getTaskById(taskId);
        
        if (now <= remindTime) {
           scheduleReminder(restored);
           scheduleFollowups(restored);
        } else {
           const untilDue = dueTime - now;
           if (untilDue > 60000) {
             const preAlertTime = dueTime - 60000;
             const cancelObj = scheduleQueueEvent('prealert', restored, preAlertTime, 5);
             reminderTimers.set(taskId, cancelObj);
           }
           scheduleFollowups(restored);
        }
        
        return { success: true, message: getRandomSuccessMessage(`Task "${taskInfo.task}" reopened.`) };
      }

      case 'ENABLE_REPEAT_DAILY':
      case 'DISABLE_REPEAT_DAILY': {
        if (!taskInfo) return { error: 'Task not found.' };
        const newVal = intent === 'ENABLE_REPEAT_DAILY' ? 1 : 0;
        await db.updateTask(taskId, {
          task: taskInfo.task, duration: taskInfo.duration, quadrant: taskInfo.quadrant,
          time: taskInfo.time, repeatDaily: newVal,
          followUpFrequency: taskInfo.follow_up_frequency || 10
        });
        await db.insertTaskEvent({
          task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
          action_type: newVal ? 'Repeat Daily Enabled' : 'Repeat Daily Disabled',
          timestamp: new Date().toISOString(), notes: 'Via AI'
        });
        console.log(newVal ? 'AI Repeat Daily Enabled:' : 'AI Repeat Daily Disabled:', taskId);
        return { success: true, message: `Repeat daily ${newVal ? 'enabled' : 'disabled'} for "${taskInfo.task}".` };
      }

      case 'CHANGE_FREQUENCY': {
        if (!taskInfo) return { error: 'Task not found.' };
        const newFreq = extra.frequency;
        if (!newFreq) return { error: 'No frequency selected.' };
        await db.updateTask(taskId, {
          task: taskInfo.task, duration: taskInfo.duration, quadrant: taskInfo.quadrant,
          time: taskInfo.time, repeatDaily: taskInfo.repeatDaily || 0,
          followUpFrequency: newFreq
        });
        await db.insertTaskEvent({
          task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
          action_type: 'Follow-up Frequency Updated',
          timestamp: new Date().toISOString(), notes: `Changed to ${newFreq} min via AI`
        });
        console.log('AI Changed Frequency:', taskId, 'to', newFreq, 'min');
        return { success: true, message: `Follow-up frequency for "${taskInfo.task}" changed to every ${newFreq} minutes.` };
      }

      case 'CARRY_OVER_TASK': {
        if (!taskInfo) return { error: 'Task not found.' };
        const carryType = extra.carryType || 'dynamic';
        const durationMs = (taskInfo.duration || 15) * 60 * 1000;
        let newDueAt, newRemindAt;
        if (carryType === 'fixed') {
          const tomorrow = new Date(taskInfo.dueAt);
          tomorrow.setDate(tomorrow.getDate() + 1);
          newDueAt = tomorrow.toISOString();
          newRemindAt = new Date(tomorrow.getTime() - durationMs).toISOString();
        } else {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(8, 0, 0, 0);
          newDueAt = tomorrow.toISOString();
          newRemindAt = new Date(tomorrow.getTime() - durationMs).toISOString();
        }
        const carryOverCount = (taskInfo.carryOverCount || 0) + 1;
        const t1 = reminderTimers.get(taskId);
        if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
        const t2 = followupTimers.get(taskId);
        if (t2) { clearInterval(t2); followupTimers.delete(taskId); }
        await db.carryOverTask(taskId, newDueAt, newRemindAt, carryOverCount, carryType);
        
        if (carryType === 'fixed') {
          const updatedTask = await db.getTaskById(taskId);
          if (updatedTask) {
            scheduleReminder(updatedTask);
            scheduleFollowups(updatedTask);
          }
        }

        await db.insertTaskEvent({
          task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
          action_type: 'Carry Over Selected', timestamp: new Date().toISOString(),
          notes: `Type: ${carryType} (via AI)`
        });
        return { success: true, message: `"${taskInfo.task}" carried over (${carryType}).` };
      }

      case 'UNDO_CARRY_OVER': {
        if (!taskInfo) return { error: 'Task not found.' };
        const t1 = reminderTimers.get(taskId);
        if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
        const t2 = followupTimers.get(taskId);
        if (t2) { clearInterval(t2); followupTimers.delete(taskId); }
        await db.undoCarryOver(taskId);
        await db.insertTaskEvent({
          task_id: taskId, task_title: taskInfo.task, priority: taskInfo.quadrant,
          action_type: 'Undo Carry Over', timestamp: new Date().toISOString(),
          notes: 'Via AI'
        });
        const rows = await db.getTodayTasks();
        const restored = rows.find(r => r.id === taskId);
        if (restored && restored.status === 'pending') {
          scheduleReminder(restored);
          scheduleFollowups(restored);
        }
        console.log('AI Undo Carry Over:', taskId);
        return { success: true, message: `Carry-over undone for "${taskInfo.task}".` };
      }

      case 'UPDATE_TASK': {
        if (!taskInfo) return { error: 'Task not found.' };
        
        // extra contains the new fields: date, time, duration, quadrant, repeatDaily, followUpFrequency
        const newFields = {};
        let fieldUpdates = [];
        
        if (extra.time) { newFields.time = extra.time; fieldUpdates.push('time'); }
        if (extra.duration !== undefined) { newFields.duration = extra.duration; fieldUpdates.push('duration'); }
        if (extra.quadrant) { newFields.quadrant = extra.quadrant; fieldUpdates.push('quadrant'); }
        if (extra.repeatDaily !== undefined) { newFields.repeatDaily = extra.repeatDaily; fieldUpdates.push('repeat status'); }
        if (extra.followUpFrequency !== undefined) { newFields.followUpFrequency = extra.followUpFrequency; fieldUpdates.push('follow-up frequency'); }
        
        // If they just said "update gym task", we probably want to open the window.
        if (fieldUpdates.length === 0 && !extra.date) {
           return executeConfirmedAction('EDIT_TASK', taskId, extra);
        }

        const taskData = {
          id: taskId,
          task: taskInfo.task,
          duration: newFields.duration !== undefined ? newFields.duration : taskInfo.duration,
          quadrant: newFields.quadrant || taskInfo.quadrant,
          time: newFields.time || taskInfo.time,
          repeatDaily: newFields.repeatDaily !== undefined ? newFields.repeatDaily : taskInfo.repeatDaily,
          followUpFrequency: newFields.followUpFrequency !== undefined ? newFields.followUpFrequency : taskInfo.follow_up_frequency,
          date: extra.date || undefined // optional
        };

        const oldFreq = taskInfo.follow_up_frequency || 10;
        const newFreq = taskData.followUpFrequency || 10;

        // 1. Clear old timers
        const t1 = reminderTimers.get(taskId);
        if (t1) { clearTimeout(t1); reminderTimers.delete(taskId); }
        const t2 = followupTimers.get(taskId);
        if (t2) { clearInterval(t2); followupTimers.delete(taskId); }

        // 2. Update DB fields
        await db.updateTask(taskId, {
          task: taskData.task,
          duration: taskData.duration,
          quadrant: taskData.quadrant,
          time: taskData.time,
          repeatDaily: taskData.repeatDaily || 0,
          followUpFrequency: newFreq
        });

        // Log Event
        await db.insertTaskEvent({
          task_id: taskId,
          task_title: taskData.task,
          priority: taskData.quadrant,
          action_type: 'Task Edited',
          timestamp: new Date().toISOString(),
          notes: `Fields updated: ${fieldUpdates.join(', ')} (via AI)`
        });

        // 3. Recalculate times
        const now = new Date();
        const [h, m] = taskData.time.split(':').map(Number);
        const due = new Date();

        if (taskData.date) {
          const [year, month, day] = taskData.date.split('-').map(Number);
          due.setFullYear(year, month - 1, day);
        } else if (taskInfo.dueAt) {
           // use original date
           const origDue = new Date(taskInfo.dueAt);
           due.setFullYear(origDue.getFullYear(), origDue.getMonth(), origDue.getDate());
        }

        due.setHours(h, m, 0, 0);
        const remind = new Date(due.getTime() - taskData.duration * 60 * 1000);

        await db.updateTaskTimes(taskId, due.toISOString(), remind.toISOString());

        // 4. Schedule NEW timers
        const remindDelay = remind.getTime() - Date.now();
        const taskForTimers = {
          id: taskId,
          task: taskData.task,
          dueAt: due.toISOString(),
          remindAt: remind.toISOString(),
          follow_up_frequency: newFreq,
          status: taskInfo.status
        };

        if (remindDelay > 0 && taskInfo.status === 'pending') {
          scheduleReminder(taskForTimers);
          scheduleFollowups(taskForTimers);
        }
        
        console.log('AI Updated Task:', taskId, 'Fields:', fieldUpdates);
        return { success: true, message: `Updated ${fieldUpdates.length > 0 ? fieldUpdates.join(' and ') : 'details'} for "${taskData.task}".` };
      }

      case 'EDIT_TASK': {
        if (!taskInfo) return { error: 'Task not found.' };
        if (extra && extra.isReopen) {
          taskInfo.isReopen = true;
        }
        if (editWindow && !editWindow.isDestroyed()) {
          editWindow.webContents.send('edit:data', taskInfo);
          editWindow.show();
          editWindow.focus();
        } else {
          editWindow = new BrowserWindow({
            width: 500,
            height: 485,
            icon: appIcon,
            resizable: true,
            webPreferences: { preload: path.join(__dirname, 'preload.js') }
          });
          editWindow.loadFile('edit.html');
          editWindow.webContents.on('did-finish-load', () => {
            if (!editWindow || editWindow.isDestroyed()) return;
            editWindow.webContents.send('edit:data', taskInfo);
          });
          editWindow.on('closed', () => { editWindow = null; });
        }
        return { success: true, message: `Edit window opened for "${taskInfo.task}".` };
      }

      case 'GET_TASK_DETAILS': {
        if (!taskInfo) return { error: 'Task not found.' };
        return { task: taskInfo, message: `Details for "${taskInfo.task}".` };
      }

      default:
        return { error: 'Unknown action.' };
    }
  }

  // ── DATE PARAMETER PATTERNS (shared by title extraction and date extraction) ──
  const DATE_PARAM_PATTERNS = [
    /\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(st|nd|rd|th)?/i,
    /\bon\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}(st|nd|rd|th)?/i,
    /\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\bon\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i,
    /\b(tomorrow|today)\b/i,
    /\b(on\s+)?(this|next|coming|upcoming|following)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\bnext\s+month(\s+(first|second|third|fourth|last))?\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\bnext\s+week\b/i,
    /\bnext\s+month\b/i,
    /\bon\s+\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i,
    /\bon\s+\d{1,2}[\/-]\d{1,2}([\/-]\d{2,4})?\b/i,
    /\bon\s+\d{1,2}(st|nd|rd|th)?\b/i,
    /\bon\s+\d{4}-\d{2}-\d{2}\b/i,
  ];

  const TIME_PARAM_PATTERNS = [
    /\bat\s+\d{1,2}/i,
    /\d{1,2}:\d{2}/,
    /\d{1,2}\s*(am|pm|a\.m|p\.m)\b/i,
  ];

  const OTHER_PARAM_PATTERNS = [
    /\bremind\s+(?:me\s+)?[\d.]+\s*(?:minutes?|hours?|mins?)?\s*before/i,
    /\b(quadrant|quadrat|priority)\s*[1-4]/i,
    /\bin\s+q\s*[1-4]\b/i,
  ];

  /**
   * Extract title from raw "create" message by stripping prefix and parameter patterns.
   * If the title is enclosed in quotes (single or double), extract exactly what's inside.
   * Otherwise, fall back to regex-based extraction.
   * Returns the extracted title string or null if nothing found.
   */
  function extractTitleFromMessage(rawMsg) {
    // ── PRIORITY 1: Quoted title extraction ──
    // Match title inside double quotes or single quotes anywhere in the message
    const quotedMatch = rawMsg.match(/["'\u201C\u201D\u2018\u2019]([^"'\u201C\u201D\u2018\u2019]+)["'\u201C\u201D\u2018\u2019]/);
    if (quotedMatch && quotedMatch[1].trim()) {
      return quotedMatch[1].trim();
    }

    // ── PRIORITY 2: Regex-based extraction (no quotes) ──
    // Remove "create task", "create a task", "add task", etc. prefix
    let stripped = rawMsg.replace(/^(create|add)\s+(a\s+)?(task\s+)?/i, '').trim();
    if (!stripped) return null;

    const allPatterns = [...TIME_PARAM_PATTERNS, ...OTHER_PARAM_PATTERNS, ...DATE_PARAM_PATTERNS];

    let firstParamIndex = stripped.length;
    for (const pattern of allPatterns) {
      const match = stripped.match(pattern);
      if (match && match.index < firstParamIndex) {
        firstParamIndex = match.index;
      }
    }

    const title = stripped.slice(0, firstParamIndex).trim();
    return title || null;
  }

  /**
   * Extract a date from the user's raw message using local regex parsing.
   * Returns a YYYY-MM-DD string or null.
   * This is a FALLBACK when the AI model fails to parse the date.
   */
  function extractDateFromMessage(rawMsg) {
    const lower = rawMsg.toLowerCase();
    const now = new Date();
    const todayDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const MONTH_MAP = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    function fmt(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getNextWeekday(targetDay) {
      // Returns the Date of the NEXT occurrence of targetDay (0-6)
      let diff = targetDay - todayDay;
      if (diff <= 0) diff += 7; // always go forward
      const result = new Date(now);
      result.setDate(now.getDate() + diff);
      return result;
    }

    // "today"
    if (/\btoday\b/i.test(lower)) {
      return fmt(now);
    }

    // "tomorrow"
    if (/\btomorrow\b/i.test(lower)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return fmt(d);
    }

    // "next month first/second/third/fourth/last friday" etc.
    const nextMonthOrdMatch = lower.match(/\bnext\s+month\s+(first|second|third|fourth|last|1st|2nd|3rd|4th)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (nextMonthOrdMatch) {
      const ordWord = nextMonthOrdMatch[1];
      const dayWord = nextMonthOrdMatch[2];
      const targetDay = DAY_MAP[dayWord];
      const nextMonth = now.getMonth() + 1;
      const nextMonthYear = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
      const actualMonth = nextMonth % 12;

      if (ordWord === 'last') {
        // Last X of next month: start from the last day and go backward
        const lastDay = new Date(nextMonthYear, actualMonth + 1, 0);
        while (lastDay.getDay() !== targetDay) lastDay.setDate(lastDay.getDate() - 1);
        return fmt(lastDay);
      } else {
        const ordNum = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }[ordWord] || 1;
        const firstOfMonth = new Date(nextMonthYear, actualMonth, 1);
        let firstOccurrence = new Date(firstOfMonth);
        while (firstOccurrence.getDay() !== targetDay) firstOccurrence.setDate(firstOccurrence.getDate() + 1);
        firstOccurrence.setDate(firstOccurrence.getDate() + (ordNum - 1) * 7);
        return fmt(firstOccurrence);
      }
    }

    // "next week" — next Monday
    if (/\bnext\s+week\b/i.test(lower)) {
      return fmt(getNextWeekday(1));
    }

    // "next month" (no day specified) — 1st of next month
    if (/\bnext\s+month\b/i.test(lower) && !nextMonthOrdMatch) {
      const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return fmt(d);
    }

    // "(on|this|next|coming|upcoming|following) <weekday>"
    const weekdayMatch = lower.match(/\b(?:on\s+)?(?:this|next|coming|upcoming|following)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (weekdayMatch) {
      return fmt(getNextWeekday(DAY_MAP[weekdayMatch[1]]));
    }

    // "on <weekday>" (bare)
    const bareWeekdayMatch = lower.match(/\bon\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (bareWeekdayMatch) {
      return fmt(getNextWeekday(DAY_MAP[bareWeekdayMatch[1]]));
    }

    // "on 3rd of june", "on 3 of june"
    const onDayOfMonthMatch = lower.match(/\bon\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/);
    if (onDayOfMonthMatch) {
      const day = parseInt(onDayOfMonthMatch[1], 10);
      const monthIdx = MONTH_MAP[onDayOfMonthMatch[2]];
      let year = now.getFullYear();
      const candidate = new Date(year, monthIdx, day);
      if (candidate < now) year++;
      return fmt(new Date(year, monthIdx, day));
    }

    // "on june 3", "on june 3rd"
    const onMonthDayMatch = lower.match(/\bon\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (onMonthDayMatch) {
      const monthIdx = MONTH_MAP[onMonthDayMatch[1]];
      const day = parseInt(onMonthDayMatch[2], 10);
      let year = now.getFullYear();
      const candidate = new Date(year, monthIdx, day);
      if (candidate < now) year++;
      return fmt(new Date(year, monthIdx, day));
    }

    // "on 3/6/2026" or "on 3-6-2026" (DD/MM/YYYY or DD-MM-YYYY)
    const slashDateMatch = lower.match(/\bon\s+(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/);
    if (slashDateMatch) {
      const day = parseInt(slashDateMatch[1], 10);
      const month = parseInt(slashDateMatch[2], 10) - 1;
      let year = slashDateMatch[3] ? parseInt(slashDateMatch[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      return fmt(new Date(year, month, day));
    }

    // "on 2026-06-05" (ISO format)
    const isoMatch = lower.match(/\bon\s+(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    return null;
  }

  /**
   * Handle the parsed AI intent and route to existing backend functions.
   * @param {object} parsed - Parsed intent from AI
   * @param {string} originalMsg - The original user message (for hallucination detection)
   */
  async function handleAIIntent(parsed, originalMsg) {
    switch (parsed.intent) {

      // ── CREATE TASK ──
      case 'CREATE_TASK': {
        // ── Anti-hallucination: validate fields against original user message ──
        const msgLower = (originalMsg || '').toLowerCase();

        const hasTime = /\d{1,2}:\d{2}/.test(msgLower) ||
          /\d{1,2}\s*(am|pm|a\.m|p\.m)/i.test(msgLower) ||
          /at\s+\d{1,2}/i.test(msgLower);
        if (!hasTime) parsed.time = null;

        // Only accept "remind [me] X [minutes/hours] before" as reminder duration
        // Unit is optional — if missing, default to minutes
        const remindDurMatch = msgLower.match(/remind\s+(?:me\s+)?([\d.]+)\s*(minutes?|hours?|mins?)?\s*before/i);
        if (remindDurMatch) {
          const val = parseFloat(remindDurMatch[1]);
          const unit = remindDurMatch[2] || 'minutes'; // default to minutes if unit omitted
          parsed.duration = /^hour/i.test(unit) ? Math.round(val * 60) : Math.round(val);
        } else {
          // Reject "for X minutes/hours" — NOT a reminder duration
          parsed.duration = null;
        }

        // Use stricter quadrant detection: require full word "quadrant"/"priority"/"quadrat" or "in q[1-4]"
        // Avoids false positives like "Q3" in "Q3 report"
        const hasQuadrant = /\b(quadrant|quadrat|priority)\s*[1-4]/i.test(msgLower) ||
          /\bin\s+q\s*[1-4]\b/i.test(msgLower);
        if (!hasQuadrant) parsed.quadrant = null;

        // ── DATE: Use local parser as primary, AI as fallback ──
        // The AI often fails on "coming thursday", "next month first friday", etc.
        // Our local parser handles all these robustly.
        if (originalMsg) {
          const localDate = extractDateFromMessage(originalMsg);
          if (localDate) {
            parsed.date = localDate; // local parser is more reliable
            console.log('Date extracted locally:', localDate);
          } else if (!parsed.date) {
            // Check if the message contains date-like words but we couldn't parse
            const hasDateWords = DATE_PARAM_PATTERNS.some(p => p.test(originalMsg));
            if (hasDateWords) {
              console.log('Warning: date words detected but could not parse date from:', originalMsg);
              // Keep the AI's date if it provided one
            }
          }
        }

        // ── Always extract title from raw message for "create" commands ──
        // AI parser often truncates multi-word titles, so prefer manual extraction
        if (originalMsg && /^(create|add)\b/i.test(originalMsg.trim())) {
          const manualTitle = extractTitleFromMessage(originalMsg);
          // Only override if manual extraction found something
          if (manualTitle) {
            parsed.title = manualTitle;
          }
        }

        if (parsed.repeatDaily === null || parsed.repeatDaily === undefined) parsed.repeatDaily = false;
        if (parsed.followUpFrequency === null || parsed.followUpFrequency === undefined) parsed.followUpFrequency = 10;

        const required = ['title', 'time', 'duration', 'quadrant'];
        const missing = required.filter(f => parsed[f] === null || parsed[f] === undefined);

        if (missing.length > 0) {
          pendingAction = { intent: 'CREATE_TASK', data: { ...parsed } };
          return {
            needsClarification: true,
            missingFields: missing,
            message: `I need a few more details to create this task. Please provide: ${missing.join(', ')}.`
          };
        }

        return await executeCreateTask(parsed);
      }

      // ── ALL TASK-TARGETING INTENTS (unified via resolveTaskAction) ──
      case 'DELETE_TASK':
      case 'COMPLETE_TASK':
      case 'ENABLE_REPEAT_DAILY':
      case 'DISABLE_REPEAT_DAILY':
      case 'CARRY_OVER_TASK':
      case 'UNDO_CARRY_OVER':
      case 'EDIT_TASK':
      case 'GET_TASK_DETAILS':
      case 'CHANGE_FREQUENCY': {
        const extra = {};
        if (parsed.intent === 'CARRY_OVER_TASK' && parsed.carryType) {
          extra.carryType = parsed.carryType;
        }
        return await resolveTaskAction(parsed.intent, parsed.title, extra);
      }

      // ── SHOW TASK LIST ──
      case 'SHOW_TASK_LIST': {
        const separated = await db.getTodayTasksSeparated();
        const allTasks = [
          ...(separated.todayTasks || []),
          ...(separated.carryOvers || []),
        ];

        if (parsed.filter) {
          if (parsed.filter.startsWith('quadrant')) {
            const q = parseInt(parsed.filter.replace('quadrant', ''), 10);
            const filtered = allTasks.filter(t => t.quadrant === q);
            return { tasks: filtered, message: `Found ${filtered.length} quadrant ${q} task(s).` };
          } else if (parsed.filter === 'completed') {
            const filtered = allTasks.filter(t => t.status === 'completed');
            return { tasks: filtered, message: `Found ${filtered.length} completed task(s) for today.` };
          } else if (parsed.filter === 'pending') {
            const filtered = allTasks.filter(t => t.status === 'pending');
            return { tasks: filtered, message: `Found ${filtered.length} pending task(s) for today.` };
          } else if (parsed.filter === 'carried_over') {
            const filtered = allTasks.filter(t => t.status === 'carried_over' || t.isCarryOver === 1);
            return { tasks: filtered, message: `Found ${filtered.length} carried-over task(s) for today.` };
          }
        }
        return { tasks: allTasks, message: `You have ${allTasks.length} task(s) today.` };
      }

      // ── SHOW REPORT ──
      case 'SHOW_REPORT': {
        const todayStr = new Date().toISOString().slice(0, 10);
        const report = await db.getReportByDate(todayStr);
        return { report, message: 'Here is today\'s report.' };
      }

      // ── SHOW HISTORY ──
      case 'SHOW_HISTORY': {
        const events = await db.getHistoryEvents({});
        return { events: events.slice(0, 20), message: `Showing last ${Math.min(events.length, 20)} events.` };
      }

      // ── OPEN WINDOWS ──
      case 'OPEN_TASK_WINDOW':
         return await handleAIIntent({ intent: 'OPEN_WINDOW', window: 'list' }, msg);
      case 'OPEN_HISTORY_WINDOW':
      case 'OPEN_REPORT_WINDOW':
         return await handleAIIntent({ intent: 'OPEN_WINDOW', window: 'report' }, msg);
      case 'OPEN_CALENDAR_WINDOW':
         return await handleAIIntent({ intent: 'OPEN_WINDOW', window: 'calendar' }, msg);

      case 'OPEN_WINDOW': {
        if (!parsed.window) {
          pendingAction = { intent: 'OPEN_WINDOW' };
          return { needsClarification: true, message: "Which window do you want to open?\n\n- report / history\n- list / task list\n- creation / task creation\n- calendar\n- ai\n\nReply with the window name or type cancel." };
        }
        
        let winName = parsed.window.toLowerCase();
        if (winName === 'ai') {
          openAIWindow();
          if (aiWindow && !aiWindow.isDestroyed()) {
             aiWindow.show();
             aiWindow.focus();
             aiWindow.setAlwaysOnTop(true);
             setTimeout(() => { if (aiWindow && !aiWindow.isDestroyed()) aiWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "AI window opened." };
        } else if (winName === 'list' || winName === 'task list' || winName === 'tasks') {
          openListWindow();
          if (listWindow && !listWindow.isDestroyed()) {
            listWindow.show();
            listWindow.focus();
            listWindow.setAlwaysOnTop(true);
            setTimeout(() => { if (listWindow && !listWindow.isDestroyed()) listWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "Task list window opened." };
        } else if (winName === 'creation' || winName === 'task creation') {
          if (mainWindow && !mainWindow.isDestroyed()) {
             mainWindow.show();
             mainWindow.focus();
             mainWindow.setAlwaysOnTop(true);
             setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "Task creation window opened." };
        } else if (winName === 'history' || winName === 'report' || winName === 'analytics') {
          openHistoryReportWindow();
          if (historyReportWindow && !historyReportWindow.isDestroyed()) {
            historyReportWindow.show();
            historyReportWindow.focus();
            historyReportWindow.setAlwaysOnTop(true);
            setTimeout(() => { if (historyReportWindow && !historyReportWindow.isDestroyed()) historyReportWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "History & Report window opened." };
        } else if (winName === 'calendar') {
          openCalendarWindow();
          if (calendarWindow && !calendarWindow.isDestroyed()) {
            calendarWindow.show();
            calendarWindow.focus();
            calendarWindow.setAlwaysOnTop(true);
            setTimeout(() => { if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "Calendar window opened." };
        } else if (winName === 'home' || winName === 'dashboard' || winName === 'settings') {
          createHomeWindow();
          if (homeWindow && !homeWindow.isDestroyed()) {
            homeWindow.show();
            homeWindow.focus();
            homeWindow.setAlwaysOnTop(true);
            setTimeout(() => { if (homeWindow && !homeWindow.isDestroyed()) homeWindow.setAlwaysOnTop(false); }, 1000);
          }
          return { success: true, message: "Home window opened." };
        } else if (winName === 'edit') {
          return { error: "You can only open the Edit window for a specific task." };
        }
        return { error: `Cannot find a window named ${winName} to open.` };
      }
      case 'CLOSE_WINDOW': {
        if (!parsed.window) {
          pendingAction = { intent: 'CLOSE_WINDOW' };
          return { needsClarification: true, message: "Which window do you want to close?\n\n- report / history\n- list / task list\n- creation / task creation\n- calendar\n- ai\n\nReply with the window name or type cancel." };
        }
        
        let winName = parsed.window.toLowerCase();
        if (winName === 'all' || winName === 'all windows' || winName === 'everything') {
          let closed = [];
          if (aiWindow && !aiWindow.isDestroyed() && aiWindow.isVisible()) { aiWindow.hide(); closed.push('AI'); }
          if (listWindow && !listWindow.isDestroyed() && listWindow.isVisible()) { listWindow.hide(); closed.push('Task List'); }
          if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) { mainWindow.hide(); closed.push('Task Creation'); }
          if (historyReportWindow && !historyReportWindow.isDestroyed() && historyReportWindow.isVisible()) { historyReportWindow.hide(); closed.push('History & Report'); }
          if (calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible()) { calendarWindow.hide(); closed.push('Calendar'); }
          if (editWindow && !editWindow.isDestroyed() && editWindow.isVisible()) { editWindow.hide(); closed.push('Edit'); }
          if (closed.length === 0) return { success: true, message: "No windows are currently open." };
          return { success: true, message: `Closed ${closed.join(', ')}.` };
        } else if (winName === 'ai') {
          if (aiWindow && !aiWindow.isDestroyed()) aiWindow.hide();
          return { success: true, message: "Currently using AI window, closed successfully in the background." };
        } else if (winName === 'list' || winName === 'task list' || winName === 'tasks') {
          if (listWindow && !listWindow.isDestroyed()) listWindow.hide();
          return { success: true, message: "Closed Task list window." };
        } else if (winName === 'creation' || winName === 'task creation') {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
          return { success: true, message: "Closed Task creation window." };
        } else if (winName === 'history' || winName === 'report' || winName === 'analytics') {
          if (historyReportWindow && !historyReportWindow.isDestroyed()) historyReportWindow.hide();
          return { success: true, message: "Closed History & Report window." };
        } else if (winName === 'calendar') {
          if (calendarWindow && !calendarWindow.isDestroyed()) calendarWindow.hide();
          return { success: true, message: "Closed Calendar window." };
        } else if (winName === 'edit') {
          if (editWindow && !editWindow.isDestroyed()) editWindow.hide();
          return { success: true, message: "Closed Edit window." };
        }
        return { error: `Cannot find a window named ${winName} to close.` };
      }

      case 'UNKNOWN':
      default:
        return { error: "I didn't understand that. Try commands like: show tasks, create task, delete task, show report, etc." };
    }
  }

  /**
   * Build the full payload and create the task via existing logic.
   */
  async function executeCreateTask(data) {
    const title = data.title;
    const time = data.time; // HH:MM
    const dateVal = data.date; // YYYY-MM-DD or null
    const duration = typeof data.duration === 'number' ? data.duration : 10;
    const quadrant = data.quadrant || 1;
    const repeatDaily = data.repeatDaily ? 1 : 0;
    const followUpFrequency = data.followUpFrequency || 10;

    let h = 23, m = 0;
    if (time && typeof time === 'string' && time.includes(':')) {
      const parts = time.split(':').map(Number);
      if (!isNaN(parts[0])) h = parts[0];
      if (!isNaN(parts[1])) m = parts[1];
    } else if (time && typeof time === 'string') {
      const parsedH = parseInt(time, 10);
      if (!isNaN(parsedH)) h = parsedH;
    }

    const now = new Date();
    const due = new Date();
    
    if (dateVal && typeof dateVal === 'string' && dateVal.includes('-')) {
      const [year, month, day] = dateVal.split('-').map(Number);
      if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
         due.setFullYear(year, month - 1, day);
      }
      due.setHours(h, m, 0, 0);
    } else {
      due.setHours(h, m, 0, 0);
      if (due <= now) due.setDate(due.getDate() + 1);
    }

    if (due.getTime() < now.getTime()) {
      pendingAction = null;
      pendingInterruptConfirmation = false;
      return { error: "time is already crossed , we cannot time travel , lets schedule task for future" };
    }

    const remind = new Date(due.getTime() - duration * 60 * 1000);

    const payload = {
      task: title,
      time,
      duration,
      quadrant,
      createdAt: new Date().toISOString(),
      dueAt: due.toISOString(),
      remindAt: remind.toISOString(),
      repeatDaily,
      followUpFrequency,
    };

    const id = await db.insertTask(payload);
    await db.insertTaskEvent({
      task_id: id, task_title: title, priority: quadrant,
      action_type: 'Task Created', timestamp: new Date().toISOString(),
      notes: 'Created via AI'
    });

    const taskInfo = {
      id, task: title, remindAt: remind.toISOString(), dueAt: due.toISOString(),
      duration, carryOverCount: 0, quadrant, follow_up_frequency: followUpFrequency
    };
    scheduleReminder(taskInfo);
    scheduleFollowups(taskInfo);

    pendingAction = null;
    pendingInterruptConfirmation = false;
    const dateDisplay = dateVal ? ` on ${dateVal}` : '';
    notifyAnalyticsUpdate();
    return { success: true, message: `Task "${title}" created for ${time}${dateDisplay}.` };
  }

  // ── AI MESSAGE PROCESSOR (reusable by both text AI and voice) ──
  async function processAIMessage(message) {
    try {
      const msg = (message || '').trim();
      if (!msg) return { error: 'Please type a message.' };

      // ── Handle pending confirmation (yes/no) — works for ALL task-targeting intents ──
      if (pendingAction && pendingAction.taskId && TASK_TARGETING_INTENTS.includes(pendingAction.intent)) {
        const lower = msg.toLowerCase();
        if (lower === 'yes' || lower === 'y' || lower === 'confirm') {
          const taskId = pendingAction.taskId;
          const intent = pendingAction.intent;
          const extra = { carryType: pendingAction.carryType };
          pendingAction = null;
          return await executeConfirmedAction(intent, taskId, extra);
        } else if (lower === 'no' || lower === 'n' || lower === 'cancel') {
          pendingAction = null;
          return { success: true, message: 'Action cancelled.' };
        }
      }

      // ── Handle REOPEN_TASK options ──
      if (pendingAction && pendingAction.intent === 'REOPEN_TASK' && pendingAction.taskId) {
        const num = parseInt(msg, 10);
        if (num === 1 || /^reopen$/i.test(msg) || /^y/i.test(msg)) {
          const taskId = pendingAction.taskId;
          pendingAction = null;
          return await executeConfirmedAction('REOPEN_TASK', taskId);
        } else if (num === 2 || CANCEL_KEYWORDS.test(msg) || /^n/i.test(msg)) {
          pendingAction = null;
          return { success: true, message: 'Action cancelled.' };
        }
      }

      // ── Handle REOPEN_EDIT_CONFIRM ──
      if (pendingAction && pendingAction.intent === 'REOPEN_EDIT_CONFIRM' && pendingAction.taskId) {
        if (/^y/i.test(msg)) {
          const taskId = pendingAction.taskId;
          pendingAction = null;
          return await executeConfirmedAction('EDIT_TASK', taskId, { isReopen: true });
        } else if (/^n/i.test(msg) || CANCEL_KEYWORDS.test(msg)) {
          pendingAction = null;
          return { success: true, message: 'Action cancelled.' };
        }
      }

      // ── Handle CARRY_OVER_CHANGE options ──
      if (pendingAction && pendingAction.intent === 'CARRY_OVER_CHANGE' && pendingAction.taskId) {
        const num = parseInt(msg, 10);
        if (num === 1 || /^y/i.test(msg)) {
          pendingAction.intent = 'CARRY_OVER_TASK';
          const taskInfo = await db.getTaskById(pendingAction.taskId);
          return {
            needsOptionSelection: true,
            task: { id: taskInfo.id, title: taskInfo.task, quadrant: taskInfo.quadrant, status: taskInfo.status },
            options: [
              { key: 'fixed', label: 'Fixed', description: 'Move task to tomorrow at the same time' },
              { key: 'dynamic', label: 'Dynamic', description: 'Move task to tomorrow using system startup logic' }
            ],
            message: `How should I carry over "${taskInfo.task}"?\n\n1. Fixed — tomorrow at the same time\n2. Dynamic — tomorrow after system starts\n\nReply 1 or 2.`
          };
        } else if (num === 2 || CANCEL_KEYWORDS.test(msg) || /^n/i.test(msg)) {
          pendingAction = null;
          return { success: true, message: 'Action cancelled.' };
        }
      }

      // ── Handle pending option selection (carry-over type: 1=fixed, 2=dynamic) ──
      if (pendingAction && pendingAction.intent === 'CARRY_OVER_TASK' && !pendingAction.carryType && pendingAction.taskId) {
        const num = parseInt(msg, 10);
        if (num === 1 || num === 2) {
          const carryType = num === 1 ? 'fixed' : 'dynamic';
          const taskId = pendingAction.taskId;
          pendingAction = null;
          return await executeConfirmedAction('CARRY_OVER_TASK', taskId, { carryType });
        }
      }

      // ── Handle pending frequency selection (user picks a number 1-10) ──
      if (pendingAction && pendingAction.intent === 'CHANGE_FREQUENCY' && pendingAction.taskId) {
        const FREQ_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
        const num = parseInt(msg, 10);
        if (!isNaN(num) && num >= 1 && num <= FREQ_OPTIONS.length) {
          const frequency = FREQ_OPTIONS[num - 1];
          const taskId = pendingAction.taskId;
          pendingAction = null;
          return await executeConfirmedAction('CHANGE_FREQUENCY', taskId, { frequency });
        }
      }

      // ── Handle pending disambiguation (user picks a number) — works for ALL task-targeting intents ──
      if (pendingAction && pendingAction.matches && TASK_TARGETING_INTENTS.includes(pendingAction.intent)) {
        const num = parseInt(msg, 10);
        if (!isNaN(num) && num >= 1 && num <= pendingAction.matches.length) {
          const taskId = pendingAction.matches[num - 1];
          const taskInfo = await db.getTaskById(taskId);
          const intent = pendingAction.intent;
          const extra = { carryType: pendingAction.carryType };
          pendingAction = { intent, taskId, ...extra };

          // CARRY_OVER_TASK: if no carryType, ask for it before confirmation
          if (intent === 'CARRY_OVER_TASK' && !pendingAction.carryType) {
            return {
              needsOptionSelection: true,
              task: { id: taskId, title: taskInfo ? taskInfo.task : taskId, quadrant: taskInfo ? taskInfo.quadrant : null, status: taskInfo ? taskInfo.status : null },
              options: [
                { key: 'fixed', label: 'Fixed', description: 'Move task to tomorrow at the same time' },
                { key: 'dynamic', label: 'Dynamic', description: 'Move task to tomorrow using system startup logic' }
              ],
              message: `How should I carry over "${taskInfo ? taskInfo.task : taskId}"?\n\n1. Fixed — tomorrow at the same time\n2. Dynamic — tomorrow after system starts\n\nReply 1 or 2.`
            };
          }

          // CARRY_OVER_TASK with carryType: execute immediately (no confirmation)
          if (intent === 'CARRY_OVER_TASK' && pendingAction.carryType) {
            pendingAction = null;
            return await executeConfirmedAction(intent, taskId, extra);
          }

          // UNDO_CARRY_OVER: execute immediately (no confirmation)
          if (intent === 'UNDO_CARRY_OVER') {
            pendingAction = null;
            return await executeConfirmedAction(intent, taskId, extra);
          }

          // CHANGE_FREQUENCY: show frequency options after disambiguation
          if (intent === 'CHANGE_FREQUENCY') {
            const FREQ_OPTIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
            const currentFreq = taskInfo ? (taskInfo.follow_up_frequency || 10) : 10;
            return {
              needsOptionSelection: true,
              task: { id: taskId, title: taskInfo ? taskInfo.task : taskId, quadrant: taskInfo ? taskInfo.quadrant : null, status: taskInfo ? taskInfo.status : null },
              options: FREQ_OPTIONS.map((f, i) => ({
                key: String(f),
                label: `${f} minutes`,
                description: f === currentFreq ? '(current)' : ''
              })),
              message: `Follow-up frequency for "${taskInfo ? taskInfo.task : taskId}" (currently ${currentFreq} min):\n\n${FREQ_OPTIONS.map((f, i) => `${i + 1}. Every ${f} minutes${f === currentFreq ? ' ✅ (current)' : ''}`).join('\n')}\n\nReply with the number.`
            };
          }

          // COMPLETE_TASK: check if already completed
          if (intent === 'COMPLETE_TASK' && taskInfo && taskInfo.status === 'completed') {
            pendingAction = { intent: 'REOPEN_TASK', taskId: taskId, ...extra };
            return {
              needsOptionSelection: true,
              task: { id: taskId, title: taskInfo.task, quadrant: taskInfo.quadrant, status: taskInfo.status },
              options: [
                { key: 'reopen', label: 'Reopen task', description: '' },
                { key: 'cancel', label: 'Cancel', description: '' }
              ],
              message: `This task is already completed ✅\nDo you want to reopen it?\n\n1. Reopen task\n2. Cancel\n\nReply 1 or 2.`
            };
          }

          // CARRY_OVER_TASK: check if already carried over
          if (intent === 'CARRY_OVER_TASK' && taskInfo && (taskInfo.status === 'carried_over' || taskInfo.isCarryOver === 1)) {
            pendingAction = { intent: 'CARRY_OVER_CHANGE', taskId: taskId, ...extra };
            return {
              needsOptionSelection: true,
              task: { id: taskId, title: taskInfo.task, quadrant: taskInfo.quadrant, status: taskInfo.status },
              options: [
                { key: 'yes', label: 'Yes', description: '' },
                { key: 'cancel', label: 'Cancel', description: '' }
              ],
              message: `This task is already set to carry over with its current settings.\nDo you want to change it?\n\n1. Yes\n2. Cancel\n\nReply 1 or 2.`
            };
          }

          const actionLabel = {
            'DELETE_TASK': 'Delete',
            'COMPLETE_TASK': 'Complete',
            'ENABLE_REPEAT_DAILY': 'Enable repeat daily for',
            'DISABLE_REPEAT_DAILY': 'Disable repeat daily for',
            'CARRY_OVER_TASK': 'Carry over',
            'UNDO_CARRY_OVER': 'Undo carry-over for',
            'EDIT_TASK': 'Edit',
            'GET_TASK_DETAILS': 'Show details for',
            'CHANGE_FREQUENCY': 'Change follow-up frequency for',
          }[intent] || intent;

          return {
            needsConfirmation: true,
            task: { id: taskId, title: taskInfo ? taskInfo.task : taskId, quadrant: taskInfo ? taskInfo.quadrant : null },
            message: `${actionLabel} "${taskInfo ? taskInfo.task : taskId}"? Reply yes or no.`
          };
        }
      }

      // ── Handle pending interrupt confirmation (yes/no from ambiguous input) ──
      if (pendingInterruptConfirmation && pendingAction && pendingAction.intent === 'CREATE_TASK') {
        const confirmLower = msg.toLowerCase();
        if (/^(yes|y)$/i.test(confirmLower)) {
          pendingInterruptConfirmation = false;
          pendingAction = null;
          return { success: true, message: 'Task creation cancelled.' };
        } else if (/^(no|n)$/i.test(confirmLower)) {
          pendingInterruptConfirmation = false;
          const stillMissing = ['title', 'time', 'duration', 'quadrant']
            .filter(f => pendingAction.data[f] === null || pendingAction.data[f] === undefined);
          return {
            needsClarification: true,
            missingFields: stillMissing,
            message: `Still need: ${stillMissing.join(', ')}.`
          };
        }
        // If neither yes nor no, clear the flag and fall through to normal processing
        pendingInterruptConfirmation = false;
      }

      // ── Handle CLOSE_WINDOW / OPEN_WINDOW clarification ──
      if (pendingAction && (pendingAction.intent === 'CLOSE_WINDOW' || pendingAction.intent === 'OPEN_WINDOW')) {
        const clarifyLower = msg.toLowerCase();
        let winName = null;
        if (clarifyLower.includes('calendar') || clarifyLower.includes('calender')) winName = 'calendar';
        else if (clarifyLower.includes('ai')) winName = 'ai';
        else if (clarifyLower.includes('creation') || clarifyLower.includes('task creation')) winName = 'creation';
        else if (clarifyLower.includes('list') || clarifyLower.includes('task list')) winName = 'list';
        else if (clarifyLower.includes('history') || clarifyLower.includes('report') || clarifyLower.includes('analytic')) winName = 'report';
        else if (clarifyLower.includes('edit')) winName = 'edit';
        else if (CANCEL_KEYWORDS.test(clarifyLower)) {
          pendingAction = null;
          return { success: true, message: 'Action cancelled.' };
        }
        
        if (winName) {
           const actionIntent = pendingAction.intent;
           pendingAction = null;
           return await handleAIIntent({ intent: actionIntent, window: winName }, msg);
        } else {
           const actionText = pendingAction.intent === 'OPEN_WINDOW' ? 'open' : 'close';
           return { needsClarification: true, message: `I didn't catch that. Which window do you want to ${actionText}?\n\n- report / history\n- list / task list\n- creation / task creation\n- calendar\n- ai\n\nReply with the window name or type cancel.` };
        }
      }

      // ── CREATE_TASK interrupt detection: cancel, command keywords, or ambiguous input ──
      if (pendingAction && pendingAction.intent === 'CREATE_TASK') {
        // Part 2: Explicit cancel commands
        if (CANCEL_KEYWORDS.test(msg)) {
          pendingAction = null;
          pendingInterruptConfirmation = false;
          return { success: true, message: 'Task creation cancelled.' };
        }

        // Part 1 & 5: Command keyword → auto-interrupt CREATE_TASK and process normally
        if (INTERRUPT_KEYWORDS.test(msg)) {
          console.log('⚡ Interrupting CREATE_TASK for command:', msg);
          pendingAction = null;
          pendingInterruptConfirmation = false;
          // Fall through to forced intent / AI parse below
        }
      }

      // ── Handle pending clarification (merge missing CREATE_TASK fields) ──
      // Uses direct regex detection instead of AI parsing for natural input like "mail", "10 minutes", "4pm", "quadrant 2"
      if (pendingAction && pendingAction.intent === 'CREATE_TASK') {
        try {
          const clarifyInput = msg.trim();
          const clarifyLower = clarifyInput.toLowerCase();
          const detected = {};

          // Detect time: "4pm", "4:30", "4 pm", "at 4"
          const timeMatch = clarifyInput.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i) ||
            clarifyInput.match(/\b(\d{1,2})\s*(am|pm|a\.m|p\.m)\b/i);
          if (timeMatch) {
            let hours = parseInt(timeMatch[1], 10);
            const minutes = timeMatch[2] && /^\d+$/.test(timeMatch[2]) ? timeMatch[2] : '00';
            const ampm = (timeMatch[3] || timeMatch[2] || '').toLowerCase().replace('.', '');
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
            detected.time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
          }

          // Detect duration: "remind 30 minutes before", "remind 2 hours before", "remind 10 before" (no unit = minutes),
          // or plain "30 minutes", "2 hours", or bare number when duration is missing
          const durationMatch = clarifyInput.match(/remind\s+(?:me\s+)?([\d.]+)\s*(minutes?|hours?|mins?)?\s*before/i)
            || clarifyInput.match(/^([\d.]+)\s*(minutes?|hours?|mins?)\s*$/i);
          if (durationMatch) {
            const val = parseFloat(durationMatch[1]);
            const unit = durationMatch[2] || 'minutes'; // default to minutes if unit omitted
            detected.duration = /^hour/i.test(unit) ? Math.round(val * 60) : Math.round(val);
          } else if (/^\d+$/.test(clarifyInput.trim()) && (pendingAction.data.duration === null || pendingAction.data.duration === undefined)) {
            // Bare number when duration is the missing field — treat as minutes
            detected.duration = parseInt(clarifyInput.trim(), 10);
          }

          // Detect quadrant: "quadrant 2", "q1", "priority 3"
          const quadrantMatch = clarifyInput.match(/(quadrant|priority|q)\s*([1-4])/i);
          if (quadrantMatch) {
            detected.quadrant = parseInt(quadrantMatch[2], 10);
          } else if (/^[1-4]$/.test(clarifyInput)) {
            // Bare number 1-4 when quadrant is missing
            if (pendingAction.data.quadrant === null || pendingAction.data.quadrant === undefined) {
              detected.quadrant = parseInt(clarifyInput, 10);
            }
          }

          // Part 3: If nothing was detected as time/duration/quadrant → ambiguous input
          if (!detected.time && !detected.duration && !detected.quadrant) {
            // Check if title is still missing — if so, treat input as title
            if (pendingAction.data.title === null || pendingAction.data.title === undefined) {
              detected.title = clarifyInput;
            } else {
              // Title already set, and input doesn't match any field pattern → ambiguous
              pendingInterruptConfirmation = true;
              pendingAction.lastAmbiguousMsg = msg;
              return {
                needsConfirmation: true,
                message: "Are you trying to run another command?\nReply 'yes' to cancel task creation or 'no' to continue."
              };
            }
          }

          const merged = { ...pendingAction.data };
          const fields = ['title', 'time', 'duration', 'quadrant', 'date'];
          for (const f of fields) {
            if ((merged[f] === null || merged[f] === undefined) && detected[f] !== null && detected[f] !== undefined) {
              merged[f] = detected[f];
            }
          }
          merged.intent = 'CREATE_TASK';
          if (merged.repeatDaily === null || merged.repeatDaily === undefined) merged.repeatDaily = false;
          if (merged.followUpFrequency === null || merged.followUpFrequency === undefined) merged.followUpFrequency = 10;

          const requiredFields = ['title', 'time', 'duration', 'quadrant'];
          const stillMissing = requiredFields.filter(f => merged[f] === null || merged[f] === undefined);
          if (stillMissing.length > 0) {
            pendingAction.data = merged;
            return {
              needsClarification: true,
              missingFields: stillMissing,
              message: `Still need: ${stillMissing.join(', ')}.`
            };
          }

          return await executeCreateTask(merged);
        } catch (clarifyErr) {
          console.error('Clarification parse error:', clarifyErr.message);
        }
      }

      // ── STRICT INTENT FORCING from raw message keywords ──
      const forced = detectForcedIntent(msg);
      if (forced) {
        // Part 7: Partial command guidance — if keyword matched but no title/target given
        if (TASK_TARGETING_INTENTS.includes(forced.intent) && !forced.title) {
          // Extract the keyword that matched from the message
          const keywordMatch = msg.trim().match(/^(\S+)/i);
          const keyword = keywordMatch ? keywordMatch[1] : null;
          const helpText = keyword ? getPartialCommandHelp(keyword) : null;
          if (helpText) {
            return { needsClarification: true, message: helpText };
          }
        }

        // For task-targeting intents, skip AI and go straight to resolution
        if (TASK_TARGETING_INTENTS.includes(forced.intent)) {
          const extra = {};
          // Check for carry type in the remaining message
          if (forced.intent === 'CARRY_OVER_TASK') {
            if (/\bfixed\b/i.test(msg)) {
              extra.carryType = 'fixed';
            } else if (/\bdynamic\b/i.test(msg)) {
              extra.carryType = 'dynamic';
            }
            // If no carryType specified, resolveTaskAction will prompt
          }
          return await resolveTaskAction(forced.intent, forced.title, extra);
        } else if (forced.intent === 'CLOSE_WINDOW' || forced.intent === 'OPEN_WINDOW') {
          let winName = null;
          if (forced.title) {
            const lower = forced.title.toLowerCase();
            if (lower.includes('all') || lower.includes('everything')) winName = 'all';
            else if (lower.includes('calendar') || lower.includes('calender')) winName = 'calendar';
            else if (lower.includes('ai')) winName = 'ai';
            else if (lower.includes('creation') || lower.includes('task creation')) winName = 'creation';
            else if (lower.includes('list') || lower.includes('task list')) winName = 'list';
            else if (lower.includes('report') || lower.includes('history') || lower.includes('analytic')) winName = 'report';
            else if (lower.includes('edit')) winName = 'edit';
          }
          return await handleAIIntent({ intent: forced.intent, window: winName }, msg);
        }
      }

      // Part 7: Partial command guidance for non-task-targeting keywords (show, open, history, report)
      const partialKeywordMatch = msg.trim().match(/^(show|open|history|report|create|change)$/i);
      if (partialKeywordMatch) {
        const helpText = getPartialCommandHelp(partialKeywordMatch[1]);
        if (helpText) {
          return { needsClarification: true, message: helpText };
        }
      }

      // ── Fresh AI intent parsing (only if no forced intent) ──
      const raw = await parseIntent(msg);
      const parsed = JSON.parse(raw);

      if (!parsed.intent || !ALLOWED_INTENTS.includes(parsed.intent)) {
        parsed.intent = 'UNKNOWN';
      }

      // Strip unexpected fields (safety)
      const allowed = {
        intent: true, title: true, date: true, time: true, duration: true, quadrant: true,
        repeatDaily: true, followUpFrequency: true, carryType: true, filter: true, window: true
      };
      for (const key of Object.keys(parsed)) {
        if (!allowed[key]) delete parsed[key];
      }

      return await handleAIIntent(parsed, msg);

    } catch (err) {
      console.error('AI handler error:', err.message);

      // API key missing
      if (err.message === 'API_KEY_MISSING') {
        return { error: '⚠️ API Key not set. Go to Home Page → API Key to set it up.' };
      }
      if (err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED')) {
        return { error: 'Cannot connect to AI service. Please check your internet connection.' };
      }
      if (err.message.includes('timeout')) {
        return { error: 'AI took too long to respond. Please try again.' };
      }
      return { error: 'AI unavailable or invalid response. Please try again.' };
    }
  }

  // ── AI MESSAGE IPC HANDLER (delegates to VoiceController) ──
  ipcMain.handle('ai:message', async (event, message) => {
    const VoiceController = require('./voice/core/VoiceController');
    const result = await VoiceController.handleVoiceInput(message);
    
    // For text chat, if there are buttons to render, we MUST NOT send needsClarification
    // because ai.html checks needsClarification first and skips button rendering.
    const hasButtons = result.needsConfirmation || result.needsOptionSelection || result.needsDisambiguation;
    
    if (result.success || result.needsClarification || hasButtons) {
      return { 
        success: result.success, 
        message: result.message, 
        tasks: result.tasks, 
        report: result.report,
        needsOptionSelection: result.needsOptionSelection,
        needsClarification: hasButtons ? undefined : result.needsClarification,
        needsDisambiguation: result.needsDisambiguation,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        matches: result.options // disambiguation uses matches in ai.html
      };
    } else {
      return { error: result.error || result.message || 'Error processing request.' };
    }
  });

  // IPC handlers for report and history
  ipcMain.handle('report:getByDate', async (event, dateStr) => {
    try {
      return await db.getReportByDate(dateStr);
    } catch (err) {
      console.error('Error getting report by date:', err);
      throw err;
    }
  });

  ipcMain.handle('history:getEvents', async (event, filters) => {
    try {
      return await db.getHistoryEvents(filters);
    } catch (err) {
      console.error('Error getting history events:', err);
      throw err;
    }
  });

  ipcMain.handle('analytics:getData', async (event, mode) => {
    try {
      return await db.getAnalyticsData(mode || 'date');
    } catch (err) {
      console.error('Error getting analytics data:', err);
      throw err;
    }
  });

  ipcMain.handle('analytics:getCarryOverTrend', async () => {
    try {
      return await db.getCarryOverTrend();
    } catch (err) {
      console.error('Error getting carry over trend:', err);
      throw err;
    }
  });

  // ── FLOATING ORB IPC HANDLERS ──
  
  // Toggle the panel visibility and position it near the orb
  let lastTogglePanelTime = 0;
  ipcMain.on('orb:toggle-panel', () => {
    const now = Date.now();
    if (now - lastTogglePanelTime < 400) return;
    lastTogglePanelTime = now;

    if (!orbWindow || orbWindow.isDestroyed() || !orbPanelWindow || orbPanelWindow.isDestroyed()) return;

    if (orbPanelWindow.isVisible()) {
      orbPanelWindow.webContents.send('panel:animate-out');
      setTimeout(() => {
        if (orbPanelWindow && !orbPanelWindow.isDestroyed()) {
          orbPanelWindow.hide();
        }
      }, 200);
    } else {
      // Use tracked position (reliable) instead of getBounds() (unreliable on Windows transparent windows)
      const ox = orbPos.x;
      const oy = orbPos.y;
      const ow = 60;  // orb window width
      const oh = 60;  // orb window height
      const pw = 300; // panel width
      const ph = 400; // panel height

      const display = screen.getDisplayNearestPoint({ x: ox, y: oy });
      const wa = display.workArea;

      const GAP = 8; // tight gap — panel feels attached to the orb

      // Orb center
      const cx = ox + ow / 2;
      const cy = oy + oh / 2;

      // Space on each side of the orb
      const spBelow = (wa.y + wa.height) - (oy + oh);
      const spAbove = oy - wa.y;
      const spRight = (wa.x + wa.width) - (ox + ow);
      const spLeft  = ox - wa.x;

      let px, py;

      // Priority: below → above → right → left
      if (spBelow >= ph + GAP) {
        py = oy + oh + GAP;
        px = cx - pw / 2;
      } else if (spAbove >= ph + GAP) {
        py = oy - ph - GAP - 6;  // extra buffer to avoid bottom edge overlapping the orb
        px = cx - pw / 2;
      } else if (spRight >= pw + GAP) {
        px = ox + ow + GAP;
        py = cy - ph / 2;
      } else if (spLeft >= pw + GAP) {
        px = ox - pw - GAP;
        py = cy - ph / 2;
      } else {
        // Fallback: below, let clamping handle it
        py = oy + oh + GAP;
        px = cx - pw / 2;
      }

      // Clamp to work area
      px = Math.max(wa.x, Math.min(px, wa.x + wa.width - pw));
      py = Math.max(wa.y, Math.min(py, wa.y + wa.height - ph));

      orbPanelWindow.setPosition(Math.round(px), Math.round(py));
      orbPanelWindow.showInactive();
      orbPanelWindow.webContents.send('panel:animate-in');
      // Removed setAlwaysOnTop(true) here because it forces a DWM z-order recalculation
      // which causes the window to flicker on Windows. The window is already created with alwaysOnTop: true.
    }
  });

  ipcMain.on('orb:close-panel', () => {
    if (orbPanelWindow && !orbPanelWindow.isDestroyed() && orbPanelWindow.isVisible()) {
      orbPanelWindow.webContents.send('panel:animate-out');
      setTimeout(() => {
        if (orbPanelWindow && !orbPanelWindow.isDestroyed()) {
          orbPanelWindow.hide();
        }
      }, 200);
    }
  });

  ipcMain.on('orb:move', (event, { x, y }) => {
    if (orbWindow && !orbWindow.isDestroyed()) {
      const posX = Math.round(x);
      const posY = Math.round(y);
      orbWindow.setPosition(posX, posY);
      orbPos = { x: posX, y: posY }; // track position reliably
      // If panel is visible, hide it on move
      if (orbPanelWindow && !orbPanelWindow.isDestroyed() && orbPanelWindow.isVisible()) {
        orbPanelWindow.webContents.send('panel:animate-out');
        setTimeout(() => {
          if (orbPanelWindow && !orbPanelWindow.isDestroyed()) {
            orbPanelWindow.hide();
          }
        }, 200);
      }
    }
  });

  ipcMain.on('orb:set-opacity', (event, value) => {
    currentOrbOpacity = value;
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.setOpacity(currentOrbOpacity);
    }
  });

  ipcMain.handle('orb:get-opacity', () => {
    return currentOrbOpacity;
  });

  // Toggle floating orb on/off from Settings
  ipcMain.handle('orb:set-enabled', async (event, enabled) => {
    const value = enabled ? 'true' : 'false';
    await db.setSetting('floatingOrbEnabled', value);

    if (enabled) {
      // Create orb windows if not already present
      createOrbWindow();
      createOrbPanelWindow();
    } else {
      // Destroy orb windows
      if (orbPanelWindow && !orbPanelWindow.isDestroyed()) {
        orbPanelWindow.close();
        orbPanelWindow = null;
      }
      if (orbWindow && !orbWindow.isDestroyed()) {
        orbWindow.close();
        orbWindow = null;
      }
    }
    return true;
  });

  // Toggle auto-start on system boot from Settings
  ipcMain.handle('autostart:set-enabled', async (event, enabled) => {
    const value = enabled ? 'true' : 'false';
    await db.setSetting('autoStartEnabled', value);

    // Update the actual Windows/macOS login item
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: ['--autostart']
    });

    console.log(`🚀 Auto-start on login ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  });

  // Helper to determine window states
  function getWindowStates() {
    return {
      home: homeWindow && !homeWindow.isDestroyed() && homeWindow.isVisible(),
      ai: aiWindow && !aiWindow.isDestroyed() && aiWindow.isVisible(),
      list: listWindow && !listWindow.isDestroyed() && listWindow.isVisible(),
      task: mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
      calendar: calendarWindow && !calendarWindow.isDestroyed() && calendarWindow.isVisible(),
      history: historyReportWindow && !historyReportWindow.isDestroyed() && historyReportWindow.isVisible()
    };
  }

  ipcMain.handle('orb:get-window-states', () => {
    return getWindowStates();
  });

  ipcMain.handle('orb:toggle-window', async (event, name) => {
    switch(name) {
      case 'home':
        if (homeWindow && !homeWindow.isDestroyed() && homeWindow.isVisible()) homeWindow.hide();
        else createHomeWindow();
        break;
      case 'ai':
        openAIWindow();
        break;
      case 'list':
        openListWindow();
        break;
      case 'task':
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) mainWindow.hide();
          else { mainWindow.show(); mainWindow.focus(); }
        } else createWindow();
        break;
      case 'calendar':
        openCalendarWindow();
        break;
      case 'history':
        openHistoryReportWindow();
        break;
    }
    notifyWindowStates();
    return true;
  });

  ipcMain.handle('orb:get-today-events', async () => {
    const events = await db.getTodayRecentEvents();
    const pendingTasks = await db.getTodayUpcomingTasks();
    return { recent: events, upcoming: pendingTasks };
  });

  // ═══════════════════════════════════════════════════════
  // 🎙️ VOICE ASSISTANT IPC HANDLERS
  // ═══════════════════════════════════════════════════════

  // Helper: Send a message to the orb window
  function notifyOrb(channel, data) {
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.webContents.send(channel, data);
    }
  }

  // Helper: Create or reuse the hidden voice processing window
  function getOrCreateVoiceWindow() {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      return voiceWindow;
    }

    voiceWindow = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,               // HIDDEN window — never shown to user
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        partition: 'voice-engine', // Dedicated session to avoid affecting other windows
      },
    });

    voiceWindow.loadFile('voice.html');

    voiceWindow.on('closed', () => {
      voiceWindow = null;
    });

    // Grant microphone permission for this window's dedicated session
    const voiceSession = voiceWindow.webContents.session;
    voiceSession.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === 'media') {
        callback(true); // Allow mic — user already consented via settings toggle
      } else {
        callback(false);
      }
    });
    // Also handle permission check (some Electron versions use this)
    voiceSession.setPermissionCheckHandler((wc, permission) => {
      if (permission === 'media') return true;
      return false;
    });

    return voiceWindow;
  }

  // Destroy voice window when feature is disabled
  function destroyVoiceWindow() {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.close();
      voiceWindow = null;
    }
    voiceConversationActive = false;
  }

  // ── VOICE ACTIVATION (from orb double-click) ──
  ipcMain.on('orb:voice-activate', async () => {
    console.log('🎙️ Voice activation requested');

    // Check if voice/mic is enabled in settings
    const voiceEnabled = await db.getSetting('voiceEnabled');
    if (voiceEnabled === 'false' || voiceEnabled === null || voiceEnabled === undefined) {
      console.log('🎙️ Voice is disabled in settings');
      notifyOrb('voice:permission-needed');
      return;
    }

    // If already in a voice session, stop it
    if (voiceConversationActive) {
      console.log('🎙️ Stopping active voice session');
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:force-stop');
      }
      notifyOrb('voice:stop');
      voiceConversationActive = false;
      return;
    }

    // Start voice session
    voiceConversationActive = true;
    notifyOrb('voice:start-listening');

    const vw = getOrCreateVoiceWindow();

    // Wait for voice window to be ready before sending start
    const sendStart = () => {
      if (vw && !vw.isDestroyed()) {
        vw.webContents.send('voice:start');
      }
    };

    if (vw.webContents.isLoading()) {
      vw.webContents.once('did-finish-load', sendStart);
    } else {
      sendStart();
    }
  });

  // ── VOICE: Listening started (from voice.html) ──
  ipcMain.on('voice:listening-started', () => {
    console.log('🎙️ Voice engine: listening started');
    notifyOrb('voice:start-listening');
  });

  // ── VOICE: Speaking started (from voice.html) ──
  ipcMain.on('voice:speaking-started', () => {
    console.log('🎙️ Voice engine: speaking started');
    notifyOrb('voice:start-speaking');
  });

  // ── VOICE: Transcript received — route through AI intent handler ──
  ipcMain.on('voice:transcript', async (event, text) => {
    console.log('🎙️ Voice transcript received:', text);

    if (!text || !text.trim()) {
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:response', {
          message: 'I didn\'t catch that. Could you say that again?',
          needsClarification: true
        });
      }
      return;
    }

    try {
      // Notify orb: processing (still in listening/thinking state)
      notifyOrb('voice:start-speaking');

      // Route through the new modular Voice Pipeline
      const VoiceController = require('./voice/core/VoiceController');
      const result = await VoiceController.handleVoiceInput(text);

      console.log('🎙️ AI result for voice:', JSON.stringify(result).substring(0, 200));

      // Send result to voice window for speech synthesis
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:response', result);
      }
    } catch (err) {
      console.error('🎙️ Voice processing error:', err);
      const errMsg = (err.message || '') + (err.cause ? ` ${err.cause.message || ''}` : '');
      const errCode = err.code || (err.cause && err.cause.code) || '';
      const CONNECTIVITY_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'];
      let userMessage = 'Sorry, I encountered an error processing your request. Please try again.';
      if (CONNECTIVITY_ERRORS.some(code => errMsg.includes(code) || errCode === code)) {
        userMessage = "It looks like I can't reach the internet right now. My brain needs an internet connection to work. Please check your connection and try again.";
      } else if (errMsg.includes('API_KEY_MISSING') || errMsg.includes('apiKey')) {
        userMessage = 'I need an API key to function. Please go to the Home page and set up your Groq API key in the settings.';
      }
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:response', { error: userMessage });
      }
    }
  });

  // ── VOICE: Audio received — transcribe via Groq Whisper then route ──
  ipcMain.on('voice:audio', async (event, arrayBuffer) => {
    console.log('🎙️ Voice audio buffer received, size:', arrayBuffer.byteLength);
    
    // Notify orb: processing (still in listening/thinking state)
    notifyOrb('voice:start-speaking');
    
    try {
      const fs = require('fs');
      const os = require('os');
      const tempFilePath = path.join(os.tmpdir(), `voice_recording_${Date.now()}.webm`);
      
      // Write the audio buffer to a temporary file
      fs.writeFileSync(tempFilePath, Buffer.from(arrayBuffer));
      
      console.log('🎙️ Audio saved to temp file, transcribing...');
      
      // Transcribe using Groq Whisper
      const { transcribeAudio } = require('./AIService');
      const transcript = await transcribeAudio(tempFilePath);
      
      // Clean up the temp file
      try {
        fs.unlinkSync(tempFilePath);
      } catch(e) {
        console.error('Failed to delete temp audio file:', e);
      }
      
      console.log('🎙️ Groq Whisper transcript:', transcript);
      
      if (!transcript || !transcript.trim()) {
        if (voiceWindow && !voiceWindow.isDestroyed()) {
          voiceWindow.webContents.send('voice:response', {
            message: 'I didn\'t catch that. Could you say that again?',
            needsClarification: true
          });
        }
        return;
      }
      
      // Route through the new modular Voice Pipeline
      const VoiceController = require('./voice/core/VoiceController');
      const result = await VoiceController.handleVoiceInput(transcript);
      
      console.log('🎙️ AI result for voice:', JSON.stringify(result).substring(0, 200));
      
      // Send result to voice window for speech synthesis
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:response', result);
      }
      
    } catch (err) {
      console.error('🎙️ Voice processing/transcription error:', err);
      const errMsg = (err.message || '') + (err.cause ? ` ${err.cause.message || ''}` : '');
      const errCode = err.code || (err.cause && err.cause.code) || '';
      const CONNECTIVITY_ERRORS = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH'];
      let userMessage = 'Sorry, I encountered an error transcribing or processing your request. Please try again.';
      if (CONNECTIVITY_ERRORS.some(code => errMsg.includes(code) || errCode === code)) {
        userMessage = "It looks like I can't reach the internet right now. My brain needs an internet connection to work. Please check your connection and try again.";
      } else if (errMsg.includes('API_KEY_MISSING') || errMsg.includes('apiKey')) {
        userMessage = 'I need an API key to function. Please go to the Home page and set up your Groq API key in the settings.';
      }
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.webContents.send('voice:response', { error: userMessage });
      }
    }
  });

  // ── VOICE: Done speaking (from voice.html) ──
  ipcMain.on('voice:done', () => {
    console.log('🎙️ Voice session: done');
    voiceConversationActive = false;
    notifyOrb('voice:stop');
  });

  // ── VOICE: Error (from voice.html) ──
  ipcMain.on('voice:error', (event, errorMsg) => {
    console.error('🎙️ Voice error:', errorMsg);
    voiceConversationActive = false;
    notifyOrb('voice:stop');
  });

  /**
   * Handle voice message through the AI system.
   * Routes through the existing, fully-featured processAIMessage pipeline
   * which handles ALL intents (open/close windows, create/complete/delete tasks,
   * show reports, show history, close all, carry over, etc.).
   */
  async function handleVoiceMessage(message) {
    try {
      if (VoiceController.isInitialized) {
        try {
          const modularResult = await VoiceController.handleVoiceInput(message);
          // If the modular pipeline successfully executed something or needs clarification, return its result
          if (modularResult && !modularResult.error && modularResult.message && modularResult.message !== "I didn't catch any actionable commands from that.") {
             return modularResult;
          }
        } catch (e) {
          console.error("VoiceController fallback to processAIMessage due to error:", e);
        }
      }
      return await processAIMessage(message);
    } catch (err) {
      console.error('🎙️ handleVoiceMessage error:', err);
      return { error: 'I had trouble processing that. Please try again.' };
    }
  }

  // ═══════════════════════════════════════════════════════
  // END VOICE ASSISTANT
  // ═══════════════════════════════════════════════════════

  // GLOBAL HOTKEY: Ctrl+Shift+T
  const ok = globalShortcut.register('Control+Shift+T', () => {
    if (!mainWindow) {
      createWindow();
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();          // toggle: hide if visible
    } else {
      mainWindow.show();          // show if hidden
      mainWindow.focus();
    }
  });

  if (!ok) {
    console.log('Global shortcut registration failed');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ⭐ AUTO CARRY-OVER AT 11:59 PM
let autoCarryOverDoneToday = false;

setInterval(async () => {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();

  // Reset flag at midnight (new day)
  if (h === 0 && m === 0) {
    autoCarryOverDoneToday = false;
  }

  // Trigger at 11:59 PM, once per day
  if (h === 23 && m === 59 && !autoCarryOverDoneToday) {
    autoCarryOverDoneToday = true;
    console.log('🕐 11:59 PM! Auto-carrying pending tasks...');

    const pending = await db.getPendingTasksAtClosing();
    for (const task of pending) {
      // Clear existing timers for this task
      const t1 = reminderTimers.get(task.id);
      if (t1) { clearTimeout(t1); reminderTimers.delete(task.id); }
      const t2 = followupTimers.get(task.id);
      if (t2) { clearInterval(t2); followupTimers.delete(task.id); }

      // Carry over with 'dynamic' type (just tomorrow)
      const durationMs = (task.duration || 10) * 60 * 1000;
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      const newDueAt = tomorrow.toISOString();
      const newRemindAt = new Date(tomorrow.getTime() - durationMs).toISOString();
      const carryOverCount = (task.carryOverCount || 0) + 1;

      await db.carryOverTask(task.id, newDueAt, newRemindAt, carryOverCount, 'dynamic');

      // Log auto carry-over event
      await db.insertTaskEvent({
        task_id: task.id,
        task_title: task.task,
        priority: task.quadrant,
        action_type: 'Auto Carry Over',
        timestamp: new Date().toISOString(),
        notes: 'Auto carry-over at 11:59 PM (dynamic)'
      });

      console.log(`✅ Auto-carried ${task.id}: ${task.task}`);
      // Task is now carried over — NO follow-ups tonight.
      // Reminders & follow-ups will start on the next day via rescheduleCarriedOverTasks()
    }
  }
}, 60 * 1000); // Check every minute


// cleanup on quit
app.on('will-quit', () => {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', (event) => {
  event.preventDefault(); // 🔥 keep app running
});

} // End of single-instance lock else block