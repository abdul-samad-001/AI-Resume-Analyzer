/* ================================================================
   AI Resume Analyzer — Client-Side Analysis Engine
   No data leaves the user's device. All processing is in-browser.
   ================================================================ */

(function () {
  'use strict';

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const resumeFileInput = $('#resumeFile');
  const resumeTextArea = $('#resumeText');
  const jobTextArea = $('#jobText');
  const roleSelect = $('#roleSelect');
  const analyzeBtn = $('#analyzeBtn');
  const loader = $('#loader');
  const loaderText = $('#loaderText');
  const resultsSection = $('#results');
  const scoreEl = $('#score');
  const charCountEl = $('#charCount');
  const dropZone = $('#dropZone');
  const fileStatus = $('#file-status');
  const themeToggle = $('#themeToggle');

  let lastReport = '';

  // ================================================================
  //  SECTION 1: THEME MANAGEMENT
  // ================================================================

  function initTheme() {
    const saved = localStorage.getItem('resume-analyzer-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('resume-analyzer-theme', isDark ? 'light' : 'dark');
  });

  initTheme();

  // ================================================================
  //  SECTION 2: FILE HANDLING (PDF, DOCX, TXT, MD)
  // ================================================================

  const ACCEPTED_TYPES = {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'text/plain': 'txt',
    'text/markdown': 'md',
  };

  function getFileExtension(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    return ext;
  }

  async function parseFile(file) {
    const ext = getFileExtension(file);

    switch (ext) {
      case 'pdf':
        return await parsePDF(file);
      case 'docx':
        return await parseDOCX(file);
      case 'doc':
        return parseDOCFallback(file);
      case 'txt':
      case 'md':
      case 'markdown':
        return await readAsText(file);
      default:
        throw new Error(`Unsupported file format: .${ext}`);
    }
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  function readAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function parsePDF(file) {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF.js library not loaded. Please check your internet connection and reload.');
    }
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const buffer = await readAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map((item) => item.str).join(' ');
      pages.push(text);
    }

    return pages.join('\n\n');
  }

  async function parseDOCX(file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('Mammoth.js library not loaded. Please check your internet connection and reload.');
    }
    const buffer = await readAsArrayBuffer(file);
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  async function parseDOCFallback(file) {
    // .doc (legacy binary) is difficult to parse client-side.
    // Attempt text extraction; warn user if garbled.
    const text = await readAsText(file);
    const printable = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ');
    if (printable.trim().length < 50) {
      throw new Error(
        'Legacy .doc format could not be parsed in the browser. Please convert to .docx or .pdf and try again.'
      );
    }
    return printable;
  }

  // ── Drop Zone & File Input ──

  dropZone.addEventListener('click', () => resumeFileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      resumeFileInput.click();
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });

  resumeFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
  });

  async function handleFileUpload(file) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      fileStatus.textContent = 'File too large (max 10MB). Please use a smaller file.';
      fileStatus.style.color = 'var(--danger)';
      return;
    }

    fileStatus.textContent = `Parsing "${file.name}"...`;
    fileStatus.style.color = 'var(--text-muted)';

    try {
      const text = await parseFile(file);
      resumeTextArea.value = text;
      updateCharCount();
      fileStatus.textContent = `Loaded "${file.name}" (${text.length.toLocaleString()} characters)`;
      fileStatus.style.color = 'var(--success)';
    } catch (err) {
      fileStatus.textContent = `Error: ${err.message}`;
      fileStatus.style.color = 'var(--danger)';
    }
  }

  // ── Character Count ──

  resumeTextArea.addEventListener('input', updateCharCount);

  function updateCharCount() {
    charCountEl.textContent = resumeTextArea.value.length.toLocaleString();
  }

  // ================================================================
  //  SECTION 3: ROLE-BASED KEYWORD DATABASES
  // ================================================================

  const ROLE_KEYWORDS = {
    'software-engineer': {
      required: ['javascript', 'python', 'java', 'git', 'api', 'algorithms', 'data structures', 'testing', 'debugging', 'agile'],
      preferred: ['react', 'node', 'typescript', 'aws', 'docker', 'kubernetes', 'ci/cd', 'microservices', 'rest', 'graphql', 'sql', 'nosql', 'redis', 'linux', 'performance'],
      action_verbs: ['developed', 'built', 'designed', 'implemented', 'optimized', 'architected', 'deployed', 'integrated', 'refactored', 'automated'],
    },
    'data-scientist': {
      required: ['python', 'machine learning', 'statistics', 'sql', 'data analysis', 'visualization', 'modeling', 'pandas', 'numpy', 'scikit-learn'],
      preferred: ['tensorflow', 'pytorch', 'deep learning', 'nlp', 'r', 'spark', 'tableau', 'a/b testing', 'feature engineering', 'big data', 'aws', 'gcp', 'jupyter'],
      action_verbs: ['analyzed', 'modeled', 'predicted', 'visualized', 'optimized', 'discovered', 'automated', 'researched', 'improved', 'reduced'],
    },
    'product-manager': {
      required: ['roadmap', 'stakeholders', 'prioritization', 'user research', 'agile', 'metrics', 'strategy', 'requirements', 'cross-functional', 'data-driven'],
      preferred: ['okrs', 'a/b testing', 'jira', 'scrum', 'kanban', 'persona', 'mvp', 'analytics', 'market research', 'competitive analysis', 'sprint planning', 'user stories'],
      action_verbs: ['launched', 'drove', 'defined', 'prioritized', 'led', 'managed', 'delivered', 'coordinated', 'aligned', 'increased'],
    },
    'ux-designer': {
      required: ['user research', 'wireframing', 'prototyping', 'usability testing', 'figma', 'design thinking', 'user flows', 'accessibility', 'interaction design', 'visual design'],
      preferred: ['sketch', 'adobe xd', 'invision', 'responsive design', 'design systems', 'information architecture', 'heuristic evaluation', 'persona', 'journey mapping', 'a/b testing'],
      action_verbs: ['designed', 'researched', 'prototyped', 'tested', 'iterated', 'created', 'improved', 'conducted', 'collaborated', 'simplified'],
    },
    'marketing-manager': {
      required: ['marketing strategy', 'campaigns', 'analytics', 'seo', 'content marketing', 'social media', 'brand', 'roi', 'email marketing', 'lead generation'],
      preferred: ['google analytics', 'hubspot', 'crm', 'ppc', 'conversion rate', 'copywriting', 'market research', 'segmentation', 'funnel', 'retention'],
      action_verbs: ['launched', 'increased', 'grew', 'managed', 'optimized', 'created', 'drove', 'achieved', 'scaled', 'generated'],
    },
    'project-manager': {
      required: ['project planning', 'stakeholders', 'risk management', 'budget', 'scheduling', 'agile', 'waterfall', 'scope', 'deliverables', 'cross-functional'],
      preferred: ['pmp', 'scrum', 'gantt', 'jira', 'confluence', 'resource allocation', 'change management', 'sprint', 'milestone', 'procurement'],
      action_verbs: ['managed', 'delivered', 'coordinated', 'planned', 'led', 'tracked', 'mitigated', 'facilitated', 'executed', 'reported'],
    },
    'devops-engineer': {
      required: ['ci/cd', 'docker', 'kubernetes', 'aws', 'linux', 'automation', 'infrastructure', 'monitoring', 'terraform', 'scripting'],
      preferred: ['ansible', 'jenkins', 'github actions', 'gcp', 'azure', 'prometheus', 'grafana', 'helm', 'microservices', 'security', 'networking', 'load balancing'],
      action_verbs: ['automated', 'deployed', 'configured', 'monitored', 'optimized', 'managed', 'built', 'maintained', 'scaled', 'reduced'],
    },
    'business-analyst': {
      required: ['requirements', 'stakeholders', 'data analysis', 'process improvement', 'documentation', 'sql', 'business process', 'user stories', 'gap analysis', 'reporting'],
      preferred: ['tableau', 'power bi', 'jira', 'confluence', 'agile', 'uml', 'bpmn', 'excel', 'erd', 'use cases', 'kpi', 'dashboard'],
      action_verbs: ['analyzed', 'documented', 'identified', 'recommended', 'facilitated', 'gathered', 'improved', 'streamlined', 'mapped', 'validated'],
    },
  };

  // Common stop words to exclude from keyword extraction
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
    'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'shall', 'can',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my',
    'your', 'his', 'her', 'its', 'our', 'their', 'what', 'which', 'who', 'whom', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'also', 'about', 'up', 'out', 'if', 'then', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'once',
    'here', 'there', 'any', 'new', 'work', 'worked', 'working', 'using', 'used', 'use',
    'including', 'included', 'include', 'able', 'well', 'also', 'etc', 'per', 'via',
  ]);

  // ================================================================
  //  SECTION 4: NLP & ANALYSIS ENGINE
  // ================================================================

  // ── 4a: Section Detection ──

  const SECTION_PATTERNS = {
    'Summary / Objective': /\b(summary|professional\s+summary|profile|objective|about\s+me|personal\s+statement|career\s+objective)\b/i,
    'Experience': /\b(experience|work\s+history|employment|professional\s+experience|work\s+experience|career\s+history)\b/i,
    'Education': /\b(education|academic|degree|university|college|school|certification|certifications|qualification)\b/i,
    'Skills': /\b(skills|technical\s+skills|core\s+competencies|technologies|tools|proficiencies|expertise|competencies)\b/i,
    'Projects': /\b(projects|portfolio|personal\s+projects|key\s+projects|academic\s+projects)\b/i,
    'Awards / Honors': /\b(awards|honors|achievements|recognition|accomplishments)\b/i,
    'Volunteer': /\b(volunteer|community|service|nonprofit)\b/i,
    'Languages': /\b(languages|fluent|proficient\s+in|native\s+speaker)\b/i,
    'Contact Info': /\b(email|phone|linkedin|github|portfolio|website|address|contact)\b/i,
  };

  function detectSections(text) {
    const results = {};
    for (const [name, pattern] of Object.entries(SECTION_PATTERNS)) {
      results[name] = pattern.test(text);
    }
    return results;
  }

  // ── 4b: Quantified Achievements ──

  const ACHIEVEMENT_PATTERNS = [
    /\d+[%]/g,                                     // percentages
    /\$[\d,.]+[kmb]?\b/gi,                         // dollar amounts
    /\b\d{1,3}(?:,\d{3})*\+?\s*(?:users|customers|clients|employees|members|downloads|installs|subscribers)/gi,
    /(?:increased|decreased|reduced|improved|grew|boosted|saved|generated|delivered|achieved)\s+.*?\d+/gi,
    /\b\d+x\b/gi,                                  // multipliers like "3x"
    /\btop\s+\d+[%]?\b/gi,                         // "top 5%"
    /\b\d+\+?\s+(?:years?|months?)\b/gi,           // duration
  ];

  function detectAchievements(text) {
    const found = new Set();
    for (const pattern of ACHIEVEMENT_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((m) => found.add(m.trim()));
      }
    }
    return [...found];
  }

  // ── 4c: Action Verbs Detection ──

  const STRONG_ACTION_VERBS = new Set([
    'achieved', 'administered', 'analyzed', 'architected', 'automated', 'built', 'championed',
    'collaborated', 'conceptualized', 'configured', 'consolidated', 'coordinated', 'created',
    'decreased', 'delivered', 'deployed', 'designed', 'developed', 'directed', 'drove',
    'eliminated', 'enabled', 'engineered', 'enhanced', 'established', 'executed', 'expanded',
    'facilitated', 'formulated', 'founded', 'generated', 'grew', 'headed', 'identified',
    'implemented', 'improved', 'increased', 'influenced', 'initiated', 'innovated', 'integrated',
    'launched', 'led', 'managed', 'mentored', 'migrated', 'modernized', 'negotiated', 'optimized',
    'orchestrated', 'overhauled', 'partnered', 'pioneered', 'planned', 'presented', 'prioritized',
    'produced', 'published', 'raised', 'redesigned', 'reduced', 'refactored', 'restructured',
    'revamped', 'scaled', 'simplified', 'spearheaded', 'streamlined', 'strengthened',
    'supervised', 'surpassed', 'trained', 'transformed', 'tripled', 'visualized',
  ]);

  const WEAK_VERBS = new Set([
    'responsible for', 'helped', 'assisted', 'worked on', 'involved in', 'participated in',
    'tasked with', 'handled', 'did', 'made', 'got', 'went',
  ]);

  function detectActionVerbs(text) {
    const lower = text.toLowerCase();
    const strong = [];
    const weak = [];

    STRONG_ACTION_VERBS.forEach((verb) => {
      if (lower.includes(verb)) strong.push(verb);
    });

    WEAK_VERBS.forEach((verb) => {
      if (lower.includes(verb)) weak.push(verb);
    });

    return { strong, weak };
  }

  // ── 4d: Keyword Extraction from Job Description ──

  function extractKeywords(text) {
    if (!text || text.trim().length < 10) return [];

    const lower = text.toLowerCase();
    // Extract multi-word technical terms first
    const multiWordPatterns = [
      /machine learning/gi, /deep learning/gi, /data structures/gi, /natural language/gi,
      /ci\/cd/gi, /cross-functional/gi, /user research/gi, /project management/gi,
      /problem solving/gi, /team building/gi, /data analysis/gi, /software development/gi,
      /version control/gi, /design thinking/gi, /a\/b testing/gi, /user experience/gi,
      /business intelligence/gi, /cloud computing/gi, /data visualization/gi,
    ];

    const keywords = new Set();

    multiWordPatterns.forEach((p) => {
      const matches = text.match(p);
      if (matches) matches.forEach((m) => keywords.add(m.toLowerCase()));
    });

    // Single-word keywords (4+ chars, not stop words)
    const words = lower.match(/\b[a-z][a-z0-9+#.-]{2,}\b/g) || [];
    const freq = {};
    words.forEach((w) => {
      if (!STOP_WORDS.has(w) && w.length >= 3) {
        freq[w] = (freq[w] || 0) + 1;
      }
    });

    // Take top words by frequency
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .forEach(([word]) => keywords.add(word));

    return [...keywords];
  }

  // ── 4e: Skills Extraction from Resume ──

  const TECH_SKILLS = new Set([
    'javascript', 'typescript', 'python', 'java', 'c++', 'c#', 'ruby', 'go', 'rust', 'php',
    'swift', 'kotlin', 'scala', 'r', 'matlab', 'perl', 'html', 'css', 'sass', 'less',
    'react', 'angular', 'vue', 'svelte', 'next.js', 'nuxt', 'node.js', 'express', 'django',
    'flask', 'spring', 'rails', 'laravel', '.net', 'asp.net',
    'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins',
    'git', 'github', 'gitlab', 'bitbucket', 'jira', 'confluence',
    'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'dynamodb', 'firebase',
    'graphql', 'rest', 'api', 'grpc', 'websocket',
    'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy', 'keras',
    'figma', 'sketch', 'adobe xd', 'photoshop', 'illustrator',
    'tableau', 'power bi', 'excel', 'google analytics',
    'linux', 'bash', 'powershell', 'nginx', 'apache',
    'agile', 'scrum', 'kanban', 'waterfall', 'devops', 'ci/cd',
    'machine learning', 'deep learning', 'nlp', 'computer vision', 'data science',
    'blockchain', 'iot', 'microservices', 'serverless', 'oauth', 'jwt',
  ]);

  function extractSkills(text) {
    const lower = text.toLowerCase();
    const found = [];

    TECH_SKILLS.forEach((skill) => {
      // Use word boundary matching for short skills to avoid false positives
      if (skill.length <= 3) {
        const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(lower)) found.push(skill);
      } else {
        if (lower.includes(skill)) found.push(skill);
      }
    });

    return [...new Set(found)].sort();
  }

  // ── 4f: Keyword Matching ──

  function matchKeywords(resumeText, keywords) {
    if (keywords.length === 0) return { score: 0, matched: [], missing: [] };

    const lower = resumeText.toLowerCase();
    const matched = [];
    const missing = [];

    keywords.forEach((kw) => {
      if (lower.includes(kw)) {
        matched.push(kw);
      } else {
        missing.push(kw);
      }
    });

    return {
      score: keywords.length > 0 ? Math.round((matched.length / keywords.length) * 100) : 0,
      matched,
      missing,
    };
  }

  // ── 4g: Readability Analysis ──

  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;

    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');

    const vowelGroups = word.match(/[aeiouy]{1,2}/g);
    return vowelGroups ? vowelGroups.length : 1;
  }

  function analyzeReadability(text) {
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const words = text.match(/\b[a-zA-Z]+\b/g) || [];
    const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);

    const wordCount = words.length;
    const sentenceCount = Math.max(sentences.length, 1);
    const avgWordsPerSentence = wordCount / sentenceCount;
    const avgSyllablesPerWord = wordCount > 0 ? totalSyllables / wordCount : 0;

    // Flesch Reading Ease
    const fleschEase = 206.835 - 1.015 * avgWordsPerSentence - 84.6 * avgSyllablesPerWord;
    const clampedFlesch = Math.max(0, Math.min(100, Math.round(fleschEase)));

    // Flesch-Kincaid Grade Level
    const gradeLevel = 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59;
    const clampedGrade = Math.max(0, Math.round(gradeLevel * 10) / 10);

    // Words with 3+ syllables (complex words)
    const complexWords = words.filter((w) => countSyllables(w) >= 3).length;
    const complexPercent = wordCount > 0 ? Math.round((complexWords / wordCount) * 100) : 0;

    // Paragraphs
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;

    // Bullet points
    const bullets = (text.match(/^[\s]*[-•*▪►◦]\s/gm) || []).length;

    let level, description;
    if (clampedFlesch >= 60) {
      level = 'good';
      description = 'Easy to read — appropriate for a resume';
    } else if (clampedFlesch >= 40) {
      level = 'ok';
      description = 'Moderately readable — consider simplifying some sentences';
    } else {
      level = 'poor';
      description = 'Difficult to read — shorten sentences and use simpler words';
    }

    return {
      fleschEase: clampedFlesch,
      gradeLevel: clampedGrade,
      wordCount,
      sentenceCount,
      avgWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
      complexPercent,
      paragraphs,
      bullets,
      level,
      description,
    };
  }

  // ── 4h: Email / Phone / LinkedIn detection ──

  function detectContactInfo(text) {
    return {
      email: /[\w.-]+@[\w.-]+\.\w{2,}/.test(text),
      phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text),
      linkedin: /linkedin\.com/i.test(text),
      github: /github\.com/i.test(text),
      portfolio: /portfolio|website|personal\s+site/i.test(text),
    };
  }

  // ── 4i: Length Assessment ──

  function assessLength(wordCount) {
    if (wordCount < 200) return { rating: 'too-short', message: 'Resume seems too short (under 200 words)' };
    if (wordCount < 400) return { rating: 'short', message: 'Resume is on the shorter side (under 400 words)' };
    if (wordCount <= 800) return { rating: 'good', message: 'Resume length is in the ideal range' };
    if (wordCount <= 1200) return { rating: 'ok', message: 'Resume is slightly long — consider trimming for a 1-page format' };
    return { rating: 'long', message: 'Resume is quite long — recruiters prefer concise resumes (1-2 pages)' };
  }

  // ================================================================
  //  SECTION 5: SCORING ENGINE
  // ================================================================

  function calculateScore(sections, keywordResult, achievements, actionVerbs, readability, contactInfo, wordCount) {
    const breakdown = {};

    // Structure (25 pts)
    let structScore = 0;
    const critical = ['Summary / Objective', 'Experience', 'Education', 'Skills'];
    critical.forEach((s) => { if (sections[s]) structScore += 5; });
    if (sections['Projects']) structScore += 3;
    if (sections['Contact Info']) structScore += 2;
    breakdown.structure = Math.min(25, structScore);

    // Keywords (25 pts)
    if (keywordResult.score > 0) {
      breakdown.keywords = Math.round(keywordResult.score * 0.25);
    } else {
      breakdown.keywords = 12; // neutral if no job desc provided
    }

    // Impact & Achievements (25 pts)
    let impactScore = 0;
    impactScore += Math.min(10, achievements.length * 2.5);
    impactScore += Math.min(10, actionVerbs.strong.length * 1.5);
    impactScore -= Math.min(5, actionVerbs.weak.length * 1.5);
    breakdown.impact = Math.max(0, Math.min(25, Math.round(impactScore)));

    // Readability & Formatting (25 pts)
    let readScore = 0;
    if (readability.level === 'good') readScore += 10;
    else if (readability.level === 'ok') readScore += 6;
    else readScore += 2;

    if (readability.bullets >= 3) readScore += 5;
    else if (readability.bullets >= 1) readScore += 2;

    const lenAssess = assessLength(wordCount);
    if (lenAssess.rating === 'good') readScore += 5;
    else if (lenAssess.rating === 'ok' || lenAssess.rating === 'short') readScore += 3;
    else readScore += 1;

    if (contactInfo.email) readScore += 2;
    if (contactInfo.phone || contactInfo.linkedin) readScore += 3;
    breakdown.readability = Math.min(25, readScore);

    const total = breakdown.structure + breakdown.keywords + breakdown.impact + breakdown.readability;

    return { total: Math.min(100, total), breakdown };
  }

  // ================================================================
  //  SECTION 6: SUGGESTION GENERATOR
  // ================================================================

  function generateSuggestions(sections, keywordResult, achievements, actionVerbs, readability, contactInfo, wordCount, skills) {
    const suggestions = [];

    // ── Structure suggestions ──
    if (!sections['Summary / Objective']) {
      suggestions.push({
        priority: 'high',
        text: 'Add a Professional Summary section',
        detail: 'A 2-3 sentence summary at the top helps recruiters quickly understand your profile and value proposition.',
      });
    }

    if (!sections['Skills']) {
      suggestions.push({
        priority: 'high',
        text: 'Add a Skills section',
        detail: 'List your key technical and soft skills. ATS systems scan for specific skills keywords.',
      });
    }

    if (!sections['Experience']) {
      suggestions.push({
        priority: 'high',
        text: 'Add a Work Experience section',
        detail: 'Experience is the most important section. List roles with company, dates, and accomplishments.',
      });
    }

    if (!sections['Education']) {
      suggestions.push({
        priority: 'medium',
        text: 'Add an Education section',
        detail: 'Include your degree(s), institution, and graduation date. GPA is optional unless very strong.',
      });
    }

    if (!sections['Contact Info']) {
      suggestions.push({
        priority: 'high',
        text: 'Ensure contact information is clearly visible',
        detail: 'Include email, phone number, and LinkedIn URL at the top of your resume.',
      });
    }

    // ── Contact info ──
    if (!contactInfo.email) {
      suggestions.push({
        priority: 'high',
        text: 'Add an email address',
        detail: 'Use a professional email address (e.g., firstname.lastname@email.com).',
      });
    }

    if (!contactInfo.linkedin) {
      suggestions.push({
        priority: 'low',
        text: 'Consider adding your LinkedIn profile URL',
        detail: 'Most recruiters will look you up on LinkedIn. Include a custom URL.',
      });
    }

    // ── Keywords ──
    if (keywordResult.missing && keywordResult.missing.length > 5) {
      suggestions.push({
        priority: 'high',
        text: 'Improve keyword alignment with the job description',
        detail: `Your resume is missing ${keywordResult.missing.length} keywords from the job description. Consider naturally incorporating: ${keywordResult.missing.slice(0, 8).join(', ')}.`,
      });
    } else if (keywordResult.missing && keywordResult.missing.length > 0) {
      suggestions.push({
        priority: 'medium',
        text: 'Add a few more keywords from the job description',
        detail: `Consider adding: ${keywordResult.missing.slice(0, 5).join(', ')}.`,
      });
    }

    // ── Achievements ──
    if (achievements.length === 0) {
      suggestions.push({
        priority: 'high',
        text: 'Add quantified achievements',
        detail: 'Use numbers, percentages, and metrics. e.g., "Reduced load time by 40%" or "Managed a team of 12." Quantified results make your impact concrete.',
      });
    } else if (achievements.length < 3) {
      suggestions.push({
        priority: 'medium',
        text: 'Add more quantified results',
        detail: `You have ${achievements.length} quantified achievement(s). Aim for at least one per role. Use metrics like revenue impact, time saved, users served, or efficiency gains.`,
      });
    }

    // ── Action verbs ──
    if (actionVerbs.weak.length > 0) {
      suggestions.push({
        priority: 'medium',
        text: 'Replace weak phrases with strong action verbs',
        detail: `Found weak phrases: "${actionVerbs.weak.join('", "')}". Replace with strong verbs like "developed," "led," "optimized," "launched."`,
      });
    }

    if (actionVerbs.strong.length < 3) {
      suggestions.push({
        priority: 'medium',
        text: 'Use more impactful action verbs',
        detail: 'Start each bullet with a strong verb: achieved, built, designed, implemented, launched, optimized, scaled, streamlined.',
      });
    }

    // ── Readability ──
    if (readability.level === 'poor') {
      suggestions.push({
        priority: 'high',
        text: 'Improve readability — sentences are too complex',
        detail: `Avg. ${readability.avgWordsPerSentence} words/sentence. Aim for 15-20 words. Use shorter sentences and simpler vocabulary.`,
      });
    } else if (readability.avgWordsPerSentence > 25) {
      suggestions.push({
        priority: 'medium',
        text: 'Shorten some sentences for clarity',
        detail: `Your average sentence length is ${readability.avgWordsPerSentence} words. Shorter sentences are easier to scan quickly.`,
      });
    }

    if (readability.bullets < 3) {
      suggestions.push({
        priority: 'medium',
        text: 'Use more bullet points for experience entries',
        detail: 'Bullet points (3-5 per role) make your resume scannable. Recruiters spend ~7 seconds on initial review.',
      });
    }

    // ── Length ──
    const lenAssess = assessLength(wordCount);
    if (lenAssess.rating === 'too-short') {
      suggestions.push({
        priority: 'high',
        text: lenAssess.message,
        detail: 'Expand on your experience, skills, and achievements. A well-written resume typically has 400-800 words.',
      });
    } else if (lenAssess.rating === 'long') {
      suggestions.push({
        priority: 'medium',
        text: lenAssess.message,
        detail: 'Remove outdated or irrelevant experience. Focus on the last 10-15 years. Cut filler words.',
      });
    }

    // ── Positive feedback ──
    if (achievements.length >= 3) {
      suggestions.push({
        priority: 'positive',
        text: 'Strong use of quantified achievements',
        detail: `Found ${achievements.length} quantified results. This effectively demonstrates your impact.`,
      });
    }

    if (actionVerbs.strong.length >= 5) {
      suggestions.push({
        priority: 'positive',
        text: 'Good use of strong action verbs',
        detail: `Found ${actionVerbs.strong.length} impactful action verbs. This conveys initiative and accomplishment.`,
      });
    }

    if (keywordResult.score >= 70) {
      suggestions.push({
        priority: 'positive',
        text: 'Strong keyword match with job description',
        detail: `${keywordResult.score}% keyword alignment. Your resume is well-tailored for this role.`,
      });
    }

    if (readability.level === 'good' && readability.bullets >= 3) {
      suggestions.push({
        priority: 'positive',
        text: 'Well-formatted and easy to read',
        detail: 'Good readability score and use of bullet points for scannability.',
      });
    }

    // Sort: high > medium > low > positive
    const priorityOrder = { high: 0, medium: 1, low: 2, positive: 3 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions;
  }

  // ================================================================
  //  SECTION 7: RENDERING
  // ================================================================

  // ── Tabs ──

  const tabs = $$('.tab');
  const panels = $$('.tab-panel');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      panels.forEach((p) => { p.classList.remove('active'); p.hidden = true; });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const panelId = tab.getAttribute('aria-controls');
      const panel = $(`#${panelId}`);
      panel.classList.add('active');
      panel.hidden = false;
    });

    // Keyboard navigation for tabs
    tab.addEventListener('keydown', (e) => {
      let target;
      if (e.key === 'ArrowRight') {
        target = tab.nextElementSibling || tabs[0];
      } else if (e.key === 'ArrowLeft') {
        target = tab.previousElementSibling || tabs[tabs.length - 1];
      }
      if (target && target.classList.contains('tab')) {
        target.focus();
        target.click();
      }
    });
  });

  // ── Section Display ──

  function renderSections(sections) {
    const container = $('#sectionsList');
    container.innerHTML = '';

    Object.entries(sections).forEach(([name, found]) => {
      const div = document.createElement('div');
      div.className = `section-item ${found ? 'found' : 'missing'}`;
      div.innerHTML = `<span class="section-icon">${found ? '\u2713' : '\u2717'}</span> ${name}`;
      container.appendChild(div);
    });
  }

  // ── Quick Stats ──

  function renderQuickStats(readability, achievements, actionVerbs, skills, contactInfo) {
    const container = $('#quickStats');
    container.innerHTML = '';

    const stats = [
      { value: readability.wordCount.toLocaleString(), label: 'Words' },
      { value: readability.sentenceCount, label: 'Sentences' },
      { value: readability.bullets, label: 'Bullet Points' },
      { value: achievements.length, label: 'Metrics Found' },
      { value: actionVerbs.strong.length, label: 'Action Verbs' },
      { value: skills.length, label: 'Skills Detected' },
    ];

    stats.forEach((s) => {
      const div = document.createElement('div');
      div.className = 'stat-item';
      div.innerHTML = `<div class="stat-value">${s.value}</div><div class="stat-label">${s.label}</div>`;
      container.appendChild(div);
    });
  }

  // ── Score Dashboard ──

  function renderScore(total, breakdown) {
    // Animate score number
    animateNumber(scoreEl, 0, total, 1000);

    // Animate ring
    const ring = $('.ring-progress');
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference - (total / 100) * circumference;
    ring.style.strokeDashoffset = offset;

    // Color ring based on score
    if (total >= 70) ring.style.stroke = 'var(--success)';
    else if (total >= 40) ring.style.stroke = 'var(--warning)';
    else ring.style.stroke = 'var(--danger)';

    // Breakdown bars
    const container = $('#scoreBreakdown');
    container.innerHTML = '';

    const items = [
      { label: 'Structure', value: breakdown.structure, max: 25, color: 'var(--info)' },
      { label: 'Keywords', value: breakdown.keywords, max: 25, color: 'var(--primary)' },
      { label: 'Impact', value: breakdown.impact, max: 25, color: 'var(--success)' },
      { label: 'Readability', value: breakdown.readability, max: 25, color: 'var(--warning)' },
    ];

    items.forEach((item) => {
      const pct = Math.round((item.value / item.max) * 100);
      const div = document.createElement('div');
      div.className = 'breakdown-item';
      div.innerHTML = `
        <span class="breakdown-label">${item.label}</span>
        <div class="breakdown-bar"><div class="breakdown-fill" style="width:${pct}%;background:${item.color}"></div></div>
        <span class="breakdown-value">${item.value}/${item.max}</span>
      `;
      container.appendChild(div);
    });
  }

  function animateNumber(el, start, end, duration) {
    const startTime = performance.now();
    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      el.textContent = Math.round(start + (end - start) * eased);
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // ── Keywords Panel ──

  function renderKeywords(keywordResult, skills, jobKeywords) {
    const container = $('#keywordMatch');
    container.innerHTML = '';

    if (jobKeywords.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">Paste a job description or select a role to see keyword matching.</p>';
    } else {
      const bar = document.createElement('div');
      bar.className = 'keyword-bar';
      bar.innerHTML = `
        <span>Match Rate</span>
        <div class="keyword-meter">
          <div class="keyword-fill" style="width:${keywordResult.score}%;background:${keywordResult.score >= 70 ? 'var(--success)' : keywordResult.score >= 40 ? 'var(--warning)' : 'var(--danger)'}">
            ${keywordResult.score}%
          </div>
        </div>
      `;
      container.appendChild(bar);

      if (keywordResult.matched.length > 0) {
        const matchedP = document.createElement('p');
        matchedP.style.cssText = 'font-size:0.85rem;color:var(--text-muted);margin-top:8px;';
        matchedP.textContent = `Matched ${keywordResult.matched.length} of ${jobKeywords.length} keywords`;
        container.appendChild(matchedP);
      }
    }

    // Skills tags
    const tagCloud = $('#skillTags');
    tagCloud.innerHTML = '';

    if (skills.length === 0) {
      tagCloud.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No technical skills detected. Ensure you list your skills explicitly.</p>';
    } else {
      skills.forEach((skill) => {
        const span = document.createElement('span');
        const isMatched = jobKeywords.some((kw) => kw.includes(skill) || skill.includes(kw));
        span.className = `tag ${isMatched ? 'matched' : 'extra'}`;
        span.textContent = skill;
        tagCloud.appendChild(span);
      });
    }

    // Show missing keywords as unmatched tags
    if (keywordResult.missing && keywordResult.missing.length > 0) {
      const missingHeader = document.createElement('h3');
      missingHeader.textContent = 'Missing Keywords';
      missingHeader.style.marginTop = '16px';
      tagCloud.parentNode.appendChild(missingHeader);

      const missingContainer = document.createElement('div');
      missingContainer.className = 'tag-cloud';
      keywordResult.missing.slice(0, 15).forEach((kw) => {
        const span = document.createElement('span');
        span.className = 'tag unmatched';
        span.textContent = kw;
        missingContainer.appendChild(span);
      });
      tagCloud.parentNode.appendChild(missingContainer);
    }
  }

  // ── Suggestions Panel ──

  function renderSuggestions(suggestions) {
    const container = $('#suggestions');
    container.innerHTML = '';

    if (suggestions.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted);">No specific suggestions — your resume structure looks solid.</p>';
      return;
    }

    suggestions.forEach((s) => {
      const div = document.createElement('div');
      div.className = `suggestion-item ${s.priority}`;

      const priorityLabels = { high: 'High Priority', medium: 'Suggestion', low: 'Nice to Have', positive: 'Strength' };

      div.innerHTML = `
        <div class="suggestion-priority" style="color:${s.priority === 'positive' ? 'var(--success)' : s.priority === 'high' ? 'var(--danger)' : s.priority === 'medium' ? 'var(--warning)' : 'var(--info)'}">
          ${priorityLabels[s.priority] || 'Note'}
        </div>
        <div class="suggestion-text">${s.text}</div>
        <div class="suggestion-detail">${s.detail}</div>
      `;
      container.appendChild(div);
    });
  }

  // ── Readability Panel ──

  function renderReadability(readability) {
    const container = $('#readabilityResults');
    container.innerHTML = '';

    // Gauge
    const gaugeColor = readability.level === 'good' ? 'var(--success)' : readability.level === 'ok' ? 'var(--warning)' : 'var(--danger)';

    const gauge = document.createElement('div');
    gauge.className = 'readability-gauge';
    gauge.innerHTML = `
      <svg class="gauge-meter" viewBox="0 0 80 80" aria-hidden="true">
        <circle cx="40" cy="40" r="32" stroke-width="8" fill="none" stroke="var(--border)"/>
        <circle cx="40" cy="40" r="32" stroke-width="8" fill="none" stroke="${gaugeColor}"
                stroke-dasharray="${2 * Math.PI * 32}" stroke-dashoffset="${2 * Math.PI * 32 * (1 - readability.fleschEase / 100)}"
                stroke-linecap="round" transform="rotate(-90 40 40)" style="transition:stroke-dashoffset 1s ease;"/>
        <text x="40" y="38" text-anchor="middle" font-size="16" font-weight="bold" fill="${gaugeColor}">${readability.fleschEase}</text>
        <text x="40" y="52" text-anchor="middle" font-size="8" fill="var(--text-muted)">/ 100</text>
      </svg>
      <div class="gauge-info">
        <h4>Flesch Reading Ease: ${readability.fleschEase}/100</h4>
        <p>${readability.description}</p>
      </div>
    `;
    container.appendChild(gauge);

    // Details grid
    const details = document.createElement('div');
    details.className = 'readability-details';

    const metrics = [
      { label: 'Grade Level', value: `Grade ${readability.gradeLevel}` },
      { label: 'Avg Words/Sentence', value: readability.avgWordsPerSentence },
      { label: 'Complex Words', value: `${readability.complexPercent}%` },
      { label: 'Paragraphs', value: readability.paragraphs },
      { label: 'Word Count', value: readability.wordCount.toLocaleString() },
      { label: 'Sentences', value: readability.sentenceCount },
    ];

    metrics.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'readability-stat';
      div.innerHTML = `<div class="readability-stat-label">${m.label}</div><div class="readability-stat-value">${m.value}</div>`;
      details.appendChild(div);
    });

    container.appendChild(details);
  }

  // ================================================================
  //  SECTION 8: MAIN ANALYSIS ORCHESTRATOR
  // ================================================================

  analyzeBtn.addEventListener('click', async () => {
    const text = resumeTextArea.value.trim();

    if (text.length < 30) {
      fileStatus.textContent = 'Please upload a resume or paste at least 30 characters of text.';
      fileStatus.style.color = 'var(--danger)';
      resumeTextArea.focus();
      return;
    }

    analyzeBtn.disabled = true;
    loader.classList.remove('hidden');
    resultsSection.classList.add('hidden');

    // Simulate progressive loading messages
    const steps = ['Parsing document...', 'Analyzing structure...', 'Extracting keywords...', 'Evaluating readability...', 'Generating suggestions...'];
    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      stepIdx++;
      if (stepIdx < steps.length) {
        loaderText.textContent = steps[stepIdx];
      }
    }, 300);

    // Use setTimeout to allow UI to update, then run the synchronous analysis
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Get job description context
      let jobDesc = jobTextArea.value.trim();
      const selectedRole = roleSelect.value;
      let jobKeywords = [];

      if (jobDesc.length > 10) {
        jobKeywords = extractKeywords(jobDesc);
      } else if (selectedRole && ROLE_KEYWORDS[selectedRole]) {
        const roleData = ROLE_KEYWORDS[selectedRole];
        jobKeywords = [...roleData.required, ...roleData.preferred];
      }

      // Run all analyses
      const sections = detectSections(text);
      const achievements = detectAchievements(text);
      const actionVerbs = detectActionVerbs(text);
      const keywordResult = matchKeywords(text, jobKeywords);
      const readability = analyzeReadability(text);
      const contactInfo = detectContactInfo(text);
      const skills = extractSkills(text);
      const wordCount = readability.wordCount;

      // Calculate score
      const { total, breakdown } = calculateScore(
        sections, keywordResult, achievements, actionVerbs, readability, contactInfo, wordCount
      );

      // Generate suggestions
      const suggestions = generateSuggestions(
        sections, keywordResult, achievements, actionVerbs, readability, contactInfo, wordCount, skills
      );

      // Allow loading animation to complete
      await new Promise((resolve) => setTimeout(resolve, steps.length * 300 - 100));
      clearInterval(stepInterval);

      // Render results
      renderScore(total, breakdown);
      renderSections(sections);
      renderQuickStats(readability, achievements, actionVerbs, skills, contactInfo);
      renderKeywords(keywordResult, skills, jobKeywords);
      renderSuggestions(suggestions);
      renderReadability(readability);

      // Show results
      loader.classList.add('hidden');
      resultsSection.classList.remove('hidden');
      resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Reset to first tab
      tabs[0].click();

      // Build report for download
      lastReport = buildReport(total, breakdown, sections, keywordResult, achievements, actionVerbs, readability, suggestions, skills);

    } catch (err) {
      clearInterval(stepInterval);
      loader.classList.add('hidden');
      fileStatus.textContent = `Analysis error: ${err.message}`;
      fileStatus.style.color = 'var(--danger)';
    } finally {
      analyzeBtn.disabled = false;
    }
  });

  // ================================================================
  //  SECTION 9: REPORT GENERATION & EXPORT
  // ================================================================

  function buildReport(total, breakdown, sections, keywordResult, achievements, actionVerbs, readability, suggestions, skills) {
    const lines = [];
    lines.push('=' .repeat(60));
    lines.push('  AI RESUME ANALYSIS REPORT');
    lines.push('=' .repeat(60));
    lines.push('');
    lines.push(`Overall Score: ${total} / 100`);
    lines.push('');
    lines.push('Score Breakdown:');
    lines.push(`  Structure:   ${breakdown.structure}/25`);
    lines.push(`  Keywords:    ${breakdown.keywords}/25`);
    lines.push(`  Impact:      ${breakdown.impact}/25`);
    lines.push(`  Readability: ${breakdown.readability}/25`);
    lines.push('');
    lines.push('-'.repeat(40));
    lines.push('SECTIONS DETECTED:');
    Object.entries(sections).forEach(([name, found]) => {
      lines.push(`  ${found ? '[OK]' : '[--]'} ${name}`);
    });
    lines.push('');
    lines.push('-'.repeat(40));
    lines.push('READABILITY:');
    lines.push(`  Flesch Reading Ease: ${readability.fleschEase}/100 (${readability.description})`);
    lines.push(`  Grade Level: ${readability.gradeLevel}`);
    lines.push(`  Word Count: ${readability.wordCount}`);
    lines.push(`  Avg Words/Sentence: ${readability.avgWordsPerSentence}`);
    lines.push('');

    if (skills.length > 0) {
      lines.push('-'.repeat(40));
      lines.push('SKILLS DETECTED:');
      lines.push(`  ${skills.join(', ')}`);
      lines.push('');
    }

    if (achievements.length > 0) {
      lines.push('-'.repeat(40));
      lines.push('QUANTIFIED ACHIEVEMENTS:');
      achievements.forEach((a) => lines.push(`  - ${a}`));
      lines.push('');
    }

    if (keywordResult.matched && keywordResult.matched.length > 0) {
      lines.push('-'.repeat(40));
      lines.push(`KEYWORD MATCH: ${keywordResult.score}%`);
      lines.push(`  Matched: ${keywordResult.matched.join(', ')}`);
      if (keywordResult.missing.length > 0) {
        lines.push(`  Missing: ${keywordResult.missing.join(', ')}`);
      }
      lines.push('');
    }

    lines.push('-'.repeat(40));
    lines.push('SUGGESTIONS:');
    suggestions.forEach((s, i) => {
      const tag = s.priority === 'positive' ? 'STRENGTH' : s.priority.toUpperCase();
      lines.push(`  ${i + 1}. [${tag}] ${s.text}`);
      lines.push(`     ${s.detail}`);
    });
    lines.push('');
    lines.push('=' .repeat(60));
    lines.push('Generated by AI Resume Analyzer (client-side, no data transmitted)');
    lines.push('=' .repeat(60));

    return lines.join('\n');
  }

  // Download Report
  $('#downloadBtn').addEventListener('click', () => {
    if (!lastReport) return;
    const blob = new Blob([lastReport], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'resume_analysis_report.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // Copy Suggestions
  $('#copyBtn').addEventListener('click', async () => {
    if (!lastReport) return;
    try {
      await navigator.clipboard.writeText(lastReport);
      const btn = $('#copyBtn');
      const original = btn.innerHTML;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.innerHTML = original; }, 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = lastReport;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  });

  // Reset
  $('#resetBtn').addEventListener('click', () => {
    resumeTextArea.value = '';
    jobTextArea.value = '';
    roleSelect.value = '';
    resumeFileInput.value = '';
    fileStatus.textContent = '';
    charCountEl.textContent = '0';
    resultsSection.classList.add('hidden');
    lastReport = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

})();
