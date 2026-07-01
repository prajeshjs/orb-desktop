/**
 * ScheduleService
 * 
 * Domain service for managing recurring tasks and time-based operations.
 */

const dbAdapter = require('../../db');

class ScheduleService {
    
    async getUpcomingTasks() {
        return dbAdapter.getTodayUpcomingTasks();
    }

    async getRepeatDailyTasks() {
        return dbAdapter.getRepeatDailyTasks();
    }

    async resetRepeatTaskForToday(taskId) {
        return dbAdapter.resetRepeatTaskForToday(taskId);
    }
}

module.exports = new ScheduleService();
