/**
 * AnalyticsService
 * 
 * Domain service for managing and aggregating analytics data.
 */

const dbAdapter = require('../../db');

class AnalyticsService {
    
    async getProductivityScore(date) {
        const report = await dbAdapter.getReportByDate(date);
        return report ? report.productivity_score : 0;
    }

    async getWeeklyTrend() {
        return dbAdapter.getAnalyticsData();
    }

    async getCarryOverTrend() {
        return dbAdapter.getCarryOverTrend();
    }

    async getHistoryEvents(limit = 50) {
        // Assume getHistoryEvents takes a limit or returns all.
        // For now, we wrap the adapter.
        return dbAdapter.getHistoryEvents();
    }
}

module.exports = new AnalyticsService();
