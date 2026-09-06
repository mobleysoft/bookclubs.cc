/**
 * bookclubs.cc MVP: discussion-guide generator + member roster/matching,
 * sold as a tool for independent bookstore owners running in-person clubs.
 *
 * Scope (per spec_v2.mvp_feature): generate a discussion guide for a chosen
 * book, plus manage a member roster. IMPORTANT HONESTY NOTE: this generator
 * is template/rule-based, not an LLM call -- there is no API key wired in
 * here, so it does not claim to be "AI-generated." It fills genre-appropriate
 * question templates with the book's title/author. That is a real, useful,
 * limited tool -- not the fabricated-AI pattern this portfolio has burned
 * itself on before.
 */

// ---------- Discussion guide generation ----------

const GENERIC_OPENERS = [
  'What was your overall impression of {title}? Did it meet your expectations?',
  'Which character or perspective in {title} did you connect with most, and why?',
  'Was there a passage or scene in {title} that stuck with you? Read it aloud if you can.',
];

const GENERIC_CLOSERS = [
  'Would you recommend {title} to a friend? Who specifically would enjoy it?',
  'If {author} wrote a sequel, what would you want it to cover?',
  'On a scale of 1-5, how would you rate {title}, and what would move it up a point?',
];

const GENRE_TEMPLATES = {
  mystery: [
    'At what point did you start suspecting the actual culprit in {title}? What tipped you off?',
    'Did {author} play fair with the clues, or did the solution feel like it came out of nowhere?',
    'How did the pacing of the investigation affect your enjoyment of {title}?',
  ],
  scifi_fantasy: [
    "What real-world idea or issue do you think {title}'s world-building is commenting on?",
    'Which rule of the world in {title} did you find most original or most confusing?',
    "How did {author}'s magic/technology system affect the stakes of the story?",
  ],
  memoir: [
    'What moment in {title} felt most vulnerable or honest to you?',
    "How did reading {author}'s personal account change your view of the events described?",
    'Did {title} make you reflect on a similar experience in your own life?',
  ],
  nonfiction: [
    'What was the single most surprising fact or argument {author} made in {title}?',
    "Did {title} change your mind about anything? If so, what, and why?",
    'What questions did {title} leave unanswered that you wish it had addressed?',
  ],
  historical_fiction: [
    'How well do you think {title} balanced historical accuracy with storytelling?',
    'What does {title} help you understand about its time period that a textbook would not?',
    'Which historical detail in {title} did you want to learn more about afterward?',
  ],
  fiction: [
    "What theme do you think {author} was most trying to explore in {title}?",
    'How did the setting of {title} shape the story being told?',
    'Did the ending of {title} feel earned? Why or why not?',
  ],
};

const VALID_GENRES = Object.keys(GENRE_TEMPLATES);

function fillTemplate(tpl, { title, author }) {
  return tpl.replace(/\{title\}/g, title).replace(/\{author\}/g, author || 'the author');
}

/**
 * Generate a discussion guide. genre is optional; if omitted or unrecognized,
 * falls back to the generic 'fiction' template set with a note.
 */
function generateDiscussionGuide({ title, author, genre }) {
  if (!title || !String(title).trim()) {
    throw new Error('generateDiscussionGuide requires a book title');
  }
  const normalizedGenre = String(genre || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const genreKey = VALID_GENRES.includes(normalizedGenre) ? normalizedGenre : 'fiction';
  const usedFallback = !VALID_GENRES.includes(normalizedGenre) && !!genre;

  const ctx = { title: String(title).trim(), author: (author || '').trim() };
  const questions = [
    ...GENERIC_OPENERS.map((t) => fillTemplate(t, ctx)),
    ...GENRE_TEMPLATES[genreKey].map((t) => fillTemplate(t, ctx)),
    ...GENERIC_CLOSERS.map((t) => fillTemplate(t, ctx)),
  ];

  return {
    title: ctx.title,
    author: ctx.author || null,
    genre: genreKey,
    genre_fallback_used: usedFallback,
    question_count: questions.length,
    questions,
    generated_by: 'template-rules-v1', // explicitly not an LLM
  };
}

// ---------- Member roster + matching ----------

/**
 * Add a member. availability is an array of day-of-week strings, e.g.
 * ['tuesday', 'thursday']. Rejects duplicate names (case-insensitive).
 */
function addMember(roster, { name, availability }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('member name required');
  const dup = roster.some((m) => m.name.toLowerCase() === trimmedName.toLowerCase());
  if (dup) return { ok: false, roster, reason: 'duplicate member' };

  const normalizedAvail = (availability || []).map((d) => String(d).trim().toLowerCase());
  const member = { name: trimmedName, availability: normalizedAvail };
  return { ok: true, roster: [...roster, member], reason: null };
}

/**
 * Group members by the meeting day that maximizes attendance. Returns an
 * array sorted descending by attendee count:
 *   [{ day: 'tuesday', members: ['Alice','Bob'], count: 2 }, ...]
 * Only days that at least one member listed are included.
 */
function matchMembersByAvailability(roster) {
  const dayMap = {};
  roster.forEach((m) => {
    m.availability.forEach((day) => {
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(m.name);
    });
  });
  return Object.entries(dayMap)
    .map(([day, members]) => ({ day, members, count: members.length }))
    .sort((a, b) => b.count - a.count);
}

const api = {
  generateDiscussionGuide,
  addMember,
  matchMembersByAvailability,
  VALID_GENRES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.ClubTools = api;
}
