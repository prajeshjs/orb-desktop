/**
 * TaskService
 * 
 * Domain service for managing Task entities.
 * Abstracts database operations from the Application Intelligence Engine.
 */

const dbAdapter = require('../../db');

class TaskService {
    
    async getTaskById(taskId) {
        return dbAdapter.getTaskById(taskId);
    }

    async getTasksByDate(date) {
        // We'll filter today tasks if date is today, or we can use getAllTasks and filter.
        // For now, if the date is today, use getTodayTasks
        const tasks = await dbAdapter.getAllTasks();
        return tasks.filter(t => t.dueAt && t.dueAt.startsWith(date));
    }

    async getPendingTasksToday() {
        const tasks = await dbAdapter.getTodayTasks();
        return tasks.filter(t => t.status === 'pending');
    }

    async createTask(payload) {
        return dbAdapter.insertTask(payload);
    }

    async updateTask(taskId, updates) {
        return dbAdapter.updateTask(taskId, updates);
    }

    async completeTask(taskId) {
        return dbAdapter.markTaskCompleted(taskId);
    }

    async deleteTask(taskId) {
        return dbAdapter.deleteTask(taskId);
    }

    async carryOverTask(taskId, newDate) {
        return dbAdapter.carryOverTask(taskId, newDate);
    }
}

module.exports = new TaskService();
