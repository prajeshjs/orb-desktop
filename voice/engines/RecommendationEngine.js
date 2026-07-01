/**
 * RecommendationEngine
 * 
 * Part of the Application Intelligence Engine.
 * Resolves Recommendation requests by evaluating tasks against dynamic Goals and Context.
 */

const TaskService = require('../services/TaskService');
const StateEngine = require('../core/StateEngine');

class RecommendationEngine {
    constructor() {
        this.activeGoals = [];
    }

    /**
     * Add a temporary goal that adjusts recommendation scores
     * @param {Object} goal e.g., { type: 'ClearHighPriority', weight: 1.5, expiresAt: Date }
     */
    addGoal(goal) {
        this.activeGoals.push(goal);
    }

    /**
     * Resolve a Recommendation request into an Execution Plan
     * @param {Object} requestPlan The parsed request
     * @param {Object} context Current State Engine context
     */
    async resolve(requestPlan, context) {
        console.log(`[RecommendationEngine] Generating Recommendations`);
        
        // 1. Fetch Candidates
        const tasks = await TaskService.getPendingTasksToday();
        
        // 2. Score Candidates
        const scoredTasks = tasks.map(task => {
            let score = 0;
            let explanation = [];

            // Base scoring: Quadrant 1 (Urgent/Important) gets highest base score
            if (task.quadrant === 1) { score += 50; explanation.push("It is Urgent and Important (Quadrant 1)."); }
            if (task.quadrant === 2) { score += 40; explanation.push("It is Important but Not Urgent (Quadrant 2)."); }
            if (task.quadrant === 3) { score += 20; explanation.push("It is Urgent but Not Important (Quadrant 3)."); }
            if (task.quadrant === 4) { score += 10; explanation.push("It is Not Urgent and Not Important (Quadrant 4)."); }

            // Apply Active Goals
            this.activeGoals.forEach(goal => {
                if (goal.type === 'ClearHighPriority' && task.quadrant === 1) {
                    score *= goal.weight;
                    explanation.push("Aligns with your current goal to clear High Priority tasks.");
                }
            });

            // Context: If user is actively looking at a window related to this task
            // For now, check if context has filters
            if (context.Filters && context.Filters.quadrant == task.quadrant) {
                score += 15;
                explanation.push("Matches your currently active window filter.");
            }

            return { task, score, explanation };
        });

        // 3. Sort by Score
        scoredTasks.sort((a, b) => b.score - a.score);

        const topRecommendations = scoredTasks.slice(0, 3);
        
        const message = topRecommendations.length > 0 
            ? `I recommend starting with '${topRecommendations[0].task.task}'. ${topRecommendations[0].explanation.join(' ')}` 
            : `I have no immediate recommendations for you right now.`;

        // 4. Return Execution Plan containing the recommendations
        return {
            Actions: [
                {
                    capability: 'DATA_EXTRACT_SIMULATED', 
                    payload: { 
                        data: topRecommendations,
                        message: message
                    }
                }
            ],
            Dependencies: [],
            RollbackStrategy: 'ignore',
            ConfirmationRequirements: 'none',
            Priority: 'low',
            ExpectedResult: 'Recommendation List',
            UIUpdates: requestPlan.uiActions || []
        };
    }
}

module.exports = new RecommendationEngine();
