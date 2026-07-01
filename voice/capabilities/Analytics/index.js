const BaseCapability = require('../BaseCapability');

// ─────────────────────────────────────────────────────────
// QUERY FUTURE TASKS — Tasks in next week/month/specific date
// ─────────────────────────────────────────────────────────
class QueryFutureTasksCapability extends BaseCapability {
  describe() {
    return {
      name: 'Query Future Tasks',
      intent: 'QUERY_FUTURE_TASKS',
      category: 'Analytics',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: ['timeRange'],
      optionalEntities: [],
      priority: 90
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.queryFutureTasks) {
      try {
        const result = await context.appAdapter.queryFutureTasks(action.entities.timeRange);
        if (result.success) {
          const AIService = require('../../nlp/AIService');
          const narration = await AIService.generateNarration(result.data,
            `The user wants to know about their future tasks for "${action.entities.timeRange}". `
            + `Provide a clear summary: which days have tasks, what those tasks are, their times, and their priority levels. `
            + `If there are no tasks in that period, say so clearly. Group tasks by date for clarity. `
            + `Also mention if the calendar window is now open so they can see the visual view.`
          );

          // Also open the calendar window for visual reference
          if (context.appAdapter.openWindow) {
            try { await context.appAdapter.openWindow('calendar'); } catch(e) {}
          }

          return {
            actionId: action.id,
            status: 'SUCCESS',
            message: narration,
            data: result.data,
            recoverable: false
          };
        }
        return {
          actionId: action.id,
          status: 'ERROR',
          message: result.error || 'Failed to query future tasks.',
          data: {},
          recoverable: false
        };
      } catch (err) {
        return {
          actionId: action.id,
          status: 'ERROR',
          message: `Error querying future tasks: ${err.message}`,
          data: {},
          recoverable: false
        };
      }
    }
    return {
      actionId: action.id,
      status: 'ERROR',
      message: 'Future task query not available.',
      data: {},
      recoverable: false
    };
  }
}

// ─────────────────────────────────────────────────────────
// QUERY PAST ANALYSIS — Past performance, productivity, history
// ─────────────────────────────────────────────────────────
class QueryPastAnalysisCapability extends BaseCapability {
  describe() {
    return {
      name: 'Query Past Analysis',
      intent: 'QUERY_PAST_ANALYSIS',
      category: 'Analytics',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: ['analysisType'],
      optionalEntities: [],
      priority: 90
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.queryPastAnalysis) {
      try {
        const result = await context.appAdapter.queryPastAnalysis(action.entities.analysisType);
        if (result.success) {
          const AIService = require('../../nlp/AIService');
          const narration = await AIService.generateNarration(result.data,
            `The user wants "${action.entities.analysisType}" analysis of their past task performance. `
            + `Give a detailed spoken analysis covering: total tasks created vs completed, completion rate, `
            + `most productive times, priority breakdown, carry-over patterns. `
            + `Be insightful — identify trends, suggest improvements, mention peak productivity hours. `
            + `Sound like a personal productivity coach. `
            + `Also mention that the History and Report window is now open so they can explore the details visually.`
          );

          // Open the history/report window for visual reference
          if (context.appAdapter.openWindow) {
            try { await context.appAdapter.openWindow('report'); } catch(e) {}
          }

          return {
            actionId: action.id,
            status: 'SUCCESS',
            message: narration,
            data: result.data,
            recoverable: false
          };
        }
        return {
          actionId: action.id,
          status: 'ERROR',
          message: result.error || 'Failed to get analysis.',
          data: {},
          recoverable: false
        };
      } catch (err) {
        return {
          actionId: action.id,
          status: 'ERROR',
          message: `Error getting analysis: ${err.message}`,
          data: {},
          recoverable: false
        };
      }
    }
    return {
      actionId: action.id,
      status: 'ERROR',
      message: 'Past analysis not available.',
      data: {},
      recoverable: false
    };
  }
}

// ─────────────────────────────────────────────────────────
// GET FREE TIME — Calculate when the user is free today/tomorrow
// ─────────────────────────────────────────────────────────
class GetFreeTimeCapability extends BaseCapability {
  describe() {
    return {
      name: 'Get Free Time',
      intent: 'GET_FREE_TIME',
      category: 'Analytics',
      version: '1.0',
      dangerous: false,
      supportsUndo: false,
      supportsBatch: false,
      supportsVoice: true,
      supportsGUI: false,
      requiredEntities: ['timeRange'],
      optionalEntities: [],
      priority: 90
    };
  }

  async execute(action, context) {
    if (context && context.appAdapter && context.appAdapter.getFreeTimeSlots) {
      try {
        const result = await context.appAdapter.getFreeTimeSlots(action.entities.timeRange);
        if (result.success) {
          const AIService = require('../../nlp/AIService');
          const narration = await AIService.generateNarration(result.data,
            `The user wants to know when they are free (without any tasks) for "${action.entities.timeRange}". `
            + `List the free time windows clearly. Mention the tasks that are blocking other times. `
            + `Be helpful — suggest the best free slots for new work or breaks. `
            + `If the user is free all day, say so. If very busy, acknowledge it.`
          );
          return {
            actionId: action.id,
            status: 'SUCCESS',
            message: narration,
            data: result.data,
            recoverable: false
          };
        }
        return {
          actionId: action.id,
          status: 'ERROR',
          message: result.error || 'Failed to calculate free time.',
          data: {},
          recoverable: false
        };
      } catch (err) {
        return {
          actionId: action.id,
          status: 'ERROR',
          message: `Error calculating free time: ${err.message}`,
          data: {},
          recoverable: false
        };
      }
    }
    return {
      actionId: action.id,
      status: 'ERROR',
      message: 'Free time calculation not available.',
      data: {},
      recoverable: false
    };
  }
}

module.exports = {
  QueryFutureTasksCapability: new QueryFutureTasksCapability(),
  QueryPastAnalysisCapability: new QueryPastAnalysisCapability(),
  GetFreeTimeCapability: new GetFreeTimeCapability()
};
