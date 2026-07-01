class ScheduleIntelligence {
  /**
   * Suggests an optimal time for a new task.
   * @param {number} durationInMinutes - Duration of the task
   * @param {object} preferences - User preferences from MemoryStore
   * @param {Array} existingTasks - Array of today's tasks
   * @returns {string} Suggested time in HH:MM format
   */
  suggestTime(durationInMinutes, preferences, existingTasks) {
    const now = new Date();
    // Start looking from next rounded 30 minutes, or at least 15 mins from now
    let searchStart = new Date(now.getTime() + 15 * 60000);
    searchStart.setMinutes(Math.ceil(searchStart.getMinutes() / 30) * 30, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Convert existing tasks to busy blocks
    const busyBlocks = existingTasks.map(t => {
      const start = new Date(t.dueAt).getTime() - (t.duration || 10) * 60000;
      const end = new Date(t.dueAt).getTime();
      return { start, end };
    }).sort((a, b) => a.start - b.start);

    // Try to find a free block
    let currentTime = searchStart.getTime();
    
    while (currentTime + durationInMinutes * 60000 <= endOfDay.getTime()) {
      const candidateEnd = currentTime + durationInMinutes * 60000;
      let conflict = false;

      for (const block of busyBlocks) {
        if ((currentTime >= block.start && currentTime < block.end) || 
            (candidateEnd > block.start && candidateEnd <= block.end) ||
            (currentTime <= block.start && candidateEnd >= block.end)) {
          conflict = true;
          currentTime = block.end; // jump to end of conflicting block
          break;
        }
      }

      if (!conflict) {
        // We found a free block!
        const date = new Date(currentTime);
        return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      }
      
      if (conflict) {
          // If conflict set to block.end, just align to next 5 minutes
          currentTime = Math.ceil(currentTime / 300000) * 300000;
      } else {
          currentTime += 30 * 60000; // Increment by 30 mins
      }
    }

    // Fallback: just put it at 23:00 if everything is full
    return "23:00";
  }
}

module.exports = new ScheduleIntelligence();
