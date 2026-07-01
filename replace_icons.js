const fs = require('fs');
const path = require('path');

const emojiMap = {
  '🚩': '<i data-lucide="flag" class="orb-icon"></i>',
  '🔁': '<i data-lucide="repeat" class="orb-icon"></i>',
  '🏠': '<i data-lucide="home" class="orb-icon"></i>',
  '📋': '<i data-lucide="clipboard-list" class="orb-icon"></i>',
  '📝': '<i data-lucide="file-text" class="orb-icon"></i>',
  '📊': '<i data-lucide="bar-chart-2" class="orb-icon"></i>',
  '🤖': '<i data-lucide="bot" class="orb-icon"></i>',
  '📅': '<i data-lucide="calendar" class="orb-icon"></i>',
  '🚪': '<i data-lucide="log-out" class="orb-icon"></i>',
  '📖': '<i data-lucide="book-open" class="orb-icon"></i>',
  '⚙️': '<i data-lucide="settings" class="orb-icon"></i>',
  '🎨': '<i data-lucide="palette" class="orb-icon"></i>',
  '🔮': '<i data-lucide="gem" class="orb-icon"></i>',
  '🎙️': '<i data-lucide="mic" class="orb-icon"></i>',
  '🚀': '<i data-lucide="rocket" class="orb-icon"></i>',
  '🖥️': '<i data-lucide="monitor" class="orb-icon"></i>',
  '⏱️': '<i data-lucide="timer" class="orb-icon"></i>',
  '🔑': '<i data-lucide="key" class="orb-icon"></i>',
  '🗑️': '<i data-lucide="trash-2" class="orb-icon"></i>',
  'ℹ️': '<i data-lucide="info" class="orb-icon"></i>',
  '🔗': '<i data-lucide="external-link" class="orb-icon"></i>',
  '🔔': '<i data-lucide="bell" class="orb-icon"></i>',
  '⏰': '<i data-lucide="alarm-clock" class="orb-icon"></i>',
  '⚡': '<i data-lucide="zap" class="orb-icon"></i>',
  '📢': '<i data-lucide="megaphone" class="orb-icon"></i>',
  '💤': '<i data-lucide="moon" class="orb-icon"></i>',
  '🔄': '<i data-lucide="refresh-cw" class="orb-icon"></i>',
  '📈': '<i data-lucide="trending-up" class="orb-icon"></i>',
  '🎯': '<i data-lucide="target" class="orb-icon"></i>',
  '📜': '<i data-lucide="scroll" class="orb-icon"></i>',
  '🟩': '<i data-lucide="layout-grid" class="orb-icon"></i>',
  '✅': '<i data-lucide="check-circle-2" class="orb-icon"></i>',
  '⏸': '<i data-lucide="pause-circle" class="orb-icon"></i>',
  '⚠️': '<i data-lucide="alert-triangle" class="orb-icon"></i>',
  '❌': '<i data-lucide="x" class="orb-icon"></i>',
  '✕': '<i data-lucide="x" class="orb-icon"></i>',
  '⏳': '<i data-lucide="hourglass" class="orb-icon"></i>',
  '🕐': '<i data-lucide="clock" class="orb-icon"></i>',
  '⌨️': '<i data-lucide="keyboard" class="orb-icon"></i>',
  '✏️': '<i data-lucide="edit-2" class="orb-icon"></i>'
};

const htmlFiles = [
  'home.html',
  'floatingorbpanel.html',
  'historyreport.html',
  'index.html',
  'edit.html',
  'calendar.html',
  'notification.html',
  'prealert.html',
  'followup.html',
  'carryover.html',
  'system_off_message.html',
  'tasks.html',
  'ai.html'
];

htmlFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // We want to replace static HTML emojis, but avoid inside <script> blocks
  // to avoid breaking logic. 
  // Let's use a regex that only replaces text outside script tags
  let parts = content.split(/(<script[\s\S]*?<\/script>)/gi);
  
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i].toLowerCase().startsWith('<script')) {
      // Replace emojis in this non-script part
      for (const [emoji, replacement] of Object.entries(emojiMap)) {
        parts[i] = parts[i].split(emoji).join(replacement);
      }
    }
  }
  
  content = parts.join('');

  // Include lucide script
  if (!content.includes('unpkg.com/lucide')) {
    content = content.replace('</head>', '  <script src="https://unpkg.com/lucide@latest"></script>\n</head>');
  }

  // Include createIcons call at the very end
  if (!content.includes('lucide.createIcons();')) {
    content = content.replace('</body>', '  <script>lucide.createIcons();</script>\n</body>');
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Updated ${file}`);
});
