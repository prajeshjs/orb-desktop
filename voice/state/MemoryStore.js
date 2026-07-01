const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class MemoryStore {
  constructor() {
    try {
      const userDataPath = app.getPath('userData');
      this.storePath = path.join(userDataPath, 'voice_memory.json');
    } catch (e) {
      this.storePath = path.join(__dirname, '..', '..', 'voice_memory.json');
    }
    this.memory = this.load();
  }

  load() {
    if (fs.existsSync(this.storePath)) {
      try {
        const data = fs.readFileSync(this.storePath, 'utf8');
        return JSON.parse(data);
      } catch (e) {
        console.error("Failed to load memory store", e);
        return { preferences: {} };
      }
    }
    return { preferences: {} };
  }

  save() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (e) {
      console.error("Failed to save memory store", e);
    }
  }

  setPreference(key, value) {
    this.memory.preferences[key] = value;
    this.save();
  }

  getPreference(key) {
    return this.memory.preferences[key];
  }

  getAllPreferences() {
    return this.memory.preferences;
  }
}

module.exports = new MemoryStore();
