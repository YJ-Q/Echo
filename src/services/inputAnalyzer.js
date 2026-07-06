const EMOTIONS = {
  anxious: [
    'anxious',
    'afraid',
    'panic',
    'worried',
    'stress',
    'stressed',
    '焦虑',
    '害怕',
    '慌',
    '压力'
  ],
  distracted: [
    'distracted',
    'procrastinate',
    'procrastinating',
    'stuck',
    'scrolling',
    'avoid',
    '拖延',
    '分心',
    '刷',
    '卡住',
    '不想做'
  ],
  motivated: [
    'want to learn',
    'teach me',
    'help me study',
    'plan',
    'start',
    'ready',
    '想学',
    '教我',
    '学习',
    '开始',
    '计划'
  ],
  focused: [
    'focused',
    'deep work',
    'finished',
    'complete',
    '专注',
    '完成',
    '搞定',
    '进入状态'
  ]
};

const TAG_RULES = [
  ['learning', ['learn', 'study', 'teach', 'course', '学', '学习', '教我', '课程']],
  ['procrastination', ['procrastinate', 'procrastinating', 'delay', 'avoid', '拖延', '逃避', '不想做']],
  ['study', ['exam', 'homework', 'paper', 'reading', '考试', '作业', '论文', '读书']],
  ['mood', ['sad', 'angry', 'lonely', 'tired', '难过', '生气', '孤独', '累']],
  ['life', ['life', 'relationship', 'family', '生活', '关系', '家人']],
  ['planning', ['plan', 'schedule', 'tomorrow', 'today', '计划', '安排', '今天', '明天']]
];

export function analyzeInput(input) {
  const text = input.toLowerCase();
  const intent = detectIntent(text);
  const emotion = detectEmotion(text, intent);
  const tags = detectTags(text, intent);

  return { emotion, intent, tags };
}

function detectIntent(text) {
  if (matchesAny(text, ['want to learn', 'teach me', 'help me study', '想学', '教我', '帮我学'])) {
    return 'learning';
  }

  if (matchesAny(text, ['stuck', 'procrastinate', 'avoid', '拖延', '卡住', '不想做'])) {
    return 'struggle';
  }

  if (matchesAny(text, ['plan', 'schedule', 'todo', '计划', '安排'])) {
    return 'planning';
  }

  return 'chat';
}

function detectEmotion(text, intent) {
  for (const [emotion, keywords] of Object.entries(EMOTIONS)) {
    if (matchesAny(text, keywords)) {
      return emotion;
    }
  }

  if (intent === 'learning' || intent === 'planning') {
    return 'motivated';
  }

  return 'neutral';
}

function detectTags(text, intent) {
  const tags = new Set();

  for (const [tag, keywords] of TAG_RULES) {
    if (matchesAny(text, keywords)) {
      tags.add(tag);
    }
  }

  if (intent === 'learning') {
    tags.add('learning');
  }

  if (intent === 'struggle') {
    tags.add('procrastination');
  }

  if (tags.size === 0) {
    tags.add('life');
  }

  return [...tags];
}

function matchesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}
