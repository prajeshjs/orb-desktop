class ResultCollector {
  constructor() {
    this.results = new Map(); // sessionId -> array of results
  }

  addResult(sessionId, result) {
    if (!this.results.has(sessionId)) {
      this.results.set(sessionId, []);
    }
    this.results.get(sessionId).push(result);
  }

  getResults(sessionId) {
    return this.results.get(sessionId) || [];
  }

  clearResults(sessionId) {
    this.results.delete(sessionId);
  }
}

module.exports = new ResultCollector();
