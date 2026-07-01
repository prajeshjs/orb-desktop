class ConfirmationManager {
  constructor() {
    this.pendingAction = null;
    
    // Tier definitions
    this.TIERS = {
      TIER_0: 0, // Safe: Create Task, Open Window, Questions, Stop
      TIER_1: 1, // Reversible/Safe edit: Update Task, Carry Over, Complete, Undo
      TIER_2: 2  // Destructive/Ambiguous: Delete, Multiple Matches
    };
    
    this.INTENT_TIERS = {
      'CREATE_TASK': this.TIERS.TIER_0,
      'OPEN_WINDOW': this.TIERS.TIER_0,
      'CLOSE_WINDOW': this.TIERS.TIER_0,
      'UPDATE_TASK': this.TIERS.TIER_1,
      'COMPLETE_TASK': this.TIERS.TIER_1,
      'CARRY_OVER_TASK': this.TIERS.TIER_1,
      'UNDO_COMPLETE': this.TIERS.TIER_1,
      'UNDO_CARRY_OVER': this.TIERS.TIER_1,
      'DELETE_TASK': this.TIERS.TIER_2,
      // New intents — all safe (TIER_0)
      'STOP_VOICE': this.TIERS.TIER_0,
      'ASK_QUESTION': this.TIERS.TIER_0,
      'GET_WINDOW_STATUS': this.TIERS.TIER_0,
      'QUERY_TASKS': this.TIERS.TIER_0,
      'QUERY_FUTURE_TASKS': this.TIERS.TIER_0,
      'QUERY_PAST_ANALYSIS': this.TIERS.TIER_0,
      'GET_FREE_TIME': this.TIERS.TIER_0,
      'SHOW_TASK_LIST': this.TIERS.TIER_0,
      'SHOW_REPORT': this.TIERS.TIER_0,
      'SHOW_HISTORY': this.TIERS.TIER_0,
      'EDIT_TASK': this.TIERS.TIER_1
    };
  }

  getTier(intent) {
    return this.INTENT_TIERS[intent] !== undefined ? this.INTENT_TIERS[intent] : this.TIERS.TIER_2;
  }

  setPendingAction(actionData) {
    this.pendingAction = actionData;
  }

  getPendingAction() {
    return this.pendingAction;
  }

  clearPendingAction() {
    this.pendingAction = null;
  }
}

module.exports = new ConfirmationManager();
