/**
 * RecoveryManager
 * 
 * Handles retries, rollbacks, and fallbacks for failed actions in an Execution Plan.
 */

class RecoveryManager {
    constructor() {
    }

    /**
     * Attempt to rollback a set of completed actions
     * @param {Array} completedActions Actions that were successfully executed before the failure
     * @param {Object} executionPlan The original execution plan
     */
    async rollback(completedActions, executionContext, executionPlan) {
        console.log(`[RecoveryManager] Attempting rollback for ${completedActions.length} actions...`);
        // We iterate backwards to undo the most recent first
        for (let i = completedActions.length - 1; i >= 0; i--) {
            const actionRecord = completedActions[i];
            const capability = actionRecord.capability;
            
            if (capability && typeof capability.rollback === 'function') {
                try {
                    console.log(`[RecoveryManager] Rolling back capability: ${capability.manifest.name}`);
                    await capability.rollback(actionRecord.action, actionRecord.result, executionContext);
                } catch (err) {
                    console.error(`[RecoveryManager] Rollback failed for capability ${capability.manifest.name}:`, err);
                }
            } else {
                console.log(`[RecoveryManager] No rollback method for capability, skipping.`);
            }
        }
        console.log(`[RecoveryManager] Rollback complete.`);
    }

    /**
     * Execute a capability with retry logic
     * @param {Object} capability The capability instance
     * @param {Object} action The specific action payload
     * @param {Object} executionContext Global execution context
     * @param {number} maxRetries Number of retries allowed
     */
    async executeWithRetry(capability, action, executionContext, maxRetries = 2) {
        let attempts = 0;
        let lastError = null;

        while (attempts <= maxRetries) {
            try {
                const execResult = await capability.execute(action, executionContext);
                // If it's explicitly marked as an error status, throw to trigger retry
                if (execResult && execResult.status === 'ERROR') {
                    throw new Error(execResult.message || 'Execution returned ERROR status');
                }
                return execResult;
            } catch (err) {
                lastError = err;
                attempts++;
                console.log(`[RecoveryManager] Action failed (Attempt ${attempts}/${maxRetries + 1}): ${err.message}`);
                
                if (attempts <= maxRetries) {
                    // Exponential backoff
                    const delay = Math.pow(2, attempts) * 100;
                    await new Promise(res => setTimeout(res, delay));
                }
            }
        }

        return {
            status: 'ERROR',
            message: `Failed after ${maxRetries} retries: ${lastError.message}`,
            recoverable: false
        };
    }
}

// Export as singleton
module.exports = new RecoveryManager();
