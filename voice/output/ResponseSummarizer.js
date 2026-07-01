class ResponseSummarizer {
  
  summarize(results) {
    if (!results || results.length === 0) {
      return "No actions were executed.";
    }

    const successes = results.filter(r => r.status === 'SUCCESS');
    const errors = results.filter(r => r.status === 'ERROR');

    let summary = "";

    if (successes.length > 0) {
      if (successes.length === 1) {
        // Clean up message — remove trailing period before appending one
        let msg = successes[0].message || 'Done';
        msg = msg.replace(/\.+$/, '').trim();
        summary += msg + ". ";
      } else {
        const msgs = successes.map(s => {
          let msg = (s.message || 'Done').toLowerCase();
          // Remove trailing periods from each message
          msg = msg.replace(/\.+$/, '').trim();
          return msg;
        });
        const last = msgs.pop();
        summary += `I have ${msgs.join(', ')}, and ${last}. `;
      }
    }

    if (errors.length > 0) {
      if (successes.length > 0) {
        summary += "However, ";
      }
      const errMsgs = errors.map(e => {
        let msg = (e.message || 'an unknown error occurred').toLowerCase();
        msg = msg.replace(/\.+$/, '').trim();
        return msg;
      });
      summary += `I ran into an issue: ${errMsgs.join(' and ')}.`;
    }

    return summary.trim();
  }

  async generateTTS(text) {
    console.log(`[TTS] Speaking: "${text}"`);
    // Placeholder for actual TTS integration (e.g. native OS speech or Groq/OpenAI TTS)
    // For now, it just simulates speech delay
    return new Promise(resolve => setTimeout(resolve, text.length * 50));
  }

}

module.exports = new ResponseSummarizer();
