class EntityNormalizer {
  
  normalize(action) {
    if (!action || !action.entities) return action;

    const normalized = { ...action };
    const e = normalized.entities;

    if (e.time) e.time = this.normalizeTime(e.time);
    if (e.date) e.date = this.normalizeDate(e.date);
    if (e.quadrant) e.quadrant = this.normalizeQuadrant(e.quadrant);
    if (e.window) e.window = this.normalizeWindow(e.window);
    if (e.duration) e.duration = this.normalizeDuration(e.duration);

    return normalized;
  }

  normalizeTime(rawTime) {
    if (!rawTime) return null;
    let t = rawTime.toLowerCase().trim();
    // basic mapping e.g., "5 pm" -> "17:00", "today night" is context based, maybe handled via groq or custom logic
    // We will keep a simple pass-through for now, and extend it
    if (t.includes('night') && !t.match(/\d/)) return '20:00';
    if (t.includes('evening') && !t.match(/\d/)) return '18:00';
    if (t.includes('morning') && !t.match(/\d/)) return '09:00';
    
    // Very basic 12 to 24 hour converter for demonstration
    const match = t.match(/(\d+)(?::(\d+))?\s*(am|pm)?/);
    if (match) {
      let [ , h, m, ampm ] = match;
      h = parseInt(h);
      m = m ? parseInt(m) : 0;
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    return rawTime;
  }

  normalizeDate(rawMsg) {
    if (!rawMsg) return null;
    const lower = rawMsg.toLowerCase();
    const now = new Date();
    const todayDay = now.getDay();

    const DAY_MAP = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const MONTH_MAP = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      jan: 0, feb: 1, mar: 2, apr: 3, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    function fmt(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function getNextWeekday(targetDay) {
      let diff = targetDay - todayDay;
      if (diff <= 0) diff += 7;
      const result = new Date(now);
      result.setDate(now.getDate() + diff);
      return result;
    }

    if (/\\btoday\\b/i.test(lower)) return fmt(now);
    if (/\\btomorrow\\b/i.test(lower)) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return fmt(d);
    }

    const nextMonthOrdMatch = lower.match(/\\bnext\\s+month\\s+(first|second|third|fourth|last|1st|2nd|3rd|4th)\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b/);
    if (nextMonthOrdMatch) {
      const ordWord = nextMonthOrdMatch[1];
      const targetDay = DAY_MAP[nextMonthOrdMatch[2]];
      const nextMonth = now.getMonth() + 1;
      const nextMonthYear = nextMonth > 11 ? now.getFullYear() + 1 : now.getFullYear();
      const actualMonth = nextMonth % 12;

      if (ordWord === 'last') {
        const lastDay = new Date(nextMonthYear, actualMonth + 1, 0);
        while (lastDay.getDay() !== targetDay) lastDay.setDate(lastDay.getDate() - 1);
        return fmt(lastDay);
      } else {
        const ordNum = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4 }[ordWord] || 1;
        const firstOfMonth = new Date(nextMonthYear, actualMonth, 1);
        let firstOcc = new Date(firstOfMonth);
        while (firstOcc.getDay() !== targetDay) firstOcc.setDate(firstOcc.getDate() + 1);
        firstOcc.setDate(firstOcc.getDate() + (ordNum - 1) * 7);
        return fmt(firstOcc);
      }
    }

    if (/\\bnext\\s+week\\b/i.test(lower)) return fmt(getNextWeekday(1));
    if (/\\bnext\\s+month\\b/i.test(lower)) {
      return fmt(new Date(now.getFullYear(), now.getMonth() + 1, 1));
    }

    const weekdayMatch = lower.match(/\\b(?:on\\s+)?(?:this|next|coming|upcoming|following)\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b/);
    if (weekdayMatch) return fmt(getNextWeekday(DAY_MAP[weekdayMatch[1]]));

    const bareWeekdayMatch = lower.match(/\\bon\\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b/);
    if (bareWeekdayMatch) return fmt(getNextWeekday(DAY_MAP[bareWeekdayMatch[1]]));

    const onDayOfMonthMatch = lower.match(/\\bon\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)/);
    if (onDayOfMonthMatch) {
      const day = parseInt(onDayOfMonthMatch[1], 10);
      const monthIdx = MONTH_MAP[onDayOfMonthMatch[2]];
      let year = now.getFullYear();
      if (new Date(year, monthIdx, day) < now) year++;
      return fmt(new Date(year, monthIdx, day));
    }

    const onMonthDayMatch = lower.match(/\\bon\\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b/);
    if (onMonthDayMatch) {
      const monthIdx = MONTH_MAP[onMonthDayMatch[1]];
      const day = parseInt(onMonthDayMatch[2], 10);
      let year = now.getFullYear();
      if (new Date(year, monthIdx, day) < now) year++;
      return fmt(new Date(year, monthIdx, day));
    }

    const slashDateMatch = lower.match(/\\bon\\s+(\\d{1,2})[\\/-](\\d{1,2})(?:[\\/-](\\d{2,4}))?\\b/);
    if (slashDateMatch) {
      const day = parseInt(slashDateMatch[1], 10);
      const month = parseInt(slashDateMatch[2], 10) - 1;
      let year = slashDateMatch[3] ? parseInt(slashDateMatch[3], 10) : now.getFullYear();
      if (year < 100) year += 2000;
      return fmt(new Date(year, month, day));
    }

    const isoMatch = lower.match(/\\bon\\s+(\\d{4})-(\\d{2})-(\\d{2})\\b/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

    return rawMsg;
  }

  normalizeQuadrant(rawQuad) {
    if (!rawQuad) return null;
    let q = rawQuad.toString().toLowerCase().trim();
    if (q.includes('1') || q.includes('one')) return 1;
    if (q.includes('2') || q.includes('two')) return 2;
    if (q.includes('3') || q.includes('three')) return 3;
    if (q.includes('4') || q.includes('four')) return 4;
    return null;
  }

  normalizeWindow(rawWin) {
    if (!rawWin) return null;
    let w = rawWin.toLowerCase().trim();
    if (w.includes('ai') || w.includes('chat') || w.includes('assistant')) return 'ai';
    if (w.includes('calendar')) return 'calendar';
    if (w.includes('report') || w.includes('analytic') || w.includes('performance')) return 'report';
    if (w.includes('history') || w.includes('event')) return 'history';
    if (w.includes('home') || w.includes('dashboard')) return 'home';
    if (w.includes('list')) return 'list';
    if (w.includes('task') || w.includes('creation')) return 'tasks';
    return w;
  }

  normalizeDuration(rawDur) {
    if (!rawDur) return null;
    let d = rawDur.toLowerCase().trim();
    const match = d.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    
    let val = parseFloat(match[1]);
    if (d.includes('hour')) val = val * 60;
    // Default to minutes
    return Math.round(val);
  }
}

module.exports = new EntityNormalizer();
