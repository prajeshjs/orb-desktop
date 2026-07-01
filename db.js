// db.js
const sqlite3 = require('sqlite3').verbose();
//const path = require('path');


const { app } = require('electron');
const path = require('path');

let db; // global db

async function initDB() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'tasks.db');

  db = new sqlite3.Database(dbPath);
  // create table
db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task TEXT NOT NULL,
      time TEXT NOT NULL,
      duration INTEGER NOT NULL,
      quadrant INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      dueAt TEXT NOT NULL,
      remindAt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',

      isCarryOver INTEGER DEFAULT 0,
      carryOverCount INTEGER DEFAULT 0,
      originalCreatedAt TEXT,
      carryOverFromDate TEXT,
      carryOverDates TEXT,
      completedAt TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS TaskEvents (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      task_title TEXT,
      priority INTEGER,
      action_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      notes TEXT
    )
  `);

});


// Run migration on startup
await addCarryOverColumns();

  return db;
}

// create table


// ADD THESE FUNCTIONS after markTaskCompleted()
function getSetting(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
      if (err) return reject(err);
      resolve(row ? row.value : null);
    });
  });
}

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}


// ⭐ PHASE 3: Add carry-over columns if not exist
function addCarryOverColumns() {
  return new Promise(async (resolve) => {
    // Column 1: firstFollowUpAt
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN firstFollowUpAt TEXT DEFAULT NULL`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ firstFollowUpAt column already exists');
        } else if (err) {
          console.log('⚠️ firstFollowUpAt:', err.message);
        } else {
          console.log('✅ Added firstFollowUpAt column');
        }
        res();
      });
    });

    // Column 2: carryOverType
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN carryOverType TEXT DEFAULT NULL`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ carryOverType column already exists');
        } else if (err) {
          console.log('⚠️ carryOverType:', err.message);
        } else {
          console.log('✅ Added carryOverType column');
        }
        res();
      });
    });

    // Column 3: carryOverOriginalTime
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN carryOverOriginalTime TEXT DEFAULT NULL`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ carryOverOriginalTime column already exists');
        } else if (err) {
          console.log('⚠️ carryOverOriginalTime:', err.message);
        } else {
          console.log('✅ Added carryOverOriginalTime column');
        }
        res();
      });
    });

    // Column 4: repeatDaily
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN repeatDaily INTEGER DEFAULT 0`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ repeatDaily column already exists');
        } else if (err) {
          console.log('⚠️ repeatDaily:', err.message);
        } else {
          console.log('✅ Added repeatDaily column');
        }
        res();
      });
    });

    // Column 5: repeatSourceId (links daily instances back to the template task)
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN repeatSourceId INTEGER DEFAULT NULL`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ repeatSourceId column already exists');
        } else if (err) {
          console.log('⚠️ repeatSourceId:', err.message);
        } else {
          console.log('✅ Added repeatSourceId column');
        }
        res();
      });
    });

    // Column 6: follow_up_frequency (minutes between follow-up reminders, default 10)
    await new Promise((res) => {
      db.run(`ALTER TABLE tasks ADD COLUMN follow_up_frequency INTEGER DEFAULT 10`, (err) => {
        if (err && err.message.includes('duplicate column')) {
          console.log('✅ follow_up_frequency column already exists');
        } else if (err) {
          console.log('⚠️ follow_up_frequency:', err.message);
        } else {
          console.log('✅ Added follow_up_frequency column');
        }
        res();
      });
    });

    resolve();
  });
}







function insertTask(taskData) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO tasks (task, time, duration, quadrant, createdAt, dueAt, remindAt, status, repeatDaily, repeatSourceId, follow_up_frequency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(
      sql,
      [
        taskData.task,
        taskData.time,
        taskData.duration,
        taskData.quadrant,
        taskData.createdAt,
        taskData.dueAt,
        taskData.remindAt,
        'pending',
        taskData.repeatDaily || 0,
        taskData.repeatSourceId || null,
        taskData.followUpFrequency || 10,
      ],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}



function getAllTasks() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM tasks ORDER BY id DESC', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getAllFutureTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE date(dueAt) >= date('now')
      ORDER BY dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getTodayTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE date(dueAt) = date('now')
      ORDER BY dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function markTaskCompleted(id) {
  return new Promise((resolve, reject) => {
    const now = new Date().toISOString();
    const sql = `
      UPDATE tasks
      SET status = 'completed', completedAt = ?
      WHERE id = ?
    `;
    db.run(sql, [now, id], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

function reopenTask(id) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tasks
      SET status = 'pending', completedAt = NULL
      WHERE id = ?
    `;
    db.run(sql, [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

// ADD THIS after markTaskCompleted()
function deleteTask(id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM tasks WHERE id = ?';
    db.run(sql, [id], function (err) {
      if (err) return reject(err);
      resolve(this.changes);  // Number of rows deleted (1 or 0)
    });
  });
}

// NEW: Update task fields (task, duration, quadrant, time, repeatDaily, follow_up_frequency)
function updateTask(id, data) {
  return new Promise((resolve, reject) => {
    const repeatDaily = data.repeatDaily !== undefined ? data.repeatDaily : 0;
    const followUpFrequency = data.followUpFrequency !== undefined ? data.followUpFrequency : 10;
    const sql = `
      UPDATE tasks 
      SET task = ?, duration = ?, quadrant = ?, time = ?, repeatDaily = ?, follow_up_frequency = ?
      WHERE id = ?
    `;
    db.run(sql, [data.task, data.duration, data.quadrant, data.time, repeatDaily, followUpFrequency, id], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

// NEW: Update only dueAt/remindAt timestamps
function updateTaskTimes(id, dueAt, remindAt) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tasks 
      SET dueAt = ?, remindAt = ?
      WHERE id = ?
    `;
    db.run(sql, [dueAt, remindAt, id], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

// ⭐ PHASE 3: Get pending tasks that need carry-over at closing time
function getPendingTasksAtClosing() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE (status = 'pending' OR status = 'carried_over') 
      AND date(dueAt) <= date('now')
      AND (repeatDaily = 0 OR repeatDaily IS NULL)
      ORDER BY dueAt DESC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ⭐ PHASE 3: Get today's tasks separated by carry-over
function getTodayTasksSeparated() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE 
        -- Tasks that are actually due today and NOT carried over
        (date(dueAt) = date('now') AND isCarryOver = 0)
        OR
        -- Tasks carried over FROM today (their dueAt is tomorrow but they were carried over today)
        (isCarryOver = 1 AND date(carryOverFromDate) = date('now'))
        OR
        -- Fallback: carried-over tasks whose original time was today
        (isCarryOver = 1 AND date(carryOverOriginalTime) = date('now'))
        OR
        -- Carried over tasks that are due today or earlier and still pending/carried_over
        (isCarryOver = 1 AND date(dueAt) <= date('now') AND (status = 'carried_over' OR status = 'pending'))
        OR
        -- Carried over tasks that were completed today
        (isCarryOver = 1 AND status = 'completed' AND date(completedAt) = date('now'))
      ORDER BY 
        isCarryOver DESC,
        dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);

      // De-duplicate (a task might match multiple OR conditions)
      const seen = new Set();
      const unique = [];
      if (rows) {
        for (const r of rows) {
          if (!seen.has(r.id)) {
            seen.add(r.id);
            unique.push(r);
          }
        }
      }

      const carryOvers = unique.filter(t => t.isCarryOver === 1 || t.status === 'carried_over');
      const todayTasks = unique.filter(t => t.isCarryOver === 0 && t.status !== 'carried_over');

      resolve({
        carryOvers,
        todayTasks
      });
    });
  });
}

// ⭐ PHASE 3: Mark task as carried over (with type)
function carryOverTask(id, newDueAt, newRemindAt, carryOverCount, carryOverType) {
  return new Promise((resolve, reject) => {
    // Get original dueAt/remindAt before updating
    db.get(`SELECT dueAt, remindAt FROM tasks WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error('Task not found'));

      // Calculate first follow-up time
      // For Option 1 (fixed): firstFollowUpAt = reminder time + 10 mins
      // For Option 2 (dynamic): firstFollowUpAt = NULL (calculated on boot)
      const firstFollowUpTime = carryOverType === 'fixed'
        ? new Date(new Date(newRemindAt).getTime() + 10 * 60 * 1000).toISOString()
        : null;

      // Store today's date so getTodayTasksSeparated() can find this task
      const todayDate = new Date().toISOString();

      const sql = `
        UPDATE tasks
        SET 
          isCarryOver = 1,
          carryOverCount = ?,
          carryOverType = ?,
          carryOverOriginalTime = ?,
          carryOverFromDate = ?,
          dueAt = ?,
          remindAt = ?,
          firstFollowUpAt = ?,
          status = 'carried_over'
        WHERE id = ?
      `;

      db.run(sql, [
        carryOverCount,
        carryOverType,
        row.dueAt,  // Save original time for undo
        todayDate,  // When the carry-over was performed
        newDueAt,
        newRemindAt,
        firstFollowUpTime,
        id
      ], function (err) {
        if (err) return reject(err);

        console.log(`🔄 Task ${id} carried over (${carryOverType}), status set to carried_over`);
        resolve(this.changes);
      });
    });
  });
}

// ⭐ PHASE 3: Undo carry-over and restore to original time
function undoCarryOver(id) {
  return new Promise((resolve, reject) => {
    // Get the original time from carryOverOriginalTime
    db.get(
      `SELECT carryOverOriginalTime, duration, carryOverCount FROM tasks WHERE id = ?`,
      [id],
      (err, row) => {
        if (err) return reject(err);

        if (!row || !row.carryOverOriginalTime) {
          return reject(new Error('Task has no carry-over record'));
        }

        // Calculate reminder time from original dueAt
        const originalDueAt = new Date(row.carryOverOriginalTime);
        const durationMs = row.duration * 60 * 1000;
        const remindAt = new Date(originalDueAt.getTime() - durationMs);
        const newCount = Math.max(0, (row.carryOverCount || 1) - 1);

        // Restore to original time and reset all carry-over flags
        const sql = `
          UPDATE tasks SET
            isCarryOver = 0,
            carryOverType = NULL,
            carryOverOriginalTime = NULL,
            carryOverFromDate = NULL,
            firstFollowUpAt = NULL,
            carryOverCount = ?,
            status = 'pending',
            dueAt = ?,
            remindAt = ?
          WHERE id = ?
        `;

        db.run(
          sql,
          [
            newCount,
            originalDueAt.toISOString(),
            remindAt.toISOString(),
            id
          ],
          function (err) {
            if (err) return reject(err);

            console.log(`↺ Task ${id} carry-over undone, status restored to pending`);
            console.log(`   Restored to: ${originalDueAt.toLocaleString()}`);

            resolve({
              taskId: id,
              isCarryOver: 0,
              status: 'pending',
              dueAt: originalDueAt.toISOString(),
              remindAt: remindAt.toISOString()
            });
          }
        );
      }
    );
  });
}




// ⭐ PHASE 3: Update carry-over task (editing)
function updateCarryOverTask(id, data) {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE tasks
      SET 
        task = ?,
        duration = ?,
        quadrant = ?,
        time = ?,
        dueAt = ?,
        remindAt = ?
      WHERE id = ?
    `;

    db.run(sql, [
      data.task,
      data.duration,
      data.quadrant,
      data.time,
      data.dueAt,
      data.remindAt,
      id
    ], function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

// ⭐ PHASE 3: Get today's performance report
function getTodayPerformanceReport() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        isCarryOver,
        status,
        COUNT(*) as count
      FROM tasks
      WHERE date(dueAt) = date('now')
      GROUP BY isCarryOver, status
    `;

    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);

      const report = {
        carryOver: {
          pending: 0,
          completed: 0,
          deleted: 0
        },
        today: {
          pending: 0,
          completed: 0,
          deleted: 0
        }
      };

      if (rows) {
        rows.forEach(row => {
          const section = row.isCarryOver === 1 ? 'carryOver' : 'today';
          report[section][row.status] = row.count;
        });
      }

      resolve(report);
    });
  });
}

// Get a single task by id (for carry-over flow)
function getTaskById(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

// Get carried-over tasks that need activation on startup (due today or earlier)
function getCarriedOverTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks 
      WHERE isCarryOver = 1 
      AND status = 'carried_over'
      AND date(dueAt) <= date('now')
      ORDER BY dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Activate a carried-over task: set status back to 'pending' while keeping isCarryOver=1
// This makes the task appear as a normal pending task with the 🚩 flag on the next day
function activateCarriedOverTask(id, newDueAt = null, newRemindAt = null, newTime = null) {
  return new Promise((resolve, reject) => {
    let sql = `
      UPDATE tasks
      SET status = 'pending'
    `;
    const params = [];
    if (newDueAt && newRemindAt && newTime) {
      sql += `, dueAt = ?, remindAt = ?, time = ?`;
      params.push(newDueAt, newRemindAt, newTime);
    }
    sql += ` WHERE id = ? AND status = 'carried_over'`;
    params.push(id);
    
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      console.log(`✅ Activated carried-over task ${id}: status -> pending (isCarryOver still 1)`);
      resolve(this.changes);
    });
  });
}

// Get ALL carried-over tasks regardless of date (for AI chatbot listing/searching)
function getAllCarriedOverTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks 
      WHERE isCarryOver = 1 
      AND (status = 'carried_over' OR status = 'pending')
      ORDER BY dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}





// Get all repeat-daily tasks
function getRepeatDailyTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE repeatDaily = 1
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// Reset a repeat-daily task for today (same row, new dueAt/remindAt, status=pending)
function resetRepeatTaskForToday(id, time, duration) {
  return new Promise((resolve, reject) => {
    const [h, m] = time.split(':').map(Number);
    const today = new Date();
    today.setHours(h, m, 0, 0);

    const durationMs = duration * 60 * 1000;
    const remindAt = new Date(today.getTime() - durationMs);

    const sql = `
      UPDATE tasks
      SET dueAt = ?, remindAt = ?, status = 'pending',
          isCarryOver = 0, carryOverType = NULL,
          carryOverOriginalTime = NULL, carryOverFromDate = NULL,
          firstFollowUpAt = NULL
      WHERE id = ?
    `;
    db.run(sql, [today.toISOString(), remindAt.toISOString(), id], function (err) {
      if (err) return reject(err);
      console.log(`🔁 Reset repeat task ${id} for today`);
      resolve(this.changes);
    });
  });
}

// ===== TaskEvents functions =====

function insertTaskEvent(data) {
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO TaskEvents (task_id, task_title, priority, action_type, timestamp, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [
      data.task_id || null,
      data.task_title || '',
      data.priority || null,
      data.action_type,
      data.timestamp || new Date().toISOString(),
      data.notes || null
    ], function (err) {
      if (err) return reject(err);
      resolve(this.lastID);
    });
  });
}

function getReportByDate(dateStr) {
  // dateStr should be YYYY-MM-DD
  return new Promise((resolve, reject) => {
    // Overview: count by action_type for the given date
    const overviewSql = `
      SELECT action_type, COUNT(*) as count
      FROM TaskEvents
      WHERE date(timestamp) = ?
      GROUP BY action_type
    `;
    db.all(overviewSql, [dateStr], (err, eventRows) => {
      if (err) return reject(err);

      // Priority breakdown: created, completed, not completed per priority
      const prioritySql = `
        SELECT priority, action_type, COUNT(*) as count
        FROM TaskEvents
        WHERE date(timestamp) = ? AND priority IS NOT NULL
        GROUP BY priority, action_type
      `;
      db.all(prioritySql, [dateStr], (err2, prioRows) => {
        if (err2) return reject(err2);

        // Build overview
        const overview = {
          totalCreated: 0,
          totalCompleted: 0,
          totalNotCompleted: 0,
          totalCarriedOver: 0,
          totalDeleted: 0
        };

        if (eventRows) {
          eventRows.forEach(r => {
            if (r.action_type === 'Task Created') overview.totalCreated += r.count;
            if (r.action_type === 'Marked Completed') overview.totalCompleted += r.count;
            if (r.action_type === 'Marked Not Completed') overview.totalNotCompleted += r.count;
            if (r.action_type === 'Carry Over Selected') overview.totalCarriedOver += r.count;
            if (r.action_type === 'Deleted') overview.totalDeleted += r.count;
          });
        }

        // Calculate not-completed as: created - completed (if no explicit "Marked Not Completed" events)
        // But also keep explicit Marked Not Completed count
        if (overview.totalNotCompleted === 0 && overview.totalCreated > 0) {
          overview.totalNotCompleted = Math.max(0, overview.totalCreated - overview.totalCompleted - overview.totalDeleted - overview.totalCarriedOver);
        }

        // Completion percentage
        overview.completionPercent = overview.totalCreated > 0
          ? Math.round((overview.totalCompleted / overview.totalCreated) * 100)
          : 0;

        // Build priority breakdown
        const priorityBreakdown = {};
        [1, 2, 3, 4].forEach(p => {
          priorityBreakdown[p] = { created: 0, completed: 0, notCompleted: 0 };
        });

        if (prioRows) {
          prioRows.forEach(r => {
            const p = r.priority;
            if (!priorityBreakdown[p]) priorityBreakdown[p] = { created: 0, completed: 0, notCompleted: 0 };
            if (r.action_type === 'Task Created') priorityBreakdown[p].created += r.count;
            if (r.action_type === 'Marked Completed') priorityBreakdown[p].completed += r.count;
            if (r.action_type === 'Marked Not Completed') priorityBreakdown[p].notCompleted += r.count;
          });
        }

        // Calculate not-completed per priority
        [1, 2, 3, 4].forEach(p => {
          if (priorityBreakdown[p].notCompleted === 0 && priorityBreakdown[p].created > 0) {
            priorityBreakdown[p].notCompleted = Math.max(0,
              priorityBreakdown[p].created - priorityBreakdown[p].completed);
          }
        });

        resolve({ overview, priorityBreakdown });
      });
    });
  });
}

function getHistoryEvents(filters = {}) {
  return new Promise((resolve, reject) => {
    let sql = 'SELECT * FROM TaskEvents WHERE 1=1';
    const params = [];

    if (filters.date) {
      sql += ' AND date(timestamp) = ?';
      params.push(filters.date);
    }
    if (filters.priority) {
      sql += ' AND priority = ?';
      params.push(filters.priority);
    }
    if (filters.action_type) {
      sql += ' AND action_type = ?';
      params.push(filters.action_type);
    }
    if (filters.search) {
      sql += ' AND task_title LIKE ?';
      params.push(`%${filters.search}%`);
    }

    sql += ' ORDER BY timestamp DESC LIMIT 500';

    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ===== Analytics Data for Productivity Dashboard =====

function getAnalyticsData(mode = 'date') {
  return new Promise((resolve, reject) => {
    const actionMap = {
      'Task Created': 'created',
      'Marked Completed': 'completed',
      'Deleted': 'deleted',
      'Carry Over Selected': 'carryOver',
      'Auto Carry Over': 'carryOver',
    };
    const relevantActions = Object.keys(actionMap);
    const placeholders = relevantActions.map(() => '?').join(',');

    // 1) Activity data — grouped by hour/day/month (LOCAL time)
    let groupExpr, labelExpr;
    if (mode === 'week') {
      // strftime('%w') gives 0=Sunday..6=Saturday; we remap to Mon=0..Sun=6 in JS
      groupExpr = `strftime('%w', timestamp, 'localtime')`;
      labelExpr = groupExpr;
    } else if (mode === 'month') {
      groupExpr = `strftime('%m', timestamp, 'localtime')`;
      labelExpr = groupExpr;
    } else {
      // date mode — hours of today (local time)
      groupExpr = `strftime('%H', timestamp, 'localtime')`;
      labelExpr = groupExpr;
    }

    let dateFilter = '';
    const dateParams = [];
    if (mode === 'date') {
      dateFilter = `AND date(timestamp, 'localtime') = date('now', 'localtime')`;
    } else if (mode === 'week') {
      dateFilter = `AND date(timestamp, 'localtime') >= date('now', 'localtime', '-6 days')`;
    }
    // month mode: all data (current year implied by volume)

    const activitySql = `
      SELECT ${labelExpr} as label, action_type, COUNT(*) as count
      FROM TaskEvents
      WHERE action_type IN (${placeholders}) ${dateFilter}
      GROUP BY label, action_type
    `;

    db.all(activitySql, [...relevantActions, ...dateParams], (err, actRows) => {
      if (err) return reject(err);

      // 2) Heatmap — last 7 days, hour by hour (local time)
      const heatmapSql = `
        SELECT strftime('%w', timestamp, 'localtime') as dow,
               strftime('%H', timestamp, 'localtime') as hour,
               COUNT(*) as count
        FROM TaskEvents
        WHERE action_type = 'Marked Completed'
          AND date(timestamp, 'localtime') >= date('now', 'localtime', '-6 days')
        GROUP BY dow, hour
      `;

      db.all(heatmapSql, [], (err2, heatRows) => {
        if (err2) return reject(err2);

        // 3) Priority matrix — today only (local time)
        const matrixSql = `
          SELECT priority, action_type, COUNT(*) as count
          FROM TaskEvents
          WHERE action_type IN (${placeholders})
            AND date(timestamp, 'localtime') = date('now', 'localtime')
            AND priority IS NOT NULL
          GROUP BY priority, action_type
        `;

        db.all(matrixSql, [...relevantActions], (err3, matrixRows) => {
          if (err3) return reject(err3);

          // 4) Priority distribution — all time
          const distSql = `
            SELECT priority, action_type, COUNT(*) as count
            FROM TaskEvents
            WHERE action_type IN (${placeholders})
              AND priority IS NOT NULL
            GROUP BY priority, action_type
          `;

          db.all(distSql, [...relevantActions], (err4, distRows) => {
            if (err4) return reject(err4);

            // Build activity data
            const activity = {};
            if (actRows) {
              actRows.forEach(r => {
                const key = r.label;
                if (!activity[key]) activity[key] = { created: 0, completed: 0, deleted: 0, carryOver: 0 };
                const mapped = actionMap[r.action_type];
                if (mapped) activity[key][mapped] += r.count;
              });
            }

            // Build heatmap
            const heatmap = {};
            if (heatRows) {
              heatRows.forEach(r => {
                const k = `${r.dow}-${r.hour}`;
                heatmap[k] = (heatmap[k] || 0) + r.count;
              });
            }

            // Build priority matrix
            const matrix = {};
            [1, 2, 3, 4].forEach(p => {
              matrix[p] = { created: 0, completed: 0, deleted: 0, carryOver: 0 };
            });
            if (matrixRows) {
              matrixRows.forEach(r => {
                if (!matrix[r.priority]) matrix[r.priority] = { created: 0, completed: 0, deleted: 0, carryOver: 0 };
                const mapped = actionMap[r.action_type];
                if (mapped) matrix[r.priority][mapped] += r.count;
              });
            }

            // Build priority distribution
            const distribution = {};
            [1, 2, 3, 4].forEach(p => {
              distribution[p] = { created: 0, completed: 0, deleted: 0, carryOver: 0 };
            });
            if (distRows) {
              distRows.forEach(r => {
                if (!distribution[r.priority]) distribution[r.priority] = { created: 0, completed: 0, deleted: 0, carryOver: 0 };
                const mapped = actionMap[r.action_type];
                if (mapped) distribution[r.priority][mapped] += r.count;
              });
            }

            resolve({ activity, heatmap, matrix, distribution });
          });
        });
      });
    });
  });
}

// ===== Carry Over Trend Data =====

function getCarryOverTrend() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT strftime('%w', timestamp, 'localtime') as dow,
             action_type,
             notes,
             COUNT(*) as count
      FROM TaskEvents
      WHERE action_type IN ('Carry Over Selected', 'Auto Carry Over', 'Undo Carry Over')
      GROUP BY dow, action_type,
        CASE
          WHEN action_type = 'Carry Over Selected' AND notes LIKE '%fixed%' THEN 'fixed'
          WHEN action_type = 'Carry Over Selected' AND notes LIKE '%dynamic%' THEN 'dynamic'
          ELSE action_type
        END
    `;

    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);

      // Build result keyed by dow (0=Sun, 1=Mon, ..., 6=Sat)
      const trend = {};
      for (let i = 0; i < 7; i++) {
        trend[i.toString()] = { fixed: 0, dynamic: 0, auto: 0, undo: 0 };
      }

      if (rows) {
        rows.forEach(r => {
          let dayObj = trend[r.dow];
          if (!dayObj) return;

          if (r.action_type === 'Undo Carry Over') {
            dayObj.undo += r.count;
          } else if (r.action_type === 'Auto Carry Over') {
            dayObj.auto += r.count;
          } else if (r.action_type === 'Carry Over Selected') {
            if (r.notes && r.notes.toLowerCase().includes('fixed')) {
              dayObj.fixed += r.count;
            } else {
              dayObj.dynamic += r.count;
            }
          }
        });
      }

      resolve(trend);
    });
  });
}

// Get pending tasks from previous day only (not carried over, not repeat-daily)
function getPreviousDayPendingTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM tasks
      WHERE (status = 'pending' OR status = 'carried_over')
      AND date(dueAt) < date('now')
      AND (repeatDaily = 0 OR repeatDaily IS NULL)
      ORDER BY dueAt ASC
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ===== Floating Orb: Today's Recent Events (completions) =====
function getTodayRecentEvents() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT task_title, action_type, timestamp
      FROM TaskEvents
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
        AND action_type = 'Marked Completed'
      ORDER BY timestamp DESC
      LIMIT 30
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// ===== Floating Orb: Today's Upcoming Tasks (pending with future remindAt) =====
function getTodayUpcomingTasks() {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, task, remindAt, dueAt, quadrant
      FROM tasks
      WHERE (status = 'pending' OR status = 'carried_over')
        AND date(dueAt) = date('now')
        AND remindAt > datetime('now')
      ORDER BY remindAt ASC
      LIMIT 30
    `;
    db.all(sql, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

// UPDATE module.exports at the bottom
module.exports = {
  initDB, // ⭐ ADD THIS
  insertTask,
  getAllTasks,
  getAllFutureTasks,
  getTodayTasks,
  getTodayTasksSeparated,
  getPendingTasksAtClosing,
  markTaskCompleted,
  reopenTask,
  getSetting,
  setSetting,
  deleteTask,
  updateTask,
  updateTaskTimes,
  carryOverTask,
  undoCarryOver,
  updateCarryOverTask,
  getTodayPerformanceReport,
  getCarriedOverTasks,
  getAllCarriedOverTasks,
  activateCarriedOverTask,
  getTaskById,
  getRepeatDailyTasks,
  resetRepeatTaskForToday,
  insertTaskEvent,
  getReportByDate,
  getHistoryEvents,
  getAnalyticsData,
  getCarryOverTrend,
  getPreviousDayPendingTasks,
  getTodayRecentEvents,
  getTodayUpcomingTasks,
};

