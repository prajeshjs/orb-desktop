const CapabilityRegistry = require('../core/CapabilityRegistry');

class Planner {

  plan(actions) {
    if (!actions || actions.length === 0) return [];

    let plan = [...actions];

    // 1. Dependency Ordering
    // E.g., Generate Report usually should happen after Delete/Complete
    // For now, simple priority-based sort defined by Capability metadata
    plan.sort((a, b) => {
      const capA = CapabilityRegistry.getCapability(a.intent)?.describe();
      const capB = CapabilityRegistry.getCapability(b.intent)?.describe();
      const priorityA = capA?.priority || 50; // default medium priority
      const priorityB = capB?.priority || 50;
      // Lower number executes first
      return priorityA - priorityB;
    });

    // 2. Redundancy Optimization
    // Example: If Open AI and Close AI are adjacent and have no user-visible effects in between
    plan = this.optimizeRedundancies(plan);

    return plan;
  }

  optimizeRedundancies(plan) {
    const optimized = [];
    for (let i = 0; i < plan.length; i++) {
      const current = plan[i];
      const next = plan[i + 1];

      // Extremely naive redundancy check for demonstration
      if (next) {
        if (current.intent === 'OPEN_WINDOW' && next.intent === 'CLOSE_WINDOW') {
          if (current.entities.window === next.entities.window) {
            // Skip both
            i++; 
            continue;
          }
        }
      }
      optimized.push(current);
    }
    return optimized;
  }
}

module.exports = new Planner();
