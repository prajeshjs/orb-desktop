/**
 * QueryEngine
 * 
 * Part of the Application Intelligence Engine.
 * Takes a structural Query request (intent + filters) and maps it to the proper Domain Service,
 * returning an Execution Plan that simply extracts the required data.
 */

const TaskService = require('../services/TaskService');
const AnalyticsService = require('../services/AnalyticsService');
const ScheduleService = require('../services/ScheduleService');

class QueryEngine {
    
    /**
     * Resolve a Query Application Request into an Execution Plan
     * @param {Object} requestPlan The parsed request
     * @param {Object} context Current State Engine context
     */
    async resolve(requestPlan, context) {
        console.log(`[QueryEngine] Resolving Query: ${requestPlan.intent}`);
        
        // This is where we strictly map explicit intents (e.g., QUERY_TASKS, QUERY_ANALYTICS) 
        // to domain service methods. No LLM magic here.
        
        let data = null;
        let message = '';
        const intent = requestPlan.intent;
        const filters = requestPlan.parameters || {};

        try {
            switch (intent) {
                case 'QUERY_TASKS':
                    if (filters.date === 'today' || !filters.date) {
                        data = await TaskService.getPendingTasksToday();
                        message = `Found ${data.length} tasks for today.`;
                    } else {
                        data = await TaskService.getTasksByDate(filters.date);
                        message = `Found ${data.length} tasks for ${filters.date}.`;
                    }
                    break;
                    
                case 'QUERY_ANALYTICS':
                    if (filters.metric === 'productivity') {
                        data = await AnalyticsService.getProductivityScore(filters.date || new Date().toISOString().split('T')[0]);
                        message = `Your productivity score is ${data}.`;
                    } else {
                        data = await AnalyticsService.getWeeklyTrend();
                        message = `Weekly trend data retrieved.`;
                    }
                    break;
                    
                case 'QUERY_SCHEDULE':
                    data = await ScheduleService.getUpcomingTasks();
                    message = `Found ${data.length} upcoming tasks.`;
                    break;

                default:
                    throw new Error(`Unsupported Query Intent: ${intent}`);
            }
            
            // Return an Execution Plan that immediately "succeeds" with the data
            return {
                Actions: [
                    {
                        capability: 'DATA_EXTRACT_SIMULATED', // A dummy capability or we just return the result
                        payload: { data, message }
                    }
                ],
                Dependencies: [],
                RollbackStrategy: 'ignore',
                ConfirmationRequirements: 'none',
                Priority: 'normal',
                ExpectedResult: 'Data Payload',
                UIUpdates: requestPlan.uiActions || []
            };
            
        } catch (error) {
            console.error(`[QueryEngine] Failed to resolve query:`, error);
            return {
                Actions: [],
                RollbackStrategy: 'ignore',
                ConfirmationRequirements: 'none',
                Priority: 'normal',
                ExpectedResult: 'Error',
                UIUpdates: [],
                status: 'ERROR',
                message: error.message
            };
        }
    }
}

module.exports = new QueryEngine();
