const BaseCapability = require('../BaseCapability');

class CreateTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Create Task",
      intent: "CREATE_TASK",
      category: "Task",
      version: "1.0",
      dangerous: false,
      supportsUndo: true,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: ["date", "time", "duration", "quadrant", "repeatDaily", "followUpFrequency"],
      priority: 20
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Creating task: ${action.entities.title}`);
    
    if (context && context.appAdapter) {
      try {
        const ScheduleIntelligence = require('../../planning/ScheduleIntelligence');
        const MemoryStore = require('../../state/MemoryStore');
        
        if (action.entities.repeatDaily === null || action.entities.repeatDaily === undefined) action.entities.repeatDaily = false;
        if (action.entities.followUpFrequency === null || action.entities.followUpFrequency === undefined) action.entities.followUpFrequency = 10;

        const required = ['title', 'time', 'duration', 'quadrant'];
        const missing = required.filter(f => action.entities[f] === null || action.entities[f] === undefined);

        if (missing.length > 0) {
          return {
            actionId: action.id,
            status: "SUCCESS",
            needsClarification: true,
            missingFields: missing,
            message: `I need a few more details to create this task. Please provide: ${missing.join(', ')}.`
          };
        }

        await context.appAdapter.createTask(action.entities);
        
        let message = `Task ${action.entities.title} created.`;
        
        return {
          actionId: action.id,
          status: "SUCCESS",
          message: message,
          data: { title: action.entities.title },
          recoverable: true
        };
      } catch (err) {
        return {
          actionId: action.id,
          status: "ERROR",
          message: `Failed to create task: ${err.message}`,
          data: { error: err.message },
          recoverable: false
        };
      }
    }

    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Task created (Simulation)`,
      data: { title: action.entities.title },
      recoverable: true
    };
  }
}

class DeleteTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Delete Task",
      intent: "DELETE_TASK",
      category: "Task",
      version: "1.0",
      dangerous: true,
      supportsUndo: false,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: [],
      priority: 5
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Deleting task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.deleteTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey, taskId: action.entities.taskId };
      const result = await context.appAdapter.deleteTask(action.entities.title, options);
      return {
        actionId: action.id,
        status: result.error ? "ERROR" : "SUCCESS",
        message: result.error || result.message || `Task deleted`,
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        recoverable: false
      };
    }
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Task deleted (Simulation)`,
      data: { title: action.entities.title },
      recoverable: false
    };
  }
}

class CompleteTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Complete Task",
      intent: "COMPLETE_TASK",
      category: "Task",
      version: "1.0",
      dangerous: false,
      supportsUndo: true,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: [],
      priority: 5
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Completing task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.completeTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey, taskId: action.entities.taskId };
      const result = await context.appAdapter.completeTask(action.entities.title, options);
      return {
        actionId: action.id,
        status: result.error ? "ERROR" : "SUCCESS",
        message: result.error || result.message || `Task completed`,
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        recoverable: true
      };
    }
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Task completed (Simulation)`,
      data: { title: action.entities.title },
      recoverable: true
    };
  }
}

class EditTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Edit Task",
      intent: "EDIT_TASK",
      category: "Task",
      version: "1.0",
      dangerous: false,
      supportsUndo: false,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: [],
      priority: 5
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Editing task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.editTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey, taskId: action.entities.taskId };
      const newFields = {};
      const result = await context.appAdapter.editTask(action.entities.title, newFields, options);
      return {
        actionId: action.id,
        status: result.error ? "ERROR" : "SUCCESS",
        message: result.error || result.message || `Opened edit window for task`,
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        recoverable: true
      };
    }
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Edit task (Simulation)`,
      data: { title: action.entities.title },
      recoverable: true
    };
  }
}

class CarryOverTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Carry Over Task",
      intent: "CARRY_OVER_TASK",
      category: "Task",
      version: "1.0",
      dangerous: false,
      supportsUndo: true,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: ["carryType"],
      priority: 5
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Carrying over task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.carryOverTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey, taskId: action.entities.taskId };
      const result = await context.appAdapter.carryOverTask(action.entities.title, action.entities.carryType, options);
      return {
        actionId: action.id,
        status: result.error ? "ERROR" : "SUCCESS",
        message: result.error || result.message || `Carried over task`,
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        recoverable: true
      };
    }
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Carry over task (Simulation)`,
      data: { title: action.entities.title },
      recoverable: true
    };
  }
}

class UndoCarryOverTaskCapability extends BaseCapability {
  describe() {
    return {
      name: "Undo Carry Over Task",
      intent: "UNDO_CARRY_OVER",
      category: "Task",
      version: "1.0",
      dangerous: false,
      supportsUndo: false,
      supportsBatch: true,
      supportsVoice: true,
      supportsGUI: true,
      requiredEntities: ["title"],
      optionalEntities: [],
      priority: 5
    };
  }

  async execute(action, context) {
    console.log(`[TaskManagement] Undoing carry over for task: ${action.entities.title}`);
    if (context && context.appAdapter && context.appAdapter.carryOverTask) {
      // Re-use appAdapter but signal intent dynamically or use resolveTaskAction via adapter
      // Wait, appAdapter doesn't have undoCarryOverTask natively exported. Let's assume it has resolveTaskAction.
      // But we can just use appAdapter.carryOverTask ? No, appAdapter only has specific methods.
      // Let's add undoCarryOverTask to appAdapter in main.js.
      if (context.appAdapter.undoCarryOverTask) {
         const options = { forceExecution: context.forceExecution, taskId: action.entities.taskId };
         const result = await context.appAdapter.undoCarryOverTask(action.entities.title, options);
         return {
           actionId: action.id,
           status: result.error ? "ERROR" : "SUCCESS",
           message: result.error || result.message || `Undid carry over`,
           data: { title: action.entities.title, originalResult: result },
           recoverable: false
         };
      }
    }
    return {
      actionId: action.id,
      status: "SUCCESS",
      message: `Undo carry over (Simulation)`,
      data: { title: action.entities.title },
      recoverable: false
    };
  }
}

class UpdateTaskCapability extends BaseCapability {
  describe() {
    return {
      name: 'Update Task',
      description: 'Updates specific fields (date, time, duration, quadrant, repeatDaily, followUpFrequency) of an existing task via voice command without opening the UI.',
      intent: 'UPDATE_TASK',
      requiredEntities: ['title'],
      priority: 25 // Between Create and Delete
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.updateTask) {
      const options = { forceExecution: context.forceExecution, optionKey: action.entities.optionKey };
      const result = await context.appAdapter.updateTask({
         title: action.entities.title,
         date: action.entities.date,
         time: action.entities.time,
         duration: action.entities.duration,
         quadrant: action.entities.quadrant,
         repeatDaily: action.entities.repeatDaily,
         followUpFrequency: action.entities.followUpFrequency
      }, options);
      return {
        actionId: action.id,
        status: result.error ? "ERROR" : "SUCCESS",
        message: result.error || result.message || `Task updated`,
        data: { title: action.entities.title, originalResult: result },
        needsOptionSelection: result.needsOptionSelection,
        needsConfirmation: result.needsConfirmation,
        options: result.options,
        recoverable: true
      };
    }
    return {
      actionId: action.id,
      status: "ERROR",
      message: 'appAdapter.updateTask not implemented',
      data: {},
      recoverable: false
    };
  }
}

class QueryTasksCapability extends BaseCapability {
  describe() {
    return {
      name: 'Query Tasks',
      description: 'Queries task data (pending, completed, history, today summary) and generates a spoken narration.',
      intent: 'QUERY_TASKS',
      requiredEntities: ['queryType'],
      priority: 90 // Run queries at the end
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.queryTasks) {
      const result = await context.appAdapter.queryTasks(action.entities.queryType);
      if (result.success) {
        const AIService = require('../../nlp/AIService');
        const narration = await AIService.generateNarration(result.data, `User wants to know about ${action.entities.queryType} tasks.`);
        return {
          actionId: action.id,
          status: "SUCCESS",
          message: narration,
          data: result.data,
          recoverable: false
        };
      }
      return {
        actionId: action.id,
        status: "ERROR",
        message: result.error || 'Failed to query tasks',
        data: {},
        recoverable: false
      };
    }
    return {
      actionId: action.id,
      status: "ERROR",
      message: 'appAdapter.queryTasks not implemented',
      data: {},
      recoverable: false
    };
  }
}

module.exports = {
  CreateTaskCapability: new CreateTaskCapability(),
  DeleteTaskCapability: new DeleteTaskCapability(),
  CompleteTaskCapability: new CompleteTaskCapability(),
  EditTaskCapability: new EditTaskCapability(),
  CarryOverTaskCapability: new CarryOverTaskCapability(),
  UndoCarryOverTaskCapability: new UndoCarryOverTaskCapability(),
  UpdateTaskCapability: new UpdateTaskCapability(),
  QueryTasksCapability: new QueryTasksCapability()
};
