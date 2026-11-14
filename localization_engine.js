const fs = require('fs');
const path = require('path');
const child_process = require('child_process');
const vm = require('vm');

if (process.platform === 'win32') {
    const defaultNodePaths = [
        'C:\\Program Files\\nodejs',
        'C:\\Program Files (x86)\\nodejs',
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node'),
        path.join(process.env.APPDATA || '', 'npm')
    ];
    for (const nodePath of defaultNodePaths) {
        if (fs.existsSync(nodePath)) {
            if (!process.env.PATH.includes(nodePath)) {
                process.env.PATH = `${nodePath};${process.env.PATH}`;
            }
        }
    }
}

const DICTS_FOLDER = 'dicts';
const BRAND_TITLE_ALIASES = {
    english: 'english',
    en: 'english',
    default: 'english',
    hidden: 'hidden',
    hide: 'hidden',
    none: 'hidden'
};

function getOptionValue(name, defaultValue) {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === name) {
            return args[i + 1] || defaultValue;
        }
        if (args[i].startsWith(name + '=')) {
            return args[i].slice(name.length + 1);
        }
    }
    return defaultValue;
}

const BRAND_TITLE_MODE = BRAND_TITLE_ALIASES[String(getOptionValue('--brand-title', 'english')).toLowerCase()] || 'english';

const SIGNATURE_START = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_START__';";
const SIGNATURE_END = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_END__';";
const MENU_SIGNATURE_START = "'__ANTIGRAVITY_NATIVE_MENU_TRANSLATION_START__';";
const MENU_SIGNATURE_END = "'__ANTIGRAVITY_NATIVE_MENU_TRANSLATION_END__';";
const TRAY_SIGNATURE_START = "'__ANTIGRAVITY_TRAY_TRANSLATION_START__';";
const TRAY_SIGNATURE_END = "'__ANTIGRAVITY_TRAY_TRANSLATION_END__';";
const IPC_CONTEXT_MENU_SIGNATURE_START = "'__ANTIGRAVITY_IPC_CONTEXT_MENU_TRANSLATION_START__';";
const IPC_CONTEXT_MENU_SIGNATURE_END = "'__ANTIGRAVITY_IPC_CONTEXT_MENU_TRANSLATION_END__';";
const MAIN_SUBFRAME_SIGNATURE_START = "'__ANTIGRAVITY_MAIN_SUBFRAME_LOCALIZATION_START__';";
const MAIN_SUBFRAME_SIGNATURE_END = "'__ANTIGRAVITY_MAIN_SUBFRAME_LOCALIZATION_END__';";
const UTILS_SUBFRAME_SIGNATURE_START = "'__ANTIGRAVITY_UTILS_SUBFRAME_LOCALIZATION_START__';";
const UTILS_SUBFRAME_SIGNATURE_END = "'__ANTIGRAVITY_UTILS_SUBFRAME_LOCALIZATION_END__';";
const IPC_OFFICE_PREVIEW_SIGNATURE_START = "'__ANTIGRAVITY_IPC_OFFICE_PREVIEW_START__';";
const IPC_OFFICE_PREVIEW_SIGNATURE_END = "'__ANTIGRAVITY_IPC_OFFICE_PREVIEW_END__';";
const IPC_MEME_SIGNATURE_START = "'__ANTIGRAVITY_IPC_MEME_START__';";
const IPC_MEME_SIGNATURE_END = "'__ANTIGRAVITY_IPC_MEME_END__';";
const LEGACY_SIGNATURE_START = ['/', '* --- ANTIGRAVITY CHINESE LOCALIZATION START --- *', '/'].join('');
const LEGACY_SIGNATURE_END = ['/', '* --- ANTIGRAVITY CHINESE LOCALIZATION END --- *', '/'].join('');
const LEGACY_MENU_SIGNATURE_START = ['/', '/ =========================================='].join('');
const LEGACY_MENU_SIGNATURE_END = 'translateMenu(menu.items);';
const LEGACY_TRAY_SIGNATURE_START = ['/', '* --- TRAY TRANSLATION START --- *', '/'].join('');
const LEGACY_TRAY_SIGNATURE_END = ['/', '* --- TRAY TRANSLATION END --- *', '/'].join('');

function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\s+/g, ' ')
               .trim()
               .replace(/’/g, "'")
               .replace(/‘/g, "'")
               .replace(/“/g, '"')
               .replace(/”/g, '"');
}

function loadDictionary() {
    const totalMap = {};
    const dictsDir = path.join(__dirname, DICTS_FOLDER);
    if (fs.existsSync(dictsDir)) {
        const files = fs.readdirSync(dictsDir).filter(file => file.endsWith('.json')).sort();
        for (const file of files) {
            try {
                const filePath = path.join(dictsDir, file);
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const data = JSON.parse(fileContent);
                for (const [k, v] of Object.entries(data)) {
                    const normK = normalizeText(k);
                    if (normK) totalMap[normK] = v;
                }
            } catch (e) {
                console.error(`[Localization] Failed to parse dictionary file ${file}:`, e.message);
            }
        }
    }
    if (BRAND_TITLE_MODE === 'hidden') {
        totalMap[normalizeText('Antigravity')] = '';
    } else {
        delete totalMap[normalizeText('Antigravity')];
    }
    return totalMap;
}

function generateJs() {
    const fullDict = loadDictionary();
    const longEntries = Object.entries(fullDict).filter(([k]) => k.length > 20).sort((a, b) => b[0].length - a[0].length);

    const dictJson = JSON.stringify(fullDict, null, 4);
    const entriesJson = JSON.stringify(longEntries);

    const jsSource = `${SIGNATURE_START}
(() => {
    const isAllowedLocalizationContext = () => {
        try {
            const loc = globalThis.location;
            if (!loc) return false;
            const protocol = typeof loc.protocol === 'string' ? loc.protocol.toLowerCase() : '';
            if (protocol === 'plugin:') return true;
            if (protocol === 'http:' || protocol === 'https:') {
                const host = typeof loc.hostname === 'string' ? loc.hostname.toLowerCase() : '';
                return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1' || host.endsWith('.localhost');
            }
            return false;
        } catch (e) {
            return false;
        }
    };
    if (!isAllowedLocalizationContext()) return;

    const map = new Map(Object.entries(DICT_PLACEHOLDER));
    const lowerMap = new Map();
    for (const [k, v] of map.entries()) lowerMap.set(k.toLowerCase(), v);

    const longEntries = REPLACEMENT_ENTRIES_PLACEHOLDER;
    const translatedValues = new WeakMap();
    const longScannedValues = new WeakMap();
    const unmatchedLongStrings = new Set();
    let blockedCacheVersion = 2;
    const blockedZoneCache = new WeakMap();
    const skillContextCache = new WeakMap();

    const BLOCKED_CLASSES = ['monaco-editor', 'editor-container', 'terminal', 'output-view', 'debug-console', 'code-view', 'artifact-container', 'suggest-widget'];
    const HARD_PRUNED_CLASS_REGEX = /(?:^|\\s)(?:view-lines|view-line|view-overlays|lines-content|margin|margin-view-overlays|minimap|decorationsOverviewRuler|cursors-layer|monaco-tokenized-source|xterm|terminal|output-view|debug-console|material-symbols(?:-[a-z]+)?|material-icons(?:-[a-z]+)?|codicon(?:-[a-z]+)?|google-symbols)(?:\\s|$)/;
    const BLOCKED_TAGS = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'INPUT', 'TEXTAREA', 'SVG', 'CANVAS', 'SYMBOL', 'PATH'];
    const BLOCKED_TAGS_SET = new Set(BLOCKED_TAGS);
    const AUTO_TRANSLATE_PROTECTED_TAGS = new Set(['CODE', 'PRE', 'INPUT', 'TEXTAREA']);
    const BLOCKED_TEST_IDS = new Set(['user-input-step']);
    const SKIP_TRANSLATION_ATTR = 'data-ag-localization-skip';

    function norm(s) {
        if (!s) return '';
        return s.replace(/\\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim();
    }

    // Long dictionary entries may be replaced inside surrounding UI text, but
    // they must not match inside a larger English identifier or word.
    function replaceLongDictionaryEntry(value, key, translated) {
        if (!value || !key || !value.includes(key)) return value;

        const asciiWord = /[A-Za-z0-9_]/;
        const needsLeftBoundary = asciiWord.test(key[0]);
        const needsRightBoundary = asciiWord.test(key[key.length - 1]);
        let searchFrom = 0;
        let result = '';
        let changed = false;

        while (searchFrom < value.length) {
            const index = value.indexOf(key, searchFrom);
            if (index === -1) break;

            const end = index + key.length;
            const hasLeftBoundary = !needsLeftBoundary || index === 0 || !asciiWord.test(value[index - 1]);
            const hasRightBoundary = !needsRightBoundary || end === value.length || !asciiWord.test(value[end]);
            if (hasLeftBoundary && hasRightBoundary) {
                result += value.slice(searchFrom, index) + translated;
                searchFrom = end;
                changed = true;
            } else {
                result += value.slice(searchFrom, index + 1);
                searchFrom = index + 1;
            }
        }

        return changed ? result + value.slice(searchFrom) : value;
    }

    function translateWithShortcut(val) {
        if (!val) return null;
        let match = val.match(/^(.+?)\\s*\\((Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+?([^)]*)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " (" + match[2] + (match[3] ? "+" + match[3] : "") + ")";
            }
        }
        match = val.match(/^(.+?)\\s+((?:(?:Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+)+[A-Za-z0-9;,.\\/-]+)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " " + match[2];
            }
        }
        return null;
    }

    // Git refs are runtime identifiers, so translate only the bounded UI
    // sentence around them and preserve the ref or remote name verbatim.
    function getCommitSummaryParts(value) {
        const normalized = norm(value);
        const match = normalized.match(/^(?:Commit|提交)\\s*(\\d+)\\s*(?:files?|个文件)\\s*(?:changes?|更改)\\s*to\\s*((?:↗\\s*)?\\S+)$/i);
        return match ? { count: match[1], target: match[2] } : null;
    }

    function getVersionControlUiTranslation(value) {
        const normalized = norm(value);
        if (/^All changes since the branch point$/i.test(normalized)) {
            return "自分支点以来的所有更改";
        }

        let match = normalized.match(/^All changes since (\\S+)$/i);
        if (match) return "自 " + match[1] + " 以来的所有更改";

        match = normalized.match(/^Publish (\\S+) to origin$/i);
        if (match) return "将 " + match[1] + " 发布到 origin";

        match = normalized.match(/^Push\\s+(\\d+)\\s+commits?\\s+to\\s+((?:↗\\s*)?\\S+)$/i);
        if (match) return "将 " + match[1] + " 个提交推送到 " + match[2];

        match = normalized.match(/^Pushed\\s+(\\d+)\\s+commits?\\s+to\\s+((?:↗\\s*)?\\S+)[.。]?$/i);
        if (match) return "已将 " + match[1] + " 个提交推送到 " + match[2];

        match = normalized.match(/^Committed\\s+to\\s+((?:↗\\s*)?\\S+)[.。]?$/i);
        if (match) return "已提交到 " + match[1];

        match = normalized.match(/^Amended\\s+commit\\s+on\\s+((?:↗\\s*)?[^\\s.。]+)[.。]?$/i);
        if (match) return "已在 " + match[1] + " 上修补提交";

        const commitSummary = getCommitSummaryParts(normalized);
        if (commitSummary) {
            return "将 " + commitSummary.count + " 个文件的更改提交到 " + commitSummary.target;
        }

        const fileStatusMatch = normalized.match(/^(.+?)\\s*\\((uncommitted|unstaged|staged|untracked|modified|deleted|added|all agent edits|agent edits)\\)$/i);
        if (fileStatusMatch) {
            const rawPrefix = fileStatusMatch[1].trim();
            if (/^(?:git|npm|pnpm|yarn|bun|node|cargo|go|python|bash|sh|zsh)\\s/i.test(rawPrefix)) return null;
            if (/["'<>|?*]/.test(rawPrefix)) return null;
            if (/\\s-[a-zA-Z]/.test(rawPrefix)) return null;
            const isCategory = /^(?:All files|Added|Deleted|Modified|Untracked)$/i.test(rawPrefix);
            const hasExtension = /\\.[a-zA-Z0-9_-]{1,12}$/i.test(rawPrefix);
            const hasPathSep = /[\\/\\\\]/.test(rawPrefix);
            if (isCategory || hasExtension || hasPathSep) {
                const tag = fileStatusMatch[2].toLowerCase();
                const tagMap = {
                    'uncommitted': '(未提交)',
                    'unstaged': '(未暂存)',
                    'staged': '(已暂存)',
                    'untracked': '(未跟踪)',
                    'modified': '(已修改)',
                    'deleted': '(已删除)',
                    'added': '(已添加)',
                    'all agent edits': '(智能体的所有修改)',
                    'agent edits': '(智能体修改)'
                };
                if (tagMap[tag]) {
                    const translatedPrefix = map.get(rawPrefix)
                        || lowerMap.get(rawPrefix.toLowerCase())
                        || rawPrefix;
                    return translatedPrefix + " " + tagMap[tag];
                }
            }
        }
        return null;
    }

    function getRelativeTimeTranslation(value, node = null) {
        const normalized = norm(value);
        if (/^just\\s+now$/i.test(normalized)) {
            if (node && isContentBodyContainer(node) && !isMessageActionTimestamp(node)) return null;
            return "刚刚";
        }

        const triggeredMatch = normalized.match(/^(?:Triggered|已触发)\\s+(.+)$/i);
        if (triggeredMatch) {
            const inner = triggeredMatch[1].trim();
            if (/^(?:刚刚|\\d+\\s*(?:秒|分钟|小时|天|周|个月|年)前)$/.test(inner)) {
                return "已触发 " + inner;
            }
            const rel = getRelativeTimeTranslation(inner, node);
            if (rel) return "已触发 " + rel;
            if (/^\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2}(?::\\d{2})?)?$/.test(inner) || /^\\d{1,2}:\\d{2}(?::\\d{2})?$/.test(inner)) {
                return "已触发 " + inner;
            }
            return null;
        }

        let match = normalized.match(/^(\\d+)\\s*(s|m|h|d|w|mo|yr|y)$/);
        if (match) {
            if (node && isContentBodyContainer(node) && !isMessageActionTimestamp(node)) {
                return null;
            }
            if (node && isUptimeDurationContext(node)) {
                const durationUnits = {
                    s: "秒",
                    m: "分钟",
                    h: "小时",
                    d: "天",
                    w: "周",
                    mo: "个月",
                    yr: "年",
                    y: "年"
                };
                return match[1] + " " + durationUnits[match[2]];
            }
            const compactUnits = {
                s: "秒前",
                m: "分钟前",
                h: "小时前",
                d: "天前",
                w: "周前",
                mo: "个月前",
                yr: "年前",
                y: "年前"
            };
            return match[1] + compactUnits[match[2]];
        }

        match = normalized.match(/^(\\d+)\\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|mos|month|months|y|yr|yrs|year|years)\\s+ago$/i);
        if (!match) return null;
        if (node && isContentBodyContainer(node) && !isMessageActionTimestamp(node)) {
            return null;
        }

        const unit = match[2].toLowerCase();
        let translatedUnit = "";
        if (/^(?:s|sec)/.test(unit)) translatedUnit = "秒前";
        else if (/^(?:m$|min)/.test(unit)) translatedUnit = "分钟前";
        else if (/^(?:h|hr|hour)/.test(unit)) translatedUnit = "小时前";
        else if (/^(?:d|day)/.test(unit)) translatedUnit = "天前";
        else if (/^(?:w|wk|week)/.test(unit)) translatedUnit = "周前";
        else if (/^mo/.test(unit)) translatedUnit = "个月前";
        else if (/^(?:y|yr|year)/.test(unit)) translatedUnit = "年前";
        return translatedUnit ? match[1] + translatedUnit : null;
    }

    function getArtifactTimestampTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(.*?)\\s*\\((Today|Yesterday)\\s+(\\d{1,2}):(\\d{2})\\s+(AM|PM)\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const day = match[2].toLowerCase() === 'today' ? "今天" : "昨天";
            const period = match[5].toUpperCase() === 'AM' ? "上午" : "下午";
            const timestamp = "（" + day + " " + period + match[3] + ":" + match[4] + "）";
            return prefix ? prefix + " " + timestamp : timestamp;
        }

        match = normalized.match(/^(.*?)\\s*\\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s+(\\d{1,2}):(\\d{2})\\s+(AM|PM)\\)$/i);
        if (!match) return null;

        const monthMap = {
            jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
            jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
        };
        const prefix = match[1].trim();
        const month = monthMap[match[2].toLowerCase()];
        const year = match[4] ? match[4] + "年" : "";
        const period = match[7].toUpperCase() === 'AM' ? "上午" : "下午";
        const timestamp = "（" + year + month + "月" + match[3] + "日 " + period + match[5] + ":" + match[6] + "）";
        return prefix ? prefix + " " + timestamp : timestamp;
    }

    function getAutomationScheduleTranslation(value, node = null) {
        const normalized = norm(value);
        if (/^Next\\s+run$/i.test(normalized)) return "下次运行";
        if (/^Last\\s+run$/i.test(normalized)) return "上次运行";

        const weekdayMap = {
            monday: "星期一", mon: "星期一", mondays: "星期一",
            tuesday: "星期二", tue: "星期二", tues: "星期二", tuesdays: "星期二",
            wednesday: "星期三", wed: "星期三", wednesdays: "星期三",
            thursday: "星期四", thu: "星期四", thur: "星期四", thurs: "星期四", thursdays: "星期四",
            friday: "星期五", fri: "星期五", fridays: "星期五",
            saturday: "星期六", sat: "星期六", saturdays: "星期六",
            sunday: "星期日", sun: "星期日", sundays: "星期日"
        };
        const monthMap = {
            january: 1, jan: 1,
            february: 2, feb: 2,
            march: 3, mar: 3,
            april: 4, apr: 4,
            may: 5,
            june: 6, jun: 6,
            july: 7, jul: 7,
            august: 8, aug: 8,
            september: 9, sep: 9, sept: 9,
            october: 10, oct: 10,
            november: 11, nov: 11,
            december: 12, dec: 12
        };
        const monthNamePattern = "January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|Sept|October|Oct|November|Nov|December|Dec";

        let match = normalized.match(/^(Today|Tomorrow|Yesterday)\\s+(\\d{1,2}:\\d{2}\\s*(?:AM|PM)(?:\\s+(?:GMT|UTC)[+-]?\\d{0,2}(?::\\d{2})?)?)$/i);
        if (match) {
            const dayWord = { today: "今天", tomorrow: "明天", yesterday: "昨天" }[match[1].toLowerCase()];
            return dayWord + " " + match[2];
        }
        match = normalized.match(/^(Monday|Mon|Tuesday|Tue|Tues|Wednesday|Wed|Thursday|Thu|Thur|Thurs|Friday|Fri|Saturday|Sat|Sunday|Sun)\\.?,?\\s+(\\d{1,2}:\\d{2}\\s*(?:AM|PM)(?:\\s+(?:GMT|UTC)[+-]?\\d{0,2}(?::\\d{2})?)?)$/i);
        if (match) {
            return weekdayMap[match[1].toLowerCase()] + " " + match[2];
        }
        match = normalized.match(new RegExp("^(" + monthNamePattern + ")\\\\.?\\\\s+(\\\\d{1,2})(?:st|nd|rd|th)?,?\\\\s+(\\\\d{1,2}:\\\\d{2}\\\\s*(?:AM|PM))$", "i"));
        if (match) {
            return monthMap[match[1].toLowerCase()] + "月" + match[2] + "日 " + match[3];
        }
        if (!node || !isContentBodyContainer(node)) {
            match = normalized.match(new RegExp("^(" + monthNamePattern + ")\\\\.?\\\\s+(\\\\d{1,2})(?:st|nd|rd|th)?$", "i"));
            if (match) {
                return monthMap[match[1].toLowerCase()] + "月" + match[2] + "日";
            }
        }

        match = normalized.match(/^Next\\s+run\\s+today\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "下次运行：今天约 " + match[1];
        match = normalized.match(/^Next\\s+run\\s+tomorrow\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "下次运行：明天约 " + match[1];
        match = normalized.match(/^(?:Next\\s+run|下次运行[：:])\\s*(?:on\\s+)?(Monday|Mon|Tuesday|Tue|Tues|Wednesday|Wed|Thursday|Thu|Thur|Thurs|Friday|Fri|Saturday|Sat|Sunday|Sun)\\.?\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "下次运行：" + weekdayMap[match[1].toLowerCase()] + "约 " + match[2];
        match = normalized.match(new RegExp("^(?:Next\\\\s+run|下次运行[：:])\\\\s*(?:on\\\\s+)?(" + monthNamePattern + ")\\\\.?\\\\s+(\\\\d{1,2})(?:st|nd|rd|th)?(?:,\\\\s*\\\\d{4})?\\\\s+(?:around|at|在)\\\\s+(.+)$", "i"));
        if (match) {
            return "下次运行：" + monthMap[match[1].toLowerCase()] + "月" + match[2] + "日约 " + match[3];
        }
        match = normalized.match(/^Next\\s+run\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "下次运行：约 " + match[1];
        match = normalized.match(/^Next\\s+run\\s+(.+)$/i);
        if (match) return "下次运行：" + match[1];

        match = normalized.match(/^Last\\s+run\\s+(?:today\\s+around|today\\s+at)\\s+(.+)$/i);
        if (match) return "上次运行：今天约 " + match[1];
        match = normalized.match(/^(?:Last\\s+run|上次运行[：:])\\s*(?:on\\s+)?(Monday|Mon|Tuesday|Tue|Tues|Wednesday|Wed|Thursday|Thu|Thur|Thurs|Friday|Fri|Saturday|Sat|Sunday|Sun)\\.?\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "上次运行：" + weekdayMap[match[1].toLowerCase()] + "约 " + match[2];
        match = normalized.match(new RegExp("^(?:Last\\\\s+run|上次运行[：:])\\\\s*(?:on\\\\s+)?(" + monthNamePattern + ")\\\\.?\\\\s+(\\\\d{1,2})(?:st|nd|rd|th)?(?:,\\\\s*\\\\d{4})?\\\\s+(?:around|at|在)\\\\s+(.+)$", "i"));
        if (match) {
            return "上次运行：" + monthMap[match[1].toLowerCase()] + "月" + match[2] + "日约 " + match[3];
        }
        match = normalized.match(/^Last\\s+run\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "上次运行：约 " + match[1];
        match = normalized.match(/^Last\\s+run\\s+(.+)$/i);
        if (match) return "上次运行：" + match[1];

        match = normalized.match(/^Every\\s+(\\d+)\\s+(minutes?|mins?|hours?|hrs?|days?|weeks?|months?)(?:\\s+(?:around|at|在)\\s+(.+))?$/i);
        if (match) {
            const unitLower = match[2].toLowerCase();
            let unitZh = "";
            if (unitLower.startsWith("min")) unitZh = "分钟";
            else if (unitLower.startsWith("hour") || unitLower.startsWith("hr")) unitZh = "小时";
            else if (unitLower.startsWith("day")) unitZh = "天";
            else if (unitLower.startsWith("week")) unitZh = "周";
            else if (unitLower.startsWith("month")) unitZh = "个月";
            return "每 " + match[1] + " " + unitZh + (match[3] ? "在 " + match[3] : "");
        }
        match = normalized.match(/^Every\\s+(minute|hour|day|week|month)$/i);
        if (match) {
            const singleUnitMap = { minute: "每分钟", hour: "每小时", day: "每天", week: "每周", month: "每月" };
            return singleUnitMap[match[1].toLowerCase()];
        }

        match = normalized.match(/^(?:Monthly|每月)\\s+on\\s+the\\s+([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            return "每月 " + match[1] + " 日在 " + match[2];
        }
        match = normalized.match(/^(?:Monthly|每月)\\s+on\\s+the\\s+last\\s+day\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            return "每月最后一天在 " + match[1];
        }
        match = normalized.match(/^(?:Monthly|每月)\\s+on\\s+the\\s+([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)$/i);
        if (match) {
            return "每月 " + match[1] + " 日";
        }
        match = normalized.match(/^(?:Monthly|每月)\\s+on\\s+the\\s+last\\s+day$/i);
        if (match) {
            return "每月最后一天";
        }

        match = normalized.match(/^((?:(?:Mondays?|Mon|Tuesdays?|Tue|Tues|Wednesdays?|Wed|Thursdays?|Thu|Thur|Thurs|Fridays?|Fri|Saturdays?|Sat|Sundays?|Sun)\\.?(?:\\s*,\\s*|\\s+and\\s+|\\s*&\\s*))+(?:Mondays?|Mon|Tuesdays?|Tue|Tues|Wednesdays?|Wed|Thursdays?|Thu|Thur|Thurs|Fridays?|Fri|Saturdays?|Sat|Sundays?|Sun)\\.?)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            const days = match[1].split(/\\s*(?:,|\\band\\b|&)\\s*/i).map(d => weekdayMap[d.replace(/\\.$/, '').toLowerCase()] || d).join("、");
            return "每周" + days + "在 " + match[2];
        }
        match = normalized.match(/^(Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            return "每周" + weekdayMap[match[1].toLowerCase()] + "在 " + match[2];
        }
        match = normalized.match(/^Every\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            return "每周" + weekdayMap[match[1].toLowerCase()] + "在 " + match[2];
        }
        match = normalized.match(/^(?:Every\\s+day|Everyday)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "每天在 " + match[1];
        match = normalized.match(/^Weekdays\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "每个工作日在 " + match[1];
        match = normalized.match(/^Weekends\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) return "每周末在 " + match[1];

        match = normalized.match(/^(Daily|Weekly|Monthly|每[天周月])\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            const freqMap = {
                daily: "每天",
                weekly: "每周",
                monthly: "每月",
                "每天": "每天",
                "每周": "每周",
                "每月": "每月"
            };
            const freq = freqMap[match[1].toLowerCase()] || match[1];
            return freq + "在 " + match[2];
        }
        match = normalized.match(/^Weekly\\s+on\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s+(?:around|at|在)\\s+(.+)$/i);
        if (match) {
            const dayMap = {
                monday: "星期一", tuesday: "星期二", wednesday: "星期三",
                thursday: "星期四", friday: "星期五", saturday: "星期六", sunday: "星期日"
            };
            return "每周" + (dayMap[match[1].toLowerCase()] || match[1]) + "在 " + match[2];
        }
        match = normalized.match(/^(Daily|Weekly|Monthly)\\s+(?:around|at)$/i);
        if (match) {
            const freqMap = {
                daily: "每天",
                weekly: "每周",
                monthly: "每月"
            };
            return freqMap[match[1].toLowerCase()] + "在";
        }
        match = normalized.match(/^Weekly\\s+on\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s+(?:around|at)$/i);
        if (match) {
            const dayMap = {
                monday: "星期一", tuesday: "星期二", wednesday: "星期三",
                thursday: "星期四", friday: "星期五", saturday: "星期六", sunday: "星期日"
            };
            return "每周" + (dayMap[match[1].toLowerCase()] || match[1]) + "在";
        }
        return null;
    }

    function getCompactCountLabelTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(\\d+)\\s*(?:results?|个结果s?)$/i);
        if (match) return match[1] + " 个结果";

        match = normalized.match(/^(?:Comments?|评论)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "评论（" + match[1] + "）";

        match = normalized.match(/^(\\d+)\\s*(?:Comments?|条评论)$/i);
        if (match) return match[1] + " 条评论";

        match = normalized.match(/^(\\d+)\\s*(?:tools?|个工具)$/i);
        if (match) return match[1] + " 个工具";

        match = normalized.match(/^(\\d+)\\s+on for this conversation$/i);
        if (match) return match[1] + " 个已为此会话开启";

        match = normalized.match(/^(?:Side Questions?|侧边提问)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "侧边提问（" + match[1] + "）";

        match = normalized.match(/^(\\d+)\\s+(?:Side\\s+Questions?|个?侧边提问)(?:\\s*([>v›❯〉→∨˅⌄▼▽⋁↓]))?$/i);
        if (match) return match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^View\\s+(\\d+)\\s+side\\s+questions?$/i);
        if (match) return "查看 " + match[1] + " 个侧边提问";

        match = normalized.match(/^[（(]\\s*(\\d+)\\s*(?:subagents?|个?\\s*子智能体s?)\\s*[)）]$/i);
        if (match) return "（" + match[1] + " 个子智能体）";

        match = normalized.match(/^(?:See all|显示全部|查看全部)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示全部 (" + match[1] + ")";

        match = normalized.match(/^(?:Send all|全部发送|发送全部)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "全部发送 (" + match[1] + ")";

        match = normalized.match(/^See\\s+(\\d+)\\s+more\\s+plugins$/i);
        if (match) return "查看另外 " + match[1] + " 个插件";

        match = normalized.match(/^See\\s+(\\d+)\\s+more$/i);
        if (match) return "查看另外 " + match[1] + " 项";

        match = normalized.match(/^(\\d+)\\s+accounts$/i);
        if (match) return match[1] + " 个账号";

        match = normalized.match(/^(?:Show\\s+submitted|显示已提交)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示已提交 (" + match[1] + ")";

        match = normalized.match(/^(?:Show\\s+more|显示更多)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
        if (match) return "显示更多 (" + match[1] + ")";

        match = normalized.match(/^(\\+)?\\s*(\\d+)\\s+more\\s+lines?$/i);
        if (match) return (match[1] ? match[1] : "") + match[2] + " 行代码";
        return null;
    }

    function getLiveStatusTranslation(value) {
        if (!value) return null;
        const normalized = norm(value).replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
        if (/^Working(?:\\s*\\.){1,3}$/i.test(normalized) || /^Working\\s*…$/i.test(normalized) || /^(?:处理中|工作中)(?:(?:\\s*\\.)|(?:\\s*…))+$/i.test(normalized)) {
            return "工作中...";
        }
        if (/^Working$/i.test(normalized)) {
            return "工作中";
        }
        if (/^Compacting(?:\\s*\\.){1,3}$/i.test(normalized) || /^Compacting\\s*…$/i.test(normalized) || /^(?:压缩中|正在压缩)(?:(?:\\s*\\.)|(?:\\s*…))+$/i.test(normalized)) {
            return "正在压缩...";
        }
        if (/^Compacting$/i.test(normalized)) {
            return "正在压缩";
        }
        return null;
    }

    function getWorkingStatusTranslation(value) {
        return getLiveStatusTranslation(value);
    }

    function getExecutionTimingTranslation(value) {
        if (!value) return null;
        const valNorm = norm(value);
        const durationMatch = valNorm.match(/^(Worked for|Stopped after)\\s+([\\d\\w\\s,.]+?)(?:\\s*[>›])?\\s*$/i);
        if (!durationMatch) return null;

        const action = durationMatch[1].toLowerCase();
        let actionStr = "工作了 ";
        if (action === "stopped after") actionStr = "在 ";

        let durationStr = durationMatch[2]
            .replace(/(\\d+)\\s*d(?:ays?)?/gi, (m, n) => n + " 天 ")
            .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
            .replace(/([\\d\\.]+)\\s*ms/gi, (m, n) => n + " 毫秒 ")
            .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
            .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒 ")
            .replace(/,/g, "")
            .replace(/\\s+/g, " ")
            .trim();

        if (action === "stopped after") {
            return "在 " + durationStr + " 后停止";
        } else {
            return actionStr + durationStr;
        }
    }

    function getSearchingStatusTranslation(value) {
        if (!value) return null;
        const normalized = norm(value).replace(/[\\u200B-\\u200D\\uFEFF]/g, '');
        if (/^Searching(?:\\s*\\.){1,3}$/i.test(normalized) || /^Searching\\s*…$/i.test(normalized) || /^Searching\\s*\\.{3,}$/i.test(normalized) || /^Searching$/i.test(normalized)) {
            return "正在搜索...";
        }
        if (/^No\\s+suggestions(?:\\.|\\b)/i.test(normalized)) {
            return "无建议";
        }
        return null;
    }

    function getQuotaDurationTranslation(value) {
        const normalized = norm(value);
        if (/^less than a minute$/i.test(normalized)) return "不到 1 分钟";

        const parts = normalized.split(/\\s*,\\s*/);
        if (parts.length < 1 || parts.length > 2) return null;
        const translated = [];
        for (const part of parts) {
            const match = part.match(/^(\\d+)\\s+(days?|hours?|minutes?)$/i);
            if (!match) return null;
            const unit = /^day/i.test(match[2]) ? "天" : /^hour/i.test(match[2]) ? "小时" : "分钟";
            translated.push(match[1] + " " + unit);
        }
        return translated.join(" ");
    }

    function getQuotaNoticeTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^You have hit your weekly limit, it refreshes in (.+?)\\. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier\\.?$/i);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，将在 " + duration + "后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐";
            }
        }

        match = normalized.match(/^You have hit your weekly limit, the 5-hour limit does not currently apply\\. Your weekly limit will fully refresh in (.+?)\\.?$/i);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 " + duration + "后完全刷新";
            }
        }

        match = normalized.match(/^您已达到每周配额限制，将在 (.+?)后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐。?$/);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，将在 " + duration + "后刷新。如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度，或升级到更高等级的套餐";
            }
        }

        match = normalized.match(/^您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 (.+?)后完全刷新。?$/);
        if (match) {
            const duration = getQuotaDurationTranslation(match[1]);
            if (duration) {
                return "您已达到每周配额限制，因此当前不适用 5 小时配额限制。您的每周配额将在 " + duration + "后完全刷新";
            }
        }
        return null;
    }

    function getBoundedTextContent(element, maxNodes = 32, maxLen = 1600) {
        if (!element) return null;
        let out = '';
        let count = 0;
        const visit = (n) => {
            if (++count > maxNodes) return false;
            if (n.nodeType === Node.TEXT_NODE) {
                out += n.nodeValue || '';
                return out.length <= maxLen;
            }
            const ch = n.childNodes;
            if (ch) {
                for (let i = 0; i < ch.length; i++) {
                    if (!visit(ch[i])) return false;
                }
            }
            return true;
        };
        return visit(element) ? out : null;
    }

    const SKILL_PATH_REGEX = /(?:^|[\\\\s])(?:\\\\.{2,3})?[^\\\\s]+[\\\\/\\\\]skills[\\\\/\\\\][^\\\\s]+/i;

    function hasElementSkillPath(el) {
        let entry = skillContextCache.get(el);
        const childCount = el.childNodes ? el.childNodes.length : 0;
        const firstVal = el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE ? el.firstChild.nodeValue : '';
        if (entry && entry.childCount === childCount && entry.firstVal === firstVal) {
            return entry.result;
        }
        const text = getBoundedTextContent(el, 16, 400);
        const result = text === null
            ? null
            : ((text.includes('skills') || text.includes('Skills')) && SKILL_PATH_REGEX.test(text));
        skillContextCache.set(el, { childCount, firstVal, result });
        return result;
    }

    function isInSkillItemContext(node) {
        if (!node || node.nodeType !== Node.TEXT_NODE) return false;
        const val = norm(node.nodeValue);
        if (!val || val.length > 40 || /[,.?!:，。？！：]/.test(val)) return false;
        let current = node.parentElement;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.children && current.children.length > 6) break;
            const res = hasElementSkillPath(current);
            if (res === null) break;
            if (res === true) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function markThoughtContentSibling(node) {
        if (!node) return;
        try {
            let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            for (let depth = 0; depth < 3 && curr; depth++) {
                if (curr === document.body || curr === document.documentElement) break;
                const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
                if (tag === 'DETAILS') {
                    for (const child of curr.children) {
                        if (child.tagName !== 'SUMMARY') {
                            child.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
                        }
                    }
                    blockedCacheVersion++;
                    return;
                }
                if (depth === 0 || tag === 'SPAN' || tag === 'BUTTON' || tag === 'SUMMARY') {
                    curr.setAttribute('data-ag-thought-header', 'true');
                    blockedCacheVersion++;
                }
                const next = curr.nextElementSibling;
                const prev = curr.previousElementSibling;
                if ((next && next.tagName && next.tagName.toUpperCase() === 'SVG') ||
                    (prev && prev.tagName && prev.tagName.toUpperCase() === 'SVG')) {
                    if (curr.parentElement && curr.parentElement !== document.body) {
                        curr.parentElement.setAttribute('data-ag-thought-header', 'true');
                        blockedCacheVersion++;
                    }
                }
                const parent = curr.parentElement;
                if (next && parent && parent.children.length === 2 && curr === parent.firstElementChild) {
                    const nextTag = next.tagName ? next.tagName.toUpperCase() : '';
                    if (nextTag === 'DIV' || nextTag === 'SECTION') {
                        curr.setAttribute('data-ag-thought-header', 'true');
                        next.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
                        blockedCacheVersion++;
                        return;
                    }
                }
                curr = parent;
            }
        } catch (e) {}
    }

    function isIsolatedUiControlLabel(node, word, originalVal) {
        if (!node) return false;
        if (!/^[a-zA-Z]+$/.test(word)) return true;
        if (typeof originalVal === 'string' && originalVal.trim() !== word) return false;

        let curr = node.parentElement;
        if (word === 'Previous' || word === 'Next') {
            for (let depth = 0; curr && depth < 4; depth++) {
                const testId = curr.getAttribute ? curr.getAttribute('data-testid') : null;
                if (testId === 'user-input-step' || testId === 'agent-message' || testId === 'agent-response') return false;
                const cls = curr.className;
                if (typeof cls === 'string' && /(?:prose|markdown)/i.test(cls)) return false;
                const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
                if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'ARTICLE') return false;
                curr = curr.parentElement;
            }
            return true;
        }

        for (let depth = 0; curr && depth < 4; depth++) {
            const testId = curr.getAttribute ? curr.getAttribute('data-testid') : null;
            if (testId === 'user-input-step' || testId === 'agent-message' || testId === 'agent-response') {
                return false;
            }
            const cls = curr.className;
            if (typeof cls === 'string' && cls.length > 0) {
                if (/(?:prose|markdown)/i.test(cls)) {
                    return false;
                }
                if (/(?:badge|pill|tag|chip|status|rounded|border|cursor-pointer)/i.test(cls)) {
                    return true;
                }
            }
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'ARTICLE') {
                return false;
            }
            if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'OPTION' || tag === 'LABEL' || tag === 'TH') {
                return true;
            }
            const role = curr.getAttribute ? curr.getAttribute('role') : null;
            if (role === 'button' || role === 'tab' || role === 'menuitem' || role === 'switch' || role === 'option' || (role === 'menu' && (word === 'Comment' || word === 'Quote'))) {
                return true;
            }
            if (depth === 0 && curr.childNodes && curr.childNodes.length > 3) {
                return false;
            }
            curr = curr.parentElement;
        }
        return true;
    }

    function isContentBodyContainer(node) {
        if (!node) return false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 6; depth++) {
            if (curr === document.body || curr === document.documentElement) break;
            const cls = curr.className;
            if (typeof cls === 'string' && /(?:prose|markdown)/i.test(cls)) {
                return true;
            }
            const testId = curr.getAttribute ? curr.getAttribute('data-testid') : null;
            if (testId === 'user-input-step' || testId === 'agent-message' || testId === 'agent-response') {
                return true;
            }
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'ARTICLE') {
                return true;
            }
            curr = curr.parentElement;
        }
        return false;
    }

    function isProseOrAgentMessage(node) {
        if (!node) return false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 6; depth++) {
            if (curr === document.body || curr === document.documentElement) break;
            const cls = curr.className;
            if (typeof cls === 'string' && /(?:prose|markdown)/i.test(cls)) {
                return true;
            }
            const testId = curr.getAttribute ? curr.getAttribute('data-testid') : null;
            if (testId === 'user-input-step' || testId === 'agent-message' || testId === 'agent-response') {
                return true;
            }
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            if (tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'ARTICLE') {
                return true;
            }
            curr = curr.parentElement;
        }
        return false;
    }

    function isUptimeDurationContext(node) {
        if (!node) return false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 3; depth++) {
            if (curr === document.body || curr === document.documentElement) break;
            const prev = curr.previousElementSibling;
            if (prev) {
                const prevText = getBoundedTextContent(prev, 8, 80);
                if (prevText && /(?:运行时长|Uptime|时长|Duration)/i.test(prevText)) return true;
            }
            const parent = curr.parentElement;
            if (parent) {
                const text = getBoundedTextContent(parent, 12, 120);
                if (text && /(?:运行时长|Uptime)/i.test(text) && text.length < 80) return true;
            }
            curr = curr.parentElement;
        }
        return false;
    }

    // 0 = unblocked, 1 = soft-blocked (user-input-step / contenteditable / monaco-editor outer),
    // 2 = hard-blocked (SKIP_TRANSLATION_ATTR / BLOCKED_TAGS / view-lines / terminal: zero subtree work)
    function getElementBlockedState(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return 0;
        const cached = blockedZoneCache.get(el);
        if (cached !== undefined) {
            if (cached === -1) return 2;
            if (cached === blockedCacheVersion) return 0;
            if (cached === -blockedCacheVersion) return 1;
        }

        if (el.hasAttribute(SKIP_TRANSLATION_ATTR)) {
            blockedZoneCache.set(el, -1);
            return 2;
        }
        const role = el.getAttribute('role');
        if (role === 'tree' || role === 'treeitem') {
            blockedZoneCache.set(el, -1);
            return 2;
        }
        const prev = el.previousElementSibling;
        if (prev && prev.hasAttribute('data-ag-thought-header') && el.parentElement && el.parentElement.children.length === 2) {
            el.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
            blockedZoneCache.set(el, -1);
            return 2;
        }

        const tag = el.tagName ? el.tagName.toUpperCase() : '';
        if (tag && BLOCKED_TAGS_SET.has(tag)) {
            blockedZoneCache.set(el, -1);
            return 2;
        }
        if (tag === 'NAV' && el.getAttribute('aria-label') === 'File path breadcrumbs') {
            blockedZoneCache.set(el, -1);
            return 2;
        }

        const testId = el.getAttribute('data-testid');
        const prevTestId = prev ? prev.getAttribute?.('data-testid') : null;
        if (testId === 'file-title-name' || prevTestId === 'file-title-name' || prevTestId === 'file-tree-node-icon') {
            blockedZoneCache.set(el, -1);
            return 2;
        }

        const tabId = el.getAttribute('data-tab-id');
        if (tabId && /^(?:file|directory|artifact|bgtask)__.+/i.test(tabId)) {
            blockedZoneCache.set(el, -1);
            return 2;
        }

        const className = el.className || '';
        if (typeof className === 'string' && className.length > 0) {
            if (HARD_PRUNED_CLASS_REGEX.test(className)) {
                blockedZoneCache.set(el, -1);
                return 2;
            }
            if (className === 'whitespace-nowrap truncate' && prev && prev.className === 'shrink-0 h-4 w-4 flex items-center justify-center') {
                blockedZoneCache.set(el, -1);
                return 2;
            }
        }

        let ownSoftBlocked = false;

        if (isSwarmBoardDocument()) {
            const elId = el.id || '';
            if (elId === 'swarm-title' || testId === 'swarm-title') {
                const stText = norm(getBoundedTextContent(el, 4, 40) || '');
                return (stText === 'Untitled swarm' || stText === '未命名蜂群') ? 0 : 2;
            }
            if (elId === 'raw' || elId === 'ov-frame') {
                blockedZoneCache.set(el, -1);
                return 2;
            }
            if (el.classList) {
                const cl = el.classList;
                if (cl.contains('o2-tw')) {
                    blockedZoneCache.set(el, blockedCacheVersion);
                    return 0;
                }
                if (cl.contains('o2-runsum')) {
                    const sumText = norm(getBoundedTextContent(el, 4, 60) || '');
                    if (sumText === 'Waiting for the first post.' || sumText === '正在等待首条消息.') return 0;
                    blockedZoneCache.set(el, -1);
                    return 2;
                }
                if (cl.contains('o2-tt')) {
                    ownSoftBlocked = true;
                }
                if (cl.contains('msg-body') || cl.contains('msg-author') || cl.contains('msg-to') ||
                    cl.contains('ov-who') || cl.contains('ov-iframe') ||
                    cl.contains('o2-runt') || cl.contains('o2-runnote') ||
                    cl.contains('o2-donem') || cl.contains('o2-thg') ||
                    cl.contains('o2-mauth') || cl.contains('o2-mrole') || cl.contains('o2-wchip') ||
                    cl.contains('o2-rcap') || cl.contains('o2-tvcap') || cl.contains('o2-rwhen') ||
                    cl.contains('o2-tvwhen')) {
                    blockedZoneCache.set(el, -1);
                    return 2;
                }
                if (cl.contains('path') && el.parentElement && el.parentElement.id === 'raw-meta') {
                    blockedZoneCache.set(el, -1);
                    return 2;
                }
            }
            const directParent = el.parentElement;
            if (directParent && directParent.classList) {
                const pcl = directParent.classList;
                if ((tag === 'B' || tag === 'P') && (pcl.contains('o2-goal') || pcl.contains('o2-cb'))) {
                    if (tag === 'B' && pcl.contains('o2-goal')) {
                        const gText = norm(getBoundedTextContent(el, 4, 60) || '');
                        if (gText === 'Waiting for the first post.' || gText === '正在等待首条消息.') return 0;
                    }
                    blockedZoneCache.set(el, -1);
                    return 2;
                }
                if (tag === 'P' && pcl.contains('o2-lb')) {
                    blockedZoneCache.set(el, -1);
                    return 2;
                }
                if (tag === 'B' && pcl.contains('o2-tht')) {
                    const o2tHost = directParent.closest ? directParent.closest('[data-o2t]') : null;
                    const o2tId = o2tHost ? (o2tHost.getAttribute('data-o2t') || '') : '';
                    if (o2tId !== 't-asks' && o2tId !== 't-other' && o2tId !== 't-waiting' && o2tId !== 't-stuck') {
                        blockedZoneCache.set(el, -1);
                        return 2;
                    }
                }
            }
            if ((tag === 'B' || tag === 'P') && el.closest && el.closest('.o2-ask')) {
                blockedZoneCache.set(el, -1);
                return 2;
            }
        }
        if (BLOCKED_TEST_IDS.has(testId) || el.getAttribute('contenteditable') === 'true') {
            ownSoftBlocked = true;
        } else if (typeof className === 'string' && className.length > 0) {
            for (let i = 0; i < BLOCKED_CLASSES.length; i++) {
                if (className.includes(BLOCKED_CLASSES[i])) {
                    ownSoftBlocked = true;
                    break;
                }
            }
        }

        const parent = el.parentElement || (el.parentNode && el.parentNode.host);
        const parentState = parent ? getElementBlockedState(parent) : 0;
        if (parentState === 2) {
            blockedZoneCache.set(el, -1);
            return 2;
        }
        const finalState = (ownSoftBlocked || parentState === 1) ? 1 : 0;
        blockedZoneCache.set(el, finalState === 1 ? -blockedCacheVersion : blockedCacheVersion);
        return finalState;
    }

    function isInBlockedZone(node) {
        if (!node) return false;
        const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        if (getElementBlockedState(el) !== 0) return true;
        if (node.nodeType === Node.TEXT_NODE && isInSkillItemContext(node)) return true;
        return false;
    }

    // Folder is a product label only in the Add Context menu, alongside these
    // fixed actions. Never add this generic word to the global dictionary.
    function translateAttachmentMenuFolder(node, value) {
        if (norm(value) !== 'Folder') return false;
        const label = node.parentElement;
        if (!label || label.tagName !== 'SPAN' || label.childNodes.length !== 1) return false;
        const row = label.parentElement;
        const group = row?.parentElement;
        if (row?.getAttribute('role') !== 'menuitem' || group?.getAttribute('role') !== 'group') return false;
        const menu = group.closest('[role="menu"]');
        if (!menu || isInBlockedZone(menu)) return false;
        const heading = Array.from(group.children).find(element =>
            element.getAttribute('role') !== 'menuitem' && /^(?:Add Context|添加上下文)$/.test(norm(element.textContent)));
        if (!heading) return false;
        const labels = Array.from(group.children)
            .filter(element => element.getAttribute('role') === 'menuitem')
            .flatMap(element => Array.from(element.children)
                .filter(child => child.tagName === 'SPAN' && child.childNodes.length === 1)
                .map(child => norm(child.textContent)));
        if (![['Media', '媒体'], ['Mentions', '提及'], ['Actions', '操作']]
            .every(variants => variants.some(text => labels.includes(text)))) return false;
        replaceTextNode(node, '文件夹');
        return true;
    }

    // "New" is a generic word (the model picker shows a "New" badge), so it is
    // never added to the dictionary. Translate it only when it is the sole
    // label of a button and a bounded ancestor is the Automations page.
    const AUTOMATION_PAGE_TITLE_REGEX = /(?:Automations|自动化)/;
    const AUTOMATION_PAGE_SIGNAL_REGEX = /(?:No automations yet|暂无自动化任务|Run a prompt on a schedule|按计划运行提示词|Next run|下次运行|Last run|上次运行|Paused\\. Resume it|已暂停\\. 请恢复)/i;
    function translateAutomationNewButton(node, value) {
        if (norm(value) !== 'New') return false;
        const label = node.parentElement;
        if (!label || isInBlockedZone(label) || isContentBodyContainer(label)) return false;

        let button = null;
        let curr = label;
        for (let depth = 0; curr && depth < 3; depth++) {
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            const role = curr.getAttribute ? curr.getAttribute('role') : null;
            if (role === 'option' || role === 'menuitem' || role === 'listbox' || role === 'menu') return false;
            if (tag === 'BUTTON' || role === 'button' || tag === 'A') {
                button = curr;
                break;
            }
            curr = curr.parentElement;
        }
        if (!button || norm(getBoundedTextContent(button, 8, 40) || '') !== 'New') return false;

        curr = button.parentElement;
        for (let depth = 0; curr && depth < 8; depth++) {
            if (curr === document.body || curr === document.documentElement) break;
            const role = curr.getAttribute ? curr.getAttribute('role') : null;
            if (role === 'dialog' || role === 'listbox' || role === 'menu') return false;
            const text = getBoundedTextContent(curr, 400, 4000);
            if (text === null) return false;
            const t = norm(text);
            if (AUTOMATION_PAGE_TITLE_REGEX.test(t) && AUTOMATION_PAGE_SIGNAL_REGEX.test(t)) {
                replaceTextNode(node, '新建');
                return true;
            }
            curr = curr.parentElement;
        }
        return false;
    }

    // The product-owned attachment label is rendered inside the protected
    // user-input container. Match its exact source structure so user text,
    // comment bodies, file names, and other descendants remain untouched.
    // The "3m ago" timestamp beside the copy / undo buttons under a sent
    // message lives inside the protected user-input container. Only accept a
    // text node that is exactly a relative time and whose nearby action row
    // holds buttons but no other text, so the user's own prompt is untouched.
    const MESSAGE_ACTION_TIMESTAMP_REGEX = /^(?:now|just\\s+now|\\d+\\s*(?:s|m|h|d|w|mo|yr|y)\\s+ago|\\d+\\s*(?:secs?|seconds?|mins?|minutes?|hrs?|hours?|days?|wks?|weeks?|mos?|months?|yrs?|years?)\\s+ago)$/i;
    function isMessageActionTimestamp(node) {
        if (!node) return false;
        const text = norm(node.nodeType === Node.TEXT_NODE ? node.nodeValue : node.textContent);
        if (!MESSAGE_ACTION_TIMESTAMP_REGEX.test(text)) return false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 4; depth++) {
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            if (tag === 'P' || tag === 'LI' || tag === 'PRE' || tag === 'CODE' || tag === 'BLOCKQUOTE') return false;
            const cls = typeof curr.className === 'string' ? curr.className : '';
            if (/(?:prose|markdown)/i.test(cls)) return false;
            if (curr.getAttribute?.('data-testid') === 'user-input-step') return false;
            let visited = 0;
            let rowText = '';
            let hasButton = false;
            let overflow = false;
            const visit = (n) => {
                if (overflow) return;
                if (++visited > 60) { overflow = true; return; }
                if (n.nodeType === Node.TEXT_NODE) {
                    rowText += n.nodeValue || '';
                    if (rowText.length > 80) overflow = true;
                    return;
                }
                if (n.nodeType !== Node.ELEMENT_NODE) return;
                const nTag = n.tagName ? n.tagName.toUpperCase() : '';
                const nCls = typeof n.className === 'string' ? n.className : '';
                if (nTag === 'BUTTON' || n.getAttribute?.('role') === 'button') { hasButton = true; return; }
                if (nTag === 'SVG' || /(?:google-symbols|material-symbols|material-icons|codicon)/i.test(nCls)) return;
                for (const child of n.childNodes) visit(child);
            };
            visit(curr);
            if (overflow || norm(rowText) !== text) return false;
            if (hasButton) return true;
            curr = curr.parentElement;
        }
        return false;
    }

    function getProtectedProductUiTranslation(node, value) {
        const normalized = norm(value);
        const lower = normalized.toLowerCase();

        if (isMessageActionTimestamp(node)) {
            const relativeTime = getRelativeTimeTranslation(normalized, node);
            if (relativeTime) return relativeTime;
            if (/^now$/i.test(normalized)) return "刚刚";
        }

        if (lower === 'commented on:') {
            const label = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (!label || label.tagName?.toUpperCase() !== 'SPAN') return null;

            const labelClass = typeof label.className === 'string' ? label.className : '';
            if (!labelClass.includes('text-sm') || !labelClass.includes('text-secondary-foreground')) return null;

            const row = label.parentElement;
            const rowClass = typeof row?.className === 'string' ? row.className : '';
            if (!rowClass.includes('items-center') || !rowClass.includes('flex-wrap')) return null;

            let current = row;
            let userInput = null;
            while (current) {
                if (current.getAttribute?.('data-testid') === 'user-input-step') {
                    userInput = current;
                    break;
                }
                current = current.parentElement || (current.getRootNode?.().host ?? null);
            }
            if (!userInput) return null;

            if (map.has(normalized)) return map.get(normalized);
            return lowerMap.get(lower) ?? null;
        }

        if (normalized === 'Comment' || normalized === 'Quote') {
            let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            let interactiveControl = null;
            let inMenu = false;
            let inUnsafeContent = false;
            for (let depth = 0; current && depth < 5; depth++) {
                if (current === document.body || current === document.documentElement) break;
                if (current.nodeType === Node.ELEMENT_NODE) {
                    const tag = current.tagName ? current.tagName.toUpperCase() : '';
                    const cls = typeof current.className === 'string' ? current.className : '';
                    if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'PRE' || tag === 'CODE' || tag === 'ARTICLE' || /^H[1-6]$/.test(tag) || current.getAttribute?.('contenteditable') === 'true' || /(?:prose|markdown|view-line|view-lines|xterm)/i.test(cls)) {
                        inUnsafeContent = true;
                        break;
                    }
                    const role = current.getAttribute ? current.getAttribute('role') : null;
                    if (role === 'menu') {
                        inMenu = true;
                    }
                    if (!interactiveControl && (tag === 'BUTTON' || role === 'menuitem' || role === 'button' || /(?:cursor-pointer)/i.test(cls))) {
                        const ctrlText = getBoundedTextContent(current, 8, 40);
                        if (ctrlText !== null && norm(ctrlText) === normalized) {
                            interactiveControl = current;
                        }
                    }
                }
                current = current.parentElement || (current.getRootNode?.().host ?? null);
            }
            if (!inUnsafeContent && (interactiveControl || inMenu)) {
                return normalized === 'Comment' ? "评论" : "引用";
            }
        }

        const linesMatch = normalized.match(/^(\\+)?\\s*(\\d+)\\s+more\\s+lines?$/i);
        if (linesMatch) {
            let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            let inTerminal = false;
            let inCodeLine = false;
            while (current) {
                if (current.nodeType === Node.ELEMENT_NODE) {
                    const className = typeof current.className === 'string' ? current.className : '';
                    if (className.includes('terminal') || className.includes('xterm') || className.includes('output-view') || className.includes('debug-console')) inTerminal = true;
                    if (className.includes('view-line')) inCodeLine = true;
                }
                current = current.parentElement || (current.parentNode && current.parentNode.host);
            }
            if (!inTerminal && !inCodeLine) {
                return (linesMatch[1] ? linesMatch[1] : "") + linesMatch[2] + " 行代码";
            }
        }

        if (/^Ask\\s+anything(?:,\\s*|\\s+)@\\s*to\\s+mention(?:,\\s*|\\s+)[\\\\/]\\s*for\\s+actions$/i.test(normalized)) {
            return "提问任何问题，使用 @ 提及，/ 执行操作";
        }
        if (/^Ask\\s+anything$/i.test(normalized)) {
            return "提问任何问题";
        }

        let match = normalized.match(/^Voice\\s+speed,\\s*([0-9.]+x)$/i);
        if (match) return "语速，" + match[1];

        match = normalized.match(/^Started\\s+voice\\s+chat\\s*[·•]\\s*(.+)$/i);
        if (match) return "已开始语音会话 · " + match[1];

        match = normalized.match(/^Stopped\\s+voice\\s+chat\\s*[·•]\\s*(.+)$/i);
        if (match) {
            let dur = match[1]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return "已结束语音会话 · " + dur;
        }

        match = normalized.match(/^Voice\\s+chat\\s*[·•]\\s*(.+?)(?:\\s*[·•]\\s*(.+))?$/i);
        if (match) {
            const formatDur = (s) => s
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            if (match[2]) {
                return "语音会话 · " + match[1] + " · " + formatDur(match[2]);
            }
            if (/\\d+\\s*[hms]/i.test(match[1])) {
                return "语音会话 · " + formatDur(match[1]);
            }
            return "语音会话 · " + match[1];
        }

        match = normalized.match(/^[·•]\\s*(\\d{1,2}:\\d{2})\\s*[·•]\\s*(.+)$/);
        if (match) {
            const dur = match[2]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return " · " + match[1] + " · " + dur;
        }

        match = normalized.match(/^[·•]\\s*(.+)$/);
        if (match && /\\d+\\s*[hms]/i.test(match[1])) {
            const dur = match[1]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return " · " + dur;
        }

        if (/^Voice\\s+chat$/i.test(normalized)) return "语音会话";
        if (/^Voice\\s+transcript$/i.test(normalized)) return "语音逐字稿";
        if (/^Voice\\s+speed$/i.test(normalized)) return "语速";
        if (/^Listening\\.\\s*Ask\\s+anything\\.$/i.test(normalized)) return "正在聆听. 请随时提问.";

        if (/^Ask\\s+anything(?:,\\s*|\\s+)@\\s*to\\s+mention(?:,\\s*|\\s+)[\\\\/]\\s*for\\s+actions$/i.test(normalized)) {
            return "提问任何问题，使用 @ 提及，/ 执行操作";
        }
        if (/^Ask\\s+anything$/i.test(normalized)) {
            return "提问任何问题";
        }

        match = normalized.match(/^E\\.g\\.\\s*(locations[\\\\/]global[\\\\/]workforcePools(?:\\.\\.\\.|…)?)$/i);
        if (match) return "例如 " + match[1];

        if (!/^(?:Searching|No\\b|\\.|…|正在搜索)/i.test(normalized)) return null;

        let searchingContainer = null;
        let p = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; p && depth < 4; depth++) {
            const pRaw = getBoundedTextContent(p, 12, 120);
            if (pRaw === null) break;
            const pText = norm(pRaw);
            if (/^Searching(?:\\s*\\.){1,3}$/i.test(pText) || /^Searching\\s*…$/i.test(pText)) {
                searchingContainer = p;
                break;
            }
            if (!searchingContainer && getSearchingStatusTranslation(pText)) {
                searchingContainer = p;
            }
            p = p.parentElement || (p.parentNode && p.parentNode.host);
        }

        const searchingTrans = (searchingContainer ? getSearchingStatusTranslation(searchingContainer.textContent) : null)
            || getSearchingStatusTranslation(value);
        if (searchingTrans) {
            let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            let inTerminal = false;
            let inCodeLine = false;
            let inPreOrCode = false;

            while (current) {
                if (current.nodeType === Node.ELEMENT_NODE) {
                    const tag = current.tagName?.toUpperCase();
                    if (tag === 'CODE' || tag === 'PRE') inPreOrCode = true;
                    const className = typeof current.className === 'string' ? current.className : '';
                    if (className.includes('terminal') || className.includes('xterm') || className.includes('output-view') || className.includes('debug-console')) inTerminal = true;
                    if (className.includes('view-line')) inCodeLine = true;
                }
                current = current.parentElement || (current.parentNode && current.parentNode.host);
            }

            if (!inTerminal && !inCodeLine && !inPreOrCode) {
                const targetContainer = searchingContainer || node.parentElement;
                if (targetContainer && norm(targetContainer.textContent) !== norm(value)) {
                    const siblings = collectTextNodes(targetContainer);
                    const searchingIdx = siblings.findIndex(t => /Searching|正在搜索/i.test(norm(t.nodeValue)));
                    if (searchingIdx >= 0) {
                        for (let i = 0; i < siblings.length; i++) {
                            if (siblings[i] !== node) {
                                replaceTextNode(siblings[i], i === searchingIdx ? searchingTrans : '');
                            }
                        }
                    }
                }
                return searchingTrans;
            }
        }

        return null;
    }

    function isInCommentContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = norm(current.textContent);
            if (text.length <= 6000 && /(?:Comments?|评论)\\s*[（(]\\s*\\d+\\s*[)）]/i.test(text)) return true;
            if (text.length <= 2000 && /(?:Save Comment|保存评论|Submit comment|提交评论|Add Comment|添加评论)/i.test(text)) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function isInConversationTimestampContext(node) {
        if (!node) return false;
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;

            const testId = current.getAttribute ? current.getAttribute('data-testid') : null;
            if (testId === 'user-input-step' || testId === 'agent-message' || testId === 'agent-response' || testId === 'agent-turn') {
                return false;
            }
            const cls = typeof current.className === 'string' ? current.className : '';
            if (/(?:prose|markdown)/i.test(cls)) return false;

            const metadata = [
                current.className,
                current.getAttribute?.('id'),
                current.getAttribute?.('data-testid'),
                current.getAttribute?.('aria-label'),
                current.getAttribute?.('title')
            ].filter(valuePart => typeof valuePart === 'string').join(' ');
            if (/(?:^|[-_\\s])(?:conversation-list|conversations-list|conversation-history|history-list)(?:[-_\\s]|$)/i.test(metadata)) return true;

            const text = norm(current.textContent);
            if (text.length <= 20000) {
                const hasConversationSections =
                    /(?:Other Conversations|其他会话)/i.test(text) &&
                    /(?:Current|当前|Search all conversations|搜索所有会话)/i.test(text);
                if (hasConversationSections) return true;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function getTimestampNowTranslation(node, value) {
        const normalized = norm(value);
        if (!/^now$/i.test(normalized)) return null;
        if (!node) return null;

        if (isContentBodyContainer(node) && !isMessageActionTimestamp(node)) return null;
        if (isMessageActionTimestamp(node)) return "刚刚";

        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let timestampLike = false;
        let explicitTimestamp = false;
        let timestampElement = null;
        let compactRow = null;
        for (let depth = 0; current && depth < 3 && norm(current.textContent) === normalized; depth++) {
            const tag = current.tagName?.toUpperCase();
            const metadata = [
                current.className,
                current.getAttribute?.('id'),
                current.getAttribute?.('data-testid'),
                current.getAttribute?.('aria-label'),
                current.getAttribute?.('title')
            ].filter(valuePart => typeof valuePart === 'string').join(' ');
            if (tag === 'TIME' || current.hasAttribute?.('datetime') || /(?:^|[-_\\s])(?:time|timestamp|date|muted|secondary|caption)(?:[-_\\s]|$)|(?:^|\\s)text-xs(?:\\s|$)/i.test(metadata)) {
                timestampLike = true;
                explicitTimestamp = tag === 'TIME' || current.hasAttribute?.('datetime') || /(?:^|[-_\\s])(?:time|timestamp|date)(?:[-_\\s]|$)/i.test(metadata);
                timestampElement = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (timestampLike && (explicitTimestamp || isInCommentContext(node))) return "刚刚";

        current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 5; depth++) {
            const text = norm(current.textContent);
            if (text !== normalized) {
                if (text.length <= 240) compactRow = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }

        // Conversation rows render the title and a muted relative timestamp as
        // siblings or nested cells. Require both that compact row and a nearby
        // conversation-list signal so ordinary standalone "now" stays intact.
        if (!compactRow || !isInConversationTimestampContext(node)) return null;
        if (timestampLike && (explicitTimestamp || timestampElement?.parentElement === compactRow)) return "刚刚";
        return null;
    }

    function getRecentProjectSectionTranslation(node, value) {
        const normalized = norm(value);
        const match = normalized.match(/^Recent in\\s+(.+)$/i);
        if (!match || match[1].length > 160 || !isInConversationTimestampContext(node)) return null;
        return match[1] + " 中的近期会话";
    }

    function isInDeleteTaskDialogContext(node) {
        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = norm(current.textContent);
            const hasTitle = /(?:Delete Task|删除任务)/i.test(text);
            const hasConfirmation = /Are you sure you want to delete|This action cannot be undone|您确定要删除(?:计划)?任务|此操作无法撤销/i.test(text);
            if (text.length <= 1600 && hasTitle && hasConfirmation) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function getDeleteTaskConfirmationTranslation(node, value) {
        const normalized = norm(value);
        if (!/^Are you sure you want to delete/i.test(normalized) && !/^\\?/i.test(normalized)) return null;
        if (!isInDeleteTaskDialogContext(node)) return null;

        let match = normalized.match(/^Are you sure you want to delete(?:\\s+the scheduled task)?\\s+(.+?)\\?\\s*(?:This action cannot be undone\\.?|此操作无法撤销。?)$/i);
        if (match) return "您确定要删除任务 " + match[1] + " 吗？此操作无法撤销";

        match = normalized.match(/^Are you sure you want to delete(?:\\s+the scheduled task)?(?:\\s+(.+))?$/i);
        if (match) return "您确定要删除任务" + (match[1] ? " " + match[1] : " ");

        if (/^\\?\\s*(?:This action cannot be undone\\.?|此操作无法撤销。?)?$/i.test(normalized)) {
            return /(?:This action cannot be undone|此操作无法撤销)/i.test(normalized)
                ? " 吗？此操作无法撤销"
                : " 吗？";
        }
        return null;
    }

    function findLastTextNode(node) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue && node.nodeValue.trim() ? node : null;
        }
        if (!node.childNodes) return null;
        for (let i = node.childNodes.length - 1; i >= 0; i--) {
            const found = findLastTextNode(node.childNodes[i]);
            if (found) return found;
        }
        return null;
    }

    function findPreviousTextNode(node) {
        let current = node;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            let sibling = current.previousSibling;
            let steps = 0;
            while (sibling && ++steps <= 8) {
                if (sibling.nodeType !== Node.ELEMENT_NODE || !sibling.children || sibling.children.length <= 6) {
                    const found = findLastTextNode(sibling);
                    if (found) return found;
                }
                sibling = sibling.previousSibling;
            }
            const parent = current.parentNode || current.host || null;
            if (parent && parent.children && parent.children.length > 10) break;
            current = parent;
        }
        return null;
    }

    function findFirstTextNode(node) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE) {
            return node.nodeValue && node.nodeValue.trim() ? node : null;
        }
        if (!node.childNodes) return null;
        for (let i = 0; i < node.childNodes.length; i++) {
            const found = findFirstTextNode(node.childNodes[i]);
            if (found) return found;
        }
        return null;
    }

    function findNextTextNode(node) {
        let current = node;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            let sibling = current.nextSibling;
            let steps = 0;
            while (sibling && ++steps <= 8) {
                if (sibling.nodeType !== Node.ELEMENT_NODE || !sibling.children || sibling.children.length <= 6) {
                    const found = findFirstTextNode(sibling);
                    if (found) return found;
                }
                sibling = sibling.nextSibling;
            }
            const parent = current.parentNode || current.host || null;
            if (parent && parent.children && parent.children.length > 10) break;
            current = parent;
        }
        return null;
    }

    function replaceTextNode(node, value) {
        if (!node) return false;
        translatedValues.set(node, value);
        if (node.nodeValue === value) return false;
        node.nodeValue = value;
        return true;
    }

    const EXPLORED_STATUS_SUFFIX = '[>v›∨˅⌄▼▽⋁\\u2228\\u02c5\\u2304\\u25bc\\u25bd\\u276f\\u2193]';
    const EXPLORED_HEADER_REGEX = new RegExp('^(?:(Explored)\\\\s+)?(.+?)(\\\\s*' + EXPLORED_STATUS_SUFFIX + ')?\\\\s*$', 'i');
    const EXPLORED_SUFFIX_REGEX = new RegExp('^(.+?)(\\\\s*' + EXPLORED_STATUS_SUFFIX + ')?\\\\s*$', 'i');
    const STATUS_ITEM_REGEX = new RegExp('^(files?|folders?|pages?|search(?:es)?|tasks?|commands?|tools?|rules?|repos(?:itories)?|images?|actions?)(\\\\s*,\\\\s*|\\\\s*' + EXPLORED_STATUS_SUFFIX + ')?$', 'i');

    function isCollapsibleActivityHeader(str) {
        if (!str || typeof str !== 'string') return false;
        const trimmed = str.trim();
        if (trimmed.length > 160) return false;
        if (!/^(?:Thought|Thinking|Explored|Exploring|Ran|Running|Edited|Editing)\\b/i.test(trimmed)) return false;

        if (/^(?:Thought for|Thinking for)\\s+[\\d\\w\\s,.<]+?(?:\\s*[>v›❯〉→∨˅⌄▼▽⋁↓])?\\s*$/i.test(trimmed)) {
            return true;
        }
        if (/^Thinking(?:(?:\\s*\\.)|(?:\\s*…))*\\s*$/i.test(trimmed)) {
            return true;
        }

        const match = trimmed.match(EXPLORED_HEADER_REGEX);
        if (match) {
            const rawContent = match[2].trim().replace(/,\\s*$/, '');
            const items = rawContent.split(/\\s*,\\s*/);
            let countedValid = true;
            for (const item of items) {
                const itemMatch = item.trim().match(/^(?:(explored|ran|run|executed|edited)\\s+)?(\\d+)\\s+(files?|folders?|pages?|search(?:es)?|tasks?|commands?|tools?|rules?|repos(?:itories)?|images?|actions?|artifacts?)$/i);
                if (!itemMatch) {
                    countedValid = false;
                    break;
                }
            }
            if (countedValid && items.length > 0) return true;
        }

        const suffixMatch = trimmed.match(EXPLORED_SUFFIX_REGEX);
        if (!suffixMatch) return false;
        const clauseSource = suffixMatch[1].trim().replace(/,\\s*$/, '');
        const clauses = clauseSource.split(/\\s*,\\s*/);
        let hasNoun = false;

        for (const clause of clauses) {
            const c = clause.trim();
            let cm = c.match(/^(Exploring|Explored)(?:\\s+(files?|artifacts?))?$/i);
            if (cm) {
                if (cm[2]) hasNoun = true;
                continue;
            }
            cm = c.match(/^(Running|Ran)\\s+(commands?)$/i);
            if (cm) {
                hasNoun = true;
                continue;
            }
            cm = c.match(/^(Editing|Edited)(?:\\s+(files?|artifacts?))?$/i);
            if (cm) {
                if (cm[2]) hasNoun = true;
                continue;
            }
            return false;
        }

        if (clauses.length === 0 || (clauses.length === 1 && !hasNoun && !suffixMatch[2])) {
            return false;
        }
        return true;
    }

    function collectTextNodes(element) {
        const nodes = [];
        if (!element || !element.childNodes) return nodes;
        const visit = current => {
            if (current.nodeType === Node.TEXT_NODE) {
                nodes.push(current);
                return;
            }
            if (!current.childNodes) return;
            for (const child of current.childNodes) visit(child);
        };
        visit(element);
        return nodes;
    }

    // The commit-dialog summary is split around its file count, arrow icon,
    // and branch name. Reorder only the text nodes in that bounded row; keep
    // the icon and runtime Git ref nodes intact.
    function translateCommitSummaryContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if ((element.textContent || '').length > 240) return false;

        const isElementBlocked = isInBlockedZone(element);
        const textNodes = collectTextNodes(element);
        if (textNodes.length < 2) return false;

        const isBlocked = isElementBlocked || textNodes.some(textNode => isInBlockedZone(textNode));
        let parts = getCommitSummaryParts(textNodes.map(textNode => textNode.nodeValue || '').join(''));

        const nonEmptyIndexes = textNodes
            .map((textNode, index) => norm(textNode.nodeValue) ? index : -1)
            .filter(index => index >= 0);
        if (nonEmptyIndexes.length < 2) return false;

        const lastNonEmptyVal = norm(textNodes[nonEmptyIndexes[nonEmptyIndexes.length - 1]].nodeValue);
        if (/^(?:to|changes?|更改|files?|个文件)$/i.test(lastNonEmptyVal)) {
            return false;
        }

        // React may update only the count or restore one English fragment
        // after this row was translated. Recover the current count from that
        // bounded intermediate node, then clear only known source fragments.
        if (!parts) {
            const prefixIndex = nonEmptyIndexes[0];
            const targetIndex = nonEmptyIndexes[nonEmptyIndexes.length - 1];
            const prefixMatch = norm(textNodes[prefixIndex].nodeValue)
                .match(/^将\\s*(\\d+)\\s*个文件的更改提交到$/);
            const intermediateNodes = textNodes.slice(prefixIndex + 1, targetIndex);
            const hasOnlyCommitFragments = intermediateNodes.every(textNode => {
                const text = norm(textNode.nodeValue);
                return !text || /^(?:\\d+|to|changes?|更改|files?|个文件|↗|↑)$/i.test(text);
            });
            if (prefixMatch && hasOnlyCommitFragments) {
                const refreshedCount = intermediateNodes
                    .map(textNode => norm(textNode.nodeValue))
                    .find(text => /^\\d+$/.test(text));
                parts = {
                    count: refreshedCount || prefixMatch[1],
                    target: norm(textNodes[targetIndex].nodeValue)
                };
            }
        }
        if (!parts) return false;

        if (isBlocked) {
            return 'skipped';
        }

        // Prefer the smallest matching container so sibling rows cannot be
        // combined when their parent happens to have no additional text.
        if (Array.from(element.children || []).some(child => {
            const childNodes = collectTextNodes(child);
            return childNodes.length > 1 &&
                !childNodes.some(textNode => isInBlockedZone(textNode)) &&
                !!getCommitSummaryParts(childNodes.map(textNode => textNode.nodeValue || '').join(''));
        })) return false;

        const prefixIndex = nonEmptyIndexes[0];
        const targetIndex = nonEmptyIndexes[nonEmptyIndexes.length - 1];
        let changed = replaceTextNode(textNodes[prefixIndex], "将 " + parts.count + " 个文件的更改提交到 ");
        for (let index = prefixIndex + 1; index < targetIndex; index++) {
            // Some builds render the outbound-arrow glyph as text rather than
            // SVG. It is product UI, so preserve it just like the icon form.
            if (/^[↗↑]$/.test(norm(textNodes[index].nodeValue))) continue;
            changed = replaceTextNode(textNodes[index], '') || changed;
        }
        return true;
    }

    function translateCommitSummaryTextNode(node, value) {
        const normalized = norm(value);
        if (!/^(?:Commit|提交|to|changes?|更改|files?|个文件|\\d+)$/i.test(normalized)) return false;

        if (/^\\d+$/.test(normalized)) {
            let countContext = node.parentElement;
            let hasCommitContext = false;
            for (let depth = 0; countContext && depth < 5; depth++) {
                if (countContext === document.body || countContext === document.documentElement) break;
                if ((countContext.childNodes?.length || 0) > 24) break;
                const contextText = norm(countContext.textContent);
                if (contextText.length <= 240 &&
                    /^(?:Commit|提交|将\\s*\\d+\\s*个文件的更改提交到)/i.test(contextText) &&
                    /(?:files?\\s*changes?|个文件.*更改)/i.test(contextText)) {
                    hasCommitContext = true;
                    break;
                }
                countContext = countContext.parentElement || (countContext.getRootNode?.().host ?? null);
            }
            if (!hasCommitContext) return false;
        }

        let current = node.parentElement;
        for (let depth = 0; current && depth < 5; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if ((current.childNodes?.length || 0) > 24) break;
            const res = translateCommitSummaryContainer(current);
            if (res) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    const SKILL_PICKER_DISPLAY_ENTRIES = [
        {
            source: 'compact',
            display: "压缩会话",
            descriptions: [
                "Compact the conversation now (summarize history to free up the context window).",
                "Compact the conversation now (summarize history to free up the context window)",
                "立即压缩会话（总结历史记录以释放上下文窗口）。",
                "立即压缩会话（总结历史记录以释放上下文窗口）"
            ]
        },
        {
            source: 'btw',
            display: "快速提问",
            descriptions: [
                'Ask a quick question without interrupting the main conversation.',
                "在不中断主会话的情况下快速提问"
            ]
        },
        {
            source: 'grill-me',
            display: "方案访谈",
            descriptions: [
                'Interview me to align on a plan',
                'Interview me to align on a plan.',
                "通过访谈与我对齐方案"
            ]
        },
        {
            source: 'teamwork',
            display: "团队协作",
            descriptions: [
                'Invoke a team of agents to autonomously tackle large projects',
                'Invoke a team of agents to autonomously tackle large projects.',
                "调用智能体团队自主应对大型项目",
                "调用智能体团队自主应对大型项目."
            ]
        },
        {
            source: 'learn',
            display: "复盘学习",
            descriptions: [
                'Reflect on recent successes or corrections to capture reusable skills or rules.',
                "反思最近的成功或改进，以捕获可复用的技能或规则"
            ]
        },
        {
            source: 'boost',
            display: "多智能体编排",
            descriptions: [
                'Invoke the Boost multi-agent orchestrator for complex tasks',
                'Invoke the Boost multi-agent orchestrator for complex tasks.',
                "调用 Boost 多智能体编排器处理复杂任务"
            ]
        },
        {
            source: 'agy-customizations',
            display: "Antigravity 个性化定制",
            descriptions: [
                'Comprehensive guide and reference for the Antigravity Customization System.',
                "Antigravity 个性化定制系统的综合指南与参考资料"
            ]
        },
        {
            source: 'antigravity-guide',
            display: "Antigravity 使用指南",
            descriptions: [
                'Provides a comprehensive guide, quick reference, and sitemap for Google Antigravity (AGY), including the Antigravity CLI (agy), Antigravity 2.0, Antigravity IDE, Python SDK, slash commands, keybindings, and customizations (skills, rules, MCP, sidecars).',
                "为 Google Antigravity（AGY）提供全面指南、快速参考和网站地图，涵盖 Antigravity CLI（agy）、Antigravity 2.0、Antigravity IDE、Python SDK、斜杠命令、快捷键及个性化定制（技能、规则、MCP 和 Sidecar）"
            ]
        },
        {
            source: 'generative_ui',
            display: "生成式界面",
            descriptions: [
                'How to render rich interactive HTML widgets inline in the chat or as standalone artifacts. Use this skill when you want to show the user diagrams, data visualizations, interactive controls, educational walkthroughs, or any rich visual content beyond plain text and markdown.',
                "介绍如何在会话中以内嵌方式呈现丰富的交互式 HTML 小组件，或将其作为独立交付件呈现。当您需要向用户展示图示、数据可视化、交互控件、教学演示，或任何超出纯文本和 Markdown 范畴的丰富可视化内容时，请使用此技能"
            ]
        },
        {
            source: 'migrate-workflows',
            display: "迁移工作流",
            descriptions: [
                'Automatically migrate legacy workflows to modern skills across global and workspace configurations. Scans for existing workflows, creates target SKILL.md files, and safely archives old workflow files.',
                'Automatically migrate legacy workflows to modern skills across global and workspace configurations.',
                "自动跨全局和工作区配置将旧版工作流迁移至现代技能。扫描现有工作流，创建目标 SKILL.md 文件，并安全归档旧工作流文件",
                "自动跨全局和工作区配置将旧版工作流迁移至现代技能"
            ]
        },
        {
            source: 'migrate-agent-settings',
            display: "迁移智能体设置",
            descriptions: [
                "Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin. Use when the user wants to bring over, import, or migrate their setup or config from another agent or tool. Don't use for installing Marketplace plugins or authoring a new plugin from scratch (use the plugin skill).",
                "Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin.",
                "Migrates the user's MCP servers, skills, slash commands, subagents, and instruction files from other coding agents (Claude Code, Codex, Cursor, Gemini CLI) into one new Antigravity plugin",
                "将用户的 MCP 服务器、技能、斜杠命令、子智能体及指令文件从其他编程智能体(Claude Code、Codex、Cursor、Gemini CLI)迁移到一个新的 Antigravity 插件中. 当用户希望从其他智能体或工具迁入、导入或迁移其设置或配置时使用. 请勿用于安装插件市场插件或从头编写新插件(请使用 plugin 技能).",
                "将用户的 MCP 服务器、技能、斜杠命令、子智能体及指令文件从其他编程智能体(Claude Code、Codex、Cursor、Gemini CLI)迁移到一个新的 Antigravity 插件中.",
                "将用户的 MCP 服务器、技能、斜杠命令、子智能体及指令文件从其他编程智能体(Claude Code、Codex、Cursor、Gemini CLI)迁移到一个新的 Antigravity 插件中"
            ]
        },
        {
            source: 'run-workflow',
            display: "运行工作流",
            descriptions: [
                "How to write and run a dynamic workflow script with the \`run_workflow\` tool: a Python script that orchestrates many agents with \`agent\`, \`parallel\`, \`pipeline\`, and \`phase\`. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows).",
                "How to write and run a dynamic workflow script with the run_workflow tool: a Python script that orchestrates many agents with agent, parallel, pipeline, and phase. Use when a task splits into many independent or staged pieces of agent work (fan out over files, modules, bugs, or review angles, then aggregate), or when the user asks for a workflow. Don't use for a single delegated task (use a subagent) or for legacy workflow files (see migrate-workflows).",
                "How to write and run a dynamic workflow script with the \`run_workflow\` tool",
                "How to write and run a dynamic workflow script with the run_workflow tool",
                "如何使用 \`run_workflow\` 工具编写并运行动态工作流脚本: 一个通过 \`agent\`、\`parallel\`、\`pipeline\` 与 \`phase\` 编排多个智能体的 Python 脚本. 当任务拆分为多个独立或分阶段的智能体工作项(跨文件、模块、Bug 或审查视角扇出，随后聚合)，或当用户要求使用工作流时使用. 请勿用于单个委派任务(请使用子智能体)或旧版工作流文件(请参阅 migrate-workflows).",
                "如何使用 \`run_workflow\` 工具编写并运行动态工作流脚本: 一个通过 \`agent\`、\`parallel\`、\`pipeline\` 与 \`phase\` 编排多个智能体的 Python 脚本",
                "如何使用 \`run_workflow\` 工具编写并运行动态工作流脚本"
            ]
        },
        {
            source: 'permissioned-github',
            display: "GitHub 权限规范",
            descriptions: [
                'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment.',
                'Guidelines for interacting with GitHub and request permissions from the user when commands fail due to restrictions in the agent environment',
                "与 GitHub 交互的操作准则，并在命令因智能体环境限制而失败时向用户申请权限"
            ]
        },
        {
            source: 'automation',
            display: "定时自动化",
            descriptions: [
                'Interactive guide to design and create a scheduled background automation. Use this skill when the user wants to create an automated or recurring scheduled task (e.g. "summarize my emails every morning", "every Monday send me a to-do list"). Also triggered by the /automation slash command.',
                'Interactive guide to design and create a scheduled background automation.',
                'Interactive guide to design and create a scheduled background automation',
                "交互式设计并创建定时后台自动化的指引。当用户希望创建自动化或周期性计划任务（例如“每天早上汇总我的邮件”、“每周一向我发送待办清单”）时使用此技能。亦可通过 /automation 斜杠命令触发",
                "交互式设计并创建定时后台自动化的指引"
            ]
        },
        {
            source: 'plugin',
            display: "插件管理",
            descriptions: [
                "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit. Use this skill when the user wants to enable, disable, install or uninstall a plugin, when they want to create a new plugin, or when a new customization should be packaged into a plugin rather than left loose. Also triggered by the /plugin slash command. Don't use for the underlying customization system itself — discovery roots, loading priority, or authoring a standalone skill, agent, rule, hook or MCP server outside a plugin; see the customizations guide skill for those.",
                "How to manage and create plugins — namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit.",
                "How to manage and create plugins -- namespaced bundles of skills, agents, rules, MCP servers and hooks that install, enable and disable as a single unit.",
                "How to manage and create plugins",
                "如何管理和创建插件 —— 作为单一单元进行安装、启用与禁用的命名空间技能、智能体、规则、MCP 服务器与钩子捆绑包。当用户希望启用、禁用、安装或卸载插件，想要创建新插件，或应当将新的个性化定制打包为插件而非单独留存时使用此技能。亦可通过 /plugin 斜杠命令触发。请勿用于底层个性化定制系统本身 —— 发现根目录、加载优先级，或在插件外部编写独立的技能、智能体、规则、钩子或 MCP 服务器；相关内容请参阅个性化定制指南技能",
                "如何管理和创建插件 —— 作为单一单元进行安装、启用与禁用的命名空间技能、智能体、规则、MCP 服务器与钩子捆绑包",
                "如何管理和创建插件"
            ]
        },
        {
            source: 'ui-extension',
            display: "UI 扩展",
            descriptions: [
                "Build, package, run, and debug UI extensions for Antigravity: interactive web panels that render in the side pane, served by a Node.js sidecar using the built-in Sidecar SDK.",
                "构建、打包、运行并调试 Antigravity 的 UI 扩展：在侧边面板中渲染的交互式 Web 面板，由使用内置 Sidecar SDK 的 Node.js Sidecar 提供服务"
            ]
        },
        {
            source: 'ui-plugin-navigation',
            display: "UI 插件导航",
            descriptions: [
                "Discover UI plugin panels relevant to the current task and surface a one-click pill in chat to open (toggle) them in the side pane. Use when a running UI plugin's panel would help with what the user is doing, or right after the user enables a new UI plugin pane and a shortcut to open it is handy.",
                "发现与当前任务相关的 UI 插件面板，并在聊天中提供一键胶囊按钮以便在侧边面板中打开（切换）它们。当运行中的 UI 插件面板对用户正在进行的操作有所帮助，或在用户启用新的 UI 插件面板且需要便捷快捷方式打开它时使用"
            ]
        },
        {
            source: 'sync-marketplace-plugins',
            display: "同步插件市场",
            descriptions: [
                "Sync, audit, and diff official Antigravity Marketplace plugins from the local cache (~/.gemini/antigravity/cache/marketplaces/antigravity-plugins-official/) against dicts/marketplace_plugins.json. Use this skill whenever an Antigravity version upgrade occurs, or when the user requests updating, auditing, or cleaning plugin marketplace translations.",
                "Sync, audit, and diff official Antigravity Marketplace plugins from the local cache",
                "同步、审计并比对官方 Antigravity 插件市场插件与插件市场专用词典。在 Antigravity 版本升级或需要更新、审计及清理插件市场汉化文案时使用此技能。",
                "同步、审计并比对官方 Antigravity 插件市场插件与插件市场专用词典",
                "从本地缓存同步、审计并比对官方 Antigravity 插件市场插件",
                "同步官方 Antigravity 插件市场本地缓存并进行审计与比对",
                "同步、审计并比对官方 Antigravity 插件市场本地缓存"
            ]
        },
        {
            source: 'research',
            display: "调研",
            descriptions: [
                "Research subagent with read-only tools for exploring the codebase, searching the web, and reading files. Delegate to this agent when you need to run a task in a separate conversation context but with the same capabilities as the current agent, when a research task requires many search and file-reading steps that would clutter your context, or when you need a broad survey of the codebase or documentation. Prefer doing research yourself for quick, targeted lookups.",
                "Research subagent with read-only tools for exploring the codebase, searching the web, and reading files.",
                "具备只读工具的调研子智能体，用于探索代码库、搜索网络和阅读文件。当您需要在独立的会话上下文中运行具有与当前智能体相同能力的任务、研究任务需要执行大量会使上下文变得混乱的搜索与文件读取步骤，或需要对代码库或文档进行广泛调研时，请委托给该智能体。对于快速、有针对性的查询，建议由主智能体自行完成",
                "具备只读工具的调研型子智能体，用于探索代码库、搜索网络和阅读文件"
            ]
        },
        {
            source: 'gcalendar',
            display: "Google 日历",
            descriptions: [
                "Read, create, and manage Google Calendar events. Use when the user shares a calendar.google.com URL, asks what is on their schedule, wants an event found, created, updated, deleted, or moved, wants to RSVP, wants free/busy or scheduling conflicts checked before proposing a time, wants focus time or an out-of-office block created, wants an event quick-added from a phrase or imported from an ICS file, or wants to know where someone is working from and which timezone they are in. Don't use for Gmail, Chat, or Tasks.",
                "Check availability, schedule events, and RSVP.",
                "Run your Google Calendar. Find a time that works for everyone, send invites, block focus time, and get briefed on your day with any conflicts flagged.",
                "读取、创建并管理 Google 日历日程. 当用户分享 calendar.google.com 链接、询问日程安排、需要查找、创建、更新、删除或移动日程、回复邀请、在提议时间前检查空闲/忙碌或日程冲突、创建专注时间或不在办公室状态块、通过短语快速添加日程或从 ICS 文件导入，或需要了解某人的工作地点及所在时区时使用. 请勿用于 Gmail、Chat 或 Google 任务.",
                "读取、创建并管理 Google 日历日程。当用户分享 calendar.google.com 链接、询问日程安排、需要查找、创建、更新、删除或移动日程、回复邀请、在提议时间前检查空闲/忙碌或日程冲突、创建专注时间或不在办公室状态块、通过短语快速添加日程或从 ICS 文件导入，或需要了解某人的工作地点及所在时区时使用。请勿用于 Gmail、Chat 或 Google 任务",
                "查看空闲情况、安排活动并回复邀请.",
                "查看空闲状态、安排日程并回复邀请.",
                "运行您的 Google Calendar。找到适合每个人的时间、发送邀请、锁定专注时间，并在标记任何冲突的情况下了解您一天的安排",
                "管理您的 Google Calendar。查找适合所有人的时间、发送邀请、预留专注时间，并获取每日日程简报及冲突提醒"
            ]
        },
        {
            source: 'gdocs',
            display: "Google 文档",
            descriptions: [
                "Read, create, edit, and manage Google Docs. Use when the user shares a docs.google.com URL, asks to summarize or extract content from a doc, wants a doc drafted, edited, formatted, or commented on, wants tables, images, or smart chips inserted, wants markdown imported or synchronized with a doc, or wants a doc exported. Requires a known document ID — to find documents, use the gdrive skill from the Google Drive plugin; if it isn't installed, ask the user for the doc link. Don't use for Google Sheets, Slides, or Drive file management.",
                "Read, draft, and edit docs.",
                "Read and write your Google Docs. Summarize any doc from its link, draft proposals and announcements in a new doc, and reply to and resolve open comments.",
                "读取、创建、编辑并管理 Google 文档. 当用户分享 docs.google.com 链接、要求总结或提取文档内容、起草、编辑、排版或评论文档、插入表格、图片或智能画布卡片、导入或同步 Markdown 到文档，或导出文档时使用. 需要已知的文档 ID —— 如需查找文档，请使用 Google Drive 插件中的 gdrive 技能; 若尚未安装，请向用户索取文档链接. 请勿用于 Google 表格、幻灯片或云端硬盘文件管理.",
                "读取、创建、编辑并管理 Google 文档。当用户分享 docs.google.com 链接、要求总结或提取文档内容、起草、编辑、排版或评论文档、插入表格、图片或智能画布卡片、导入或同步 Markdown 到文档，或导出文档时使用。需要已知的文档 ID —— 如需查找文档，请使用 Google Drive 插件中的 gdrive 技能；若尚未安装，请向用户索取文档链接。请勿用于 Google 表格、幻灯片或云端硬盘文件管理",
                "读取、起草和编辑文档.",
                "阅读、起草和编辑文档.",
                "读写您的 Google Docs. 通过链接总结任意文档，在新文档中起草提案与公告，以及回复并解决未处理的评论.",
                "阅读并编写您的 Google Docs. 通过链接总结任何文档、在新建文档中起草方案和公告，并回复和解决未结评论."
            ]
        },
        {
            source: 'gdrive',
            display: "Google 云端硬盘",
            descriptions: [
                "Browse, search, and manage Google Drive files and folders. Use when the user shares a drive.google.com URL, asks what is in a folder, wants a file found, downloaded, uploaded, updated in place, moved, copied, or renamed, wants a Google file exported to PDF, Markdown, or CSV, wants comments read or added, wants sharing and permissions checked or changed, or wants Drive activity watched. Don't use for editing the contents of a Doc, Sheet, or Slides deck.",
                "Search, upload, download, and share files.",
                "Find and organize your Google Drive. Search across your files, tidy up folders, share them with the right people, and download or export them as PDF, CSV, or Markdown.",
                "浏览、搜索并管理 Google 云端硬盘文件和文件夹. 当用户分享 drive.google.com 链接、询问文件夹中的内容、需要查找、下载、上传、就地更新、移动、复制或重命名文件、将 Google 文件导出为 PDF、Markdown 或 CSV、读取或添加评论、检查或更改共享权限，或监控云端硬盘动态时使用. 请勿用于编辑文档、表格或幻灯片的内容.",
                "浏览、搜索并管理 Google 云端硬盘文件和文件夹。当用户分享 drive.google.com 链接、询问文件夹中的内容、需要查找、下载、上传、就地更新、移动、复制或重命名文件、将 Google 文件导出为 PDF、Markdown 或 CSV、读取或添加评论、检查或更改共享权限，或监控云端硬盘动态时使用。请勿用于编辑文档、表格或幻灯片的内容",
                "搜索、上传、下载和共享文件.",
                "查找并整理您的 Google Drive。跨文件进行搜索、整理文件夹、与合适的人共享，并将其下载或导出为 PDF、CSV 或 Markdown",
                "查找并整理您的 Google Drive。跨文件搜索、整理文件夹、与合适的人员共享，以及将文件下载或导出为 PDF、CSV 或 Markdown"
            ]
        },
        {
            source: 'gmail',
            display: "Gmail",
            descriptions: [
                "Read, search, send, and manage Gmail messages, drafts, labels, and emoji reactions using a Go CLI. Use when reading emails, searching inbox, sending messages, reacting to messages with emoji, managing drafts, forwarding, checking vacation responder, managing labels, downloading attachments, or decoding \`mail.google.com\` Web UI URLs. Don't use for Google Chat messages or Calendar invites.",
                "Read, search, send, and manage Gmail messages, drafts, labels, and emoji reactions using a Go CLI. Use when reading emails, searching inbox, sending messages, reacting to messages with emoji, managing drafts, forwarding, checking vacation responder, managing labels, downloading attachments, or decoding mail.google.com Web UI URLs. Don't use for Google Chat messages or Calendar invites.",
                "Search, read, draft, and send emails in Gmail.",
                "Run your Gmail inbox. Search and summarize threads, draft replies, organize labels, and send messages with your approval.",
                "使用 Go CLI 读取、搜索、发送和管理 Gmail 邮件、草稿、标签及表情符号回应. 在阅读邮件、搜索收件箱、发送邮件、使用表情符号回应邮件、管理草稿、转发、检查自动休假回复、管理标签、下载附件或解码 \`mail.google.com\` Web 界面 URL 时使用. 请勿用于 Google Chat 消息或日历邀请.",
                "使用 Go CLI 读取、搜索、发送和管理 Gmail 邮件、草稿、标签及表情符号回应. 在阅读邮件、搜索收件箱、发送邮件、使用表情符号回应邮件、管理草稿、转发、检查自动休假回复、管理标签、下载附件或解码 mail.google.com Web 界面 URL 时使用. 请勿用于 Google Chat 消息或日历邀请.",
                "使用 Go CLI 读取、搜索、发送和管理 Gmail 邮件、草稿、标签及表情符号回应。",
                "在 Gmail 中搜索、阅读、起草并发送电子邮件.",
                "管理您的 Gmail 收件箱. 搜索并总结邮件会话、起草回复、整理标签，并在您批准后发送邮件."
            ]
        },
        {
            source: 'gsheets',
            display: "Google 表格",
            descriptions: [
                "Read, write, format, and manage Google Sheets. Use when the user shares a sheets.google.com or docs.google.com/spreadsheets URL, asks to read or summarize spreadsheet data, wants cells written, formatted, sorted, merged, or validated, wants rows/columns inserted or deleted, wants charts, pivot tables, or tables added, wants CSV imported, or wants a spreadsheet created, copied, shared, or exported. Don't use for Google Docs, Slides, or Drive file management.",
                "Read, write, and format spreadsheets.",
                "Read, write, and format your Google Sheets. Fill in formulas, sort and clean columns, import CSVs, build charts and pivot tables, and export the result.",
                "读取、编写、格式化并管理 Google 表格. 当用户分享 sheets.google.com 或 docs.google.com/spreadsheets 链接、要求读取或总结电子表格数据、需要写入、格式化、排序、合并或验证单元格、插入或删除行/列、添加图表、数据透视表或表格、导入 CSV，或创建、复制、共享或导出电子表格时使用. 请勿用于 Google 文档、幻灯片或云端硬盘文件管理.",
                "读取、编写、格式化并管理 Google 表格。当用户分享 sheets.google.com 或 docs.google.com/spreadsheets 链接、要求读取或总结电子表格数据、需要写入、格式化、排序、合并或验证单元格、插入或删除行/列、添加图表、数据透视表或表格、导入 CSV，或创建、复制、共享或导出电子表格时使用。请勿用于 Google 文档、幻灯片或云端硬盘文件管理",
                "读取、编写和格式化电子表格.",
                "阅读、编写和格式化电子表格.",
                "读写并格式化您的 Google Sheets。填充公式、排序和清理列、导入 CSV、构建图表与数据透视表，并导出结果",
                "阅读、编写和格式化您的 Google Sheets。填充公式、对列进行排序和清洗、导入 CSV、构建图表和数据透视表，并导出结果"
            ]
        },
        {
            source: 'gslides',
            display: "Google 幻灯片",
            descriptions: [
                "Read, create, and edit Google Slides presentations. Use when creating presentations, when the user shares a slides.google.com URL, asks to summarize or extract content from a deck, wants slides drafted or updated, or wants a presentation exported. Don't use for Google Docs, Sheets, or Drive file management.",
                "Read, edit, and export presentations.",
                "Build and polish your Google Slides. Turn notes into a deck, add slides, images, and speaker notes, and export the result to PDF or PowerPoint.",
                "读取、创建并编辑 Google 幻灯片演示文稿. 在创建演示文稿、用户分享 slides.google.com 链接、要求总结或提取演示文稿内容、起草或更新幻灯片，或导出演示文稿时使用. 请勿用于 Google 文档、表格或云端硬盘文件管理.",
                "读取、创建并编辑 Google 幻灯片演示文稿。在创建演示文稿、用户分享 slides.google.com 链接、要求总结或提取演示文稿内容、起草或更新幻灯片，或导出演示文稿时使用。请勿用于 Google 文档、表格或云端硬盘文件管理",
                "读取、编辑和导出演示文稿.",
                "阅读、编辑和导出演示文稿.",
                "构建并润色您的 Google Slides。将笔记转化为演示文稿，添加幻灯片、图片和演讲者备注，并将结果导出为 PDF 或 PowerPoint",
                "构建并润色您的 Google Slides。将笔记整理成演示文稿、添加幻灯片、图片和演讲者备注，并将结果导出为 PDF 或 PowerPoint"
            ]
        },
        {
            source: 'swarm',
            display: "蜂群协作",
            descriptions: [
                "(Preview & Quota Heavy) Run a swarm: several agents working in parallel on one task, each in its own conversation, collaborating through a shared message board. Use when the work splits into pieces that can be done at the same time, or when a second pair of eyes should check the first pair's work.",
                "(Preview & Quota Heavy) Run a swarm: several agents working in parallel on one task",
                "(预览且配额消耗较高) 运行蜂群协作: 多个智能体各自在独立会话中并行处理同一任务，并通过共享消息板协同配合. 当工作可拆分为可同时推进的多个部分，或需要引入独立第二视角复核把关先前工作成果时使用.",
                "(预览且配额消耗较高) 运行蜂群协作: 多个智能体各自在独立会话中并行处理同一任务"
            ]
        },
        {
            source: 'swarm_monitor',
            display: "蜂群监控",
            descriptions: [
                "ONLY for the native-swarm worker whose brief says it is the monitor. On a timer, it checks whether the whole swarm has stalled and calls on the one member who can unstick it. Coordinators and other workers: do not load this.",
                "ONLY for the native-swarm worker whose brief says it is the monitor.",
                "仅限任务简报中指定为监控员的原生蜂群工作节点使用. 它会按定时器检查整个蜂群是否处于停滞状态，并唤醒唯一能推动进展的成员打破僵局. 协调者及其他工作节点: 请勿加载此技能.",
                "仅限任务简报中指定为监控员的原生蜂群工作节点使用."
            ]
        },
        {
            source: 'mcp-app-development',
            display: "MCP 应用开发",
            descriptions: [
                "Build, package, and debug MCP Apps for Antigravity: MCP server tools whose results render as interactive UI in the conversation, in the side pane, or full-page from the sidebar. Use when adding a UI to an MCP tool, building or theming the app itself, packaging it as a plugin, or debugging an app that doesn't render or behave as expected.",
                "Build, package, and debug MCP Apps for Antigravity: MCP server tools whose results render as interactive UI in the conversation, in the side pane, or full-page from the sidebar.",
                "构建、打包并调试 Antigravity 的 MCP 应用: 指执行结果可在对话中、侧边面板或从侧边栏全页渲染为交互式界面的 MCP 服务器工具. 当需要为 MCP 工具添加界面、构建或设置应用主题、将其打包为插件，或调试未按预期渲染或运行的应用时使用.",
                "构建、打包并调试 Antigravity 的 MCP 应用: 指执行结果可在对话中、侧边面板或从侧边栏全页渲染为交互式界面的 MCP 服务器工具."
            ]
        },
        {
            source: 'swarm_narrator',
            display: "蜂群叙事者",
            descriptions: [
                "ONLY for the native-swarm worker whose brief says it is the narrator. It watches the board and keeps the facts behind the user's Overview (view.json) current. Coordinators and other workers: do not load this.",
                "ONLY for the native-swarm worker whose brief says it is the narrator.",
                "仅限任务简报中指定为叙事者的原生蜂群工作节点使用. 它会持续关注消息板，并保持用户概览视图(view.json)背后的事实信息处于最新状态. 协调者及其他工作节点: 请勿加载此技能.",
                "仅限任务简报中指定为叙事者的原生蜂群工作节点使用."
            ]
        }
    ];

    function getSkillPickerDisplayEntry(textNodes) {
        const values = textNodes.map(textNode => norm(textNode.nodeValue));
        return SKILL_PICKER_DISPLAY_ENTRIES.find(entry => {
            const hasName = values.includes(entry.source) || values.includes(entry.display);
            const hasDescription = entry.descriptions.some(description => {
                return values.some(value => value === description || value.includes(description));
            });
            return hasName && hasDescription;
        }) || null;
    }

    function translateSkillPickerEntry(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (element.hasAttribute(SKIP_TRANSLATION_ATTR)) return false;
        if (BLOCKED_TEST_IDS.has(element.getAttribute('data-testid'))) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length < 2) return false;
        const entry = getSkillPickerDisplayEntry(textNodes);
        if (!entry) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getSkillPickerDisplayEntry(collectTextNodes(child));
        })) return false;

        let changed = false;
        const nameNode = textNodes.find(textNode => {
            const v = norm(textNode.nodeValue);
            return v === entry.source || v === entry.display;
        });
        if (nameNode && norm(nameNode.nodeValue) === entry.source) {
            if (replaceTextNode(nameNode, entry.display)) changed = true;
        }

        for (const tn of textNodes) {
            if (tn === nameNode) continue;
            const rawVal = norm(tn.nodeValue);
            if (!rawVal || rawVal.length < 4) continue;
            const trans = map.get(rawVal) || lowerMap.get(rawVal.toLowerCase());
            if (trans && replaceTextNode(tn, trans)) {
                changed = true;
            }
        }

        return changed;
    }

    function translateSkillPickerNameTextNode(node, value) {
        const normalized = norm(value);
        if (!SKILL_PICKER_DISPLAY_ENTRIES.some(entry => entry.source === normalized)) return false;

        // React can replace only the skill-name text node after the row was
        // translated. The exact-name prefilter keeps this ancestor walk narrow.
        let current = node.parentElement;
        for (let depth = 0; current && depth < 4; depth++) {
            if (translateSkillPickerEntry(current)) return true;
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function translateUsedSkillNameTextNode(node, value) {
        const normalized = norm(value);
        const entry = SKILL_PICKER_DISPLAY_ENTRIES.find(entry => entry.source === normalized);
        if (!entry) return false;

        let current = node.parentElement;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const text = current.textContent || '';
            if (text.length <= 2500 && /(?:Skills?\\s+Used|已使用的技能)/i.test(text)) {
                return replaceTextNode(node, entry.display);
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return false;
    }

    function translateAgentLoadingStatus(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.getAttribute('data-testid') !== 'agent-loading') return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const prefixNode = textNodes.find(textNode => /^(?:Working|处理中|工作中)$/i.test(norm(textNode.nodeValue)));
        if (!prefixNode || norm(prefixNode.nodeValue) === "工作中") return false;
        return replaceTextNode(prefixNode, (prefixNode.nodeValue || '').replace(/Working|处理中/i, "工作中"));
    }

    function translateWorkingStatusContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.getAttribute('data-testid') === 'agent-loading') return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const translated = getWorkingStatusTranslation(original);
        if (!translated || norm(original) === translated) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getWorkingStatusTranslation(child.textContent || '');
        })) return false;

        const workingIndex = textNodes.findIndex(textNode => /Working|处理中|工作中/i.test(textNode.nodeValue || ''));
        if (workingIndex < 0) return false;
        for (let i = 0; i < textNodes.length; i++) {
            replaceTextNode(textNodes[i], i === workingIndex ? translated : '');
        }
        return true;
    }

    function translateCompactCountLabelContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0) return false;
        const original = norm(textNodes.map(textNode => textNode.nodeValue || '').join(''));
        const translated = getCompactCountLabelTranslation(original);
        if (!translated || translated === original) return false;

        const isFoldButton = /^(\\+)?\\s*\\d+\\s+more\\s+lines?$/i.test(original);
        if (!isFoldButton && (isInBlockedZone(element) || textNodes.some(textNode => isInBlockedZone(textNode)))) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getCompactCountLabelTranslation(child.textContent || '');
        })) return false;

        if (textNodes.length === 1) return replaceTextNode(textNodes[0], translated);

        const countIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''));
        if (countIndex < 0) {
            const seeAllMatch = original.match(/^(?:See all|显示全部|查看全部)\\s*[（(]\\s*(\\d+)\\s*[)）]$/i);
            if (seeAllMatch) {
                replaceTextNode(textNodes[0], "显示全部 (" + seeAllMatch[1] + ")");
                for (let i = 1; i < textNodes.length; i++) {
                    replaceTextNode(textNodes[i], '');
                }
                return true;
            }
            if (/^(?:Listed|列出了)\\s*\\d+/i.test(original)) {
                const countedTaskIndex = textNodes.findIndex(textNode => {
                    return /^(\\d+)\\s*(?:tasks?|个任务\\s*s?)(?:\\s*[>v›❯〉→∨˅⌄▼▽⋁↓])?$/i.test(norm(textNode.nodeValue));
                });
                if (countedTaskIndex > 0) {
                    const countedTaskMatch = norm(textNodes[countedTaskIndex].nodeValue).match(/^(\\d+)\\s*(?:tasks?|个任务\\s*s?)(?:\\s*([>v›❯〉→∨˅⌄▼▽⋁↓]))?$/i);
                    for (let i = 0; i < countedTaskIndex; i++) {
                        replaceTextNode(textNodes[i], i === countedTaskIndex - 1 ? "列出了 " : '');
                    }
                    replaceTextNode(textNodes[countedTaskIndex], countedTaskMatch[1] + " 个任务" + (countedTaskMatch[2] ? " " + countedTaskMatch[2] : ""));
                    for (let i = countedTaskIndex + 1; i < textNodes.length; i++) {
                        const trailingArrow = norm(textNodes[i].nodeValue).match(/^[>v›❯〉→∨˅⌄▼▽⋁↓]$/);
                        replaceTextNode(textNodes[i], trailingArrow ? textNodes[i].nodeValue : '');
                    }
                    return true;
                }
            }
            return false;
        }

        const count = (textNodes[countIndex].nodeValue || '').trim();
        const translatedCountIndex = translated.indexOf(count);
        if (translatedCountIndex < 0) return false;
        const prefix = translated.slice(0, translatedCountIndex);
        let suffix = translated.slice(translatedCountIndex + count.length);
        let trailingMarker = '';
        if (textNodes.length > countIndex + 2) {
            const markerMatch = suffix.match(/^(.*?)([）>v›❯〉→∨˅⌄▼▽⋁↓])$/);
            if (markerMatch) {
                suffix = markerMatch[1];
                trailingMarker = markerMatch[2];
            }
        }

        for (let i = 0; i < countIndex; i++) {
            replaceTextNode(textNodes[i], i === countIndex - 1 ? prefix : '');
        }
        replaceTextNode(textNodes[countIndex], count);
        for (let i = countIndex + 1; i < textNodes.length; i++) {
            let value = i === countIndex + 1 ? suffix : '';
            if (trailingMarker && i === textNodes.length - 1) value = trailingMarker;
            replaceTextNode(textNodes[i], value);
        }
        return true;
    }

    function translateQuotaNoticeContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = norm(textNodes.map(textNode => textNode.nodeValue || '').join(''));
        const translated = getQuotaNoticeTranslation(original);
        if (!translated || translated === original) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getQuotaNoticeTranslation(child.textContent || '');
        })) return false;

        if (textNodes.length === 1) return replaceTextNode(textNodes[0], translated);

        const durationIndex = textNodes.findIndex(textNode => {
            return !!getQuotaDurationTranslation(textNode.nodeValue || '');
        });
        if (durationIndex < 0) return false;

        const translatedDuration = getQuotaDurationTranslation(textNodes[durationIndex].nodeValue || '');
        const translatedDurationIndex = translated.indexOf(translatedDuration);
        if (translatedDurationIndex < 0) return false;
        const prefix = translated.slice(0, translatedDurationIndex);
        const suffix = translated.slice(translatedDurationIndex + translatedDuration.length);

        for (let i = 0; i < durationIndex; i++) {
            replaceTextNode(textNodes[i], i === durationIndex - 1 ? prefix : '');
        }
        replaceTextNode(textNodes[durationIndex], translatedDuration);
        for (let i = durationIndex + 1; i < textNodes.length; i++) {
            replaceTextNode(textNodes[i], i === durationIndex + 1 ? suffix : '');
        }
        return true;
    }

    function getArchivedConversationNoticeTranslation(value) {
        const noticePattern = /^(?:View|视图|查看)\\s*(?:an\\s+archived\\s+conversation|(?:an\\s+)?个?\\s*已归档(?:的)?(?:会话|对话))\\s*(?:in|，?请前往)\\s*(?:History|历史记录)[.。]?$/i;
        return noticePattern.test(norm(value)) ? "可在“历史记录”中查看已归档的会话" : null;
    }

    function translateArchivedConversationNotice(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 7; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current) || !getArchivedConversationNoticeTranslation(current.textContent)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const historyElement = Array.from(current.querySelectorAll('*')).find(candidate => {
                return !isInBlockedZone(candidate) && /^(?:History|历史记录)[.。]?$/i.test(norm(candidate.textContent));
            });
            if (!historyElement) return false;

            const textNodes = collectTextNodes(current);
            const historyTextNodes = collectTextNodes(historyElement);
            if (textNodes.length === 0 || historyTextNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;

            const firstHistoryIndex = textNodes.indexOf(historyTextNodes[0]);
            const lastHistoryIndex = textNodes.indexOf(historyTextNodes[historyTextNodes.length - 1]);
            if (firstHistoryIndex <= 0 || lastHistoryIndex < firstHistoryIndex) return false;

            const prefixNodes = textNodes.slice(0, firstHistoryIndex);
            const suffixNodes = textNodes.slice(lastHistoryIndex + 1);
            replaceTextNode(prefixNodes[0], "可在");
            for (let i = 1; i < prefixNodes.length; i++) replaceTextNode(prefixNodes[i], '');
            replaceTextNode(historyTextNodes[0], "历史记录");
            for (let i = 1; i < historyTextNodes.length; i++) replaceTextNode(historyTextNodes[i], '');

            if (suffixNodes.length > 0) {
                replaceTextNode(suffixNodes[0], "中查看已归档的会话");
                for (let i = 1; i < suffixNodes.length; i++) replaceTextNode(suffixNodes[i], '');
            } else {
                historyElement.parentNode.insertBefore(document.createTextNode("中查看已归档的会话"), historyElement.nextSibling);
            }
            return true;
        }
        return false;
    }

    function translateInputDisabledNotice(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 7; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const rawText = norm(current.textContent);
            if (!/(?:Input disabled because|输入已禁用[，,]因为)/i.test(rawText) ||
                !/(?:does not exist|Create the folder in this|不存在.*在此)/i.test(rawText)) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            if (rawText.includes("输入已禁用，因为") && rawText.includes("中创建该文件夹")) {
                return true;
            }

            const projectElement = Array.from(current.querySelectorAll('*')).find(candidate => {
                return !isInBlockedZone(candidate) && /^(?:project|项目)[.。]?$/i.test(norm(candidate.textContent));
            });
            if (!projectElement) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const textNodes = collectTextNodes(current);
            const projectTextNodes = collectTextNodes(projectElement);
            if (textNodes.length === 0 || projectTextNodes.length === 0 || textNodes.some(tn => isInBlockedZone(tn))) {
                return false;
            }

            const firstProjectIndex = textNodes.indexOf(projectTextNodes[0]);
            const lastProjectIndex = textNodes.indexOf(projectTextNodes[projectTextNodes.length - 1]);
            if (firstProjectIndex <= 0 || lastProjectIndex < firstProjectIndex) {
                return false;
            }

            const prefixIndex = textNodes.findIndex((tn, idx) => {
                return idx < firstProjectIndex && /(?:Input disabled because|输入已禁用[，,]因为)/i.test(tn.nodeValue || '');
            });
            if (prefixIndex < 0) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            const middleNodes = [];
            for (let i = prefixIndex + 1; i < firstProjectIndex; i++) {
                const val = textNodes[i].nodeValue || '';
                if (/(?:does not exist|Create the folder in this|不存在|请在此)/i.test(val)) {
                    middleNodes.push(textNodes[i]);
                }
            }
            if (middleNodes.length === 0) {
                current = current.parentElement || (current.parentNode && current.parentNode.host);
                continue;
            }

            replaceTextNode(textNodes[prefixIndex], "输入已禁用，因为 ");

            replaceTextNode(middleNodes[0], " 不存在. 请在此");
            for (let i = 1; i < middleNodes.length; i++) {
                replaceTextNode(middleNodes[i], '');
            }

            replaceTextNode(projectTextNodes[0], "项目");
            for (let i = 1; i < projectTextNodes.length; i++) {
                replaceTextNode(projectTextNodes[i], '');
            }

            const suffixNodes = textNodes.slice(lastProjectIndex + 1);
            if (suffixNodes.length > 0) {
                replaceTextNode(suffixNodes[0], "中创建该文件夹");
                for (let i = 1; i < suffixNodes.length; i++) {
                    replaceTextNode(suffixNodes[i], '');
                }
            } else {
                const suffixNode = document.createTextNode("中创建该文件夹");
                translatedValues.set(suffixNode, "中创建该文件夹");
                projectElement.parentNode.insertBefore(suffixNode, projectElement.nextSibling);
            }
            return true;
        }
        return false;
    }

    function translateDuplicateProjectInlineWarning(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current)) {
                current = current.parentElement;
                continue;
            }

            const bounded = getBoundedTextContent(current, 16, 160);
            if (!bounded) break;
            const rawText = norm(bounded);
            if (!/(?:with the same folders? exists|A similar.*exists|已存在包含相同文件夹|已存在类似)/i.test(rawText)) {
                current = current.parentElement;
                continue;
            }

            if (rawText.includes("已存在包含相同文件夹") || rawText.includes("已存在类似")) {
                return true;
            }

            const projectBtn = Array.from(current.querySelectorAll("button")).find(btn => {
                return !isInBlockedZone(btn) && /^(?:project|项目)$/i.test(norm(btn.textContent));
            });
            if (!projectBtn) {
                current = current.parentElement;
                continue;
            }

            const prefixSpan = projectBtn.previousElementSibling;
            const suffixSpan = projectBtn.nextElementSibling;
            if (!prefixSpan || !suffixSpan) {
                current = current.parentElement;
                continue;
            }

            const prefixText = norm(prefixSpan.textContent);
            const suffixText = norm(suffixSpan.textContent);

            const isSimilar = /similar/i.test(prefixText) || (/exists/i.test(suffixText) && !/folder/i.test(suffixText));
            const isMulti = /folders/i.test(suffixText);

            const newPrefix = isSimilar
                ? "已存在类似的 "
                : (isMulti ? "已存在包含相同文件夹组合的 " : "已存在包含相同文件夹的 ");

            const prefixNodes = collectTextNodes(prefixSpan);
            if (prefixNodes.length > 0) {
                replaceTextNode(prefixNodes[0], newPrefix);
                for (let i = 1; i < prefixNodes.length; i++) replaceTextNode(prefixNodes[i], "");
            }

            const btnNodes = collectTextNodes(projectBtn);
            if (btnNodes.length > 0) {
                replaceTextNode(btnNodes[0], "项目");
                for (let i = 1; i < btnNodes.length; i++) replaceTextNode(btnNodes[i], "");
            }

            const suffixNodes = collectTextNodes(suffixSpan);
            for (let i = 0; i < suffixNodes.length; i++) {
                replaceTextNode(suffixNodes[i], "");
            }

            return true;
        }
        return false;
    }

    function translateDuplicateProjectModalNotice(element) {
        if (!element) return false;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;

        for (let depth = 0; current && depth < 5; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(current)) {
                current = current.parentElement;
                continue;
            }

            const rawText = norm(current.textContent);
            if (!/(?:already exists for this (?:folder|combination of folders)|已存在于此文件夹中|已存在于这些文件夹组合中)/i.test(rawText) ||
                !/(?:Would you like to continue using it or make a new one\\?|您是否希望继续使用该项目)/i.test(rawText)) {
                current = current.parentElement;
                continue;
            }

            let noticeContainer = current;
            if (current.querySelector("button")) {
                const candidate = Array.from(current.querySelectorAll("div, p")).find(child => {
                    if (child.querySelector("button")) return false;
                    const childText = norm(child.textContent);
                    return /(?:already exists for this (?:folder|combination of folders)|已存在于此文件夹中|已存在于这些文件夹组合中)/i.test(childText) &&
                           /(?:Would you like to continue using it or make a new one\\?|您是否希望继续使用该项目)/i.test(childText);
                });
                if (candidate) {
                    noticeContainer = candidate;
                } else {
                    current = current.parentElement;
                    continue;
                }
            }

            const noticeText = norm(noticeContainer.textContent);
            if (noticeText.includes("已存在于此文件夹中") || noticeText.includes("已存在于这些文件夹组合中")) {
                return true;
            }

            const spans = Array.from(noticeContainer.querySelectorAll("span")).filter(s => !isInBlockedZone(s));
            if (spans.length === 0) {
                current = current.parentElement;
                continue;
            }

            const nameSpan = spans[0];
            const allTextNodes = collectTextNodes(noticeContainer);
            const nameTextNodes = collectTextNodes(nameSpan);
            if (allTextNodes.length === 0 || nameTextNodes.length === 0) {
                current = current.parentElement;
                continue;
            }

            const firstNameIndex = allTextNodes.indexOf(nameTextNodes[0]);
            const lastNameIndex = allTextNodes.indexOf(nameTextNodes[nameTextNodes.length - 1]);
            if (firstNameIndex <= 0 || lastNameIndex < firstNameIndex) {
                current = current.parentElement;
                continue;
            }

            const isMulti = /combination of folders/i.test(noticeText);
            const suffixText = isMulti
                ? " 已存在于这些文件夹组合中. 您是否希望继续使用该项目或创建一个新项目?"
                : " 已存在于此文件夹中. 您是否希望继续使用该项目或创建一个新项目?";

            const beforeNodes = allTextNodes.slice(0, firstNameIndex);
            replaceTextNode(beforeNodes[0], "项目 ");
            for (let i = 1; i < beforeNodes.length; i++) {
                replaceTextNode(beforeNodes[i], "");
            }

            const afterNodes = allTextNodes.slice(lastNameIndex + 1);
            if (afterNodes.length > 0) {
                replaceTextNode(afterNodes[0], suffixText);
                for (let i = 1; i < afterNodes.length; i++) {
                    replaceTextNode(afterNodes[i], "");
                }
            }

            return true;
        }
        return false;
    }

    function translateShowMoreStatus(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const match = norm(element.textContent).match(/^Show\\s+(\\d+)\\s+more(?:\\.\\.\\.|…)?$/i);
        if (!match) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0) return false;
        replaceTextNode(textNodes[0], "显示另外 " + match[1] + " 个...");
        for (let i = 1; i < textNodes.length; i++) replaceTextNode(textNodes[i], '');
        return true;
    }

    function getBaselineQuotaRefreshTranslation(value) {
        const match = norm(value).match(/^Your plan(?:'s|’s) baseline quota will refresh on\\s+(.+?)[.。]$/i);
        if (!match) return null;

        let refreshTime = match[1].trim();
        if (/^\\d+$/.test(refreshTime)) return null;
        const strayPrefix = refreshTime.match(/^\\d+\\.\\s+(\\d{2}\\/\\d{1,2}\\/\\d{1,2}\\s+\\d{1,2}:\\d{2}:\\d{2})$/);
        if (strayPrefix) refreshTime = strayPrefix[1];

        return "您当前计划的基础配额将于 " + refreshTime + " 刷新";
    }

    function replaceTextRange(textNodes, start, end, value) {
        let offset = 0;
        let replaced = false;
        for (const textNode of textNodes) {
            const original = textNode.nodeValue || '';
            const nodeStart = offset;
            const nodeEnd = nodeStart + original.length;
            offset = nodeEnd;

            if (nodeEnd <= start || nodeStart >= end) continue;

            const before = start > nodeStart ? original.slice(0, start - nodeStart) : '';
            const after = end < nodeEnd ? original.slice(end - nodeStart) : '';
            if (!replaced) {
                replaceTextNode(textNode, before + value);
                replaced = true;
                if (after && textNode.parentNode) {
                    textNode.parentNode.insertBefore(document.createTextNode(after), textNode.nextSibling);
                }
            } else {
                if (after) {
                    translatedValues.delete(textNode);
                    textNode.nodeValue = after;
                } else {
                    replaceTextNode(textNode, '');
                }
            }
        }
        return replaced;
    }

    function translateBaselineQuotaNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (Array.from(element.children || []).some(child => /Your plan(?:'s|’s) baseline quota will refresh on/i.test(child.textContent || ''))) {
            return false;
        }
        const textNodes = collectTextNodes(element).filter(textNode => !isInBlockedZone(textNode));
        if (textNodes.length === 0) return false;

        const text = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const match = text.match(/Your plan(?:'s|’s) baseline quota will refresh on\\s+(.+?)\\.(?=\\s*(?:To continue using this model now, enable AI Credit overages\\.|You can upgrade to a Google AI Ultra plan to receive higher rate limits\\.|View plans?\\.?|$))/i);
        if (!match || typeof match.index !== 'number') return false;

        const translated = getBaselineQuotaRefreshTranslation(match[0]);
        if (!translated) return false;
        return replaceTextRange(textNodes, match.index, match.index + match[0].length, translated);
    }

    function getAgentSourceDisplayName(value) {
        const normalized = norm(value);
        if (/^browser$/i.test(normalized)) return "浏览器";
        if (/^(?:Root|Main)\\s+Agent$/i.test(normalized)) return "主智能体";
        return normalized;
    }

    function getDynamicSubagentStatusTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^Found\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "找到 " + match[1] + " 个子智能体" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Found\\s+(?:Subagents?|子智能体)$/i);
        if (match) return "已找到子智能体";

        match = normalized.match(/^Found\\s+(?:Browsers?|浏览器)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已找到浏览器" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^(?:Killed|已中止)\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已中止 " + match[1] + " 个子智能体" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Message\\s+from\\s+(?:Root\\s+Agent|主智能体)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "来自主智能体的消息" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^Error\\s+from\\s+(.+?)\\s+\\(([^()]+)\\)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "来自" + getAgentSourceDisplayName(match[1]) + "（" + match[2] + "）的错误" + (match[3] ? " " + match[3] : "");

        match = normalized.match(/^Error\\s+from\\s+\\(([^()]+)\\)(?:\\s*([>›❯〉→]))?$/i);
        if (match) {
            const displayName = getAgentSourceDisplayName(match[1]);
            const source = displayName === match[1] ? " " + match[1] + " " : displayName + "（" + match[1] + "）";
            return "来自" + source + "的错误" + (match[2] ? " " + match[2] : "");
        }

        match = normalized.match(/^Timed\\s+(\\d+)\\s+(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (match) {
            const unit = /^second/i.test(match[2]) ? "秒" : /^minute/i.test(match[2]) ? "分钟" : "小时";
            return "耗时 " + match[1] + " " + unit + (match[3] ? " " + match[3] : "");
        }

        match = normalized.match(/^Messaged\\s+Root\\s+Agent(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "已向主智能体发送消息" + (match[1] ? " " + match[1] : "");

        match = normalized.match(/^(\\d+)\\s+tasks?\\s+running,\\s*(\\d+)\\s+active\\s+goals?$/i);
        if (match) return match[1] + " 个任务正在运行，" + match[2] + " 个活跃目标";

        match = normalized.match(/^(\\d+)\\s+subagents?\\s*\\/\\s*tasks?\\s+running$/i);
        if (match) return match[1] + " 个子智能体/任务正在运行";

        match = normalized.match(/^(\\d+)\\s+active\\s+goals?$/i);
        if (match) return match[1] + " 个活跃目标";

        match = normalized.match(/^Goals?\\s+(\\d+)$/i);
        if (match) return "目标 " + match[1];

        match = normalized.match(/^(\\d+)\\s+(?:Side\\s+Questions?|个?侧边提问)(?:\\s*([>›❯〉→]))?$/i);
        if (match) return match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^(\\d+)\\s+questions?$/i);
        if (match) return match[1] + " 个问题";

        match = normalized.match(/^View\\s+(\\d+)\\s+side\\s+questions?(?:\\s*([>›❯〉→]))?$/i);
        if (match) return "查看 " + match[1] + " 个侧边提问" + (match[2] ? " " + match[2] : "");

        match = normalized.match(/^Question\\s+(\\d+)\\s+of\\s+(\\d+)$/i);
        if (match) return "第 " + match[1] + " 个问题，共 " + match[2] + " 个";

        match = normalized.match(/^Side\\s+question\\s+failed:\\s*(.+)$/i);
        if (match) return "侧边提问失败：" + match[1];

        match = normalized.match(/^Side\\s+question\\s+answered\\.?$/i);
        if (match) return "侧边提问已回答";

        match = normalized.match(/^Asked\\s+(\\d+)\\s+questions?$/i);
        if (match) return "已询问 " + match[1] + " 个问题";

        match = normalized.match(/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i);
        if (match) {
            const stateMap = {
                running: "正在运行",
                blocked: "已阻塞",
                completed: "已完成",
                failed: "已失败"
            };
            return match[1] + " 个子智能体" + stateMap[match[2].toLowerCase()];
        }
        return null;
    }

    function getBracketedTaskStatusTranslation(value) {
        const normalized = norm(value);
        const match = normalized.match(/^\\[(Completed|Blocked|Running|Failed|Stopped|In Progress|Cancelled|Canceled)\\](?:\\s+(.+))?$/i);
        if (!match) return null;

        const sourceStatus = match[1];
        const translatedStatus = map.get(sourceStatus)
            || lowerMap.get(sourceStatus.toLowerCase());
        if (!translatedStatus) return null;
        return "[" + translatedStatus + "]" + (match[2] ? " " + match[2] : "");
    }

    
    function getBulletedStatusTranslation(value) {
        if (!value) return null;
        const normalized = norm(value);
        const match = normalized.match(/^([●•·◦∙○]|\\u2022|\\u25CF|\\u25CB)\\s*(Running|Completed|Failed|Stopped|In Progress|Cancelled|Canceled|Scheduled|Pending|Paused|Idle|Blocked)\\b/i);
        if (!match) return null;
        const statusKey = match[2];
        const translatedStatus = map.get(statusKey) || lowerMap.get(statusKey.toLowerCase());
        if (!translatedStatus) return null;
        return match[1] + " " + translatedStatus;
    }

function getDynamicProductUiTranslation(value, node = null) {
        const normalized = norm(value);
        let match = normalized.match(/^Hi\\s+(.+?),\\s+what can we get done today\\?$/i);
        if (match) return "嗨 " + match[1] + "，今天我们可以完成些什么？";

        match = normalized.match(/^Your\\s+Plan:\\s*(.+)$/i);
        if (match && match[1].length <= 80) return "您的计划: " + match[1];

        match = normalized.match(/^Your\\s+(.+?)\\s+setting$/i);
        if (match && match[1].length <= 60 && !/[.,?!]/.test(match[1]) && (!node || !isContentBodyContainer(node))) {
            const rawScope = norm(match[1]);
            const dictScope = map.get(rawScope) || lowerMap.get(rawScope.toLowerCase());
            if (dictScope || /^[A-Z0-9]/.test(rawScope)) {
                const scopeTrans = dictScope || rawScope;
                if (/^[\\u4e00-\\u9fff]/.test(scopeTrans) && /[\\u4e00-\\u9fff]$/.test(scopeTrans)) {
                    return "您的" + scopeTrans + "设置";
                }
                return "您的 " + scopeTrans + " 设置";
            }
        }

        match = normalized.match(/^(Weekly|5-hour|Five Hour|5h)\\s+limit,\\s*(resets|refreshes)\\s+in\\s+(.+?)(?:(\\.))?$/i);
        if (match) {
            const isWeekly = /^weekly$/i.test(match[1]);
            const limitLabel = isWeekly ? "每周配额限制" : "5 小时配额限制";
            const actionLabel = /^refreshes$/i.test(match[2]) ? "刷新" : "重置";
            const rest = norm(match[3]);
            const suffixDot = match[4] ? "." : "";
            if (/^<\\s*1\\s*m(?:in(?:ute)?)?$/i.test(rest) || /^less\\s+than\\s+(?:a|1)\\s+minute$/i.test(rest)) {
                return limitLabel + "，不足 1 分钟后" + actionLabel + suffixDot;
            }
            const durMatch = rest.match(/^(?:(\\d+)\\s*(?:d|days?))?\\s*,?\\s*(?:(\\d+)\\s*(?:h|hours?))?\\s*,?\\s*(?:(\\d+)\\s*(?:m|mins?|minutes?))?\\s*,?\\s*(?:(\\d+)\\s*(?:s|secs?|seconds?))?$/i);
            if (durMatch && (durMatch[1] || durMatch[2] || durMatch[3] || durMatch[4])) {
                const parts = [];
                if (durMatch[1]) parts.push(durMatch[1] + " 天");
                if (durMatch[2]) parts.push(durMatch[2] + " 小时");
                if (durMatch[3]) parts.push(durMatch[3] + " 分钟");
                if (durMatch[4]) parts.push(durMatch[4] + " 秒");
                return limitLabel + "，" + parts.join(" ") + "后" + actionLabel + suffixDot;
            }
            return limitLabel + "，" + rest + " 后" + actionLabel + suffixDot;
        }

        match = normalized.match(/^Back\\s+to\\s+(.+)$/i);
        if (match && (!node || !isContentBodyContainer(node))) {
            const rawTarget = norm(match[1]);
            if (rawTarget && rawTarget.length <= 120) {
                const targetTrans = map.get(rawTarget) || lowerMap.get(rawTarget.toLowerCase()) || rawTarget;
                if (/^(?:Automations|History|Chat|Settings|Home)$/i.test(rawTarget) && /^[\\u4e00-\\u9fff]+$/.test(targetTrans)) {
                    return "返回" + targetTrans;
                }
                return "返回 " + targetTrans;
            }
        }

        match = normalized.match(/^(\\d+)\\s+on for this conversation$/i);
        if (match) return match[1] + " 个已为此会话开启";

        match = normalized.match(/^(\\d+)\\s+tools?$/i);
        if (match) return match[1] + " 个工具";

        match = normalized.match(/^(\\d+)\\s+Comments?$/i);
        if (match) return match[1] + " 条评论";

        if (/^No automations yet$/i.test(normalized)) return "暂无自动化任务";
        if (/^No runs yet$/i.test(normalized)) return "暂无运行记录";
        if (/^Runs$/i.test(normalized)) return "运行记录";
        if (/^Next\\s+run$/i.test(normalized)) return "下次运行";
        if (/^Last\\s+run$/i.test(normalized)) return "上次运行";
        if (/^Stop Editing$/i.test(normalized)) return "停止编辑";
        if (/^Reset\\s+to\\s+Defaults?$/i.test(normalized)) return "重置为默认值";
        if (/^Reset\\s+All\\s+to\\s+Defaults?$/i.test(normalized)) return "全部重置为默认值";
        if (/^Open\\s+In$/i.test(normalized)) return "打开方式";
        if (/^Open\\s+in$/i.test(normalized)) return "打开方式";
        if (/^Change(?:\.\.\.|…)$/i.test(normalized)) return "更改...";
        if (/^Press keys(?:\.\.\.|…)$/i.test(normalized)) return "按下按键...";
        if (/^Search Projects(?:\.\.\.|…)$/i.test(normalized)) return "搜索项目...";
        if (/^Search or enter a URL(?:\.\.\.|…)?$/i.test(normalized)) {
            return (normalized.includes("...") || normalized.includes("…")) ? "搜索或输入网址..." : "搜索或输入网址";
        }

        match = normalized.match(/^Use\\s+([A-Z][a-z]+)$/i);
        if (match) return "使用 " + match[1];

        match = normalized.match(/^Voice\\s+speed,\\s*([0-9.]+x)$/i);
        if (match) return "语速，" + match[1];

        match = normalized.match(/^Started\\s+voice\\s+chat\\s*[·•]\\s*(.+)$/i);
        if (match) return "已开始语音会话 · " + match[1];

        match = normalized.match(/^Stopped\\s+voice\\s+chat\\s*[·•]\\s*(.+)$/i);
        if (match) {
            let dur = match[1]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return "已结束语音会话 · " + dur;
        }

        match = normalized.match(/^Voice\\s+chat\\s*[·•]\\s*(.+?)(?:\\s*[·•]\\s*(.+))?$/i);
        if (match) {
            const formatDur = (s) => s
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            if (match[2]) {
                return "语音会话 · " + match[1] + " · " + formatDur(match[2]);
            }
            if (/\\d+\\s*[hms]/i.test(match[1])) {
                return "语音会话 · " + formatDur(match[1]);
            }
            return "语音会话 · " + match[1];
        }

        match = normalized.match(/^[·•]\\s*(\\d{1,2}:\\d{2})\\s*[·•]\\s*(.+)$/);
        if (match) {
            const dur = match[2]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return " · " + match[1] + " · " + dur;
        }

        match = normalized.match(/^[·•]\\s*(.+)$/);
        if (match && /\\d+\\s*[hms]/i.test(match[1])) {
            const dur = match[1]
                .replace(/(\\d+)\\s*h(?:ours?)?/gi, (m, n) => n + " 小时 ")
                .replace(/(\\d+)\\s*m(?:in(?:ute)?s?)?(?![a-z])/gi, (m, n) => n + " 分钟 ")
                .replace(/([\\d\\.]+)\\s*s(?:ec(?:ond)?s?)?/gi, (m, n) => n + " 秒")
                .replace(/\\s+/g, " ")
                .trim();
            return " · " + dur;
        }

        if (/^Voice\\s+chat$/i.test(normalized)) return "语音会话";
        if (/^Voice\\s+transcript$/i.test(normalized)) return "语音逐字稿";
        if (/^Voice\\s+speed$/i.test(normalized)) return "语速";
        if (/^Listening\\.\\s*Ask\\s+anything\\.$/i.test(normalized)) return "正在聆听. 请随时提问.";

        if (/^Ask\\s+anything(?:,\\s*|\\s+)@\\s*to\\s+mention(?:,\\s*|\\s+)[\\\\/]\\s*for\\s+actions$/i.test(normalized)) {
            return "提问任何问题，使用 @ 提及，/ 执行操作";
        }
        if (/^Ask\\s+anything$/i.test(normalized)) {
            return "提问任何问题";
        }

        match = normalized.match(/^E\\.g\\.\\s*(locations[\\\\/]global[\\\\/]workforcePools(?:\\.\\.\\.|…)?)$/i);
        if (match) return "例如 " + match[1];

        match = normalized.match(/^Uses\\s+your\\s+local\\s+clone,\\s*(.+)$/i);
        if (match) return "使用您的本地克隆，" + match[1];
        if (/^Uses\\s+your\\s+local\\s+clone,?$/i.test(normalized)) return "使用您的本地克隆，";

        if (/^Your\\s+Antigravity\\s+use\\s+will\\s+be\\s+associated\\s+with\\s+provided\\s+project\\.?\\s*Make\\s+sure\\s+you\\s+trust\\s+the\\s+project\\s+ID\\s+before\\s+proceeding\\.?\\s*Account\\s+activity\\s+and\\s+data\\s+may\\s+be\\s+logged\\s+by\\s+your\\s+organization\\.?$/i.test(normalized)) {
            return "您对 Antigravity 的使用将与所提供的项目相关联. 在继续之前，请确保您信任该项目 ID. 您的组织可能会记录账号活动和数据.";
        }
        if (/^Make\\s+sure\\s+you\\s+trust\\s+the\\s+project\\s+ID\\s+before\\s+proceeding\\.?\\s*Account\\s+activity\\s+and\\s+data\\s+may\\s+be\\s+logged\\s+by\\s+your\\s+organization\\.?$/i.test(normalized)) {
            return "在继续之前，请确保您信任该项目 ID. 您的组织可能会记录账号活动和数据.";
        }

        if (/^Clones\\s+this\\s+repo\\s+in\\s+a\\s+cloud\\s+environment\\.?$/i.test(normalized)) {
            return "在云环境中克隆此仓库";
        }
        if (/^Loading\\s+branches(?:\\.\\.\\.|…)?$/i.test(normalized)) {
            return "正在加载分支...";
        }
        match = normalized.match(/^Repo\\s+default(?:\\s*[（(](.+?)[)）])?$/i);
        if (match) {
            return match[1] ? "仓库默认 (" + match[1] + ")" : "仓库默认";
        }

        if (/^Avoid\\s+uploading\\s+highly\\s+sensitive\\s+data/i.test(normalized)) {
            return "请避免上传高度敏感的数据，并核实智能体采取的操作. 请确保您拥有上传的任何内容或文件（包括未成年人内容）的";
        }
        if (/^to\\s+any\\s+content\\s+or\\s+files\\s+that\\s+you\\s+upload/i.test(normalized)) {
            return ". 请勿生成侵犯他人权利的内容，包括具有欺骗性、骚扰性或有害的内容. 使用 Antigravity 时，您必须遵守 Google 的 ";
        }
        if (/^[.。]?\\s*Your\\s+use\\s+is\\s+subject\\s+to\\s+the$/i.test(normalized)) {
            return ". 您对本服务的使用受 ";
        }

        match = normalized.match(/^Manage\\s+(project|workspace)\\s+(folders|resources) and settings\\.$/i);
        if (match) {
            const scope = match[1].toLowerCase() === "project" ? "项目" : "工作区";
            const target = match[2].toLowerCase() === "resources" ? "资源" : "文件夹";
            return "管理" + scope + target + "和设置.";
        }

        match = normalized.match(/^When toggled on,\\s+(.+?)\\s+collects usage data to help Google enhance performance and features\\.$/i);
        if (match) return "启用后，" + match[1] + " 会收集使用数据，以帮助 Google 改进性能和功能";

        match = normalized.match(/^Receive product updates, tips, and promotions from Google\\s+(.+?)\\s+via email\\.$/i);
        if (match) return "通过电子邮件接收 Google " + match[1] + " 的产品更新、使用技巧和推广信息.";

        match = normalized.match(/^When toggled on,\\s+(.+?)\\s+will use your AI credits to fulfill model requests once you're out of model quota\\.\\s+\\1\\s+will always use your model quota first before using AI credits\\.$/i);
        if (match) return "启用后，当模型配额用尽时，" + match[1] + " 将使用您的 AI 额度处理模型请求. 系统会优先使用模型配额，之后才使用 AI 额度.";

        match = normalized.match(/^(.+?)\\s+Weekly Limit(:?)$/i);
        if (match) {
            const prefix = match[1].trim();
            const isYour = /^your$/i.test(prefix);
            const colon = match[2] ? ":" : "";
            return (isYour ? "您的" : prefix + " ") + "每周配额限制" + colon;
        }

        match = normalized.match(/^(.+?)\\s+Weekly Limit Remaining(:?)$/i);
        if (match) {
            const prefix = match[1].trim();
            const isYour = /^your$/i.test(prefix);
            const colon = match[2] ? ":" : "";
            return (isYour ? "您的" : prefix + " ") + "每周配额剩余" + colon;
        }

        match = normalized.match(/^(\\d+(?:\\.\\d+)?%)\\s+left$/i);
        if (match) return match[1] + " 剩余";

        match = normalized.match(/^(.+?)\\s+(?:5-Hour|Five Hour|5h)\\s+Limit(:?)$/i);
        if (match) {
            const prefix = match[1].trim();
            const isYour = /^your$/i.test(prefix);
            const colon = match[2] ? ":" : "";
            return (isYour ? "您的" : prefix + " ") + "5 小时配额限制" + colon;
        }

        match = normalized.match(/^(.+?)\\s+(?:5-Hour|Five Hour|5h)\\s+Limit Remaining(:?)$/i);
        if (match) {
            const prefix = match[1].trim();
            const isYour = /^your$/i.test(prefix);
            const colon = match[2] ? ":" : "";
            return (isYour ? "您的" : prefix + " ") + "5 小时配额剩余" + colon;
        }

        match = normalized.match(/^Build with\\s+(.+?)\\s+Plugins$/i);
        if (match) return "使用 " + match[1] + " 插件构建";

        match = normalized.match(/^Stream\\s+and\\s+control\\s+(.+?)\\s+directly\\s+in\\s+the\\s+side\\s+pane(\\.?)$/i);
        if (match && match[1].length <= 80 && !/[。，？！?!]|\\.\\s/.test(match[1]) && (!node || !isProseOrAgentMessage(node))) {
            return "直接在侧边面板中实时查看并控制 " + match[1] + (match[2] ? "." : "");
        }

        match = normalized.match(/^Plugins are packaged collections of skills and MCPs to help the Agent in\\s+(.+?)\\s+work with Google developer products\\. You can always change your choices in Settings\\.$/i);
        if (match) return "插件是打包的技能与 MCP 集合，用于帮助 " + match[1] + " 中的智能体使用 Google 开发者产品. 您随时可以在设置中更改选择.";

        match = normalized.match(/^Manage\\s+(project|workspace)\\s+folders, agent settings, and permissions\\.$/i);
        if (match) {
            const scope = match[1].toLowerCase() === "project" ? "项目" : "工作区";
            return "管理" + scope + "文件夹、智能体设置和权限.";
        }

        match = normalized.match(/^Agent settings and permissions for conversations outside of\\s+(projects|workspaces)\\.$/i);
        if (match) {
            const scope = match[1].toLowerCase() === "projects" ? "项目" : "工作区";
            return "用于不属于任何" + scope + "的会话的智能体设置和权限.";
        }

        match = normalized.match(/^File exceeds the (\\d+(?:\\.\\d+)?\\s*(?:[KMGTP]?B|bytes?))\\s+display limit(?:\\s*\\(([^)]+)\\))?\\.?$/i);
        if (match) {
            return "文件超过 " + match[1] + " 显示限制" + (match[2] ? " (" + match[2] + ")" : "");
        }

        match = normalized.match(/^Setting up WSL:\\s*(.+)$/i);
        if (match) return "正在设置 WSL: " + match[1];

        match = normalized.match(/^Deleted\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已删除“" + match[1] + "”";

        match = normalized.match(/^Enabled\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已启用“" + match[1] + "”";

        match = normalized.match(/^Disabled\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已禁用“" + match[1] + "”";

        match = normalized.match(/^Started\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已启动“" + match[1] + "”";

        match = normalized.match(/^Failed to start\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "启动“" + match[1] + "”失败";

        match = normalized.match(/^Restarted\\s+["“](.+?)["”][.。]?$/i);
        if (match) return "已重启“" + match[1] + "”";

        match = normalized.match(/^Created\\s+(automation|scheduled task)\\s+["“](.+?)["”][.。]?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            return "已创建" + entity + "“" + match[2] + "”";
        }

        match = normalized.match(/^Failed to (update|save|delete)\\s+["“](.+?)["”][.。]?$/i);
        if (match) {
            const act = match[1].toLowerCase();
            const verb = act === "update" ? "更新" : act === "save" ? "保存" : "删除";
            return verb + "“" + match[2] + "”失败";
        }

        match = normalized.match(/^(Automation|Task|Scheduled task)\\s+["“](.+?)["”]\\s+not found\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "任务";
            return "未找到" + entity + "“" + match[2] + "”";
        }

        match = normalized.match(/^Agents created by this (automation|scheduled task) run in a dedicated (project|workspace) with its own permissions\\.\\s*You can change the permissions in the \\2 settings page\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            const scope = match[2].toLowerCase() === "project" ? "项目" : "工作区";
            return "由此" + entity + "创建的智能体会在具有独立权限的专用" + scope + "中运行. 您可以在" + scope + "设置页面中更改这些权限.";
        }

        match = normalized.match(/^Marked\\s+(\\d+)\\s+conversations?\\s+as\\s+(read|unread)[.。]?$/i);
        if (match) {
            const state = match[2].toLowerCase() === "read" ? "已读" : "未读";
            return "已将 " + match[1] + " 个会话标记为" + state;
        }

        match = normalized.match(/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[.。]?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automations" ? "自动化" : "计划任务";
            const model = match[2].replace(/[.。]+$/, '').trim();
            if (model) return "所有" + entity + "均以 " + model + " 模型运行";
        }

        match = normalized.match(/^(?:A|An)\\s+(automation|scheduled task)\\s+with ID\\s+(.+?)\\s+already exists\\.?$/i);
        if (match) {
            const entity = match[1].toLowerCase() === "automation" ? "自动化" : "计划任务";
            return "ID 为 " + match[2] + " 的" + entity + "已存在";
        }

        match = normalized.match(/^Domains:\\s+(.+)$/i);
        if (match) return "域名：" + match[1];

        match = normalized.match(/^Scopes:\\s+(.+)$/i);
        if (match) return "权限范围：" + match[1];

        match = normalized.match(/^Secret for a new\\s+(.+?)\\s+account$/i);
        if (match) return "用于新 " + match[1] + " 账号的密钥";

        match = normalized.match(/^Secret for\\s+(.+)$/i);
        if (match) return "用于 " + match[1] + " 的密钥";

        match = normalized.match(/^Managed by the\\s+(.+?)\\s+automation$/i);
        if (match) return "由 " + match[1] + " 自动化管理";

        // Permission options (both pure English and half-translated recovery)
        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this project$/i);
        if (match) return match[1] ? "是，且在此项目中始终允许运行 '" + match[1] + "'" : "是，且在此项目中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+when not in a project$/i);
        if (match) return match[1] ? "是，且在不属于任何项目时始终允许运行 '" + match[1] + "'" : "是，且在不属于任何项目时始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this workspace$/i);
        if (match) return match[1] ? "是，且在此工作区中始终允许运行 '" + match[1] + "'" : "是，且在此工作区中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)(?: '(.+)')?\\s+in this conversation$/i);
        if (match) return match[1] ? "是，且在此会话中始终允许运行 '" + match[1] + "'" : "是，且在此会话中始终允许";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, and always allow|是，且始终允许)\\s*'(.+)'$/i);
        if (match) return "是，且始终允许运行 '" + match[1] + "'";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this project$/i);
        if (match) return match[1] ? "是，在此项目中为 '" + match[1] + "' 保存规则" : "是，在此项目中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+when not in a project$/i);
        if (match) return match[1] ? "是，在不属于任何项目时为 '" + match[1] + "' 保存规则" : "是，在不属于任何项目时保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this workspace$/i);
        if (match) return match[1] ? "是，在此工作区中为 '" + match[1] + "' 保存规则" : "是，在此工作区中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+in this conversation$/i);
        if (match) return match[1] ? "是，在此会话中为 '" + match[1] + "' 保存规则" : "是，在此会话中保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)(?:\\s*(?:for|用于)\\s*'(.+)')?\\s+globally$/i);
        if (match) return match[1] ? "是，全局为 '" + match[1] + "' 保存规则" : "是，全局保存规则";

        match = normalized.match(/^(?:(?:\\[\\d+\\]|\\d+[.):]?)\\s+)?(?:Yes, save rule|是，保存规则)\\s*(?:for|用于)\\s*'(.+)'$/i);
        if (match) return "是，为 '" + match[1] + "' 保存规则";

        // Permission questions
        match = normalized.match(/^(?:Save rule to always allow|保存为始终允许规则)\\s+(.+?)\\??$/i);
        if (match) {
            let act = match[1].toLowerCase();
            let actTrans = null;
            if (act === 'read access to this path') actTrans = '读取此路径';
            else if (act === 'write access to this path') actTrans = '写入此路径';
            else if (act === 'reading this url') actTrans = '读取此 URL';
            else if (act === 'executing actions on this url') actTrans = '在此 URL 上执行操作';
            else if (act === 'running this command') actTrans = '运行此命令';
            else if (act === 'running this command outside the sandbox') actTrans = '在沙箱外运行此命令';
            else if (act === 'using this mcp tool') actTrans = '使用此 MCP 工具';
            else if (act === 'a one-time administrator (uac) elevation') actTrans = '单次管理员 (UAC) 提权';
            else if (act === 'access to this resource') actTrans = '访问此资源';
            if (actTrans) {
                const separator = /[A-Za-z0-9]$/.test(actTrans) ? " 的规则？" : "的规则？";
                return "保存为始终允许" + actTrans + separator;
            }
        }

        match = normalized.match(/^Allow\\s+(.+?)\\??$/i);
        if (match) {
            let act = match[1].toLowerCase();
            let actTrans = null;
            if (act === 'read access to this path') actTrans = '读取此路径';
            else if (act === 'write access to this path') actTrans = '写入此路径';
            else if (act === 'reading this url') actTrans = '读取此 URL';
            else if (act === 'executing actions on this url') actTrans = '在此 URL 上执行操作';
            else if (act === 'running this command') actTrans = '运行此命令';
            else if (act === 'running this command outside the sandbox') actTrans = '在沙箱外运行此命令';
            else if (act === 'using this mcp tool') actTrans = '使用此 MCP 工具';
            else if (act === 'a one-time administrator (uac) elevation') actTrans = '单次管理员 (UAC) 提权';
            else if (act === 'access to this resource') actTrans = '访问此资源';
            if (actTrans) return "是否允许" + actTrans + "？";
        }

        return null;
    }

    function getProjectConversationCountTranslation(value) {
        const normalized = norm(value);
        let match = normalized.match(/^(\\d+)\\s+(?:active conversations?|个活跃会话)(?:\\s*(?:and|及)\\s*(\\d+)\\s+(?:archived conversations?|个已归档会话))?$/i);
        if (match) {
            let result = match[1] + " 个活跃会话";
            if (match[2]) result += "及 " + match[2] + " 个已归档会话";
            return result;
        }

        match = normalized.match(/^(\\d+)\\s+(?:archived conversations?|个已归档会话)$/i);
        return match ? match[1] + " 个已归档会话" : null;
    }

    function getProjectDeleteSummaryTranslation(value) {
        const normalized = norm(value);
        const match = normalized.match(/^(?:Permanently delete|永久删除)\\s+(.{1,200}?)\\s*(?:including|，?包含)\\s+((?:\\d+\\s+(?:active conversations?|个活跃会话)(?:\\s*(?:and|及)\\s*\\d+\\s+(?:archived conversations?|个已归档会话))?)|(?:\\d+\\s+(?:archived conversations?|个已归档会话)))[.。]?$/i);
        if (!match) return null;

        const countTranslation = getProjectConversationCountTranslation(match[2]);
        return countTranslation ? "永久删除 " + match[1] + "，包含 " + countTranslation : null;
    }

    function translateProjectDeleteSummary(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE &&
                current.tagName?.toUpperCase() === 'SPAN' &&
                !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                const wholeTranslation = getProjectDeleteSummaryTranslation(
                    textNodes.map(textNode => textNode.nodeValue || '').join('')
                );
                if (wholeTranslation) {
                    const prefixIndex = textNodes.findIndex(textNode => /^(?:Permanently delete|永久删除)$/i.test(norm(textNode.nodeValue)));
                    const includingIndex = textNodes.findIndex((textNode, index) => {
                        return index > prefixIndex && /^(?:including|，?包含)$/i.test(norm(textNode.nodeValue));
                    });
                    const countIndex = textNodes.findIndex((textNode, index) => {
                        return index > includingIndex && !!getProjectConversationCountTranslation(textNode.nodeValue);
                    });
                    if (prefixIndex < 0 || includingIndex < 0 || countIndex < 0) return false;

                    const hasProjectName = textNodes.slice(prefixIndex + 1, includingIndex)
                        .some(textNode => norm(textNode.nodeValue));
                    if (!hasProjectName) return false;

                    replaceTextNode(textNodes[prefixIndex], "永久删除");
                    replaceTextNode(textNodes[includingIndex], "，包含 ");
                    replaceTextNode(textNodes[countIndex], getProjectConversationCountTranslation(textNodes[countIndex].nodeValue));

                    const punctuationNode = textNodes.slice(countIndex + 1)
                        .find(textNode => /^[.。]$/.test(norm(textNode.nodeValue)));
                    if (punctuationNode) replaceTextNode(punctuationNode, "");
                    return true;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translatePermanentlyDeleteNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                if (textNodes.length > 0) {
                    const rawText = textNodes.map(tn => tn.nodeValue || '').join('');
                    const normalized = norm(rawText);

                    const activeAndArchivedMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:and|及)\\s*(\\d+)\\s+(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const activeOnlyMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:within it[.。]?)?$/i);
                    const archivedOnlyMatch = normalized.match(/^(?:This will permanently delete|这将永久删除)\\s+(\\d+)\\s+(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);

                    if (activeAndArchivedMatch) {
                        const activeCount = activeAndArchivedMatch[1];
                        const archivedCount = activeAndArchivedMatch[2];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + activeCount + " 个活跃会话及 " + archivedCount + " 个已归档会话");
                        }
                        const firstCountIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        const secondCountIndex = firstCountIndex >= 0
                            ? textNodes.findIndex((tn, idx) => {
                                if (idx <= firstCountIndex) return false;
                                const val = norm(tn.nodeValue);
                                return val === archivedCount || val.startsWith(archivedCount + " ");
                            })
                            : -1;
                        if (firstCountIndex >= 0 && secondCountIndex > firstCountIndex) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < firstCountIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const firstIsIsolated = norm(textNodes[firstCountIndex].nodeValue) === activeCount;
                            if (firstIsIsolated) {
                                changed = replaceTextNode(textNodes[firstCountIndex + 1], " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 2; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            } else {
                                changed = replaceTextNode(textNodes[firstCountIndex], activeCount + " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 1; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            const secondIsIsolated = norm(textNodes[secondCountIndex].nodeValue) === archivedCount;
                            if (secondIsIsolated) {
                                if (secondCountIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[secondCountIndex + 1], " 个已归档会话") || changed;
                                    for (let i = secondCountIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[secondCountIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = secondCountIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (activeOnlyMatch) {
                        const activeCount = activeOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + activeCount + " 个活跃会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === activeCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个活跃会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], activeCount + " 个活跃会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (archivedOnlyMatch) {
                        const archivedCount = archivedOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将永久删除 " + archivedCount + " 个已归档会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === archivedCount || val.startsWith(archivedCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将永久删除 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === archivedCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个已归档会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    }
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translateArchiveNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const textNodes = collectTextNodes(current).filter(textNode => !isInBlockedZone(textNode));
                if (textNodes.length > 0) {
                    const rawText = textNodes.map(tn => tn.nodeValue || '').join('');
                    const normalized = norm(rawText);

                    const activeAndArchivedMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:and|及)\\s*(\\d+)\\s*(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const activeOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:active (?:conversations?|chats?)|个活跃会话)\\s*(?:within it[.。]?)?$/i);
                    const archivedOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:archived (?:conversations?|chats?)|个已归档会话)\\s*(?:within it[.。]?)?$/i);
                    const countOnlyMatch = normalized.match(/^(?:This will archive|这将归档)\\s+(\\d+)\\s*(?:conversations?|chats?|会话s?|个会话)\\s*(?:within it[.。]?)?$/i);

                    if (activeAndArchivedMatch) {
                        const activeCount = activeAndArchivedMatch[1];
                        const archivedCount = activeAndArchivedMatch[2];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + activeCount + " 个活跃会话及 " + archivedCount + " 个已归档会话");
                        }
                        const firstCountIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        const secondCountIndex = firstCountIndex >= 0
                            ? textNodes.findIndex((tn, idx) => {
                                if (idx <= firstCountIndex) return false;
                                const val = norm(tn.nodeValue);
                                return val === archivedCount || val.startsWith(archivedCount + " ");
                            })
                            : -1;
                        if (firstCountIndex >= 0 && secondCountIndex > firstCountIndex) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < firstCountIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const firstIsIsolated = norm(textNodes[firstCountIndex].nodeValue) === activeCount;
                            if (firstIsIsolated) {
                                changed = replaceTextNode(textNodes[firstCountIndex + 1], " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 2; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            } else {
                                changed = replaceTextNode(textNodes[firstCountIndex], activeCount + " 个活跃会话及 ") || changed;
                                for (let i = firstCountIndex + 1; i < secondCountIndex; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            const secondIsIsolated = norm(textNodes[secondCountIndex].nodeValue) === archivedCount;
                            if (secondIsIsolated) {
                                if (secondCountIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[secondCountIndex + 1], " 个已归档会话") || changed;
                                    for (let i = secondCountIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[secondCountIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = secondCountIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (activeOnlyMatch) {
                        const activeCount = activeOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + activeCount + " 个活跃会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === activeCount || val.startsWith(activeCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === activeCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个活跃会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], activeCount + " 个活跃会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (archivedOnlyMatch) {
                        const archivedCount = archivedOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + archivedCount + " 个已归档会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === archivedCount || val.startsWith(archivedCount + " ");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const isIsolated = norm(textNodes[countIndex].nodeValue) === archivedCount;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个已归档会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], archivedCount + " 个已归档会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    } else if (countOnlyMatch) {
                        const count = countOnlyMatch[1];
                        if (textNodes.length === 1) {
                            return replaceTextNode(textNodes[0], "这将归档其中的 " + count + " 个会话");
                        }
                        const countIndex = textNodes.findIndex(tn => {
                            const val = norm(tn.nodeValue);
                            return val === count || val.startsWith(count + " ") || val.startsWith(count + "会话");
                        });
                        if (countIndex >= 0) {
                            let changed = replaceTextNode(textNodes[0], "这将归档其中的 ");
                            for (let i = 1; i < countIndex; i++) {
                                changed = replaceTextNode(textNodes[i], "") || changed;
                            }
                            const countNodeVal = norm(textNodes[countIndex].nodeValue);
                            const isIsolated = countNodeVal === count;
                            if (isIsolated) {
                                if (countIndex + 1 < textNodes.length) {
                                    changed = replaceTextNode(textNodes[countIndex + 1], " 个会话") || changed;
                                    for (let i = countIndex + 2; i < textNodes.length; i++) {
                                        changed = replaceTextNode(textNodes[i], "") || changed;
                                    }
                                }
                            } else {
                                changed = replaceTextNode(textNodes[countIndex], count + " 个会话") || changed;
                                for (let i = countIndex + 1; i < textNodes.length; i++) {
                                    changed = replaceTextNode(textNodes[i], "") || changed;
                                }
                            }
                            return changed;
                        }
                    }
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translateLegalHelpNotice(element) {
        if (!element) return false;

        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                const cText = getBoundedTextContent(current, 24, 320);
                if (cText === null) break;
                if (cText.length <= 300 &&
                    /(?:Visit|访问)\\s*(?:Legal Help|法律帮助)/i.test(cText) &&
                    /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(cText)) {
                    const textNodes = collectTextNodes(current).filter(tn => !isInBlockedZone(tn));
                    if (textNodes.length === 0) return false;

                    let changed = false;
                    for (let i = 0; i < textNodes.length; i++) {
                        const tn = textNodes[i];
                        const val = tn.nodeValue || '';
                        const valN = norm(val);

                        if (/^Visit$/i.test(valN)) {
                            changed = replaceTextNode(tn, "若出于法律原因需要申请更改内容，请访问 ") || changed;
                        } else if (/^Legal Help$/i.test(valN)) {
                            changed = replaceTextNode(tn, "法律帮助") || changed;
                        } else if (/^to ask for content changes for legal reasons[.。]?$/i.test(valN)) {
                            changed = replaceTextNode(tn, " 页面") || changed;
                        } else if (/^Visit Legal Help to ask for content changes for legal reasons[.。]?$/i.test(valN)) {
                            changed = replaceTextNode(tn, "若出于法律原因需要申请更改内容，请访问法律帮助页面") || changed;
                        }
                    }
                    if (changed) return true;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }
        return false;
    }

    function translatePlanCommandAlert(element) {
        if (!element) return false;

        let alertContainer = null;
        let current = element.nodeType === Node.TEXT_NODE ? element.parentElement : element;
        for (let depth = 0; current && depth < 6; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE && !isInBlockedZone(current)) {
                if (current.getAttribute?.('data-testid') === 'plan-command-fyi-alert') {
                    alertContainer = current;
                    break;
                }
                const cText = getBoundedTextContent(current, 24, 260);
                if (cText === null) break;
                if (cText.length <= 250 &&
                    /(?:Type|类型|键入)\\s*\\/\\s*(?:and\\s+select|并选择)\\s*plan/i.test(cText) &&
                    /(?:to have the agent generate a plan|让智能体生成计划)/i.test(cText)) {
                    alertContainer = current;
                    break;
                }
            }
            current = current.parentElement || (current.parentNode && current.parentNode.host);
        }

        if (!alertContainer) return false;

        const span = alertContainer.querySelector('span') || alertContainer;
        const allTextNodes = collectTextNodes(span);
        if (allTextNodes.length === 0) return false;

        let idxSlash = -1;
        let idxPlan = -1;
        for (let i = 0; i < allTextNodes.length; i++) {
            const tn = allTextNodes[i];
            const parentTag = tn.parentElement?.tagName?.toUpperCase();
            const val = (tn.nodeValue || '').trim();
            if (parentTag === 'CODE' && val === '/' && idxSlash === -1) {
                idxSlash = i;
            } else if (parentTag === 'CODE' && /^plan$/i.test(val) && idxSlash !== -1 && idxPlan === -1) {
                idxPlan = i;
            }
        }

        if (idxSlash === -1 || idxPlan === -1 || idxSlash >= idxPlan) return false;

        let changed = false;

        const beforeNodes = allTextNodes.slice(0, idxSlash);
        if (beforeNodes.length > 0) {
            if (beforeNodes[0].nodeValue !== '键入 ') {
                changed = replaceTextNode(beforeNodes[0], '键入 ') || changed;
            }
            for (let i = 1; i < beforeNodes.length; i++) {
                if (beforeNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(beforeNodes[i], '') || changed;
                }
            }
        }

        const middleNodes = allTextNodes.slice(idxSlash + 1, idxPlan);
        if (middleNodes.length > 0) {
            if (middleNodes[0].nodeValue !== ' 并选择 ') {
                changed = replaceTextNode(middleNodes[0], ' 并选择 ') || changed;
            }
            for (let i = 1; i < middleNodes.length; i++) {
                if (middleNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(middleNodes[i], '') || changed;
                }
            }
        }

        const afterNodes = allTextNodes.slice(idxPlan + 1);
        if (afterNodes.length > 0) {
            if (afterNodes[0].nodeValue !== '，即可让智能体生成计划') {
                changed = replaceTextNode(afterNodes[0], '，即可让智能体生成计划') || changed;
            }
            for (let i = 1; i < afterNodes.length; i++) {
                if (afterNodes[i].nodeValue !== '') {
                    changed = replaceTextNode(afterNodes[i], '') || changed;
                }
            }
        }

        return changed;
    }

    function getCustomizationBudgetTranslation(value) {
        const match = norm(value).match(/^(\\d+(?:\\.\\d+)?)%\\s+of the customization budget is available[.。]?$/i);
        return match ? match[1] + "% 的个性化定制预算可用" : null;
    }

    function getArtifactFileCountTranslation(value) {
        const match = norm(value).match(/^Artifacts\\s*\\((\\d+)\\s+Files?\\s+for\\s+Conversation\\)$/i);
        return match ? "交付件（本会话有 " + match[1] + " 个文件）" : null;
    }

    function getCommandInputStatusTranslation(value) {
        const match = norm(value).match(/^(Rejected sending|Sent|Suggested sending|Error sending|Sending)\\s+(termination request|input)\\s+to command$/i);
        if (!match) return null;

        const item = match[2].toLowerCase() === "termination request" ? "终止请求" : "输入";
        switch (match[1].toLowerCase()) {
            case "rejected sending": return "已拒绝向命令发送" + item;
            case "sent": return "已向命令发送" + item;
            case "suggested sending": return "建议向命令发送" + item;
            case "error sending": return "向命令发送" + item + "时出错";
            case "sending": return "正在向命令发送" + item;
            default: return null;
        }
    }

    function translateDynamicSubagentStatusContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0 || textNodes.some(textNode => isInBlockedZone(textNode))) return false;
        const original = textNodes.map(textNode => textNode.nodeValue || '').join('');
        const translated = getDynamicSubagentStatusTranslation(original);
        if (!translated || norm(original) === translated) return false;

        if (Array.from(element.children || []).some(child => {
            return !!getDynamicSubagentStatusTranslation(child.textContent || '');
        })) return false;

        const killedMatch = norm(original).match(/^(?:Killed|已中止)\\s+(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (killedMatch && textNodes.length > 1) {
            const countIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''));
            if (countIndex > 0) {
                const prefixIndex = textNodes.findIndex((textNode, index) => {
                    return index < countIndex && /^(?:Killed|已中止)$/i.test(norm(textNode.nodeValue || ''));
                });
                const suffixIndex = textNodes.findIndex((textNode, index) => {
                    return index > countIndex && /^subagents?(?:\\s*[>›❯〉→])?$/i.test(norm(textNode.nodeValue || ''));
                });
                if (prefixIndex >= 0 && suffixIndex >= 0) {
                    const hasSeparateMarker = textNodes.some((textNode, index) => {
                        return index > suffixIndex && /^[>›❯〉→]$/.test(norm(textNode.nodeValue || ''));
                    });
                    for (let i = 0; i < textNodes.length; i++) {
                        const nodeText = norm(textNodes[i].nodeValue || '');
                        if (i === prefixIndex) replaceTextNode(textNodes[i], "已中止 ");
                        else if (i === countIndex) replaceTextNode(textNodes[i], killedMatch[1]);
                        else if (i === suffixIndex) replaceTextNode(textNodes[i], " 个子智能体" + (killedMatch[2] && !hasSeparateMarker ? " " + killedMatch[2] : ""));
                        else if (/^[>›❯〉→]$/.test(nodeText)) replaceTextNode(textNodes[i], " " + nodeText);
                        else replaceTextNode(textNodes[i], '');
                    }
                    return true;
                }
            }

            const countWithUnitIndex = textNodes.findIndex(textNode => /^\\s*\\d+\\s+subagents?(?:\\s*[>›❯〉→])?\\s*$/i.test(textNode.nodeValue || ''));
            if (countWithUnitIndex > 0) {
                const prefixIndex = textNodes.findIndex((textNode, index) => {
                    return index < countWithUnitIndex && /^(?:Killed|已中止)$/i.test(norm(textNode.nodeValue || ''));
                });
                if (prefixIndex >= 0) {
                    const hasSeparateMarker = textNodes.some((textNode, index) => {
                        return index > countWithUnitIndex && /^[>›❯〉→]$/.test(norm(textNode.nodeValue || ''));
                    });
                    for (let i = 0; i < textNodes.length; i++) {
                        const nodeText = norm(textNodes[i].nodeValue || '');
                        if (i === prefixIndex) replaceTextNode(textNodes[i], "已中止");
                        else if (i === countWithUnitIndex) replaceTextNode(textNodes[i], " " + killedMatch[1] + " 个子智能体" + (killedMatch[2] && !hasSeparateMarker ? " " + killedMatch[2] : ""));
                        else if (/^[>›❯〉→]$/.test(nodeText)) replaceTextNode(textNodes[i], " " + nodeText);
                        else replaceTextNode(textNodes[i], '');
                    }
                    return true;
                }
            }
        }

        const combinedRunMatch = norm(original).match(/^(\\d+)\\s+subagents?\\s*\\/\\s*tasks?\\s+running$/i);
        const countIndex = combinedRunMatch
            ? textNodes.findIndex(textNode => /^\\s*\\d+\\s*$/.test(textNode.nodeValue || ''))
            : -1;
        if (countIndex >= 0 && textNodes.length > 1) {
            const suffixIndex = textNodes.findIndex((textNode, index) => {
                return index > countIndex && norm(textNode.nodeValue || '');
            });
            if (suffixIndex >= 0) {
                for (let i = 0; i < textNodes.length; i++) {
                    if (i === countIndex) replaceTextNode(textNodes[i], combinedRunMatch[1]);
                    else if (i === suffixIndex) replaceTextNode(textNodes[i], " 个子智能体/任务正在运行");
                    else replaceTextNode(textNodes[i], '');
                }
                return true;
            }
        }

        replaceTextNode(textNodes[0], translated);
        for (let i = 1; i < textNodes.length; i++) replaceTextNode(textNodes[i], '');
        return true;
    }

    function translateBusinessSsoOrDivider(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName.toUpperCase() !== 'SPAN' || norm(element.textContent) !== 'OR') return false;

        const className = typeof element.className === 'string' ? element.className : '';
        const hasClass = (classes, classToken) => new RegExp('(?:^|\\\\s)' + classToken + '(?:\\\\s|$)').test(classes);
        if (!hasClass(className, 'uppercase') || !hasClass(className, 'select-none')) return false;

        const parent = element.parentElement;
        if (!parent) return false;
        const dividerCount = Array.from(parent.children || []).filter(sibling => {
            if (!sibling || sibling === element || sibling.tagName?.toUpperCase() !== 'DIV') return false;
            const siblingClasses = typeof sibling.className === 'string' ? sibling.className : '';
            return hasClass(siblingClasses, 'flex-1') && hasClass(siblingClasses, 'h-px');
        }).length;
        if (dividerCount !== 2) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length !== 1) return false;
        replaceTextNode(textNodes[0], '或');
        return true;
    }

    function translateSettingOverrides(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = element.textContent || '';
        if (!/(?:Modified\\s+in|Also\\s+modified\\s+in|修改于|也修改于)/i.test(rawText)) return false;

        let targetContainer = null;
        let current = element;
        for (let depth = 0; current && depth < 4; depth++) {
            if (current === document.body || current === document.documentElement) break;
            if (current.nodeType === Node.ELEMENT_NODE &&
                /(?:^|\\s)inline-block(?:\\s|$)/.test(current.className || '') &&
                /(?:Modified\\s+in|Also\\s+modified\\s+in|修改于|也修改于)/i.test(current.textContent || '')) {
                targetContainer = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (!targetContainer) {
            targetContainer = element;
        }

        const textNodes = collectTextNodes(targetContainer);
        if (textNodes.length === 0) return false;

        const prefixIndex = textNodes.findIndex(node => /^(?:Also\\s+modified|Modified)\\s+in$/i.test(norm(node.nodeValue)));
        const alreadyPrefixIndex = prefixIndex >= 0 ? prefixIndex : textNodes.findIndex(node => /^(?:也修改于|修改于)$/i.test(norm(node.nodeValue)));
        const activePrefixIndex = prefixIndex >= 0 ? prefixIndex : alreadyPrefixIndex;
        if (activePrefixIndex < 0) return false;

        let isAlso = false;
        const prefixVal = norm(textNodes[activePrefixIndex].nodeValue);
        if (/^Also/i.test(prefixVal) || /^也修改于$/i.test(prefixVal)) {
            isAlso = true;
        }

        let translated = false;
        const targetPrefix = (isAlso ? "也修改于" : "修改于") + " ";
        if (textNodes[activePrefixIndex].nodeValue !== targetPrefix) {
            replaceTextNode(textNodes[activePrefixIndex], targetPrefix);
            translated = true;
        }

        for (let i = activePrefixIndex + 1; i < textNodes.length; i++) {
            const tNode = textNodes[i];
            const val = norm(tNode.nodeValue);
            if (!val) continue;

            const countMatch = val.match(/^(\\d+)\\s*(?:projects?|个?项目|workspaces?|个?工作区)\\s*$/i);
            if (countMatch) {
                const countTrans = countMatch[1] + " 个项目";
                if (tNode.nodeValue !== countTrans) {
                    replaceTextNode(tNode, countTrans);
                    translated = true;
                }
                if (i + 1 < textNodes.length) {
                    const nextVal = norm(textNodes[i + 1].nodeValue);
                    if (/^(?:projects?|个?项目|workspaces?|个?工作区)$/i.test(nextVal)) {
                        replaceTextNode(textNodes[i + 1], '');
                        translated = true;
                    }
                }
                break;
            }

            if (/^\\d+$/.test(val) && i + 1 < textNodes.length) {
                const nextVal = norm(textNodes[i + 1].nodeValue);
                if (/^(?:projects?|个?项目|workspaces?|个?工作区)$/i.test(nextVal)) {
                    const countTrans = val + " 个项目";
                    replaceTextNode(tNode, countTrans);
                    replaceTextNode(textNodes[i + 1], '');
                    translated = true;
                    break;
                }
            }

            if (/^untitled\\s+project$/i.test(val)) {
                if (tNode.nodeValue !== '无标题项目') {
                    replaceTextNode(tNode, '无标题项目');
                    translated = true;
                }
                break;
            }

            if (/^outside\\s+of\\s+project$/i.test(val)) {
                if (tNode.nodeValue !== '项目外部') {
                    replaceTextNode(tNode, '项目外部');
                    translated = true;
                }
                break;
            }
        }

        return translated;
    }

    function translateLearnMoreAboutPresetContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = getBoundedTextContent(element, 16, 160);
        if (!rawText) return false;
        const normText = norm(rawText);
        if (!/^(?:Learn more about|了解更多关于)\\s+(?:Default|Full machine|Turbo mode|Custom|Inherit Global|默认|全机访问|极速模式|自定义|继承全局)/i.test(normText)) {
            return false;
        }

        const textNodes = collectTextNodes(element).filter(tn => !isInBlockedZone(tn));
        if (textNodes.length === 0) return false;

        const presetMap = {
            'default': '默认',
            'full machine': '全机访问',
            'turbo mode': '极速模式',
            'custom': '自定义',
            'inherit global': '继承全局'
        };

        if (textNodes.length === 1) {
            const val = norm(textNodes[0].nodeValue);
            const m = val.match(/^Learn more about\\s+(Default|Full machine|Turbo mode|Custom|Inherit Global)(.*)$/i);
            if (m) {
                const trans = presetMap[m[1].toLowerCase()] || m[1];
                const suffix = m[2] ? (' ' + m[2].trim()) : '';
                return replaceTextNode(textNodes[0], "了解更多关于 " + trans + suffix);
            }
            return false;
        }

        let changed = false;
        let prefixNode = null;
        let presetNode = null;
        let presetTrans = '';

        for (const tn of textNodes) {
            const v = norm(tn.nodeValue);
            if (/^(?:Learn more about|了解更多关于)$/i.test(v)) {
                prefixNode = tn;
            } else if (/^(?:Default|Full machine|Turbo mode|Custom|Inherit Global)$/i.test(v)) {
                presetNode = tn;
                presetTrans = presetMap[v.toLowerCase()] || v;
            } else if (/^(?:默认|全机访问|极速模式|自定义|继承全局)$/i.test(v)) {
                presetNode = tn;
                presetTrans = v;
            }
        }

        if (prefixNode) {
            if (norm(prefixNode.nodeValue) !== "了解更多关于") {
                changed = replaceTextNode(prefixNode, "了解更多关于 ") || changed;
            }
            if (presetNode && presetNode.nodeValue !== presetTrans) {
                changed = replaceTextNode(presetNode, presetTrans) || changed;
            }
            return changed;
        }

        return false;
    }

    function translateProjectPermissionsSubtitle(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName?.toUpperCase() !== 'SPAN') return false;
        const rawText = element.textContent || '';
        if (rawText.length > 360 || !/(?:Also includes|when working in this|在此(?:项目|工作区)中工作时还包括)/i.test(rawText)) return false;

        const children = Array.from(element.children || []);
        const globalPermSpan = children.find(child => {
            return child.tagName?.toUpperCase() === 'SPAN' &&
                /^(?:Global Permissions|全局权限)$/i.test(norm(child.textContent));
        });
        if (!globalPermSpan) return false;

        const strongEl = children.find(child => child.tagName?.toUpperCase() === 'STRONG');
        const learnMoreLink = children.find(child => child.tagName?.toUpperCase() === 'A');
        const scope = /\\bworkspace\\b|工作区/i.test(rawText) ? "工作区" : "项目";
        const hasAutoPrefix = !!strongEl || /(?:was created for|是为.*自动化创建的)/i.test(rawText);

        let changed = false;
        const globalPermTextNodes = collectTextNodes(globalPermSpan);
        if (globalPermTextNodes.length === 1 && norm(globalPermTextNodes[0].nodeValue) !== "全局权限") {
            changed = replaceTextNode(globalPermTextNodes[0], "全局权限") || changed;
        }
        if (learnMoreLink) {
            const linkTextNodes = collectTextNodes(learnMoreLink);
            if (linkTextNodes.length === 1 && /^Learn more$/i.test(norm(linkTextNodes[0].nodeValue))) {
                changed = replaceTextNode(linkTextNodes[0], "了解更多") || changed;
            }
        }

        const childNodes = Array.from(element.childNodes || []);
        const strongIdx = strongEl ? childNodes.indexOf(strongEl) : -1;
        const globalIdx = childNodes.indexOf(globalPermSpan);
        const linkIdx = learnMoreLink ? childNodes.indexOf(learnMoreLink) : -1;
        if (globalIdx < 0) return false;

        const setRangeText = (startIdx, endIdx, targetText) => {
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const node = childNodes[i];
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(node, val) || changed;
            }
        };

        if (strongIdx >= 0 && strongIdx < globalIdx) {
            setRangeText(0, strongIdx, "此" + scope + "是为 ");
            setRangeText(strongIdx + 1, globalIdx, " 自动化创建的. 在此" + scope + "中工作时还包括 ");
        } else {
            const prefix = hasAutoPrefix
                ? "此" + scope + "是为自动化创建的. 在此" + scope + "中工作时还包括 "
                : "在此" + scope + "中工作时还包括 ";
            setRangeText(0, globalIdx, prefix);
        }

        if (linkIdx > globalIdx) {
            setRangeText(globalIdx + 1, linkIdx, ". ");
            setRangeText(linkIdx + 1, childNodes.length, "");
        } else {
            setRangeText(globalIdx + 1, childNodes.length, "");
        }

        return changed;
    }

    function translateManagedByAutomationNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        if (element.tagName?.toUpperCase() !== 'SPAN') return false;
        const rawText = element.textContent || '';
        if (rawText.length > 320 || !/(?:is managed by the|can only be deleted by deleting that automation|自动化管理，只能通过删除该自动化来将其删除)/i.test(rawText)) return false;

        const children = Array.from(element.children || []);
        if (children.length !== 1 || children[0].tagName?.toUpperCase() !== 'STRONG') return false;
        const strongEl = children[0];
        const scope = /\\bworkspace\\b|工作区/i.test(rawText) ? "工作区" : "项目";

        const childNodes = Array.from(element.childNodes || []);
        const strongIdx = childNodes.indexOf(strongEl);
        if (strongIdx < 0) return false;

        let changed = false;
        let assignedBefore = false;
        for (let i = 0; i < strongIdx; i++) {
            const node = childNodes[i];
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const val = assignedBefore ? "" : ("此" + scope + "由 ");
            assignedBefore = true;
            changed = replaceTextNode(node, val) || changed;
        }
        let assignedAfter = false;
        for (let i = strongIdx + 1; i < childNodes.length; i++) {
            const node = childNodes[i];
            if (node.nodeType !== Node.TEXT_NODE) continue;
            const val = assignedAfter ? "" : " 自动化管理，只能通过删除该自动化来将其删除";
            assignedAfter = true;
            changed = replaceTextNode(node, val) || changed;
        }
        return changed;
    }

    function translateAutomationScheduleContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = getBoundedTextContent(element, 16, 120);
        if (!rawText) return false;
        const normText = norm(rawText);

        const pluralDayMatch = normText.match(/^(Mondays|Tuesdays|Wednesdays|Thursdays|Fridays|Saturdays|Sundays)\\s*(?:around|at|在)\\s+(.+)$/i);
        const dayMatch = normText.match(/^(?:Weekly|每周)(?:\\s+on)?\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|星期[一二三四五六日])\\s*(?:around|at|在)\\s+(.+)$/i);
        const match = normText.match(/^(Daily|Weekly|Monthly|每[天周月])\\s+(?:around|at|在)\\s+(.+)$/i);
        if (!match && !dayMatch && !pluralDayMatch) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0) return false;

        let changed = false;
        if (pluralDayMatch) {
            const pluralDayMap = {
                mondays: "星期一", tuesdays: "星期二", wednesdays: "星期三",
                thursdays: "星期四", fridays: "星期五", saturdays: "星期六", sundays: "星期日"
            };
            const chineseDay = pluralDayMap[pluralDayMatch[1].toLowerCase()] || pluralDayMatch[1];
            let clearNextWhitespace = false;
            for (const tn of textNodes) {
                if (clearNextWhitespace && tn.nodeValue && tn.nodeValue.trim() === '') {
                    changed = replaceTextNode(tn, '') || changed;
                    clearNextWhitespace = false;
                    continue;
                }
                clearNextWhitespace = false;
                const val = norm(tn.nodeValue);
                if (!val) continue;
                const fullTrans = getAutomationScheduleTranslation(val);
                if (fullTrans) {
                    changed = replaceTextNode(tn, fullTrans) || changed;
                    continue;
                }
                if (new RegExp('^' + pluralDayMatch[1] + '$', 'i').test(val)) {
                    changed = replaceTextNode(tn, "每周" + chineseDay) || changed;
                } else if (/^(?:around|at)$/i.test(val)) {
                    changed = replaceTextNode(tn, "在 ") || changed;
                    clearNextWhitespace = true;
                }
            }
            return changed;
        }
        if (dayMatch) {
            const dayMap = {
                monday: "星期一", tuesday: "星期二", wednesday: "星期三",
                thursday: "星期四", friday: "星期五", saturday: "星期六", sunday: "星期日"
            };
            const chineseDay = dayMap[dayMatch[1].toLowerCase()] || dayMatch[1];
            let clearNextWhitespace = false;
            for (const tn of textNodes) {
                if (clearNextWhitespace && tn.nodeValue && tn.nodeValue.trim() === '') {
                    changed = replaceTextNode(tn, '') || changed;
                    clearNextWhitespace = false;
                    continue;
                }
                clearNextWhitespace = false;
                const val = norm(tn.nodeValue);
                if (!val) continue;
                const fullTrans = getAutomationScheduleTranslation(val);
                if (fullTrans) {
                    changed = replaceTextNode(tn, fullTrans) || changed;
                    continue;
                }
                const combinedWeeklyMatch = val.match(/^Weekly\\s+on\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i);
                if (combinedWeeklyMatch) {
                    const cDay = dayMap[combinedWeeklyMatch[1].toLowerCase()] || combinedWeeklyMatch[1];
                    changed = replaceTextNode(tn, "每周" + cDay) || changed;
                } else if (/^(?:Weekly(?:\\s+on)?|每周)$/i.test(val)) {
                    changed = replaceTextNode(tn, "每周") || changed;
                } else if (/^on$/i.test(val)) {
                    changed = replaceTextNode(tn, "") || changed;
                    clearNextWhitespace = true;
                } else if (new RegExp('^' + dayMatch[1] + '$', 'i').test(val)) {
                    changed = replaceTextNode(tn, chineseDay) || changed;
                } else if (/^(?:around|at)$/i.test(val)) {
                    changed = replaceTextNode(tn, "在 ") || changed;
                    clearNextWhitespace = true;
                }
            }
            return changed;
        }

        if (match) {
            const freqMap = {
                daily: "每天",
                weekly: "每周",
                monthly: "每月",
                "每天": "每天",
                "每周": "每周",
                "每月": "每月"
            };
            const freq = freqMap[match[1].toLowerCase()] || match[1];
            let clearNextWhitespace = false;
            for (const tn of textNodes) {
                if (clearNextWhitespace && tn.nodeValue && tn.nodeValue.trim() === '') {
                    changed = replaceTextNode(tn, '') || changed;
                    clearNextWhitespace = false;
                    continue;
                }
                clearNextWhitespace = false;
                const val = norm(tn.nodeValue);
                if (!val) continue;
                const fullTrans = getAutomationScheduleTranslation(val);
                if (fullTrans) {
                    changed = replaceTextNode(tn, fullTrans) || changed;
                    continue;
                }
                if (/^(?:Daily|Weekly|Monthly)$/i.test(val)) {
                    changed = replaceTextNode(tn, freq) || changed;
                } else if (/^(?:around|at)$/i.test(val)) {
                    changed = replaceTextNode(tn, "在 ") || changed;
                    clearNextWhitespace = true;
                }
            }
            return changed;
        }
        return false;
    }

    function translateAutomationCustomScheduleUnit(node, valNorm) {
        if (!node) return null;
        let isOption = false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 4; depth++) {
            const role = curr.getAttribute ? curr.getAttribute('role') : null;
            const tag = curr.tagName ? curr.tagName.toUpperCase() : '';
            if (role === 'option' || role === 'combobox' || role === 'button' || tag === 'OPTION' || tag === 'BUTTON' || /(?:menuitem|dropdown|select)/i.test(curr.className || '')) {
                isOption = true;
                break;
            }
            curr = curr.parentElement;
        }
        if (!isOption) return null;

        if (/^(?:hour|hours|day|days|week|weeks|month|months)$/i.test(valNorm)) {
            const lower = valNorm.toLowerCase();
            if (lower.startsWith('hour')) return '小时';
            if (lower.startsWith('day')) return '天';
            if (lower.startsWith('week')) return '周';
            if (lower.startsWith('month')) return '月';
        }

        const ordinalMatch = valNorm.match(/^([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)$/i);
        if (ordinalMatch) {
            return ordinalMatch[1] + "日";
        }
        if (/^last(?:\\s+day)?$/i.test(valNorm)) {
            return "最后一天";
        }
        return null;
    }

    // Automation custom-schedule rows ("On [M T W T F S S] at [9:00 AM] GMT+9",
    // "Repeat every [month] on the [1st] at [9:00 AM]"). Prepositions are only
    // translated inside a bounded row that also contains a clock time and a
    // timezone / repeat label, never via the global dictionary.
    function isAutomationScheduleRow(node) {
        if (!node || isContentBodyContainer(node)) return false;
        let curr = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; curr && depth < 5; depth++) {
            if (curr === document.body || curr === document.documentElement) break;
            const text = getBoundedTextContent(curr, 160, 400);
            if (text === null) break;
            if (/\\d{1,2}:\\d{2}\\s*(?:AM|PM)/i.test(text) && /(?:GMT|UTC|Repeat every|每隔)/i.test(text)) return true;
            curr = curr.parentElement;
        }
        return false;
    }

    function getAutomationScheduleRowWordTranslation(node, valNorm) {
        if (!/^(?:On|on\\s+the|at)$/i.test(valNorm)) return null;
        if (!isAutomationScheduleRow(node)) return null;
        if (/^on\\s+the$/i.test(valNorm)) return "在";
        if (/^at$/i.test(valNorm)) return "的";
        return "星期";
    }

    function getWeekdayLetterTranslation(node, valNorm) {
        if (!node || !/^[MTWFS]$/.test(valNorm)) return null;
        let child = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        for (let depth = 0; child && depth < 3; depth++) {
            const group = child.parentElement;
            if (!group) break;
            const kids = group.children ? Array.from(group.children) : [];
            if (kids.length === 7) {
                const letters = kids.map(k => norm(getBoundedTextContent(k, 6, 4) || ''));
                const index = kids.indexOf(child);
                // Sibling buttons may already be translated, so accept either
                // the English initial or its Chinese weekday at each position.
                const matchesLayout = (en, zh) => letters.every((t, i) => t === en[i] || t === zh[i]);
                const mondayFirst = ["一", "二", "三", "四", "五", "六", "日"];
                const sundayFirst = ["日", "一", "二", "三", "四", "五", "六"];
                if (matchesLayout("MTWTFSS", mondayFirst)) return mondayFirst[index] || null;
                if (matchesLayout("SMTWTFS", sundayFirst)) return sundayFirst[index] || null;
            }
            child = group;
        }
        return null;
    }

    function translateAutomationScheduleBuilderContainer(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = getBoundedTextContent(element, 16, 200);
        if (!rawText || !/(?:Repeat every|每隔)/i.test(rawText)) return false;
        if (!/(?:hour|day|week|month|小时|天|周|月)/i.test(rawText)) return false;

        const textNodes = collectTextNodes(element);
        if (textNodes.length === 0) return false;
        let changed = false;
        for (const tn of textNodes) {
            const val = norm(tn.nodeValue);
            if (!val) continue;
            if (/^on\\s+the$/i.test(val)) {
                changed = replaceTextNode(tn, "在") || changed;
            } else if (/^at$/i.test(val)) {
                changed = replaceTextNode(tn, "的") || changed;
            } else if (/^on$/i.test(val)) {
                changed = replaceTextNode(tn, "星期") || changed;
            } else {
                const ordinalMatch = val.match(/^([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)$/i);
                if (ordinalMatch) {
                    changed = replaceTextNode(tn, ordinalMatch[1] + "日") || changed;
                }
            }
        }
        return changed;
    }

    function translateEmptyStateStatus(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const text = norm(element.textContent);
        if (/^No\\s+automations\\s+yet$/i.test(text)) {
            const textNodes = collectTextNodes(element);
            if (textNodes.length > 0) {
                replaceTextNode(textNodes[0], "暂无自动化任务");
                for (let i = 1; i < textNodes.length; i++) {
                    replaceTextNode(textNodes[i], '');
                }
                return true;
            }
        }
        if (/^No\\s+runs\\s+yet$/i.test(text)) {
            const textNodes = collectTextNodes(element);
            if (textNodes.length > 0) {
                replaceTextNode(textNodes[0], "暂无运行记录");
                for (let i = 1; i < textNodes.length; i++) {
                    replaceTextNode(textNodes[i], '');
                }
                return true;
            }
        }
        return false;
    }

    function translateSearchAndArchivedGuideNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || isInBlockedZone(element)) return false;
        const rawText = element.textContent || '';
        if (rawText.length > 260) return false;
        if (!/(?:Search conversations with|in the top left|View archived in the sidebar|使用左上角的|中查看已归档会话)/i.test(rawText)) return false;

        const childNodes = Array.from(element.childNodes || []);
        const setRangeText = (nodes, startIdx, endIdx, targetText) => {
            let changed = false;
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const node = nodes[i];
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(node, val) || changed;
            }
            return changed;
        };

        const directElementChildren = Array.from(element.children || []);
        const nonBrChildren = directElementChildren.filter(child => child.tagName?.toUpperCase() !== 'BR');
        if (nonBrChildren.length === 2 &&
            nonBrChildren[0].tagName?.toUpperCase() === 'SVG' &&
            nonBrChildren[1].tagName?.toUpperCase() === 'SVG' &&
            /(?:Search conversations with|使用左上角的)/i.test(rawText) &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText)) {
            const svg0Idx = childNodes.indexOf(nonBrChildren[0]);
            const svg1Idx = childNodes.indexOf(nonBrChildren[1]);
            if (svg0Idx < 0 || svg1Idx <= svg0Idx) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svg0Idx, "使用左上角的 ") || changed;
            const brIdx = childNodes.findIndex((node, idx) => idx > svg0Idx && idx < svg1Idx && node.nodeType === Node.ELEMENT_NODE && node.tagName?.toUpperCase() === 'BR');
            if (brIdx > svg0Idx) {
                changed = setRangeText(childNodes, svg0Idx + 1, brIdx, " 搜索会话") || changed;
                changed = setRangeText(childNodes, brIdx + 1, svg1Idx, "在侧边栏(") || changed;
            } else {
                changed = setRangeText(childNodes, svg0Idx + 1, svg1Idx, " 搜索会话. 在侧边栏(") || changed;
            }
            changed = setRangeText(childNodes, svg1Idx + 1, childNodes.length, " 菜单)中查看已归档会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SVG' &&
            /(?:Search conversations with|in the top left|使用左上角的)/i.test(rawText) &&
            !/(?:View archived|已归档会话)/i.test(rawText)) {
            const svgIdx = childNodes.indexOf(directElementChildren[0]);
            if (svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svgIdx, "使用左上角的 ") || changed;
            changed = setRangeText(childNodes, svgIdx + 1, childNodes.length, " 搜索会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SVG' &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText) &&
            !/(?:Search conversations with|in the top left|使用左上角的)/i.test(rawText)) {
            const svgIdx = childNodes.indexOf(directElementChildren[0]);
            if (svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, svgIdx, "在侧边栏（") || changed;
            changed = setRangeText(childNodes, svgIdx + 1, childNodes.length, " 菜单）中查看已归档会话") || changed;
            return changed;
        }

        if (directElementChildren.length === 1 &&
            directElementChildren[0].tagName?.toUpperCase() === 'SPAN' &&
            /(?:View archived in the sidebar|中查看已归档会话)/i.test(rawText)) {
            const innerSpan = directElementChildren[0];
            const innerChildren = Array.from(innerSpan.children || []);
            if (innerChildren.length !== 1 || innerChildren[0].tagName?.toUpperCase() !== 'SVG') return false;
            const spanIdx = childNodes.indexOf(innerSpan);
            const innerNodes = Array.from(innerSpan.childNodes || []);
            const svgIdx = innerNodes.indexOf(innerChildren[0]);
            if (spanIdx < 0 || svgIdx < 0) return false;
            let changed = false;
            changed = setRangeText(childNodes, 0, spanIdx, "在侧边栏") || changed;
            changed = setRangeText(innerNodes, 0, svgIdx, "（") || changed;
            changed = setRangeText(innerNodes, svgIdx + 1, innerNodes.length, " 菜单）") || changed;
            changed = setRangeText(childNodes, spanIdx + 1, childNodes.length, "中查看已归档会话") || changed;
            return changed;
        }

        return false;
    }

    const SKILL_PICKER_CONTAINER_REGEX = /(?:quick question without interrupting|align on a plan|team of agents to autonomously|recent successes or corrections|Boost multi-agent orchestrator|Antigravity Customization System|comprehensive guide, quick reference, and sitemap|render rich interactive HTML widgets|scheduled background automation|manage and create plugins|namespaced bundles of skills|MCP servers, skills, slash commands|other coding agents|manage Google Docs|draft, and edit docs|and write your Google Docs|schedule events, and RSVP|draft, and send emails in Gmail|Run your Gmail inbox|manage Gmail messages, drafts, labels|format spreadsheets|edit, and export presentations|upload, download, and share files|Preview & Quota Heavy\\) Run a swarm|several agents working in parallel|native-swarm worker whose brief says it is the monitor|native-swarm worker whose brief says it is the narrator|MCP Apps for Antigravity|results render as interactive UI|不中断主会话|通过访谈与我对齐|智能体团队自主应对|反思最近的成功或改进|Boost 多智能体编排器|个性化定制系统的综合指南|全面指南、快速参考和网站地图|交互式 HTML 小组件|定时后台自动化|计划后台自动化|管理和创建插件|迁移到一个新的 Antigravity 插件中|管理 Google 文档|起草和编辑文档|安排活动并回复邀请|在 Gmail 中搜索、阅读、起草并发送电子邮件|管理您的 Gmail 收件箱|管理 Gmail 邮件、草稿、标签|编写和格式化电子表格|导出演示文稿|上传、下载和共享文件|运行蜂群协作|指定为监控员的原生蜂群|指定为叙事者的原生蜂群|Antigravity 的 MCP 应用)/i;

    function translateSwarmBoardEmptyBody(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = element.tagName?.toUpperCase();
        const isEmptyBody = element.getAttribute?.('data-testid') === 'swarm-empty-body' || element.id === 'empty-body';
        if (tag !== 'P' && !isEmptyBody) return false;
        const rawText = getBoundedTextContent(element, 12, 320);
        if (!rawText) return false;
        const normalized = norm(rawText);
        let prefixTarget = null;
        if (/^Swarms\\s+started\\s+in\\s+this\\s+conversation\\s+appear\\s+here\\s+automatically,\\s+with\\s+their\\s+board,\\s+members\\s+and\\s+@mention\\s+graph\\.\\s+Start\\s+one\\s+with\\s+\\/swarm[.。]?$/i.test(normalized) ||
            /^在此会话中启动的蜂群协作会自动显示在这里/.test(normalized)) {
            prefixTarget = "在此会话中启动的蜂群协作会自动显示在这里，并展示其消息板、成员和 @提及 图谱. 请使用 ";
        } else if (/^Open\\s+this\\s+pane\\s+from\\s+a\\s+conversation\\s+to\\s+see\\s+its\\s+swarm\\.\\s+Swarms\\s+started\\s+there\\s+appear\\s+here\\s+automatically;\\s+start\\s+one\\s+with\\s+\\/swarm[.。]?$/i.test(normalized) ||
            /^请从会话中打开此窗格以查看其蜂群协作/.test(normalized)) {
            prefixTarget = "请从会话中打开此窗格以查看其蜂群协作. 在该会话中启动的蜂群会自动显示在这里; 请使用 ";
        }
        if (!prefixTarget) return false;

        const directChildren = Array.from(element.children || []);
        if (directChildren.length !== 1 || directChildren[0].tagName?.toUpperCase() !== 'CODE') return false;
        const codeEl = directChildren[0];
        if (norm(codeEl.textContent) !== '/swarm') return false;

        const childNodes = Array.from(element.childNodes || []);
        const codeIdx = childNodes.indexOf(codeEl);
        if (codeIdx < 0) return false;

        const setRangeText = (nodes, startIdx, endIdx, targetText) => {
            let changed = false;
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const n = nodes[i];
                if (n.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(n, val) || changed;
            }
            return changed;
        };

        setRangeText(childNodes, 0, codeIdx, prefixTarget);
        setRangeText(childNodes, codeIdx + 1, childNodes.length, " 启动.");
        return 'skip_children';
    }

    function isSwarmBoardDocument() {
        try {
            if (globalThis.location?.protocol !== 'plugin:') return false;
            return Boolean(
                document.getElementById('board')?.getAttribute('data-testid') === 'swarm-board' ||
                document.getElementById('empty')?.getAttribute('data-testid') === 'swarm-empty-state' ||
                document.getElementById('loading')?.getAttribute('data-testid') === 'swarm-loading' ||
                (document.getElementById('tabbtn-feed') && document.getElementById('f-agent'))
            );
        } catch (e) {
            return false;
        }
    }

    function formatSwarmDuration(raw) {
        if (!raw) return raw;
        return String(raw)
            .replace(/(\\d+)\\s*d\\b/g, '$1 天')
            .replace(/(\\d+)\\s*h\\b/g, '$1 小时')
            .replace(/(\\d+)\\s*m\\b/g, '$1 分钟')
            .replace(/(\\d+)\\s*s\\b/g, '$1 秒')
            .replace(/\\s+/g, ' ')
            .trim();
    }

    function translateSwarmBoardOverviewNotice(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (element.id !== 'ov-notice' && element.getAttribute?.('data-testid') !== 'swarm-overview-notice') return false;
        const rawText = getBoundedTextContent(element, 12, 320);
        if (!rawText) return false;
        const normalized = norm(rawText);
        if (!/^The\\s+narrator\\s+\\([^)]+\\)\\s+was\\s+stopped\\.\\s+Ask\\s+the\\s+coordinator\\s+to\\s+add\\s+a\\s+new\\s+one\\s+\\([^)]+\\)\\.?$/i.test(normalized)) {
            return false;
        }
        const directChildren = Array.from(element.children || []);
        if (directChildren.length !== 2 ||
            directChildren[0].tagName?.toUpperCase() !== 'B' ||
            directChildren[1].tagName?.toUpperCase() !== 'CODE') {
            return false;
        }
        const childNodes = Array.from(element.childNodes || []);
        const bIdx = childNodes.indexOf(directChildren[0]);
        const codeIdx = childNodes.indexOf(directChildren[1]);
        if (bIdx < 0 || codeIdx <= bIdx) return false;

        const setRangeText = (nodes, startIdx, endIdx, targetText) => {
            let changed = false;
            let assigned = false;
            for (let i = startIdx; i < endIdx; i++) {
                const n = nodes[i];
                if (n.nodeType !== Node.TEXT_NODE) continue;
                const val = assigned ? "" : targetText;
                assigned = true;
                changed = replaceTextNode(n, val) || changed;
            }
            return changed;
        };

        setRangeText(childNodes, 0, bIdx, "叙事者 (");
        setRangeText(childNodes, bIdx + 1, codeIdx, ") 已停止. 请让协调者添加新叙事者 (");
        setRangeText(childNodes, codeIdx + 1, childNodes.length, ").");
        return 'skip_children';
    }

    function translateSwarmBoardContainers(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        const emptyRes = translateSwarmBoardEmptyBody(element);
        if (emptyRes) return emptyRes;
        const noticeRes = translateSwarmBoardOverviewNotice(element);
        if (noticeRes) return noticeRes;
        return false;
    }

    function translateSwarmOverviewReason(reason) {
        if (!reason) return reason;
        const r = norm(reason);
        if (/^view\\.html\\s+is\\s+over\\s+64\\s+KB$/i.test(r)) return "view.html 超过 64 KB";
        if (/^no\\s+view\\.html\\s+yet$/i.test(r)) return "尚无 view.html";
        if (/^loading\\s+the\\s+narrator\\s+view$/i.test(r)) return "正在加载叙事者视图";
        const failMatch = r.match(/^the\\s+narrator['’]s\\s+view\\s+failed\\s+\\((.+)\\)$/i);
        if (failMatch) return "叙事者视图加载失败 (" + failMatch[1] + ")";
        return reason;
    }

    function getSwarmBoardUiTranslation(nodeOrEl, valNorm, originalVal, isAttr, attrName = '') {
        if (!valNorm) return null;
        if (isAttr) {
            const el = nodeOrEl;
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
            const elId = el.id || '';
            if (elId === 'swarm-title') return null;

            if (attrName === 'placeholder' || attrName === 'aria-placeholder' || attrName === 'data-placeholder') {
                if (elId === 'f-search' && valNorm === 'Search') return "搜索";
                if (el.classList?.contains('o2-msin') && valNorm === 'Search members') return "搜索成员";
                return null;
            }

            if (elId === 'f-search' && valNorm === 'Search posts') return "搜索消息";
            if (el.classList?.contains('o2-msin') && valNorm === 'Search members') return "搜索成员";
            if (elId === 'live') {
                if (valNorm === 'Updates automatically') return "自动更新";
                if (valNorm === 'Lost contact with the swarm sidecar; retrying') return "与蜂群 Sidecar 失去连接; 正在重试";
                return null;
            }
            if (el.classList?.contains('tabs') && attrName === 'aria-label' && valNorm === 'Swarm views') return "蜂群视图";
            if (elId === 'f-toggle') {
                if (valNorm === 'Filters') return "筛选";
                if (valNorm === 'Filters (active)') return "筛选 (已启用)";
                return null;
            }
            if (elId === 'channel-tabs' && attrName === 'aria-label' && valNorm === 'Channels') return "频道";
            if (el.classList?.contains('channel-tab') && attrName === 'title') {
                if (valNorm === 'Posts in every channel') return "所有频道中的消息";
                if (valNorm === 'main: the whole swarm reads it') return "main: 整个蜂群都会读取的频道";
                if (/\\n(?:created by |archived$)/i.test(originalVal)) {
                    const nextTip = originalVal
                        .replace(/\\ncreated by ([^\\n]+)/i, "\\n创建者: $1")
                        .replace(/\\narchived$/i, "\\n已归档");
                    return nextTip !== originalVal ? nextTip : null;
                }
                return null;
            }
            if (elId === 'f-agent') {
                if (valNorm === 'Filter by poster') return "按发送者筛选";
                if (valNorm === 'Show posts by one member') return "仅显示某位成员发送的消息";
                return null;
            }
            if (elId === 'f-mention') {
                if (valNorm === 'Filter by recipient') return "按提及对象筛选";
                if (valNorm === 'Show posts that call on one member') return "仅显示提及某位成员的消息";
                return null;
            }
            if (elId === 'f-channel') {
                if (valNorm === 'Filter by channel') return "按频道筛选";
                if (valNorm === 'Show posts in one channel') return "仅显示某个频道中的消息";
                return null;
            }
            if (el.classList?.contains('switch') && attrName === 'title') {
                if (valNorm === 'Keep the newest post in view') return "保持最新消息在视图中";
                if (valNorm === 'Hide killed and inactive members from the graph') return "在关系图中隐藏已终止和非活跃成员";
                if (valNorm === 'Draw @all as an edge to every member') return "将 @all 绘制为指向每位成员的连线";
                return null;
            }
            if (elId === 'agents' && attrName === 'aria-label' && valNorm === "Show or hide each member's posts") {
                return "显示或隐藏每位成员的消息";
            }
            if (el.classList?.contains('chip') && attrName === 'title') {
                const lines = String(originalVal || '').split('\\n');
                if (lines.length === 2 && /^(?:Hidden from the board; click to show|Click to hide from the board)$/i.test(lines[1].trim())) {
                    const m1 = lines[0].match(/^(.+?)(\\s+\\(you\\))?\\s+·\\s+([^·]+?)(?:\\s+·\\s+([^·]+?))?\\s+·\\s+(Active|Waiting|Killed)\\s+·\\s+(\\d+)\\s+posts?$/i);
                    if (m1) {
                        const roleMap = { coordinator: "协调者", worker: "工作节点", narrator: "叙事者", monitor: "监控员" };
                        const statusMap = { active: "活跃", waiting: "等待中", killed: "已终止" };
                        const roleVal = roleMap[m1[3].trim().toLowerCase()] || m1[3].trim();
                        const statusVal = statusMap[m1[5].toLowerCase()] || m1[5];
                        const line2 = /^Hidden/i.test(lines[1].trim()) ? "已从消息板隐藏; 点击显示" : "点击从消息板隐藏";
                        return m1[1] + (m1[2] ? " (你)" : "") + " · " + roleVal + (m1[4] ? " · " + m1[4] : "") + " · " + statusVal + " · " + m1[6] + " 条消息\\n" + line2;
                    }
                }
                return null;
            }
            if (el.classList?.contains('msg-channel') && attrName === 'title') {
                const chMatch = valNorm.match(/^Posted\\s+in\\s+(#\\S+);\\s+click\\s+to\\s+show\\s+only\\s+(#\\S+)$/i);
                if (chMatch) return "发布于 " + chMatch[1] + "; 点击仅显示 " + chMatch[2];
                return null;
            }
            if (el.classList?.contains('msg-author') && attrName === 'title' && valNorm === 'Not on the roster') {
                return "不在成员名单中";
            }
            if (el.classList?.contains('btn-group') && attrName === 'aria-label' && valNorm === 'Replay') return "回放";
            if (el.classList?.contains('segmented') && attrName === 'aria-label' && valNorm === 'File') return "文件";
            if (elId === 'replay-start' && valNorm === 'Jump to start') return "跳至开头";
            if (elId === 'replay-back') {
                if (valNorm === 'Previous post (←)') return "上一条消息 (←)";
                if (valNorm === 'Previous post') return "上一条消息";
                return null;
            }
            if (elId === 'replay-play') {
                if (valNorm === 'Play / pause replay (space)') return "播放 / 暂停回放 (空格)";
                if (valNorm === 'Play replay') return "播放回放";
                if (valNorm === 'Pause replay') return "暂停回放";
                return null;
            }
            if (elId === 'replay-fwd') {
                if (valNorm === 'Next post (→)') return "下一条消息 (→)";
                if (valNorm === 'Next post') return "下一条消息";
                return null;
            }
            if (elId === 'replay-slider') {
                if (valNorm === 'Replay position') return "回放进度";
                if (valNorm === 'Scrub through board posts') return "拖动查看消息板历史";
                return null;
            }
            if (elId === 'replay-live' && valNorm === 'Show everything and follow live') return "显示全部并实时跟随";
            if (elId === 'replay-timing' && valNorm === 'Replay pacing') return "回放节奏";
            if (elId === 'replay-speed' && valNorm === 'Replay speed') return "回放速度";
            if (elId === 'graph' && attrName === 'aria-label' && valNorm === 'Who @mentions whom') return "成员 @提及 关系图";
            if (elId === 'raw-copy' && valNorm === 'Copy to clipboard') return "复制到剪贴板";
            if (elId === 'ov-system' && attrName === 'aria-label' && valNorm === 'System alerts') return "系统提醒";
            if (el.getAttribute?.('data-testid') === 'swarm-overview-badge' && attrName === 'title') {
                if (valNorm === 'The narrator is updating the overview') return "叙事者正在更新概览";
                if (valNorm === 'The narrator is waiting for new board posts') return "叙事者正在等待消息板的新消息";
                if (valNorm === 'The narrator was killed; the overview no longer updates') return "叙事者已停止; 概览将不再更新";
                const failTip = valNorm.match(/^The\\s+narrator['’]s\\s+last\\s+step\\s+failed:\\s*(.+)$/i);
                if (failTip) return "叙事者上一步失败: " + failTip[1];
                return null;
            }
            if (el.getAttribute?.('data-testid') === 'swarm-overview-stale' && attrName === 'title') {
                const staleMatch = valNorm.match(/^(\\d+)\\s+posts?\\s+since\\s+the\\s+view\\s+was\\s+updated$/i);
                if (staleMatch) return "自上次视图更新以来已有 " + staleMatch[1] + " 条新消息";
                return null;
            }
            if (el.getAttribute?.('data-testid') === 'swarm-overview-freshness' && attrName === 'title') {
                const freshTip = valNorm.match(/^Narrator\\s+read\\s+up\\s+to\\s+(#\\d+)\\s+of\\s+(\\d+)$/i);
                if (freshTip) return "叙事者已读至 " + freshTip[1] + " / " + freshTip[2];
                return null;
            }
            if (el.classList?.contains('ov-iframe') && attrName === 'title' && valNorm === 'Narrator view (AI-generated)') {
                return "叙事者视图 (AI 生成)";
            }
            if (el.classList?.contains('o2-rexp') && valNorm === 'Open full timeline') return "打开完整时间线";
            if (el.classList?.contains('o2-rswipe') && valNorm === 'Compare then and now') return "对比当时与当前";
            if (el.classList?.contains('o2-rscrub') && valNorm === 'Scrub through progress') return "拖动查看进度";
            if (el.classList?.contains('o2-tprog') && attrName === 'title') {
                const pTip = valNorm.match(/^(.+?)\\s+done$/i);
                if (pTip) return pTip[1] + " 已完成";
                return null;
            }
            if (el.classList?.contains('o2-crew') && attrName === 'aria-label' && valNorm === 'Filter by worker') return "按成员筛选";
            if (el.classList?.contains('o2-m') && el.classList?.contains('all') && attrName === 'title' && valNorm === 'All workers') return "全部成员";
            if (el.getAttribute?.('data-testid') === 'swarm-member-owner' && attrName === 'title') {
                const runMatch = valNorm.match(/^Runs\\s+on\\s+(.+)$/i);
                if (runMatch) return "运行于 " + runMatch[1];
                return null;
            }
            if (el.classList?.contains('o2-tv') && attrName === 'aria-label' && valNorm === 'Progress') return "进度";
            if (el.classList?.contains('o2-tvx') && attrName === 'aria-label' && valNorm === 'Close') return "关闭";
            if (el.classList?.contains('o2-tvnav') && attrName === 'aria-label') {
                if (valNorm === 'Previous') return "上一帧";
                if (valNorm === 'Next') return "下一帧";
                return null;
            }
            if (el.classList?.contains('o2-tvstrip') && attrName === 'aria-label' && valNorm === 'Frames') return "帧列表";
            if (attrName === 'title') {
                if (valNorm === 'Active: mid-turn (thinking, running a tool, or waiting on the model)') {
                    return "活跃: 正在执行当前回合 (思考、调用工具或等待模型响应)";
                }
                if (valNorm === 'Waiting: turn ended, asleep on the board until a post wakes it') {
                    return "等待中: 回合已结束，在消息板上休眠等待新消息唤醒";
                }
                if (valNorm === 'Killed: removed from the swarm') {
                    return "已终止: 已从蜂群中移除";
                }
                if (el.classList?.contains('mention')) {
                    const mm = valNorm.match(/^(.+?)\\s*·\\s*(Active|Waiting|Killed)$/i);
                    if (mm) {
                        const statusMap = { active: "活跃", waiting: "等待中", killed: "已终止" };
                        return mm[1] + " · " + (statusMap[mm[2].toLowerCase()] || mm[2]);
                    }
                }
                if (el.classList?.contains('o2-mact') || el.classList?.contains('o2-live') ||
                    el.getAttribute?.('data-testid') === 'swarm-member-activity' ||
                    el.getAttribute?.('data-testid') === 'swarm-running-activity') {
                    const lt = String(originalVal || '').match(/^(Thinking|Latest action):\\s*([\\s\\S]+)$/i);
                    if (lt) {
                        return (lt[1].toLowerCase() === 'thinking' ? "思考中: " : "最新动作: ") + lt[2];
                    }
                }
            }
            return null;
        }

        const textNode = nodeOrEl;
        const parent = textNode ? textNode.parentElement : null;
        if (!parent) return null;
        const pTag = parent.tagName ? parent.tagName.toUpperCase() : '';
        const pcl = parent.classList;
        const pid = parent.id || '';
        const pRole = parent.getAttribute?.('role') || '';
        const pTestId = parent.getAttribute?.('data-testid') || '';

        if (pcl?.contains('o2-thn') || pcl?.contains('o2-who')) return null;

        if (pid === 'swarm-title') {
            return valNorm === 'Untitled swarm' ? "未命名蜂群" : null;
        }
        if (pcl?.contains('loading-caption') || pid === 'empty-title' || pcl?.contains('empty-hint')) {
            if (/^Looking\\s+for\\s+this\\s+conversation['’]s\\s+swarm(?:…|\\.\\.\\.)$/i.test(valNorm)) return "正在查找当前会话的蜂群协作...";
            if (valNorm === 'No swarm in this conversation') return "当前会话中暂无蜂群协作";
            if (valNorm === 'Watching for a swarm') return "正在监听蜂群动态";
            return null;
        }
        if (pid === 'live-label' || pid === 'replay-live') {
            if (valNorm === 'Live') return "实时";
            if (valNorm === 'Reconnecting') return "重连中";
            return null;
        }
        if (pRole === 'tab' && pcl?.contains('tab')) {
            if (valNorm === 'Overview') return "概览";
            if (valNorm === 'Board') return "消息板";
            if (valNorm === 'Members') return "成员";
            if (valNorm === 'Graph') return "关系图";
            if (valNorm === 'Raw') return "原始数据";
            return null;
        }
        if (pcl?.contains('channel-tab') && valNorm === 'All') {
            return "全部";
        }
        if (pTag === 'OPTION') {
            const selectId = parent.parentElement?.id || '';
            if (selectId === 'f-agent') {
                if (valNorm === 'From anyone') return "来自任何人";
                const fromMatch = valNorm.match(/^From\\s+(.+)$/i);
                if (fromMatch) return "来自 " + fromMatch[1];
                return null;
            }
            if (selectId === 'f-mention') {
                if (valNorm === 'To anyone') return "提及任何人";
                if (valNorm === 'To no one') return "未提及任何人";
                if (valNorm === 'To @all') return "提及 @all";
                const toMatch = valNorm.match(/^To\\s+(.+)$/i);
                if (toMatch) return "提及 " + toMatch[1];
                return null;
            }
            if (selectId === 'f-channel') {
                if (valNorm === 'All channels') return "全部频道";
                const arcMatch = valNorm.match(/^(#.+?)\\s+\\(archived\\)$/i);
                if (arcMatch) return arcMatch[1] + " (已归档)";
                return null;
            }
            if (selectId === 'replay-timing') {
                if (valNorm === 'Even pacing') return "匀速节奏";
                if (valNorm === 'Real-time gaps') return "真实时间间隔";
                return null;
            }
            return null;
        }
        if (parent.closest?.('label.switch')) {
            if (valNorm === 'Follow') return "跟随";
            if (valNorm === 'Hide inactive') return "隐藏非活跃";
            if (valNorm === 'Expand @all') return "展开 @all";
            return null;
        }
        if (pcl?.contains('chip-name') && parent.closest?.('#agents')) {
            const youMatch = valNorm.match(/^(.+)\\s+\\(you\\)$/i);
            if (youMatch) return youMatch[1] + " (你)";
            return null;
        }
        if (pid === 'jump-latest' && valNorm === 'Latest') return "最新消息";
        if (pcl?.contains('divider') && pTestId === 'swarm-unread-divider' && valNorm === 'New') return "新消息";
        if (pcl?.contains('msg-more')) {
            if (valNorm === 'Show more') return "显示更多";
            if (valNorm === 'Show less') return "显示更少";
            return null;
        }
        if (pcl?.contains('msg-note') && valNorm === 'not on roster') return "不在成员名单中";
        if (parent.closest?.('.feed-empty')) {
            if (valNorm === 'No posts match') return "没有匹配的消息";
            if (valNorm === 'Try a different search or member filter.') return "请尝试其他搜索关键词或成员筛选条件.";
            if (valNorm === 'Clear filters') return "清除筛选";
            if (valNorm === 'No posts yet') return "暂无消息";
            if (valNorm === 'Posts to the swarm board will appear here as members talk.') return "成员在蜂群消息板中发言后，消息将显示在这里.";
            return null;
        }
        if (pcl?.contains('legend-item')) {
            if (valNorm === '@mention, width = count') return "@提及，线宽 = 次数";
            if (valNorm === 'via @all') return "通过 @all";
            if (valNorm === 'posted with no mention') return "已发言但未提及他人";
            if (valNorm === '@all posts, drawn by Expand @all') return "@all 消息，启用“展开 @all”时绘制";
            return null;
        }
        if (pTag === 'B' && parent.parentElement?.id === 'replay-label') {
            const postCountMatch = valNorm.match(/^(\\d+)\\s+posts?$/i);
            if (postCountMatch) return postCountMatch[1] + " 条消息";
            return null;
        }
        if (pid === 'replay-label') {
            const overMatch = valNorm.match(/^over\\s+(.+)$/i);
            if (overMatch) return "共耗时 " + formatSwarmDuration(overMatch[1]);
            const ofMatch = valNorm.match(/^of\\s+(\\d+)(?:\\s+·\\s+(#\\d+)\\s+at\\s+(.+?)\\s+\\(\\+([^)]+)\\))?$/i);
            if (ofMatch) {
                return "/ " + ofMatch[1] + (ofMatch[2] ? " · " + ofMatch[2] + " 于 " + ofMatch[3] + " (+" + formatSwarmDuration(ofMatch[4]) + ")" : "");
            }
            return null;
        }
        if (pid === 'raw-copy-label') {
            if (valNorm === 'Copy') return "复制";
            if (valNorm === 'Copied') return "已复制";
            if (valNorm === 'Copy failed') return "复制失败";
            return null;
        }
        if (pcl?.contains('size') && parent.parentElement?.id === 'raw-meta') {
            const sizeMatch = valNorm.match(/^·\\s*(\\d+(?:\\.\\d+)?\\s*(?:B|KB|MB))(?:\\s*·\\s*(\\d+)\\s+lines?)?$/i);
            if (sizeMatch) return "· " + sizeMatch[1] + (sizeMatch[2] ? " · " + sizeMatch[2] + " 行" : "");
            return null;
        }
        if (pTestId === 'swarm-overview-badge') {
            if (valNorm === 'updating') return "更新中";
            if (valNorm === 'watching') return "监听中";
            if (valNorm === 'stopped') return "已停止";
            if (valNorm === 'paused: quota') return "已暂停: 配额不足";
            if (valNorm === 'paused: error') return "已暂停: 出错";
            return null;
        }
        if (pTestId === 'swarm-overview-stale' && valNorm === 'stale') return "已过期";
        if (pTestId === 'swarm-overview-freshness') {
            const fMatch = valNorm.match(/^read\\s+(#\\d+)(?:\\s*·\\s*updated\\s+(.+)\\s+ago)?$/i);
            if (fMatch) {
                return "已读至 " + fMatch[1] + (fMatch[2] ? " · " + formatSwarmDuration(fMatch[2]) + "前更新" : "");
            }
            return null;
        }
        if (pTag === 'B' && parent.parentElement?.classList?.contains('ov-sys-text') && valNorm === 'system:') {
            return "系统:";
        }
        if (parent.closest?.('.ov-sys') && pTag === 'BUTTON' && valNorm === 'Open') {
            return "打开";
        }
        if (pid === 'ov-notice' || pTestId === 'swarm-overview-notice') {
            if (valNorm === 'No narrator in this swarm. Ask the coordinator to add one.') return "当前蜂群中暂无叙事者. 请让协调者添加一位.";
            if (/^The\\s+narrator['’]s\\s+view\\.json\\s+is\\s+over\\s+64\\s+KB,\\s+so\\s+it\\s+isn['’]t\\s+shown\\.?$/i.test(valNorm)) {
                return "叙事者的 view.json 超过 64 KB，因此未予显示.";
            }
            if (/^The\\s+narrator['’]s\\s+view\\.json\\s+isn['’]t\\s+valid\\s+JSON\\s+yet\\.?$/i.test(valNorm)) {
                return "叙事者的 view.json 尚不是有效的 JSON.";
            }
            if (/^The\\s+narrator\\s+hasn['’]t\\s+published\\s+an\\s+overview\\s+yet\\.?$/i.test(valNorm)) {
                return "叙事者尚未发布概览.";
            }
            if (valNorm === 'Showing the last good view.json; the current file is over 64 KB.') {
                return "正在显示上一次有效的 view.json; 当前文件超过 64 KB.";
            }
            if (valNorm === 'Showing the last good view.json; the current file is not valid JSON.') {
                return "正在显示上一次有效的 view.json; 当前文件不是有效的 JSON.";
            }
            return null;
        }
        if (pcl?.contains('ov-label-text')) {
            const ovMatch = valNorm.match(/^overview\\s*·\\s*from\\s+the\\s+narrator['’]s\\s+notes(?:\\s*·\\s*(.+))?$/i);
            if (ovMatch) {
                return "概览 · 来自叙事者笔记" + (ovMatch[1] ? " · " + translateSwarmOverviewReason(ovMatch[1]) : "");
            }
            if (/^narrator['’]s\\s+page\\s*·\\s*AI-generated$/i.test(valNorm)) return "叙事者页面 · AI 生成";
            return null;
        }
        if (pid === 'ov-mode') {
            if (/^Narrator['’]s\\s+page$/i.test(valNorm)) return "叙事者页面";
            if (/^Retry\\s+narrator['’]s\\s+page$/i.test(valNorm)) return "重试叙事者页面";
            if (valNorm === 'Overview') return "概览";
            return null;
        }
        if (pid === 'ov-open-coord' && valNorm === 'Open coordinator chat') return "打开协调者聊天";
        if (parent.closest?.('.ov-hint') && valNorm === 'Want this view different? Tell the coordinator.') {
            return "想要调整此视图? 请告知协调者.";
        }
        if (pid === 'ov-ack' && /^Last\\s+change:/i.test(valNorm)) {
            return originalVal.replace(/^(\\s*)Last\\s+change:\\s*/i, '$1上次调整: ');
        }
        if (pTestId === 'swarm-source') {
            const rmMatch = valNorm.match(/^(.+?)\\s*·\\s*(\\d+)\\s+machines?$/i);
            if (rmMatch) return (rmMatch[1] === 'Remote' ? "远程" : rmMatch[1]) + " · " + rmMatch[2] + " 台设备";
            const stMatch = valNorm.match(/^(.+?)\\s*·\\s*(reconnecting|connecting|unavailable)$/i);
            if (stMatch) {
                const stMap = { reconnecting: "重连中", connecting: "连接中", unavailable: "不可用" };
                return (stMatch[1] === 'Remote' ? "远程" : stMatch[1]) + " · " + (stMap[stMatch[2].toLowerCase()] || stMatch[2]);
            }
            return null;
        }
        if (parent.closest?.('.o2-onb')) {
            if (valNorm === 'Your swarm is starting') return "蜂群正在启动";
            if (valNorm === 'One goal') return "同一目标";
            if (valNorm === 'The coordinator splits it into tasks.') return "协调者将其拆分为多个任务.";
            if (valNorm === 'Many workers') return "多位成员";
            if (valNorm === 'Each takes a task, and they run in parallel.') return "各自领取任务并并行推进.";
            if (valNorm === 'One board') return "同一消息板";
            if (valNorm === 'Updates land here. You step in only when asked.') return "进展统一汇总于此. 仅在需要时由您介入.";
            if (valNorm === 'Waiting for the first update') return "正在等待首条进展更新";
            return null;
        }
        if (pcl?.contains('o2-glbl') && valNorm === 'Goal') return "目标";
        if (pTag === 'B' && parent.parentElement?.classList?.contains('o2-runh') && valNorm === 'Running') return "进行中";
        if (pcl?.contains('o2-h')) {
            if (valNorm === 'The team') return "团队成员";
            if (valNorm === 'Threads') return "工作线程";
            if (valNorm === 'Blocked') return "已阻塞";
            if (valNorm === 'Running') return "进行中";
            if (valNorm === 'Planned next') return "后续计划";
            return null;
        }
        if (pcl?.contains('o2-none')) {
            if (valNorm === 'Nothing blocked') return "暂无阻塞项";
            if (valNorm === 'Nothing running') return "暂无进行中任务";
            if (valNorm === 'Nothing planned') return "暂无后续计划";
            return null;
        }
        if (pcl?.contains('o2-more')) {
            const moreMatch = valNorm.match(/^\\+(\\d+)\\s+more$/i);
            if (moreMatch) return "另外 " + moreMatch[1] + " 项";
            return null;
        }
        if (pTag === 'B' && parent.parentElement?.classList?.contains('o2-progt')) {
            const bMatch = valNorm.match(/^(\\d+)\\s+of\\s+(\\d+)$/i);
            if (bMatch) return bMatch[1] + " / " + bMatch[2];
            return null;
        }
        if (pcl?.contains('o2-progt') && /^tasks\\s+done$/i.test(valNorm)) return "项任务已完成";
        if (pcl?.contains('o2-pchip')) {
            let pm = valNorm.match(/^(\\d+)\\s+needs?\\s+you$/i);
            if (pm) return pm[1] + " 项待您确认";
            pm = valNorm.match(/^(\\d+)\\s+blocked$/i);
            if (pm) return pm[1] + " 项阻塞";
            pm = valNorm.match(/^(\\d+)\\s+threads?\\s+open$/i);
            if (pm) return pm[1] + " 个线程进行中";
            pm = valNorm.match(/^(\\d+)\\s+active$/i);
            if (pm) return pm[1] + " 项活跃";
            pm = valNorm.match(/^(\\d+)\\s+waiting\\s+on\\s+(@?\\S+)$/i);
            if (pm) return pm[1] + " 项正在等待 " + pm[2];
            pm = valNorm.match(/^(\\d+)\\s+stuck$/i);
            if (pm) return pm[1] + " 项卡住";
            return null;
        }
        if ((pcl?.contains('o2-askon') || pcl?.contains('o2-tw')) && /^Waiting\\s+on\\s+(@?\\S+)$/i.test(valNorm)) {
            return valNorm.replace(/^Waiting\\s+on\\s+/i, "正在等待 ");
        }
        if (pcl?.contains('o2-runph')) {
            const phm = valNorm.match(/^(In progress|Done)\\s*·\\s*(\\d+\\s*\\/\\s*\\d+)$/i);
            if (phm) return (phm[1].toLowerCase() === 'done' ? "已完成" : "进行中") + " · " + phm[2];
        }
        if ((pcl?.contains('o2-runsum') || (pTag === 'B' && parent.parentElement?.classList?.contains('o2-goal'))) && valNorm === 'Waiting for the first post.') {
            return "正在等待首条消息.";
        }
        if (pcl?.contains('o2-doneempty') && valNorm === 'No tasks completed yet.') return "暂未完成任何任务.";
        if (pcl?.contains('o2-qhdr')) {
            const qm = valNorm.match(/^Up\\s+next\\s*·\\s*(\\d+)$/i);
            if (qm) return "接下来 · " + qm[1];
            return null;
        }
        if (pcl?.contains('o2-tprog') && valNorm === 'In review') return "审核中";
        if (pTag === 'B' && parent.parentElement?.classList?.contains('o2-tht')) {
            const o2tHost = parent.closest?.('[data-o2t]');
            const o2tId = o2tHost ? (o2tHost.getAttribute('data-o2t') || '') : '';
            if (o2tId === 't-asks' || o2tId === 't-other') {
                if (valNorm === 'Needs you') return "需要您确认";
                if (valNorm === 'Tasks') return "任务";
                if (valNorm === 'Other') return "其他";
            }
            if (valNorm === 'Stuck') return "卡住";
            const wm = valNorm.match(/^Waiting\\s+on\\s+(@?\\S+)$/i);
            if (wm) return "正在等待 " + wm[1];
            return null;
        }
        if (pTag === 'EM' && parent.parentElement?.classList?.contains('o2-tht')) {
            if (valNorm === 'Needs you') return "需要您确认";
            if (valNorm === 'Blocked') return "已阻塞";
            if (valNorm === 'Moving') return "推进中";
            if (valNorm === 'Not started') return "未开始";
            if (valNorm === 'Done') return "已完成";
            if (valNorm === 'Waiting') return "等待中";
            let wm = valNorm.match(/^Waiting\\s+on\\s+(\\d+)$/i);
            if (wm) return "正在等待 " + wm[1] + " 位成员";
            wm = valNorm.match(/^Waiting\\s+on\\s+(@?\\S+)$/i);
            if (wm) return "正在等待 " + wm[1];
            return null;
        }
        if (pTag === 'SPAN' && parent.parentElement?.classList?.contains('o2-thn') && valNorm === 'Now') return "当前";
        if (pcl?.contains('o2-btn')) {
            if (valNorm === 'Reply') return "回复";
            if (valNorm === 'Open') return "打开";
            return null;
        }
        if (pcl?.contains('o2-rmeta') || pcl?.contains('o2-tvmeta')) {
            const rMatch = valNorm.match(/^(\\d+)\\s+of\\s+(\\d+)\\s+tasks?\\s+done$/i);
            if (rMatch) return rMatch[1] + " / " + rMatch[2] + " 项任务已完成";
            return null;
        }
        if (pcl?.contains('o2-rcmp')) {
            if (valNorm === 'Compare with now') return "与当前对比";
            if (valNorm === 'Hide compare') return "隐藏对比";
            return null;
        }
        if (pcl?.contains('o2-rtag') || pcl?.contains('o2-tvpos')) {
            if (valNorm === 'Now') return "当前";
            const npMatch = valNorm.match(/^Now\\s*·\\s*(.+)$/i);
            if (npMatch) return "当前 · " + npMatch[1];
            return null;
        }
        if (pTag === 'B' && parent.parentElement?.classList?.contains('o2-tvh') && valNorm === 'Progress') return "进度";
        if (parent.closest?.('.o2-m.all') && valNorm === 'All') return "全部";
        if (pTag === 'B' && parent.parentElement?.classList?.contains('o2-lb') && valNorm === 'Coordinator') return "协调者";
        if (pcl?.contains('o2-mstat')) {
            if (valNorm === 'Coordinator · Working') return "协调者 · 工作中";
            if (valNorm === 'Coordinator') return "协调者";
            if (valNorm === 'Working') return "工作中";
            if (valNorm === 'Needs you') return "需要您确认";
            if (valNorm === 'Retired') return "已退役";
            if (valNorm === 'Stuck') return "卡住";
            if (valNorm === 'Error') return "出错";
            const wm = valNorm.match(/^Waiting\\s+on\\s+(@?\\S+)$/i);
            if (wm) return "正在等待 " + wm[1];
            return null;
        }
        if (pcl?.contains('o2-mts')) {
            const pMatch = valNorm.match(/^(.+?·\\s*)?(\\d+)\\s+posts?$/i);
            if (pMatch) return (pMatch[1] || '') + pMatch[2] + " 条消息";
            return null;
        }
        if (pTestId === 'swarm-member-seen') {
            if (valNorm === 'seen just now') return "刚刚在线";
            const lsMatch = valNorm.match(/^last\\s+seen\\s+(.+)\\s+ago$/i);
            if (lsMatch) return "上次在线: " + formatSwarmDuration(lsMatch[1]) + "前";
            return null;
        }
        if (pTestId === 'swarm-member-channels' && valNorm === 'all channels') return "全部频道";
        if (pcl?.contains('o2-mnow')) {
            if (valNorm === 'No posts yet') return "暂无消息";
            if (valNorm === 'Waiting for your reply in chat') return "正在等待您在聊天中回复";
            return null;
        }
        if (pTag === 'SPAN' && parent.parentElement?.classList?.contains('o2-msec')) {
            if (valNorm === 'Active') return "活跃中";
            if (valNorm === 'Team') return "团队";
            if (valNorm === 'Standing by') return "待命";
            return null;
        }
        if (pTag === 'SPAN' && parent.parentElement?.classList?.contains('o2-mret') && valNorm === 'Retired') return "已退役";
        if (pid === 'toast') {
            if (valNorm === "That link isn't allowed here.") return "此处不允许打开该链接.";
            if (valNorm === 'Opening files needs the app.') return "需要通过应用打开文件.";
            if (valNorm === 'Click a link in the view to open it.') return "请点击视图中的链接以打开.";
            const cpMatch = valNorm.match(/^Copied\\s+"([^"]+)"\\.\\s+Paste\\s+it\\s+in\\s+the\\s+chat\\.$/i);
            if (cpMatch) return '已复制 "' + cpMatch[1] + '". 请在聊天中粘贴.';
            const tpMatch = valNorm.match(/^Type\\s+"([^"]+)"\\s+in\\s+the\\s+chat\\.$/i);
            if (tpMatch) return '请在聊天中输入 "' + tpMatch[1] + '".';
            const ocMatch = valNorm.match(/^Opening\\s+(.+?)['’]s\\s+conversation\\s+needs\\s+the\\s+app\\.$/i);
            if (ocMatch) return "需要通过应用打开 " + ocMatch[1] + " 的会话.";
            const rmRunMatch = valNorm.match(/^(.+?)\\s+runs\\s+on\\s+(.+?);\\s+open\\s+it\\s+there\\.$/i);
            if (rmRunMatch) return rmRunMatch[1] + " 运行在 " + rmRunMatch[2] + " 上; 请在对应设备上打开.";
            return null;
        }
        return null;
    }

    function translateSwarmBoardElementAttributes(el) {
        if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
        for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
            const v = el.getAttribute(attr);
            if (!v) continue;
            const target = getSwarmBoardUiTranslation(el, norm(v), v, true, attr);
            if (target && target !== v) {
                el.setAttribute(attr, target);
            }
        }
    }

    function translateSidePaneControlBanner(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (isInBlockedZone(element) || isProseOrAgentMessage(element)) return false;
        const rawText = getBoundedTextContent(element, 12, 180);
        if (!rawText) return false;
        const normalized = norm(rawText);
        const match = normalized.match(/^Stream\\s+and\\s+control\\s+(.+?)\\s+directly\\s+in\\s+the\\s+side\\s+pane(\\.?)$/i);
        if (!match || match[1].length > 80 || /[。，？！?!]|\\.\\s/.test(match[1])) return false;
        const suffix = match[2] ? "." : "";

        const directChildren = Array.from(element.children || []);
        if (directChildren.length === 0) {
            const textNodes = collectTextNodes(element);
            if (textNodes.length < 2) return false;
            let changed = replaceTextNode(textNodes[0], "直接在侧边面板中实时查看并控制 " + match[1] + suffix);
            for (let i = 1; i < textNodes.length; i++) {
                changed = replaceTextNode(textNodes[i], '') || changed;
            }
            return changed ? 'skip_children' : false;
        }
        if (directChildren.length === 1) {
            const childEl = directChildren[0];
            const childTag = childEl.tagName?.toUpperCase();
            if (childTag !== 'SPAN' && childTag !== 'STRONG' && childTag !== 'B' && childTag !== 'CODE') return false;
            const childText = norm(getBoundedTextContent(childEl, 6, 80) || '');
            if (!childText || childText.length > 80) return false;
            const childNodes = Array.from(element.childNodes || []);
            const elIdx = childNodes.indexOf(childEl);
            if (elIdx < 0) return false;
            const beforeText = norm(childNodes.slice(0, elIdx).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.nodeValue || '').join(''));
            const afterText = norm(childNodes.slice(elIdx + 1).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.nodeValue || '').join(''));
            if (!/^Stream\\s+and\\s+control$/i.test(beforeText)) return false;
            if (!/^directly\\s+in\\s+the\\s+side\\s+pane\\.?$/i.test(afterText)) return false;
            const dotSuffix = /\\.$/.test(afterText) ? "." : suffix;
            const setRangeText = (nodes, startIdx, endIdx, targetText) => {
                let changed = false;
                let assigned = false;
                for (let i = startIdx; i < endIdx; i++) {
                    const n = nodes[i];
                    if (n.nodeType !== Node.TEXT_NODE) continue;
                    const val = assigned ? "" : targetText;
                    assigned = true;
                    changed = replaceTextNode(n, val) || changed;
                }
                return changed;
            };
            let changed = false;
            changed = setRangeText(childNodes, 0, elIdx, "直接在侧边面板中实时查看并控制 ") || changed;
            changed = setRangeText(childNodes, elIdx + 1, childNodes.length, dotSuffix) || changed;
            return changed ? 'skip_children' : false;
        }
        return false;
    }

    function translateSpecialContainers(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
        if (!element.childNodes || element.childNodes.length === 0) return false;
        if (element.children && element.children.length > 8) return false;

        if ((!element.children || element.children.length === 0) && element.childNodes.length === 1) {
            const firstChild = element.firstChild;
            if (!firstChild || firstChild.nodeType !== Node.TEXT_NODE) return false;
            const singleVal = firstChild.nodeValue || '';
            if (singleVal.length <= 160 && isCollapsibleActivityHeader(singleVal)) {
                markThoughtContentSibling(element);
                return 'skip_children';
            }
            if (singleVal.length <= 40 && /^(\\+)?\\s*\\d+\\s+more\\s+lines?$/i.test(singleVal.trim())) {
                return translateCompactCountLabelContainer(element);
            }
            if (singleVal.length <= 8 && element.tagName?.toUpperCase() === 'SPAN' && /^OR$/i.test(singleVal.trim())) {
                if (isInBlockedZone(element)) return false;
                return translateBusinessSsoOrDivider(element);
            }
            if (element.getAttribute?.('data-testid') === 'agent-loading') {
                if (isInBlockedZone(element)) return false;
                return translateAgentLoadingStatus(element);
            }
            if (singleVal.length <= 1600 && /(?:baseline quota|基础配额)/i.test(singleVal)) {
                if (isInBlockedZone(element)) return false;
                return translateBaselineQuotaNotice(element);
            }
            return false;
        }

        const rawText = getBoundedTextContent(element, 36, 1600);
        if (rawText === null) return false;
        const textLength = rawText.length;
        if (textLength === 0) return false;
        const isFoldButton = textLength <= 40 && /^(\\+)?\\s*\\d+\\s+more\\s+lines?$/i.test(rawText);
        if (isInBlockedZone(element) && !isFoldButton) return false;

        if (textLength <= 160 && isCollapsibleActivityHeader(rawText)) {
            markThoughtContentSibling(element);
            return 'skip_children';
        }
        if (textLength <= 320 && (element.getAttribute?.('data-testid') === 'swarm-empty-body' || element.id === 'empty-body' || /(?:Swarms\\s+started\\s+in\\s+this\\s+conversation|Open\\s+this\\s+pane\\s+from\\s+a\\s+conversation)/i.test(rawText))) {
            const swarmEmptyRes = translateSwarmBoardEmptyBody(element);
            if (swarmEmptyRes) return swarmEmptyRes;
        }
        if (textLength <= 180 && /Stream\\s+and\\s+control\\s+.+?\\s+directly\\s+in\\s+the\\s+side\\s+pane/i.test(rawText)) {
            const sidePaneRes = translateSidePaneControlBanner(element);
            if (sidePaneRes) return sidePaneRes;
        }
        let translated = false;
        const isSpan = element.tagName?.toUpperCase() === 'SPAN';

        if (textLength <= 160 && /(?:(?:Also\\s+modified|Modified)\\s+in|修改于|也修改于)/i.test(rawText)) {
            translated = translateSettingOverrides(element) || translated;
        }
        if (isSpan && textLength <= 360 && /(?:Also includes|when working in this|在此(?:项目|工作区)中工作时还包括)/i.test(rawText)) {
            translated = translateProjectPermissionsSubtitle(element) || translated;
        }
        if (isSpan && textLength <= 320 && /(?:is managed by the|can only be deleted by deleting that automation|自动化管理，只能通过删除该自动化来将其删除)/i.test(rawText)) {
            translated = translateManagedByAutomationNotice(element) || translated;
        }
        if (textLength <= 120 && /(?:Daily|Weekly|Monthly|每[天周月]|Mondays?|Tuesdays?|Wednesdays?|Thursdays?|Fridays?|Saturdays?|Sundays?|Weekdays|Weekends)(?:\\s+on)?(?:\\s+(?:[A-Za-z]+|星期[一二三四五六日]))?\\s*(?:around|at|在)/i.test(rawText)) {
            translated = translateAutomationScheduleContainer(element) || translated;
        }
        if (textLength <= 260 && /(?:Search conversations with|View archived in the sidebar|使用左上角的|中查看已归档会话)/i.test(rawText)) {
            translated = translateSearchAndArchivedGuideNotice(element) || translated;
        }
        if (textLength <= 120 && /(?:Learn more about|了解更多关于)\\s+(?:Default|Full machine|Turbo mode|Custom|Inherit Global|默认|全机访问|极速模式|自定义|继承全局)/i.test(rawText)) {
            translated = translateLearnMoreAboutPresetContainer(element) || translated;
        }

        if (textLength <= 300 && /(?:archived conversations?|已归档.*(?:会话|对话)|^(?:History|历史记录)[.。]?$)/i.test(rawText.trim())) {
            translated = translateArchivedConversationNotice(element) || translated;
        }
        if (textLength <= 320 && /(?:Input disabled because|输入已禁用[，,]因为|does not exist|Create the folder in this)/i.test(rawText)) {
            translated = translateInputDisabledNotice(element) || translated;
        }
        if (textLength <= 120 && /(?:with the same folders? exists|A similar.*exists|已存在包含相同文件夹|已存在类似)/i.test(rawText)) {
            translated = translateDuplicateProjectInlineWarning(element) || translated;
        }
        if (textLength <= 260 && /(?:already exists for this (?:folder|combination of folders)|已存在于此文件夹中|已存在于这些文件夹组合中)/i.test(rawText) &&
            /(?:Would you like to continue using it or make a new one\\?|您是否希望继续使用该项目)/i.test(rawText)) {
            translated = translateDuplicateProjectModalNotice(element) || translated;
        }
        if (textLength <= 80 && /(?:Show\\s+\\d+\\s+more|显示另外\\s+\\d+\\s+个)/i.test(rawText)) {
            translated = translateShowMoreStatus(element) || translated;
        }
        if (textLength <= 1600 && /(?:baseline quota|基础配额)/i.test(rawText)) {
            translated = translateBaselineQuotaNotice(element) || translated;
        }
        if (textLength <= 800 && /(?:weekly limit|每周配额)/i.test(rawText)) {
            translated = translateQuotaNoticeContainer(element) || translated;
        }
        if (textLength >= 25 && textLength <= 1400 && SKILL_PICKER_CONTAINER_REGEX.test(rawText)) {
            translated = translateSkillPickerEntry(element) || translated;
        }
        if (textLength <= 240 &&
            /(?:\\bCommit\\b|提交)/i.test(rawText) &&
            /(?:files?\\s*changes?|个文件.*更改)/i.test(rawText) &&
            /(?:\\bto\\b|提交到)/i.test(rawText)) {
            translated = (translateCommitSummaryContainer(element) === true) || translated;
        }
        if (textLength <= 80 && /(?:Working|处理中|工作中)/i.test(rawText)) {
            translated = translateAgentLoadingStatus(element) || translated;
            translated = translateWorkingStatusContainer(element) || translated;
        }
        if (textLength <= 60 && /^(?:No\\s+automations\\s+yet|No\\s+runs\\s+yet)$/i.test(rawText.trim())) {
            translated = translateEmptyStateStatus(element) || translated;
        }
        if (textLength <= 140 && /(?:Repeat every|每隔)/i.test(rawText) && /(?:hour|day|week|month|小时|天|周|月)/i.test(rawText) && /(?:on the|at|\\b(?:1st|2nd|3rd|[4-9]th|[12]\\dth|3[01]st)\\b)/i.test(rawText)) {
            translated = translateAutomationScheduleBuilderContainer(element) || translated;
        }
        if (textLength <= 120 && (/\\d/.test(rawText) || /(?:See all|显示全部|Show\\s+(?:submitted|more)|显示(?:已提交|更多))/i.test(rawText)) && /(?:\\bresults?\\b|个结果|(?:Comments?|评论)\\s*[（(]\\s*\\d+|\\btools?\\b|\\bComments?\\b|on for this conversation|(?:\\d+\\s+)?(?:Side Questions?|侧边提问)(?:\\s*[（(]\\s*\\d+|\\b)|Listed|列出了|[（(]\\s*\\d+\\s*(?:subagents?|个?\\s*子智能体)|\\baccounts\\b|个账号|See all|显示全部|See\\s+\\d+\\s+more|查看另外|Show\\s+(?:submitted|more)|显示(?:已提交|更多)|\\bmore\\s+lines?\\b|行代码)/i.test(rawText)) {
            translated = translateCompactCountLabelContainer(element) || translated;
        }
        if (textLength <= 240 &&
            /^(?:\\d+\\s+|Found\\s+|Killed\\s+|已中止\\s+|Messaged?\\s+|Error\\s+from\\s+|Timed\\s+\\d+|Goals?\\s+\\d+|View\\s+\\d+|Questions?\\s+\\d+|Side\\s+question\\s+|Asked\\s+\\d+)/i.test(rawText.trim())) {
            translated = translateDynamicSubagentStatusContainer(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:Permanently delete|\\bincluding\\b|\\bactive conversations?\\b|\\barchived conversations?\\b|永久删除|，包含)/i.test(rawText)) {
            translated = translateProjectDeleteSummary(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:This will permanently delete|这将永久删除|within it)/i.test(rawText) &&
            /(?:active (?:conversations?|chats?)|archived (?:conversations?|chats?)|个活跃会话|个已归档会话|within it)/i.test(rawText)) {
            translated = translatePermanentlyDeleteNotice(element) || translated;
        }
        if (textLength <= 600 &&
            /(?:This will archive|这将归档)/i.test(rawText) &&
            /(?:conversations?|chats?|会话|within it)/i.test(rawText)) {
            translated = translateArchiveNotice(element) || translated;
        }
        if (element.getAttribute?.('data-testid') === 'plan-command-fyi-alert' ||
            (textLength <= 250 && /(?:Type|类型|键入)\\s*\\/\\s*(?:and\\s+select|并选择)\\s*plan/i.test(rawText))) {
            translated = translatePlanCommandAlert(element) || translated;
        }
        if (textLength <= 300 &&
            /(?:Visit|访问)\\s*(?:Legal Help|法律帮助)/i.test(rawText) &&
            /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(rawText)) {
            translated = translateLegalHelpNotice(element) || translated;
        }
        if (textLength <= 8 && isSpan && /^OR$/i.test(rawText.trim())) {
            translated = translateBusinessSsoOrDivider(element) || translated;
        }
        return translated;
    }

    function getCombinedStatusTranslation(value, element = null) {
        const normalized = norm(value);
        if (!normalized) return null;
        if (!/^[a-zA-Z]+$/.test(normalized)) {
            if (map.has(normalized)) return map.get(normalized);
            if (lowerMap.has(normalized.toLowerCase())) return lowerMap.get(normalized.toLowerCase());
        }

        const versionControlTranslation = getVersionControlUiTranslation(normalized);
        if (versionControlTranslation) return versionControlTranslation;

        const automationScheduleTranslation = getAutomationScheduleTranslation(normalized);
        if (automationScheduleTranslation) return automationScheduleTranslation;

        const bulletedStatusTranslation = getBulletedStatusTranslation(normalized);
        if (bulletedStatusTranslation) return bulletedStatusTranslation;

        const workingStatusTranslation = getWorkingStatusTranslation(normalized);
        if (workingStatusTranslation) return workingStatusTranslation;

        const executionTimingTranslation = getExecutionTimingTranslation(normalized);
        if (executionTimingTranslation) return executionTimingTranslation;

        const compactCountLabelTranslation = getCompactCountLabelTranslation(normalized);
        if (compactCountLabelTranslation) return compactCountLabelTranslation;

        const artifactTimestampTranslation = getArtifactTimestampTranslation(normalized);
        if (artifactTimestampTranslation) return artifactTimestampTranslation;

        const quotaNoticeTranslation = getQuotaNoticeTranslation(normalized);
        if (quotaNoticeTranslation) return quotaNoticeTranslation;

        const archivedConversationNoticeTranslation = getArchivedConversationNoticeTranslation(normalized);
        if (archivedConversationNoticeTranslation) return archivedConversationNoticeTranslation;

        const baselineQuotaTranslation = getBaselineQuotaRefreshTranslation(normalized);
        if (baselineQuotaTranslation) return baselineQuotaTranslation;

        const subagentStatusTranslation = getDynamicSubagentStatusTranslation(normalized);
        if (subagentStatusTranslation) return subagentStatusTranslation;

        const bracketedTaskStatusTranslation = getBracketedTaskStatusTranslation(normalized);
        if (bracketedTaskStatusTranslation) return bracketedTaskStatusTranslation;

        const productUiTranslation = getDynamicProductUiTranslation(normalized, element);
        if (productUiTranslation) return productUiTranslation;

        const projectDeleteSummaryTranslation = getProjectDeleteSummaryTranslation(normalized);
        if (projectDeleteSummaryTranslation) return projectDeleteSummaryTranslation;

        const customizationBudgetTranslation = getCustomizationBudgetTranslation(normalized);
        if (customizationBudgetTranslation) return customizationBudgetTranslation;

        const artifactFileCountTranslation = getArtifactFileCountTranslation(normalized);
        if (artifactFileCountTranslation) return artifactFileCountTranslation;

        const commandInputStatusTranslation = getCommandInputStatusTranslation(normalized);
        if (commandInputStatusTranslation) return commandInputStatusTranslation;

        const relativeTimeTranslation = getRelativeTimeTranslation(normalized);
        if (relativeTimeTranslation) return relativeTimeTranslation;

        const showMoreMatch = normalized.match(/^Show\\s+(\\d+)\\s+more(?:\\.\\.\\.|…)?$/i);
        if (showMoreMatch) return "显示另外 " + showMoreMatch[1] + " 个...";

        const geminiAvailableMatch = normalized.match(/^Gemini\\s+(.+?)\\s+is now available$/i);
        if (geminiAvailableMatch) return "Gemini " + geminiAvailableMatch[1] + " 现已可用";

        const toolMatch = normalized.match(/^(\\d+)\\s+tools?\\s+enabled$/i);
        if (toolMatch) return toolMatch[1] + " 个工具已启用";

        const scheduleMatch = normalized.match(/^All (scheduled tasks|automations) run (?:as|with the)\\s+(.+?)(?:\\s+model)?[.。]?$/i);
        if (scheduleMatch) {
            const entity = scheduleMatch[1].toLowerCase() === "automations" ? "自动化" : "计划任务";
            const model = scheduleMatch[2].replace(/[.。]+$/, '').trim();
            if (model) return "所有" + entity + "均以 " + model + " 模型运行";
        }
        const viewArchivedHistMatch = normalized.match(/^View(?:\\s+(\\d+))?\\s+archived conversations?\\s+in\\s+History[.。]?$/i);
        if (viewArchivedHistMatch) {
            return viewArchivedHistMatch[1]
                ? "在“历史记录”中查看 " + viewArchivedHistMatch[1] + " 个已归档会话"
                : "可在“历史记录”中查看已归档的会话";
        }
        const viewArchivedMatch = normalized.match(/^View(?:\\s+(\\d+))?\\s+archived conversations?(?:\\s+in)?$/i);
        if (viewArchivedMatch) {
            const countText = viewArchivedMatch[1] ? " " + viewArchivedMatch[1] + " 个" : "";
            return "查看" + countText + "已归档会话" + (/in$/i.test(normalized) ? "，请前往 " : "");
        }
        const deleteProjectPrefixMatch = normalized.match(/^Are you sure you want to delete\\s+(?:the\\s+|this\\s+)?(project|workspace|项目|工作区)$/i);
        if (deleteProjectPrefixMatch) {
            const scope = /^(?:workspace|工作区)$/i.test(deleteProjectPrefixMatch[1]) ? "工作区" : "项目";
            return "您确定要删除" + scope + (/\\s$/.test(value) ? " " : "");
        }

        return null;
    }

    function translateCombinedTextChildren(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE || !element.childNodes || element.childNodes.length < 2) {
            return false;
        }

        let hasAdjacentTextNodes = false;
        for (let i = 0; i < element.childNodes.length - 1; i++) {
            if (element.childNodes[i].nodeType === Node.TEXT_NODE && element.childNodes[i + 1].nodeType === Node.TEXT_NODE) {
                hasAdjacentTextNodes = true;
                break;
            }
        }
        if (!hasAdjacentTextNodes) return false;
        if (isInBlockedZone(element) || isContentBodyContainer(element)) return false;

        const boundedText = getBoundedTextContent(element, 16, 240);
        if (boundedText !== null && getCompactCountLabelTranslation(boundedText)) return false;

        let textRun = [];
        const translateRun = () => {
            if (textRun.length < 2) return false;
            const original = textRun.map(textNode => textNode.nodeValue || '').join('');
            const translated = getCombinedStatusTranslation(original, element);
            if (!translated || translated === original) return false;
            replaceTextNode(textRun[0], translated);
            for (let i = 1; i < textRun.length; i++) replaceTextNode(textRun[i], '');
            return true;
        };

        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                textRun.push(child);
                continue;
            }
            if (translateRun()) return true;
            textRun = [];
        }
        return translateRun();
    }

    function translateQuestionnaireOptionLabel(node, value) {
        const normalized = norm(value);
        const bilingualMatch = normalized.match(/^(.+?[\\u3400-\\u9fff].*?)\\s*[（(]([A-Za-z][A-Za-z0-9 .,'’/&+:#-]*)[)）]$/);
        if (!bilingualMatch) return null;

        let current = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
        let optionRow = null;
        for (let depth = 0; current && depth < 6; depth++) {
            const rowText = norm(current.textContent);
            const isCompactLabelRow = rowText.endsWith(normalized)
                && rowText.length <= normalized.length + 32;
            const isInteractive = isCompactLabelRow
                && current.matches?.('button, [role="button"], [role="option"], [role="radio"], [role="checkbox"], [tabindex]');
            const isNumberedRow = isCompactLabelRow && /^\\d+\\s*/.test(rowText);
            if (isInteractive || isNumberedRow) {
                optionRow = current;
                break;
            }
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        if (!optionRow) return null;

        current = optionRow.parentElement || (optionRow.getRootNode?.().host ?? null);
        for (let depth = 0; current && depth < 10; depth++) {
            if (current === document.body || current === document.documentElement) break;
            const cardText = norm(current.textContent);
            const hasProgress = /\\b\\d+\\s+of\\s+\\d+\\b/i.test(cardText);
            const hasActions = /(?:Skip|跳过)/i.test(cardText) && /(?:Continue|继续)/i.test(cardText);
            if (cardText.length <= 4000 && hasProgress && hasActions) return bilingualMatch[1].trim();
            current = current.parentElement || (current.getRootNode?.().host ?? null);
        }
        return null;
    }

    function translateFragmentedStatus(node, originalVal) {
        const currentText = norm(originalVal);
        if (!currentText || currentText.length > 120) return null;

        let _prevLoaded = false;
        let _previous = null;
        let _previousText = '';
        const getPrev = () => {
            if (!_prevLoaded) {
                _prevLoaded = true;
                _previous = findPreviousTextNode(node);
                _previousText = _previous ? norm(_previous.nodeValue) : '';
            }
            return _previous;
        };
        const getPrevText = () => {
            getPrev();
            return _previousText;
        };

        if (/^(?:Default|Full machine|Turbo mode|Custom|Inherit Global|默认|全机访问|极速模式|自定义|继承全局)$/i.test(currentText)) {
            const previousText = getPrevText();
            if (/^(?:Learn more about|了解更多关于)$/i.test(previousText)) {
                replaceTextNode(getPrev(), "了解更多关于 ");
                const presetMap = {
                    'default': "默认",
                    'full machine': "全机访问",
                    'turbo mode': "极速模式",
                    'custom': "自定义",
                    'inherit global': "继承全局"
                };
                return presetMap[currentText.toLowerCase()] || currentText;
            }
        }

        if (/^to ask for content changes for legal reasons[.。]?$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (getBoundedTextContent(node.parentElement, 16, 400) || '') : '';
            if (/^(?:Legal Help|法律帮助)$/i.test(getPrevText()) || /(?:Legal Help|法律帮助)/i.test(parentText)) {
                return " 页面";
            }
        }
        if (/^Visit$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (getBoundedTextContent(node.parentElement, 16, 400) || '') : '';
            if (/(?:Legal Help|法律帮助)/i.test(parentText) && /(?:to ask for content changes for legal reasons|出于法律原因)/i.test(parentText)) {
                return "若出于法律原因需要申请更改内容，请访问 ";
            }
        }
        if (/^(?:,?\\s*found here:?|found here:?)$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (getBoundedTextContent(node.parentElement, 16, 500) || '') : '';
            if (/(?:Privacy Policy|隐私政策)/i.test(getPrevText()) || /(?:third party developer tools|第三方开发者工具|policies\\.google\\.com)/i.test(parentText)) {
                return " 保护任何此类数据，具体请参见此处:";
            }
        }
        if (/^Google does not control the availability or functionality of third party developer tools\\.\\s*Your data from third party developer tools connected to your Antigravity instance may be shared with Google\\.\\s*Google will protect any such data in accordance with the$/i.test(currentText)) {
            return "Google 无法控制第三方开发者工具的可用性或功能. 从连接到您 Antigravity 实例的第三方开发者工具中获取的数据可能会与 Google 共享. Google 将根据 ";
        }
        if (/^Google will protect any such data in accordance with the$/i.test(currentText)) {
            const parentText = node && node.parentElement ? (getBoundedTextContent(node.parentElement, 16, 500) || '') : '';
            if (/(?:third party developer tools|第三方开发者工具)/i.test(parentText)) {
                return "Google 将根据 ";
            }
        }

        const commentCountMatch = currentText.match(/^[（(]\\s*(\\d+)\\s*[)）]$/);
        if (commentCountMatch && /^(?:Comments?|评论)$/i.test(getPrevText())) {
            replaceTextNode(getPrev(), "评论");
            return "(" + commentCountMatch[1] + ")";
        }

        if (/^yet$/i.test(currentText)) {
            const prevText = getPrevText();
            const prevNode = getPrev();
            if (/^No\\s+automations?$/i.test(prevText) && prevNode) {
                replaceTextNode(prevNode, "暂无自动化任务");
                return '';
            }
            if (/^No\\s+runs?$/i.test(prevText) && prevNode) {
                replaceTextNode(prevNode, "暂无运行记录");
                return '';
            }
            if (/^(?:automations?|runs?)$/i.test(prevText) && prevNode) {
                const noNode = findPreviousTextNode(prevNode);
                if (noNode && /^No$/i.test(norm(noNode.nodeValue))) {
                    replaceTextNode(noNode, '');
                    if (/^automations?$/i.test(prevText)) {
                        replaceTextNode(prevNode, "暂无自动化任务");
                    } else if (/^runs?$/i.test(prevText)) {
                        replaceTextNode(prevNode, "暂无运行记录");
                    }
                    return '';
                }
            }
        }

        if (/^Comments?$/i.test(currentText)) {
            const prevText = getPrevText();
            if (/^\\d+$/.test(prevText)) {
                return "条评论";
            }
        }

        const statusItemMatch = currentText.match(STATUS_ITEM_REGEX);
        if (statusItemMatch && getPrev()) {
            const previousText = getPrevText();
            if (/^(?:Explored|Exploring|ran|run|executed|edited|editing)\\s+\\d+$/i.test(previousText) || /^\\d+$/.test(previousText)) {
                markThoughtContentSibling(node);
                return null;
            }
        }

        let statusMatch = currentText.match(/^(?:subagents?|子智能体)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch) {
            const previous = getPrev();
            const previousText = getPrevText();
            if (/^Found$/i.test(previousText)) {
                replaceTextNode(previous, "已找到");
                return "子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
            }
            if (/^\\d+$/.test(previousText)) {
                const foundNode = findPreviousTextNode(previous);
                if (foundNode && /^Found$/i.test(norm(foundNode.nodeValue))) {
                    replaceTextNode(foundNode, "找到 ");
                    return " 个子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
                }
                if (foundNode && /^(?:Killed|已中止)$/i.test(norm(foundNode.nodeValue))) {
                    replaceTextNode(foundNode, "已中止 ");
                    return " 个子智能体" + (statusMatch[1] ? " " + statusMatch[1] : "");
                }
            }
        }

        statusMatch = currentText.match(/^(?:Browsers?|浏览器)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Found$/i.test(getPrevText())) {
            replaceTextNode(getPrev(), "已找到");
            return "浏览器" + (statusMatch[1] ? " " + statusMatch[1] : "");
        }

        statusMatch = currentText.match(/^(\\d+)\\s+subagents?(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch) {
            const previous = getPrev();
            const previousText = getPrevText();
            if (/^Found$/i.test(previousText)) {
                replaceTextNode(previous, "找到");
                return " " + statusMatch[1] + " 个子智能体" + (statusMatch[2] ? " " + statusMatch[2] : "");
            }
            if (/^(?:Killed|已中止)$/i.test(previousText)) {
                replaceTextNode(previous, "已中止");
                return " " + statusMatch[1] + " 个子智能体" + (statusMatch[2] ? " " + statusMatch[2] : "");
            }
        }

        statusMatch = currentText.match(/^(\\d+)\\s+(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Timed$/i.test(getPrevText())) {
            const unit = /^second/i.test(statusMatch[2]) ? "秒" : /^minute/i.test(statusMatch[2]) ? "分钟" : "小时";
            replaceTextNode(getPrev(), "耗时");
            return " " + statusMatch[1] + " " + unit + (statusMatch[3] ? " " + statusMatch[3] : "");
        }
        statusMatch = currentText.match(/^(seconds?|minutes?|hours?)(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^\\d+$/.test(getPrevText())) {
            const timedNode = findPreviousTextNode(getPrev());
            if (timedNode && /^Timed$/i.test(norm(timedNode.nodeValue))) {
                const unit = /^second/i.test(statusMatch[1]) ? "秒" : /^minute/i.test(statusMatch[1]) ? "分钟" : "小时";
                replaceTextNode(timedNode, "耗时 ");
                return " " + unit + (statusMatch[2] ? " " + statusMatch[2] : "");
            }
        }

        statusMatch = currentText.match(/^Root\\s+Agent(?:\\s*([>›❯〉→]))?$/i);
        if (statusMatch && /^Messaged$/i.test(getPrevText())) {
            replaceTextNode(getPrev(), "已向");
            return "主智能体发送消息" + (statusMatch[1] ? " " + statusMatch[1] : "");
        }

        statusMatch = currentText.match(/^(\\d+)\\s+active\\s+goals?$/i);
        if (statusMatch && /^(\\d+)\\s+tasks?\\s+running,?$/i.test(getPrevText())) {
            const taskCount = getPrevText().match(/^(\\d+)/)[1];
            replaceTextNode(getPrev(), taskCount + " 个任务正在运行，");
            return statusMatch[1] + " 个活跃目标";
        }
        if (/^active\\s+goals?$/i.test(currentText) && /^\\d+$/.test(getPrevText())) {
            return " 个活跃目标";
        }

        if (/^found$/i.test(currentText) && getPrevText() === "项目") {
            const noNode = findPreviousTextNode(getPrev());
            if (noNode && /^No$/i.test(norm(noNode.nodeValue))) {
                replaceTextNode(noNode, '');
                replaceTextNode(getPrev(), "未找到项目");
                return '';
            }
        }

        if (/^(?:when not in a project|in this project|in this workspace|in this conversation)$/i.test(currentText) && getPrev()) {
            const previous = getPrev();
            const previousText = getPrevText();
            const isAllow = /^(?:Yes, and always allow|是，且始终允许)$/i.test(previousText);
            const isSaveRule = /^(?:Yes, save rule|是，保存规则)$/i.test(previousText);
            if (isAllow || isSaveRule) {
                let scopeTrans = "";
                if (/^in this project$/i.test(currentText)) scopeTrans = "在此项目中";
                else if (/^when not in a project$/i.test(currentText)) scopeTrans = "在不属于任何项目时";
                else if (/^in this workspace$/i.test(currentText)) scopeTrans = "在此工作区中";
                else if (/^in this conversation$/i.test(currentText)) scopeTrans = "在此会话中";

                if (isAllow) {
                    replaceTextNode(previous, "是，且" + scopeTrans + "始终允许");
                } else {
                    replaceTextNode(previous, "是，" + scopeTrans + "保存规则");
                }
                return '';
            }
        }

        if (/^s\\s+enabled$/i.test(currentText) && getPrev()) {
            const countAndTool = getPrevText().match(/^(\\d+)\\s+tools?$/i);
            if (countAndTool) {
                replaceTextNode(getPrev(), countAndTool[1] + " 个工具已启用");
                return '';
            }
        }

        const isEnabledSuffix = /^s\\s+enabled$/i.test(currentText) || /^enabled$/i.test(currentText);
        if (isEnabledSuffix && getPrev()) {
            const previous = getPrev();
            let toolNode = previous;
            let toolText = getPrevText();

            if (/^s$/i.test(toolText) && /^enabled$/i.test(currentText)) {
                toolNode = findPreviousTextNode(previous);
                toolText = toolNode ? norm(toolNode.nodeValue) : '';
                replaceTextNode(previous, '');
            }

            const countNode = toolNode ? findPreviousTextNode(toolNode) : null;
            const countText = countNode ? norm(countNode.nodeValue) : '';
            if (/^(?:tool|tools|工具)$/i.test(toolText) && /^\\d+$/.test(countText)) {
                replaceTextNode(toolNode, '');
                return " 个工具已启用";
            }
        }

        if (currentText.length <= 40 && !/[\\u4e00-\\u9fff]/.test(currentText) &&
            node.previousSibling &&
            node.parentElement && node.parentElement.childNodes && node.parentElement.childNodes.length >= 2 &&
            getPrevText() === "所有计划任务均以") {
            const model = currentText.replace(/[.。]+$/, '').trim();
            if (model) return model + " 模型运行";
        }

        if (/^[.。]$/.test(currentText) && /模型运行$/.test(getPrevText())) {
            return '';
        }

        if (/^\\?\\s*(?:This action cannot be undone\\.?)?$/i.test(currentText) && getPrev()) {
            let candidate = getPrev();
            for (let i = 0; i < 6 && candidate; i++) {
                if (/^您确定要删除(?:计划)?任务$/.test(norm(candidate.nodeValue))) {
                    return /This action cannot be undone/i.test(currentText)
                        ? " 吗? 此操作无法撤销"
                        : " 吗?";
                }
                candidate = findPreviousTextNode(candidate);
            }
        }

        const deletePrefixMatch = currentText.match(/^Are you sure you want to delete(?:\\s+(?:the|this))?(?:\\s+(project|workspace|项目|工作区))?$/i);
        if (deletePrefixMatch) {
            let container = node && node.parentElement;
            for (let depth = 0; depth < 3 && container; depth++) {
                if (container === document.body || container === document.documentElement) break;
                const containerText = getBoundedTextContent(container, 16, 320) || '';
                if (/^Are you sure you want to delete\\s+(?:the\\s+|this\\s+)?(?:project|workspace|项目|工作区)\\s+.+\\?$/i.test(containerText)) {
                    if (deletePrefixMatch[1]) {
                        const scope = /^(?:workspace|工作区)$/i.test(deletePrefixMatch[1]) ? "工作区" : "项目";
                        return "您确定要删除" + scope + (/\\s$/.test(originalVal) ? " " : "");
                    }
                    return "您确定要删除";
                }
                container = container.parentElement;
            }
        }

        if (/^(?:project|workspace)$/i.test(currentText) && getPrev()) {
            let candidate = getPrev();
            for (let i = 0; i < 4 && candidate; i++) {
                const candidateText = norm(candidate.nodeValue);
                if (/^您确定要删除\\s*$/.test(candidateText) || /^Are you sure you want to delete(?:\\s+(?:the|this))?$/i.test(candidateText)) {
                    return /workspace/i.test(currentText) ? "工作区 " : "项目 ";
                }
                candidate = findPreviousTextNode(candidate);
            }
        }

        if (currentText === '?' && getPrev()) {
            let candidate = getPrev();
            let hasProjectScope = false;
            for (let i = 0; i < 8 && candidate; i++) {
                const candidateText = norm(candidate.nodeValue);
                if (/^(?:project|workspace|项目|工作区)$/i.test(candidateText)) {
                    hasProjectScope = true;
                } else if (candidateText === "您确定要删除" && hasProjectScope) {
                    return " 吗?";
                } else if (/^您确定要删除(?:项目|工作区)$/.test(candidateText)) {
                    return " 吗?";
                }
                candidate = findPreviousTextNode(candidate);
            }
        }

        if (/^(?:Daily|Weekly|Monthly)$/i.test(currentText)) {
            const parent = node.parentElement;
            const outer = (parent && parent.parentElement) || parent;
            const containerText = outer ? (getBoundedTextContent(outer, 16, 120) || '') : '';
            if (/(?:around|at|在)/i.test(containerText)) {
                const freqMap = {
                    daily: "每天",
                    weekly: "每周",
                    monthly: "每月"
                };
                return freqMap[currentText.toLowerCase()];
            }
        }

        if (/^on$/i.test(currentText) && getPrev()) {
            const prevText = getPrevText();
            const parent = node.parentElement;
            const containerText = parent ? (getBoundedTextContent(parent, 16, 120) || '') : '';
            if (/^(?:每周|Weekly)$/i.test(prevText) && /(?:around|at|在)/i.test(containerText)) {
                const nextSibling = node.nextSibling;
                if (nextSibling && nextSibling.nodeType === Node.TEXT_NODE && nextSibling.nodeValue && nextSibling.nodeValue.trim() === '') {
                    replaceTextNode(nextSibling, '');
                }
                return "";
            }
        }

        if (/^(?:around|at)$/i.test(currentText) && getPrev()) {
            const prevText = getPrevText();
            if (/^(?:每天|每周|每月|Daily|Weekly|Monthly|星期[一二三四五六日]|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|每周星期[一二三四五六日]|Weekly\\s+on\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))$/i.test(prevText)) {
                return "在 ";
            }
        }

        const weeklyOnDayMatch = currentText.match(/^Weekly\\s+on\\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i);
        if (weeklyOnDayMatch) {
            const dayMap = {
                monday: "星期一", tuesday: "星期二", wednesday: "星期三",
                thursday: "星期四", friday: "星期五", saturday: "星期六", sunday: "星期日"
            };
            return "每周" + (dayMap[weeklyOnDayMatch[1].toLowerCase()] || weeklyOnDayMatch[1]);
        }

        if (/^Weekly\\s+on$/i.test(currentText)) {
            return "每周";
        }

        if (/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(currentText) && getPrev()) {
            const prevText = getPrevText();
            const parent = node.parentElement;
            const outer = (parent && parent.parentElement) || parent;
            const containerText = outer ? (getBoundedTextContent(outer, 16, 120) || '') : '';
            if ((/^(?:每周|Weekly(?:\\s+on)?|on)$/i.test(prevText)) && /(?:around|at|在)/i.test(containerText)) {
                const dayMap = {
                    monday: "星期一", tuesday: "星期二", wednesday: "星期三",
                    thursday: "星期四", friday: "星期五", saturday: "星期六", sunday: "星期日"
                };
                return dayMap[currentText.toLowerCase()];
            }
        }

        if (/^in$/i.test(currentText)) {
            const previous = getPrev();
            const previousText = getPrevText();
            if (previousText === "个已归档会话" || previousText === "已归档会话" || previousText === "个已归档对话" || previousText === "已归档对话" || previousText === "archived conversation" || previousText === "archived conversations") {
                let viewNode = findPreviousTextNode(previous);
                let hasNumber = false;
                if (viewNode && /^\\d+$/.test(norm(viewNode.nodeValue))) {
                    hasNumber = true;
                    viewNode = findPreviousTextNode(viewNode);
                }
                const articleNodes = [];
                while (viewNode && /^(?:a|an|个)$/i.test(norm(viewNode.nodeValue))) {
                    articleNodes.push(viewNode);
                    viewNode = findPreviousTextNode(viewNode);
                }
                if (viewNode && /^(?:View|视图|查看)$/i.test(norm(viewNode.nodeValue))) {
                    for (const articleNode of articleNodes) replaceTextNode(articleNode, '');
                    replaceTextNode(viewNode, "查看");
                    if (!hasNumber) {
                        replaceTextNode(previous, "已归档的会话");
                    }
                    return "，请前往 ";
                }
            }
        }

        if (/^Powered by Gemini Live\\s*[·•]\\s*You can change this in$/i.test(currentText)) {
            return "由 Gemini Live 提供支持 · 稍后可在 ";
        }

        if (/^later\\.$/i.test(currentText) && getPrev()) {
            const prevText = getPrevText();
            if (/^(?:设置|Settings)$/i.test(prevText)) {
                return " 中进行更改.";
            }
        }

        const termsSubjectMatch = currentText.match(/^([.。]?)\s*Your\s+use\s+is\s+subject\s+to\s+the$/i);
        if (termsSubjectMatch) {
            return (termsSubjectMatch[1] ? ". " : "") + "您对本服务的使用受 ";
        }

        if (/^and$/i.test(currentText)) {
            let prevNode = findPreviousTextNode(node);
            let prevText = prevNode ? norm(prevNode.nodeValue) : '';
            if (!prevText && node && node.previousSibling) {
                prevText = norm(node.previousSibling.textContent || '');
            }
            let nextNode = findNextTextNode(node);
            let nextText = nextNode ? norm(nextNode.nodeValue) : '';
            if (!nextText && node && node.nextSibling) {
                nextText = norm(node.nextSibling.textContent || '');
            }
            const parentEl = node && node.parentElement;
            const parentText = parentEl ? (getBoundedTextContent(parentEl, 64, 2000) || norm(parentEl.textContent || '')) : '';
            if ((/(?:Terms of Service|服务条款)/i.test(prevText) || /(?:Terms of Service|服务条款)/i.test(parentText)) &&
                (/(?:Privacy Policy|隐私政策)/i.test(nextText) || /(?:Privacy Policy|隐私政策)/i.test(parentText))) {
                return "及";
            }
        }

        if (/^Back\\s+to$/i.test(currentText) && !isContentBodyContainer(node)) {
            const next = findNextTextNode(node);
            const nextText = next ? norm(next.nodeValue) : '';
            if (nextText) {
                let container = node.parentElement;
                for (let depth = 0; container && depth < 2; depth++) {
                    if (container === document.body || container === document.documentElement) break;
                    const cText = getBoundedTextContent(container, 12, 160);
                    if (cText !== null && (!container.children || container.children.length <= 6) && /^Back\\s+to\\s+\\S/i.test(norm(cText))) {
                        return "返回";
                    }
                    container = container.parentElement || (container.getRootNode?.().host ?? null);
                }
            }
        }

        return null;
    }

    function translateElementAttributes(node) {
        try {
            if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
            if (isSwarmBoardDocument()) {
                const swarmBlockedState = getElementBlockedState(node);
                if (swarmBlockedState === 2) {
                    const tag = node.tagName ? node.tagName.toUpperCase() : '';
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG') {
                        translateSwarmBoardElementAttributes(node);
                    }
                    return;
                }
                if (swarmBlockedState === 0) {
                    translateSwarmBoardElementAttributes(node);
                }
                return;
            }
            const blockedState = getElementBlockedState(node);
            if (blockedState === 2) {
                const tag = node.tagName ? node.tagName.toUpperCase() : '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG') {
                    const parentState = getElementBlockedState(node.parentElement);
                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                        const v = node.getAttribute(attr);
                        if (v) {
                            const searchingTrans = getSearchingStatusTranslation(v);
                            if (searchingTrans && searchingTrans !== v) {
                                node.setAttribute(attr, searchingTrans);
                            } else if (tag === 'INPUT' || tag === 'TEXTAREA' || parentState === 0) {
                                const t = norm(v);
                                const target = getVersionControlUiTranslation(t)
                                    || getDynamicSubagentStatusTranslation(t)
                                    || getDynamicProductUiTranslation(t, node)
                                    || getCompactCountLabelTranslation(t)
                                    || translateWithShortcut(t)
                                    || map.get(t)
                                    || lowerMap.get(t.toLowerCase());
                                if (target && target !== v) node.setAttribute(attr, target);
                            }
                        }
                    }
                }
                return;
            }
            if (node.getAttribute('contenteditable') === 'true') {
                for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label', 'title']) {
                    const value = node.getAttribute(attr);
                    if (!value) continue;
                    const normalizedValue = norm(value);
                    const target = getVersionControlUiTranslation(normalizedValue)
                        || getDynamicProductUiTranslation(normalizedValue, node)
                        || translateWithShortcut(normalizedValue)
                        || map.get(normalizedValue)
                        || lowerMap.get(normalizedValue.toLowerCase());
                    if (target && target !== value) node.setAttribute(attr, target);
                }
                return;
            }
            if (blockedState === 0 || node.tagName === 'BUTTON' || node.getAttribute?.('role') === 'button' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
                for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                    const v = node.getAttribute(attr);
                    if (v) {
                        const searchingTrans = getSearchingStatusTranslation(v);
                        if (searchingTrans && searchingTrans !== v) {
                            node.setAttribute(attr, searchingTrans);
                        } else {
                            const t = norm(v);
                            const target = getVersionControlUiTranslation(t)
                                || getDynamicSubagentStatusTranslation(t)
                                || getDynamicProductUiTranslation(t, node)
                                || getCompactCountLabelTranslation(t)
                                || translateWithShortcut(t)
                                || map.get(t)
                                || lowerMap.get(t.toLowerCase());
                            if (target && target !== v) node.setAttribute(attr, target);
                        }
                    }
                }
            } else {
                for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                    const v = node.getAttribute(attr);
                    if (v) {
                        const searchingTrans = getSearchingStatusTranslation(v);
                        if (searchingTrans && searchingTrans !== v) {
                            node.setAttribute(attr, searchingTrans);
                        } else if (attr === 'placeholder' || attr === 'aria-placeholder' || attr === 'data-placeholder') {
                            const t = norm(v);
                            const target = getDynamicProductUiTranslation(t, node)
                                || map.get(t)
                                || lowerMap.get(t.toLowerCase());
                            if (target && target !== v) node.setAttribute(attr, target);
                        }
                    }
                }
            }
        } catch (e) {}
    }

    function translateNode(node, parentContainersScanned = false, visitedElements = null) {
        try {
            if (!node) return;

            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                for (const child of node.childNodes) translateNode(child, false, visitedElements);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                if (visitedElements) {
                    if (visitedElements.has(node)) return;
                    visitedElements.add(node);
                }
                if (node.hasAttribute(SKIP_TRANSLATION_ATTR)) return;
                const prev = node.previousElementSibling;
                if (prev && prev.hasAttribute('data-ag-thought-header') && node.parentElement && node.parentElement.children.length === 2) {
                    node.setAttribute(SKIP_TRANSLATION_ATTR, 'true');
                    blockedZoneCache.set(node, -1);
                    return;
                }

                const tag = node.tagName.toUpperCase();
                const className = typeof node.className === 'string' ? node.className : '';

                if (className && HARD_PRUNED_CLASS_REGEX.test(className)) {
                    if (node.getAttribute('translate') !== 'no') node.setAttribute('translate', 'no');
                    try {
                        if (!node.classList.contains('notranslate')) node.classList.add('notranslate');
                    } catch (e) {}
                    blockedZoneCache.set(node, -1);
                    return;
                }

                let isBlocked = BLOCKED_TAGS_SET.has(tag);
                if (!isBlocked && className) {
                    for (let i = 0; i < BLOCKED_CLASSES.length; i++) {
                        if (className.includes(BLOCKED_CLASSES[i])) {
                            isBlocked = true;
                            break;
                        }
                    }
                }
                if (node.getAttribute('contenteditable') === 'true') {
                    isBlocked = true;

                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'aria-label', 'title']) {
                        const value = node.getAttribute(attr);
                        if (!value) continue;
                        const normalizedValue = norm(value);
                        const target = getVersionControlUiTranslation(normalizedValue)
                            || getDynamicProductUiTranslation(normalizedValue, node)
                            || translateWithShortcut(normalizedValue)
                            || map.get(normalizedValue)
                            || lowerMap.get(normalizedValue.toLowerCase());
                        if (target && target !== value) node.setAttribute(attr, target);
                    }
                }

                const shouldMarkBlocked = isBlocked &&
                    (!BLOCKED_TAGS_SET.has(tag) || AUTO_TRANSLATE_PROTECTED_TAGS.has(tag));
                if (shouldMarkBlocked) {
                    if (node.getAttribute('translate') !== 'no') {
                        node.setAttribute('translate', 'no');
                    }
                    try {
                        if (!node.classList.contains('notranslate')) {
                            node.classList.add('notranslate');
                        }
                    } catch (e) {}
                }

                if (BLOCKED_TAGS_SET.has(tag)) {
                    blockedZoneCache.set(node, -1);
                    if (isSwarmBoardDocument()) {
                        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG') {
                            translateSwarmBoardElementAttributes(node);
                        }
                        return;
                    }
                    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SVG') {
                        const parentBlocked = getElementBlockedState(node.parentElement) !== 0;
                        for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                            const v = node.getAttribute(attr);
                            if (v) {
                                const searchingTrans = getSearchingStatusTranslation(v);
                                if (searchingTrans && searchingTrans !== v) {
                                    node.setAttribute(attr, searchingTrans);
                                } else if (!parentBlocked || tag === 'INPUT' || tag === 'TEXTAREA' || attr === 'placeholder' || attr === 'data-placeholder' || attr === 'aria-placeholder') {
                                    const t = norm(v);
                                    const target = getVersionControlUiTranslation(t)
                                        || getDynamicSubagentStatusTranslation(t)
                                        || getDynamicProductUiTranslation(t, node)
                                        || getCompactCountLabelTranslation(t)
                                        || translateWithShortcut(t)
                                        || map.get(t)
                                        || lowerMap.get(t.toLowerCase());
                                    if (target && target !== v) node.setAttribute(attr, target);
                                }
                            }
                        }
                    }
                    return;
                }

                const blockedState = getElementBlockedState(node);
                if (blockedState === 2) return;

                if (isSwarmBoardDocument()) {
                    if (translateSwarmBoardContainers(node) === 'skip_children') return;
                    if (blockedState === 0) {
                        translateSwarmBoardElementAttributes(node);
                    }
                    if (node.shadowRoot) translateNode(node.shadowRoot, false, visitedElements);
                    for (const child of node.childNodes) translateNode(child, true, visitedElements);
                    return;
                }

                const isFoldButtonContainer = tag === 'BUTTON' || node.getAttribute?.('role') === 'button';
                if (blockedState === 0 || isFoldButtonContainer) {
                    if (translateSpecialContainers(node) === 'skip_children') return;
                    translateCombinedTextChildren(node);
                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                        const v = node.getAttribute(attr);
                        if (v) {
                            const searchingTrans = getSearchingStatusTranslation(v);
                            if (searchingTrans && searchingTrans !== v) {
                                node.setAttribute(attr, searchingTrans);
                            } else {
                                const t = norm(v);
                                const target = getVersionControlUiTranslation(t)
                                    || getDynamicSubagentStatusTranslation(t)
                                    || getDynamicProductUiTranslation(t, node)
                                    || getCompactCountLabelTranslation(t)
                                    || translateWithShortcut(t)
                                    || map.get(t)
                                    || lowerMap.get(t.toLowerCase());
                               if (target && target !== v) node.setAttribute(attr, target);
                            }
                        }
                    }
                } else {
                    for (const attr of ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label']) {
                        const v = node.getAttribute(attr);
                        if (v) {
                            const searchingTrans = getSearchingStatusTranslation(v);
                            if (searchingTrans && searchingTrans !== v) {
                                node.setAttribute(attr, searchingTrans);
                            } else if (attr === 'placeholder' || attr === 'aria-placeholder' || attr === 'data-placeholder') {
                                const t = norm(v);
                                const target = getDynamicProductUiTranslation(t, node)
                                    || map.get(t)
                                    || lowerMap.get(t.toLowerCase());
                                if (target && target !== v) node.setAttribute(attr, target);
                            }
                        }
                    }
                }

                if (node.shadowRoot) translateNode(node.shadowRoot, false, visitedElements);
                for (const child of node.childNodes) translateNode(child, true, visitedElements);

            } else if (node.nodeType === Node.TEXT_NODE) {
                if (node.__agMemeGroup || node.__agMemeSynthetic) return;
                let originalVal = node.nodeValue;
                if (!originalVal || originalVal.trim().length < 1) return;
                if (translatedValues.get(node) === originalVal) return;

                const parentEl = node.parentElement;
                const parentBlockedState = getElementBlockedState(parentEl);
                if (parentBlockedState === 2) return;

                if (originalVal.length >= 9 && (originalVal.includes('pack.info') || originalVal.includes('PACK.INFO') || originalVal.toLowerCase().includes('pack.info'))) {
                    if (parentEl) {
                        if (parentEl.getAttribute('translate') !== 'no') {
                            parentEl.setAttribute('translate', 'no');
                        }
                        try {
                            if (!parentEl.classList.contains('notranslate')) {
                                parentEl.classList.add('notranslate');
                            }
                        } catch (e) {}
                    }
                    return;
                }

                if (parentBlockedState === 1 || isInSkillItemContext(node)) {
                    if (isSwarmBoardDocument()) return;
                    const protectedProductUiTranslation = getProtectedProductUiTranslation(node, originalVal);
                    if (protectedProductUiTranslation) {
                        replaceTextNode(node, protectedProductUiTranslation);
                    }
                    return;
                }

                if (isSwarmBoardDocument()) {
                    if (!parentContainersScanned && translateSwarmBoardContainers(parentEl)) return;
                    const swarmTextTrans = getSwarmBoardUiTranslation(node, norm(originalVal), originalVal, false);
                    if (swarmTextTrans !== null && swarmTextTrans !== undefined && swarmTextTrans !== originalVal) {
                        let finalSwarmText = swarmTextTrans;
                        const leadingMatch = originalVal.match(/^\\s+/);
                        const trailingMatch = originalVal.match(/\\s+$/);
                        if (leadingMatch && !finalSwarmText.startsWith(leadingMatch[0])) {
                            finalSwarmText = leadingMatch[0] + finalSwarmText;
                        }
                        if (trailingMatch && !finalSwarmText.endsWith(trailingMatch[0])) {
                            finalSwarmText = finalSwarmText + trailingMatch[0];
                        }
                        if (finalSwarmText !== originalVal) {
                            replaceTextNode(node, finalSwarmText);
                            return;
                        }
                    }
                    if (parentEl && parentEl.childNodes.length === 1) {
                        translatedValues.set(node, originalVal);
                    }
                    return;
                }

                if (translateAttachmentMenuFolder(node, originalVal)) return;
                if (translateAutomationNewButton(node, originalVal)) return;
                if (translateSkillPickerNameTextNode(node, originalVal)) return;
                if (translateUsedSkillNameTextNode(node, originalVal)) return;
                if (translateCommitSummaryTextNode(node, originalVal)) return;
                if (!parentContainersScanned && translateSpecialContainers(parentEl)) return;
                if (!parentContainersScanned && translateCombinedTextChildren(parentEl)) return;

                let newVal = originalVal;
                const hasRecommended = /^\\(Recommended\\)(?:\\s+|$)/i.test(newVal);
                if (hasRecommended) {
                    newVal = newVal.replace(/^\\(Recommended\\)(?:\\s+|$)/i, '');
                }
                const valNorm = norm(newVal);
                if (!valNorm) return;

                if (!/[a-zA-Z]/.test(valNorm)) {
                    let dynNonAlpha = null;
                    if (/^[（(.。?]/.test(valNorm)) {
                        dynNonAlpha = translateFragmentedStatus(node, originalVal);
                    }
                    if (dynNonAlpha === null && /^[●•·◦∙○\\u2022\\u25CF\\u25CB]/.test(valNorm)) {
                        dynNonAlpha = getBulletedStatusTranslation(valNorm);
                    }
                    if (dynNonAlpha !== null && dynNonAlpha !== undefined) {
                        newVal = dynNonAlpha;
                    }
                    if (hasRecommended) {
                        newVal = '（推荐）' + newVal;
                    }
                    if (newVal !== originalVal) {
                        const leadingMatch = originalVal.match(/^\\s+/);
                        const trailingMatch = originalVal.match(/\\s+$/);
                        if (leadingMatch && !newVal.startsWith(leadingMatch[0])) {
                            newVal = leadingMatch[0] + newVal;
                        }
                        if (trailingMatch && !newVal.endsWith(trailingMatch[0])) {
                            newVal = newVal + trailingMatch[0];
                        }
                        if (newVal !== originalVal) {
                            translatedValues.set(node, newVal);
                            node.nodeValue = newVal;
                            return;
                        }
                    }
                    if (parentEl && parentEl.childNodes.length === 1) {
                        translatedValues.set(node, originalVal);
                    }
                    return;
                }

                if (isCollapsibleActivityHeader(valNorm)) {
                    markThoughtContentSibling(node);
                    return;
                }
                const valLower = valNorm.toLowerCase();

                let dynRes;
                if ((dynRes = getAutomationScheduleRowWordTranslation(node, valNorm)) || (dynRes = getWeekdayLetterTranslation(node, valNorm))) {
                    newVal = dynRes;
                } else if (map.has(valNorm) && !/^(?:Build With\\b|All (?:automations|scheduled tasks)\\b|Allow reading\\b|No suggestions|Previous match|0 results|Visit$|Browsers?$|enabled$)/i.test(valNorm) && isIsolatedUiControlLabel(node, valNorm, originalVal)) {
                    newVal = map.get(valNorm);
                    if ((valNorm === 'Modified in' || valNorm === 'Also modified in') && /\\s$/.test(originalVal)) {
                        newVal += ' ';
                    }
                } else if ((dynRes = translateFragmentedStatus(node, originalVal)) !== null) {
                    newVal = dynRes;
                } else if ((dynRes = translateQuestionnaireOptionLabel(node, valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getTimestampNowTranslation(node, valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getRecentProjectSectionTranslation(node, valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getDeleteTaskConfirmationTranslation(node, valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = translateWithShortcut(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getVersionControlUiTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getBaselineQuotaRefreshTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getDynamicSubagentStatusTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getBracketedTaskStatusTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getBulletedStatusTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getDynamicProductUiTranslation(valNorm, node))) {
                    newVal = dynRes;
                } else if ((dynRes = getProjectDeleteSummaryTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getCustomizationBudgetTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getArtifactFileCountTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getCommandInputStatusTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getRelativeTimeTranslation(valNorm, node))) {
                    newVal = dynRes;
                } else if ((dynRes = getWorkingStatusTranslation(valNorm))) {
                    markThoughtContentSibling(node);
                    newVal = dynRes;
                } else if ((dynRes = getExecutionTimingTranslation(valNorm))) {
                    markThoughtContentSibling(node);
                    newVal = dynRes;
                } else if ((dynRes = getSearchingStatusTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getCompactCountLabelTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getArtifactTimestampTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getQuotaNoticeTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getArchivedConversationNoticeTranslation(valNorm))) {
                    newVal = dynRes;
                } else if ((dynRes = getAutomationScheduleTranslation(valNorm, node))) {
                    newVal = dynRes;
                } else if ((dynRes = translateAutomationCustomScheduleUnit(node, valNorm))) {
                    newVal = dynRes;
                } else if (map.has(valNorm) && isIsolatedUiControlLabel(node, valNorm, originalVal)) {
                    newVal = map.get(valNorm);
                    if ((valNorm === 'Modified in' || valNorm === 'Also modified in') && /\\s$/.test(originalVal)) {
                        newVal += ' ';
                    }
                } else if (lowerMap.has(valLower) && isIsolatedUiControlLabel(node, valNorm, originalVal)) {
                    newVal = lowerMap.get(valLower);
                } else if (/^(?:Also\\s+modified|Modified)\\s+in\\s+(\\d+)\\s*(?:projects?|个?项目)$/i.test(valNorm)) {
                    const isAlso = /^Also/i.test(valNorm);
                    newVal = valNorm.replace(/^(?:Also\\s+modified|Modified)\\s+in\\s+(\\d+)\\s*(?:projects?|个?项目)$/i, (m, count) => (isAlso ? "也修改于 " : "修改于 ") + count + " 个项目");
                } else if (/^(?:Also\\s+modified|Modified)\\s+in\\s+(.+)$/i.test(valNorm)) {
                    const isAlso = /^Also/i.test(valNorm);
                    newVal = valNorm.replace(/^(?:Also\\s+modified|Modified)\\s+in\\s+(.+)$/i, (m, target) => {
                        const targetNorm = norm(target);
                        let translatedTarget = target;
                        if (/^untitled\\s+project$/i.test(targetNorm)) {
                            translatedTarget = "无标题项目";
                        } else if (/^outside\\s+of\\s+project$/i.test(targetNorm)) {
                            translatedTarget = "项目外部";
                        }
                        return (isAlso ? "也修改于 " : "修改于 ") + translatedTarget;
                    });
                } else if (/^Gemini\\s+(.+?)\\s+is now available$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Gemini\\s+(.+?)\\s+is now available$/i, (m, model) => "Gemini " + model + " 现已可用");
                } else if (/^(?:Refreshes in |Resets in |You have (?:used|hit) |Your 5-hour limit )/i.test(valNorm)) {
                    if (/^Refreshes in (\\d+) days?, (\\d+) hours?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Refreshes in (\\d+) days?, (\\d+) hours?$/i, (match, d, h) => d + " 天 " + h + " 小时后刷新");
                    } else if (/^Refreshes in (\\d+) hours?, (\\d+) minutes?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Refreshes in (\\d+) hours?, (\\d+) minutes?$/i, (match, h, m) => h + " 小时 " + m + " 分钟后刷新");
                    } else if (/^Refreshes in (\\d+) days?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Refreshes in (\\d+) days?$/i, (match, d) => d + " 天后刷新");
                    } else if (/^Refreshes in (\\d+) hours?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Refreshes in (\\d+) hours?$/i, (match, h) => h + " 小时后刷新");
                    } else if (/^Refreshes in (\\d+) minutes?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Refreshes in (\\d+) minutes?$/i, (match, m) => m + " 分钟后刷新");
                    } else if (/^Resets in <1m$/i.test(valNorm)) {
                        newVal = "不足 1 分钟后重置";
                    } else if (/^Resets in (?:(\\d+)\\s*(?:d|days?))?\\s*,?\\s*(?:(\\d+)\\s*(?:h|hours?))?\\s*,?\\s*(?:(\\d+)\\s*(?:m|mins?|minutes?))?\\s*,?\\s*(?:(\\d+)\\s*(?:s|secs?|seconds?))?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Resets in (?:(\\d+)\\s*(?:d|days?))?\\s*,?\\s*(?:(\\d+)\\s*(?:h|hours?))?\\s*,?\\s*(?:(\\d+)\\s*(?:m|mins?|minutes?))?\\s*,?\\s*(?:(\\d+)\\s*(?:s|secs?|seconds?))?$/i, (match, d, h, m, s) => {
                            let parts = [];
                            if (d) parts.push(d + " 天");
                            if (h) parts.push(h + " 小时");
                            if (m) parts.push(m + " 分钟");
                            if (s) parts.push(s + " 秒");
                            return parts.length ? parts.join(" ") + "后重置" : match;
                        });
                    } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => "您已使用部分每周配额，将在 " + d + " 天 " + h + " 小时后完全刷新");
                    } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => "您已使用部分每周配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新");
                    } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\.$/i, (match, d) => "您已使用部分每周配额，将在 " + d + " 天后完全刷新");
                    } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => "您已使用部分每周配额，将在 " + h + " 小时后完全刷新");
                    } else if (/^You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => "您已使用部分每周配额，将在 " + m + " 分钟后完全刷新");
                    } else if (/^You have used some of your weekly limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                        newVal = "您已使用部分每周配额，将在不到 1 分钟后完全刷新";
                    } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => "您已使用部分 5 小时配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新");
                    } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => "您已使用部分 5 小时配额，将在 " + h + " 小时后完全刷新");
                    } else if (/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have used some of your 5-hour limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => "您已使用部分 5 小时配额，将在 " + m + " 分钟后完全刷新");
                    } else if (/^You have used some of your 5-hour limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                        newVal = "您已使用部分 5 小时配额，将在不到 1 分钟后完全刷新";
                    } else if (/^Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => "您的 5 小时配额将在 " + d + " 天 " + h + " 小时后刷新");
                    } else if (/^Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => "您的 5 小时配额将在 " + h + " 小时 " + m + " 分钟后刷新");
                    } else if (/^Your 5-hour limit will refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) days?\\.$/i, (match, d) => "您的 5 小时配额将在 " + d + " 天后刷新");
                    } else if (/^Your 5-hour limit will refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) hours?\\.$/i, (match, h) => "您的 5 小时配额将在 " + h + " 小时后刷新");
                    } else if (/^Your 5-hour limit will refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Your 5-hour limit will refresh in (\\d+) minutes?\\.$/i, (match, m) => "您的 5 小时配额将在 " + m + " 分钟后刷新");
                    } else if (/^Your 5-hour limit will refresh in less than a minute\\.$/i.test(valNorm)) {
                        newVal = "您的 5 小时配额将在不到 1 分钟后刷新";
                    } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, d, h) => "您已达到 5 小时配额限制，将在 " + d + " 天 " + h + " 小时后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, h, m) => "您已达到 5 小时配额限制，将在 " + h + " 小时 " + m + " 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, d) => "您已达到 5 小时配额限制，将在 " + d + " 天后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, h) => "您已达到 5 小时配额限制，将在 " + h + " 小时后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    } else if (/^You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i, (match, m) => "您已达到 5 小时配额限制，将在 " + m + " 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    } else if (/^You have hit your 5-hour limit, it will refresh in less than a minute\\. If on a supported paid plan, you can use AI credits in the interim\\.$/i.test(valNorm)) {
                        newVal = "您已达到 5 小时配额限制，将在不到 1 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                    } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\.$/i, (match, d, h) => "您已达到每周配额限制，将在 " + d + " 天 " + h + " 小时后完全刷新");
                    } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\.$/i, (match, h, m) => "您已达到每周配额限制，将在 " + h + " 小时 " + m + " 分钟后完全刷新");
                    } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) days?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) days?\\.$/i, (match, d) => "您已达到每周配额限制，将在 " + d + " 天后完全刷新");
                    } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\.$/i, (match, h) => "您已达到每周配额限制，将在 " + h + " 小时后完全刷新");
                    } else if (/^You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\.$/i, (match, m) => "您已达到每周配额限制，将在 " + m + " 分钟后完全刷新");
                    } else if (/^You have hit your weekly limit, it will fully refresh in less than a minute\\.$/i.test(valNorm)) {
                        newVal = "您已达到每周配额限制，将在不到 1 分钟后完全刷新";
                    }
                } else if (/^Error ID:\\s*(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Error ID:\\s*(.+)$/i, (match, id) => "错误 ID: " + id);
                } else if (/^Models within this group:\\s*(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Models within this group:\\s*(.+)$/i, (match, models) => "此组内的模型: " + models);
                } else if (/^Executor is not currently running \\(error ID:\\s*(.+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Executor is not currently running \\(error ID:\\s*(.+)\\)$/i, (match, id) => "执行器当前未运行 (错误 ID: " + id + ")");
                } else if (valNorm.endsWith(')') && /^(?:Match (?:case|whole word)|Use regular expression|(?:Previous|Next) match|Close) \\(/i.test(valNorm)) {
                    if (/^Match case \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Match case \\((.+)\\)$/i, (m, k) => "区分大小写 (" + k + ")");
                    } else if (/^Match whole word \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Match whole word \\((.+)\\)$/i, (m, k) => "全字匹配 (" + k + ")");
                    } else if (/^Use regular expression \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Use regular expression \\((.+)\\)$/i, (m, k) => "使用正则表达式 (" + k + ")");
                    } else if (/^Previous match \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Previous match \\((.+)\\)$/i, (m, k) => "上一个匹配项 (" + k + ")");
                    } else if (/^Next match \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Next match \\((.+)\\)$/i, (m, k) => "下一个匹配项 (" + k + ")");
                    } else if (/^Close \\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Close \\((.+)\\)$/i, (m, k) => "关闭 (" + k + ")");
                    }
                } else if (/^Learn more about (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Learn more about (.+)$/i, (match, p) => {
                        let translatedPreset = p;
                        const pLower = p.toLowerCase().trim();
                        if (pLower === 'default') translatedPreset = "默认";
                        else if (pLower === 'full machine') translatedPreset = "全机访问";
                        else if (pLower === 'turbo mode') translatedPreset = "极速模式";
                        else if (pLower === 'custom') translatedPreset = "自定义";
                        else if (pLower === 'inherit global') translatedPreset = "继承全局";
                        else if (map.has(norm(p))) translatedPreset = map.get(norm(p));
                        else if (lowerMap.has(pLower)) translatedPreset = lowerMap.get(pLower);
                        return "了解更多关于 " + translatedPreset + " 的信息";
                    });
                } else if (/^\\d+\\s+(?:tools?|active|archived|tasks?|files?|subagents?|questions?)\\b/i.test(valNorm)) {
                    if (/^(\\d+) tools? enabled$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+) tools? enabled$/i, (match, num) => num + " 个工具已启用");
                    } else if (/^(\\d+) active conversations?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+) active conversations?$/i, (match, num) => num + " 个活跃会话");
                    } else if (/^(\\d+) archived conversations?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+) archived conversations?$/i, (match, num) => num + " 个已归档会话");
                    } else if (/^(\\d+) tasks? running$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+) tasks? running$/i, (match, num) => num + " 个任务正在运行");
                    } else if (/^(\\d+) files? changed$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+) files? changed$/i, (match, num) => num + " 个文件已更改");
                    } else if (/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+)\\s+subagents?\\s+(running|blocked|completed|failed)$/i, (match, num, state) => {
                            const stateLower = state.toLowerCase();
                            let stateStr = "";
                            if (stateLower === "running") stateStr = "正在运行";
                            else if (stateLower === "blocked") stateStr = "已阻塞";
                            else if (stateLower === "completed") stateStr = "已完成";
                            else if (stateLower === "failed") stateStr = "已失败";
                            return num + " 个子智能体" + stateStr;
                        });
                    } else if (/^(\\d+)\\s+questions?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^(\\d+)\\s+questions?$/i, (match, num) => num + " 个问题");
                    }
                } else if (/^(?:Show (?:\\d+)|See all \\(\\d+\\)|Send all \\(\\d+\\)|Available AI Credits:|Send feedback as\\s+|Media\\s*\\(|Updated\\s+|Individual quota reached\\.|Mark\\s+|Version\\s+|Asking\\s+\\d+|View\\s+\\d+\\s+side|Asked\\s+\\d+)/i.test(valNorm)) {
                    if (/^Show (\\d+) more(\\.\\.\\.|…)?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Show (\\d+) more(\\.\\.\\.|…)?$/i, (match, num) => "显示另外 " + num + " 个...");
                    } else if (/^Show (\\d+) breakdowns?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Show (\\d+) breakdowns?$/i, (match, num) => "显示 " + num + " 项明细");
                    } else if (/^See all \\((\\d+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^See all \\((\\d+)\\)$/i, (match, num) => "显示全部 (" + num + ")");
                    } else if (/^Send all \\((\\d+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Send all \\((\\d+)\\)$/i, (match, num) => "全部发送 (" + num + ")");
                    } else if (/^Available AI Credits: (\\d+)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Available AI Credits: (\\d+)$/i, (match, num) => "可用 AI 额度: " + num);
                    } else if (/^Send feedback as\\s+(.+)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Send feedback as\\s+(.+)$/i, (match, email) => "发送反馈身份为 " + email);
                    } else if (/^Media\\s*\\((.+)\\)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Media\\s*\\((.+)\\)$/i, (match, timeStr) => {
                            let t = timeStr.replace(/Today/i, '今天').replace(/Yesterday/i, '昨天');
                            return "媒体 (" + t + ")";
                        });
                    } else if (/^Updated\\s+(.+)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Updated\\s+(.+)$/i, (match, rest) => "更新于 " + rest);
                    } else if (/^Individual quota reached\\. Please upgrade your subscription to increase your limits\\. Resets in (.+?)\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Individual quota reached\\. Please upgrade your subscription to increase your limits\\. Resets in (.+?)\\.?$/i, (match, t) => "个人配额已达上限. 请升级订阅以提高限额. 将于 " + t + " 后重置");
                    } else if (/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i, (match, num) => "将 " + num + " 个会话标记为已读");
                    } else if (/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+unread$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Mark\\s+(\\d+)\\s+conversations?\\s+as\\s+unread$/i, (match, num) => "将 " + num + " 个会话标记为未读");
                    } else if (/^Mark\\s+all\\s+(?:conversations?\\s+)?as\\s+read$/i.test(valNorm)) {
                        newVal = "将所有会话标记为已读";
                    } else if (/^Mark\\s+all\\s+(?:conversations?\\s+)?as\\s+unread$/i.test(valNorm)) {
                        newVal = "将所有会话标记为未读";
                    } else if (/^Version\\s+([\\d\\.]+)$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Version\\s+([\\d\\.]+)$/i, (match, v) => "版本 " + v);
                    } else if (/^Asking\\s+(\\d+)\\s+questions?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Asking\\s+(\\d+)\\s+questions?$/i, (match, num) => "正在询问 " + num + " 个问题");
                    } else if (/^View\\s+(\\d+)\\s+side\\s+questions?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^View\\s+(\\d+)\\s+side\\s+questions?$/i, (match, num) => "查看 " + num + " 个侧边提问");
                    } else if (/^Asked\\s+(\\d+)\\s+questions?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Asked\\s+(\\d+)\\s+questions?$/i, (match, num) => "已询问 " + num + " 个问题");
                    }
                } else if (/^(?:This will (?:permanently delete|archive)|Permanently delete |Are you sure you want to delete )|(?:within it[.。]?)$/i.test(valNorm)) {
                    if (/^This will permanently delete (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^This will permanently delete (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i, (match, active, archived) => {
                            if (archived) {
                                return "这将永久删除 " + active + " 个活跃会话及 " + archived + " 个已归档会话";
                            }
                            return "这将永久删除 " + active + " 个活跃会话";
                        });
                    } else if (/^This will permanently delete (\\d+) archived (?:conversations?|chats?)\\s+within it\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^This will permanently delete (\\d+) archived (?:conversations?|chats?)\\s+within it\\.?$/i, (match, archived) => "这将永久删除 " + archived + " 个已归档会话");
                    } else if (/^This will archive (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^This will archive (\\d+) active (?:conversations?|chats?)(?: and (\\d+) archived (?:conversations?|chats?))? within it\\.?$/i, (match, active, archived) => {
                            if (archived) {
                                return "这将归档其中的 " + active + " 个活跃会话及 " + archived + " 个已归档会话";
                            }
                            return "这将归档其中的 " + active + " 个活跃会话";
                        });
                    } else if (/^This will archive (\\d+)\\s*(?:active )?(?:conversations?|chats?|会话s?|个会话)(?: within it)?\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^This will archive (\\d+)\\s*(?:active )?(?:conversations?|chats?|会话s?|个会话)(?: within it)?\\.?$/i, (match, count) => "这将归档其中的 " + count + " 个会话");
                    } else if (/^(?:active (?:conversations?|chats?)|个活跃会话)\\s+within it[.。]?$/i.test(valNorm)) {
                        newVal = " 个活跃会话";
                    } else if (/^(?:archived (?:conversations?|chats?)|个已归档会话)\\s+within it[.。]?$/i.test(valNorm)) {
                        newVal = " 个已归档会话";
                    } else if (/^(?:conversations?|chats?|会话s?|个会话)\\s+within it[.。]?$/i.test(valNorm)) {
                        newVal = " 个会话";
                    } else if (/^within it[.。]?$/i.test(valNorm)) {
                        const parentText = node && node.parentElement ? (getBoundedTextContent(node.parentElement, 16, 300) || '') : '';
                        if (/(?:This will permanently delete|这将永久删除|This will archive|这将归档)/i.test(parentText)) {
                            newVal = '';
                        }
                    } else if (/^This will archive$/i.test(valNorm)) {
                        newVal = "这将归档其中的 ";
                    } else if (/^Are you sure you want to delete (?:the |this )?(project|workspace|项目|工作区) (.+?)\\??$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Are you sure you want to delete (?:the |this )?(project|workspace|项目|工作区) (.+?)\\??$/i, (match, scope, name) => {
                            const scopeLabel = /^(?:workspace|工作区)$/i.test(scope) ? "工作区" : "项目";
                            return "您确定要删除" + scopeLabel + " " + name + " 吗？";
                        });
                    } else if (/^Permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?\\.?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^Permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?\\.?$/i, (match, name, active, archived) => "永久删除 " + name + "，包含 " + active + " 个活跃会话及 " + archived + " 个已归档会话");
                    } else if (/^This will permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?(?:\\. This action cannot be undone\\.)?$/i.test(valNorm)) {
                        newVal = valNorm.replace(/^This will permanently delete (.+?) including (\\d+) active conversations? and (\\d+) archived conversations?(?:\\. This action cannot be undone\\.)?$/i, (match, name, active, archived) => "这将永久删除 " + name + "，包含 " + active + " 个活跃会话及 " + archived + " 个已归档会话，此操作无法撤销");
                    }
                } else if (/^(.+?): context deadline exceeded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): context deadline exceeded$/i, (match, prefix) => {
                        return prefix + ": 请求超时 (context deadline exceeded)";
                    });
                } else if (/^(.+?): i\\/o timeout$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): i\\/o timeout$/i, (match, prefix) => {
                        return prefix + ": I/O 超时 (i/o timeout)";
                    });
                } else if (/[a-zA-Z]{2,}/.test(valNorm)) {
                    if (valNorm.length > 21 && valNorm.includes(' ') && !unmatchedLongStrings.has(valNorm) && longScannedValues.get(node) !== originalVal && /[A-Za-z][ -~]{19,}/.test(valNorm)) {
                        longScannedValues.set(node, originalVal);
                        const beforeLong = newVal;
                        for (const [key, translated] of longEntries) {
                            if (key.length < valNorm.length && valNorm.includes(key)) {
                                newVal = replaceLongDictionaryEntry(newVal, key, translated);
                            }
                        }
                        if (newVal === beforeLong) {
                            if (unmatchedLongStrings.size > 2000) unmatchedLongStrings.clear();
                            unmatchedLongStrings.add(valNorm);
                        }
                    }

                    if (/(?:5-hour|weekly)\\s+limit/i.test(newVal)) {
                        newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                            return "您的 5 小时配额将在 " + d + " 天 " + h + " 小时后刷新";
                        });
                        newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                            return "您的 5 小时配额将在 " + h + " 小时 " + m + " 分钟后刷新";
                        });
                        newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) days?\\./gi, (match, d) => {
                            return "您的 5 小时配额将在 " + d + " 天后刷新";
                        });
                        newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) hours?\\./gi, (match, h) => {
                            return "您的 5 小时配额将在 " + h + " 小时后刷新";
                        });
                        newVal = newVal.replace(/Your 5-hour limit will refresh in (\\d+) minutes?\\./gi, (match, m) => {
                            return "您的 5 小时配额将在 " + m + " 分钟后刷新";
                        });
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) days?, (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, d, h) => {
                            return "您已达到 5 小时配额限制，将在 " + d + " 天 " + h + " 小时后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                        });
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) hours?, (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, h, m) => {
                            return "您已达到 5 小时配额限制，将在 " + h + " 小时 " + m + " 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                        });
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) days?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, d) => {
                            return "您已达到 5 小时配额限制，将在 " + d + " 天后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                        });
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) hours?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, h) => {
                            return "您已达到 5 小时配额限制，将在 " + h + " 小时后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                        });
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in (\\d+) minutes?\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, (match, m) => {
                            return "您已达到 5 小时配额限制，将在 " + m + " 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                            return "您已使用部分每周配额，将在 " + d + " 天 " + h + " 小时后完全刷新";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                            return "您已使用部分每周配额，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) days?\\./gi, (match, d) => {
                            return "您已使用部分每周配额，将在 " + d + " 天后完全刷新";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) hours?\\./gi, (match, h) => {
                            return "您已使用部分每周配额，将在 " + h + " 小时后完全刷新";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in (\\d+) minutes?\\./gi, (match, m) => {
                            return "您已使用部分每周配额，将在 " + m + " 分钟后完全刷新";
                        });
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) days?, (\\d+) hours?\\./gi, (match, d, h) => {
                            return "您已达到每周配额限制，将在 " + d + " 天 " + h + " 小时后完全刷新";
                        });
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) hours?, (\\d+) minutes?\\./gi, (match, h, m) => {
                            return "您已达到每周配额限制，将在 " + h + " 小时 " + m + " 分钟后完全刷新";
                        });
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) days?\\./gi, (match, d) => {
                            return "您已达到每周配额限制，将在 " + d + " 天后完全刷新";
                        });
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) hours?\\./gi, (match, h) => {
                            return "您已达到每周配额限制，将在 " + h + " 小时后完全刷新";
                        });
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in (\\d+) minutes?\\./gi, (match, m) => {
                            return "您已达到每周配额限制，将在 " + m + " 分钟后完全刷新";
                        });
                        newVal = newVal.replace(/You have used some of your weekly limit, it will fully refresh in less than a minute\\./gi, "您已使用部分每周配额，将在不到 1 分钟后完全刷新");
                        newVal = newVal.replace(/You have hit your weekly limit, it will fully refresh in less than a minute\\./gi, "您已达到每周配额限制，将在不到 1 分钟后完全刷新");
                        newVal = newVal.replace(/Your 5-hour limit will refresh in less than a minute\\./gi, "您的 5 小时配额将在不到 1 分钟后刷新");
                        newVal = newVal.replace(/You have hit your 5-hour limit, it will refresh in less than a minute\\. If on a supported paid plan, you can use AI credits in the interim\\./gi, "您已达到 5 小时配额限制，将在不到 1 分钟后刷新. 如果使用的是受支持的付费计划，您可以在此期间使用 AI 额度.");
                    }
                    if (newVal.includes('(')) {
                        newVal = newVal.replace(/Match case \\((.+)\\)/gi, (m, k) => "区分大小写 (" + k + ")");
                        newVal = newVal.replace(/Match whole word \\((.+)\\)/gi, (m, k) => "全字匹配 (" + k + ")");
                        newVal = newVal.replace(/Use regular expression \\((.+)\\)/gi, (m, k) => "使用正则表达式 (" + k + ")");
                        newVal = newVal.replace(/Previous match \\((.+)\\)/gi, (m, k) => "上一个匹配项 (" + k + ")");
                        newVal = newVal.replace(/Next match \\((.+)\\)/gi, (m, k) => "下一个匹配项 (" + k + ")");
                        newVal = newVal.replace(/Close \\((.+)\\)/gi, (m, k) => "关闭 (" + k + ")");
                    }
                }
                if (hasRecommended) {
                    newVal = '（推荐）' + newVal;
                }
                if (newVal !== originalVal) {
                    const leadingMatch = originalVal.match(/^\\s+/);
                    const trailingMatch = originalVal.match(/\\s+$/);
                    if (leadingMatch && !newVal.startsWith(leadingMatch[0])) {
                        newVal = leadingMatch[0] + newVal;
                    }
                    if (trailingMatch && !newVal.endsWith(trailingMatch[0])) {
                        newVal = newVal + trailingMatch[0];
                    }
                    if (newVal !== originalVal) {
                        translatedValues.set(node, newVal);
                        node.nodeValue = newVal;
                        return;
                    }
                }
                if (parentEl && parentEl.childNodes.length === 1) {
                    translatedValues.set(node, originalVal);
                }
            }
        } catch (e) {}
    }

    const isPluginSubframe = (() => {
        try {
            return Boolean(globalThis.location && typeof globalThis.location.protocol === 'string' && globalThis.location.protocol.toLowerCase() === 'plugin:');
        } catch (e) {
            return false;
        }
    })();

    const UX_LAYOUT_STORAGE_KEY = "ag_ux_compact_wide";
    const UX_LAYOUT_STYLE_ID = "ag-ux-compact-wide-style";

    function isCompactWideEnabled() {
        try {
            const saved = window.localStorage.getItem(UX_LAYOUT_STORAGE_KEY);
            return saved === null ? true : saved === "on";
        } catch (e) {
            return true;
        }
    }

    function applyCompactWideAttribute(enabled) {
        const root = document.documentElement;
        if (!root) return;
        root.setAttribute("data-ag-ux-layout", enabled ? "on" : "off");
    }

    function ensureCompactWideStyle() {
        if (document.getElementById(UX_LAYOUT_STYLE_ID)) return;
        const host = document.head || document.documentElement;
        if (!host) return;
        const styleEl = document.createElement("style");
        styleEl.id = UX_LAYOUT_STYLE_ID;
        styleEl.textContent = [
            'html[data-ag-ux-layout="on"], html[data-ag-ux-layout="on"] body {',
            '  overscroll-behavior: none;',
            '}',
            'html[data-ag-ux-layout="on"] {',
            '  --max-conversation-width: 94% !important;',
            '  --max-artifact-width: 94% !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="user-input-step"] [class*="max-w-[80%]"] {',
            '  max-width: 88% !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="autoscroll-viewport"] div:has(> h1.sr-only) {',
            '  row-gap: 0.25rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="user-input-step"] {',
            '  padding-top: 0.5rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [role="article"][aria-label="User message"],',
            'html[data-ag-ux-layout="on"] [role="article"][aria-label="用户消息"] {',
            '  margin-bottom: 0.375rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] .md-sticky-message-bleed::after {',
            '  height: 0.875rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-turn-content] > div.pt-3 {',
            '  padding-top: 0.25rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="turn-cards-container"] {',
            '  padding-top: 0.125rem !important;',
            '  padding-bottom: 0.125rem !important;',
            '  gap: 0.25rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] {',
            '  padding-top: 0.125rem !important;',
            '  padding-bottom: 0.125rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] :is(p, ul, ol, pre, blockquote) {',
            '  margin-top: 0.375rem !important;',
            '  margin-bottom: 0.375rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] > :first-child,',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] > div > :first-child {',
            '  margin-top: 0 !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] > :last-child,',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] > div > :last-child {',
            '  margin-bottom: 0 !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] li + li {',
            '  margin-top: 0.15rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-testid="planner-response-text"] hr {',
            '  margin-top: 0.625rem !important;',
            '  margin-bottom: 0.625rem !important;',
            '}',
            'html[data-ag-ux-layout="on"] [data-media-drop-scope] > div.pb-8 {',
            '  padding-bottom: 0.875rem !important;',
            '}'
        ].join("\\n");
        host.appendChild(styleEl);
    }

    function syncCompactWideSwitchButton(btn, thumb, enabled) {
        btn.setAttribute("aria-checked", enabled ? "true" : "false");
        btn.className = "relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 h-6 w-11 cursor-pointer " + (enabled ? "bg-primary" : "bg-secondary");
        thumb.style.transform = enabled ? "translateX(24px)" : "translateX(4px)";
    }

    let uxSettingsRafPending = false;
    function scheduleMountCompactWideSetting() {
        if (uxSettingsRafPending) return;
        uxSettingsRafPending = true;
        window.requestAnimationFrame(() => {
            uxSettingsRafPending = false;
            try {
                mountCompactWideSettingRow();
            } catch (e) {}
        });
    }

    function mountCompactWideSettingRow() {
        const headings = document.querySelectorAll("h3");
        if (!headings.length) return;
        for (let i = 0; i < headings.length; i++) {
            const h3 = headings[i];
            if (h3.childElementCount > 0) continue;
            const title = (h3.textContent || "").trim();
            if (title !== "聊天宽度" && title !== "Chat Width") continue;
            const sectionRoot = h3.closest(".space-y-2") || (h3.parentElement && h3.parentElement.parentElement && h3.parentElement.parentElement.parentElement);
            if (!sectionRoot) continue;
            const card = sectionRoot.querySelector(".agy-card");
            if (!card || card.querySelector('[data-ag-ux-compact-row="true"]')) continue;

            const row = document.createElement("div");
            row.setAttribute("data-ag-ux-compact-row", "true");
            row.setAttribute("data-ag-localization-skip", "true");
            row.className = "py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center";

            const leftCol = document.createElement("div");
            leftCol.className = "flex-1 flex flex-col gap-0.5";

            const labelWrap = document.createElement("div");
            labelWrap.className = "flex items-center gap-1.5";

            const labelEl = document.createElement("span");
            labelEl.className = "text-sm";
            labelEl.id = "ag-ux-compact-wide-label";
            labelEl.textContent = "紧凑加宽布局";

            const badgeEl = document.createElement("span");
            badgeEl.className = "text-[10px] font-semibold leading-none bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full select-none border border-border";
            badgeEl.textContent = "94%";

            labelWrap.appendChild(labelEl);
            labelWrap.appendChild(badgeEl);

            const descEl = document.createElement("span");
            descEl.className = "text-xs text-muted-foreground whitespace-pre-wrap";
            descEl.textContent = "固定 94% 黄金对话宽度，并收紧消息与段落垂直间距（即时生效）。";

            leftCol.appendChild(labelWrap);
            leftCol.appendChild(descEl);

            const rightCol = document.createElement("div");
            rightCol.className = "shrink-0";

            const switchBtn = document.createElement("button");
            switchBtn.type = "button";
            switchBtn.setAttribute("role", "switch");
            switchBtn.setAttribute("aria-labelledby", "ag-ux-compact-wide-label");

            const thumbEl = document.createElement("span");
            thumbEl.className = "inline-block rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm h-4 w-4";
            switchBtn.appendChild(thumbEl);

            syncCompactWideSwitchButton(switchBtn, thumbEl, isCompactWideEnabled());

            switchBtn.addEventListener("click", () => {
                const next = !isCompactWideEnabled();
                try {
                    window.localStorage.setItem(UX_LAYOUT_STORAGE_KEY, next ? "on" : "off");
                } catch (e) {}
                applyCompactWideAttribute(next);
                ensureCompactWideStyle();
                syncCompactWideSwitchButton(switchBtn, thumbEl, next);
            });

            rightCol.appendChild(switchBtn);
            row.appendChild(leftCol);
            row.appendChild(rightCol);
            card.appendChild(row);
        }
    }


    if (!isPluginSubframe) {
        applyCompactWideAttribute(isCompactWideEnabled());
        ensureCompactWideStyle();
    }

    const observer = new MutationObserver(mutations => {
        try {
            const visitedElements = new WeakSet();
            let hasAddedElements = false;
            for (const m of mutations) {
                if (m.type === 'childList') {
                    for (const n of m.addedNodes) {
                        if (n.nodeType === 1) hasAddedElements = true;
                        translateNode(n, false, visitedElements);
                    }
                } else if (m.type === 'characterData') {
                    translateNode(m.target, false, visitedElements);
                } else if (m.type === 'attributes') {
                    translateElementAttributes(m.target);
                }
            }
            if (!isPluginSubframe) {
                if (hasAddedElements) {
                    scheduleMountCompactWideSetting();
                }
                if (typeof globalThis.__agScheduleOfficePreviewSync === "function") {
                    globalThis.__agScheduleOfficePreviewSync();
                }
                if (typeof globalThis.__agScheduleMemeSync === "function") {
                    globalThis.__agScheduleMemeSync();
                }
            }
        } catch (e) {}
    });

    const obsOpts = {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-placeholder', 'data-placeholder', 'title', 'aria-label', 'data-uri', 'href']
    };

    let engineStarted = false;
    const startEngine = () => {
        if (!isPluginSubframe) {
            applyCompactWideAttribute(isCompactWideEnabled());
            ensureCompactWideStyle();
        }
        const target = document.body || document.documentElement;
        if (!target || engineStarted) return;

        engineStarted = true;
        try {
            translateNode(target);
            if (!isPluginSubframe) {
                scheduleMountCompactWideSetting();
                if (typeof globalThis.__agScheduleOfficePreviewSync === "function") {
                    globalThis.__agScheduleOfficePreviewSync();
                }
                if (typeof globalThis.__agScheduleMemeSync === "function") {
                    globalThis.__agScheduleMemeSync();
                }
            }
            observer.observe(target, obsOpts);
        } catch (e) {}
    };

    const CONTEXT_MENU_EXACT_MAP = {
        "Rename": "重命名",
        "Mark Unread": "标记为未读",
        "Mark Read": "标记为已读",
        "Copy": "复制",
        "Split": "拆分",
        "Archive": "归档",
        "Delete": "删除",
        "Stop": "停止",
        "Pin": "置顶",
        "Unpin": "取消置顶",
        "Conversation Name": "会话名称",
        "Conversation ID": "会话 ID",
        "Project Name": "项目名称",
        "Workspace Name": "工作区名称",
        "Worktree Name": "工作树名称",
        "Split Right": "向右拆分",
        "Split Down": "向下拆分",
        "Replace with New": "替换为新会话",
        "Replace With New": "替换为新会话",
        "Remove from Split": "从拆分中移除",
        "Remove From Split": "从拆分中移除",
        "Copy File Path": "复制文件路径",
        "Copy File Name": "复制文件名称",
        "Comment": "评论",
        "Quote": "引用",
        "Add to Chat": "添加到聊天",
        "Add to Chat/Quote": "添加到聊天/引用",
        "Copy Image": "复制图片",
        "Save Image": "保存图片",
        "Copy Video": "复制视频",
        "Save Video": "保存视频",
        "Cut": "剪切",
        "Paste": "粘贴",
        "Select All": "全选",
        "Close Tab": "关闭标签页",
        "Close Other Tabs": "关闭其他标签页",
        "Close Tabs to the Right": "关闭右侧标签页",
        "Back": "后退",
        "Forward": "前进",
        "Reload": "重新加载",
        "Open in External Browser": "在外部浏览器中打开",
        "Open in Built-in Browser": "在内置浏览器中打开",
        "Open in Browser": "在浏览器中打开",
        "Open in": "打开方式",
        "Open In": "打开方式",
        "Built-in Browser (Default)": "内置浏览器 (默认)",
        "External Browser": "外部浏览器",
        "Settings": "设置",
        "Copy Message": "复制消息",
        "Undo to Here": "撤销至此处",
        "Copy Link": "复制链接",
        "Reopen Closed Tab": "重新打开关闭的标签页",
        "Move Conversation Up": "向上移动会话",
        "Move Conversation Down": "向下移动会话",
        "Background Commands": "后台命令",
        "Background Tasks": "后台任务"
    };

    function translateContextMenuLabel(label, id) {
        if (typeof label !== 'string' || !label) return label;
        const itemId = String(id || '');
        if (/^group-(?!new$|remove$)/i.test(itemId)) return label;
        const trimmed = norm(label);
        if (!trimmed) return label;
        if (CONTEXT_MENU_EXACT_MAP[trimmed]) return CONTEXT_MENU_EXACT_MAP[trimmed];
        return label;
    }

    function translateContextMenuItems(items) {
        if (!Array.isArray(items)) return items;
        return items.map(item => {
            if (!item || typeof item !== 'object') return item;
            const next = Object.assign({}, item);
            if (typeof next.label === 'string') {
                next.label = translateContextMenuLabel(next.label, next.id);
            }
            if (Array.isArray(next.submenu)) {
                next.submenu = translateContextMenuItems(next.submenu);
            }
            if (Array.isArray(next.items)) {
                next.items = translateContextMenuItems(next.items);
            }
            return next;
        });
    }

    globalThis.__agTranslateContextMenuItems = translateContextMenuItems;

    const origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function() {
        const sr = origAttachShadow.apply(this, arguments);
        try { observer.observe(sr, obsOpts); } catch(e) {}
        return sr;
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);
})();
${SIGNATURE_END}`;

    const baseJs = jsSource
        .replace("DICT_PLACEHOLDER", () => dictJson)
        .replace("REPLACEMENT_ENTRIES_PLACEHOLDER", () => entriesJson);

    const officeRendererSnippet = [
        "(() => {",
        "  try {",
        "    const proto = (typeof globalThis !== 'undefined' && globalThis.location && typeof globalThis.location.protocol === 'string')",
        "      ? globalThis.location.protocol.toLowerCase()",
        "      : '';",
        "    if (proto === 'plugin:') return;",
        "    const invokeFn = (typeof electron_1 !== 'undefined' && electron_1 && electron_1.ipcRenderer && typeof electron_1.ipcRenderer.invoke === 'function')",
        "      ? electron_1.ipcRenderer.invoke.bind(electron_1.ipcRenderer)",
        "      : null;",
        "    try { (" + __agSetupOfficePreviewRenderer.toString() + ")(invokeFn); } catch (e) { try { console.error('[AG-UX Office]', e); } catch (_) {} }",
        "    try { (" + __agSetupMemeRenderer.toString() + ")(invokeFn); } catch (e) { try { console.error('[AG-UX Meme]', e); } catch (_) {} }",
        "  } catch (e) { try { console.error('[AG-UX Init]', e); } catch (_) {} }",
        "})();"
    ].join("\n");

    const sigEndIdx = baseJs.lastIndexOf(SIGNATURE_END);
    if (sigEndIdx !== -1) {
        return baseJs.substring(0, sigEndIdx) + officeRendererSnippet + "\n" + baseJs.substring(sigEndIdx);
    }
    return baseJs;
}

function __agRegisterOfficeIpcHandlers(electron_1, url_1, wsl_1) {
    const fsSync = require("fs");
    const pathMod = require("path");
    const zlibMod = require("zlib");

    const MAX_OFFICE_FILE_BYTES = 80 * 1024 * 1024;
    const MAX_ZIP_ENTRY_BYTES = 48 * 1024 * 1024;
    const MAX_XLSX_SHEETS = 25;
    const MAX_XLSX_ROWS = 400;
    const MAX_XLSX_COLS = 52;
    const MAX_DOCX_BLOCKS = 800;

    function assertMainFrame(event) {
        if (event && event.senderFrame && event.senderFrame.parent) {
            throw new Error("Unauthorized subframe Office IPC call");
        }
    }

    function resolveNativePath(uriOrPath) {
        if (typeof uriOrPath !== "string" || !uriOrPath.trim()) {
            throw new Error("Empty file path");
        }
        const raw = uriOrPath.trim().split("#")[0].split("?")[0];
        const distro = wsl_1 && typeof wsl_1.getActiveWslDistro === "function"
            ? wsl_1.getActiveWslDistro()
            : null;
        if (distro && raw.startsWith("file://")) {
            const posixPath = url_1.fileURLToPath(raw, { windows: false });
            return wsl_1.distroToWindowsPath(posixPath, distro);
        }
        if (raw.startsWith("file://")) {
            return url_1.fileURLToPath(raw);
        }
        return raw;
    }

    function decodeXml(str) {
        if (!str) return "";
        return str
            .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => {
                const code = parseInt(hex, 16);
                return code === 13 ? "" : String.fromCharCode(code);
            })
            .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, "&");
    }

    function getXmlAttr(attrText, name) {
        if (!attrText) return "";
        const re = new RegExp("(?:^|\\s)(?:[A-Za-z0-9_]+:)?" + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
        const m = re.exec(attrText);
        if (!m) return "";
        return decodeXml(m[1] !== undefined ? m[1] : m[2]);
    }

    function openZipBuffer(buf) {
        const minEocd = 22;
        if (!Buffer.isBuffer(buf) || buf.length < minEocd) {
            throw new Error("文件不是有效的 ZIP/OOXML 容器");
        }
        const maxSearch = Math.min(buf.length, 65558);
        let eocdPos = -1;
        for (let i = buf.length - minEocd; i >= buf.length - maxSearch; i--) {
            if (buf.readUInt32LE(i) === 0x06054b50) {
                eocdPos = i;
                break;
            }
        }
        if (eocdPos === -1) {
            throw new Error("未找到 ZIP 目录索引（可能是加密文档或旧版二进制格式）");
        }
        const cdSize = buf.readUInt32LE(eocdPos + 12);
        const cdOffset = buf.readUInt32LE(eocdPos + 16);
        if (cdOffset === 0xffffffff || cdOffset + cdSize > buf.length) {
            throw new Error("不支持 ZIP64 超大归档或归档已损坏");
        }

        const entries = new Map();
        let ptr = cdOffset;
        const cdEnd = cdOffset + cdSize;
        while (ptr + 46 <= cdEnd) {
            if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
            const compMethod = buf.readUInt16LE(ptr + 10);
            const compSize = buf.readUInt32LE(ptr + 20);
            const uncompSize = buf.readUInt32LE(ptr + 24);
            const nameLen = buf.readUInt16LE(ptr + 28);
            const extraLen = buf.readUInt16LE(ptr + 30);
            const commentLen = buf.readUInt16LE(ptr + 32);
            const localHeaderOffset = buf.readUInt32LE(ptr + 42);
            const nameStart = ptr + 46;
            if (nameStart + nameLen > buf.length) break;
            const rawName = buf.toString("utf8", nameStart, nameStart + nameLen).replace(/\\/g, "/");
            entries.set(rawName, { compMethod, compSize, uncompSize, localHeaderOffset });
            ptr = nameStart + nameLen + extraLen + commentLen;
        }

        return {
            entries,
            has(name) {
                return entries.has(name);
            },
            readText(name) {
                const entry = entries.get(name);
                if (!entry) return null;
                if (entry.uncompSize > MAX_ZIP_ENTRY_BYTES) {
                    throw new Error("单工作表 XML 体积超过安全预览上限 (48MB)");
                }
                const lh = entry.localHeaderOffset;
                if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== 0x04034b50) {
                    throw new Error("ZIP 本地文件头损坏: " + name);
                }
                const lfNameLen = buf.readUInt16LE(lh + 26);
                const lfExtraLen = buf.readUInt16LE(lh + 28);
                const dataStart = lh + 30 + lfNameLen + lfExtraLen;
                const dataEnd = dataStart + entry.compSize;
                if (dataEnd > buf.length) {
                    throw new Error("ZIP 数据区越界: " + name);
                }
                const slice = buf.subarray(dataStart, dataEnd);
                if (entry.compMethod === 0) {
                    return slice.toString("utf8");
                }
                if (entry.compMethod === 8) {
                    const out = zlibMod.inflateRawSync(slice, { maxOutputLength: MAX_ZIP_ENTRY_BYTES });
                    return out.toString("utf8");
                }
                throw new Error("不支持的压缩算法 (method=" + entry.compMethod + ")");
            }
        };
    }

    function colLettersToIndex(letters) {
        let idx = 0;
        for (let i = 0; i < letters.length; i++) {
            const ch = letters.charCodeAt(i);
            const upper = ch >= 97 ? ch - 32 : ch;
            if (upper < 65 || upper > 90) break;
            idx = idx * 26 + (upper - 64);
        }
        return idx - 1;
    }

    function parseCellRef(ref) {
        const m = /^([A-Za-z]+)(\d+)$/.exec(ref || "");
        if (!m) return null;
        return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
    }

    function formatExcelDateSerial(serial) {
        if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return String(serial);
        const wholeDays = Math.floor(serial);
        const adjustedDays = wholeDays > 59 ? wholeDays - 1 : wholeDays;
        const utcMs = Date.UTC(1899, 11, 31) + adjustedDays * 86400000;
        const dt = new Date(utcMs);
        const y = dt.getUTCFullYear();
        const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
        const da = String(dt.getUTCDate()).padStart(2, "0");
        const frac = serial - wholeDays;
        if (frac > 1e-6) {
            const totalMinutes = Math.round(frac * 1440);
            const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
            const mm = String(totalMinutes % 60).padStart(2, "0");
            return y + "-" + mo + "-" + da + " " + hh + ":" + mm;
        }
        return y + "-" + mo + "-" + da;
    }

    function formatExcelNumber(rawVal, isDate) {
        const num = Number(rawVal);
        if (!Number.isFinite(num)) return rawVal;
        if (isDate) return formatExcelDateSerial(num);
        if (Math.abs(num) < 1e15 && !Number.isInteger(num)) {
            return String(Number(num.toPrecision(15)));
        }
        return String(num);
    }

    function parseXlsxStyles(stylesXml) {
        const isDateStyle = [];
        if (!stylesXml) return isDateStyle;
        const builtinDateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
        const customDateIds = new Set();
        const numFmtRe = /<(?:[A-Za-z0-9_]+:)?numFmt\b([^>]*)\/?>/g;
        let m;
        while ((m = numFmtRe.exec(stylesXml)) !== null) {
            const id = parseInt(getXmlAttr(m[1], "numFmtId"), 10);
            const code = getXmlAttr(m[1], "formatCode");
            if (!Number.isNaN(id) && code) {
                const cleaned = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
                if (/[ymdhs]/i.test(cleaned) && !/[#0?]/.test(cleaned)) {
                    customDateIds.add(id);
                }
            }
        }
        const cellXfsMatch = /<(?:[A-Za-z0-9_]+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?cellXfs>/.exec(stylesXml);
        if (cellXfsMatch) {
            const xfRe = /<(?:[A-Za-z0-9_]+:)?xf\b([^>]*)(?:\/>|>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?xf>)/g;
            let xm;
            while ((xm = xfRe.exec(cellXfsMatch[1])) !== null) {
                const fmtId = parseInt(getXmlAttr(xm[1], "numFmtId"), 10);
                isDateStyle.push(builtinDateIds.has(fmtId) || customDateIds.has(fmtId));
            }
        }
        return isDateStyle;
    }

    function parseXlsxSharedStrings(sstXml) {
        const strings = [];
        if (!sstXml) return strings;
        const siRe = /<(?:[A-Za-z0-9_]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?si>/g;
        let m;
        while ((m = siRe.exec(sstXml)) !== null) {
            const withoutPhonetic = m[1].replace(/<(?:[A-Za-z0-9_]+:)?rPh\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?rPh>/g, "");
            const tRe = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g;
            let parts = "";
            let tm;
            while ((tm = tRe.exec(withoutPhonetic)) !== null) {
                parts += decodeXml(tm[1]);
            }
            strings.push(parts);
        }
        return strings;
    }

    function resolveZipTarget(zip, rawTarget, basePrefix) {
        if (!rawTarget) return null;
        const clean = rawTarget.replace(/^\/+/, "");
        if (zip.has(clean)) return clean;
        const withBase = basePrefix + clean.replace(/^\.\//, "");
        if (zip.has(withBase)) return withBase;
        return null;
    }

    function parseXlsx(zip, meta) {
        const wbXml = zip.readText("xl/workbook.xml");
        if (!wbXml) throw new Error("缺少 xl/workbook.xml，不是标准 Excel 工作簿");
        const relsXml = zip.readText("xl/_rels/workbook.xml.rels") || "";
        const relMap = new Map();
        const relRe = /<(?:[A-Za-z0-9_]+:)?Relationship\b([^>]*)\/?>/g;
        let rm;
        while ((rm = relRe.exec(relsXml)) !== null) {
            const id = getXmlAttr(rm[1], "Id");
            const target = getXmlAttr(rm[1], "Target");
            if (id && target) relMap.set(id, target);
        }

        const sharedStrings = parseXlsxSharedStrings(zip.readText("xl/sharedStrings.xml"));
        const isDateStyle = parseXlsxStyles(zip.readText("xl/styles.xml"));

        const sheetMetaList = [];
        const sheetRe = /<(?:[A-Za-z0-9_]+:)?sheet\b([^>]*)\/?>/g;
        let sm;
        while ((sm = sheetRe.exec(wbXml)) !== null) {
            const name = getXmlAttr(sm[1], "name") || ("Sheet" + (sheetMetaList.length + 1));
            const rId = getXmlAttr(sm[1], "id");
            const state = getXmlAttr(sm[1], "state") || "visible";
            const rawTarget = relMap.get(rId) || ("worksheets/sheet" + (sheetMetaList.length + 1) + ".xml");
            const zipPath = resolveZipTarget(zip, rawTarget, "xl/");
            if (zipPath) {
                sheetMetaList.push({ name, state, zipPath });
            }
        }

        const sheets = [];
        const limitSheets = sheetMetaList.slice(0, MAX_XLSX_SHEETS);
        for (let sIdx = 0; sIdx < limitSheets.length; sIdx++) {
            const sMeta = limitSheets[sIdx];
            let xml = "";
            try {
                xml = zip.readText(sMeta.zipPath) || "";
            } catch (e) {
                sheets.push({
                    name: sMeta.name,
                    hidden: sMeta.state !== "visible",
                    rows: [],
                    merges: [],
                    colCount: 0,
                    totalRows: 0,
                    truncatedRows: false,
                    error: e.message
                });
                continue;
            }

            const merges = [];
            const mergeRe = /<(?:[A-Za-z0-9_]+:)?mergeCell\b([^>]*)\/?>/g;
            let mm;
            while ((mm = mergeRe.exec(xml)) !== null) {
                const ref = getXmlAttr(mm[1], "ref");
                const parts = ref.split(":");
                if (parts.length === 2) {
                    const a = parseCellRef(parts[0]);
                    const b = parseCellRef(parts[1]);
                    if (a && b && a.row < MAX_XLSX_ROWS && a.col < MAX_XLSX_COLS) {
                        merges.push({
                            r1: Math.min(a.row, b.row),
                            c1: Math.min(a.col, b.col),
                            r2: Math.min(Math.max(a.row, b.row), MAX_XLSX_ROWS - 1),
                            c2: Math.min(Math.max(a.col, b.col), MAX_XLSX_COLS - 1)
                        });
                    }
                }
            }

            const rowMap = new Map();
            let maxRowSeen = -1;
            let maxColSeen = -1;
            let seqRow = 0;

            const rowRe = /<(?:[A-Za-z0-9_]+:)?row\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>)/g;
            let rMatch;
            while ((rMatch = rowRe.exec(xml)) !== null) {
                const rAttr = parseInt(getXmlAttr(rMatch[1], "r"), 10);
                const rIdx = !Number.isNaN(rAttr) && rAttr >= 1 ? rAttr - 1 : seqRow;
                seqRow = rIdx + 1;
                if (rIdx > maxRowSeen) maxRowSeen = rIdx;
                if (rIdx >= MAX_XLSX_ROWS || !rMatch[2]) continue;

                const rowCells = [];
                let seqCol = 0;
                const cellRe = /<(?:[A-Za-z0-9_]+:)?c\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/g;
                let cMatch;
                while ((cMatch = cellRe.exec(rMatch[2])) !== null) {
                    const cRefStr = getXmlAttr(cMatch[1], "r");
                    const parsedRef = cRefStr ? parseCellRef(cRefStr) : null;
                    const cIdx = parsedRef ? parsedRef.col : seqCol;
                    seqCol = cIdx + 1;
                    if (cIdx >= MAX_XLSX_COLS) continue;

                    const cType = getXmlAttr(cMatch[1], "t");
                    const sAttr = parseInt(getXmlAttr(cMatch[1], "s"), 10);
                    const inner = cMatch[2] || "";

                    let formula = "";
                    const fMatch = /<(?:[A-Za-z0-9_]+:)?f(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?f>/.exec(inner);
                    if (fMatch) {
                        formula = decodeXml(fMatch[1]).trim();
                    }

                    let val = "";
                    let isNum = false;
                    if (cType === "inlineStr") {
                        const tRe = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g;
                        let tm;
                        while ((tm = tRe.exec(inner)) !== null) val += decodeXml(tm[1]);
                    } else {
                        const vMatch = /<(?:[A-Za-z0-9_]+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/.exec(inner);
                        const rawV = vMatch ? decodeXml(vMatch[1]).trim() : "";
                        if (cType === "s") {
                            const sstIdx = parseInt(rawV, 10);
                            val = !Number.isNaN(sstIdx) && sharedStrings[sstIdx] !== undefined ? sharedStrings[sstIdx] : rawV;
                        } else if (cType === "b") {
                            val = rawV === "1" ? "TRUE" : rawV === "0" ? "FALSE" : rawV;
                        } else if (cType === "str" || cType === "e") {
                            val = rawV;
                        } else if (rawV !== "") {
                            const dateFlag = !Number.isNaN(sAttr) && Boolean(isDateStyle[sAttr]);
                            val = formatExcelNumber(rawV, dateFlag);
                            isNum = !dateFlag && Number.isFinite(Number(rawV));
                        }
                    }

                    if (val !== "" || formula !== "") {
                        if (cIdx > maxColSeen) maxColSeen = cIdx;
                        const cellObj = { c: cIdx, v: val };
                        if (formula) cellObj.f = formula;
                        if (isNum) cellObj.n = 1;
                        rowCells.push(cellObj);
                    }
                }
                if (rowCells.length > 0) {
                    rowMap.set(rIdx, rowCells);
                }
            }

            for (let mi = 0; mi < merges.length; mi++) {
                if (merges[mi].c2 > maxColSeen) maxColSeen = merges[mi].c2;
            }

            let lastNonEmptyRow = -1;
            for (const rk of rowMap.keys()) {
                if (rk > lastNonEmptyRow) lastNonEmptyRow = rk;
            }
            for (let mi = 0; mi < merges.length; mi++) {
                if (merges[mi].r2 > lastNonEmptyRow) lastNonEmptyRow = merges[mi].r2;
            }

            const effectiveRowCount = lastNonEmptyRow >= 0 ? Math.min(lastNonEmptyRow + 1, MAX_XLSX_ROWS) : 0;
            const rows = [];
            for (let r = 0; r < effectiveRowCount; r++) {
                rows.push(rowMap.get(r) || []);
            }

            sheets.push({
                name: sMeta.name,
                hidden: sMeta.state !== "visible",
                rows,
                merges,
                colCount: maxColSeen >= 0 ? Math.min(maxColSeen + 1, MAX_XLSX_COLS) : 0,
                totalRows: maxRowSeen + 1,
                truncatedRows: maxRowSeen + 1 > MAX_XLSX_ROWS
            });
        }

        return {
            ok: true,
            kind: "xlsx",
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            path: meta.path,
            sheets,
            truncatedSheets: sheetMetaList.length > MAX_XLSX_SHEETS
        };
    }

    function parseWordParagraph(pXml) {
        const pPrMatch = /<(?:[A-Za-z0-9_]+:)?pPr\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?pPr>/.exec(pXml);
        const pPr = pPrMatch ? pPrMatch[1] : "";
        const styleMatch = /<(?:[A-Za-z0-9_]+:)?pStyle\b[^>]*\b(?:[A-Za-z0-9_]+:)?val\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(pPr);
        const rawStyle = styleMatch ? (styleMatch[1] || styleMatch[2] || "") : "";
        let heading = 0;
        const hm = /^(?:Heading|标题|heading)\s*([1-6])$/i.exec(rawStyle) || /^([1-4])$/.exec(rawStyle);
        if (hm) heading = Math.min(parseInt(hm[1], 10), 4);
        else if (/^Title$/i.test(rawStyle)) heading = 1;
        else if (/^Subtitle$/i.test(rawStyle)) heading = 2;

        const isList = /<(?:[A-Za-z0-9_]+:)?numPr\b/.test(pPr);
        const jcMatch = /<(?:[A-Za-z0-9_]+:)?jc\b[^>]*\b(?:[A-Za-z0-9_]+:)?val\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(pPr);
        const align = jcMatch ? (jcMatch[1] || jcMatch[2] || "") : "";

        const runs = [];
        const runRe = /<(?:[A-Za-z0-9_]+:)?r\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?r>/g;
        let rm;
        while ((rm = runRe.exec(pXml)) !== null) {
            const rInner = rm[1];
            const withoutDel = rInner.replace(/<(?:[A-Za-z0-9_]+:)?delText\b[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?delText>/g, "");
            const rPrMatch = /<(?:[A-Za-z0-9_]+:)?rPr\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?rPr>/.exec(withoutDel);
            const rPr = rPrMatch ? rPrMatch[1] : "";
            const bold = /<(?:[A-Za-z0-9_]+:)?b(?:\s*\/>|\s+[^>]*val\s*=\s*(?:"(?:true|1)"|'(?:true|1)')|>)/.test(rPr) &&
                !/<(?:[A-Za-z0-9_]+:)?b\b[^>]*val\s*=\s*(?:"(?:false|0)"|'(?:false|0)')/.test(rPr);

            const tokenRe = /<(?:[A-Za-z0-9_]+:)?(t|tab|br|cr)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?\1>)/g;
            let textBuf = "";
            let tm;
            while ((tm = tokenRe.exec(withoutDel)) !== null) {
                const tag = tm[1];
                if (tag === "t") textBuf += decodeXml(tm[3] || "");
                else if (tag === "tab") textBuf += "\t";
                else if (tag === "br" || tag === "cr") textBuf += "\n";
            }
            if (textBuf) {
                const prev = runs[runs.length - 1];
                if (prev && Boolean(prev.b) === bold) {
                    prev.t += textBuf;
                } else {
                    const item = { t: textBuf };
                    if (bold) item.b = 1;
                    runs.push(item);
                }
            }
        }
        return { heading, isList, align, runs };
    }

    function parseWordTable(tblXml) {
        const rows = [];
        const trRe = /<(?:[A-Za-z0-9_]+:)?tr\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?tr>/g;
        let trm;
        while ((trm = trRe.exec(tblXml)) !== null && rows.length < 200) {
            const cells = [];
            const tcRe = /<(?:[A-Za-z0-9_]+:)?tc\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?tc>/g;
            let tcm;
            while ((tcm = tcRe.exec(trm[1])) !== null && cells.length < 40) {
                const tcInner = tcm[1];
                const tcPrMatch = /<(?:[A-Za-z0-9_]+:)?tcPr\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?tcPr>/.exec(tcInner);
                const tcPr = tcPrMatch ? tcPrMatch[1] : "";
                const spanMatch = /<(?:[A-Za-z0-9_]+:)?gridSpan\b[^>]*\b(?:[A-Za-z0-9_]+:)?val\s*=\s*(?:"(\d+)"|'(\d+)')/.exec(tcPr);
                const colspan = spanMatch ? Math.max(1, parseInt(spanMatch[1] || spanMatch[2], 10)) : 1;

                let vMerge = null;
                const vmTag = /<(?:[A-Za-z0-9_]+:)?vMerge\b([^>]*)\/?>/.exec(tcPr);
                if (vmTag) {
                    const vmVal = getXmlAttr(vmTag[1], "val");
                    vMerge = vmVal === "restart" ? "restart" : "continue";
                }

                const lines = [];
                const pRe = /<(?:[A-Za-z0-9_]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?p>/g;
                let pm;
                while ((pm = pRe.exec(tcInner)) !== null) {
                    const parsed = parseWordParagraph(pm[1]);
                    const lineStr = parsed.runs.map(r => r.t).join("").trim();
                    if (lineStr) lines.push(lineStr);
                }
                const cell = { text: lines.join("\n") };
                if (colspan > 1) cell.colspan = colspan;
                if (vMerge) cell.vMerge = vMerge;
                cells.push(cell);
            }
            if (cells.length > 0) rows.push(cells);
        }
        return rows;
    }

    function parseDocx(zip, meta) {
        const docXml = zip.readText("word/document.xml");
        if (!docXml) throw new Error("缺少 word/document.xml，不是标准 Word 文档");
        const bodyMatch = /<(?:[A-Za-z0-9_]+:)?body\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?body>/.exec(docXml);
        const bodyXml = bodyMatch ? bodyMatch[1] : docXml;

        const blocks = [];
        const tagTokenRe = /<(\/?)(?:[A-Za-z0-9_]+:)?(tbl|p)\b([^>]*?)(\/?)>/g;
        let depthTbl = 0;
        let depthP = 0;
        let blockStart = -1;
        let blockKind = "";
        let truncated = false;
        let m;

        while ((m = tagTokenRe.exec(bodyXml)) !== null) {
            const isClose = m[1] === "/";
            const tag = m[2];
            const isSelfClose = m[4] === "/";

            if (tag === "tbl") {
                if (!isClose && !isSelfClose) {
                    if (depthTbl === 0 && depthP === 0) {
                        blockStart = m.index;
                        blockKind = "tbl";
                    }
                    depthTbl++;
                } else if (isClose && depthTbl > 0) {
                    depthTbl--;
                    if (depthTbl === 0 && blockKind === "tbl" && blockStart !== -1) {
                        const rawTbl = bodyXml.substring(blockStart, tagTokenRe.lastIndex);
                        const rows = parseWordTable(rawTbl);
                        if (rows.length > 0) blocks.push({ type: "table", rows });
                        blockStart = -1;
                        blockKind = "";
                        if (blocks.length >= MAX_DOCX_BLOCKS) {
                            truncated = true;
                            break;
                        }
                    }
                }
            } else if (tag === "p" && depthTbl === 0) {
                if (!isClose && isSelfClose) {
                    continue;
                } else if (!isClose) {
                    if (depthP === 0) {
                        blockStart = m.index;
                        blockKind = "p";
                    }
                    depthP++;
                } else if (isClose && depthP > 0) {
                    depthP--;
                    if (depthP === 0 && blockKind === "p" && blockStart !== -1) {
                        const rawP = bodyXml.substring(blockStart, tagTokenRe.lastIndex);
                        const para = parseWordParagraph(rawP);
                        if (para.runs.length > 0) {
                            blocks.push({
                                type: "p",
                                h: para.heading,
                                list: para.isList ? 1 : 0,
                                align: para.align,
                                runs: para.runs
                            });
                            if (blocks.length >= MAX_DOCX_BLOCKS) {
                                truncated = true;
                                break;
                            }
                        }
                        blockStart = -1;
                        blockKind = "";
                    }
                }
            }
        }

        return {
            ok: true,
            kind: "docx",
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            path: meta.path,
            blocks,
            truncated
        };
    }

    function parsePptx(zip, meta) {
        const slideNames = [];
        for (const name of zip.entries.keys()) {
            const m = /^ppt\/slides\/slide(\d+)\.xml$/i.exec(name);
            if (m) slideNames.push({ num: parseInt(m[1], 10), name });
        }
        slideNames.sort((a, b) => a.num - b.num);
        const slides = [];
        const limit = slideNames.slice(0, 80);
        for (let i = 0; i < limit.length; i++) {
            const xml = zip.readText(limit[i].name) || "";
            const lines = [];
            const pRe = /<(?:[A-Za-z0-9_]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?p>/g;
            let pm;
            while ((pm = pRe.exec(xml)) !== null) {
                const tRe = /<(?:[A-Za-z0-9_]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/g;
                let buf = "";
                let tm;
                while ((tm = tRe.exec(pm[1])) !== null) buf += decodeXml(tm[1]);
                const trimmed = buf.trim();
                if (trimmed) lines.push(trimmed);
            }
            slides.push({ index: limit[i].num, lines });
        }
        return {
            ok: true,
            kind: "pptx",
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            path: meta.path,
            slides,
            truncated: slideNames.length > 80
        };
    }

    try { electron_1.ipcMain.removeHandler("ag-ux:open-in-default-app"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:open-in-default-app", async (event, uriOrPath) => {
        assertMainFrame(event);
        const nativePath = resolveNativePath(uriOrPath);
        if (!fsSync.existsSync(nativePath)) {
            return { ok: false, error: "文件不存在: " + nativePath, path: nativePath };
        }
        const errMsg = await electron_1.shell.openPath(nativePath);
        return { ok: !errMsg, error: errMsg || null, path: nativePath };
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:preview-office-file"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:preview-office-file", async (event, uriOrPath) => {
        assertMainFrame(event);
        try {
            const nativePath = resolveNativePath(uriOrPath);
            if (!fsSync.existsSync(nativePath)) {
                return { ok: false, error: "本地文件不存在: " + nativePath };
            }
            const stat = fsSync.statSync(nativePath);
            const ext = pathMod.extname(nativePath).toLowerCase();
            const meta = {
                ext,
                fileName: pathMod.basename(nativePath),
                fileSize: stat.size,
                path: nativePath
            };

            if (stat.size > MAX_OFFICE_FILE_BYTES) {
                return {
                    ok: true,
                    kind: "external-only",
                    ...meta,
                    reason: "文件体积较大 (" + (stat.size / 1048576).toFixed(1) + " MB)，建议直接调用系统默认应用打开。"
                };
            }

            if (ext === ".xlsx" || ext === ".xlsm") {
                const buf = fsSync.readFileSync(nativePath);
                const zip = openZipBuffer(buf);
                return parseXlsx(zip, meta);
            }
            if (ext === ".docx" || ext === ".docm") {
                const buf = fsSync.readFileSync(nativePath);
                const zip = openZipBuffer(buf);
                return parseDocx(zip, meta);
            }
            if (ext === ".pptx" || ext === ".pptm") {
                const buf = fsSync.readFileSync(nativePath);
                const zip = openZipBuffer(buf);
                return parsePptx(zip, meta);
            }

            return {
                ok: true,
                kind: "external-only",
                ...meta,
                reason: (ext === ".xls" || ext === ".doc" || ext === ".ppt")
                    ? "当前为旧版二进制 Office 格式 (" + ext + ")，可直接调用系统默认应用查看。"
                    : "此二进制格式 (" + (ext || "binary") + ") 暂不支持内嵌解析，可一键调用系统默认应用打开。"
            };
        } catch (err) {
            return {
                ok: false,
                error: err && err.message ? err.message : String(err)
            };
        }
    });
}

function __agSetupOfficePreviewRenderer(ipcInvoke) {
    if (!ipcInvoke || typeof document === "undefined") return;

    const AUTO_OPEN_KEY = "ag_ux_office_auto_open";
    const STYLE_ID = "ag-ux-office-preview-style";
    const OFFICE_EXT_RE = /\.(xlsx|xlsm|xls|docx|docm|doc|pptx|pptm|ppt)$/i;
    const autoOpenedByHost = new WeakMap();

    function isAutoOpenEnabled() {
        try {
            return window.localStorage.getItem(AUTO_OPEN_KEY) === "on";
        } catch (e) {
            return false;
        }
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return "";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / 1048576).toFixed(2) + " MB";
    }

    function indexToColLetters(idx) {
        let n = idx + 1;
        let s = "";
        while (n > 0) {
            const rem = (n - 1) % 26;
            s = String.fromCharCode(65 + rem) + s;
            n = Math.floor((n - 1) / 26);
        }
        return s;
    }

    function ensureOfficePreviewStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const host = document.head || document.documentElement;
        if (!host) return;
        const styleEl = document.createElement("style");
        styleEl.id = STYLE_ID;
        styleEl.textContent = [
            'div:has(> [data-ag-office-viewer="true"]) {',
            '  align-items: stretch !important;',
            '  justify-content: flex-start !important;',
            '  overflow: hidden !important;',
            '}',
            'div.pl-2:has([data-ag-office-viewer="true"]) {',
            '  padding-left: 0 !important;',
            '  overflow: hidden !important;',
            '}',
            '.ag-office-root {',
            '  display: flex;',
            '  flex-direction: column;',
            '  width: 100%;',
            '  height: 100%;',
            '  min-height: 0;',
            '  background: var(--background);',
            '  color: var(--foreground);',
            '  font-size: 12.5px;',
            '}',
            '.ag-office-toolbar {',
            '  display: flex;',
            '  align-items: center;',
            '  justify-content: space-between;',
            '  gap: 8px;',
            '  padding: 6px 12px;',
            '  border-bottom: 1px solid var(--border);',
            '  background: var(--card, var(--background));',
            '  flex-shrink: 0;',
            '  flex-wrap: wrap;',
            '}',
            '.ag-office-badge {',
            '  font-size: 10px;',
            '  font-weight: 700;',
            '  padding: 2px 6px;',
            '  border-radius: 4px;',
            '  letter-spacing: 0.03em;',
            '  text-transform: uppercase;',
            '}',
            '.ag-office-badge-xlsx { background: rgba(16, 185, 129, 0.16); color: #10b981; }',
            '.ag-office-badge-docx { background: rgba(59, 130, 246, 0.16); color: #3b82f6; }',
            '.ag-office-badge-pptx { background: rgba(249, 115, 22, 0.16); color: #f97316; }',
            '.ag-office-badge-bin  { background: var(--secondary); color: var(--secondary-foreground); }',
            '.ag-office-btn {',
            '  display: inline-flex;',
            '  align-items: center;',
            '  gap: 4px;',
            '  height: 26px;',
            '  padding: 0 10px;',
            '  border-radius: 6px;',
            '  font-size: 12px;',
            '  font-weight: 500;',
            '  cursor: pointer;',
            '  border: 1px solid var(--border);',
            '  background: var(--secondary);',
            '  color: var(--secondary-foreground);',
            '  transition: opacity 0.15s ease;',
            '  white-space: nowrap;',
            '}',
            '.ag-office-btn:hover { opacity: 0.88; }',
            '.ag-office-btn-primary {',
            '  background: var(--primary);',
            '  color: var(--primary-foreground);',
            '  border-color: transparent;',
            '}',
            '.ag-office-search {',
            '  height: 25px;',
            '  padding: 0 8px;',
            '  border-radius: 6px;',
            '  border: 1px solid var(--border);',
            '  background: var(--background);',
            '  color: var(--foreground);',
            '  font-size: 12px;',
            '  width: 150px;',
            '  outline: none;',
            '}',
            '.ag-office-fxbar {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 8px;',
            '  padding: 4px 12px;',
            '  border-bottom: 1px solid var(--border);',
            '  font-size: 11.5px;',
            '  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
            '  background: color-mix(in srgb, var(--secondary) 35%, transparent);',
            '  flex-shrink: 0;',
            '  min-height: 26px;',
            '}',
            '.ag-office-tabs {',
            '  display: flex;',
            '  align-items: center;',
            '  gap: 4px;',
            '  padding: 5px 10px;',
            '  border-bottom: 1px solid var(--border);',
            '  overflow-x: auto;',
            '  flex-shrink: 0;',
            '}',
            '.ag-office-tab {',
            '  padding: 3px 10px;',
            '  border-radius: 6px;',
            '  font-size: 12px;',
            '  cursor: pointer;',
            '  border: 1px solid transparent;',
            '  background: transparent;',
            '  color: var(--muted-foreground);',
            '  white-space: nowrap;',
            '}',
            '.ag-office-tab.active {',
            '  background: var(--secondary);',
            '  color: var(--foreground);',
            '  border-color: var(--border);',
            '  font-weight: 600;',
            '}',
            '.ag-office-scroll {',
            '  flex: 1 1 0%;',
            '  min-height: 0;',
            '  overflow: auto;',
            '}',
            '.ag-xlsx-table {',
            '  border-collapse: separate;',
            '  border-spacing: 0;',
            '  width: max-content;',
            '  min-width: 100%;',
            '  font-size: 12px;',
            '}',
            '.ag-xlsx-table th, .ag-xlsx-table td {',
            '  border-right: 1px solid color-mix(in srgb, var(--border) 75%, transparent);',
            '  border-bottom: 1px solid color-mix(in srgb, var(--border) 75%, transparent);',
            '  padding: 4px 8px;',
            '  max-width: 360px;',
            '  white-space: pre-wrap;',
            '  word-break: break-word;',
            '  vertical-align: top;',
            '}',
            '.ag-xlsx-table thead th {',
            '  position: sticky;',
            '  top: 0;',
            '  z-index: 3;',
            '  background: var(--card, var(--secondary));',
            '  color: var(--muted-foreground);',
            '  font-weight: 600;',
            '  text-align: center;',
            '  user-select: none;',
            '}',
            '.ag-xlsx-rownum {',
            '  position: sticky;',
            '  left: 0;',
            '  z-index: 2;',
            '  background: var(--card, var(--secondary));',
            '  color: var(--muted-foreground);',
            '  text-align: right;',
            '  min-width: 38px;',
            '  user-select: none;',
            '  font-variant-numeric: tabular-nums;',
            '}',
            '.ag-xlsx-table thead th.ag-xlsx-corner {',
            '  left: 0;',
            '  z-index: 4;',
            '}',
            '.ag-xlsx-num {',
            '  text-align: right;',
            '  font-variant-numeric: tabular-nums;',
            '}',
            '.ag-xlsx-cell-selected {',
            '  outline: 2px solid var(--primary);',
            '  outline-offset: -2px;',
            '  background: color-mix(in srgb, var(--primary) 10%, transparent);',
            '}',
            '.ag-xlsx-has-formula {',
            '  position: relative;',
            '}',
            '.ag-xlsx-has-formula::after {',
            '  content: "";',
            '  position: absolute;',
            '  top: 0;',
            '  right: 0;',
            '  border-style: solid;',
            '  border-width: 0 6px 6px 0;',
            '  border-color: transparent #10b981 transparent transparent;',
            '}',
            '.ag-docx-paper {',
            '  max-width: 860px;',
            '  margin: 0 auto;',
            '  padding: 20px 24px 36px;',
            '  line-height: 1.68;',
            '  font-size: 13.5px;',
            '}',
            '.ag-docx-paper h1 { font-size: 20px; font-weight: 700; margin: 14px 0 8px; }',
            '.ag-docx-paper h2 { font-size: 17px; font-weight: 600; margin: 12px 0 6px; }',
            '.ag-docx-paper h3 { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }',
            '.ag-docx-paper h4 { font-size: 13.5px; font-weight: 600; margin: 8px 0 4px; }',
            '.ag-docx-paper p  { margin: 5px 0; white-space: pre-wrap; word-break: break-word; }',
            '.ag-docx-table {',
            '  width: 100%;',
            '  border-collapse: collapse;',
            '  margin: 10px 0;',
            '  font-size: 12.5px;',
            '}',
            '.ag-docx-table td {',
            '  border: 1px solid var(--border);',
            '  padding: 5px 8px;',
            '  white-space: pre-wrap;',
            '  vertical-align: top;',
            '}'
        ].join("\n");
        host.appendChild(styleEl);
    }

    function extractFileUriForPlaceholder(placeholderEl) {
        const anchor = placeholderEl.querySelector("a[href]");
        if (anchor) {
            try {
                const u = new URL(anchor.getAttribute("href") || "", window.location.origin);
                const qUri = u.searchParams.get("uri");
                if (qUri) return qUri;
            } catch (e) {}
        }
        let cur = placeholderEl.parentElement;
        for (let depth = 0; depth < 16 && cur; depth++) {
            const nav = cur.querySelector('nav[aria-label="File path breadcrumbs"]');
            if (nav) {
                const uriNodes = nav.querySelectorAll("[data-uri]");
                if (uriNodes.length > 0) {
                    const lastUri = uriNodes[uriNodes.length - 1].getAttribute("data-uri");
                    if (lastUri) return lastUri;
                }
            }
            cur = cur.parentElement;
        }
        return null;
    }

    async function triggerOpenDefaultApp(fileUri, btnEl) {
        const origText = btnEl ? btnEl.textContent : "";
        if (btnEl) btnEl.textContent = "正在调起...";
        try {
            const res = await ipcInvoke("ag-ux:open-in-default-app", fileUri);
            if (btnEl) {
                btnEl.textContent = (res && res.ok) ? "已调起默认应用 ✓" : ("打开失败: " + ((res && res.error) || "未知错误"));
                setTimeout(() => { btnEl.textContent = origText; }, 1800);
            }
        } catch (err) {
            if (btnEl) {
                btnEl.textContent = "调起失败";
                setTimeout(() => { btnEl.textContent = origText; }, 1800);
            }
        }
    }

    function buildToolbar(meta, fileUri, extraSummary, onSearchChange) {
        const bar = document.createElement("div");
        bar.className = "ag-office-toolbar";

        const left = document.createElement("div");
        left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;flex:1;";

        const badge = document.createElement("span");
        const extClean = (meta.ext || "").replace(/^\./, "").toUpperCase() || "FILE";
        let badgeCls = "ag-office-badge ag-office-badge-bin";
        if (extClean.startsWith("XLS")) badgeCls = "ag-office-badge ag-office-badge-xlsx";
        else if (extClean.startsWith("DOC")) badgeCls = "ag-office-badge ag-office-badge-docx";
        else if (extClean.startsWith("PPT")) badgeCls = "ag-office-badge ag-office-badge-pptx";
        badge.className = badgeCls;
        badge.textContent = extClean;

        const title = document.createElement("span");
        title.style.cssText = "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        title.textContent = meta.fileName || "";
        title.title = meta.path || meta.fileName || "";

        const summary = document.createElement("span");
        summary.style.cssText = "color:var(--muted-foreground);font-size:11.5px;white-space:nowrap;";
        const sizeText = formatBytes(meta.fileSize);
        summary.textContent = [sizeText, extraSummary].filter(Boolean).join(" · ");

        left.appendChild(badge);
        left.appendChild(title);
        if (summary.textContent) left.appendChild(summary);

        const right = document.createElement("div");
        right.style.cssText = "display:flex;align-items:center;gap:6px;flex-shrink:0;";

        if (typeof onSearchChange === "function") {
            const searchInput = document.createElement("input");
            searchInput.type = "search";
            searchInput.className = "ag-office-search";
            searchInput.placeholder = "筛选内容...";
            searchInput.addEventListener("input", () => onSearchChange(searchInput.value.trim().toLowerCase()));
            right.appendChild(searchInput);
        }

        const revealBtn = document.createElement("button");
        revealBtn.type = "button";
        revealBtn.className = "ag-office-btn";
        revealBtn.textContent = "定位文件";
        revealBtn.addEventListener("click", () => {
            ipcInvoke("shell:reveal-in-file-picker", fileUri).catch(() => {});
        });

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "ag-office-btn ag-office-btn-primary";
        openBtn.textContent = "↗ 用默认应用打开";
        openBtn.addEventListener("click", () => triggerOpenDefaultApp(fileUri, openBtn));

        right.appendChild(revealBtn);
        right.appendChild(openBtn);

        bar.appendChild(left);
        bar.appendChild(right);
        return bar;
    }

    function renderXlsxView(host, data, fileUri) {
        host.textContent = "";
        const root = document.createElement("div");
        root.className = "ag-office-root";

        const sheets = data.sheets || [];
        let activeIdx = 0;
        for (let i = 0; i < sheets.length; i++) {
            if (!sheets[i].hidden) { activeIdx = i; break; }
        }
        let filterKeyword = "";

        const fxBar = document.createElement("div");
        fxBar.className = "ag-office-fxbar";
        const fxCoord = document.createElement("span");
        fxCoord.style.cssText = "font-weight:700;min-width:44px;color:var(--foreground);";
        fxCoord.textContent = "单元格";
        const fxSep = document.createElement("span");
        fxSep.style.color = "var(--muted-foreground)";
        fxSep.textContent = "fx";
        const fxVal = document.createElement("span");
        fxVal.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted-foreground);";
        fxVal.textContent = "点击任意单元格查看完整值与公式（右上角绿标代表含公式）";
        fxBar.appendChild(fxCoord);
        fxBar.appendChild(fxSep);
        fxBar.appendChild(fxVal);

        const tabsBar = document.createElement("div");
        tabsBar.className = "ag-office-tabs";

        const scrollWrap = document.createElement("div");
        scrollWrap.className = "ag-office-scroll";

        function drawSheet() {
            tabsBar.textContent = "";
            sheets.forEach((sh, idx) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "ag-office-tab" + (idx === activeIdx ? " active" : "");
                btn.textContent = sh.name + (sh.hidden ? " (隐藏)" : "");
                btn.addEventListener("click", () => {
                    activeIdx = idx;
                    drawSheet();
                });
                tabsBar.appendChild(btn);
            });

            scrollWrap.textContent = "";
            const sheet = sheets[activeIdx];
            if (!sheet) {
                const empty = document.createElement("div");
                empty.style.padding = "24px";
                empty.textContent = "工作簿中无可见工作表。";
                scrollWrap.appendChild(empty);
                return;
            }
            if (sheet.error) {
                const errEl = document.createElement("div");
                errEl.style.padding = "24px";
                errEl.textContent = "解析该工作表出错: " + sheet.error;
                scrollWrap.appendChild(errEl);
                return;
            }
            if (sheet.rows.length === 0 || sheet.colCount === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "padding:32px;text-align:center;color:var(--muted-foreground);";
                empty.textContent = "当前工作表为空。";
                scrollWrap.appendChild(empty);
                return;
            }

            const mergeMaster = new Map();
            const mergeSkip = new Set();
            if (!filterKeyword && Array.isArray(sheet.merges)) {
                for (let i = 0; i < sheet.merges.length; i++) {
                    const mg = sheet.merges[i];
                    const rs = mg.r2 - mg.r1 + 1;
                    const cs = mg.c2 - mg.c1 + 1;
                    if (rs > 1 || cs > 1) {
                        mergeMaster.set(mg.r1 + ":" + mg.c1, { rs, cs });
                        for (let rr = mg.r1; rr <= mg.r2; rr++) {
                            for (let cc = mg.c1; cc <= mg.c2; cc++) {
                                if (rr !== mg.r1 || cc !== mg.c1) mergeSkip.add(rr + ":" + cc);
                            }
                        }
                    }
                }
            }

            const table = document.createElement("table");
            table.className = "ag-xlsx-table";

            const thead = document.createElement("thead");
            const headRow = document.createElement("tr");
            const corner = document.createElement("th");
            corner.className = "ag-xlsx-rownum ag-xlsx-corner";
            corner.textContent = "#";
            headRow.appendChild(corner);

            for (let c = 0; c < sheet.colCount; c++) {
                const th = document.createElement("th");
                th.textContent = indexToColLetters(c);
                headRow.appendChild(th);
            }
            thead.appendChild(headRow);
            table.appendChild(thead);

            const tbody = document.createElement("tbody");
            let selectedTd = null;

            for (let r = 0; r < sheet.rows.length; r++) {
                const rowCells = sheet.rows[r];
                if (filterKeyword) {
                    let hit = false;
                    for (let k = 0; k < rowCells.length; k++) {
                        const txt = (rowCells[k].v || "") + " " + (rowCells[k].f || "");
                        if (txt.toLowerCase().includes(filterKeyword)) { hit = true; break; }
                    }
                    if (!hit) continue;
                }

                const cellByCol = new Map();
                for (let k = 0; k < rowCells.length; k++) {
                    cellByCol.set(rowCells[k].c, rowCells[k]);
                }

                const tr = document.createElement("tr");
                const rn = document.createElement("td");
                rn.className = "ag-xlsx-rownum";
                rn.textContent = String(r + 1);
                tr.appendChild(rn);

                for (let c = 0; c < sheet.colCount; c++) {
                    const key = r + ":" + c;
                    if (mergeSkip.has(key)) continue;

                    const td = document.createElement("td");
                    const mInfo = mergeMaster.get(key);
                    if (mInfo) {
                        if (mInfo.rs > 1) td.rowSpan = mInfo.rs;
                        if (mInfo.cs > 1) td.colSpan = mInfo.cs;
                    }

                    const cell = cellByCol.get(c);
                    const valStr = cell ? cell.v : "";
                    const formulaStr = cell && cell.f ? cell.f : "";
                    td.textContent = valStr;

                    const cls = [];
                    if (cell && cell.n) cls.push("ag-xlsx-num");
                    if (formulaStr) {
                        cls.push("ag-xlsx-has-formula");
                        td.title = "=" + formulaStr + (valStr !== "" ? "  ->  " + valStr : "");
                    }
                    if (cls.length) td.className = cls.join(" ");

                    const coordLabel = indexToColLetters(c) + (r + 1);
                    td.addEventListener("click", () => {
                        if (selectedTd) selectedTd.classList.remove("ag-xlsx-cell-selected");
                        selectedTd = td;
                        td.classList.add("ag-xlsx-cell-selected");
                        fxCoord.textContent = coordLabel;
                        fxVal.style.color = "var(--foreground)";
                        fxVal.textContent = formulaStr
                            ? ("=" + formulaStr + "    [值: " + (valStr || "空") + "]")
                            : (valStr !== "" ? valStr : "(空)");
                    });

                    tr.appendChild(td);
                }
                tbody.appendChild(tr);
            }

            table.appendChild(tbody);
            scrollWrap.appendChild(table);

            if (sheet.truncatedRows) {
                const note = document.createElement("div");
                note.style.cssText = "padding:10px 14px;color:var(--muted-foreground);font-size:11.5px;border-top:1px solid var(--border);";
                note.textContent = "已速览前 " + sheet.rows.length + " 行（共 " + sheet.totalRows + " 行），查看全量数据与原生格式请点击右上角「用默认应用打开」。";
                scrollWrap.appendChild(note);
            }
        }

        const toolbar = buildToolbar(
            { ext: ".xlsx", fileName: data.fileName, fileSize: data.fileSize, path: data.path },
            fileUri,
            sheets.length + " 个工作表",
            (kw) => {
                filterKeyword = kw;
                drawSheet();
            }
        );

        root.appendChild(toolbar);
        if (sheets.length > 0) root.appendChild(tabsBar);
        root.appendChild(fxBar);
        root.appendChild(scrollWrap);
        host.appendChild(root);
        drawSheet();
    }

    function renderDocxView(host, data, fileUri) {
        host.textContent = "";
        const root = document.createElement("div");
        root.className = "ag-office-root";

        let filterKeyword = "";
        const scrollWrap = document.createElement("div");
        scrollWrap.className = "ag-office-scroll";

        function drawDoc() {
            scrollWrap.textContent = "";
            const paper = document.createElement("div");
            paper.className = "ag-docx-paper";

            const blocks = data.blocks || [];
            let shown = 0;

            for (let i = 0; i < blocks.length; i++) {
                const blk = blocks[i];
                if (blk.type === "p") {
                    const fullText = blk.runs.map(r => r.t).join("");
                    if (filterKeyword && !fullText.toLowerCase().includes(filterKeyword)) continue;
                    shown++;

                    const tag = blk.h >= 1 && blk.h <= 4 ? ("h" + blk.h) : "p";
                    const el = document.createElement(tag);
                    if (blk.align === "center" || blk.align === "right") {
                        el.style.textAlign = blk.align;
                    }
                    if (blk.list) {
                        el.style.paddingLeft = "18px";
                        const bullet = document.createElement("span");
                        bullet.textContent = "• ";
                        bullet.style.color = "var(--muted-foreground)";
                        el.appendChild(bullet);
                    }
                    for (let k = 0; k < blk.runs.length; k++) {
                        const r = blk.runs[k];
                        if (r.b) {
                            const strong = document.createElement("strong");
                            strong.textContent = r.t;
                            el.appendChild(strong);
                        } else {
                            el.appendChild(document.createTextNode(r.t));
                        }
                    }
                    paper.appendChild(el);
                } else if (blk.type === "table") {
                    if (filterKeyword) {
                        const tblText = blk.rows.map(row => row.map(c => c.text).join(" ")).join(" ").toLowerCase();
                        if (!tblText.includes(filterKeyword)) continue;
                    }
                    shown++;
                    const table = document.createElement("table");
                    table.className = "ag-docx-table";
                    const tbody = document.createElement("tbody");

                    const activeVMergeTdByCol = new Map();
                    for (let r = 0; r < blk.rows.length; r++) {
                        const tr = document.createElement("tr");
                        let logicalCol = 0;
                        for (let c = 0; c < blk.rows[r].length; c++) {
                            const cell = blk.rows[r][c];
                            const span = cell.colspan || 1;
                            if (cell.vMerge === "continue" && activeVMergeTdByCol.has(logicalCol)) {
                                const masterTd = activeVMergeTdByCol.get(logicalCol);
                                masterTd.rowSpan = (masterTd.rowSpan || 1) + 1;
                                logicalCol += span;
                                continue;
                            }
                            const td = document.createElement("td");
                            if (span > 1) td.colSpan = span;
                            td.textContent = cell.text;
                            if (cell.vMerge === "restart") {
                                activeVMergeTdByCol.set(logicalCol, td);
                            } else {
                                activeVMergeTdByCol.delete(logicalCol);
                            }
                            logicalCol += span;
                            tr.appendChild(td);
                        }
                        tbody.appendChild(tr);
                    }
                    table.appendChild(tbody);
                    paper.appendChild(table);
                }
            }

            if (shown === 0) {
                const empty = document.createElement("div");
                empty.style.cssText = "padding:32px;text-align:center;color:var(--muted-foreground);";
                empty.textContent = filterKeyword ? "未匹配到包含该关键字的段落或表格。" : "文档中无可提取的正文文本。";
                paper.appendChild(empty);
            }
            if (data.truncated) {
                const note = document.createElement("div");
                note.style.cssText = "margin-top:16px;padding-top:10px;border-top:1px solid var(--border);color:var(--muted-foreground);font-size:12px;";
                note.textContent = "已展示前 " + MAX_DOCX_BLOCKS_HINT + " 个段落/表格块，完整排版请点击右上角「用默认应用打开」。";
                paper.appendChild(note);
            }
            scrollWrap.appendChild(paper);
        }

        const MAX_DOCX_BLOCKS_HINT = 800;
        const toolbar = buildToolbar(
            { ext: ".docx", fileName: data.fileName, fileSize: data.fileSize, path: data.path },
            fileUri,
            (data.blocks ? data.blocks.length : 0) + " 个内容块",
            (kw) => {
                filterKeyword = kw;
                drawDoc();
            }
        );

        root.appendChild(toolbar);
        root.appendChild(scrollWrap);
        host.appendChild(root);
        drawDoc();
    }

    function renderPptxView(host, data, fileUri) {
        host.textContent = "";
        const root = document.createElement("div");
        root.className = "ag-office-root";

        const slides = data.slides || [];
        const toolbar = buildToolbar(
            { ext: ".pptx", fileName: data.fileName, fileSize: data.fileSize, path: data.path },
            fileUri,
            slides.length + " 页幻灯片",
            null
        );

        const scrollWrap = document.createElement("div");
        scrollWrap.className = "ag-office-scroll";
        const wrap = document.createElement("div");
        wrap.className = "ag-docx-paper";

        slides.forEach((sl) => {
            const card = document.createElement("div");
            card.style.cssText = "border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:12px;background:var(--card, transparent);";
            const head = document.createElement("div");
            head.style.cssText = "font-size:11px;font-weight:700;color:var(--muted-foreground);margin-bottom:6px;";
            head.textContent = "SLIDE " + sl.index;
            card.appendChild(head);
            if (!sl.lines.length) {
                const emp = document.createElement("div");
                emp.style.color = "var(--muted-foreground)";
                emp.textContent = "(纯图形页 / 无文本)";
                card.appendChild(emp);
            } else {
                sl.lines.forEach((ln, idx) => {
                    const p = document.createElement("p");
                    p.style.cssText = idx === 0 ? "font-weight:600;font-size:14.5px;margin:2px 0 6px;" : "margin:3px 0;";
                    p.textContent = ln;
                    card.appendChild(p);
                });
            }
            wrap.appendChild(card);
        });

        scrollWrap.appendChild(wrap);
        root.appendChild(toolbar);
        root.appendChild(scrollWrap);
        host.appendChild(root);
    }

    function renderExternalFallback(host, info, fileUri) {
        host.textContent = "";
        const root = document.createElement("div");
        root.className = "ag-office-root";

        const toolbar = buildToolbar(
            { ext: info.ext || "", fileName: info.fileName || "", fileSize: info.fileSize, path: info.path || "" },
            fileUri,
            "",
            null
        );

        const center = document.createElement("div");
        center.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;";

        const msg = document.createElement("div");
        msg.style.cssText = "color:var(--muted-foreground);max-width:420px;line-height:1.6;";
        msg.textContent = info.reason || info.error || "可直接调用系统默认应用程序打开此文件。";

        const bigBtn = document.createElement("button");
        bigBtn.type = "button";
        bigBtn.className = "ag-office-btn ag-office-btn-primary";
        bigBtn.style.cssText = "height:34px;padding:0 18px;font-size:13px;border-radius:8px;";
        bigBtn.textContent = "↗ 用系统默认应用打开";
        bigBtn.addEventListener("click", () => triggerOpenDefaultApp(fileUri, bigBtn));

        center.appendChild(msg);
        center.appendChild(bigBtn);
        root.appendChild(toolbar);
        root.appendChild(center);
        host.appendChild(root);
    }

    async function loadOfficePreviewIntoHost(viewerHost, fileUri) {
        viewerHost.setAttribute("data-file-uri", fileUri);
        viewerHost.textContent = "";
        const loading = document.createElement("div");
        loading.style.cssText = "display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:var(--muted-foreground);font-size:12.5px;";
        loading.textContent = "正在加载文档速览...";
        viewerHost.appendChild(loading);

        if (OFFICE_EXT_RE.test(fileUri) && isAutoOpenEnabled()) {
            if (autoOpenedByHost.get(viewerHost) !== fileUri) {
                autoOpenedByHost.set(viewerHost, fileUri);
                ipcInvoke("ag-ux:open-in-default-app", fileUri).catch(() => {});
            }
        }

        try {
            const res = await ipcInvoke("ag-ux:preview-office-file", fileUri);
            if (viewerHost.getAttribute("data-file-uri") !== fileUri) return;
            if (!res || !res.ok) {
                const fallbackName = decodeURIComponent((fileUri.split("/").pop() || "file"));
                renderExternalFallback(viewerHost, {
                    fileName: fallbackName,
                    ext: fallbackName.includes(".") ? ("." + fallbackName.split(".").pop()) : "",
                    error: (res && res.error) || "解析失败"
                }, fileUri);
                return;
            }
            if (res.kind === "xlsx") renderXlsxView(viewerHost, res, fileUri);
            else if (res.kind === "docx") renderDocxView(viewerHost, res, fileUri);
            else if (res.kind === "pptx") renderPptxView(viewerHost, res, fileUri);
            else renderExternalFallback(viewerHost, res, fileUri);
        } catch (err) {
            if (viewerHost.getAttribute("data-file-uri") !== fileUri) return;
            const fallbackName = decodeURIComponent((fileUri.split("/").pop() || "file"));
            renderExternalFallback(viewerHost, {
                fileName: fallbackName,
                error: err && err.message ? err.message : String(err)
            }, fileUri);
        }
    }

    function mountOfficeAutoOpenSettingRow() {
        const headings = document.querySelectorAll("h3");
        for (let i = 0; i < headings.length; i++) {
            const h3 = headings[i];
            if (h3.childElementCount > 0) continue;
            const title = (h3.textContent || "").trim();
            if (title !== "聊天宽度" && title !== "Chat Width") continue;
            const sectionRoot = h3.closest(".space-y-2") || (h3.parentElement && h3.parentElement.parentElement && h3.parentElement.parentElement.parentElement);
            if (!sectionRoot) continue;
            const card = sectionRoot.querySelector(".agy-card");
            if (!card || card.querySelector('[data-ag-ux-office-auto-row="true"]')) continue;

            const row = document.createElement("div");
            row.setAttribute("data-ag-ux-office-auto-row", "true");
            row.setAttribute("data-ag-localization-skip", "true");
            row.className = "py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center";

            const leftCol = document.createElement("div");
            leftCol.className = "flex-1 flex flex-col gap-0.5";

            const labelWrap = document.createElement("div");
            labelWrap.className = "flex items-center gap-1.5";

            const labelEl = document.createElement("span");
            labelEl.className = "text-sm";
            labelEl.id = "ag-ux-office-auto-label";
            labelEl.textContent = "Office 文件自动外开";

            const badgeEl = document.createElement("span");
            badgeEl.className = "text-[10px] font-semibold leading-none bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full select-none border border-border";
            badgeEl.textContent = "Word / Excel";

            labelWrap.appendChild(labelEl);
            labelWrap.appendChild(badgeEl);

            const descEl = document.createElement("span");
            descEl.className = "text-xs text-muted-foreground whitespace-pre-wrap";
            descEl.textContent = "开启后点击 Word / Excel / PPT 文件将立即拉起系统默认程序；关闭时仅在侧边栏内速览并保留顶部外开按钮。";

            leftCol.appendChild(labelWrap);
            leftCol.appendChild(descEl);

            const rightCol = document.createElement("div");
            rightCol.className = "shrink-0";

            const switchBtn = document.createElement("button");
            switchBtn.type = "button";
            switchBtn.setAttribute("role", "switch");
            switchBtn.setAttribute("aria-labelledby", "ag-ux-office-auto-label");

            const thumbEl = document.createElement("span");
            thumbEl.className = "inline-block rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm h-4 w-4";
            switchBtn.appendChild(thumbEl);

            const syncSwitch = (enabled) => {
                switchBtn.setAttribute("aria-checked", enabled ? "true" : "false");
                switchBtn.className = "relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 h-6 w-11 cursor-pointer " + (enabled ? "bg-primary" : "bg-secondary");
                thumbEl.style.transform = enabled ? "translateX(24px)" : "translateX(4px)";
            };
            syncSwitch(isAutoOpenEnabled());

            switchBtn.addEventListener("click", () => {
                const next = !isAutoOpenEnabled();
                try {
                    window.localStorage.setItem(AUTO_OPEN_KEY, next ? "on" : "off");
                } catch (e) {}
                syncSwitch(next);
            });

            rightCol.appendChild(switchBtn);
            row.appendChild(leftCol);
            row.appendChild(rightCol);
            card.appendChild(row);
        }
    }

    function syncOfficeViewers() {
        ensureOfficePreviewStyle();
        mountOfficeAutoOpenSettingRow();

        const existingViewers = document.querySelectorAll('[data-ag-office-viewer="true"]');
        for (let i = 0; i < existingViewers.length; i++) {
            const v = existingViewers[i];
            const parent = v.parentElement;
            if (!parent || !parent.querySelector('[data-testid="binary-file-no-preview"], [data-testid="artifact-no-preview"]')) {
                v.remove();
            }
        }

        const placeholders = document.querySelectorAll('[data-testid="binary-file-no-preview"], [data-testid="artifact-no-preview"]');
        for (let i = 0; i < placeholders.length; i++) {
            const ph = placeholders[i];
            const parent = ph.parentElement;
            if (!parent) continue;
            const fileUri = extractFileUriForPlaceholder(ph);
            if (!fileUri) continue;

            ph.style.display = "none";
            let viewer = parent.querySelector(':scope > [data-ag-office-viewer="true"]');
            if (!viewer) {
                viewer = document.createElement("div");
                viewer.setAttribute("data-ag-office-viewer", "true");
                viewer.setAttribute("data-ag-localization-skip", "true");
                viewer.style.cssText = "width:100%;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;";
                parent.appendChild(viewer);
            }
            if (viewer.getAttribute("data-file-uri") !== fileUri) {
                loadOfficePreviewIntoHost(viewer, fileUri);
            }
        }
    }

    let officeRafPending = false;
    globalThis.__agScheduleOfficePreviewSync = function() {
        if (officeRafPending) return;
        officeRafPending = true;
        window.requestAnimationFrame(() => {
            officeRafPending = false;
            try {
                syncOfficeViewers();
            } catch (e) {}
        });
    };

    ensureOfficePreviewStyle();
    if (document.readyState !== "loading") {
        globalThis.__agScheduleOfficePreviewSync();
    } else {
        document.addEventListener("DOMContentLoaded", () => globalThis.__agScheduleOfficePreviewSync());
    }
}

function __agRegisterMemeIpcHandlers(electron_1) {
    const fsSync = require("fs");
    const pathMod = require("path");
    const osMod = require("os");
    const cryptoMod = require("crypto");
    const { execFileSync } = require("child_process");

    const HOME = osMod.homedir();
    const CONFIG_PATH = pathMod.join(HOME, ".gemini", "meme-config.json");
    const DEFAULT_PACKS_DIR = pathMod.join(HOME, ".gemini", "meme-packs");
    const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
    const ALLOWED_EXTS = {
        ".webp": "image/webp",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif"
    };
    const VALID_MOODS = new Set(["happy", "shy", "angry", "sad", "confused", "daily"]);
    const allowedPackDirs = new Map();

    function assertMainFrame(event) {
        if (event && event.senderFrame && event.senderFrame.parent) {
            throw new Error("Unauthorized subframe Meme IPC call");
        }
    }

    function expandHome(p) {
        const s = String(p || "").trim();
        if (!s) return "";
        if (s === "~") return HOME;
        if (s.startsWith("~/") || s.startsWith("~\\")) return pathMod.join(HOME, s.slice(2));
        return s;
    }

    function readConfig() {
        const def = {
            enabled: true,
            pickerSendOnClick: true,
            layoutMode: "inline",
            stickerSize: 168,
            activePacks: ["gemini-neko"],
            packsDirs: [DEFAULT_PACKS_DIR]
        };
        try {
            if (!fsSync.existsSync(CONFIG_PATH)) return def;
            const parsed = JSON.parse(fsSync.readFileSync(CONFIG_PATH, "utf8"));
            if (!parsed || typeof parsed !== "object") return def;
            const packsDirs = Array.isArray(parsed.packsDirs) && parsed.packsDirs.length > 0
                ? parsed.packsDirs.map(expandHome).filter(Boolean)
                : [DEFAULT_PACKS_DIR];
            const activePacks = Array.isArray(parsed.activePacks) && parsed.activePacks.length > 0
                ? parsed.activePacks.map(String).filter(Boolean)
                : ["gemini-neko"];
            return {
                enabled: parsed.enabled !== false,
                pickerSendOnClick: parsed.pickerSendOnClick !== false,
                layoutMode: parsed.layoutMode === "stacked" ? "stacked" : "inline",
                stickerSize: Number(parsed.stickerSize) > 60 ? Math.min(280, Number(parsed.stickerSize)) : 168,
                activePacks,
                packsDirs
            };
        } catch (e) {
            return def;
        }
    }

    function saveConfig(patch) {
        const current = readConfig();
        const next = Object.assign({}, current);
        if (patch && typeof patch === "object") {
            if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
            if (typeof patch.pickerSendOnClick === "boolean") next.pickerSendOnClick = patch.pickerSendOnClick;
            if (patch.layoutMode === "stacked" || patch.layoutMode === "inline") next.layoutMode = patch.layoutMode;
            if (Number.isFinite(Number(patch.stickerSize)) && Number(patch.stickerSize) >= 80) {
                next.stickerSize = Math.min(280, Math.round(Number(patch.stickerSize)));
            }
            if (Array.isArray(patch.activePacks) && patch.activePacks.length > 0) {
                next.activePacks = patch.activePacks.map(String).filter(Boolean);
            }
        }
        try {
            fsSync.mkdirSync(pathMod.dirname(CONFIG_PATH), { recursive: true });
            const serializable = Object.assign({}, next, {
                packsDirs: next.packsDirs.map((d) => (d === DEFAULT_PACKS_DIR ? "~/.gemini/meme-packs" : d))
            });
            fsSync.writeFileSync(CONFIG_PATH, JSON.stringify(serializable, null, 2) + "\n", "utf8");
        } catch (e) {}
        return next;
    }

    function walkImagesFallback(packDir) {
        const out = [];
        const walk = (dir, prefix) => {
            let entries = [];
            try { entries = fsSync.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
            for (let i = 0; i < entries.length; i++) {
                const ent = entries[i];
                if (ent.name.startsWith(".") || ent.name === "manifest.json" || ent.name === "memes.json" || ent.name.startsWith("index.db")) continue;
                const full = pathMod.join(dir, ent.name);
                const rel = prefix ? prefix + "/" + ent.name : ent.name;
                if (ent.isDirectory()) {
                    walk(full, rel);
                    continue;
                }
                if (!ent.isFile()) continue;
                const ext = pathMod.extname(ent.name).toLowerCase();
                if (!ALLOWED_EXTS[ext]) continue;
                const segs = rel.replace(/^memes\//, "").split("/");
                const tag = segs.length >= 2 && VALID_MOODS.has(segs[0].toLowerCase()) ? segs[0].toLowerCase() : "daily";
                const stem = ent.name.slice(0, ent.name.length - ext.length);
                out.push({ path: rel, tag, file_name: ent.name, caption: stem, keywords: stem });
            }
        };
        walk(packDir, "");
        return out;
    }

    function readPackRows(packDir) {
        const memesJsonPath = pathMod.join(packDir, "memes.json");
        if (fsSync.existsSync(memesJsonPath)) {
            try {
                const parsed = JSON.parse(fsSync.readFileSync(memesJsonPath, "utf8"));
                const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.memes) ? parsed.memes : []);
                if (arr.length > 0) return arr;
            } catch (e) {}
        }
        const dbPath = pathMod.join(packDir, "index.db");
        if (fsSync.existsSync(dbPath)) {
            try {
                const sqliteBin = fsSync.existsSync("/usr/bin/sqlite3") ? "/usr/bin/sqlite3" : "sqlite3";
                const raw = execFileSync(sqliteBin, ["-readonly", "-json", dbPath, "SELECT path, tag, file_name, caption, keywords FROM memes;"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
                const rows = JSON.parse(raw || "[]");
                if (Array.isArray(rows) && rows.length > 0) return rows;
            } catch (e) {}
        }
        return walkImagesFallback(packDir);
    }

    function discoverPacks(cfg) {
        allowedPackDirs.clear();
        const packs = [];
        const seen = new Set();
        const dirs = cfg.packsDirs || [DEFAULT_PACKS_DIR];
        for (let i = 0; i < dirs.length; i++) {
            const root = pathMod.resolve(expandHome(dirs[i]));
            if (!fsSync.existsSync(root)) continue;
            let names = [];
            try { names = fsSync.readdirSync(root); } catch (e) { continue; }
            for (let j = 0; j < names.length; j++) {
                const name = names[j];
                if (!name || name.startsWith(".") || seen.has(name)) continue;
                const pDir = pathMod.resolve(pathMod.join(root, name));
                try { if (!fsSync.statSync(pDir).isDirectory()) continue; } catch (e) { continue; }
                const hasMeta = fsSync.existsSync(pathMod.join(pDir, "memes.json")) || fsSync.existsSync(pathMod.join(pDir, "index.db")) || fsSync.existsSync(pathMod.join(pDir, "memes"));
                if (!hasMeta) continue;
                seen.add(name);
                allowedPackDirs.set(name, pDir);
                let manifest = { id: name, name: name, description: "" };
                try {
                    const mPath = pathMod.join(pDir, "manifest.json");
                    if (fsSync.existsSync(mPath)) {
                        manifest = Object.assign(manifest, JSON.parse(fsSync.readFileSync(mPath, "utf8")));
                    }
                } catch (e) {}
                const rows = readPackRows(pDir);
                packs.push({
                    id: name,
                    name: String(manifest.name || name),
                    description: String(manifest.description || ""),
                    active: cfg.activePacks.includes(name),
                    count: rows.length,
                    rows
                });
            }
        }
        return packs;
    }

    function syncSqliteBestEffort(packDir, rows) {
        const dbPath = pathMod.join(packDir, "index.db");
        const pyScript = [
            "import json, sqlite3, sys",
            "d = json.loads(sys.stdin.read())",
            "conn = sqlite3.connect(d['dbPath'])",
            "conn.execute('''CREATE TABLE IF NOT EXISTS memes (path TEXT PRIMARY KEY, tag TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT, caption TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', mtime REAL, captioned_at REAL)''')",
            "conn.execute('DELETE FROM memes')",
            "for r in d['rows']:",
            "    conn.execute('INSERT INTO memes(path, tag, file_name, file_hash, caption, keywords, mtime, captioned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', (r.get('path',''), r.get('tag','daily'), r.get('file_name',''), r.get('file_hash',''), r.get('caption',''), r.get('keywords',''), r.get('mtime'), r.get('captioned_at')))",
            "conn.commit()",
            "conn.close()"
        ].join("\n");
        try {
            execFileSync("python3", ["-c", pyScript], {
                input: JSON.stringify({ dbPath, rows }),
                encoding: "utf8",
                stdio: ["pipe", "ignore", "ignore"]
            });
        } catch (e) {}
    }

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-list"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-list", async (event) => {
        assertMainFrame(event);
        try {
            const cfg = readConfig();
            const discovered = discoverPacks(cfg);
            const activeSet = new Set(cfg.activePacks);
            const packs = [];
            const memes = [];
            for (let i = 0; i < discovered.length; i++) {
                const p = discovered[i];
                packs.push({ id: p.id, name: p.name, description: p.description, count: p.count, active: p.active });
                if (!activeSet.has(p.id) && discovered.length > 0 && cfg.activePacks.length > 0) continue;
                for (let k = 0; k < p.rows.length; k++) {
                    const r = p.rows[k];
                    if (!r || !r.path) continue;
                    memes.push({
                        packId: p.id,
                        packName: p.name,
                        path: String(r.path),
                        tag: String(r.tag || "daily").toLowerCase(),
                        file_name: String(r.file_name || pathMod.basename(String(r.path))),
                        caption: String(r.caption || ""),
                        keywords: String(r.keywords || "")
                    });
                }
            }
            return { ok: true, config: cfg, packs, memes };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-read-image"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-read-image", async (event, payload) => {
        assertMainFrame(event);
        try {
            const packId = String((payload && payload.packId) || "").trim();
            const relPath = String((payload && payload.relPath) || "").trim().replace(/\\/g, "/");
            if (!packId || !relPath) return { ok: false, error: "参数不完整" };
            let packDir = allowedPackDirs.get(packId);
            if (!packDir) {
                discoverPacks(readConfig());
                packDir = allowedPackDirs.get(packId);
            }
            if (!packDir) return { ok: false, error: "未知表情包图库: " + packId };
            const resolvedPack = pathMod.resolve(packDir);
            const absPath = pathMod.resolve(resolvedPack, relPath);
            if (!absPath.startsWith(resolvedPack + pathMod.sep)) {
                return { ok: false, error: "非法路径访问" };
            }
            const ext = pathMod.extname(absPath).toLowerCase();
            const mime = ALLOWED_EXTS[ext];
            if (!mime) return { ok: false, error: "不支持的图片格式" };
            if (!fsSync.existsSync(absPath)) return { ok: false, error: "图片文件不存在" };
            const st = fsSync.statSync(absPath);
            if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return { ok: false, error: "图片体积超限" };
            const data = fsSync.readFileSync(absPath);
            return { ok: true, mime, data };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-save-config"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-save-config", async (event, patch) => {
        assertMainFrame(event);
        try {
            const next = saveConfig(patch);
            return { ok: true, config: next };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-pick-file"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-pick-file", async (event) => {
        assertMainFrame(event);
        try {
            const win = electron_1.BrowserWindow && typeof electron_1.BrowserWindow.fromWebContents === "function"
                ? electron_1.BrowserWindow.fromWebContents(event.sender)
                : null;
            const opts = {
                title: "选择要收录到 Gemini 猫娘表情库的图片",
                properties: ["openFile"],
                filters: [{ name: "Images", extensions: ["webp", "png", "jpg", "jpeg", "gif"] }]
            };
            const res = win ? await electron_1.dialog.showOpenDialog(win, opts) : await electron_1.dialog.showOpenDialog(opts);
            if (!res || res.canceled || !Array.isArray(res.filePaths) || res.filePaths.length === 0) {
                return { ok: true, canceled: true };
            }
            const filePath = res.filePaths[0];
            const ext = pathMod.extname(filePath).toLowerCase();
            const mime = ALLOWED_EXTS[ext];
            if (!mime) return { ok: false, error: "仅支持 webp / png / jpg / gif 格式" };
            const st = fsSync.statSync(filePath);
            if (!st.isFile() || st.size > MAX_IMAGE_BYTES) return { ok: false, error: "图片不能超过 8 MB" };
            const data = fsSync.readFileSync(filePath);
            const stem = pathMod.basename(filePath, ext).slice(0, 80);
            return { ok: true, canceled: false, filePath, mime, data, suggestedCaption: stem };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-import-commit"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-import-commit", async (event, payload) => {
        assertMainFrame(event);
        try {
            const srcPath = String((payload && payload.srcPath) || "").trim();
            const caption = String((payload && payload.caption) || "").trim().slice(0, 120);
            const rawTag = String((payload && payload.tag) || "daily").trim().toLowerCase();
            const tag = VALID_MOODS.has(rawTag) ? rawTag : "daily";
            const keywords = String((payload && payload.keywords) || "").trim() || caption;
            const packId = String((payload && payload.packId) || "gemini-neko").trim() || "gemini-neko";
            if (!srcPath || !fsSync.existsSync(srcPath)) return { ok: false, error: "源图片文件不存在" };
            if (!caption) return { ok: false, error: "请填写表情描述" };
            const ext = pathMod.extname(srcPath).toLowerCase();
            if (!ALLOWED_EXTS[ext]) return { ok: false, error: "不支持的图片格式: " + ext };
            const packDir = pathMod.join(DEFAULT_PACKS_DIR, packId);
            const tagDir = pathMod.join(packDir, "memes", tag);
            fsSync.mkdirSync(tagDir, { recursive: true });

            const asciiSlug = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
            const baseSlug = asciiSlug.length >= 3 ? asciiSlug.slice(0, 40) : ("sticker-" + cryptoMod.createHash("sha1").update(caption + Date.now()).digest("hex").slice(0, 8));
            let fileName = baseSlug + ext;
            let relPath = "memes/" + tag + "/" + fileName;
            let dest = pathMod.join(packDir, relPath);
            if (fsSync.existsSync(dest)) {
                fileName = baseSlug + "-" + Date.now().toString(36) + ext;
                relPath = "memes/" + tag + "/" + fileName;
                dest = pathMod.join(packDir, relPath);
            }
            fsSync.copyFileSync(srcPath, dest);
            const bytes = fsSync.readFileSync(dest);
            const fhash = cryptoMod.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
            const st = fsSync.statSync(dest);
            const nowSec = Date.now() / 1000;

            let manifest = { id: packId, name: packId === "gemini-neko" ? "Gemini猫娘" : packId, version: "1.1.0" };
            const mPath = pathMod.join(packDir, "manifest.json");
            if (fsSync.existsSync(mPath)) {
                try { manifest = Object.assign(manifest, JSON.parse(fsSync.readFileSync(mPath, "utf8"))); } catch (e) {}
            }
            let rows = readPackRows(packDir);
            const newRow = {
                path: relPath,
                tag,
                file_name: fileName,
                file_hash: fhash,
                caption,
                keywords,
                mtime: st.mtimeMs / 1000,
                captioned_at: nowSec
            };
            rows.push(newRow);
            manifest.count = rows.length;
            fsSync.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
            fsSync.writeFileSync(pathMod.join(packDir, "memes.json"), JSON.stringify({ manifest, memes: rows }, null, 2) + "\n", "utf8");
            syncSqliteBestEffort(packDir, rows);
            allowedPackDirs.set(packId, packDir);
            return { ok: true, row: Object.assign({ packId, packName: manifest.name }, newRow) };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });

    try { electron_1.ipcMain.removeHandler("ag-ux:meme-open-pack-dir"); } catch (e) {}
    electron_1.ipcMain.handle("ag-ux:meme-open-pack-dir", async (event) => {
        assertMainFrame(event);
        try {
            fsSync.mkdirSync(DEFAULT_PACKS_DIR, { recursive: true });
            const errMsg = await electron_1.shell.openPath(DEFAULT_PACKS_DIR);
            return { ok: !errMsg, error: errMsg || null, path: DEFAULT_PACKS_DIR };
        } catch (err) {
            return { ok: false, error: err && err.message ? err.message : String(err) };
        }
    });
}

function __agSetupMemeRenderer(invokeFn) {
    if (!invokeFn || typeof document === "undefined") return;

    const STYLE_ID = "ag-ux-meme-style";
    const MEME_RENDERER_MARKER = "ag-meme-renderer-v2";
    const MEME_RE = /\[表情[:：]\s*([^\[\]\r\n]+?)\](?:\((?:https?:\/\/[^)\s]+)\))?/g;
    const MEME_TEST_RE = /\[表情[:：]\s*([^\[\]\r\n]+?)\](?:\((?:https?:\/\/[^)\s]+)\))?/;
    const BUBBLE_SEL = [
        '[data-markdown-root]',
        '[data-testid="planner-response-text"]',
        '[data-testid="progress-update-response-text"]',
        '[data-bubble-side="agent"]',
        '[data-testid="transcript-line-text"]',
        '[data-testid="user-message-content"]',
        '[data-testid="user-message-bubble"]'
    ].join(', ');
    const SKIP_ANCESTOR_SEL = 'pre, code, kbd, samp, style, script, svg, math, noscript, template, textarea, input, select, [contenteditable="true"], a, button, .monaco-editor, .google-symbols, .codicon, .context-scope-mention, [data-testid="markdown-code-block-preview"], [data-ag-meme-slot], [data-ag-meme-board], [data-ag-meme-zoom]';
    const BLOCK_BREAK_TAGS = new Set([
        "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "DD", "DETAILS",
        "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE",
        "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER",
        "HGROUP", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
        "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
    ]);

    const MOOD_TABS = [
        { id: "all", label: "全部" },
        { id: "happy", label: "开心" },
        { id: "shy", label: "害羞" },
        { id: "angry", label: "哈气" },
        { id: "sad", label: "哭哭" },
        { id: "confused", label: "懵懂" },
        { id: "daily", label: "日常" }
    ];

    let libState = null;
    let configOverride = null;
    let configOverrideSeq = 0;
    let libPromise = null;
    let libRetryAfter = 0;
    let libRetryTimer = null;
    const blobCache = new Map();

    function getActiveMemeConfig() {
        return (libState && libState.config) || configOverride || { enabled: true, pickerSendOnClick: true, stickerSize: 168 };
    }

    let boardEl = null;
    let boardOpen = false;
    let activeComposer = null;
    let boardState = {
        mood: "all",
        query: "",
        hovered: null,
        importDraft: null
    };

    let zoomBox = null;
    let zoomImg = null;
    let zoomTip = null;
    let zoomScale = 1;

    function foldCaption(s) {
        return String(s || "")
            .trim()
            .replace(/[\u201c\u201d\u2018\u2019\u300c\u300d\u300e\u300f«»]/g, '"')
            .replace(/\s+/g, " ");
    }

    function looseCaption(s) {
        return foldCaption(s).replace(/["'\s·・!！?？.,，。~～\-_]/g, "").toLowerCase();
    }

    function splitDescTokens(s) {
        return foldCaption(s)
            .split(/[\s,.!?;:、，。！？；：""''()（）\[\]【】《》…·・～~\-_]+/)
            .map((t) => t.replace(/["']/g, "").toLowerCase())
            .filter((t) => t.length >= 2)
            .sort((a, b) => b.length - a.length);
    }

    function buildLookup(memes) {
        const captionMap = new Map();
        const keywordMap = new Map();
        const searchList = [];

        const regKey = (map, rawKey, row) => {
            const raw = String(rawKey || "").trim();
            if (!raw) return;
            const forms = new Set([raw, foldCaption(raw), looseCaption(raw)]);
            forms.forEach((f) => {
                if (f && !map.has(f)) map.set(f, row);
            });
        };

        for (let i = 0; i < memes.length; i++) {
            const m = memes[i];
            regKey(captionMap, m.caption, m);
            const fname = String(m.file_name || "");
            const dot = fname.lastIndexOf(".");
            const stem = dot > 0 ? fname.slice(0, dot) : fname;
            regKey(captionMap, stem, m);
            regKey(captionMap, String(m.caption || "").slice(0, 80), m);

            const kwStr = String(m.keywords || "");
            regKey(keywordMap, kwStr, m);
            const kws = kwStr.split(/\s+/);
            for (let j = 0; j < kws.length; j++) regKey(keywordMap, kws[j], m);

            const hay = [];
            const tokensSource = [m.caption, m.keywords, stem].filter(Boolean);
            for (let j = 0; j < tokensSource.length; j++) {
                const fc = foldCaption(tokensSource[j]).toLowerCase();
                const lc = looseCaption(tokensSource[j]);
                if (fc) hay.push(fc);
                if (lc && lc !== fc) hay.push(lc);
            }
            searchList.push({
                row: m,
                hay,
                tokens: Array.from(new Set(splitDescTokens(tokensSource.join(" "))))
            });
        }

        return { captionMap, keywordMap, searchList };
    }

    function resolveMeme(desc) {
        if (!libState || !libState.lookup) return null;
        const { captionMap, keywordMap, searchList } = libState.lookup;
        const raw = String(desc || "").trim();
        const forms = [raw, foldCaption(raw), looseCaption(raw)];
        const maps = [captionMap, keywordMap];
        for (let mi = 0; mi < maps.length; mi++) {
            const mp = maps[mi];
            for (let fi = 0; fi < forms.length; fi++) {
                const f = forms[fi];
                if (f && mp.has(f)) return mp.get(f);
            }
        }
        const needles = Array.from(new Set(splitDescTokens(raw).map(looseCaption).filter(Boolean)));
        let best = null;
        let bestLen = 0;
        let bestCnt = 0;
        for (let i = 0; i < searchList.length; i++) {
            const item = searchList[i];
            let longest = 0;
            let cnt = 0;
            for (let ni = 0; ni < needles.length; ni++) {
                const n = needles[ni];
                let hitLen = item.hay.some((h) => h.includes(n)) ? n.length : 0;
                for (let ti = 0; ti < item.tokens.length; ti++) {
                    const t = looseCaption(item.tokens[ti]);
                    if (t && (n.includes(t) || t.includes(n))) {
                        hitLen = Math.max(hitLen, Math.min(n.length, t.length));
                    }
                }
                if (hitLen > 0) {
                    longest = Math.max(longest, hitLen);
                    cnt++;
                }
            }
            if (longest > bestLen || (longest === bestLen && cnt > bestCnt)) {
                best = item.row;
                bestLen = longest;
                bestCnt = cnt;
            }
        }
        return best;
    }

    function bytesToBase64(bytes) {
        if (!bytes || !bytes.length) return "";
        const chunkSize = 0x8000;
        const parts = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
            parts.push(String.fromCharCode.apply(null, sub));
        }
        return btoa(parts.join(""));
    }

    function getMemeImageAsset(meme) {
        if (!meme || !meme.packId || !meme.path) return Promise.resolve(null);
        const key = meme.packId + "::" + meme.path;
        if (blobCache.has(key)) return blobCache.get(key);
        const p = invokeFn("ag-ux:meme-read-image", { packId: meme.packId, relPath: meme.path })
            .then((res) => {
                if (!res || !res.ok || !res.data) {
                    blobCache.delete(key);
                    return null;
                }
                const bytes = res.data instanceof Uint8Array
                    ? res.data
                    : (ArrayBuffer.isView(res.data)
                        ? new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength)
                        : new Uint8Array(res.data));
                const mime = res.mime || "image/webp";
                let blobUrl = null;
                try {
                    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
                        blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
                    }
                } catch (_) {
                    blobUrl = null;
                }
                let dataUrl = null;
                const getDataUrl = () => {
                    if (dataUrl) return dataUrl;
                    try {
                        dataUrl = "data:" + mime + ";base64," + bytesToBase64(bytes);
                    } catch (_) {
                        dataUrl = null;
                    }
                    return dataUrl;
                };
                return {
                    mime,
                    bytes,
                    blobUrl: blobUrl || getDataUrl(),
                    getDataUrl
                };
            })
            .catch(() => {
                blobCache.delete(key);
                return null;
            });
        blobCache.set(key, p);
        return p;
    }

    function scheduleLibraryRetry() {
        if (libRetryTimer) return;
        libRetryTimer = window.setTimeout(() => {
            libRetryTimer = null;
            if (!libState && typeof globalThis.__agScheduleMemeSync === "function") {
                globalThis.__agScheduleMemeSync();
            }
        }, 3200);
    }

    function ensureLibrary(forceRefresh) {
        if (!forceRefresh && libState) return Promise.resolve(libState);
        if (!forceRefresh && libPromise) return libPromise;
        if (!forceRefresh && Date.now() < libRetryAfter) {
            scheduleLibraryRetry();
            return Promise.resolve(null);
        }
        const reqSeq = configOverrideSeq;
        libPromise = invokeFn("ag-ux:meme-list")
            .then((res) => {
                libPromise = null;
                if (!res || !res.ok) {
                    libRetryAfter = Date.now() + 3000;
                    scheduleLibraryRetry();
                    try { console.warn("[AG-UX Meme] meme-list returned not ok:", res && res.error); } catch (_) {}
                    return null;
                }
                const memes = Array.isArray(res.memes) ? res.memes : [];
                const packs = Array.isArray(res.packs) ? res.packs : [];
                const config = Object.assign({ enabled: true, pickerSendOnClick: true, stickerSize: 168 }, res.config || {});
                if (configOverride && configOverrideSeq > reqSeq) {
                    Object.assign(config, configOverride);
                } else {
                    configOverride = null;
                }
                libState = {
                    config,
                    packs,
                    memes,
                    lookup: buildLookup(memes)
                };
                libRetryAfter = 0;
                if (libRetryTimer) {
                    clearTimeout(libRetryTimer);
                    libRetryTimer = null;
                }
                if (typeof globalThis.__agScheduleMemeSync === "function") {
                    globalThis.__agScheduleMemeSync();
                }
                return libState;
            })
            .catch((err) => {
                libPromise = null;
                libRetryAfter = Date.now() + 3000;
                scheduleLibraryRetry();
                try { console.warn("[AG-UX Meme] meme-list IPC error:", err && err.message ? err.message : err); } catch (_) {}
                return null;
            });
        return libPromise;
    }

    function ensureMemeStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const host = document.head || document.documentElement;
        if (!host) return;
        const st = document.createElement("style");
        st.id = STYLE_ID;
        st.setAttribute("data-ag-meme-ver", MEME_RENDERER_MARKER);
        st.textContent = [
            '.ag-meme-slot{display:inline-flex;flex-direction:column;align-items:flex-start;vertical-align:middle;margin:4px 6px 4px 0;max-width:100%}',
            '.ag-meme-slot[data-ag-meme-standalone="1"]{display:flex;margin:6px 0}',
            '.ag-meme-slot[data-ag-meme-multi="1"]{display:inline-flex;vertical-align:top;margin:3px 6px 3px 0}',
            '[data-testid="user-message-bubble"] .ag-meme-slot[data-ag-meme-standalone="1"]{margin:2px 0}',
            '[data-testid="user-message-content"] .ag-meme-slot[data-ag-meme-standalone="1"]{align-items:flex-end;margin:2px 0}',
            '[data-testid="user-message-bubble"] .ag-meme-slot[data-ag-meme-multi="1"],[data-testid="user-message-content"] .ag-meme-slot[data-ag-meme-multi="1"]{align-items:flex-start;margin:2px 6px 2px 0}',
            '[data-testid="user-message-content"]:has([data-ag-meme-slot]),[data-testid="user-message-bubble"] > div:has([data-ag-meme-slot]){max-height:min(70vh,560px) !important;overflow-y:auto !important;overflow-x:visible !important;-webkit-mask-image:none !important;mask-image:none !important}',
            '[data-testid="user-message-bubble"]:has([data-ag-meme-slot]){overflow:visible !important}',
            '[data-testid="user-message-content"][data-ag-meme-unclip="1"],[data-testid="user-message-bubble"] > div[data-ag-meme-unclip="1"],[data-testid="user-message-bubble"][data-ag-meme-unclip="1"]{max-height:none !important;overflow:visible !important;-webkit-mask-image:none !important;mask-image:none !important}',
            '.ag-meme-img{max-width:min(var(--ag-meme-size,168px),100%);max-height:var(--ag-meme-size,168px);width:auto;height:auto;border-radius:10px;display:block;cursor:zoom-in;object-fit:contain;transition:transform .14s ease,box-shadow .14s ease}',
            '.ag-meme-img:hover{transform:scale(1.03);box-shadow:0 6px 18px rgba(0,0,0,.22)}',
            '.ag-meme-fallback{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;font-size:12px;border:1px solid var(--border,rgba(128,128,128,.3));background:var(--secondary,rgba(128,128,128,.12));color:var(--foreground,inherit)}',
            '.ag-meme-trigger{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border-radius:9999px;border:none;background:transparent;color:var(--muted-foreground,#9ca3af);cursor:pointer;transition:background-color .15s,color .15s;flex-shrink:0}',
            '.ag-meme-trigger:hover,.ag-meme-trigger[data-active="true"]{background:var(--secondary,rgba(128,128,128,.18));color:var(--foreground,#fff)}',
            '.ag-meme-board{position:fixed;z-index:2147482500;width:388px;max-width:calc(100vw - 24px);height:452px;max-height:calc(100vh - 36px);display:flex;flex-direction:column;border-radius:14px;border:1px solid var(--border,rgba(128,128,128,.28));background:var(--popover,var(--card,#1e1e24));color:var(--foreground,#f4f4f5);box-shadow:0 16px 48px rgba(0,0,0,.38);overflow:hidden;font-family:inherit}',
            '.ag-meme-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px 8px;border-bottom:1px solid var(--border,rgba(128,128,128,.2));flex-shrink:0}',
            '.ag-meme-head-left{display:flex;align-items:center;gap:6px;min-width:0}',
            '.ag-meme-title{font-size:13px;font-weight:600;white-space:nowrap}',
            '.ag-meme-count{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--secondary,rgba(128,128,128,.16));color:var(--muted-foreground,#a1a1aa)}',
            '.ag-meme-head-acts{display:flex;align-items:center;gap:4px}',
            '.ag-meme-pill-btn{height:24px;padding:0 8px;border-radius:999px;border:1px solid var(--border,rgba(128,128,128,.25));background:transparent;color:var(--foreground,inherit);font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;white-space:nowrap}',
            '.ag-meme-pill-btn:hover{background:var(--secondary,rgba(128,128,128,.18))}',
            '.ag-meme-pill-btn[data-on="true"]{border-color:var(--primary,#6366f1);color:var(--primary,#818cf8);background:rgba(99,102,241,.12)}',
            '.ag-meme-tabs{display:flex;align-items:center;gap:4px;padding:8px 10px 4px;overflow-x:auto;flex-shrink:0;scrollbar-width:none}',
            '.ag-meme-tab{padding:3px 9px;border-radius:999px;border:none;background:transparent;color:var(--muted-foreground,#a1a1aa);font-size:11.5px;cursor:pointer;white-space:nowrap;transition:background .12s,color .12s}',
            '.ag-meme-tab:hover{background:var(--secondary,rgba(128,128,128,.14));color:var(--foreground,inherit)}',
            '.ag-meme-tab[data-active="true"]{background:var(--primary,#6366f1);color:var(--primary-foreground,#fff);font-weight:500}',
            '.ag-meme-search-wrap{padding:4px 10px 6px;flex-shrink:0}',
            '.ag-meme-search{width:100%;box-sizing:border-box;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--border,rgba(128,128,128,.25));background:var(--background,rgba(0,0,0,.15));color:var(--foreground,inherit);font-size:12px;outline:none}',
            '.ag-meme-search:focus{border-color:var(--primary,#6366f1)}',
            '.ag-meme-grid{flex:1;min-height:0;overflow-y:auto;padding:4px 10px 10px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;align-content:start}',
            '.ag-meme-cell{aspect-ratio:1/1;border-radius:9px;border:1px solid transparent;background:var(--secondary,rgba(128,128,128,.1));padding:4px;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;transition:transform .12s,border-color .12s,background .12s}',
            '.ag-meme-cell:hover{transform:translateY(-1px);border-color:var(--primary,#6366f1);background:var(--secondary,rgba(128,128,128,.2))}',
            '.ag-meme-cell img{width:100%;height:100%;object-fit:contain;border-radius:6px;pointer-events:none;display:block}',
            '.ag-meme-foot{padding:6px 12px;border-top:1px solid var(--border,rgba(128,128,128,.18));font-size:11px;color:var(--muted-foreground,#a1a1aa);display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0;min-height:28px}',
            '.ag-meme-foot-cap{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--foreground,inherit)}',
            '.ag-meme-import{padding:12px;display:flex;flex-direction:column;gap:10px;flex:1;overflow-y:auto}',
            '.ag-meme-import-preview{width:100%;height:140px;border-radius:10px;background:var(--background,rgba(0,0,0,.2));display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px dashed var(--border,rgba(128,128,128,.3))}',
            '.ag-meme-import-preview img{max-width:100%;max-height:100%;object-fit:contain}',
            '.ag-meme-import label{font-size:11px;color:var(--muted-foreground,#a1a1aa);display:block;margin-bottom:3px}',
            '.ag-meme-import input,.ag-meme-import select{width:100%;box-sizing:border-box;height:30px;padding:0 9px;border-radius:7px;border:1px solid var(--border,rgba(128,128,128,.3));background:var(--background,rgba(0,0,0,.15));color:var(--foreground,inherit);font-size:12px}',
            '.ag-meme-import-acts{display:flex;justify-content:flex-end;gap:8px;margin-top:auto}'
        ].join("\n");
        host.appendChild(st);
    }

    function ensureZoomOverlay() {
        if (zoomBox && zoomBox.isConnected) return;
        zoomBox = document.createElement("div");
        zoomBox.setAttribute("data-ag-meme-zoom", "1");
        zoomBox.setAttribute("data-ag-localization-skip", "true");
        zoomBox.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.8);backdrop-filter:blur(6px);cursor:zoom-out;padding:28px;box-sizing:border-box";
        zoomImg = document.createElement("img");
        zoomImg.style.cssText = "max-width:100%;max-height:88vh;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.6);display:block;transition:transform .12s ease-out;transform-origin:center center";
        zoomTip = document.createElement("div");
        zoomTip.style.cssText = "position:absolute;bottom:18px;left:16px;right:16px;text-align:center;color:rgba(255,255,255,.78);font-size:12px;pointer-events:none";
        zoomBox.appendChild(zoomImg);
        zoomBox.appendChild(zoomTip);
        zoomBox.addEventListener("click", (e) => {
            if (e.target === zoomBox) closeZoom();
        });
        zoomBox.addEventListener("wheel", (e) => {
            e.preventDefault();
            zoomScale = Math.min(6, Math.max(0.4, zoomScale * (e.deltaY < 0 ? 1.15 : 0.87)));
            zoomImg.style.transform = "scale(" + zoomScale + ")";
        }, { passive: false });
        zoomBox.addEventListener("dblclick", () => {
            zoomScale = 1;
            zoomImg.style.transform = "scale(1)";
        });
        (document.body || document.documentElement).appendChild(zoomBox);
    }

    function openZoom(src, caption) {
        if (!src) return;
        ensureZoomOverlay();
        zoomImg.src = src;
        zoomImg.alt = caption || "";
        zoomTip.textContent = (caption ? caption + " · " : "") + "滚轮缩放 · 双击复位 · Esc 或点背景关闭";
        zoomScale = 1;
        zoomImg.style.transform = "scale(1)";
        zoomBox.style.display = "flex";
    }

    function closeZoom() {
        if (!zoomBox) return;
        zoomBox.style.display = "none";
        zoomScale = 1;
        if (zoomImg) zoomImg.style.transform = "scale(1)";
    }

    function teardownMemeGroup(group) {
        if (!group) return;
        if (Array.isArray(group.spawned)) {
            for (let i = 0; i < group.spawned.length; i++) {
                const n = group.spawned[i];
                if (n && n.parentNode) n.parentNode.removeChild(n);
            }
        }
        if (Array.isArray(group.entries)) {
            for (let i = 0; i < group.entries.length; i++) {
                const ent = group.entries[i];
                if (!ent || !ent.node) continue;
                if (ent.node.isConnected && ent.node.nodeValue === ent.expected) {
                    ent.node.nodeValue = ent.orig;
                }
                if (ent.node.__agMemeGroup === group) {
                    delete ent.node.__agMemeGroup;
                }
            }
        }
    }

    function isMemeGroupValid(group, enabled) {
        if (!enabled || !group) return false;
        const entries = group.entries;
        const spawned = group.spawned;
        if (!Array.isArray(entries) || entries.length === 0 || !Array.isArray(spawned) || spawned.length === 0) {
            return false;
        }
        for (let i = 0; i < entries.length; i++) {
            const ent = entries[i];
            if (!ent || !ent.node || !ent.node.isConnected || ent.node.nodeValue !== ent.expected) {
                return false;
            }
        }
        for (let i = 0; i < spawned.length; i++) {
            const s = spawned[i];
            if (!s || !s.isConnected) return false;
        }
        return true;
    }

    function buildMemeSlot(rawMarker, desc, slotMode) {
        const wrap = document.createElement("span");
        wrap.className = "ag-meme-slot";
        wrap.setAttribute("data-ag-meme-slot", "1");
        wrap.setAttribute("data-ag-localization-skip", "true");
        if (slotMode === "multi") wrap.setAttribute("data-ag-meme-multi", "1");
        else if (slotMode === "standalone" || slotMode === true) wrap.setAttribute("data-ag-meme-standalone", "1");

        const meme = resolveMeme(desc);
        const renderFallback = () => {
            if (!wrap.isConnected && imgParentCheckNeeded()) return;
            wrap.innerHTML = "";
            const fb = document.createElement("span");
            fb.className = "ag-meme-fallback";
            fb.textContent = "🐱 " + desc;
            wrap.appendChild(fb);
        };
        function imgParentCheckNeeded() {
            return wrap.parentNode == null;
        }
        if (meme) {
            const img = document.createElement("img");
            img.className = "ag-meme-img";
            img.setAttribute("data-ag-meme-img", "1");
            img.setAttribute("data-ag-meme-caption", meme.caption || desc);
            img.alt = rawMarker;
            img.title = (meme.caption || desc) + "（点击放大）";
            img.loading = "lazy";
            img.decoding = "async";
            wrap.appendChild(img);
            getMemeImageAsset(meme).then((asset) => {
                if (!img.isConnected && img.parentNode !== wrap) return;
                if (!asset || !asset.blobUrl) {
                    renderFallback();
                    return;
                }
                let triedData = false;
                img.onerror = () => {
                    if (!triedData && typeof asset.getDataUrl === "function") {
                        const dUrl = asset.getDataUrl();
                        if (dUrl && img.src !== dUrl) {
                            triedData = true;
                            img.src = dUrl;
                            return;
                        }
                    }
                    renderFallback();
                };
                img.src = asset.blobUrl;
            });
        } else {
            const fb = document.createElement("span");
            fb.className = "ag-meme-fallback";
            fb.textContent = "🐱 " + desc;
            wrap.appendChild(fb);
        }
        return wrap;
    }

    function collectBubbleInlineRuns(bubble) {
        const runs = [];
        let currentNodes = [];
        let currentBlock = bubble;
        let inlineBlockedLeft = false;

        function flush(nextInlineBlocked) {
            if (currentNodes.length > 0) {
                runs.push({
                    blockEl: currentBlock,
                    nodes: currentNodes,
                    inlineBlockedLeft: inlineBlockedLeft,
                    inlineBlockedRight: Boolean(nextInlineBlocked)
                });
                currentNodes = [];
            }
            inlineBlockedLeft = Boolean(nextInlineBlocked);
        }

        function walk(node, blockEl) {
            const children = node.childNodes;
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                if (child.nodeType === 3) {
                    if (child.__agMemeSynthetic || child.__agMemeGroup) {
                        flush(false);
                        continue;
                    }
                    if (!currentNodes.length) currentBlock = blockEl;
                    currentNodes.push(child);
                } else if (child.nodeType === 1) {
                    if (child.matches && child.matches(SKIP_ANCESTOR_SEL)) {
                        const isMemeSlot = child.hasAttribute && child.hasAttribute("data-ag-meme-slot");
                        const isBlockSkip = BLOCK_BREAK_TAGS.has(child.tagName);
                        flush(!isMemeSlot && !isBlockSkip);
                        if (isBlockSkip) inlineBlockedLeft = false;
                        continue;
                    }
                    if (child !== bubble && child.matches && child.matches(BUBBLE_SEL)) {
                        const isBlockBubble = BLOCK_BREAK_TAGS.has(child.tagName);
                        flush(!isBlockBubble);
                        if (isBlockBubble) inlineBlockedLeft = false;
                        continue;
                    }
                    if (BLOCK_BREAK_TAGS.has(child.tagName)) {
                        flush(false);
                        inlineBlockedLeft = false;
                        walk(child, child.tagName === "BR" ? blockEl : child);
                        flush(false);
                        inlineBlockedLeft = false;
                    } else {
                        walk(child, blockEl);
                    }
                }
            }
        }

        walk(bubble, bubble);
        flush(false);
        return runs;
    }

    function buildSegmentPieces(segs, matches) {
        const result = new Array(segs.length);
        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const a = seg.start;
            const b = seg.end;
            const pieces = [];
            let pos = a;
            let touched = false;
            for (let mi = 0; mi < matches.length; mi++) {
                const m = matches[mi];
                const mStart = m.index;
                const mEnd = mStart + m[0].length;
                if (mEnd <= a) continue;
                if (mStart >= b) break;
                touched = true;
                if (mStart > pos) {
                    pieces.push({ type: "text", val: seg.orig.slice(pos - a, mStart - a) });
                }
                if (mStart >= a && mStart < b) {
                    pieces.push({ type: "slot", raw: m[0], desc: m[1] });
                }
                pos = mEnd < b ? mEnd : b;
            }
            if (pos < b) {
                pieces.push({ type: "text", val: seg.orig.slice(pos - a) });
            }
            result[i] = { touched, pieces };
        }
        return result;
    }

    function applyMatchesToInlineRun(run, fullText, matches, bubble) {
        const nodes = run.nodes;
        const segs = [];
        let cursor = 0;
        for (let i = 0; i < nodes.length; i++) {
            const orig = nodes[i].nodeValue || "";
            segs.push({ node: nodes[i], orig, start: cursor, end: cursor + orig.length });
            cursor += orig.length;
        }

        const stripped = fullText.replace(MEME_RE, "").trim();
        const blockEl = run.blockEl || bubble;
        const isMsgBlock = Boolean(blockEl && (
            blockEl.tagName === "P" ||
            (blockEl.hasAttribute && (blockEl.hasAttribute("data-quotable") || blockEl.hasAttribute("data-markdown-root"))) ||
            (blockEl.getAttribute && (
                blockEl.getAttribute("data-testid") === "user-message-content" ||
                blockEl.getAttribute("data-testid") === "user-message-bubble"
            )) ||
            (blockEl.closest && blockEl.closest('[data-testid="user-message-content"], [data-testid="user-message-bubble"]'))
        ));
        const isStandalone = stripped.length === 0 && isMsgBlock && !run.inlineBlockedLeft && !run.inlineBlockedRight;
        let slotMode = "inline";
        if (isStandalone) {
            let hasSiblingSlot = matches.length > 1;
            let prev = nodes[0] && nodes[0].previousSibling;
            while (prev) {
                if (prev.nodeType === 3) {
                    if ((prev.nodeValue || "").trim()) break;
                    prev = prev.previousSibling;
                    continue;
                }
                if (prev.nodeType === 1 && prev.hasAttribute && prev.hasAttribute("data-ag-meme-slot")) {
                    hasSiblingSlot = true;
                    if (prev.hasAttribute("data-ag-meme-standalone")) {
                        prev.removeAttribute("data-ag-meme-standalone");
                        prev.setAttribute("data-ag-meme-multi", "1");
                    }
                }
                break;
            }
            slotMode = hasSiblingSlot ? "multi" : "standalone";
        }

        const mapped = buildSegmentPieces(segs, matches);
        const group = { entries: [], spawned: [] };

        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const info = mapped[i];
            if (!info.touched) continue;

            const parent = seg.node.parentNode;
            if (!parent) continue;

            const pieces = info.pieces;
            const hasSlot = pieces.some((p) => p.type === "slot");
            if (!hasSlot) {
                const nextText = pieces.map((p) => p.val).join("");
                if (seg.node.nodeValue !== nextText) seg.node.nodeValue = nextText;
                seg.node.__agMemeGroup = group;
                group.entries.push({ node: seg.node, orig: seg.orig, expected: nextText });
                continue;
            }

            let headText = "";
            let startIdx = 0;
            if (pieces.length > 0 && pieces[0].type === "text") {
                headText = pieces[0].val;
                startIdx = 1;
            }
            if (seg.node.nodeValue !== headText) seg.node.nodeValue = headText;
            seg.node.__agMemeGroup = group;
            group.entries.push({ node: seg.node, orig: seg.orig, expected: headText });

            const anchorAfter = seg.node.nextSibling;
            const frag = document.createDocumentFragment();
            for (let pi = startIdx; pi < pieces.length; pi++) {
                const pc = pieces[pi];
                if (pc.type === "slot") {
                    const slot = buildMemeSlot(pc.raw, pc.desc, slotMode);
                    group.spawned.push(slot);
                    frag.appendChild(slot);
                } else if (pc.val) {
                    const syn = document.createTextNode(pc.val);
                    syn.__agMemeSynthetic = true;
                    group.spawned.push(syn);
                    frag.appendChild(syn);
                }
            }
            if (frag.childNodes.length > 0) {
                parent.insertBefore(frag, anchorAfter);
            }
        }

        if (group.entries.length > 0 || group.spawned.length > 0) {
            if (!Array.isArray(bubble.__agMemeGroups)) bubble.__agMemeGroups = [];
            bubble.__agMemeGroups.push(group);
        }
    }

    function getVisibleNonMemeTextLength(root) {
        if (!root) return 0;
        let len = 0;
        const stack = [root];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            if (node.nodeType === 3) {
                const s = (node.nodeValue || "").trim();
                if (s) len += s.length;
                continue;
            }
            if (node.nodeType === 1) {
                if (node.hasAttribute && node.hasAttribute("data-ag-meme-slot")) continue;
                const tag = (node.tagName || "").toUpperCase();
                if (tag === "SVG" || tag === "STYLE" || tag === "SCRIPT") continue;
                const cls = typeof node.className === "string"
                    ? node.className
                    : (node.getAttribute ? (node.getAttribute("class") || "") : "");
                if (cls && (cls.includes("context-scope-mention") || cls.includes("google-symbols") || cls.includes("codicon"))) {
                    continue;
                }
                const children = node.childNodes;
                if (children && children.length > 0) {
                    for (let i = children.length - 1; i >= 0; i--) {
                        stack.push(children[i]);
                    }
                }
            }
        }
        return len;
    }

    function syncUserBubbleClipState(bubble, enabled) {
        if (!bubble || !bubble.getAttribute) return;
        const testId = bubble.getAttribute("data-testid");
        if (testId !== "user-message-content" && testId !== "user-message-bubble") {
            return;
        }
        const hasSlot = Boolean(enabled && bubble.querySelector && bubble.querySelector("[data-ag-meme-slot]"));
        const unclip = hasSlot && getVisibleNonMemeTextLength(bubble) <= 240;
        const setUnclip = (el, on) => {
            if (!el) return;
            if (on && el.setAttribute) el.setAttribute("data-ag-meme-unclip", "1");
            else if (!on && el.removeAttribute) el.removeAttribute("data-ag-meme-unclip");
        };
        setUnclip(bubble, unclip);
        if (testId === "user-message-content") {
            const outerBubble = bubble.closest ? bubble.closest('[data-testid="user-message-bubble"]') : null;
            if (outerBubble) {
                const outerHasSlot = Boolean(enabled && outerBubble.querySelector && outerBubble.querySelector("[data-ag-meme-slot]"));
                setUnclip(outerBubble, outerHasSlot && getVisibleNonMemeTextLength(outerBubble) <= 240);
            }
        } else if (testId === "user-message-bubble" && bubble.children) {
            for (let i = 0; i < bubble.children.length; i++) {
                const ch = bubble.children[i];
                if (!ch || ch.nodeType !== 1 || ch.tagName !== "DIV") continue;
                if (ch.matches && ch.matches(BUBBLE_SEL)) continue;
                const chHasSlot = Boolean(enabled && ch.querySelector && ch.querySelector("[data-ag-meme-slot]"));
                setUnclip(ch, Boolean(unclip && chHasSlot));
            }
        }
    }

    function syncBubbleMemes() {
        const cfg = getActiveMemeConfig();
        const enabled = cfg.enabled !== false;
        const stickerSize = cfg.stickerSize || 168;
        if (document.documentElement) {
            document.documentElement.style.setProperty("--ag-meme-size", stickerSize + "px");
        }
        if (!enabled) closeZoom();

        const bubbles = document.querySelectorAll(BUBBLE_SEL);
        for (let bi = 0; bi < bubbles.length; bi++) {
            const bubble = bubbles[bi];
            const skipBubble = Boolean(bubble.closest && bubble.closest(SKIP_ANCESTOR_SEL));
            if (Array.isArray(bubble.__agMemeGroups) && bubble.__agMemeGroups.length > 0) {
                const kept = [];
                for (let gi = 0; gi < bubble.__agMemeGroups.length; gi++) {
                    const grp = bubble.__agMemeGroups[gi];
                    if (!skipBubble && isMemeGroupValid(grp, enabled)) {
                        kept.push(grp);
                    } else {
                        teardownMemeGroup(grp);
                    }
                }
                bubble.__agMemeGroups = kept;
            }
            if (!enabled || skipBubble) {
                syncUserBubbleClipState(bubble, false);
                continue;
            }

            const runs = collectBubbleInlineRuns(bubble);
            for (let ri = 0; ri < runs.length; ri++) {
                const run = runs[ri];
                let fullText = "";
                for (let ni = 0; ni < run.nodes.length; ni++) {
                    fullText += run.nodes[ni].nodeValue || "";
                }
                if (!MEME_TEST_RE.test(fullText)) continue;

                if (!libState) {
                    ensureLibrary(false);
                    continue;
                }

                MEME_RE.lastIndex = 0;
                const matches = [];
                let m;
                while ((m = MEME_RE.exec(fullText))) matches.push(m);
                if (matches.length > 0) {
                    applyMatchesToInlineRun(run, fullText, matches, bubble);
                }
            }
            syncUserBubbleClipState(bubble, true);
        }
        if (!enabled && document.querySelectorAll) {
            const leftovers = document.querySelectorAll("[data-ag-meme-unclip]");
            for (let li = 0; li < leftovers.length; li++) {
                leftovers[li].removeAttribute("data-ag-meme-unclip");
            }
        }
    }

    function insertMemeIntoComposer(composer, meme, forceSend) {
        if (!composer || !meme) return;
        const caption = String(meme.caption || meme.keywords || meme.file_name || "表情包").slice(0, 80);
        const marker = "[表情: " + caption + "]";
        const editor = composer.querySelector('[data-lexical-editor="true"], [contenteditable="true"]');
        if (!editor) return;

        closeBoard();
        editor.focus();

        window.requestAnimationFrame(() => {
            editor.focus();
            try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                range.collapse(false);
                if (sel) {
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } catch (e) {}

            const curTrim = (editor.textContent || "").trim();
            const payload = curTrim ? ("\n" + marker) : marker;
            const before = editor.textContent || "";

            let inserted = false;
            try {
                inserted = document.execCommand("insertText", false, payload);
            } catch (e) {
                inserted = false;
            }
            if (!inserted || (editor.textContent || "") === before) {
                try {
                    const dt = new DataTransfer();
                    dt.setData("text/plain", payload);
                    editor.dispatchEvent(new ClipboardEvent("paste", {
                        bubbles: true,
                        cancelable: true,
                        clipboardData: dt
                    }));
                } catch (e) {}
            }

            const shouldSend = typeof forceSend === "boolean"
                ? forceSend
                : (!libState || !libState.config || libState.config.pickerSendOnClick !== false);
            if (shouldSend) {
                window.setTimeout(() => {
                    const sendBtn = composer.querySelector('[data-testid="send-button"]') ||
                        composer.querySelector("button.agy-send-button");
                    if (sendBtn && !sendBtn.disabled) {
                        sendBtn.click();
                        return;
                    }
                    try {
                        editor.dispatchEvent(new KeyboardEvent("keydown", {
                            key: "Enter",
                            code: "Enter",
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        }));
                    } catch (e) {}
                }, 90);
            }
        });
    }

    function filterBoardMemes() {
        const all = libState && Array.isArray(libState.memes) ? libState.memes : [];
        const mood = boardState.mood || "all";
        const q = String(boardState.query || "").trim().toLowerCase();
        const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
        return all.filter((m) => {
            if (mood !== "all" && String(m.tag || "").toLowerCase() !== mood) return false;
            if (tokens.length === 0) return true;
            const hay = (m.caption + " " + m.keywords + " " + m.file_name + " " + m.tag).toLowerCase();
            return tokens.every((t) => hay.includes(t));
        });
    }

    function positionBoard(anchorBtn) {
        if (!boardEl || !anchorBtn) return;
        const rect = anchorBtn.getBoundingClientRect();
        const bw = 388;
        const bh = 452;
        let left = rect.right - bw;
        if (left < 12) left = Math.max(12, rect.left);
        if (left + bw > window.innerWidth - 12) left = Math.max(12, window.innerWidth - bw - 12);
        let top = rect.top - bh - 10;
        if (top < 12) top = Math.min(window.innerHeight - bh - 12, rect.bottom + 8);
        boardEl.style.left = Math.round(left) + "px";
        boardEl.style.top = Math.round(top) + "px";
    }

    function renderBoard() {
        if (!boardEl) return;
        boardEl.innerHTML = "";

        const cfg = (libState && libState.config) || { pickerSendOnClick: true };
        const sendOnClick = cfg.pickerSendOnClick !== false;
        const totalCount = libState && Array.isArray(libState.memes) ? libState.memes.length : 0;

        const head = document.createElement("div");
        head.className = "ag-meme-head";

        const headLeft = document.createElement("div");
        headLeft.className = "ag-meme-head-left";
        const title = document.createElement("span");
        title.className = "ag-meme-title";
        title.textContent = "Gemini 猫娘表情";
        const badge = document.createElement("span");
        badge.className = "ag-meme-count";
        badge.textContent = totalCount + " 张";
        headLeft.appendChild(title);
        headLeft.appendChild(badge);

        const headActs = document.createElement("div");
        headActs.className = "ag-meme-head-acts";

        const modeBtn = document.createElement("button");
        modeBtn.type = "button";
        modeBtn.className = "ag-meme-pill-btn";
        modeBtn.setAttribute("data-on", sendOnClick ? "true" : "false");
        modeBtn.textContent = sendOnClick ? "⚡ 点图直发" : "✏️ 仅填框";
        modeBtn.title = sendOnClick ? "点击切换为：仅填入输入框（不自动发送）" : "点击切换为：点图直接发送";
        modeBtn.addEventListener("click", () => {
            const nextVal = !sendOnClick;
            invokeFn("ag-ux:meme-save-config", { pickerSendOnClick: nextVal }).then((res) => {
                if (res && res.ok && libState) {
                    libState.config = res.config;
                    renderBoard();
                    syncMemeSettingsRow();
                }
            });
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "ag-meme-pill-btn";
        addBtn.textContent = "+ 添图";
        addBtn.title = "从本地导入新表情到 Gemini 猫娘图库";
        addBtn.addEventListener("click", () => {
            invokeFn("ag-ux:meme-pick-file").then((res) => {
                if (!res || !res.ok || res.canceled || !res.filePath) return;
                const bytes = res.data instanceof Uint8Array
                    ? res.data
                    : (ArrayBuffer.isView(res.data)
                        ? new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength)
                        : new Uint8Array(res.data));
                const previewUrl = URL.createObjectURL(new Blob([bytes], { type: res.mime || "image/png" }));
                boardState.importDraft = {
                    srcPath: res.filePath,
                    previewUrl,
                    caption: res.suggestedCaption || "",
                    tag: boardState.mood !== "all" ? boardState.mood : "daily",
                    keywords: res.suggestedCaption || ""
                };
                renderBoard();
            });
        });

        const dirBtn = document.createElement("button");
        dirBtn.type = "button";
        dirBtn.className = "ag-meme-pill-btn";
        dirBtn.textContent = "📁";
        dirBtn.title = "在 Finder 中打开 ~/.gemini/meme-packs 目录";
        dirBtn.addEventListener("click", () => invokeFn("ag-ux:meme-open-pack-dir"));

        headActs.appendChild(modeBtn);
        headActs.appendChild(addBtn);
        headActs.appendChild(dirBtn);
        head.appendChild(headLeft);
        head.appendChild(headActs);
        boardEl.appendChild(head);

        if (boardState.importDraft) {
            const draft = boardState.importDraft;
            const form = document.createElement("div");
            form.className = "ag-meme-import";

            const pv = document.createElement("div");
            pv.className = "ag-meme-import-preview";
            const pvImg = document.createElement("img");
            pvImg.src = draft.previewUrl;
            pv.appendChild(pvImg);
            form.appendChild(pv);

            const mkField = (labelText, value, placeholder, onChange) => {
                const wrap = document.createElement("div");
                const lbl = document.createElement("label");
                lbl.textContent = labelText;
                const inp = document.createElement("input");
                inp.type = "text";
                inp.value = value;
                inp.placeholder = placeholder;
                inp.addEventListener("input", () => onChange(inp.value));
                wrap.appendChild(lbl);
                wrap.appendChild(inp);
                return wrap;
            };

            form.appendChild(mkField("表情描述（[表情: ...] 匹配原文）", draft.caption, "例如：吉米启动！", (v) => { draft.caption = v; }));

            const moodWrap = document.createElement("div");
            const moodLbl = document.createElement("label");
            moodLbl.textContent = "情绪分类";
            const sel = document.createElement("select");
            MOOD_TABS.filter((t) => t.id !== "all").forEach((t) => {
                const opt = document.createElement("option");
                opt.value = t.id;
                opt.textContent = t.label + " (" + t.id + ")";
                if (draft.tag === t.id) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.addEventListener("change", () => { draft.tag = sel.value; });
            moodWrap.appendChild(moodLbl);
            moodWrap.appendChild(sel);
            form.appendChild(moodWrap);

            form.appendChild(mkField("检索关键词（空格分隔）", draft.keywords, "例如：探头 好奇 卖萌 猫娘", (v) => { draft.keywords = v; }));

            const acts = document.createElement("div");
            acts.className = "ag-meme-import-acts";
            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "ag-meme-pill-btn";
            cancelBtn.textContent = "取消";
            cancelBtn.addEventListener("click", () => {
                boardState.importDraft = null;
                renderBoard();
            });
            const saveBtn = document.createElement("button");
            saveBtn.type = "button";
            saveBtn.className = "ag-meme-pill-btn";
            saveBtn.setAttribute("data-on", "true");
            saveBtn.textContent = "确认收录";
            saveBtn.addEventListener("click", () => {
                if (!draft.caption.trim()) return;
                saveBtn.disabled = true;
                saveBtn.textContent = "保存中...";
                invokeFn("ag-ux:meme-import-commit", {
                    srcPath: draft.srcPath,
                    caption: draft.caption.trim(),
                    tag: draft.tag,
                    keywords: draft.keywords.trim(),
                    packId: "gemini-neko"
                }).then((res) => {
                    boardState.importDraft = null;
                    if (res && res.ok) {
                        ensureLibrary(true).then(() => renderBoard());
                    } else {
                        renderBoard();
                    }
                });
            });
            acts.appendChild(cancelBtn);
            acts.appendChild(saveBtn);
            form.appendChild(acts);
            boardEl.appendChild(form);
            return;
        }

        const tabs = document.createElement("div");
        tabs.className = "ag-meme-tabs";
        for (let i = 0; i < MOOD_TABS.length; i++) {
            const tab = MOOD_TABS[i];
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ag-meme-tab";
            btn.textContent = tab.label;
            if (boardState.mood === tab.id) btn.setAttribute("data-active", "true");
            btn.addEventListener("click", () => {
                boardState.mood = tab.id;
                renderBoard();
            });
            tabs.appendChild(btn);
        }
        boardEl.appendChild(tabs);

        const searchWrap = document.createElement("div");
        searchWrap.className = "ag-meme-search-wrap";
        const searchInp = document.createElement("input");
        searchInp.type = "text";
        searchInp.className = "ag-meme-search";
        searchInp.placeholder = "搜索描述或关键词（如：爱心眼、哈气、咖啡、哭）...";
        searchInp.value = boardState.query;
        searchInp.addEventListener("input", () => {
            boardState.query = searchInp.value;
            renderGridOnly();
        });
        searchWrap.appendChild(searchInp);
        boardEl.appendChild(searchWrap);

        const grid = document.createElement("div");
        grid.className = "ag-meme-grid";
        boardEl.appendChild(grid);

        const foot = document.createElement("div");
        foot.className = "ag-meme-foot";
        const footCap = document.createElement("span");
        footCap.className = "ag-meme-foot-cap";
        footCap.textContent = sendOnClick ? "点击贴纸立即发送 · 按住 Shift 点击仅填入框内" : "点击贴纸插入输入框 · 按住 Shift 点击立即发送";
        foot.appendChild(footCap);
        boardEl.appendChild(foot);

        function renderGridOnly() {
            grid.innerHTML = "";
            const rows = filterBoardMemes();
            if (!libState) {
                const msg = document.createElement("div");
                msg.style.cssText = "grid-column:1/-1;text-align:center;padding:36px 12px;font-size:12px;color:var(--muted-foreground)";
                msg.textContent = "正在加载 Gemini 猫娘表情库...";
                grid.appendChild(msg);
                return;
            }
            if (rows.length === 0) {
                const msg = document.createElement("div");
                msg.style.cssText = "grid-column:1/-1;text-align:center;padding:36px 12px;font-size:12px;color:var(--muted-foreground)";
                msg.textContent = "没有找到匹配的猫娘表情，点右上角 + 添图可导入自定义图片";
                grid.appendChild(msg);
                return;
            }
            for (let i = 0; i < rows.length; i++) {
                const item = rows[i];
                const cell = document.createElement("button");
                cell.type = "button";
                cell.className = "ag-meme-cell";
                cell.title = item.caption + (item.keywords ? " (" + item.keywords + ")" : "");
                const img = document.createElement("img");
                img.alt = item.caption;
                img.loading = "lazy";
                cell.appendChild(img);
                getMemeImageAsset(item).then((asset) => {
                    if (!asset || !asset.blobUrl || !img.isConnected) return;
                    let triedData = false;
                    img.onerror = () => {
                        if (!triedData && typeof asset.getDataUrl === "function") {
                            const dUrl = asset.getDataUrl();
                            if (dUrl && img.src !== dUrl) {
                                triedData = true;
                                img.src = dUrl;
                            }
                        }
                    };
                    img.src = asset.blobUrl;
                });
                cell.addEventListener("mouseenter", () => {
                    footCap.textContent = "[" + item.tag + "] " + item.caption;
                });
                cell.addEventListener("mouseleave", () => {
                    footCap.textContent = sendOnClick ? "点击贴纸立即发送 · 按住 Shift 点击仅填入" : "点击贴纸插入输入框 · 按住 Shift 点击直发";
                });
                cell.addEventListener("click", (e) => {
                    const forceSend = e.shiftKey ? !sendOnClick : sendOnClick;
                    insertMemeIntoComposer(activeComposer, item, forceSend);
                });
                grid.appendChild(cell);
            }
        }

        renderGridOnly();
        window.requestAnimationFrame(() => {
            if (searchInp.isConnected) searchInp.focus();
        });
    }

    function openBoard(composer, triggerBtn) {
        ensureMemeStyle();
        activeComposer = composer;
        if (!boardEl || !boardEl.isConnected) {
            boardEl = document.createElement("div");
            boardEl.className = "ag-meme-board";
            boardEl.setAttribute("data-ag-meme-board", "1");
            boardEl.setAttribute("data-ag-localization-skip", "true");
            (document.body || document.documentElement).appendChild(boardEl);
        }
        boardOpen = true;
        if (triggerBtn) triggerBtn.setAttribute("data-active", "true");
        boardEl.style.display = "flex";
        positionBoard(triggerBtn);
        ensureLibrary(false).then(() => {
            if (boardOpen) renderBoard();
        });
        renderBoard();
    }

    function closeBoard() {
        boardOpen = false;
        boardState.importDraft = null;
        if (boardEl) boardEl.style.display = "none";
        const activeBtns = document.querySelectorAll('[data-ag-meme-trigger="true"][data-active="true"]');
        for (let i = 0; i < activeBtns.length; i++) {
            activeBtns[i].setAttribute("data-active", "false");
        }
    }

    function mountMemeTriggers() {
        const enabled = getActiveMemeConfig().enabled !== false;
        let composers = Array.from(document.querySelectorAll('[id="antigravity.agentSidePanelInputBox"]'));
        if (composers.length === 0) {
            const editors = document.querySelectorAll('[data-lexical-editor="true"]');
            for (let i = 0; i < editors.length; i++) {
                const box = editors[i].closest(".surface-composer, [class*='rounded-2xl']");
                if (box && !composers.includes(box)) composers.push(box);
            }
        }
        for (let i = 0; i < composers.length; i++) {
            const composer = composers[i];
            let btn = composer.querySelector('[data-ag-meme-trigger="true"]');
            if (btn) {
                btn.style.display = enabled ? "inline-flex" : "none";
                continue;
            }
            if (!enabled) continue;

            const anchorBtn = composer.querySelector(
                '[data-testid="send-button"], [data-testid="send-button-pending"], [data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-record-tooltip"], button.agy-send-button'
            );
            if (!anchorBtn) continue;

            let insertBeforeNode = anchorBtn;
            const p = anchorBtn.parentElement;
            if (p && p.tagName === "DIV" && p.childElementCount === 1 && p.parentElement && p.parentElement !== composer &&
                !(p.parentElement.classList && p.parentElement.classList.contains("agy-composer-footer"))) {
                insertBeforeNode = p;
            }
            const bar = insertBeforeNode.parentElement;
            if (!bar) continue;

            btn = document.createElement("button");
            btn.type = "button";
            btn.className = "ag-meme-trigger";
            btn.setAttribute("data-ag-meme-trigger", "true");
            btn.setAttribute("data-ag-localization-skip", "true");
            btn.setAttribute("data-active", "false");
            btn.setAttribute("aria-label", "Gemini 猫娘表情包");
            btn.title = "Gemini 猫娘表情包 (⌘⇧M)";
            btn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10V5.5L8.5 8.2A7.5 7.5 0 0 1 12 7.5c1.25 0 2.43.28 3.5.7L19 5.5V10c.65 1.05 1 2.28 1 3.6 0 3.98-3.58 6.9-8 6.9s-8-2.92-8-6.9c0-1.32.35-2.55 1-3.6Z"/><circle cx="9.2" cy="13.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13.2" r="1" fill="currentColor" stroke="none"/><path d="M10.2 16c.5.55 1.2.7 1.8.2.6.5 1.3.35 1.8-.2"/></svg>';

            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (boardOpen && activeComposer === composer) closeBoard();
                else openBoard(composer, btn);
            });
            bar.insertBefore(btn, insertBeforeNode);
        }
    }

    function syncMemeSettingsRow() {
        const cfg = getActiveMemeConfig();
        const headings = document.querySelectorAll("h3");
        for (let i = 0; i < headings.length; i++) {
            const h3 = headings[i];
            if (h3.childElementCount > 0) continue;
            const title = (h3.textContent || "").trim();
            if (title !== "聊天宽度" && title !== "Chat Width") continue;
            const sectionRoot = h3.closest(".space-y-2") || (h3.parentElement && h3.parentElement.parentElement && h3.parentElement.parentElement.parentElement);
            if (!sectionRoot) continue;
            const card = sectionRoot.querySelector(".agy-card");
            if (!card) continue;

            let row = card.querySelector('[data-ag-ux-meme-row="true"]');
            if (!row) {
                row = document.createElement("div");
                row.setAttribute("data-ag-ux-meme-row", "true");
                row.setAttribute("data-ag-localization-skip", "true");
                row.className = "py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center";

                const leftCol = document.createElement("div");
                leftCol.className = "flex-1 flex flex-col gap-1";

                const labelWrap = document.createElement("div");
                labelWrap.className = "flex items-center gap-1.5";
                const labelEl = document.createElement("span");
                labelEl.className = "text-sm";
                labelEl.id = "ag-ux-meme-label";
                labelEl.textContent = "Gemini 猫娘表情包";
                const badgeEl = document.createElement("span");
                badgeEl.className = "text-[10px] font-semibold leading-none bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full select-none border border-border";
                badgeEl.textContent = "Meme";
                labelWrap.appendChild(labelEl);
                labelWrap.appendChild(badgeEl);

                const descEl = document.createElement("span");
                descEl.className = "text-xs text-muted-foreground whitespace-pre-wrap";
                descEl.textContent = "开启后将聊天中的 [表情: ...] 渲染为猫娘贴纸，并在输入框工具栏提供表情面板与点击放大。";

                const quickActs = document.createElement("div");
                quickActs.className = "flex items-center gap-2 pt-0.5";

                const sendModeBtn = document.createElement("button");
                sendModeBtn.type = "button";
                sendModeBtn.setAttribute("data-ag-meme-sendmode", "true");
                sendModeBtn.className = "text-[11px] px-2 py-0.5 rounded-md border border-border bg-secondary/60 hover:bg-secondary text-foreground cursor-pointer";
                sendModeBtn.addEventListener("click", () => {
                    const cur = getActiveMemeConfig().pickerSendOnClick !== false;
                    invokeFn("ag-ux:meme-save-config", { pickerSendOnClick: !cur }).then((res) => {
                        if (res && res.ok) {
                            configOverrideSeq++;
                            configOverride = res.config;
                            if (libState) libState.config = res.config;
                            syncMemeSettingsRow();
                            if (boardOpen) renderBoard();
                        }
                    });
                });

                const openDirBtn = document.createElement("button");
                openDirBtn.type = "button";
                openDirBtn.className = "text-[11px] px-2 py-0.5 rounded-md border border-border bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground cursor-pointer";
                openDirBtn.textContent = "打开图库文件夹";
                openDirBtn.addEventListener("click", () => invokeFn("ag-ux:meme-open-pack-dir"));

                quickActs.appendChild(sendModeBtn);
                quickActs.appendChild(openDirBtn);

                leftCol.appendChild(labelWrap);
                leftCol.appendChild(descEl);
                leftCol.appendChild(quickActs);

                const rightCol = document.createElement("div");
                rightCol.className = "shrink-0";

                const switchBtn = document.createElement("button");
                switchBtn.type = "button";
                switchBtn.setAttribute("data-ag-meme-main-switch", "true");
                switchBtn.setAttribute("role", "switch");
                switchBtn.setAttribute("aria-labelledby", "ag-ux-meme-label");
                const thumbEl = document.createElement("span");
                thumbEl.className = "inline-block rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm h-4 w-4";
                switchBtn.appendChild(thumbEl);
                switchBtn.addEventListener("click", () => {
                    const curEnabled = getActiveMemeConfig().enabled !== false;
                    invokeFn("ag-ux:meme-save-config", { enabled: !curEnabled }).then((res) => {
                        if (res && res.ok) {
                            configOverrideSeq++;
                            configOverride = res.config;
                            if (libState) libState.config = res.config;
                            if (!res.config.enabled) {
                                closeBoard();
                                closeZoom();
                            }
                            syncMemeSettingsRow();
                            syncMemes();
                        }
                    });
                });

                rightCol.appendChild(switchBtn);
                row.appendChild(leftCol);
                row.appendChild(rightCol);
                card.appendChild(row);
            }

            const enabledNow = cfg.enabled !== false;
            const sendOnClickNow = cfg.pickerSendOnClick !== false;
            const switchBtn = row.querySelector('[data-ag-meme-main-switch="true"]');
            const sendModeBtn = row.querySelector('[data-ag-meme-sendmode="true"]');
            if (switchBtn) {
                switchBtn.setAttribute("aria-checked", enabledNow ? "true" : "false");
                switchBtn.className = "relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 h-6 w-11 cursor-pointer " + (enabledNow ? "bg-primary" : "bg-secondary");
                const thumb = switchBtn.firstElementChild;
                if (thumb) thumb.style.transform = enabledNow ? "translateX(24px)" : "translateX(4px)";
            }
            if (sendModeBtn) {
                const nextModeText = sendOnClickNow ? "点击模式：点图直发" : "点击模式：先填入输入框";
                if (sendModeBtn.textContent !== nextModeText) {
                    sendModeBtn.textContent = nextModeText;
                }
            }
        }
    }

    function syncMemes() {
        ensureMemeStyle();
        mountMemeTriggers();
        syncMemeSettingsRow();
        syncBubbleMemes();
    }

    if (!document.__agMemeListenersBound) {
        document.__agMemeListenersBound = true;
        document.addEventListener("click", (e) => {
            const t = e.target;
            if (t && t.tagName === "IMG" && t.getAttribute("data-ag-meme-img") === "1") {
                if (t.closest("button, a, [role='button']")) return;
                e.preventDefault();
                e.stopPropagation();
                openZoom(t.currentSrc || t.src, t.getAttribute("data-ag-meme-caption") || t.alt);
                return;
            }
            if (boardOpen && boardEl && t && !boardEl.contains(t) && !(t.closest && t.closest('[data-ag-meme-trigger="true"]'))) {
                closeBoard();
            }
        }, true);

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (zoomBox && zoomBox.style.display === "flex") {
                    e.stopPropagation();
                    closeZoom();
                    return;
                }
                if (boardOpen) {
                    e.stopPropagation();
                    closeBoard();
                    return;
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && String(e.key || "").toLowerCase() === "m") {
                const enabled = !libState || !libState.config || libState.config.enabled !== false;
                if (!enabled) return;
                const composer = document.querySelector('[id="antigravity.agentSidePanelInputBox"]') ||
                    (document.querySelector('[data-lexical-editor="true"]') && document.querySelector('[data-lexical-editor="true"]').closest(".surface-composer, [class*='rounded-2xl']"));
                const btn = composer && composer.querySelector('[data-ag-meme-trigger="true"]');
                if (composer && btn) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (boardOpen) closeBoard();
                    else openBoard(composer, btn);
                }
            }
        }, true);
    }

    let memeRafPending = false;
    globalThis.__agScheduleMemeSync = function() {
        if (memeRafPending) return;
        memeRafPending = true;
        window.requestAnimationFrame(() => {
            memeRafPending = false;
            try {
                syncMemes();
            } catch (e) {}
        });
    };

    ensureMemeStyle();
    ensureLibrary(false);
    if (document.readyState !== "loading") {
        globalThis.__agScheduleMemeSync();
    } else {
        document.addEventListener("DOMContentLoaded", () => globalThis.__agScheduleMemeSync());
    }
}

function removeMarkedBlocks(content, startMark, endMark) {
    let cleaned = content;
    let startIdx = cleaned.indexOf(startMark);
    while (startIdx !== -1) {
        const endIdx = cleaned.indexOf(endMark, startIdx + startMark.length);
        if (endIdx === -1) break;
        cleaned = cleaned.substring(0, startIdx) + cleaned.substring(endIdx + endMark.length);
        startIdx = cleaned.indexOf(startMark);
    }
    return cleaned;
}

function cleanJsContent(content) {
    const withoutLegacy = removeMarkedBlocks(content, LEGACY_SIGNATURE_START, LEGACY_SIGNATURE_END);
    const withoutSig = removeMarkedBlocks(withoutLegacy, SIGNATURE_START, SIGNATURE_END);
    return withoutSig.replace(
        "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', typeof globalThis.__agTranslateContextMenuItems === 'function' ? globalThis.__agTranslateContextMenuItems(items) : items),",
        "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', items),"
    );
}

function cleanMenuJsContent(content) {
    const withoutLegacy = removeMarkedBlocks(content, LEGACY_MENU_SIGNATURE_START, LEGACY_MENU_SIGNATURE_END);
    return removeMarkedBlocks(withoutLegacy, MENU_SIGNATURE_START, MENU_SIGNATURE_END);
}

function cleanTrayJsContent(content) {
    const withoutLegacy = removeMarkedBlocks(content, LEGACY_TRAY_SIGNATURE_START, LEGACY_TRAY_SIGNATURE_END);
    return removeMarkedBlocks(withoutLegacy, TRAY_SIGNATURE_START, TRAY_SIGNATURE_END);
}

function cleanIpcHandlersJsContent(content) {
    const withoutMenu = removeMarkedBlocks(content, IPC_CONTEXT_MENU_SIGNATURE_START, IPC_CONTEXT_MENU_SIGNATURE_END);
    const withoutOffice = removeMarkedBlocks(withoutMenu, IPC_OFFICE_PREVIEW_SIGNATURE_START, IPC_OFFICE_PREVIEW_SIGNATURE_END);
    return removeMarkedBlocks(withoutOffice, IPC_MEME_SIGNATURE_START, IPC_MEME_SIGNATURE_END)
        .replace("electron_1.dialog.showErrorBox('无法打开文件夹', t.error);", "electron_1.dialog.showErrorBox('Cannot open folder', t.error);")
        .replace("message: '文件夹位于 Windows 文件系统中',", "message: 'Folder is on the Windows filesystem',")
        .replace("title: '打开工作区',", "title: 'Open workspace',");
}

function cleanMainJsContent(content) {
    return removeMarkedBlocks(content, MAIN_SUBFRAME_SIGNATURE_START, MAIN_SUBFRAME_SIGNATURE_END)
        .replace("await electron_1.dialog.showErrorBox('未找到可执行文件', msg);", "await electron_1.dialog.showErrorBox('Binary not found', msg);")
        .replace("title: '未找到 WSL 分发版',", "title: 'WSL distro not found',")
        .replace("`WSL 分发版 \"${WSL_DISTRO}\" 已不再安装.`", "`The WSL distro \"${WSL_DISTRO}\" is no longer installed.`")
        .replace("detail: 'Antigravity 已改为在 Windows 本地打开.',", "detail: 'Antigravity opened on Windows instead.',")
        .replace("await electron_1.dialog.showErrorBox('WSL 设置失败', msg);", "await electron_1.dialog.showErrorBox('WSL setup failed', msg);")
        .replace("`未能将服务端安装至 WSL 分发版 \"${WSL_DISTRO}\"：\\n${err.message}`", "`Failed to install the server into WSL distro \"${WSL_DISTRO}\":\\n${err.message}`")
        .replace("await electron_1.dialog.showErrorBox('启动失败', msg);", "await electron_1.dialog.showErrorBox('Startup failed', msg);")
        .replace(
            /(buttons:\s*)\['取消',\s*'退出'\](,\s*defaultId:\s*1,\s*cancelId:\s*0,\s*title:\s*)'确认退出'(,\s*message:\s*)'确定要退出吗？'(,\s*detail:\s*)'当前可能仍有智能体或后台任务正在运行\.'/g,
            "$1['Cancel', 'Quit']$2'Confirm Quit'$3'Are you sure you want to quit?'$4'There may be agents or background tasks running.'"
        );
}

function cleanUtilsJsContent(content) {
    return removeMarkedBlocks(content, UTILS_SUBFRAME_SIGNATURE_START, UTILS_SUBFRAME_SIGNATURE_END);
}

let wasAppRunning = false;

function getPosixTargetUid() {
    const sudoUidText = String(process.env.SUDO_UID || '');
    if (/^\d+$/.test(sudoUidText)) return Number(sudoUidText);
    return typeof process.getuid === 'function' ? process.getuid() : null;
}

function getPosixProcessTable() {
    try {
        const stdout = child_process.execFileSync(
            'ps',
            ['-eo', 'pid=,ppid=,uid=,stat=,comm=,args='],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        return stdout.split(/\r?\n/).map(line => {
            const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
            if (!match) return null;
            return {
                pid: Number(match[1]),
                ppid: Number(match[2]),
                uid: Number(match[3]),
                stat: match[4],
                comm: match[5],
                args: match[6] || ''
            };
        }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function isPosixAntigravityMainProcess(entry, targetUid = getPosixTargetUid()) {
    if (targetUid !== null && entry.uid !== targetUid) return false;
    if (/(?:^|\s)--type(?:=|\s)/i.test(entry.args)) return false;

    const commBase = path.basename(entry.comm).toLowerCase();
    if (commBase === 'antigravity') return true;

    return /^\s*\/.*\/Antigravity\.app\/Contents\/MacOS\/Antigravity(?:\s|$)/i.test(entry.args);
}

function getPosixAntigravityMainProcesses(processTable = getPosixProcessTable()) {
    const targetUid = getPosixTargetUid();
    return processTable.filter(entry => isPosixAntigravityMainProcess(entry, targetUid));
}

function collectPosixProcessTreePids(processTable, rootPids) {
    const collected = new Set(rootPids);
    let changed = true;
    while (changed) {
        changed = false;
        for (const entry of processTable) {
            if (!collected.has(entry.ppid) || collected.has(entry.pid)) continue;
            collected.add(entry.pid);
            changed = true;
        }
    }
    return collected;
}

function refreshPosixProcessTree(trackedPids) {
    const processTable = getPosixProcessTable();
    const expanded = collectPosixProcessTreePids(processTable, trackedPids);
    for (const pid of expanded) trackedPids.add(pid);
    return processTable.filter(entry => {
        return trackedPids.has(entry.pid) && !entry.stat.toUpperCase().startsWith('Z');
    });
}

function sleepSync(milliseconds) {
    const waitArray = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(waitArray, 0, 0, milliseconds);
}

function signalPosixProcesses(processEntries, signal) {
    for (const entry of processEntries) {
        try {
            process.kill(entry.pid, signal);
        } catch (e) {
            if (e.code !== 'ESRCH') {
                console.warn("[警告] 无法向进程 " + entry.pid + " (" + entry.comm + ") 发送 " + signal + ": " + e.message);
            }
        }
    }
}

function waitForPosixProcessTreeExit(trackedPids, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let remaining = refreshPosixProcessTree(trackedPids);
    while (remaining.length > 0 && Date.now() < deadline) {
        sleepSync(100);
        remaining = refreshPosixProcessTree(trackedPids);
    }
    return remaining;
}

function checkIfAppIsRunning() {
    try {
        if (process.platform === 'win32') {
            const stdout = child_process.execSync('tasklist /fi "imagename eq Antigravity.exe" /nh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return stdout.toLowerCase().includes('antigravity.exe');
        } else {
            const processTable = getPosixProcessTable();
            if (processTable.length === 0) return true;
            return getPosixAntigravityMainProcesses(processTable).length > 0;
        }
    } catch (e) {
    }
    return false;
}

function closeAntigravityProcesses() {
    console.log("[1] 检测到 Antigravity 客户端正在运行，正在等待客户端完整退出...");
    try {
        if (process.platform === 'win32') {
            child_process.execSync('taskkill /f /im Antigravity.exe /t >nul 2>nul');
            sleepSync(1500);
            return true;
        }
    } catch (e) {
        console.error("[错误] 关闭 Antigravity 失败: " + e.message);
        return false;
    }

    const platformLabel = process.platform === 'darwin' ? 'macOS' : 'Linux';
    const processTable = getPosixProcessTable();
    if (processTable.length === 0) {
        console.error(`[错误] 无法读取 ${platformLabel} 进程列表，已停止汉化以避免覆盖运行中的客户端文件。`);
        return false;
    }
    const mainProcesses = getPosixAntigravityMainProcesses(processTable);
    if (mainProcesses.length === 0) return true;

    const trackedPids = collectPosixProcessTreePids(
        processTable,
        mainProcesses.map(entry => entry.pid)
    );
    const mainPids = new Set(mainProcesses.map(entry => entry.pid));

    signalPosixProcesses(mainProcesses, 'SIGTERM');
    let remaining = waitForPosixProcessTreeExit(trackedPids, 10000);

    if (remaining.length > 0) {
        const remainingMainProcesses = remaining.filter(entry => mainPids.has(entry.pid));
        if (remainingMainProcesses.length > 0) {
            console.log("[等待] Antigravity 主进程仍在关闭，正在再次请求正常退出...");
            signalPosixProcesses(remainingMainProcesses, 'SIGTERM');
            remaining = waitForPosixProcessTreeExit(trackedPids, 5000);
        }
    }

    if (remaining.length > 0 && !remaining.some(entry => mainPids.has(entry.pid))) {
        console.log("[等待] 主程序已退出，正在关闭 " + remaining.length + " 个遗留后台进程...");
        signalPosixProcesses(remaining, 'SIGTERM');
        remaining = waitForPosixProcessTreeExit(trackedPids, 5000);
    }

    if (remaining.length > 0) {
        const summary = remaining
            .slice(0, 8)
            .map(entry => entry.pid + " (" + entry.comm + ")")
            .join(', ');
        console.error("[错误] Antigravity 未能完整退出，已停止汉化以保护正在运行的客户端。");
        console.error("[错误] 仍在运行: " + summary + (remaining.length > 8 ? ' ...' : ''));
        console.error("[提示] 请确认客户端和相关后台任务已结束后重新运行安装脚本。");
        return false;
    }

    console.log("[√] Antigravity 主程序及后台进程已完整退出。");
    return true;
}

function detectInstallationDir(manualDir, options = {}) {
    const quiet = Boolean(options && options.quiet);
    const hasAntigravityResources = (candidate) => {
        return fs.existsSync(path.join(candidate, "resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "resources", "app.asar.bak")) ||
            fs.existsSync(path.join(candidate, "app.asar")) ||
            fs.existsSync(path.join(candidate, "app.asar.bak")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar")) ||
            fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar.bak")) ||
            fs.existsSync(path.join(candidate, "resources", "app", "product.json"));
    };

    if (manualDir) {
        if (fs.existsSync(manualDir)) {
            let resolved = path.resolve(manualDir);
            if (fs.statSync(resolved).isFile() && resolved.endsWith('app.asar')) {
                resolved = path.dirname(resolved);
            }
            if (!hasAntigravityResources(resolved) && fs.statSync(resolved).isDirectory()) {
                try {
                    const subItems = fs.readdirSync(resolved);
                    for (const sub of subItems) {
                        const subPath = path.join(resolved, sub);
                        if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory() && hasAntigravityResources(subPath)) {
                            return path.resolve(subPath);
                        }
                    }
                } catch (e) {}
            }
            return resolved;
        } else {
            if (quiet) return null;
            console.error(`[错误] 手动指定的路径不存在: ${manualDir}`);
            process.exit(1);
        }
    }

    const candidates = [];
    const seenCandidates = new Set();
    const addCandidate = (candidate) => {
        if (!candidate) return;
        const normalized = path.resolve(candidate);
        const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
        if (!seenCandidates.has(key)) {
            candidates.push(normalized);
            seenCandidates.add(key);
        }
    };

    addCandidate(process.env.ANTIGRAVITY_INSTALL_DIR);
    addCandidate(process.env.ANTIGRAVITY_HOME);

    if (process.platform === 'win32') {
        const registryRoots = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ];
        for (const root of registryRoots) {
            try {
                const output = child_process.execSync(`reg query "${root}" /s /f Antigravity /d`, { encoding: 'utf-8', stdio: 'pipe' });
                for (const line of output.split(/\r?\n/)) {
                    const match = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
                    if (!match) continue;
                    let value = match[2].trim().replace(/^"|"$/g, '');
                    if (/Antigravity\.exe/i.test(value)) {
                        value = path.dirname(value);
                    }
                    addCandidate(value);
                }
            } catch (e) {
            }
        }
        const driveLetters = ['C', 'D', 'E', 'F'];
        for (const drive of driveLetters) {
            addCandidate(`${drive}:\\Programs\\Antigravity`);
            addCandidate(`${drive}:\\Antigravity`);
        }
        addCandidate("C:\\Program Files\\Antigravity");
        addCandidate("C:\\Program Files (x86)\\Antigravity");
        const localAppdata = process.env.LOCALAPPDATA;
        if (localAppdata) {
            addCandidate(path.join(localAppdata, 'antigravity'));
            addCandidate(path.join(localAppdata, 'Programs', 'antigravity'));
        }
    } else if (process.platform === 'darwin') {
        const homeDirs = [];
        if (process.env.HOME) homeDirs.push(process.env.HOME);
        if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
            const sudoHome = path.join('/Users', process.env.SUDO_USER);
            if (fs.existsSync(sudoHome) && !homeDirs.includes(sudoHome)) {
                homeDirs.push(sudoHome);
            }
        }
        addCandidate('/Applications/Antigravity.app');
        for (const h of homeDirs) {
            addCandidate(path.join(h, 'Applications', 'Antigravity.app'));
        }
        try {
            const mdfindOut = child_process.execSync('mdfind "kMDItemFSName == \'Antigravity.app\'" 2>/dev/null', { encoding: 'utf-8' });
            for (const line of mdfindOut.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.includes('/.Trash') && !trimmed.includes('/.Trashes') && !trimmed.startsWith('/Volumes/')) {
                    addCandidate(trimmed);
                }
            }
        } catch (e) {}
    } else {
        const homeDirs = [];
        if (process.env.HOME) homeDirs.push(process.env.HOME);
        if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
            let sudoHome = '';
            try {
                const getent = child_process.execSync(`getent passwd "${process.env.SUDO_USER}" 2>/dev/null`, { encoding: 'utf-8' }).trim();
                if (getent) {
                    const parts = getent.split(':');
                    if (parts.length >= 6 && parts[5]) {
                        sudoHome = parts[5];
                    }
                }
            } catch (e) {}
            if (!sudoHome) {
                sudoHome = path.join('/home', process.env.SUDO_USER);
            }
            if (fs.existsSync(sudoHome) && !homeDirs.includes(sudoHome)) {
                homeDirs.push(sudoHome);
            }
        }

        const isRunningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

        const addHomeCandidates = () => {
            for (const homeDir of homeDirs) {
                addCandidate(path.join(homeDir, '.local', 'share', 'antigravity'));
                addCandidate(path.join(homeDir, '.local', 'share', 'Antigravity'));
                addCandidate(path.join(homeDir, 'antigravity'));
                addCandidate(path.join(homeDir, 'Antigravity'));
                addCandidate(path.join(homeDir, '.local', 'share', 'flatpak', 'app', 'com.antigravity', 'current', 'active', 'files', 'share', 'antigravity'));
            }
            for (const homeDir of homeDirs) {
                const userDesktopFiles = [
                    path.join(homeDir, '.local', 'share', 'applications', 'antigravity.desktop'),
                    path.join(homeDir, '.local', 'share', 'applications', 'Antigravity.desktop')
                ];
                for (const df of userDesktopFiles) {
                    if (fs.existsSync(df)) {
                        try {
                            const content = fs.readFileSync(df, 'utf-8');
                            const execMatch = content.match(/^Exec=(.*)$/m);
                            if (execMatch && execMatch[1]) {
                                let execPath = execMatch[1].trim().split(/\s+/)[0].replace(/^"|"$/g, '');
                                if (fs.existsSync(execPath)) {
                                    try { execPath = fs.realpathSync(execPath); } catch (e) {}
                                    addCandidate(path.dirname(execPath));
                                }
                            }
                        } catch (e) {}
                    }
                }
            }
        };

        const addSystemCandidates = () => {
            try {
                const whichOut = child_process.execSync(
                    'command -v antigravity 2>/dev/null || which antigravity 2>/dev/null || command -v agy 2>/dev/null || which agy 2>/dev/null || command -v Antigravity 2>/dev/null || which Antigravity 2>/dev/null',
                    { encoding: 'utf-8' }
                ).trim();
                if (whichOut && fs.existsSync(whichOut)) {
                    let realP = whichOut;
                    try { realP = fs.realpathSync(whichOut); } catch (e) {}
                    addCandidate(path.dirname(realP));
                    try {
                        const fileContent = fs.readFileSync(realP, 'utf-8');
                        const scriptMatch = fileContent.match(/(?:\/opt|\/usr|\/home\/[^\s'"]+)\/[^\s'"]*antigravity[^\s'"]*/i);
                        if (scriptMatch && fs.existsSync(scriptMatch[0])) {
                            let target = scriptMatch[0];
                            try { target = fs.realpathSync(target); } catch (e) {}
                            addCandidate(fs.statSync(target).isDirectory() ? target : path.dirname(target));
                        }
                    } catch (e) {}
                }
            } catch (e) {}

            const desktopFiles = [
                '/usr/share/applications/antigravity.desktop',
                '/usr/share/applications/Antigravity.desktop',
                '/usr/local/share/applications/antigravity.desktop',
                '/usr/local/share/applications/Antigravity.desktop'
            ];
            for (const df of desktopFiles) {
                if (fs.existsSync(df)) {
                    try {
                        const content = fs.readFileSync(df, 'utf-8');
                        const execMatch = content.match(/^Exec=(.*)$/m);
                        if (execMatch && execMatch[1]) {
                            let execPath = execMatch[1].trim().split(/\s+/)[0].replace(/^"|"$/g, '');
                            if (fs.existsSync(execPath)) {
                                try { execPath = fs.realpathSync(execPath); } catch (e) {}
                                addCandidate(path.dirname(execPath));
                            }
                        }
                    } catch (e) {}
                }
            }

            addCandidate('/opt/antigravity/Antigravity-x64');
            addCandidate('/opt/antigravity/antigravity-x64');
            addCandidate('/opt/Antigravity/Antigravity-x64');
            addCandidate('/opt/antigravity');
            addCandidate('/opt/Antigravity');
            addCandidate('/usr/local/share/antigravity');
            addCandidate('/usr/local/share/Antigravity');
            addCandidate('/usr/share/antigravity');
            addCandidate('/usr/share/Antigravity');
            addCandidate('/usr/lib/antigravity');
            addCandidate('/usr/lib/Antigravity');
            addCandidate('/snap/antigravity/current');
            addCandidate('/snap/antigravity/current/usr/share/antigravity');
            addCandidate('/var/lib/flatpak/app/com.antigravity/current/active/files/share/antigravity');
        };

        if (isRunningAsRoot) {
            addSystemCandidates();
            addHomeCandidates();
        } else {
            addHomeCandidates();
            addSystemCandidates();
        }
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            if (hasAntigravityResources(p)) {
                if (!quiet) console.log(`[探测] 成功自动识别到 Antigravity 安装目录: ${p}`);
                return path.resolve(p);
            }
            try {
                if (fs.statSync(p).isDirectory()) {
                    const subItems = fs.readdirSync(p);
                    for (const sub of subItems) {
                        const subPath = path.join(p, sub);
                        if (fs.existsSync(subPath) && fs.statSync(subPath).isDirectory() && hasAntigravityResources(subPath)) {
                            if (!quiet) console.log(`[探测] 成功自动识别到 Antigravity 安装目录: ${subPath}`);
                            return path.resolve(subPath);
                        }
                    }
                }
            } catch (e) {}
        }
    }

    if (quiet) return null;
    console.error("[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！");
    process.exit(1);
}

function runCommandSync(cmd, args) {
    try {
        if (Array.isArray(args)) {
            const res = child_process.spawnSync(cmd, args, { encoding: 'utf-8', stdio: 'pipe' });
            if (res.error) throw res.error;
            return {
                success: res.status === 0,
                stdout: res.stdout || '',
                stderr: res.stderr || ''
            };
        }
        const out = child_process.execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' });
        return { success: true, stdout: out, stderr: '' };
    } catch (e) {
        return { success: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
    }
}

function reportWritePermissionError(resourcesDir, error, action, entryScript = 'install.sh') {
    const detail = error && (error.code || error.message);
    console.error(`\n[权限不足] 无法${action} Antigravity 安装目录: ${resourcesDir}`);
    if (detail) console.error(`[详情] ${detail}`);

    if (process.platform === 'win32') {
        console.error("[提示] 请右键安装脚本并选择“以管理员身份运行”，然后重试。");
    } else {
        console.error("[提示] 此安装位于系统目录，需要管理员权限。请完全退出客户端后，在汉化包目录运行：");
        console.error(`  sudo ./${entryScript}`);
    }
}

function findMacAppBundle(resourcesDir) {
    if (!resourcesDir) return null;
    let current = path.resolve(resourcesDir);
    while (current && current !== path.dirname(current)) {
        if (current.toLowerCase().endsWith('.app') && fs.existsSync(current)) {
            return current;
        }
        current = path.dirname(current);
    }
    return null;
}

function canWriteAntigravityResources(resourcesDir, entryScript) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");
    if (!fs.existsSync(asarPath) && !fs.existsSync(bakPath)) return true;

    try {
        fs.accessSync(resourcesDir, fs.constants.W_OK | fs.constants.X_OK);
        if (fs.existsSync(asarPath)) {
            fs.accessSync(asarPath, fs.constants.R_OK | fs.constants.W_OK);
        }
        if (fs.existsSync(bakPath)) {
            fs.accessSync(bakPath, fs.constants.R_OK | fs.constants.W_OK);
        }
        if (process.platform === 'darwin') {
            const targetApp = findMacAppBundle(resourcesDir);
            if (targetApp) {
                fs.accessSync(targetApp, fs.constants.W_OK | fs.constants.X_OK);
            }
        }
        return true;
    } catch (e) {
        reportWritePermissionError(resourcesDir, e, '写入', entryScript);
        return false;
    }
}

function resignAppOnMac(resourcesDir) {
    if (process.platform !== 'darwin') return true;

    let targetApp = findMacAppBundle(resourcesDir);
    if (!targetApp) {
        console.warn("[警告] 未能识别到 Antigravity.app 目录结构，跳过 macOS 重签名。");
        return true;
    }
    try {
        targetApp = fs.realpathSync(targetApp);
    } catch (e) {}

    console.log(`[签名] 正在清理 macOS 隔离属性并执行自签名: ${targetApp}`);
    const xattrRes = runCommandSync('xattr', ['-cr', targetApp]);
    if (!xattrRes.success) {
        console.warn(`[警告] 清理 quarantine 属性时出现提示: ${xattrRes.stderr || xattrRes.stdout}`);
    }

    // 由内而外（Inside-Out）优先重签内部 Frameworks / Dylibs / Helpers，
    // 嵌套的 .framework 与 .app 需带上 --deep 确保其内部动态库及辅助程序完成签名，
    // 避免顶层签名时遗留旧签名导致 dyld 报签名/校验不一致。
    const frameworksDir = path.join(targetApp, 'Contents', 'Frameworks');
    if (fs.existsSync(frameworksDir)) {
        try {
            const entries = fs.readdirSync(frameworksDir);
            for (const entry of entries) {
                const fullPath = path.join(frameworksDir, entry);
                if (entry.endsWith('.framework') || entry.endsWith('.app')) {
                    const res = runCommandSync('codesign', ['--force', '--deep', '--sign', '-', fullPath]);
                    if (!res.success) {
                        console.warn(`[警告] 重签内部组件 ${entry} 出现提示: ${res.stderr || res.stdout}`);
                    }
                } else if (entry.endsWith('.dylib')) {
                    const res = runCommandSync('codesign', ['--force', '--sign', '-', fullPath]);
                    if (!res.success) {
                        console.warn(`[警告] 重签内部动态库 ${entry} 出现提示: ${res.stderr || res.stdout}`);
                    }
                }
            }
        } catch (e) {
            console.warn(`[警告] 遍历 Frameworks 目录失败: ${e.message}`);
        }
    }

    // 注意：绝不能传入 --preserve-metadata=flags,runtime！
    // 否则会保留 Hardened Runtime（硬化运行时），而硬化运行时默认强制执行 Library Validation（库校验）；
    // 在本地自签名（ad-hoc，-）缺少 Apple Team ID 的情况下，dyld 会因 Team ID 不一致在启动阶段直接终止进程闪退（SIGABRT）。
    const signRes = runCommandSync('codesign', [
        '--force',
        '--deep',
        '--sign',
        '-',
        targetApp
    ]);
    if (!signRes.success) {
        console.error(`[错误] macOS 应用签名失败。`);
        console.error(`详情: ${signRes.stderr}\n${signRes.stdout}`);
        console.error(`[提示] 请检查是否已安装 Xcode Command Line Tools (xcode-select --install)。`);
        return false;
    }

    console.log(`[√] macOS 应用自签名成功！`);
    return true;
}

class AsarArchive {
    static align4(n) {
        return (n + 3) & ~3;
    }

    static readHeader(asarPath) {
        const fd = fs.openSync(asarPath, 'r');
        try {
            const sizeBuf = Buffer.alloc(8);
            fs.readSync(fd, sizeBuf, 0, 8, 0);

            const headerSize = sizeBuf.readUInt32LE(4);
            const headerBuf = Buffer.alloc(headerSize);
            fs.readSync(fd, headerBuf, 0, headerSize, 8);

            const jsonLen = headerBuf.readUInt32LE(4);
            const jsonStr = headerBuf.slice(8, 8 + jsonLen).toString('utf8');
            const header = JSON.parse(jsonStr);
            const baseOffset = 8 + headerSize;
            return { header, baseOffset, headerSize, jsonLen };
        } finally {
            fs.closeSync(fd);
        }
    }

    static createHeaderBuffer(headerJson) {
        const jsonBuf = Buffer.from(headerJson, 'utf8');
        const jsonLen = jsonBuf.length;
        const alignedJsonLen = this.align4(jsonLen);

        const headerPayloadSize = 4 + alignedJsonLen;
        const headerBuf = Buffer.alloc(4 + headerPayloadSize);
        headerBuf.writeUInt32LE(headerPayloadSize, 0);
        headerBuf.writeUInt32LE(jsonLen, 4);
        jsonBuf.copy(headerBuf, 8);

        const sizeBuf = Buffer.alloc(8);
        sizeBuf.writeUInt32LE(4, 0);
        sizeBuf.writeUInt32LE(headerBuf.length, 4);

        return Buffer.concat([sizeBuf, headerBuf]);
    }

    static readFile(sourceAsar, relPath) {
        const { header, baseOffset } = this.readHeader(sourceAsar);
        const parts = relPath.replace(/\\/g, '/').split('/');
        let cur = header.files;
        for (const p of parts) {
            if (!cur || !cur[p]) return null;
            cur = cur[p].files ? cur[p].files : cur[p];
        }
        if (cur.unpacked) {
            const unpackedPath = path.join(`${sourceAsar}.unpacked`, ...parts);
            if (fs.existsSync(unpackedPath)) return fs.readFileSync(unpackedPath);
            return null;
        }
        if (cur.offset === undefined || cur.size === undefined) return null;
        const fd = fs.openSync(sourceAsar, 'r');
        try {
            const buf = Buffer.alloc(cur.size);
            fs.readSync(fd, buf, 0, cur.size, baseOffset + parseInt(cur.offset));
            return buf;
        } finally {
            fs.closeSync(fd);
        }
    }

    static patchArchive(sourceAsar, targetAsar, filePatches) {
        const { header, baseOffset } = this.readHeader(sourceAsar);
        const srcFd = fs.openSync(sourceAsar, 'r');
        let destFd = null;

        try {
            const fileEntries = [];
            function walk(dir, currentPath) {
                for (const [name, entry] of Object.entries(dir)) {
                    const fullPath = currentPath ? `${currentPath}/${name}` : name;
                    if (entry.files) {
                        walk(entry.files, fullPath);
                    } else {
                        fileEntries.push({ path: fullPath, entry });
                    }
                }
            }
            walk(header.files, '');

            const existingPaths = new Set(fileEntries.map(f => f.path));
            const packedFiles = fileEntries.filter(f => !f.entry.unpacked && f.entry.offset !== undefined);
            packedFiles.sort((a, b) => parseInt(a.entry.offset) - parseInt(b.entry.offset));

            for (const item of packedFiles) {
                item.oldOffset = parseInt(item.entry.offset);
                item.oldSize = item.entry.size;
                const patch = filePatches[item.path];
                if (patch !== undefined && patch !== null) {
                    const patchBuf = Buffer.isBuffer(patch) ? patch : Buffer.from(patch, 'utf8');
                    item.patchBuffer = patchBuf;
                    item.entry.size = patchBuf.length;
                }
            }

            for (const [rawPatchPath, patch] of Object.entries(filePatches)) {
                const patchPath = rawPatchPath.replace(/\\/g, '/').replace(/^\/+/, '');
                if (!patchPath || existingPaths.has(patchPath) || patch === undefined || patch === null) continue;
                const parts = patchPath.split('/');
                let dir = header.files;
                for (let i = 0; i < parts.length - 1; i++) {
                    const seg = parts[i];
                    if (!dir[seg] || !dir[seg].files) {
                        dir[seg] = { files: {} };
                    }
                    dir = dir[seg].files;
                }
                const fileName = parts[parts.length - 1];
                const patchBuf = Buffer.isBuffer(patch) ? patch : Buffer.from(patch, 'utf8');
                const newEntry = { size: patchBuf.length, offset: '0' };
                dir[fileName] = newEntry;
                existingPaths.add(patchPath);
                packedFiles.push({
                    path: patchPath,
                    entry: newEntry,
                    oldOffset: 0,
                    oldSize: 0,
                    patchBuffer: patchBuf
                });
            }

            let currentOffset = BigInt(0);
            for (const item of packedFiles) {
                item.entry.offset = currentOffset.toString();
                currentOffset += BigInt(item.entry.size);
            }

            const newHeaderBuf = this.createHeaderBuffer(JSON.stringify(header));
            destFd = fs.openSync(targetAsar, 'w');
            fs.writeSync(destFd, newHeaderBuf, 0, newHeaderBuf.length, 0);

            let writePos = newHeaderBuf.length;
            const copyBufSize = 256 * 1024;
            const copyBuf = Buffer.alloc(copyBufSize);

            for (const item of packedFiles) {
                if (item.patchBuffer) {
                    fs.writeSync(destFd, item.patchBuffer, 0, item.patchBuffer.length, writePos);
                    writePos += item.patchBuffer.length;
                } else {
                    let remaining = item.oldSize;
                    let readPos = baseOffset + item.oldOffset;
                    while (remaining > 0) {
                        const toRead = Math.min(remaining, copyBufSize);
                        fs.readSync(srcFd, copyBuf, 0, toRead, readPos);
                        fs.writeSync(destFd, copyBuf, 0, toRead, writePos);
                        readPos += toRead;
                        writePos += toRead;
                        remaining -= toRead;
                    }
                }
            }
        } finally {
            if (srcFd) fs.closeSync(srcFd);
            if (destFd) fs.closeSync(destFd);
        }
    }
}

function installLocalization(resourcesDir) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");

    if (!fs.existsSync(asarPath) && !fs.existsSync(bakPath)) {
        console.error(`[错误] 未在资源目录中找到 app.asar: ${resourcesDir}`);
        return false;
    }

    if (!fs.existsSync(bakPath)) {
        console.log(`[备份] 正在创建官方原始包备份: app.asar.bak ...`);
        try {
            fs.copyFileSync(asarPath, bakPath);
            console.log(`[备份] 备份成功！`);
        } catch (e) {
            if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS') {
                reportWritePermissionError(resourcesDir, e, '备份到');
            } else {
                console.error(`[错误] 创建 app.asar.bak 备份失败: ${e.message}`);
            }
            return false;
        }
    }

    const sourceAsar = fs.existsSync(bakPath) ? bakPath : asarPath;
    console.log(`[读取] 正在解析应用包元数据...`);

    const filePatches = {};

    // 1. dist/preload.js
    const preloadBuf = AsarArchive.readFile(sourceAsar, "dist/preload.js");
    if (!preloadBuf) {
        console.error(`[错误] 未能在应用包中找到 dist/preload.js`);
        return false;
    }

    console.log(`[修改] 正在向 preload.js 注入汉化代码...`);
    const content = preloadBuf.toString('utf-8');
    const cleanedContent = cleanJsContent(content).replace(
        "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', items),",
        "showContextMenu: (items) => electron_1.ipcRenderer.invoke('window:show-context-menu', typeof globalThis.__agTranslateContextMenuItems === 'function' ? globalThis.__agTranslateContextMenuItems(items) : items),"
    );
    const translationJs = generateJs();
    const subframeLocalizationJs = `"use strict";
(() => {
    try {
        const g = globalThis;
        const protocol = g.location && typeof g.location.protocol === 'string' ? g.location.protocol : '';
        if (protocol !== 'plugin:') return;
        let isTopFrame = false;
        try {
            isTopFrame = Boolean(g.top && g.self && g.top === g.self);
        } catch (e) {
            isTopFrame = false;
        }
        if (isTopFrame) return;
        if (g.__agSubframeLocalizationInstalled) return;
        g.__agSubframeLocalizationInstalled = true;
    } catch (e) {
        return;
    }
${translationJs}
})();
`;

    try {
        new vm.Script(translationJs);
        new vm.Script(subframeLocalizationJs);
    } catch (syntaxErr) {
        console.error(`[致命错误] 生成的汉化注入脚本存在语法错误，已中止注入以避免客户端崩溃: ${syntaxErr.message}`);
        console.error(syntaxErr.stack);
        return false;
    }

    filePatches["dist/preload.js"] = cleanedContent + "\n" + translationJs;
    console.log(`[修改] preload.js 注入成功！`);

    // 2. dist/menu.js
    const menuBuf = AsarArchive.readFile(sourceAsar, "dist/menu.js");
    if (menuBuf) {
        console.log(`[修改] 正在向 menu.js 注入菜单汉化代码...`);
        let menuContent = menuBuf.toString('utf-8');
        const menuCleaned = cleanMenuJsContent(menuContent);
        const menuTranslationJs = `
    ${MENU_SIGNATURE_START}
    const translations = {
        'File': '文件',
        'Edit': '编辑',
        'Workspace': '工作区',
        'View': '视图',
        'Window': '窗口',
        'Help': '帮助',
        'New Window': '新建窗口',
        'Create Project': '创建项目',
        'Command Palette': '命令面板',
        'Docs': '文档',
        'Check for Updates': '检查更新',
        'Toggle Developer Tools': '切换开发者工具',
        'Undo': '撤销',
        'Redo': '重做',
        'Cut': '剪切',
        'Copy': '复制',
        'Paste': '粘贴',
        'Select All': '全选',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '关闭',
        'Zoom': '缩放',
        'Actual Size': '实际大小',
        'Reset Zoom': '重置缩放',
        'Zoom In': '放大',
        'Zoom Out': '缩小',
        'Toggle Full Screen': '切换全屏',
        'Version': '版本',
        'About Antigravity': '关于 Antigravity',
        'Services': '服务',
        'Hide Antigravity': '隐藏 Antigravity',
        'Hide Others': '隐藏其他',
        'Show All': '显示全部',
        'Quit Antigravity': '退出 Antigravity',
        'Quit': '退出',
        'Connect to WSL': '连接至 WSL',
        'Reopen Locally': '在本地重新打开'
    };
    function translateMenu(items) {
        for (const item of items) {
            let label = item.label || '';
            let mnemonic = '';
            let cleanLabel = label;
            const m = label.match(/&([a-zA-Z])/);
            if (m) {
                mnemonic = "(&" + m[1] + ")";
                cleanLabel = label.replace('&', '');
            }
            if (translations[cleanLabel]) {
                item.label = translations[cleanLabel] + mnemonic;
            } else if (translations[label]) {
                item.label = translations[label];
            } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
                item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? "版本 " + v : "版本");
            }
            if (item.submenu && item.submenu.items) {
                translateMenu(item.submenu.items);
            }
        }
    }
    translateMenu(menu.items);
    ${MENU_SIGNATURE_END}
    `;

        const targetStr = "electron_1.Menu.setApplicationMenu(menu);";
        const idx = menuCleaned.indexOf(targetStr);
        if (idx !== -1) {
            let patchedMenuContent = menuCleaned.substring(0, idx) + menuTranslationJs + "\n    " + menuCleaned.substring(idx);
            patchedMenuContent = patchedMenuContent
                .replace("return { label: 'Connect to WSL', submenu };", "return { label: '连接至 WSL', submenu };")
                .replace("return { label: 'Reopen Locally', click: () => relaunchWithWslDistro('') };", "return { label: '在本地重新打开', click: () => relaunchWithWslDistro('') };");
            filePatches["dist/menu.js"] = patchedMenuContent;
            console.log(`[修改] 菜单汉化注入成功！`);
        } else {
            console.warn(`[警告] 未能在 menu.js 中找到设定的插入点。`);
        }
    }

    // 3. dist/tray.js
    const trayBuf = AsarArchive.readFile(sourceAsar, "dist/tray.js");
    if (trayBuf) {
        console.log(`[修改] 正在向 tray.js 注入任务栏菜单汉化...`);
        let trayContent = trayBuf.toString('utf-8');
        let trayCleaned = cleanTrayJsContent(trayContent);

        let trayPatched = trayCleaned;
        const createTrayMatch = trayCleaned.match(/function\s+createTray\s*\(\s*actions(?:\s*,\s*onClick)?\s*\)\s*\{/);
        if (createTrayMatch) {
            const matchedFuncHeader = createTrayMatch[0];
            const replacementCreate = `${matchedFuncHeader}
    ${TRAY_SIGNATURE_START}
    const translations = {
        'No agents running': '无运行中的智能体',
        'Open Antigravity': '打开 Antigravity',
        'Quit': '退出',
        'Connect to WSL': '连接至 WSL',
        'Reopen Locally': '在本地重新打开'
    };
    for (const item of actions) {
        if (translations[item.label]) {
            item.label = translations[item.label];
        }
    }
    ${TRAY_SIGNATURE_END}`;
            trayPatched = trayCleaned.replace(matchedFuncHeader, replacementCreate);
        } else {
            console.warn(`[警告] 未能在 tray.js 中找到 createTray 函数的插入点。`);
        }

        const targetInsert = "function insertTrayMenuItem(position, options) {";
        const replacementInsert = `function insertTrayMenuItem(position, options) {
    ${TRAY_SIGNATURE_START}
    const asyncTranslations = {
        'Connect to WSL': '连接至 WSL',
        'Reopen Locally': '在本地重新打开'
    };
    if (options && asyncTranslations[options.label]) {
        options.label = asyncTranslations[options.label];
    }
    ${TRAY_SIGNATURE_END}`;

        trayPatched = trayPatched.replace(targetInsert, replacementInsert);

        const countRegex = /countItem\.label\s*=\s*\([\s\S]*?' running';/g;
        const replacementCount = "countItem.label = count > 0 ? `${count} 个智能体运行中` : '无运行中的智能体';";
        trayPatched = trayPatched.replace(countRegex, replacementCount);

        filePatches["dist/tray.js"] = trayPatched;
        console.log(`[修改] 任务栏菜单汉化注入成功！`);
    }

    // 4. dist/updater.js
    const updaterBuf = AsarArchive.readFile(sourceAsar, "dist/updater.js");
    if (updaterBuf) {
        console.log(`[修改] 正在向 updater.js 注入更新弹窗汉化...`);
        let updaterContent = updaterBuf.toString('utf-8');
        const targetOptions = `                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],`;
        const replacementOptions = `                title: '检查更新',
                message: '暂无可用更新',
                buttons: ['确定'],`;

        updaterContent = updaterContent.replace(targetOptions, replacementOptions);
        filePatches["dist/updater.js"] = updaterContent;
        console.log(`[修改] 更新弹窗汉化注入成功！`);
    }

    // 5. dist/provisionSplash.js
    const splashBuf = AsarArchive.readFile(sourceAsar, "dist/provisionSplash.js");
    if (splashBuf) {
        console.log(`[修改] 正在向 provisionSplash.js 注入 WSL 引导遮罩汉化...`);
        let splashContent = splashBuf.toString('utf-8');
        splashContent = splashContent.replace('<div>Setting up WSL: ${escapeHtml(distro)}</div>', '<div>正在设置 WSL：${escapeHtml(distro)}</div>');
        filePatches["dist/provisionSplash.js"] = splashContent;
        console.log(`[修改] WSL 引导遮罩汉化注入成功！`);
    }

    // 6. dist/wsl.js
    const wslBuf = AsarArchive.readFile(sourceAsar, "dist/wsl.js");
    if (wslBuf) {
        console.log(`[修改] 正在向 wsl.js 注入 WSL 服务端安装提示汉化...`);
        let wslContent = wslBuf.toString('utf-8');
        wslContent = wslContent
            .replace("onStatus?.('Downloading the Antigravity binary\\u2026');", "onStatus?.('正在下载 Antigravity 二进制文件\\u2026');")
            .replace("onStatus?.(`Installing into ${distro}\\u2026`);", "onStatus?.(`正在安装至 ${distro}\\u2026`);");
        filePatches["dist/wsl.js"] = wslContent;
        console.log(`[修改] WSL 服务端安装提示汉化注入成功！`);
    }

    // 7. dist/main.js
    const mainBuf = AsarArchive.readFile(sourceAsar, "dist/main.js");
    if (mainBuf) {
        console.log(`[修改] 正在向 main.js 注入主进程退出确认与系统弹窗汉化...`);
        const mainContent = cleanMainJsContent(mainBuf.toString('utf-8'))
            .replace("await electron_1.dialog.showErrorBox('Binary not found', msg);", "await electron_1.dialog.showErrorBox('未找到可执行文件', msg);")
            .replace("title: 'WSL distro not found',", "title: '未找到 WSL 分发版',")
            .replace("`The WSL distro \"${WSL_DISTRO}\" is no longer installed.`", "`WSL 分发版 \"${WSL_DISTRO}\" 已不再安装.`")
            .replace("detail: 'Antigravity opened on Windows instead.',", "detail: 'Antigravity 已改为在 Windows 本地打开.',")
            .replace("await electron_1.dialog.showErrorBox('WSL setup failed', msg);", "await electron_1.dialog.showErrorBox('WSL 设置失败', msg);")
            .replace("`Failed to install the server into WSL distro \"${WSL_DISTRO}\":\\n${err.message}`", "`未能将服务端安装至 WSL 分发版 \"${WSL_DISTRO}\"：\\n${err.message}`")
            .replace("await electron_1.dialog.showErrorBox('Startup failed', msg);", "await electron_1.dialog.showErrorBox('启动失败', msg);")
            .replace(
                /(buttons:\s*)\['Cancel',\s*'Quit'\](,\s*defaultId:\s*1,\s*cancelId:\s*0,\s*title:\s*)'Confirm Quit'(,\s*message:\s*)'Are you sure you want to quit\?'(,\s*detail:\s*)'There may be agents or background tasks running\.'/g,
                "$1['取消', '退出']$2'确认退出'$3'确定要退出吗？'$4'当前可能仍有智能体或后台任务正在运行.'"
            );
        filePatches["dist/main.js"] = mainContent;
        console.log(`[修改] 主进程退出确认与系统弹窗注入成功！`);
    }

    // 8. dist/utils.js
    const utilsBuf = AsarArchive.readFile(sourceAsar, "dist/utils.js");
    if (utilsBuf) {
        console.log(`[修改] 正在向 utils.js 注入 plugin:// 子框架动态汉化钩子...`);
        let utilsContent = cleanUtilsJsContent(utilsBuf.toString('utf-8'));
        const onAnchor = "hubContents.on?.('page-title-updated', handleTitleUpdate);";
        const offAnchor = "hubContents.off?.('page-title-updated', handleTitleUpdate);";
        if (utilsContent.includes(onAnchor) && utilsContent.includes(offAnchor)) {
            const onHookJs = `${UTILS_SUBFRAME_SIGNATURE_START}
    let cachedSubframeLocalizationScript = null;
    const findSubframeById = (frame, processId, routingId) => {
        if (!frame) {
            return null;
        }
        if (frame.processId === processId && frame.routingId === routingId) {
            return frame;
        }
        const children = Array.isArray(frame.framesInSubtree)
            ? frame.framesInSubtree
            : (Array.isArray(frame.frames) ? frame.frames : []);
        for (const child of children) {
            if (!child || child === frame) {
                continue;
            }
            if (child.processId === processId && child.routingId === routingId) {
                return child;
            }
            const nested = Array.isArray(frame.framesInSubtree) ? null : findSubframeById(child, processId, routingId);
            if (nested) {
                return nested;
            }
        }
        return null;
    };
    const localizePluginSubframe = (_event, isMainFrame, frameProcessId, frameRoutingId) => {
        try {
            if (isMainFrame || win.isDestroyed?.() || hubContents.isDestroyed?.()) {
                return;
            }
            const frame = _event?.frame
                || electron_1.webFrameMain?.fromId?.(frameProcessId, frameRoutingId)
                || findSubframeById(hubContents.mainFrame, frameProcessId, frameRoutingId);
            if (!frame || frame === hubContents.mainFrame || frame.isDestroyed?.() || frame.detached) {
                return;
            }
            const frameUrl = typeof frame.url === 'string' ? frame.url : '';
            if (!frameUrl.startsWith('plugin://')) {
                return;
            }
            if (cachedSubframeLocalizationScript === null) {
                const scriptPath = path_1.default.join(__dirname, 'subframeLocalizationPreload.js');
                if (!fs.existsSync(scriptPath)) {
                    return;
                }
                cachedSubframeLocalizationScript = fs.readFileSync(scriptPath, 'utf-8');
            }
            if (cachedSubframeLocalizationScript) {
                void Promise.resolve(frame.executeJavaScript(cachedSubframeLocalizationScript, false)).catch(() => undefined);
            }
        }
        catch (_err) {}
    };
    hubContents.on?.('did-frame-finish-load', localizePluginSubframe);${UTILS_SUBFRAME_SIGNATURE_END}`;
            const offHookJs = `${UTILS_SUBFRAME_SIGNATURE_START}
        hubContents.off?.('did-frame-finish-load', localizePluginSubframe);
        cachedSubframeLocalizationScript = null;${UTILS_SUBFRAME_SIGNATURE_END}`;
            utilsContent = utilsContent
                .replace(onAnchor, onAnchor + onHookJs)
                .replace(offAnchor, offAnchor + offHookJs);
            filePatches["dist/utils.js"] = utilsContent;
            filePatches["dist/subframeLocalizationPreload.js"] = subframeLocalizationJs;
            console.log(`[修改] plugin:// 子框架动态汉化钩子注入成功！`);
        } else {
            console.warn(`[警告] 未能在 utils.js 中找到 did-frame-finish-load 注入点。`);
        }
    }

    // 9. dist/ipcHandlers.js
    const ipcHandlersBuf = AsarArchive.readFile(sourceAsar, "dist/ipcHandlers.js");
    if (ipcHandlersBuf) {
        console.log(`[修改] 正在向 ipcHandlers.js 注入原生右键菜单汉化...`);
        let ipcContent = ipcHandlersBuf.toString('utf-8');
        let ipcCleaned = cleanIpcHandlersJsContent(ipcContent);
        const contextMenuMatch = ipcCleaned.match(/function\s+buildContextMenuTemplate\s*\(\s*items\s*,\s*onSelect\s*\)\s*\{/);
        if (contextMenuMatch) {
            const matchedHeader = contextMenuMatch[0];
            const replacementHeader = `${matchedHeader}
    ${IPC_CONTEXT_MENU_SIGNATURE_START}
    const contextMenuTranslations = {
        "Rename": "重命名",
        "Mark Unread": "标记为未读",
        "Mark Read": "标记为已读",
        "Cut": "剪切",
        "Copy": "复制",
        "Paste": "粘贴",
        "Select All": "全选",
        "Split": "拆分",
        "Archive": "归档",
        "Delete": "删除",
        "Stop": "停止",
        "Pin": "置顶",
        "Unpin": "取消置顶",
        "Conversation Name": "会话名称",
        "Conversation ID": "会话 ID",
        "Project Name": "项目名称",
        "Workspace Name": "工作区名称",
        "Worktree Name": "工作树名称",
        "Copy Project Name": "复制项目名称",
        "Project Settings": "项目设置",
        "Show in File Explorer": "在文件资源管理器中显示",
        "Show in Finder": "在 Finder 中显示",
        "Show in File Manager": "在文件管理器中显示",
        "Reveal in File Explorer": "在文件资源管理器中显示",
        "Reveal in Finder": "在 Finder 中显示",
        "Delete Project": "删除项目",
        "Split Right": "向右拆分",
        "Split Down": "向下拆分",
        "Replace with New": "替换为新会话",
        "Replace With New": "替换为新会话",
        "Remove from Split": "从拆分中移除",
        "Remove From Split": "从拆分中移除",
        "Copy File Path": "复制文件路径",
        "Copy File Name": "复制文件名称",
        "Comment": "评论",
        "Quote": "引用",
        "Add to Chat": "添加到聊天",
        "Add to Chat/Quote": "添加到聊天/引用",
        "Copy Image": "复制图片",
        "Save Image": "保存图片",
        "Copy Video": "复制视频",
        "Save Video": "保存视频",
        "Close Tab": "关闭标签页",
        "Close Other Tabs": "关闭其他标签页",
        "Close Tabs to the Right": "关闭右侧标签页",
        "Back": "后退",
        "Forward": "前进",
        "Reload": "重新加载",
        "Open in External Browser": "在外部浏览器中打开",
        "Open in Built-in Browser": "在内置浏览器中打开",
        "Open in Browser": "在浏览器中打开",
        "Open in": "打开方式",
        "Open In": "打开方式",
        "Built-in Browser (Default)": "内置浏览器 (默认)",
        "External Browser": "外部浏览器",
        "Settings": "设置",
        "Copy Message": "复制消息",
        "Undo to Here": "撤销至此处",
        "Copy Link": "复制链接",
        "Reopen Closed Tab": "重新打开关闭的标签页",
        "Move Conversation Up": "向上移动会话",
        "Move Conversation Down": "向下移动会话",
        "Background Commands": "后台命令",
        "Background Tasks": "后台任务"
    };
    function translateIpcContextMenuItems(menuItems) {
        if (!Array.isArray(menuItems)) return menuItems;
        return menuItems.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const itemId = String(item.id || '');
            if (/^group-(?!new$|remove$)/i.test(itemId)) return item;
            const rawLabel = typeof item.label === 'string' ? item.label.trim() : '';
            const translatedLabel = rawLabel && contextMenuTranslations[rawLabel] ? contextMenuTranslations[rawLabel] : item.label;
            let next = translatedLabel !== item.label ? Object.assign({}, item, { label: translatedLabel }) : item;
            if (Array.isArray(next.submenu)) {
                next = Object.assign({}, next, { submenu: translateIpcContextMenuItems(next.submenu) });
            }
            if (Array.isArray(next.items)) {
                next = Object.assign({}, next, { items: translateIpcContextMenuItems(next.items) });
            }
            return next;
        });
    }
    if (Array.isArray(items)) {
        items = translateIpcContextMenuItems(items);
    }
    ${IPC_CONTEXT_MENU_SIGNATURE_END}`;
            ipcCleaned = ipcCleaned.replace(matchedHeader, () => replacementHeader);
            console.log(`[修改] 原生右键菜单汉化注入成功！`);
        } else {
            console.warn(`[警告] 未能在 ipcHandlers.js 中找到 buildContextMenuTemplate 函数的插入点。`);
        }

        ipcCleaned = ipcCleaned
            .replace("electron_1.dialog.showErrorBox('Cannot open folder', t.error);", "electron_1.dialog.showErrorBox('无法打开文件夹', t.error);")
            .replace("message: 'Folder is on the Windows filesystem',", "message: '文件夹位于 Windows 文件系统中',")
            .replace("title: 'Open workspace',", "title: '打开工作区',");

        const regIpcMatch = ipcCleaned.match(/function\s+registerIpcHandlers\s*\([^)]*\)\s*\{/);
        if (regIpcMatch) {
            const regHeader = regIpcMatch[0];
            const regPos = ipcCleaned.indexOf(regHeader);
            const officeIpcBlock = [
                IPC_OFFICE_PREVIEW_SIGNATURE_START,
                "    try {",
                "        (" + __agRegisterOfficeIpcHandlers.toString() + ")(electron_1, url_1, wsl_1);",
                "    } catch (e) {",
                "        console.error('[AG-UX Office IPC] Register failed:', e);",
                "    }",
                "    " + IPC_OFFICE_PREVIEW_SIGNATURE_END
            ].join("\n");
            const memeIpcBlock = [
                IPC_MEME_SIGNATURE_START,
                "    try {",
                "        (" + __agRegisterMemeIpcHandlers.toString() + ")(electron_1);",
                "    } catch (e) {",
                "        console.error('[AG-UX Meme IPC] Register failed:', e);",
                "    }",
                "    " + IPC_MEME_SIGNATURE_END
            ].join("\n");
            ipcCleaned = ipcCleaned.substring(0, regPos + regHeader.length) + officeIpcBlock + memeIpcBlock + ipcCleaned.substring(regPos + regHeader.length);
            console.log(`[修改] Office 文档速览、默认应用打开与 Gemini 猫娘表情包 IPC 注入成功！`);
        } else {
            console.warn(`[警告] 未能在 ipcHandlers.js 中找到 registerIpcHandlers 函数的插入点。`);
        }

        try {
            new vm.Script(ipcCleaned);
        } catch (ipcSyntaxErr) {
            console.error(`[致命错误] 生成的 ipcHandlers.js 注入代码存在语法错误，已中止注入: ${ipcSyntaxErr.message}`);
            return false;
        }
        filePatches["dist/ipcHandlers.js"] = ipcCleaned;
    }

    // 10. 打包并写入 app.asar
    const tempAsarPath = path.join(resourcesDir, "app.asar.tmp");
    try {
        console.log(`[打包] 正在将修改后的内容打包回 app.asar...`);
        AsarArchive.patchArchive(sourceAsar, tempAsarPath, filePatches);

        try {
            if (fs.existsSync(asarPath)) {
                fs.unlinkSync(asarPath);
            }
            fs.renameSync(tempAsarPath, asarPath);
        } catch (renameErr) {
            try {
                fs.copyFileSync(tempAsarPath, asarPath);
                fs.unlinkSync(tempAsarPath);
            } catch (copyErr) {
                if (copyErr.code === 'EBUSY' || copyErr.code === 'EPERM' || renameErr.code === 'EBUSY' || renameErr.code === 'EPERM') {
                    console.error(`[错误] 写入 app.asar 失败：文件被锁定占用。请确保已完全退出 Antigravity 客户端后重试。`);
                } else {
                    console.error(`[错误] 替换 app.asar 失败: ${copyErr.message}`);
                }
                return false;
            }
        }
    } catch (err) {
        try { if (fs.existsSync(tempAsarPath)) fs.unlinkSync(tempAsarPath); } catch (e) {}
        console.error(`[错误] 汉化打包失败: ${err.message}`);
        return false;
    }

    // 清理可能遗留的历史临时解压目录
    const legacyTempDir = path.join(__dirname, "_temp_asar");
    if (fs.existsSync(legacyTempDir)) {
        try { fs.rmSync(legacyTempDir, { recursive: true, force: true }); } catch (e) {}
    }

    console.log(`[√] Antigravity 汉化部署完成！`);
    if (process.platform === 'darwin') {
        if (!resignAppOnMac(resourcesDir)) {
            return false;
        }
    }
    return true;
}

function restoreLocalization(resourcesDir) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");

    if (!fs.existsSync(bakPath)) {
        console.log("[!] 未找到备份文件 app.asar.bak，可能尚未安装过汉化或备份被删除。");
        return false;
    }

    console.log("[还原] 正在用官方备份文件恢复...");
    try {
        fs.copyFileSync(bakPath, asarPath);
        fs.unlinkSync(bakPath);
    } catch (e) {
        if (e.code === 'EACCES' || e.code === 'EPERM' || e.code === 'EROFS') {
            reportWritePermissionError(resourcesDir, e, '还原', 'uninstall.sh');
        } else {
            console.error(`[错误] 还原 app.asar 失败: ${e.message}`);
        }
        return false;
    }
    console.log("[√] 官方 app.asar 已成功恢复！");
    if (process.platform === 'darwin') {
        if (!resignAppOnMac(resourcesDir)) {
            return false;
        }
    }
    return true;
}

function main() {
    if (process.platform !== 'win32') {
        const shellScripts = [
            'install.sh',
            'uninstall.sh',
            '双击安装中文汉化.command',
            '双击卸载还原官方英文.command'
        ];
        for (const script of shellScripts) {
            const scriptPath = path.join(__dirname, script);
            if (fs.existsSync(scriptPath)) {
                try {
                    fs.chmodSync(scriptPath, 0o755);
                } catch (e) {}
            }
        }
    }

    let huifu = false;
    let manualDir = "";
    let noKill = false;
    let checkWriteOnly = false;

    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--huifu') {
            huifu = true;
        } else if (args[i] === '--install-dir') {
            manualDir = args[i + 1] || "";
            i++;
        } else if (args[i] === '--no-kill') {
            noKill = true;
        } else if (args[i] === '--brand-title') {
            i++;
        } else if (args[i] === '--check-write') {
            checkWriteOnly = true;
        }
    }

    if (checkWriteOnly) {
        const installDir = detectInstallationDir(manualDir, { quiet: true });
        if (!installDir) {
            process.exit(3);
        }
        let resourcesDir = "";
        if (fs.existsSync(path.join(installDir, "resources"))) {
            resourcesDir = path.join(installDir, "resources");
        } else if (fs.existsSync(path.join(installDir, "Contents", "Resources"))) {
            resourcesDir = path.join(installDir, "Contents", "Resources");
        } else if (installDir.replace(/\/$/, "").toLowerCase().endsWith("/resources")) {
            resourcesDir = installDir;
        } else if (fs.existsSync(path.join(installDir, "app.asar"))) {
            resourcesDir = installDir;
        } else {
            resourcesDir = path.join(installDir, "resources");
        }

        if (!fs.existsSync(resourcesDir)) {
            process.exit(3);
        }

        const asarPath = path.join(resourcesDir, "app.asar");
        const bakPath = path.join(resourcesDir, "app.asar.bak");
        if (!fs.existsSync(asarPath) && !fs.existsSync(bakPath)) {
            process.exit(3);
        }

        try {
            fs.accessSync(resourcesDir, fs.constants.W_OK | fs.constants.X_OK);
            if (fs.existsSync(asarPath)) {
                fs.accessSync(asarPath, fs.constants.R_OK | fs.constants.W_OK);
            }
            if (fs.existsSync(bakPath)) {
                fs.accessSync(bakPath, fs.constants.R_OK | fs.constants.W_OK);
            }
            if (process.platform === 'darwin') {
                const targetApp = findMacAppBundle(resourcesDir);
                if (targetApp) {
                    fs.accessSync(targetApp, fs.constants.W_OK | fs.constants.X_OK);
                }
            }
            process.exit(0);
        } catch (e) {
            process.exit(2);
        }
    }

    const installDir = detectInstallationDir(manualDir);

    let resourcesDir = "";
    if (fs.existsSync(path.join(installDir, "resources"))) {
        resourcesDir = path.join(installDir, "resources");
    } else if (fs.existsSync(path.join(installDir, "Contents", "Resources"))) {
        resourcesDir = path.join(installDir, "Contents", "Resources");
    } else if (installDir.replace(/\/$/, "").toLowerCase().endsWith("/resources")) {
        resourcesDir = installDir;
    } else if (fs.existsSync(path.join(installDir, "app.asar"))) {
        resourcesDir = installDir;
    } else {
        resourcesDir = path.join(installDir, "resources");
    }

    if (!fs.existsSync(resourcesDir)) {
        console.error(`[错误] 无法定位有效的资源(resources)目录: ${resourcesDir}`);
        process.exit(1);
    }

    if (!canWriteAntigravityResources(resourcesDir, huifu ? 'uninstall.sh' : 'install.sh')) {
        process.exit(1);
    }

    wasAppRunning = checkIfAppIsRunning();
    if (noKill) {
        console.log("[跳过] 检测到 --no-kill 参数，跳过关闭 Antigravity 运行进程。");
    } else if (wasAppRunning) {
        if (!closeAntigravityProcesses()) {
            process.exit(1);
        }
    } else {
        console.log("[跳过] Antigravity 客户端当前未运行，无需关闭进程。");
    }

    let success = false;
    if (huifu) {
        console.log("====== 正在卸载中文汉化，恢复官方原版 ======");
        success = restoreLocalization(resourcesDir);
    } else {
        console.log("====== 正在安装 Antigravity 中文汉化 ======");
        success = installLocalization(resourcesDir);
    }

    if (!success) {
        process.exit(1);
    }

    if (success && wasAppRunning && !noKill) {
        console.log("\n[启动] 检测到安装前 Antigravity 客户端处于开启状态，正在重新启动客户端...");
        try {
            let launched = false;
            let restartDeferred = false;
            if (process.platform === 'win32') {
                const exePath = path.join(installDir, 'Antigravity.exe');
                if (fs.existsSync(exePath)) {
                    const child = child_process.spawn(exePath, [], { detached: true, stdio: 'ignore' });
                    child.unref();
                    console.log("[启动] 客户端启动成功！");
                    launched = true;
                }
            } else {
                const runningUnderSudo = typeof process.getuid === 'function'
                    && process.getuid() === 0
                    && process.env.SUDO_USER
                    && process.env.SUDO_USER !== 'root';
                if (runningUnderSudo) {
                    console.log("[提示] 当前通过 sudo 安装；为避免以 root 身份启动桌面应用，请手动启动 Antigravity。");
                    restartDeferred = true;
                } else if (process.platform === 'darwin') {
                    const targetApp = findMacAppBundle(resourcesDir) || (installDir.endsWith('.app') ? installDir : null);
                    if (targetApp && fs.existsSync(targetApp)) {
                        child_process.spawn('open', [targetApp], { detached: true, stdio: 'ignore' }).unref();
                        console.log("[启动] 客户端启动成功！");
                        launched = true;
                    } else {
                        try {
                            child_process.spawn('open', ['-a', 'Antigravity'], { detached: true, stdio: 'ignore' }).unref();
                            console.log("[启动] 客户端启动成功！");
                            launched = true;
                        } catch (e) {}
                    }
                } else {
                    const exeCandidates = [
                        path.join(installDir, 'antigravity'),
                        path.join(installDir, 'Antigravity'),
                        path.join(installDir, 'bin', 'antigravity'),
                    ];
                    for (const exePath of exeCandidates) {
                        if (fs.existsSync(exePath)) {
                            const child = child_process.spawn(exePath, [], { detached: true, stdio: 'ignore' });
                            child.unref();
                            console.log("[启动] 客户端启动成功！");
                            launched = true;
                            break;
                        }
                    }
                    if (!launched) {
                        try {
                            const whichOut = child_process.execSync('command -v antigravity 2>/dev/null || which antigravity 2>/dev/null || command -v Antigravity 2>/dev/null || which Antigravity 2>/dev/null || command -v agy 2>/dev/null || which agy 2>/dev/null', { encoding: 'utf-8' }).trim();
                            if (whichOut) {
                                const child = child_process.spawn(whichOut, [], { detached: true, stdio: 'ignore' });
                                child.unref();
                                console.log("[启动] 客户端启动成功！");
                                launched = true;
                            }
                        } catch (e) {}
                    }
                }
            }
            if (!launched && !restartDeferred) {
                console.warn("[警告] 未找到客户端可执行文件，请手动启动 Antigravity。");
            }
        } catch (e) {
            console.warn(`[警告] 客户端启动失败: ${e.message}`);
        }
    }
}

main();
