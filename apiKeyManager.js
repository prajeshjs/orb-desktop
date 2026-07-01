// apiKeyManager.js — Encrypted file-based API key storage
// Stores API key in an encrypted format inside app's userData directory

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

let keyFilePath = null;

/**
 * Get the path to the API key file.
 * Uses electron app.getPath('userData').
 */
function getKeyFilePath() {
  if (keyFilePath) return keyFilePath;
  const userDataDir = app.getPath('userData');
  keyFilePath = path.join(userDataDir, 'api-key-secure.dat');
  return keyFilePath;
}

async function saveApiKey(key) {
  try {
    const filePath = getKeyFilePath();
    
    // Encrypt the key using OS-level native encryption (Windows DPAPI, macOS Keychain)
    let dataToSave;
    if (safeStorage.isEncryptionAvailable()) {
      dataToSave = safeStorage.encryptString(key);
    } else {
      // Fallback if encryption is completely unavailable on OS (very rare)
      dataToSave = Buffer.from(key, 'utf8');
    }

    fs.writeFileSync(filePath, dataToSave);
    return true;
  } catch (e) {
    console.error("Failed to save API key:", e);
    return false;
  }
}

async function getApiKey() {
  try {
    const filePath = getKeyFilePath();
    if (!fs.existsSync(filePath)) return null;

    const data = fs.readFileSync(filePath);
    
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data);
    } else {
      return data.toString('utf8');
    }
  } catch (e) {
    console.error("Failed to read API key:", e);
    return null;
  }
}

async function deleteApiKey() {
  try {
    const filePath = getKeyFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Also delete the old unencrypted file if it exists, to clean up
    const oldFilePath = path.join(app.getPath('userData'), 'api-key.json');
    if (fs.existsSync(oldFilePath)) {
      fs.unlinkSync(oldFilePath);
    }
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = {
  saveApiKey,
  getApiKey,
  deleteApiKey
};