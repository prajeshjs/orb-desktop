const BaseCapability = require('../BaseCapability');

// ─────────────────────────────────────────────────────────
// STOP VOICE — Cleanly end the voice session
// ─────────────────────────────────────────────────────────
class StopVoiceCapability extends BaseCapability {
  describe() {
    return {
      name: 'Stop Voice',
      intent: 'STOP_VOICE',
      category: 'Assistant',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: [],
      optionalEntities: [],
      priority: 1 // Highest priority — execute first
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.stopVoice) {
      await context.appAdapter.stopVoice();
    }
    return {
      actionId: action.id,
      status: 'SUCCESS',
      message: 'Voice assistant stopped. Talk to you later!',
      data: { stopped: true },
      recoverable: false
    };
  }
}

// ─────────────────────────────────────────────────────────
// ASK QUESTION — Answer questions about the app, usage, shortcuts, help
// ─────────────────────────────────────────────────────────
class AskQuestionCapability extends BaseCapability {
  describe() {
    return {
      name: 'Ask Question',
      intent: 'ASK_QUESTION',
      category: 'Assistant',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: ['topic'],
      optionalEntities: [],
      priority: 95
    };
  }

  async execute(action, context) {
    const topic = (action.entities.topic || '').toLowerCase();
    let answer = '';

    // ── Knowledge Base ──
    if (topic.includes('shortcut') || topic.includes('keyboard') || topic.includes('hotkey')) {
      answer = `Here are the keyboard shortcuts you can use: `
        + `Control Shift T to toggle the task creation window. `
        + `Control Shift L to toggle the task list. `
        + `Control Shift C to open the calendar. `
        + `Control Shift H to open history and reports. `
        + `Control Shift A to open the AI chat window. `
        + `Control Shift V to activate the voice assistant. `
        + `You can also double-click the floating orb to start a voice conversation.`;
    }
    else if (topic.includes('voice') || topic.includes('assistant') || topic.includes('how to use voice')) {
      answer = `I'm your voice assistant! Here's how to use me: `
        + `Double-click the floating orb or press Control Shift V to start talking. `
        + `You can ask me to create tasks, complete them, delete them, open or close windows, `
        + `check your pending tasks, see your schedule, get performance reports, and much more. `
        + `Just speak naturally. For example, say "Create a task called gym at 5 PM" or "Show me my pending tasks." `
        + `To stop the voice conversation, just say "Stop" or "Cancel." `
        + `I'm here to help you manage everything in this application hands-free!`;
    }
    else if (topic.includes('application') || topic.includes('app') || topic.includes('what is') || topic.includes('useful') || topic.includes('how can i use')) {
      answer = `This is Orb, your smart task tracker! It helps you manage your daily tasks with time-based reminders and follow-ups. `
        + `You can create tasks with specific deadlines, set priority levels using the Eisenhower matrix (urgent and important, important but not urgent, urgent but not important, and low priority). `
        + `The app sends you popup reminders before tasks are due, and keeps following up until you complete them. `
        + `If you don't finish a task by end of day, it automatically carries over to tomorrow. `
        + `You can also see your productivity analytics, task completion reports, and history. `
        + `As a developer, you can use it to track your daily coding tasks, meetings, code reviews, and deadlines. `
        + `The floating orb stays on your screen so you can quickly access everything, and I'm here as your voice assistant to do all of this hands-free.`;
    }
    else if (topic.includes('window') || topic.includes('screen') || topic.includes('page')) {
      // Describe specific windows
      if (topic.includes('history') || topic.includes('report') || topic.includes('analytics')) {
        answer = `The History and Report window has three sections. `
          + `First, the Daily Report that shows your task overview for any date: how many tasks were created, completed, not completed, carried over, and deleted, along with your completion percentage. `
          + `Second, the History Log which is a filterable timeline of every event like task creation, completion, deletion, carry-overs, and follow-ups. You can filter by date, priority, action type, or search by name. `
          + `Third, the Analytics Dashboard with activity charts showing your productivity by hour, day, or month, a completion heatmap showing when you're most productive, a priority matrix, and carry-over trend analysis.`;
      }
      else if (topic.includes('calendar')) {
        answer = `The Calendar window shows a monthly view of all your upcoming tasks. You can see which days have tasks scheduled, and navigate between months to plan ahead.`;
      }
      else if (topic.includes('list') || topic.includes('task list')) {
        answer = `The Task List window shows all your tasks for today. It separates today's new tasks from carried-over tasks. You can see each task's priority, due time, and status. From here you can complete, delete, edit, or carry over tasks.`;
      }
      else if (topic.includes('creation') || topic.includes('create')) {
        answer = `The Task Creation window is where you create new tasks. You set the task name, date, time, how many minutes before to remind you, the priority quadrant, whether it repeats daily, and the follow-up frequency.`;
      }
      else if (topic.includes('ai') || topic.includes('chat')) {
        answer = `The AI Chat window lets you type natural language commands. You can create tasks, complete them, delete them, check your schedule, and more, all by typing instead of speaking.`;
      }
      else if (topic.includes('home') || topic.includes('dashboard') || topic.includes('setting')) {
        answer = `The Home window is your dashboard. It shows your task creation shortcut, today's overview, and all your settings including closing time, floating orb toggle, auto-start on login, dark or light theme, voice assistant toggle, and API key management.`;
      }
      else {
        answer = `This application has several windows: Home for dashboard and settings, Task Creation for making new tasks, Task List for today's tasks, Calendar for monthly view, AI Chat for text commands, and History and Reports for analytics and event logs. You can ask me about any specific window for more details.`;
      }
    }
    else if (topic.includes('quadrant') || topic.includes('priority') || topic.includes('eisenhower')) {
      answer = `The priority system uses the Eisenhower matrix with four quadrants. `
        + `Quadrant 1, marked in red, is for urgent and important tasks. `
        + `Quadrant 2, marked in blue, is for important but not urgent tasks. `
        + `Quadrant 3, marked in yellow, is for urgent but not important tasks. `
        + `Quadrant 4, marked in gray, is for low priority tasks that are neither urgent nor important.`;
    }
    else if (topic.includes('carry over') || topic.includes('carryover')) {
      answer = `When you don't complete a task by end of day, it can be carried over to tomorrow. `
        + `There are two types: Fixed, which moves it to tomorrow at the same time, and Dynamic, which moves it to tomorrow morning. `
        + `At 11:59 PM, any remaining pending tasks are automatically carried over. You can also manually carry over tasks or undo a carry-over.`;
    }
    else if (topic.includes('reminder') || topic.includes('follow up') || topic.includes('followup') || topic.includes('notification')) {
      answer = `When you create a task, you set how many minutes before the deadline you want a reminder. `
        + `When the reminder time arrives, you get a popup. Once the task is due, follow-up popups appear at regular intervals (default every 10 minutes) until you complete, snooze, or carry over the task. `
        + `Snoozing pauses follow-ups for 30 minutes.`;
    }
    else {
      // General fallback — use LLM for intelligent answer
      try {
        const AIService = require('../../nlp/AIService');
        answer = await AIService.generateNarration(
          { topic: action.entities.topic, question: action.entities.rawQuestion || topic },
          `The user is asking a question about the Orb task management application. Answer their question helpfully and conversationally. If you don't know the specific answer, give general helpful guidance about the application. The app features: task creation with reminders, follow-ups, carry-overs, Eisenhower priority matrix, voice assistant, floating orb, calendar, analytics dashboard, history logs. Shortcuts: Ctrl+Shift+T (task creation), Ctrl+Shift+L (task list), Ctrl+Shift+C (calendar), Ctrl+Shift+H (history), Ctrl+Shift+A (AI chat), Ctrl+Shift+V (voice).`
        );
      } catch (e) {
        answer = `I can help you with questions about this application! Try asking about shortcuts, how to use the voice assistant, what the different windows do, how priorities work, or how carry-overs and reminders function.`;
      }
    }

    return {
      actionId: action.id,
      status: 'SUCCESS',
      message: answer,
      data: { topic },
      recoverable: false
    };
  }
}

// ─────────────────────────────────────────────────────────
// GET WINDOW STATUS — Report which windows are currently open/closed
// ─────────────────────────────────────────────────────────
class GetWindowStatusCapability extends BaseCapability {
  describe() {
    return {
      name: 'Get Window Status',
      intent: 'GET_WINDOW_STATUS',
      category: 'Assistant',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: [],
      optionalEntities: [],
      priority: 90
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.getWindowStates) {
      const states = await context.appAdapter.getWindowStates();
      const windowNames = {
        home: 'Home',
        ai: 'AI Chat',
        list: 'Task List',
        task: 'Task Creation',
        calendar: 'Calendar',
        history: 'History & Report'
      };

      const openWindows = [];
      const closedWindows = [];

      for (const [key, label] of Object.entries(windowNames)) {
        if (states[key]) {
          openWindows.push(label);
        } else {
          closedWindows.push(label);
        }
      }

      let message = '';
      if (openWindows.length === 0) {
        message = 'No windows are currently open. All windows are closed.';
      } else if (closedWindows.length === 0) {
        message = `All windows are currently open: ${openWindows.join(', ')}.`;
      } else {
        message = `Currently open: ${openWindows.join(', ')}. Currently closed: ${closedWindows.join(', ')}.`;
      }

      return {
        actionId: action.id,
        status: 'SUCCESS',
        message: message,
        data: { open: openWindows, closed: closedWindows, states },
        recoverable: false
      };
    }

    return {
      actionId: action.id,
      status: 'ERROR',
      message: 'Unable to check window states.',
      data: {},
      recoverable: false
    };
  }
}

// ─────────────────────────────────────────────────────────
// UNDO COMPLETE — Mark a completed task back to pending
// ─────────────────────────────────────────────────────────
class UndoCompleteCapability extends BaseCapability {
  describe() {
    return {
      name: 'Undo Complete Task',
      intent: 'UNDO_COMPLETE',
      category: 'Task',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ['title'],
      optionalEntities: [],
      priority: 10
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Undoing completion for task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.undoCompleteTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey, taskId: action.entities.taskId };
      const result = await context.appAdapter.undoCompleteTask(action.entities.title, options);
      return {
        actionId: action.id,
        status: result.error ? 'ERROR' : 'SUCCESS',
        message: result.error || result.message || 'Task marked as not completed',
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        needsDisambiguation: result.needsDisambiguation,
        options: result.options,
        matches: result.matches,
        recoverable: true
      };
    }
    return {
      actionId: action.id,
      status: 'ERROR',
      message: 'Undo complete function not available.',
      data: {},
      recoverable: false
    };
  }
}

const UpdateSettingsCapability = require('./UpdateSettingsCapability');
const HandleNotificationCapability = require('./HandleNotificationCapability');

module.exports = {
  StopVoiceCapability: new StopVoiceCapability(),
  AskQuestionCapability: new AskQuestionCapability(),
  GetWindowStatusCapability: new GetWindowStatusCapability(),
  UndoCompleteCapability: new UndoCompleteCapability(),
  UpdateSettingsCapability: new UpdateSettingsCapability(),
  HandleNotificationCapability: new HandleNotificationCapability()
};
