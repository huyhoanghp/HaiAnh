// ======================== STATE GLOBALS & FUNCTIONS ========================
const PROGRESS_KEY = 'exam_progress_v2';
const IS_FILE_PROTOCOL = location.protocol === 'file:';
if (IS_FILE_PROTOCOL) {
    const banner = document.getElementById('fileProtocolBanner');
    if (banner) banner.classList.remove('hidden');
}

let masterQuestions = [];
let currentQuestions = [];
let userAnswers = [];
let flagged = [];
let submitted = false;
let scoreDetails = [];
let timerInterval = null, timeRemainingSeconds = 0, examActive = false, isPaused = false;
let currentBankId = null, currentBankName = '';
let statsChart = null;
let searchDebounceTimer = null;
let displayedCount = 0;
const BATCH_SIZE = 20;
let filteredIndices = [];
let scrollObserver = null;
let currentFileData = null, currentMimeType = null;

// ======================== VOICE ENGINE (NEW) ========================
let vietnameseVoice = null;
const VOICE_DICTIONARY = {
    // Chuyên ngành viễn thông/IT (do người dùng yêu cầu)
    "OLT": "O L T",
    "ONT": "O N T",
    "ONU": "O N U",
    "PON": "Pôn",
    "GPON": "G Pôn",
    "IP": "I P",
    "ISP": "nhà cung cấp dịch vụ Internet",
    "VoIP": "Voi P",
    "IPTV": "I P T V",
    "Triple Play": "Ba dịch vụ",
    "Ethernet": "Ét tơ nét",
    "gateway": "Cổng kết nối",
    "Wi-Fi": "Quai phai",
    // Viết tắt phổ biến
    "v.v": "vân vân",
    "v.v.": "vân vân",
    "HĐQT": "Hội đồng quản trị",
    "v/v": "về việc",
    "X4": "X bốn",
    "KNL": "Khung năng lực",
    "NV": "nhân viên",
    "GĐ": "Giám đốc",
    "ALU": "A L U",
    "PGĐ": "Phó Giám đốc",
    "TP": "Trưởng phòng",
    "PP": "Phó phòng",
    "CN": "Chi nhánh",
    "P.": "Phòng",
    "TT": "Trung tâm"
};

let speechInterval = null;

const SpeechManager = {
    chunks: [],
    currentIdx: 0,
    isPaused: false,
    rate: 1.0,
    pauseTimer: null,
    currentUtterance: null,
    activeQIdx: null,

    init() {
        const savedRate = localStorage.getItem('voice_rate');
        if (savedRate) this.rate = parseFloat(savedRate);
    },

    setRate(newRate) {
        this.rate = newRate;
        localStorage.setItem('voice_rate', newRate);
    },

    chunkText(text) {
        let remainingText = text;
        const maxChunkLen = 140;
        const chunks = [];

        while (remainingText.length > 0) {
            if (remainingText.length <= maxChunkLen) {
                chunks.push(remainingText);
                break;
            }
            let splitIdx = -1;
            const punctuation = [". ", "? ", "! ", "; ", ": ", ", ", " - "];
            for (let p of punctuation) {
                const last = remainingText.lastIndexOf(p, maxChunkLen);
                if (last > splitIdx) splitIdx = last + p.length;
            }
            if (splitIdx <= 0) splitIdx = remainingText.lastIndexOf(" ", maxChunkLen);
            if (splitIdx <= 0) splitIdx = maxChunkLen;
            chunks.push(remainingText.substring(0, splitIdx).trim());
            remainingText = remainingText.substring(splitIdx).trim();
        }
        return chunks;
    },

    start(text, id) {
        this.stop();
        const normalizedText = text;
        this.chunks = this.chunkText(normalizedText);
        this.currentIdx = 0;
        this.isPaused = false;
        this.activeQIdx = id;

        setTimeout(() => {
            this.play();
        }, 150);
    },

    play() {
        if (this.currentIdx >= this.chunks.length) {
            this.stop();
            return;
        }

        const chunkText = this.chunks[this.currentIdx];
        if (!chunkText || !/[a-zA-Z0-9à-ỹÀ-Ỹ]/.test(chunkText)) {
            this.currentIdx++;
            this.play();
            return;
        }

        this.currentUtterance = new SpeechSynthesisUtterance(chunkText);
        if (vietnameseVoice) this.currentUtterance.voice = vietnameseVoice;
        this.currentUtterance.lang = 'vi-VN';
        this.currentUtterance.rate = this.rate;

        this.currentUtterance.onend = () => {
            if (!this.isPaused) {
                this.currentIdx++;
                setTimeout(() => this.play(), 50);
            }
        };

        this.currentUtterance.onerror = (e) => {
            console.error("Speech error:", e);
            if (!this.isPaused) {
                this.currentIdx++;
                setTimeout(() => this.play(), 50);
            }
        };

        window.speechSynthesis.speak(this.currentUtterance);
        this.updateUI();

        if (speechInterval) clearInterval(speechInterval);
        speechInterval = setInterval(() => {
            if (window.speechSynthesis.speaking && !this.isPaused) {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 7000);
    },

    pause() {
        this.isPaused = true;
        window.speechSynthesis.cancel();
        if (speechInterval) clearInterval(speechInterval);
        this.updateUI();
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => { if (this.isPaused) this.stop(); }, 15000);
    },

    resume() {
        this.isPaused = false;
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.play();
    },

    stop() {
        window.speechSynthesis.cancel();
        if (speechInterval) clearInterval(speechInterval);
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.chunks = [];
        this.currentIdx = 0;
        this.isPaused = false;
        this.activeQIdx = null;
        this.currentUtterance = null;
        this.updateUI();
    },

    updateUI() {
        const btns = document.querySelectorAll('.speak-toggle-btn');
        btns.forEach(btn => {
            const qIdx = btn.dataset.qidx;
            const icon = btn.querySelector('i');
            if (!icon) return;

            if (this.activeQIdx == qIdx) {
                icon.className = this.isPaused ? 'fas fa-play' : 'fas fa-pause';
            } else {
                icon.className = 'fas fa-volume-up';
            }
        });
    }
};

SpeechManager.init();

function normalizeText(text) {
    if (!text) return "";
    let processed = text;
    processed = processed.replace(/#{1,6}\s?/g, " ");
    processed = processed.replace(/\*\*/g, "");
    processed = processed.replace(/\*/g, "");
    processed = processed.replace(/^-{3,}/gm, " ");
    processed = processed.replace(/^[-*+]\s/gm, ". ");
    processed = processed.replace(/["“”„‟«»‹›'‘’`_~]/g, "");
    processed = processed.replace(/[\(\)\[\]\{\}]/g, " ");
    processed = processed.replace(/^([A-D])\.\s/gim, "Đáp án $1. ");
    processed = processed.replace(/^(\d+)\.\s/gim, "Câu $1. ");
    Object.keys(VOICE_DICTIONARY).forEach(key => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<![a-zA-Z0-9à-ỹÀ-Ỹ])${escapedKey}(?![a-zA-Z0-9à-ỹÀ-Ỹ])`, "gi");
        processed = processed.replace(regex, VOICE_DICTIONARY[key]);
    });
    processed = processed.replace(/,/g, " ");
    processed = processed.replace(/([.?!;])/g, "$1 ");
    processed = processed.replace(/\s+/g, " ");
    return processed.trim();
}

function initVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    vietnameseVoice = voices.find(v => v.name.includes('An') && v.lang.includes('vi')) ||
        voices.find(v => v.name.includes('Linh') && v.lang.includes('vi')) ||
        voices.find(v => v.lang.includes('vi-VN')) ||
        voices.find(v => v.lang.includes('vi'));
}

if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = initVoice;
}
initVoice();

function speak(text, qIdx) {
    if (!text) return;
    const finalId = String(qIdx);
    if (SpeechManager.activeQIdx === finalId) {
        if (SpeechManager.isPaused) SpeechManager.resume();
        else SpeechManager.pause();
    } else {
        const cleanedText = normalizeText(text);
        SpeechManager.start(cleanedText, finalId);
    }
}

const AI_TEXT_CACHE = {};

// ======================== UTILS ========================
function copyToClipboard(text) {
    const tempTextarea = document.createElement("textarea");
    tempTextarea.value = text;
    document.body.appendChild(tempTextarea);
    tempTextarea.select();
    try {
        document.execCommand("copy");
        showToast("✅ Đã sao chép vào bộ nhớ tạm!");
    } catch (err) {
        showToast("❌ Lỗi sao chép!");
    }
    document.body.removeChild(tempTextarea);
}

function saveProgress(progress) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) { console.warn(e); } }
function loadProgress() { const d = localStorage.getItem(PROGRESS_KEY); return d ? JSON.parse(d) : null; }
function clearProgress() { localStorage.removeItem(PROGRESS_KEY); }

function saveProgressToLocal() {
    if (!currentBankId) return;
    saveProgress({
        bankId: currentBankId,
        bankName: currentBankName,
        userAnswers: userAnswers,
        flagged: flagged,
        timeRemainingSeconds: timeRemainingSeconds,
        examActive: examActive,
        isPaused: isPaused,
        submitted: submitted
    });
}

function updateProgress() {
    if (!currentQuestions.length) {
        if (document.getElementById('answeredCount')) document.getElementById('answeredCount').innerText = 0;
        if (document.getElementById('totalQuestionsCount')) document.getElementById('totalQuestionsCount').innerText = 0;
        if (document.getElementById('progressFill')) document.getElementById('progressFill').style.width = '0%';
        return;
    }
    const answered = userAnswers.filter(a => a && a.length > 0).length;
    if (document.getElementById('answeredCount')) document.getElementById('answeredCount').innerText = answered;
    if (document.getElementById('totalQuestionsCount')) document.getElementById('totalQuestionsCount').innerText = currentQuestions.length;
    if (document.getElementById('progressFill')) document.getElementById('progressFill').style.width = `${(answered / currentQuestions.length) * 100}%`;
    const questionGridPanel = document.getElementById('questionGridPanel');
    if (questionGridPanel && !questionGridPanel.classList.contains('hidden')) renderQuestionGrid();
    saveProgressToLocal();
}

function escapeHtml(str) { if (!str) return ''; return String(str).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
function removeAccents(str) { if (!str) return ""; return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D'); }
function getInitialsInfo(text) { const regex = /([\p{L}\p{N}]+)/gu; let match; const tokens = []; let initials = ""; while ((match = regex.exec(text)) !== null) { const initial = removeAccents(match[1][0]).toLowerCase(); tokens.push({ index: match.index, end: match.index + match[1].length, initial: initial }); initials += initial; } return { tokens, initials }; }

function getHighlightedText(text, rawSearch) {
    if (typeof rawSearch !== 'string' || !rawSearch || rawSearch.trim() === '') return escapeHtml(text);
    const rawSearchTrimmed = rawSearch.trim().toLowerCase(); const searchNorm = removeAccents(rawSearchTrimmed); const terms = searchNorm.split(/\s+/).filter(t => t);
    if (terms.length === 1 && terms[0].length >= 2) {
        const acronymTarget = terms[0]; const { tokens, initials } = getInitialsInfo(text); const acrIdx = initials.indexOf(acronymTarget);
        if (acrIdx !== -1) {
            const startToken = tokens[acrIdx]; const endToken = tokens[acrIdx + acronymTarget.length - 1]; const start = startToken.index; const end = endToken.end;
            const before = escapeHtml(text.substring(0, start)); const matchStr = escapeHtml(text.substring(start, end)); const after = escapeHtml(text.substring(end));
            return `${before}<mark class="bg-yellow-300 text-black px-0.5 rounded">${matchStr}</mark>${after}`;
        }
    }
    let resultHtml = escapeHtml(text); const rawOriginalTerms = rawSearchTrimmed.split(/\s+/).filter(t => t);
    if (rawOriginalTerms.length > 0) { const safeTerms = rawOriginalTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); const regex = new RegExp(`(${safeTerms.join('|')})`, 'gi'); resultHtml = resultHtml.replace(regex, '<mark class="bg-yellow-300 text-black px-0.5 rounded">$1</mark>'); }
    return resultHtml;
}

function generateQuestionHTML(idx, rawSearch = "") {
    const q = currentQuestions[idx], userChoice = userAnswers[idx] || [], isSubmitted = submitted, checkRes = isSubmitted ? checkAnswer(idx) : null, isCorrect = isSubmitted ? checkRes.correct : false, correctIndices = isSubmitted ? checkRes.correctAnswers : [];
    const isFlagged = flagged[idx];

    let optionsHtml = '';
    q.options.forEach((opt, optIdx) => {
        const isChecked = userChoice.includes(optIdx), inputType = q.type === 'multiple' ? 'checkbox' : 'radio'; let extraClass = "", badge = false;
        if (isSubmitted && correctIndices.includes(optIdx)) { extraClass = "bg-green-50 border-green-200"; badge = true; } else if (isSubmitted && isChecked && !correctIndices.includes(optIdx)) extraClass = "bg-red-50 border-red-200";
        const voiceOptBtn = `<i class="fas fa-volume-up speak-toggle-btn ml-auto text-gray-400 hover:text-blue-600 cursor-pointer" data-qidx="${idx}-opt-${optIdx}" title="Nghe đáp án"></i>`;
        optionsHtml += `<label class="flex items-start gap-3 p-3 rounded-xl border ${extraClass} hover:bg-gray-50 transition cursor-pointer mb-2"><input type="${inputType}" name="q${idx}" value="${optIdx}" ${isChecked ? "checked" : ""} ${isSubmitted ? "disabled" : ""} class="mt-1 option-input" data-qidx="${idx}" data-optidx="${optIdx}"><span class="text-gray-700 text-sm flex-1">${escapeHtml(opt)}</span>${badge ? '<span class="text-green-600 text-xs font-medium bg-white px-2 py-0.5 rounded-full mr-2">✓ Đúng</span>' : ''}${voiceOptBtn}</label>`;
    });

    const speakerIcon = `<div class="flex items-center gap-2 mb-2">
        <button class="speak-toggle-btn w-9 h-9 flex items-center justify-center bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full hover:bg-blue-100 transition shadow-sm" data-qidx="${idx}-q" title="Nghe câu hỏi">
            <i class="fas fa-volume-up"></i>
        </button>
        <div class="relative speed-container">
            <button class="speed-btn h-8 px-2 flex items-center gap-1 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition text-[10px] font-bold border border-gray-100 dark:border-slate-700 shadow-sm">
                <span class="current-speed">${SpeechManager.rate.toFixed(1)}x</span>
            </button>
            <div class="speed-menu absolute top-full left-0 mt-1 w-16 bg-white dark:bg-slate-800 shadow-xl border border-gray-200 dark:border-slate-700 rounded-lg hidden z-[100] overflow-hidden">
                ${[0.8, 1.0, 1.2, 1.5, 2.0].map(r => `<div class="speed-opt px-2 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer text-[10px] text-center ${SpeechManager.rate === r ? 'text-blue-600 font-bold bg-blue-50 dark:bg-blue-900' : ''}" data-rate="${r}" data-qidx="${idx}-q">${r.toFixed(1)}x</div>`).join('')}
            </div>
        </div>
    </div>`;

    const feedback = isSubmitted ? (isCorrect ? `<div class="mt-3 text-sm text-green-700 bg-green-50 p-2 rounded-lg"><i class="fas fa-check-circle"></i> Chính xác!</div>` : `<div class="mt-3 text-sm bg-amber-50 p-2 rounded-lg text-amber-800"><i class="fas fa-info-circle"></i> Đáp án đúng: ${correctIndices.map(i => q.options[i]).join('; ')}</div>`) : "";
    const aiExplainBtn = `<button class="ai-explain-btn text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg border border-purple-200 transition" data-qidx="${idx}"><i class="fas fa-magic"></i> Giải thích AI</button>`;
    const aiExplainBox = `<div id="ai-explanation-${idx}" class="ai-explanation-box mt-3 rounded-lg hidden shadow-sm" data-loaded="false"></div>`;
    return `<div id="question-${idx}" class="card-question bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6 overflow-visible transition-all">
        <div class="q-toolbar flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-slate-800">
            <div class="flex items-center gap-3">
                <span class="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center font-bold text-sm">
                    ${idx + 1}
                </span>
                <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md uppercase">
                    ${q.type === "multiple" ? "Đa đáp án" : "Đơn đáp án"}
                </span>
            </div>
            <div class="flex items-center gap-3">
                <div class="flex items-center gap-2">
                    <button class="speak-toggle-btn w-8 h-8 flex items-center justify-center bg-gray-50 dark:bg-slate-800 text-blue-600 dark:text-blue-400 rounded-full border border-blue-100 dark:border-blue-900/50" data-qidx="${idx}-q">
                        <i class="fas fa-volume-up text-xs"></i>
                    </button>
                    <div class="relative speed-container">
                        <button class="speed-btn h-7 px-1.5 flex items-center gap-1 bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-md text-[9px] font-bold border border-gray-200">
                            <span class="current-speed">${SpeechManager.rate.toFixed(1)}x</span>
                        </button>
                        <div class="speed-menu absolute top-full left-0 mt-1 w-14 bg-white dark:bg-slate-800 shadow-xl border border-gray-200 rounded-md hidden z-[100] overflow-hidden">
                            ${[0.8, 1.0, 1.2, 1.5, 2.0].map(r => `<div class="speed-opt px-1 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer text-[9px] text-center" data-rate="${r}" data-qidx="${idx}-q">${r.toFixed(1)}x</div>`).join('')}
                        </div>
                    </div>
                </div>
                <button class="flag-btn text-gray-300 hover:text-orange-500 p-1" data-qidx="${idx}">
                    <i class="${isFlagged ? 'fas' : 'far'} fa-bookmark text-lg"></i>
                </button>
            </div>
        </div>
        
        <div class="mb-5">
            <h3 class="text-base md:text-lg font-bold text-gray-900 dark:text-gray-100 leading-relaxed mb-4">${getHighlightedText(q.text, rawSearch)}</h3>
            <div class="space-y-2">${optionsHtml}</div>
        </div>
        <div class="flex items-center gap-3 mt-5 pt-4 border-t border-gray-50 dark:border-slate-800">
            ${aiExplainBtn}
            <button class="hint-btn text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 transition font-medium" data-qidx="${idx}"><i class="fas fa-lightbulb"></i> Gợi ý</button>
        </div>
        ${feedback}${aiExplainBox}
    </div>`;
}

function renderSingleQuestion(idx) {
    const oldDiv = document.getElementById(`question-${idx}`);
    if (oldDiv) {
        const aiBox = oldDiv.querySelector(`#ai-explanation-${idx}`); const isAiVisible = aiBox && !aiBox.classList.contains('hidden'); const aiHtml = aiBox ? aiBox.innerHTML : ''; const isLoaded = aiBox ? aiBox.dataset.loaded : 'false';
        const searchInput = document.getElementById('searchInput'); const rawSearch = searchInput ? searchInput.value.trim().toLowerCase() : ""; const newHtml = generateQuestionHTML(idx, rawSearch); const temp = document.createElement('div'); temp.innerHTML = newHtml;
        if (isLoaded === 'true') { const newAiBox = temp.querySelector(`#ai-explanation-${idx}`); const newAiBtn = temp.querySelector(`.ai-explain-btn`); if (newAiBox) { newAiBox.innerHTML = aiHtml; newAiBox.dataset.loaded = 'true'; if (isAiVisible) { newAiBox.classList.remove('hidden'); newAiBtn.innerHTML = `<i class="fas fa-eye-slash"></i> Ẩn giải thích`; } } }
        oldDiv.parentNode.replaceChild(temp.firstElementChild, oldDiv);
    }
}

function checkAnswer(idx) { const std = currentQuestions[idx].correctIndices, user = userAnswers[idx] || []; return { correct: std.length === user.length && std.every(v => user.includes(v)), correctAnswers: std, userAnswers: user }; }
function setAnswer(qIdx, sel) { if (submitted) { showToast("Đã nộp bài."); return false; } userAnswers[qIdx] = [...sel]; updateProgress(); renderSingleQuestion(qIdx); renderQuestionGrid(); return true; }
function toggleFlag(qIdx) { if (submitted) return; flagged[qIdx] = !flagged[qIdx]; renderSingleQuestion(qIdx); renderQuestionGrid(); showToast(flagged[qIdx] ? "Đã đánh dấu." : "Bỏ đánh dấu."); }
function showHint(qIdx) { const correctText = currentQuestions[qIdx].correctIndices.map(i => `- ${currentQuestions[qIdx].options[i]}`).join('<br>'); showToast(`💡 <b>Đáp án đúng:</b><br>${correctText}`, 10000); }

// ======================== INDEXEDDB ========================
const DB_NAME = 'QuestionBanksDB'; const STORE_BANKS = 'banks'; const STORE_HISTORY = 'history'; let db = null;
async function openDB() {
    if (db) return db;
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onerror = () => rej(req.error);
        req.onsuccess = () => { db = req.result; res(db); };
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_BANKS)) d.createObjectStore(STORE_BANKS, { keyPath: 'id', autoIncrement: true });
            if (!d.objectStoreNames.contains(STORE_HISTORY)) d.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
        };
    });
}
async function getAllBanks() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readonly'); const req = tx.objectStore(STORE_BANKS).getAll(); req.onsuccess = e => res(e.target.result); req.onerror = () => rej(req.error); }); }
async function saveBank(name, questions) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readwrite'); const req = tx.objectStore(STORE_BANKS).add({ name, questions, createdAt: new Date().toISOString() }); req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }
async function deleteBank(id) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readwrite'); const req = tx.objectStore(STORE_BANKS).delete(id); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
async function getBankById(id) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readonly'); const req = tx.objectStore(STORE_BANKS).get(id); req.onsuccess = e => res(e.target.result); req.onerror = () => rej(req.error); }); }
async function saveHistory(bankId, bankName, totalQuestions, correctCount, wrongDetails, wrongQuestionsText) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readwrite'); const req = tx.objectStore(STORE_HISTORY).add({ bankId, bankName, totalQuestions, correctCount, wrongCount: totalQuestions - correctCount, wrongDetails, wrongQuestionsText, date: new Date().toISOString(), timestamp: Date.now() }); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
async function getAllHistory() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readonly'); const req = tx.objectStore(STORE_HISTORY).getAll(); req.onsuccess = e => res(e.target.result); req.onerror = () => rej(req.error); }); }
async function clearAllHistory() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readwrite'); const req = tx.objectStore(STORE_HISTORY).clear(); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }

// ======================== DOM CACHING & UTILS ========================
const loadingOverlay = document.getElementById('loadingOverlay'), loadingText = document.getElementById('loadingText');
const toastMsg = document.getElementById('toastMsg');
function showLoading(show, text = 'Đang xử lý...') { if (show) { if (loadingText) loadingText.innerText = text; if (loadingOverlay) loadingOverlay.style.display = 'flex'; } else if (loadingOverlay) loadingOverlay.style.display = 'none'; }
function showToast(msg, duration = 2500) { if (!toastMsg) return; toastMsg.innerHTML = msg; toastMsg.classList.remove('hidden'); if (window.toastTimeout) clearTimeout(window.toastTimeout); window.toastTimeout = setTimeout(() => toastMsg.classList.add('hidden'), duration); }
const customModal = document.getElementById('customModal'), customModalText = document.getElementById('customModalText'), customModalInput = document.getElementById('customModalInput'), customModalCancel = document.getElementById('customModalCancel'), customModalConfirm = document.getElementById('customModalConfirm');
function showConfirm(msg, callback) { if (!customModalText) return; customModalText.innerText = msg; customModalInput.classList.add('hidden'); customModal.classList.remove('hidden'); customModal.classList.add('flex'); customModalConfirm.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(true); }; customModalCancel.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(false); }; }
function showPrompt(msg, defaultVal, callback) { if (!customModalText) return; customModalText.innerText = msg; customModalInput.value = defaultVal || ''; customModalInput.classList.remove('hidden'); customModal.classList.remove('hidden'); customModal.classList.add('flex'); customModalInput.focus(); customModalConfirm.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(customModalInput.value); }; customModalCancel.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(null); }; }

function initDarkMode() { const isDark = localStorage.getItem('darkMode') === 'true'; if (isDark) document.body.classList.add('dark'); const darkModeText = document.getElementById('darkModeText'); if (darkModeText) darkModeText.innerText = isDark ? 'Sáng' : 'Tối'; const darkModeToggle = document.getElementById('darkModeToggle'); if (darkModeToggle) darkModeToggle.onclick = () => { document.body.classList.toggle('dark'); const dark = document.body.classList.contains('dark'); localStorage.setItem('darkMode', dark); if (darkModeText) darkModeText.innerText = dark ? 'Sáng' : 'Tối'; }; }

// ======================== API SETTINGS ========================
function getApiKey() { return localStorage.getItem('gemini_api_key') || ""; }
function updateApiKeyBadge() { const badge = document.getElementById('apiKeyBadge'); if (!badge) return; if (getApiKey()) { badge.className = 'inline-block w-2 h-2 rounded-full ml-1 bg-green-500'; badge.title = 'API Key đã được lưu'; } else { badge.className = 'inline-block w-2 h-2 rounded-full ml-1 bg-red-500'; badge.title = 'Chưa có API Key'; } }
let cachedWorkingModel = localStorage.getItem('last_working_model') || null;

async function compressImage(base64Str) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = 'data:image/jpeg;base64,' + base64Str;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width, height = img.height;
            const max = 1200;
            if (width > height) { if (width > max) { height *= max / width; width = max; } }
            else { if (height > max) { width *= max / height; height = max; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
        };
    });
}

async function callAiProxy({ provider, model, payload }) {
    const apiKey = getApiKey();
    if (!apiKey || provider !== 'google') return await callLegacyProxy({ provider, model, payload });
    const baseModels = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-preview', 'gemini-3-flash', 'gemini-3-flash-preview', 'gemini-3-flash-live', 'gemini-3-flash-live-preview'];
    if (cachedWorkingModel && !baseModels.includes(cachedWorkingModel)) { cachedWorkingModel = null; localStorage.removeItem('last_working_model'); }
    const modelsToTry = cachedWorkingModel ? [cachedWorkingModel, ...baseModels.filter(m => m !== cachedWorkingModel)] : baseModels;
    let lastError = "Không có phản hồi từ AI";
    for (const currentModel of modelsToTry) {
        const versions = ['v1beta', 'v1'];
        for (const apiVer of versions) {
            let retryWithoutMime = false;
            const attempt = async (useMime = true) => {
                try {
                    const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
                    const currentPayload = JSON.parse(JSON.stringify(payload));
                    if (!currentPayload.generationConfig) currentPayload.generationConfig = {};
                    if (!useMime && currentPayload.generationConfig.responseMimeType) delete currentPayload.generationConfig.responseMimeType;
                    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(currentPayload) });
                    const text = await res.text();
                    if (!res.ok) {
                        let msg = text; try { const json = JSON.parse(text); msg = json.error?.message || json.error?.status || text; } catch (e) { }
                        if (useMime && (msg.includes('responseMimeType') || msg.includes('Unknown name'))) { retryWithoutMime = true; return null; }
                        lastError = `[${currentModel}@${apiVer}] ${msg}`;
                        return 'FALLBACK';
                    }
                    cachedWorkingModel = currentModel; localStorage.setItem('last_working_model', currentModel);
                    return JSON.parse(text);
                } catch (err) { lastError = err.message || String(err); return 'FALLBACK'; }
            };
            let result = await attempt(true);
            if (retryWithoutMime) result = await attempt(false);
            if (result && result !== 'FALLBACK') return result;
        }
    }
    showApiError(null, lastError); throw new Error(lastError);
}

async function checkAvailableModels() {
    const apiKey = getApiKey(); if (!apiKey) { showToast("❌ Hãy nhập và lưu API Key trước!"); return; }
    showLoading(true, "Đang kiểm tra danh sách mô hình...");
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        const data = await res.json(); showLoading(false);
        if (data.models) { const list = data.models.map(m => m.name.replace('models/', '')).join('\n'); alert("✅ Các mô hình khả dụng:\n\n" + list); }
        else { alert("❌ Lỗi: " + JSON.stringify(data)); }
    } catch (e) { showLoading(false); alert("❌ Lỗi: " + e.message); }
}

async function callLegacyProxy({ provider, model, payload }) {
    try {
        const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model, payload }) });
        const text = await res.text(); if (!res.ok) throw new Error('Proxy error'); return JSON.parse(text);
    } catch (err) { showApiError(null, err.message); throw err; }
}

function showApiError(status, message) {
    const container = document.getElementById('toastMsg'); if (!container) return;
    const statusText = status ? `Mã: ${status}` : 'Lỗi kết nối';
    const html = `<div style="max-width:900px;padding:12px;color:#fff;background:#b91c1c;border-radius:8px;"><strong>Lỗi API:</strong> ${escapeHtml(message)} <span style="opacity:0.85">(${statusText})</span></div>`;
    container.innerHTML = html; container.classList.remove('hidden');
    if (window.apiErrorTimeout) clearTimeout(window.apiErrorTimeout); window.apiErrorTimeout = setTimeout(() => container.classList.add('hidden'), 8000);
}

function checkAiReady() {
    if (IS_FILE_PROTOCOL) { showToast('⛔ AI bị chặn do mở file qua file://. Dùng VS Code Live Server hoặc python -m http.server 8080', 7000); return false; }
    if (!getApiKey()) { showToast('⚠️ Chưa có API Key! Nhấn nút "Cài đặt API" (chấm đỏ) để nhập Gemini API Key.', 6000); const modal = document.getElementById('aiSettingsModal'); if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } return false; }
    return true;
}

// ======================== AI GENERATOR ========================
async function explainWithAI(idx, lengthMode = 'normal') {
    if (!checkAiReady()) return;
    const explainDiv = document.getElementById(`ai-explanation-${idx}`);
    const aiBtn = document.querySelector(`.ai-explain-btn[data-qidx="${idx}"]`);
    if (!explainDiv || !aiBtn) return;

    if (explainDiv.dataset.loaded === 'true' && !arguments[1]) {
        if (explainDiv.classList.contains('hidden')) {
            explainDiv.classList.remove('hidden');
            aiBtn.innerHTML = `<i class="fas fa-eye-slash"></i> Ẩn giải thích`;
        } else {
            explainDiv.classList.add('hidden');
            aiBtn.innerHTML = `<i class="fas fa-magic"></i> Hiện giải thích`;
        }
        return;
    }

    explainDiv.classList.remove('hidden');
    aiBtn.innerHTML = `<i class="fas fa-eye-slash"></i> Ẩn giải thích`;
    explainDiv.innerHTML = `<div class="p-3 text-center"><span class="text-purple-600 font-medium"><i class="fas fa-spinner fa-spin mr-2"></i>AI đang phân tích...</span></div>`;

    const q = currentQuestions[idx];
    const correctText = q.correctIndices.map(i => q.options[i]).join(', ');
    const allOptionsText = q.options.map((opt, i) => `${String.fromCharCode(65 + i)}. ${opt}`).join('\n');
    let lengthPrompt = "ngắn gọn, súc tích, trực diện và dễ hiểu";
    if (lengthMode === 'short') lengthPrompt = "cực kỳ ngắn gọn, tóm tắt ý chính trong 1-2 câu";
    if (lengthMode === 'long') lengthPrompt = "rất chi tiết, phân tích cặn kẽ tại sao đáp án đúng lại đúng, tại sao các phương án khác lại sai, cho ví dụ minh họa nếu cần thiết";

    const userQuery = `Hãy giải thích ${lengthPrompt} tại sao đáp án lại là "${correctText}" cho câu hỏi trắc nghiệm dưới đây.\nCâu hỏi: ${q.text}\nCác phương án:\n${allOptionsText}\nLưu ý: Không lặp lại câu hỏi. Trả lời bằng tiếng Việt. Dùng * để in nghiêng, ** để in đậm.`;

    let data = null;
    try {
        const payload = { contents: [{ role: "user", parts: [{ text: userQuery }] }], generationConfig: { temperature: 0.2 } };
        data = await callAiProxy({ provider: 'google', model: 'gemini-1.5-flash', payload });
        const formattedText = data.candidates[0].content.parts[0].text.replace(/\n/g, '<br>');
        AI_TEXT_CACHE[`ai-${idx}`] = data.candidates[0].content.parts[0].text;

        const toolbarHtml = `
            <div class="mb-4 pb-3 border-b border-purple-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4 w-full relative z-20">
                <div class="flex items-center gap-2">
                    <button class="speak-toggle-btn w-10 h-10 flex items-center justify-center bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 rounded-full hover:bg-purple-200 transition shadow-sm" data-qidx="ai-${idx}" title="Nghe giải thích">
                        <i class="fas fa-volume-up text-lg"></i>
                    </button>
                    <div class="relative speed-container">
                        <button class="speed-btn h-10 px-3 flex items-center gap-1 bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 transition text-sm font-medium border border-gray-200 dark:border-slate-700 shadow-sm">
                            <span class="current-speed">${SpeechManager.rate.toFixed(1)}x</span>
                            <i class="fas fa-chevron-down text-[10px] opacity-50"></i>
                        </button>
                        <div class="speed-menu absolute top-full left-0 mt-1 w-20 bg-white dark:bg-slate-800 shadow-xl border border-gray-200 dark:border-slate-700 rounded-lg hidden z-[100] overflow-hidden">
                            ${[0.7, 0.9, 1.0, 1.2, 1.5, 2.0].map(r => `<div class="speed-opt px-3 py-2 hover:bg-purple-50 dark:hover:bg-purple-900 cursor-pointer text-sm text-center ${SpeechManager.rate === r ? 'text-purple-600 font-bold bg-purple-50 dark:bg-purple-900' : ''}" data-rate="${r}" data-qidx="ai-${idx}">${r.toFixed(1)}x</div>`).join('')}
                        </div>
                    </div>
                    <button class="copy-ai-btn w-10 h-10 flex items-center justify-center bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-200 transition shadow-sm" data-qidx="ai-${idx}" title="Copy nội dung">
                        <i class="fas fa-copy text-lg"></i>
                    </button>
                </div>
                <div class="flex items-center gap-1.5">
                    <button class="ai-length-btn text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-lg transition ${lengthMode === 'short' ? 'bg-purple-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-purple-600 border border-purple-200 dark:border-slate-700'}" data-qidx="${idx}" data-len="short">Ngắn</button>
                    <button class="ai-length-btn text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-lg transition ${lengthMode === 'normal' ? 'bg-purple-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-purple-600 border border-purple-200 dark:border-slate-700'}" data-qidx="${idx}" data-len="normal">Vừa</button>
                    <button class="ai-length-btn text-[10px] uppercase font-bold tracking-wider px-3 py-1.5 rounded-lg transition ${lengthMode === 'long' ? 'bg-purple-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-purple-600 border border-purple-200 dark:border-slate-700'}" data-qidx="${idx}" data-len="long">Dài</button>
                </div>
            </div>`;

        explainDiv.innerHTML = `<div class="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-xl border-2 border-purple-200 dark:border-purple-800 shadow-md relative overflow-visible">
            <div class="font-bold text-purple-900 dark:text-purple-300 mb-3 flex items-center gap-2 text-base">
                <i class="fas fa-robot text-lg"></i> AI Tutor Giải thích
            </div>
            ${toolbarHtml}
            <div class="ai-text-content leading-relaxed text-gray-800 dark:text-gray-200 text-sm md:text-base clear-both relative z-10">${formattedText}</div>
        </div>`;
        explainDiv.dataset.loaded = 'true';
    } catch (error) {
        explainDiv.innerHTML = `<span class="text-red-500 p-3 block"><i class="fas fa-exclamation-triangle"></i> Lỗi phân tích: ${error.message}</span>`;
    }
}

// ======================== APP CORE LOGIC ========================
function evaluateAll() { let correct = 0, details = []; for (let i = 0; i < currentQuestions.length; i++) { const res = checkAnswer(i); details.push({ index: i, correct: res.correct, correctIndices: res.correctAnswers, userIndices: res.userAnswers }); if (res.correct) correct++; } return { correctCount: correct, total: currentQuestions.length, details }; }

function parseExcelToQuestions(dataBuffer) {
    const wb = XLSX.read(dataBuffer, { type: 'array' }); const qList = [];
    for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName]; const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }); if (!rows || rows.length < 2) continue;
        let headerIdx = -1; let colMap = { question: -1, answer: -1, type: -1, options: [] };
        for (let i = 0; i < Math.min(rows.length, 30); i++) { const row = rows[i]; if (!row) continue; const rowStr = row.map(c => String(c || "").trim().toLowerCase()); const rowFullText = rowStr.join(" "); if ((rowFullText.includes("câu hỏi") || rowFullText.includes("nội dung")) && rowFullText.includes("đáp án")) { headerIdx = i; for (let j = 0; j < rowStr.length; j++) { const cell = rowStr[j]; if (cell === "câu hỏi" || cell.includes("nội dung câu hỏi")) colMap.question = j; else if (cell === "đáp án" || cell.includes("trả lời")) colMap.answer = j; else if (cell.includes("loại câu hỏi") || cell === "loại" || cell === "type") colMap.type = j; else if (cell.includes("phương án") || cell.includes("lựa chọn") || cell.includes("option") || /^[a-f]$/.test(cell) || /^đáp án [a-f]$/.test(cell)) colMap.options.push(j); } break; } }
        if (headerIdx === -1 || colMap.question === -1 || colMap.answer === -1 || colMap.options.length === 0) continue;
        for (let i = headerIdx + 1; i < rows.length; i++) { const row = rows[i]; if (!row) continue; const qText = String(row[colMap.question] || "").trim(); if (!qText) continue; let qType = 'single'; let typeRaw = colMap.type !== -1 ? String(row[colMap.type] || "").toUpperCase() : ""; if (typeRaw.includes('MC') || typeRaw.includes('MA')) qType = 'multiple'; else if (typeRaw.includes('SC') || typeRaw.includes('SA')) qType = 'single'; const opts = []; colMap.options.forEach(colIdx => { const optVal = String(row[colIdx] || "").trim(); if (optVal !== "") opts.push(optVal); }); if (opts.length === 0) continue; let ansRaw = String(row[colMap.answer] || "").trim().toUpperCase(); let ansIdx = []; const ansParts = ansRaw.split(/[,;]+/).map(s => s.trim()).filter(s => s); ansParts.forEach(part => { if (/^\d+$/.test(part)) { const idx = parseInt(part) - 1; if (idx >= 0 && idx < opts.length) ansIdx.push(idx); } else if (/^[A-Z]$/.test(part)) { const idx = part.charCodeAt(0) - 65; if (idx >= 0 && idx < opts.length) ansIdx.push(idx); } }); if (qType === 'single' && ansIdx.length > 1) qType = 'multiple'; if (ansIdx.length === 0) continue; qList.push({ text: qText, options: opts, correctIndices: ansIdx, type: qType }); }
    }
    if (qList.length === 0) throw new Error("Không nhận diện được câu hỏi hợp lệ nào."); return qList;
}

async function uploadAndSaveFile(file) {
    showLoading(true, "Đang đọc file Excel...");
    try {
        const data = await new Promise((res, rej) => { const reader = new FileReader(); reader.onload = e => res(new Uint8Array(e.target.result)); reader.onerror = rej; reader.readAsArrayBuffer(file); });
        const parsed = parseExcelToQuestions(data); showLoading(false);
        showPrompt("Nhập tên bộ câu hỏi:", file.name.replace(/\.(xlsx|xls)$/i, ''), async (name) => { if (!name) { showToast("Đã hủy lưu."); return; } showLoading(true, "Đang lưu..."); try { await saveBank(name, parsed); await refreshBankDropdown(); const banks = await getAllBanks(); await loadBankById(banks[banks.length - 1].id); if (document.getElementById('uploadStatus')) document.getElementById('uploadStatus').innerHTML = `✅ Đã lưu bộ "${name}" với ${parsed.length} câu.`; showToast(`Đã tải bộ "${name}"`); } catch (err) { if (document.getElementById('uploadStatus')) document.getElementById('uploadStatus').innerHTML = `❌ ${err.message}`; showToast(err.message); } finally { showLoading(false); } });
    } catch (err) { showLoading(false); if (document.getElementById('uploadStatus')) document.getElementById('uploadStatus').innerHTML = `❌ ${err.message}`; showToast(err.message); }
}

async function refreshBankDropdown() { const bankSelect = document.getElementById('bankSelect'); const banks = await getAllBanks(); if (bankSelect) { bankSelect.innerHTML = '<option value="">-- Chọn bộ câu hỏi --</option>'; banks.forEach(b => { const opt = document.createElement('option'); opt.value = b.id; opt.textContent = `${b.name} (${b.questions.length} câu)`; bankSelect.appendChild(opt); }); if (currentBankId) bankSelect.value = currentBankId; } }
async function loadBankById(id) { const bank = await getBankById(id); if (!bank) return false; masterQuestions = bank.questions; currentBankId = bank.id; currentBankName = bank.name; const currentBankInfo = document.getElementById('currentBankInfo'); if (currentBankInfo) currentBankInfo.innerText = `Đã tải: ${bank.name} (${bank.questions.length} câu)`; startFullTest(); return true; }
function deleteSelectedBank() { const bankSelect = document.getElementById('bankSelect'); const id = bankSelect.value; if (!id) { showToast("Chọn bộ cần xóa."); return; } showConfirm("Xóa bộ câu hỏi này?", async (yes) => { if (!yes) return; await deleteBank(parseInt(id)); await refreshBankDropdown(); if (currentBankId == id) { masterQuestions = []; currentBankId = null; currentBankName = ''; const currentBankInfo = document.getElementById('currentBankInfo'); if (currentBankInfo) currentBankInfo.innerText = ''; stopTimer(); currentQuestions = []; userAnswers = []; flagged = []; submitted = false; examActive = false; updateProgress(); initLazyRender(); if (document.getElementById('resultPanel')) document.getElementById('resultPanel').classList.add('hidden'); if (document.getElementById('modeInfo')) document.getElementById('modeInfo').innerText = ''; } showToast("Đã xóa."); }); }

async function showStatistics() {
    showLoading(true, "Đang tải báo cáo...");
    try {
        const history = await getAllHistory(); const statsContent = document.getElementById('statsContent'); const wrongContainer = document.getElementById('wrongQuestionsContainer'); if (!statsContent || !wrongContainer) return;
        if (history.length === 0) { statsContent.innerHTML = '<p class="text-gray-500">Chưa có dữ liệu lịch sử.</p>'; wrongContainer.innerHTML = '<p class="text-gray-500">Chưa có câu sai nào.</p>'; const modal = document.getElementById('statsModal'); if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } return; }
        const byBank = {}; for (const h of history) { if (!byBank[h.bankId]) byBank[h.bankId] = { bankName: h.bankName, attempts: [], totalQuestions: h.totalQuestions, wrongCounts: [] }; byBank[h.bankId].attempts.push(h); byBank[h.bankId].wrongCounts.push(h.wrongCount); }
        let html = '<div class="space-y-4">'; for (const id in byBank) { const b = byBank[id]; const avg = (b.wrongCounts.reduce((a, c) => a + c, 0) / b.attempts.length).toFixed(1); html += `<div class="border rounded-lg p-3"><h3 class="font-bold text-lg">📘 ${b.bankName}</h3><p>Số lần ôn: ${b.attempts.length}</p><p>Trung bình sai: ${avg}/${b.totalQuestions}</p><p>Lần gần nhất: ${new Date(b.attempts[b.attempts.length - 1].date).toLocaleString()}</p></div>`; } html += '</div>'; statsContent.innerHTML = html;
        const filteredHistory = history.filter(h => h.bankId === currentBankId); const wrongCountMap = new Map(); for (const h of filteredHistory) { if (h.wrongQuestionsText) { for (const txt of h.wrongQuestionsText) { const key = `${h.bankId}|${txt}`; if (wrongCountMap.has(key)) wrongCountMap.get(key).count++; else wrongCountMap.set(key, { text: txt, count: 1, bankId: h.bankId, bankName: h.bankName }); } } }
        const sortedWrong = Array.from(wrongCountMap.values()).sort((a, b) => b.count - a.count);
        if (sortedWrong.length === 0) { wrongContainer.innerHTML = '<p class="text-gray-500">Không có câu sai nào trong bộ hiện tại.</p>'; }
        else {
            let tableHtml = `<table class="wrong-table w-full text-sm border-collapse"><thead><tr><th>#</th><th>Nội dung câu hỏi</th><th>Số lần sai</th><th>Hành động</th></tr></thead><tbody>`;
            sortedWrong.forEach((item, idx) => { tableHtml += `<tr><td>${idx + 1}</td><td>${escapeHtml(item.text)}</td><td>${item.count}</td><td><button class="review-wrong-item-btn bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs" data-text="${escapeHtml(item.text)}">Xem lại</button></td></tr>`; });
            tableHtml += `</tbody></table>`; wrongContainer.innerHTML = tableHtml;
            document.querySelectorAll('.review-wrong-item-btn').forEach(btn => { btn.addEventListener('click', async (e) => { const questionText = btn.getAttribute('data-text'); const found = masterQuestions.find(q => q.text === questionText); if (found) { initExam([found], parseInt(document.getElementById('timeMinutes')?.value) || 30); document.getElementById('statsModal')?.classList.add('hidden'); showToast(`Đang ôn tập câu: ${questionText.substring(0, 80)}...`); } else { showToast("Không tìm thấy câu hỏi."); } }); });
        }
        const ctx = document.getElementById('statsChart')?.getContext('2d'); if (ctx) { if (statsChart) statsChart.destroy(); const dates = history.slice(-10).map(h => new Date(h.date).toLocaleDateString()); const scores = history.slice(-10).map(h => Math.round(h.correctCount / h.totalQuestions * 100)); statsChart = new Chart(ctx, { type: 'line', data: { labels: dates, datasets: [{ label: 'Tỷ lệ đúng (%)', data: scores, borderColor: 'blue', tension: 0.1 }] }, options: { responsive: true } }); }
        const modal = document.getElementById('statsModal'); if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    } finally { showLoading(false); }
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }
function updateTimerDisplay() { const m = Math.floor(timeRemainingSeconds / 60), s = timeRemainingSeconds % 60; const display = document.getElementById('timerDisplay'); if (display) display.innerText = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; }
function startTimer(seconds) { stopTimer(); timeRemainingSeconds = seconds; updateTimerDisplay(); if (!isPaused && examActive && !submitted) timerInterval = setInterval(() => { if (!examActive || isPaused || submitted) return; if (timeRemainingSeconds <= 1) { stopTimer(); if (!submitted && currentQuestions.length) submitExam(); } else { timeRemainingSeconds--; updateTimerDisplay(); saveProgressToLocal(); } }, 1000); }
function pauseExam() { if (!examActive || submitted) return; isPaused = true; stopTimer(); const btn = document.getElementById('pauseResumeBtn'); if (btn) btn.innerHTML = '<i class="fas fa-play"></i> Tiếp tục'; showToast("Đã tạm dừng."); saveProgressToLocal(); }
function resumeExam() { if (!examActive || submitted) return; isPaused = false; const btn = document.getElementById('pauseResumeBtn'); if (btn) btn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng'; startTimer(timeRemainingSeconds); showToast("Tiếp tục."); saveProgressToLocal(); }

function initLazyRender(onComplete = null) {
    try {
        const questionsContainer = document.getElementById('questionsContainer'); if (!questionsContainer) return;
        if (!currentQuestions || !currentQuestions.length) { questionsContainer.innerHTML = '<div class="text-center text-gray-400 py-10">Chưa có bài thi.</div>'; if (onComplete) onComplete(); return; }
        const searchInput = document.getElementById('searchInput'); const rawSearch = (searchInput && searchInput.value) ? searchInput.value.trim().toLowerCase() : "";
        const searchNorm = removeAccents(rawSearch); const terms = searchNorm.split(/\s+/).filter(t => t); const isAcronymSearch = terms.length === 1 && terms[0].length >= 2; const acronymTarget = terms.length === 1 ? terms[0] : ""; const rawTerms = rawSearch.split(/\s+/).filter(t => t);
        filteredIndices = [];
        for (let i = 0; i < currentQuestions.length; i++) { const qText = currentQuestions[i].text; const qTextLower = qText.toLowerCase(); const matchNormal = rawTerms.length === 0 || rawTerms.every(term => qTextLower.includes(term)); let matchAcronym = false; if (isAcronymSearch && !matchNormal) { const { initials } = getInitialsInfo(qText); if (initials.includes(acronymTarget)) matchAcronym = true; } if (rawTerms.length === 0 || matchNormal || matchAcronym) filteredIndices.push(i); }
        questionsContainer.innerHTML = ''; displayedCount = 0; renderNextBatch(rawSearch); setupScrollObserver(rawSearch); attachGlobalEvents(); if (onComplete) onComplete();
    } catch (err) { console.error("Render Error:", err); }
}

function renderNextBatch(rawSearch) {
    const end = Math.min(displayedCount + BATCH_SIZE, filteredIndices.length); if (displayedCount >= end) return;
    const fragment = document.createDocumentFragment();
    for (let i = displayedCount; i < end; i++) { const idx = filteredIndices[i]; const div = document.createElement('div'); div.innerHTML = generateQuestionHTML(idx, rawSearch); fragment.appendChild(div.firstElementChild); }
    const questionsContainer = document.getElementById('questionsContainer'); if (questionsContainer) questionsContainer.appendChild(fragment); displayedCount = end;
}

function setupScrollObserver(rawSearch) { const loadMoreTrigger = document.getElementById('loadMoreTrigger'); if (!loadMoreTrigger) return; if (scrollObserver) scrollObserver.disconnect(); scrollObserver = new IntersectionObserver((entries) => { if (entries[0].isIntersecting && displayedCount < filteredIndices.length) renderNextBatch(rawSearch); }, { rootMargin: '300px' }); scrollObserver.observe(loadMoreTrigger); }

function renderQuestionGrid() {
    const questionGrid = document.getElementById('questionGrid'); if (!questionGrid) return;
    if (!currentQuestions.length) { questionGrid.innerHTML = '<div class="text-gray-400">Chưa có dữ liệu</div>'; return; }
    let html = ''; for (let i = 0; i < currentQuestions.length; i++) { let bg = 'bg-blue-200'; if (userAnswers[i]?.length > 0) bg = 'bg-green-500'; if (flagged[i]) bg = 'bg-yellow-400'; html += `<div class="question-grid-item w-10 h-10 rounded-md flex items-center justify-center text-xs font-bold text-white ${bg} shadow-sm cursor-pointer hover:opacity-80" data-qidx="${i}">${i + 1}</div>`; } questionGrid.innerHTML = html;
    document.querySelectorAll('.question-grid-item').forEach(el => { el.addEventListener('click', () => { const idx = parseInt(el.dataset.qidx); const searchInput = document.getElementById('searchInput'); const clearSearchBtn = document.getElementById('clearSearchBtn'); if (!document.getElementById(`question-${idx}`)) { if (searchInput) searchInput.value = ''; if (clearSearchBtn) clearSearchBtn.classList.add('hidden'); initLazyRender(() => { while (displayedCount <= idx && displayedCount < filteredIndices.length) renderNextBatch(''); setTimeout(() => document.getElementById(`question-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }); } else { document.getElementById(`question-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } document.getElementById('questionGridPanel')?.classList.add('hidden'); }); });
}

function initExam(questionsArray, timeMinutes) {
    try {
        if (!questionsArray || !questionsArray.length) { showToast("Chưa có ngân hàng."); return false; }
        stopTimer(); currentQuestions = [...questionsArray]; userAnswers = Array(currentQuestions.length).fill().map(() => []); flagged = Array(currentQuestions.length).fill(false); submitted = false; examActive = true; isPaused = false;
        const pauseResumeBtn = document.getElementById('pauseResumeBtn'); if (pauseResumeBtn) pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng';
        updateProgress(); initLazyRender();
        const resultPanel = document.getElementById('resultPanel'); if (resultPanel) resultPanel.classList.add('hidden');
        const searchInput = document.getElementById('searchInput'); if (searchInput) searchInput.value = '';
        const clearSearchBtn = document.getElementById('clearSearchBtn'); if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
        startTimer(timeMinutes * 60);
        const modeInfo = document.getElementById('modeInfo'); if (modeInfo) modeInfo.innerText = `Đang thi: ${currentQuestions.length} câu, ${timeMinutes} phút`;
        renderQuestionGrid(); saveProgressToLocal();
        return true;
    } catch (e) { console.error("InitExam Error:", e); showToast("Lỗi khi khởi tạo bài thi!"); return false; }
}

function startFullTest() { if (!masterQuestions.length) showToast("Chưa có bộ câu hỏi."); else { showToast("Đang tải đề thi..."); initExam(masterQuestions, parseInt(document.getElementById('timeMinutes')?.value) || 30); } }
function startRandomTest() { if (!masterQuestions.length) showToast("Chưa có bộ câu hỏi."); else { let num = parseInt(document.getElementById('questionCount')?.value); if (isNaN(num) || num <= 0) num = masterQuestions.length; if (num > masterQuestions.length) num = masterQuestions.length; const shuffled = [...masterQuestions]; for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; } showToast("Đang tạo đề ngẫu nhiên..."); initExam(shuffled.slice(0, num), parseInt(document.getElementById('timeMinutes')?.value) || 30); } }
function resetCurrentExam() { if (!currentQuestions.length) showToast("Chưa có bài."); else if (!examActive) showToast("Bài đã nộp."); else { showToast("Đang làm mới bài thi..."); stopTimer(); userAnswers = Array(currentQuestions.length).fill().map(() => []); flagged = Array(currentQuestions.length).fill(false); submitted = false; examActive = true; isPaused = false; const btn = document.getElementById('pauseResumeBtn'); if (btn) btn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng'; updateProgress(); initLazyRender(); if (document.getElementById('resultPanel')) document.getElementById('resultPanel').classList.add('hidden'); startTimer((parseInt(document.getElementById('timeMinutes')?.value) || 30) * 60); saveProgressToLocal(); } }

function submitExam() {
    if (!currentQuestions.length || submitted) return;
    showConfirm("Bạn có chắc muốn nộp bài?", async (yes) => {
        if (!yes) return;
        try {
            stopTimer(); examActive = false; submitted = true; const evalRes = evaluateAll(); scoreDetails = evalRes.details; const percent = (evalRes.correctCount / evalRes.total * 100).toFixed(1);
            const resultContent = document.getElementById('resultContent'); if (resultContent) resultContent.innerHTML = `<div class="bg-gray-50 p-4 rounded-lg"><p class="text-lg font-semibold text-gray-800">✅ Điểm số: ${evalRes.correctCount}/${evalRes.total} (${percent}%)</p><p class="text-sm text-gray-700 mt-1">Đúng: ${evalRes.correctCount} | Sai: ${evalRes.total - evalRes.correctCount}</p><div class="w-full bg-gray-200 rounded-full h-2 mt-3"><div class="bg-green-500 h-2 rounded-full" style="width:${percent}%"></div></div></div><div class="mt-3 text-sm italic text-gray-600">💡 Kết quả chi tiết bên dưới. Tận dụng "Gia sư AI" để phân tích lỗi sai nhé!</div>`;
            const resultPanel = document.getElementById('resultPanel'); if (resultPanel) resultPanel.classList.remove('hidden');
            const searchInput = document.getElementById('searchInput'); if (searchInput) searchInput.value = '';
            const clearSearchBtn = document.getElementById('clearSearchBtn'); if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
            initLazyRender(() => { while (displayedCount < Math.min(50, filteredIndices.length)) renderNextBatch(''); setTimeout(() => resultPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); });
            const wrongIndices = [], wrongTexts = []; for (let i = 0; i < currentQuestions.length; i++) { if (userAnswers[i]?.length > 0 && !scoreDetails[i].correct) { wrongIndices.push(i); wrongTexts.push(currentQuestions[i].text); } }
            if (currentBankId) { await saveHistory(currentBankId, currentBankName, currentQuestions.length, evalRes.correctCount, wrongIndices, wrongTexts); }
            showToast("Đã lưu kết quả."); clearProgress();
        } catch (err) { console.error(err); showToast("Lỗi nộp bài!"); }
    });
}

function handleContainerChange(e) { const inp = e.target; if (inp.classList.contains('option-input')) { const qIdx = parseInt(inp.dataset.qidx); const container = document.getElementById(`question-${qIdx}`); if (!container) return; const all = container.querySelectorAll(`.option-input[name="q${qIdx}"]`); let sel = []; all.forEach(i => { if (i.checked) sel.push(parseInt(i.dataset.optidx)); }); setAnswer(qIdx, sel); } }
function handleContainerClick(e) {
    // 1. Nút Nghe/Tạm dừng (Speak Toggle)
    const speakBtn = e.target.closest('.speak-toggle-btn');
    if (speakBtn) {
        e.preventDefault();
        const id = String(speakBtn.dataset.qidx);
        let textToRead = "";

        if (id.includes('-q')) {
            const qIdx = parseInt(id);
            textToRead = currentQuestions[qIdx].text;
        } else if (id.includes('-opt')) {
            const parts = id.split('-opt-');
            const qIdx = parseInt(parts[0]);
            const optIdx = parseInt(parts[1]);
            textToRead = currentQuestions[qIdx].options[optIdx];
        } else {
            textToRead = AI_TEXT_CACHE[id] || "";
        }

        speak(textToRead, id);
        return;
    }

    // 2. Nút Tốc độ (Hiện Menu)
    const speedBtn = e.target.closest('.speed-btn');
    if (speedBtn) {
        e.preventDefault();
        e.stopPropagation();
        const menu = speedBtn.nextElementSibling;
        document.querySelectorAll('.speed-menu').forEach(m => { if (m !== menu) m.classList.add('hidden'); });
        menu.classList.toggle('hidden');
        return;
    }

    // 3. Chọn mức Tốc độ
    const speedOpt = e.target.closest('.speed-opt');
    if (speedOpt) {
        e.preventDefault();
        const rate = parseFloat(speedOpt.dataset.rate);
        SpeechManager.setRate(rate);
        const container = speedOpt.closest('.speed-container');
        if (container) {
            const speedText = container.querySelector('.current-speed');
            if (speedText) speedText.innerText = `${rate.toFixed(1)}x`;
            const menu = container.querySelector('.speed-menu');
            if (menu) menu.classList.add('hidden');
        }
        return;
    }

    // 4. Click ra ngoài để đóng Menu tốc độ
    if (!e.target.closest('.speed-container')) {
        document.querySelectorAll('.speed-menu').forEach(m => m.classList.add('hidden'));
    }

    const copyBtn = e.target.closest('.copy-ai-btn');
    if (copyBtn) {
        e.preventDefault();
        const qIdx = copyBtn.dataset.qidx;
        const text = AI_TEXT_CACHE[qIdx];
        if (text) copyToClipboard(text);
        return;
    }

    const btn = e.target.closest('.flag-btn'); if (btn) { e.preventDefault(); toggleFlag(parseInt(btn.dataset.qidx)); return; }
    const hint = e.target.closest('.hint-btn'); if (hint) { e.preventDefault(); showHint(parseInt(hint.dataset.qidx)); return; }
    const aiBtn = e.target.closest('.ai-explain-btn'); if (aiBtn) { e.preventDefault(); explainWithAI(parseInt(aiBtn.dataset.qidx)); return; }
    const aiLengthBtn = e.target.closest('.ai-length-btn'); if (aiLengthBtn) { e.preventDefault(); explainWithAI(parseInt(aiLengthBtn.dataset.qidx), aiLengthBtn.dataset.len); return; }
}
function attachGlobalEvents() { const container = document.getElementById('questionsContainer'); if (!container) return; container.removeEventListener('change', handleContainerChange); container.removeEventListener('click', handleContainerClick); container.addEventListener('change', handleContainerChange); container.addEventListener('click', handleContainerClick); }

async function restoreProgress() {
    try {
        const saved = loadProgress(); if (!saved || !saved.bankId) return false;
        const bank = await getBankById(saved.bankId); if (!bank) { clearProgress(); return false; }
        masterQuestions = bank.questions; currentBankId = bank.id; currentBankName = bank.name;
        const currentBankInfo = document.getElementById('currentBankInfo'); if (currentBankInfo) currentBankInfo.innerText = `Đã tải: ${bank.name} (${bank.questions.length} câu)`;
        if (saved.submitted) { currentQuestions = [...masterQuestions]; userAnswers = saved.userAnswers || Array(currentQuestions.length).fill().map(() => []); flagged = saved.flagged || Array(currentQuestions.length).fill(false); submitted = true; examActive = false; isPaused = false; timeRemainingSeconds = 0; updateProgress(); initLazyRender(); showToast(`♻️ Đã khôi phục phiên làm bài: ${bank.name}`); }
        else if (saved.examActive) { currentQuestions = [...masterQuestions]; userAnswers = saved.userAnswers || Array(currentQuestions.length).fill().map(() => []); flagged = saved.flagged || Array(currentQuestions.length).fill(false); submitted = false; examActive = true; isPaused = saved.isPaused || false; timeRemainingSeconds = saved.timeRemainingSeconds || 0; const btn = document.getElementById('pauseResumeBtn'); if (btn) btn.innerHTML = isPaused ? '<i class="fas fa-play"></i> Tiếp tục' : '<i class="fas fa-pause"></i> Tạm dừng'; updateProgress(); initLazyRender(); if (!isPaused) startTimer(timeRemainingSeconds); else updateTimerDisplay(); if (document.getElementById('modeInfo')) document.getElementById('modeInfo').innerText = `Đang thi: ${currentQuestions.length} câu`; showToast(`♻️ Đã khôi phục bài thi đang làm dở: ${bank.name}`); }
        else { return false; }
        return true;
    } catch (e) { clearProgress(); return false; }
}

async function initGIA() {
    try {
        await openDB(); await refreshBankDropdown(); initDarkMode(); updateApiKeyBadge();
        const restored = await restoreProgress(); if (!restored) { const banks = await getAllBanks(); if (banks.length) await loadBankById(banks[0].id); }
        const searchInput = document.getElementById('searchInput'); const clearSearchBtn = document.getElementById('clearSearchBtn');
        searchInput?.addEventListener('input', () => { if (searchInput.value.length > 0) clearSearchBtn?.classList.remove('hidden'); else clearSearchBtn?.classList.add('hidden'); if (searchDebounceTimer) clearTimeout(searchDebounceTimer); searchDebounceTimer = setTimeout(() => { initLazyRender(); }, 300); });
        clearSearchBtn?.addEventListener('click', () => { if (searchInput) searchInput.value = ''; clearSearchBtn.classList.add('hidden'); initLazyRender(); });
        document.getElementById('excelUpload')?.addEventListener('change', e => { const file = e.target.files[0]; if (file) { uploadAndSaveFile(file).finally(() => { e.target.value = ''; }); } else { e.target.value = ''; } });
        document.getElementById('loadSelectedBankBtn')?.addEventListener('click', async () => { const bankSelect = document.getElementById('bankSelect'); const id = bankSelect?.value; if (id) await loadBankById(parseInt(id)); });
        document.getElementById('deleteBankBtn')?.addEventListener('click', deleteSelectedBank);
        document.getElementById('startFullTestBtn')?.addEventListener('click', startFullTest);
        document.getElementById('startRandomTestBtn')?.addEventListener('click', startRandomTest);
        document.getElementById('resetExamBtn')?.addEventListener('click', resetCurrentExam);
        document.getElementById('submitBtn')?.addEventListener('click', () => { if (currentQuestions.length && !submitted) submitExam(); else showToast("Chưa có bài hoặc đã nộp."); });
        document.getElementById('showGridBtn')?.addEventListener('click', () => { if (currentQuestions.length) { const panel = document.getElementById('questionGridPanel'); panel?.classList.toggle('hidden'); if (panel && !panel.classList.contains('hidden')) renderQuestionGrid(); } else showToast("Chưa có bài thi."); });
        document.getElementById('goTopBtn')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        document.getElementById('goBottomBtn')?.addEventListener('click', () => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
        document.getElementById('reviewWrongBtn')?.addEventListener('click', () => { if (!submitted) showToast("Hãy nộp bài trước."); else { const wrongs = scoreDetails.filter(d => !d.correct).map(d => d.index); if (wrongs.length) { if (!document.getElementById(`question-${wrongs[0]}`)) { initLazyRender(() => { while (displayedCount <= wrongs[0] && displayedCount < filteredIndices.length) renderNextBatch(''); setTimeout(() => document.getElementById(`question-${wrongs[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }); } else { document.getElementById(`question-${wrongs[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } } } });
        document.getElementById('showStatsBtn')?.addEventListener('click', showStatistics);
        document.getElementById('closeStatsModal')?.addEventListener('click', () => document.getElementById('statsModal')?.classList.add('hidden'));
        window.addEventListener('click', (e) => { if (e.target === document.getElementById('statsModal')) document.getElementById('statsModal')?.classList.add('hidden'); });
        document.getElementById('reviewWrongQuestionsBtn')?.addEventListener('click', async () => { const history = await getAllHistory(); if (history.length === 0) { showToast("Chưa có lịch sử để ôn tập."); return; } const currentBankWrongTexts = new Set(); for (const h of history) { if (h.bankId === currentBankId && h.wrongQuestionsText) { h.wrongQuestionsText.forEach(txt => currentBankWrongTexts.add(txt)); } } if (currentBankWrongTexts.size === 0) { showToast("Không có câu sai nào trong bộ hiện tại."); return; } const wrongQuestions = masterQuestions.filter(q => currentBankWrongTexts.has(q.text)); if (wrongQuestions.length === 0) { showToast("Không tìm thấy câu hỏi tương ứng."); return; } initExam(wrongQuestions, parseInt(document.getElementById('timeMinutes')?.value) || 30); document.getElementById('statsModal')?.classList.add('hidden'); showToast(`Đã tạo bài ôn tập với ${wrongQuestions.length} câu sai.`); });
        document.getElementById('reviewWrongMainBtn')?.addEventListener('click', async () => { const history = await getAllHistory(); if (history.length === 0) { showToast("Chưa có lịch sử để ôn tập."); return; } const currentBankWrongTexts = new Set(); for (const h of history) { if (h.bankId === currentBankId && h.wrongQuestionsText) { h.wrongQuestionsText.forEach(txt => currentBankWrongTexts.add(txt)); } } if (currentBankWrongTexts.size === 0) { showToast("Không có câu sai nào trong bộ hiện tại."); return; } const wrongQuestions = masterQuestions.filter(q => currentBankWrongTexts.has(q.text)); if (wrongQuestions.length === 0) { showToast("Không tìm thấy câu hỏi tương ứng."); return; } initExam(wrongQuestions, parseInt(document.getElementById('timeMinutes')?.value) || 30); showToast(`Đã tạo bài ôn tập với ${wrongQuestions.length} câu sai.`); });
        document.getElementById('exportPdfBtn')?.addEventListener('click', () => { if (!submitted) { showToast("Hãy nộp bài trước."); return; } showLoading(true, "Đang chuẩn bị báo cáo..."); try { const correctCount = scoreDetails.filter(d => d.correct).length; const percent = (correctCount / currentQuestions.length * 100).toFixed(1); const canvasChart = document.createElement('canvas'); canvasChart.width = 400; canvasChart.height = 200; const ctx = canvasChart.getContext('2d'); if (!ctx) return; new Chart(ctx, { type: 'doughnut', data: { labels: ['Đúng', 'Sai'], datasets: [{ data: [correctCount, currentQuestions.length - correctCount], backgroundColor: ['#22c55e', '#ef4444'] }] }, options: { animation: false, responsive: false, plugins: { legend: { position: 'top' } } } }); const chartImg = canvasChart.toDataURL(); let printWindow = window.open('', '_blank'); if (!printWindow) return; let html = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Báo cáo kết quả thi<\/title><style>body { font-family: Arial, sans-serif; padding: 20px; color: #000; background: #fff; line-height: 1.5; } h1 { color: #1e40af; } table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; } th, td { border: 1px solid #ccc; padding: 10px; text-align: left; } th { background-color: #f2f2f2; } .correct { color: #166534; font-weight: bold; } .wrong { color: #991b1b; font-weight: bold; } img { max-width: 300px; margin-bottom: 20px; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } table { page-break-inside: auto; } tr { page-break-inside: avoid; page-break-after: auto; } thead { display: table-header-group; } }<\/style><\/head><body><h1>Báo cáo kết quả thi<\/h1><p><strong>Bộ câu hỏi:<\/strong> ${currentBankName}<\/p><p><strong>Ngày thi:<\/strong> ${new Date().toLocaleString()}<\/p><p><strong>Điểm số:<\/strong> ${correctCount}\/${currentQuestions.length} (${percent}%)<\/p><img src="${chartImg}" alt="Biểu đồ kết quả" \/><hr\/><h3>Chi tiết từng câu hỏi<\/h3><table><thead><tr><th style="width:5%">STT<\/th><th style="width:40%">Nội dung<\/th><th style="width:25%">Đáp án đã chọn<\/th><th style="width:20%">Đáp án đúng<\/th><th style="width:10%">Kết quả<\/th><\/tr><\/thead><tbody>`; for (let i = 0; i < currentQuestions.length; i++) { const q = currentQuestions[i]; const userAns = userAnswers[i] || []; const userText = userAns.length ? userAns.map(a => q.options[a]).join('<br>') : '(Chưa trả lời)'; const correctText = q.correctIndices.map(i => q.options[i]).join('<br>'); const status = scoreDetails[i].correct ? 'Đúng' : (userAns.length ? 'Sai' : 'Chưa trả lời'); const statusClass = scoreDetails[i].correct ? 'correct' : 'wrong'; html += `<tr><td>${i + 1}<\/td><td>${escapeHtml(q.text)}<\/td><td>${userText}<\/td><td>${correctText}<\/td><td class="${statusClass}">${status}<\/td><\/tr>`; } html += `<\/tbody><\/table><\/body><\/html>`; printWindow.document.open(); printWindow.document.write(html); printWindow.document.close(); setTimeout(() => { showLoading(false); printWindow.print(); }, 500); } catch (e) { console.error(e); showToast("Lỗi xuất báo cáo: " + e.message); showLoading(false); } });
        document.getElementById('clearHistoryBtn')?.addEventListener('click', () => { showConfirm("Xóa toàn bộ lịch sử?", async (yes) => { if (!yes) return; await clearAllHistory(); showToast("Đã xóa lịch sử."); document.getElementById('statsModal')?.classList.add('hidden'); }); });
        document.getElementById('aiSettingsBtn')?.addEventListener('click', () => { const input = document.getElementById('geminiApiKeyInput'); if (input) input.value = localStorage.getItem('gemini_api_key') || ''; const modal = document.getElementById('aiSettingsModal'); if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); } });
        document.getElementById('closeAiSettingsBtn')?.addEventListener('click', () => { const modal = document.getElementById('aiSettingsModal'); if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } });
        document.getElementById('saveAiSettingsBtn')?.addEventListener('click', () => { const input = document.getElementById('geminiApiKeyInput'); const key = input?.value.trim(); if (key) { localStorage.setItem('gemini_api_key', key); showToast('✅ Đã lưu API Key!'); } else { localStorage.removeItem('gemini_api_key'); showToast('Đã xoá API Key!'); } const modal = document.getElementById('aiSettingsModal'); if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); } updateApiKeyBadge(); });
        document.getElementById('checkModelsBtn')?.addEventListener('click', checkAvailableModels);

        // AI Generator modal logic
        const openAiGenBtn = document.getElementById('openAiGenBtn');
        const aiGenModal = document.getElementById('aiGenModal');
        const closeAiGenBtn = document.getElementById('closeAiGenBtn');
        const submitAiGenBtn = document.getElementById('submitAiGenBtn');
        const removeFileBtn = document.getElementById('removeFileBtn');
        const uploadFileArea = document.getElementById('uploadFileArea');
        const fileInput = document.getElementById('fileInput');

        openAiGenBtn?.addEventListener('click', () => { aiGenModal?.classList.remove('hidden'); aiGenModal?.classList.add('flex'); currentFileData = null; currentMimeType = null; if (fileInput) fileInput.value = ''; document.getElementById('filePreviewContainer')?.classList.add('hidden'); uploadFileArea?.classList.remove('hidden'); if (document.getElementById('aiGenTextArea')) document.getElementById('aiGenTextArea').value = ''; });
        closeAiGenBtn?.addEventListener('click', () => { aiGenModal?.classList.add('hidden'); aiGenModal?.classList.remove('flex'); });
        uploadFileArea?.addEventListener('click', () => { fileInput?.click(); });
        removeFileBtn?.addEventListener('click', () => { currentFileData = null; currentMimeType = null; document.getElementById('filePreviewContainer')?.classList.add('hidden'); uploadFileArea?.classList.remove('hidden'); });

        fileInput?.addEventListener('change', async (e) => {
            const file = e.target.files[0]; if (!file) return;
            showLoading(true, "Đang xử lý file..."); const fileName = file.name.toLowerCase();
            if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                const reader = new FileReader();
                reader.onload = async (event) => {
                    let data = event.target.result.split(',')[1];
                    if (file.type.startsWith('image/')) data = await compressImage(data);
                    currentFileData = data; currentMimeType = file.type;
                    const fileNameDisplay = document.getElementById('fileNameDisplay'); if (fileNameDisplay) fileNameDisplay.innerText = file.name;
                    const icon = document.getElementById('fileIconPreview'); if (icon) icon.className = file.type.startsWith('image/') ? 'fas fa-image text-2xl text-blue-500' : 'fas fa-file-pdf text-2xl text-red-500';
                    uploadFileArea?.classList.add('hidden'); document.getElementById('filePreviewContainer')?.classList.remove('hidden');
                    showLoading(false);
                };
                reader.readAsDataURL(file);
            } else if (fileName.endsWith('.docx')) {
                const reader = new FileReader();
                reader.onload = function (loadEvent) { mammoth.extractRawText({ arrayBuffer: loadEvent.target.result }).then(function (result) { const area = document.getElementById('aiGenTextArea'); if (area) area.value += "\n" + result.value; showToast("Đã trích xuất chữ từ Word!"); showLoading(false); }).catch(err => { showToast("Lỗi đọc Word"); showLoading(false); }); };
                reader.readAsArrayBuffer(file);
            } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
                const reader = new FileReader();
                reader.onload = function (event) {
                    try { const wb = XLSX.read(event.target.result, { type: 'array' }); let allText = ""; wb.SheetNames.forEach(name => { const sheet = wb.Sheets[name]; const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }); allText += json.map(row => row.join(" ")).join("\n") + "\n"; }); const area = document.getElementById('aiGenTextArea'); if (area) area.value += "\n" + allText; showToast("Đã trích xuất chữ từ Excel!"); } catch (e) { showToast("Lỗi đọc Excel"); } showLoading(false);
                }; reader.readAsArrayBuffer(file);
            } else if (file.type.startsWith('text/')) {
                const reader = new FileReader();
                reader.onload = (event) => { const area = document.getElementById('aiGenTextArea'); if (area) area.value += "\n" + event.target.result; showLoading(false); }; reader.readAsText(file);
            } else { showToast("Định dạng file chưa hỗ trợ."); showLoading(false); }
            if (fileInput) fileInput.value = '';
        });

        submitAiGenBtn?.addEventListener('click', async () => {
            if (!checkAiReady()) return;
            const rawText = document.getElementById('aiGenTextArea')?.value.trim();
            if (!currentFileData && !rawText) { showToast("Vui lòng tải file hoặc dán văn bản!"); return; }
            const count = parseInt(document.getElementById('aiGenCount')?.value) || 10;
            let bankName = document.getElementById('aiGenName')?.value.trim(); if (!bankName) bankName = "Bộ đề AI - " + new Date().toLocaleString('vi-VN');
            const diff = document.getElementById('aiGenDifficulty')?.value;
            const difficultyText = diff !== 'Mặc định' ? `Mức độ câu hỏi: ${diff}.` : '';
            aiGenModal?.classList.add('hidden'); aiGenModal?.classList.remove('flex');
            showLoading(true, "AI đang suy nghĩ... (Có thể mất 10-30 giây)");
            const basePrompt = `Bạn là chuyên gia thiết kế đề thi trắc nghiệm. Hãy đọc tài liệu đính kèm (hoặc văn bản dưới đây). Trích xuất kiến thức và tạo ra chính xác ${count} câu hỏi trắc nghiệm. ${difficultyText}\nBẮT BUỘC trả về JSON array, không có markdown \`\`\`json.\nCấu trúc mẫu:\n[\n  {\n    "text": "Nội dung câu hỏi?",\n    "options": ["A", "B", "C", "D"],\n    "correctIndices": [0],\n    "type": "single"\n  }\n]\nLưu ý: correctIndices là mảng chứa index (từ 0). Nếu nhiều đáp án đúng, type="multiple". Tiếng Việt.`;
            let finalPrompt = basePrompt; if (rawText) finalPrompt += "\n\nVĂN BẢN:\n" + rawText;
            const partsArray = [{ text: finalPrompt }]; if (currentFileData) { partsArray.push({ inlineData: { mimeType: currentMimeType, data: currentFileData } }); }
            try {
                const payload = { contents: [{ role: "user", parts: partsArray }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } };
                const data = await callAiProxy({ provider: 'google', model: 'gemini-1.5-flash', payload });
                if (!data.candidates?.length || !data.candidates[0].content?.parts?.length) throw new Error("Gemini không trả về nội dung.");
                let aiResponseText = data.candidates[0].content.parts[0].text;
                aiResponseText = aiResponseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
                const jsonArray = JSON.parse(aiResponseText);
                if (!Array.isArray(jsonArray) || jsonArray.length === 0) throw new Error("JSON rỗng");
                await saveBank(bankName, jsonArray); await refreshBankDropdown();
                const banks = await getAllBanks(); const newBank = banks[banks.length - 1];
                showLoading(false);
                showConfirm(`✅ Đã tạo xong ${jsonArray.length} câu hỏi! Bắt đầu làm bài thi này ngay?`, async (yes) => { if (yes) await loadBankById(newBank.id); else showToast("Đã lưu bộ đề vào hệ thống."); });
            } catch (error) { showLoading(false); showToast("❌ Lỗi tạo đề: " + error.message, 7000); aiGenModal?.classList.remove('hidden'); aiGenModal?.classList.add('flex'); }
        });

        attachGlobalEvents();
    } catch (e) { console.error("Lỗi Khởi tạo Hệ thống:", e); }
}

initGIA();
