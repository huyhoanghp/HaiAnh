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
let hintEnabled = localStorage.getItem('haianh_hint_enabled') !== 'false';

// ======================== AUTH MANAGER (FIREBASE) ========================
const AuthManager = {
    user: null,
    db: null,
    
    init() {
        // Hiệu ứng hiện card đăng nhập
        setTimeout(() => {
            const card = document.getElementById('authCard');
            if (card) card.classList.add('active');
        }, 300);

        // Chuyển đổi tab Login/Register
        const tabLogin = document.getElementById('tabLogin');
        const tabRegister = document.getElementById('tabRegister');
        const btnSubmit = document.getElementById('btnSubmitLogin');

        tabLogin?.addEventListener('click', () => {
            tabLogin.className = 'flex-1 py-2 text-sm font-bold text-white rounded-lg bg-white/10 transition-all';
            tabRegister.className = 'flex-1 py-2 text-sm font-bold text-white/40 rounded-lg hover:text-white transition-all';
            btnSubmit.innerText = 'Bắt đầu học ngay';
            this.mode = 'login';
        });

        tabRegister?.addEventListener('click', () => {
            tabRegister.className = 'flex-1 py-2 text-sm font-bold text-white rounded-lg bg-white/10 transition-all';
            tabLogin.className = 'flex-1 py-2 text-sm font-bold text-white/40 rounded-lg hover:text-white transition-all';
            btnSubmit.innerText = 'Tạo tài khoản mới';
            this.mode = 'register';
        });

        // Các sự kiện nút bấm
        btnSubmit?.addEventListener('click', () => {
            if (this.mode === 'login') this.loginWithEmail();
            else this.registerWithEmail();
        });
        document.getElementById('btnGoogleLogin')?.addEventListener('click', () => this.loginWithGoogle());
        document.getElementById('logoutBtn')?.addEventListener('click', () => this.logout());
        
        // Khởi tạo Firebase với Config của người dùng
        const firebaseConfig = {
            apiKey: "AIzaSyCkLNCdbRWpWXV9vms9wmSyBT5WS3VdLdM",
            authDomain: "haianhstudy-99611.firebaseapp.com",
            projectId: "haianhstudy-99611",
            storageBucket: "haianhstudy-99611.firebasestorage.app",
            messagingSenderId: "278856696620",
            appId: "1:278856696620:web:7e8aa3fb21f952122fe289",
            measurementId: "G-7TWPWZ58R5"
        };
        
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        this.db = firebase.firestore();

        // Lắng nghe trạng thái đăng nhập
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                this.user = user;
                this.onLoginSuccess();
            } else {
                this.user = null;
                document.getElementById('authOverlay').classList.remove('hidden');
            }
        });
    },

    mode: 'login',

    async registerWithEmail() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        if (!email || !pass) { showToast("Vui lòng nhập đủ thông tin!"); return; }
        if (pass.length < 6) { showToast("Mật khẩu phải ít nhất 6 ký tự!"); return; }
        
        try {
            showLoading(true, "Đang tạo tài khoản...");
            await firebase.auth().createUserWithEmailAndPassword(email, pass);
            showLoading(false);
            showToast("Đăng ký thành công!");
        } catch (err) {
            showLoading(false);
            showToast("Lỗi đăng ký: " + err.message);
        }
    },

    async loginWithEmail() {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPassword').value;
        if (!email || !pass) { showToast("Vui lòng nhập đủ thông tin!"); return; }
        
        try {
            showLoading(true, "Đang xác thực...");
            await firebase.auth().signInWithEmailAndPassword(email, pass);
            showLoading(false);
        } catch (err) {
            showLoading(false);
            showToast("Lỗi đăng nhập: " + err.message);
        }
    },

    async loginWithGoogle() {
        try {
            const provider = new firebase.auth.GoogleAuthProvider();
            await firebase.auth().signInWithPopup(provider);
        } catch (err) {
            showToast("Lỗi Google Auth: " + err.message);
        }
    },

    onLoginSuccess() {
        showToast(`Chào mừng ${this.user.displayName || this.user.email}!`);
        const overlay = document.getElementById('authOverlay');
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 500);
        
        // Bắt đầu nạp dữ liệu từ Cloud
        this.syncFromCloud();
    },

    async syncFromCloud() {
        if (!this.user) return;
        try {
            console.log("AuthManager: Starting Cloud Sync...");
            
            // 1. Đồng bộ Review Stats
            const reviewDoc = await this.db.collection('users').doc(this.user.uid).collection('data').doc('review_stats').get();
            if (reviewDoc.exists) {
                const cloudStats = reviewDoc.data();
                // Merge hoặc ghi đè tùy chiến lược (ở đây ta ưu tiên Cloud)
                ReviewManager.stats = { ...ReviewManager.stats, ...cloudStats };
                ReviewManager.saveLocal(); // Lưu lại bản local
                ReviewManager.updateDashboardUI();
            } else {
                // Nếu cloud chưa có, đẩy local lên
                this.db.collection('users').doc(this.user.uid).collection('data').doc('review_stats').set(ReviewManager.stats);
            }

            // 2. Đồng bộ Progress
            const progressDoc = await this.db.collection('users').doc(this.user.uid).collection('data').doc('exam_progress').get();
            if (progressDoc.exists) {
                const cloudProgress = progressDoc.data();
                ProgressManager.applyProgress(cloudProgress);
            }
            
            showToast("✅ Đồng bộ dữ liệu đám mây hoàn tất!");
        } catch (err) {
            console.error("Sync Error:", err);
            showToast("❌ Lỗi đồng bộ: " + err.message);
        }
    },

    async logout() {
        try {
            await firebase.auth().signOut();
            location.reload(); // Reload để xóa sạch state
        } catch (err) {
            showToast("Lỗi đăng xuất: " + err.message);
        }
    }
};

const ProgressManager = {
    load() {
        const d = localStorage.getItem(PROGRESS_KEY);
        if (d) {
            const progress = JSON.parse(d);
            this.applyProgress(progress);
        }
    },

    applyProgress(p) {
        if (!p) return;
        try {
            currentBankId = p.bankId;
            currentBankName = p.bankName;
            currentQuestions = p.questions || [];
            userAnswers = p.userAnswers || [];
            flagged = p.flagged || [];
            timeRemainingSeconds = p.timeRemaining || 0;
            examActive = p.examActive || false;
            
            if (examActive) {
                document.getElementById('examSection')?.classList.remove('hidden');
                renderQuestionGrid();
                updateProgress();
                initLazyRender();
                if (timeRemainingSeconds > 0) startTimer(timeRemainingSeconds);
            }
        } catch (e) { console.error("Error applying progress:", e); }
    },

    save() {
        const progress = {
            bankId: currentBankId,
            bankName: currentBankName,
            questions: currentQuestions,
            userAnswers: userAnswers,
            flagged: flagged,
            timeRemaining: timeRemainingSeconds,
            examActive: examActive,
            timestamp: Date.now()
        };
        
        // Lưu Local
        localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
        
        // Lưu Cloud nếu đã đăng nhập
        if (AuthManager.user && AuthManager.db) {
            AuthManager.db.collection('users').doc(AuthManager.user.uid)
                .collection('data').doc('exam_progress').set(progress)
                .catch(e => console.error("Cloud Save Error:", e));
        }
    }
};

// Cấu hình ứng dụng
let appSettings = {
    showAiExplain: localStorage.getItem('haianh_show_ai_explain') !== 'false',
    showAiCall: localStorage.getItem('haianh_show_ai_call') !== 'false',
    defaultReadSpeed: parseFloat(localStorage.getItem('haianh_default_read_speed') || '1.0')
};

// ======================== VOICE ENGINE (NEW) ========================
let vietnameseVoice = null;
const VOICE_DICTIONARY = {
    // Chuyên ngành viễn thông/IT (do người dùng yêu cầu)
    "OLT": "O L T", "ONT": "O N T", "ONU": "O N U", "PON": "Pôn", "GPON": "G Pôn",
    "IP": "I P", "ISP": "nhà cung cấp dịch vụ Internet", "VoIP": "Voi P", "IPTV": "I P T V",
    "Triple Play": "Ba dịch vụ", "Ethernet": "Ét tơ nét", "gateway": "Cổng kết nối",
    "Wi-Fi": "Quai phai", "ALU": "A L U", "DASAN": "đa san",
    // Mạng và đơn vị
    "2G": "hai gờ", "3G": "ba gờ", "4G": "bốn gờ", "5G": "năm gờ", "6G": "sáu gờ",
    "km": "ki lô mét", "ms": "mi li giây",
    // Viết tắt phổ biến
    "v.v": "vân vân", "v.v.": "vân vân", "HĐQT": "Hội đồng quản trị", "v/v": "về việc",
    "X4": "X bốn", "KNL": "Khung năng lực", "NV": "nhân viên", "GĐ": "Giám đốc",
    "PGĐ": "Phó Giám đốc", "TP": "Trưởng phòng", "PP": "Phó phòng", "CN": "Chi nhánh",
    "TT": "Trung tâm", "TP.HCM": "thành phố Hồ Chí Minh"
};

let speechInterval = null;

function normalizeText(text) {
    if (!text) return "";
    let p = text;
    // Xóa Markdown nhưng giữ lại dấu chấm câu để ngắt nghỉ
    p = p.replace(/#{1,6}\s?/g, " ").replace(/\*\*/g, "").replace(/\*/g, "")
         .replace(/^-{3,}/gm, " ").replace(/^[-*+]\s/gm, ". ");
    // Xóa ký tự đặc biệt gây treo engine
    p = p.replace(/["“”„‟«»‹›'‘’`_~]/g, "").replace(/[\(\)\[\]\{\}]/g, " ");
    // Đọc số câu/đáp án
    p = p.replace(/^([A-D])\.\s/gim, "Đáp án $1. ").replace(/^(\d+)\.\s/gim, "Câu $1. ");
    
    // Merge từ điển hệ thống và từ điển người dùng (nếu có)
    const userDict = JSON.parse(localStorage.getItem('user_voice_dict') || '{}');
    const fullDict = { ...VOICE_DICTIONARY, ...userDict };

    // Dictionary (Thoát chuỗi Regex và ưu tiên từ dài)
    const sortedKeys = Object.keys(fullDict).sort((a, b) => b.length - a.length);
    sortedKeys.forEach(k => {
        const escapedK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedK}\\b`, "gi");
        p = p.replace(regex, fullDict[k]);
    });
    return p.replace(/\s+/g, " ").trim();
}

const FontSizeManager = {
    scale: 100, // percentage

    init() {
        const saved = localStorage.getItem('haianh_font_scale');
        if (saved !== null) {
            this.scale = parseInt(saved);
        }
        this.apply();
        this.initEvents();
    },

    initEvents() {
        const toggleBtn = document.getElementById('settingsToggleBtn');
        const dropdown = document.getElementById('settingsDropdown');
        const slider = document.getElementById('fontSizeSlider');
        
        toggleBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const isShowing = dropdown?.classList.toggle('show');
            toggleBtn.classList.toggle('active', isShowing);
        });

        slider?.addEventListener('input', (e) => {
            this.scale = parseInt(e.target.value);
            this.apply();
            localStorage.setItem('haianh_font_scale', this.scale);
        });

        const hintToggle = document.getElementById('hintToggle');
        if (hintToggle) {
            hintToggle.checked = hintEnabled;
            hintToggle.addEventListener('change', (e) => {
                hintEnabled = e.target.checked;
                localStorage.setItem('haianh_hint_enabled', hintEnabled);
                this.applyHintVisibility();
            });
        }

        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target) && !toggleBtn?.contains(e.target)) {
                dropdown.classList.remove('show');
                toggleBtn?.classList.remove('active');
            }
        });
    },

    apply() {
        const decimal = this.scale / 100;
        document.documentElement.style.setProperty('--font-scale', decimal);
        document.body.style.setProperty('--font-scale', decimal);
        
        const valDisplay = document.getElementById('fontSizeVal');
        const slider = document.getElementById('fontSizeSlider');

        if (valDisplay) valDisplay.innerText = `${this.scale}%`;
        if (slider) slider.value = this.scale;
    },

    applyHintVisibility() {
        document.querySelectorAll('.hint-btn').forEach(btn => {
            if (hintEnabled) btn.classList.remove('hidden');
            else btn.classList.add('hidden');
        });
    }
};

function toggleReviewPanel(show) {
    const card = document.getElementById('reviewDashboardCard');
    const overlay = document.getElementById('sidePanelOverlay');
    if (card && overlay) {
        if (show) {
            card.classList.remove('translate-x-full');
            overlay.classList.remove('hidden');
        } else {
            card.classList.add('translate-x-full');
            overlay.classList.add('hidden');
        }
    }
}

const ReviewManager = {
    stats: {},

    init() {
        const saved = localStorage.getItem('haianh_review_stats');
        if (saved) {
            this.stats = JSON.parse(saved);
        }
        this.updateDashboardUI();
    },

    saveLocal() {
        localStorage.setItem('haianh_review_stats', JSON.stringify(this.stats));
    },

    save() {
        this.saveLocal();
        
        // Lưu Cloud nếu đã đăng nhập
        if (AuthManager.user && AuthManager.db) {
            AuthManager.db.collection('users').doc(AuthManager.user.uid)
                .collection('data').doc('review_stats').set(this.stats)
                .catch(e => console.error("Review Cloud Save Error:", e));
        }
    },

    getQId(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return "q_" + Math.abs(hash).toString(16);
    },

    // quality: 0 (sai) hoặc 5 (đúng) - Đơn giản hóa cho trắc nghiệm
    update(qText, isCorrect) {
        const id = this.getQId(qText);
        const quality = isCorrect ? 5 : 0;
        
        let item = this.stats[id] || {
            reps: 0,
            interval: 0,
            ease: 2.5,
            nextDate: Date.now()
        };

        if (quality >= 3) {
            if (item.reps === 0) item.interval = 1;
            else if (item.reps === 1) item.interval = 6;
            else item.interval = Math.round(item.interval * item.ease);
            item.reps++;
        } else {
            item.reps = 0;
            item.interval = 1;
        }

        item.ease = Math.max(1.3, item.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
        item.nextDate = Date.now() + item.interval * 24 * 60 * 60 * 1000;
        
        this.stats[id] = item;
        this.save();
        this.updateDashboardUI();
    },

    getDueCount() {
        const now = Date.now();
        return Object.values(this.stats).filter(item => item.nextDate <= now).length;
    },

    getLearningCount() {
        return Object.values(this.stats).filter(item => item.reps > 0 && item.reps < 5).length;
    },

    getMasteredCount() {
        return Object.values(this.stats).filter(item => item.reps >= 5).length;
    },

    updateDashboardUI() {
        const dueCount = this.getDueCount();
        const learningCount = this.getLearningCount();
        const masteredCount = this.getMasteredCount();
        const total = dueCount + learningCount + masteredCount;

        // Cập nhật con số
        const elDue = document.getElementById('reviewDueCount');
        const elLearn = document.getElementById('reviewLearningCount');
        const elMaster = document.getElementById('reviewMasteredCount');
        if (elDue) elDue.innerText = dueCount;
        if (elLearn) elLearn.innerText = learningCount;
        if (elMaster) elMaster.innerText = masteredCount;

        // Cập nhật Thanh Progress Bar
        const barDue = document.getElementById('barDue');
        const barLearning = document.getElementById('barLearning');
        const barMastered = document.getElementById('barMastered');
        const masteryPercentEl = document.getElementById('masteryPercent');
        
        if (total > 0 && barDue) {
            barDue.style.width = (dueCount / total * 100) + '%';
            barLearning.style.width = (learningCount / total * 100) + '%';
            barMastered.style.width = (masteredCount / total * 100) + '%';
            
            if (masteryPercentEl) {
                const percent = Math.round((masteredCount / total) * 100);
                masteryPercentEl.innerText = percent + '%';
            }
        }

        // Cập nhật Badge trên Header
        const badge = document.getElementById('reviewBadge');
        if (badge) {
            if (dueCount > 0) {
                badge.innerText = dueCount;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    }
};

const SpeechManager = {
    queue: [],
    currentIdx: 0,
    isPaused: false,
    rate: appSettings.defaultReadSpeed,
    activeQIdx: null,
    currentUtterance: null,
    pauseTimer: null,
    heartbeatInterval: null,
    sessionId: 0, 
    watchdogTimer: null,
    onEndCallback: null,

    speak(text, qIdx, onEnd = null) {
        if (!text) return;
        const sid = String(qIdx);
        if (this.activeQIdx === sid && sid !== 'voice-tutor') {
            if (this.isPaused) this.resume();
            else this.pause();
        } else {
            this.onEndCallback = onEnd;
            this.start(normalizeText(text), sid);
        }
    },

    init() {
        const savedRate = localStorage.getItem('voice_rate');
        if (savedRate) this.rate = parseFloat(savedRate);
    },

    setRate(newRate) {
        this.rate = newRate;
        localStorage.setItem('voice_rate', newRate);
    },

    chunkText(text) {
        const lines = text.split(/\n+/);
        let chunks = [];
        const maxLen = 150;

        lines.forEach(line => {
            let remaining = line.trim();
            if (!remaining) return;

            while (remaining.length > 0) {
                if (remaining.length <= maxLen) {
                    chunks.push(remaining + " [break]"); 
                    break;
                }
                let splitIdx = -1;
                // Ưu tiên ngắt mạnh (. ! ? ;)
                const strongDelims = [". ", "? ", "! ", "; "];
                for (let d of strongDelims) {
                    const last = remaining.lastIndexOf(d, maxLen);
                    if (last > splitIdx) splitIdx = last + d.length;
                }
                
                // Nếu có dấu phẩy, ngắt tại dấu phẩy để kiểm soát thời gian nghỉ 500ms
                if (splitIdx <= 0) {
                    const commaIdx = remaining.lastIndexOf(", ", maxLen);
                    if (commaIdx > 0) {
                        chunks.push(remaining.substring(0, commaIdx + 1).trim() + " [break]");
                        remaining = remaining.substring(commaIdx + 1).trim();
                        continue;
                    }
                }

                if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(" ", maxLen);
                if (splitIdx <= 0) splitIdx = maxLen;
                
                const segment = remaining.substring(0, splitIdx).trim();
                // Nếu kết thúc đoạn bằng dấu phẩy hoặc chấm, coi như một điểm nghỉ
                const suffix = /[.,!?]$/.test(segment) ? " [break]" : "";
                chunks.push(segment + suffix);
                remaining = remaining.substring(splitIdx).trim();
            }
        });
        return chunks;
    },

    async start(text, qIdx) {
        this.stop();
        this.sessionId = Date.now();
        const currentSession = this.sessionId;

        window.speechSynthesis.cancel();
        await new Promise(r => setTimeout(r, 200));
        window.speechSynthesis.cancel();
        await new Promise(r => setTimeout(r, 250));

        if (this.sessionId !== currentSession) return;

        this.queue = this.chunkText(text);
        this.currentIdx = 0;
        this.activeQIdx = qIdx;
        this.isPaused = false;
        
        if (this.queue.length > 0) this.play(currentSession);
    },

    play(session) {
        if (session !== this.sessionId || this.currentIdx >= this.queue.length || this.isPaused) {
            if (this.currentIdx >= this.queue.length && session === this.sessionId) {
                const cb = this.onEndCallback;
                this.stop();
                if (cb) cb();
            }
            return;
        }

        if (this.watchdogTimer) clearTimeout(this.watchdogTimer);

        let chunk = this.queue[this.currentIdx];
        let hasBreak = chunk.includes("[break]");
        chunk = chunk.replace("[break]", "");

        const cleanChunk = normalizeText(chunk);
        if (!cleanChunk) {
            this.currentIdx++;
            this.play(session);
            return;
        }

        this.currentUtterance = new SpeechSynthesisUtterance(cleanChunk);
        if (vietnameseVoice) this.currentUtterance.voice = vietnameseVoice;
        this.currentUtterance.lang = 'vi-VN';
        this.currentUtterance.rate = this.rate;

        const next = () => {
            if (session !== this.sessionId) return;
            if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
            this.currentIdx++;
            // Ngắt dòng/Dấu phẩy nghỉ 500ms, ngược lại nghỉ 40ms
            const delay = hasBreak ? 500 : 40;
            setTimeout(() => this.play(session), delay);
        };

        this.currentUtterance.onend = next;
        this.currentUtterance.onerror = next;

        const expectedDuration = Math.max(4000, cleanChunk.length * 150); 
        this.watchdogTimer = setTimeout(() => {
            if (session === this.sessionId && !this.isPaused) next();
        }, expectedDuration);

        window.speechSynthesis.speak(this.currentUtterance);
        this.updateUI();

        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => {
            if (window.speechSynthesis.speaking && !this.isPaused && session === this.sessionId) {
                window.speechSynthesis.resume(); // Chỉ cần resume để kích hoạt lại buffer
            }
        }, 5000);
    },

    pause() {
        this.isPaused = true;
        window.speechSynthesis.cancel();
        if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.updateUI();
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.pauseTimer = setTimeout(() => { if (this.isPaused) this.stop(); }, 900000);
    },

    resume() {
        this.isPaused = false;
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.play(this.sessionId);
    },

    stop() {
        this.sessionId = 0; // Hủy mọi session đang chạy
        window.speechSynthesis.cancel();
        if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        if (this.pauseTimer) clearTimeout(this.pauseTimer);
        this.queue = [];
        this.currentIdx = 0;
        this.isPaused = false;
        this.activeQIdx = null;
        this.onEndCallback = null;
        this.updateUI();
    },

    updateUI() {
        document.querySelectorAll('.speak-toggle-btn').forEach(btn => {
            const qIdx = btn.dataset.qidx;
            const icon = btn.querySelector('i');
            if (!icon) return;
            if (this.activeQIdx == qIdx) {
                icon.className = this.isPaused ? 'fas fa-play' : 'fas fa-pause';
                btn.classList.add('bg-blue-600', 'text-white', 'animate-pulse');
            } else {
                icon.className = 'fas fa-volume-up';
                btn.classList.remove('bg-blue-600', 'text-white', 'animate-pulse');
            }
        });
    }
};

SpeechManager.init();

function normalizeText(text) {
    if (!text) return "";
    let p = text;
    // Xóa Markdown
    p = p.replace(/#{1,6}\s?/g, " ")
         .replace(/\*\*/g, "")
         .replace(/\*/g, "")
         .replace(/^-{3,}/gm, " ")
         .replace(/^[-*+]\s/gm, ". ");
    // Xóa ký tự đặc biệt gây treo engine
    p = p.replace(/["“”„‟«»‹›'‘’`_~]/g, " ")
         .replace(/[\(\)\[\]\{\}]/g, " ");
    // Đọc số câu/đáp án chuyên nghiệp
    p = p.replace(/^([A-D])\.\s/gim, "Đáp án $1. ")
         .replace(/^(\d+)\.\s/gim, "Câu $1. ");
    // Dictionary
    Object.keys(VOICE_DICTIONARY).forEach(k => {
        const regex = new RegExp(`\\b${k}\\b`, "gi");
        p = p.replace(regex, VOICE_DICTIONARY[k]);
    });
    // Làm sạch khoảng trắng và dấu câu
    p = p.replace(/,/g, " , ")
         .replace(/([.?!;])/g, "$1 ")
         .replace(/\s+/g, " ");
    return p.trim();
}

function initVoice() {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    vietnameseVoice = voices.find(v => v.lang.includes('vi-VN') && v.name.includes('Google')) ||
                      voices.find(v => v.lang.includes('vi')) ||
                      voices.find(v => v.name.toLowerCase().includes('vietnam'));
}

if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = initVoice;
}
initVoice();

function speak(text, qIdx) {
    SpeechManager.speak(text, qIdx);
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

function saveProgressToLocal() {
    ProgressManager.save();
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
        const voiceOptBtn = `<button class="speak-toggle-btn flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors ml-auto" data-qidx="${idx}-opt-${optIdx}" title="Nghe đáp án">
            <i class="fas fa-volume-up text-xs"></i>
        </button>`;
        optionsHtml += `<label class="flex items-center gap-3 p-3 rounded-xl border ${extraClass} hover:bg-gray-50 transition cursor-pointer mb-2">
            <input type="${inputType}" name="q${idx}" value="${optIdx}" ${isChecked ? "checked" : ""} ${isSubmitted ? "disabled" : ""} class="option-input flex-shrink-0" data-qidx="${idx}" data-optidx="${optIdx}">
            <span class="text-gray-700 text-sm flex-1 leading-snug">${escapeHtml(opt)}</span>
            ${badge ? '<span class="flex-shrink-0 text-green-600 text-[10px] font-bold bg-white px-2 py-0.5 rounded-full border border-green-100 mr-1">✓ Đúng</span>' : ''}
            ${voiceOptBtn}
        </label>`;
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
                ${[0.8, 1.0, 1.2, 1.5, 2.0].map(r => `<div class="speed-opt px-2 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-900 cursor-pointer text-[10px] text-center text-gray-800 dark:text-gray-200 ${SpeechManager.rate === r ? 'text-blue-600 font-bold bg-blue-50 dark:bg-blue-900' : ''}" data-rate="${r}" data-qidx="${idx}-q">${r.toFixed(1)}x</div>`).join('')}
            </div>
        </div>
    </div>`;

    const feedback = isSubmitted ? (isCorrect ? `<div class="mt-3 text-sm text-green-700 bg-green-50 p-2 rounded-lg"><i class="fas fa-check-circle"></i> Chính xác!</div>` : `<div class="mt-3 text-sm bg-amber-50 p-2 rounded-lg text-amber-800"><i class="fas fa-info-circle"></i> Đáp án đúng: ${correctIndices.map(i => q.options[i]).join('; ')}</div>`) : "";
    
    // Hiển thị nút dựa trên cài đặt
    const aiExplainBtn = appSettings.showAiExplain ? `<button class="ai-explain-btn text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg border border-purple-200 transition" data-qidx="${idx}"><i class="fas fa-magic"></i> Giải thích AI</button>` : "";
    const aiCallBtn = appSettings.showAiCall ? `<button class="ai-call-btn text-xs px-3 py-1.5 rounded-lg border transition font-bold" data-qidx="${idx}"><i class="fas fa-phone"></i> Gọi Gia sư AI</button>` : "";
    
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
                </div>
                <button class="flag-btn w-8 h-8 flex items-center justify-center rounded-lg transition-all border-2 ${isFlagged ? 'border-orange-500 text-orange-500' : 'border-gray-200 dark:border-slate-700 text-gray-400 dark:text-gray-500'} bg-transparent" data-qidx="${idx}">
                    <i class="${isFlagged ? 'fas' : 'far'} fa-bookmark text-xs"></i>
                </button>
            </div>
        </div>
        
        <div class="mb-5">
            <h3 id="q-text-${idx}" class="q-text-focus leading-relaxed mb-4">${getHighlightedText(q.text, rawSearch)}</h3>
            <div class="space-y-2">${optionsHtml}</div>
        </div>
        <div class="flex items-center gap-3 mt-5 pt-4 border-t border-gray-50 dark:border-slate-800">
            ${aiExplainBtn}
            ${aiCallBtn}
            <button class="hint-btn text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 transition font-medium ${hintEnabled ? '' : 'hidden'}" data-qidx="${idx}"><i class="fas fa-lightbulb"></i> Gợi ý</button>
        </div>
        ${feedback}${aiExplainBox}
    </div>`;
}

// ======================== VOICE TUTOR (STT + TTS + GEMINI) ========================
class SpeechToTextManager {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.isStarting = false;
        this.safeStartTimer = null; // Quản lý timer khởi động lại
        this.onResult = null;
        this.onEnd = null;
    }

    static isSupported() {
        return !!(window.webkitSpeechRecognition || window.SpeechRecognition);
    }

    initRecognition() {
        const SpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
        if (!SpeechRecognition) return null;
        
        const recognition = new SpeechRecognition();
        recognition.lang = 'vi-VN';
        recognition.continuous = false; // Chuyển sang false để kiểm soát vòng lặp thủ công tốt hơn
        recognition.interimResults = true;
        
        recognition.onresult = (e) => {
            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = e.resultIndex; i < e.results.length; ++i) {
                if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
                else interimTranscript += e.results[i][0].transcript;
            }
            const transcript = finalTranscript || interimTranscript;
            if (this.onResult) this.onResult(transcript, !!finalTranscript);
        };

        recognition.onstart = () => { 
            this.isListening = true; 
            this.isStarting = false;
        };

        recognition.onend = () => { 
            this.isListening = false; 
            this.isStarting = false;
            if (this.onEnd) this.onEnd();
            
            // Tự động khởi động lại bền bỉ trong chế độ LIVE
            if (window.VoiceTutor && VoiceTutor.isLiveMode && VoiceTutor.isCalling) {
                this.safeStart();
            }
        };

        recognition.onerror = (e) => {
            this.isStarting = false;
            if (e.error === 'no-speech') return; 
            console.error("STT Error:", e.error);
        };
        return recognition;
    }

    safeStart() {
        if (this.isListening || this.isStarting) return;
        this.isStarting = true;
        
        // Đảm bảo dọn dẹp recognition cũ nếu còn tồn tại
        if (this.recognition) {
            try { this.recognition.onend = null; this.recognition.stop(); } catch(e) {}
            this.recognition = null;
        }

        this.safeStartTimer = setTimeout(() => {
            if (window.VoiceTutor && !VoiceTutor.isCalling) {
                this.isStarting = false;
                return;
            }
            try {
                this.recognition = this.initRecognition();
                if (this.recognition) {
                    this.recognition.start();
                    console.log("STT: Microphone restarted successfully.");
                }
            } catch (err) {
                console.error("STT SafeStart Failed:", err);
                this.isStarting = false;
                this.isListening = false;
            }
        }, 400);
    }

    start() {
        this.safeStart();
    }

    stop() {
        this.isStarting = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch(e) {}
            this.recognition = null;
        }
        this.isListening = false;
    }
}

const VoiceTutor = {
    stt: new SpeechToTextManager(),
    activeQIdx: null,
    isCalling: false,
    isLiveMode: false,
    lastTranscript: '',
    silenceTimer: null,
    aiSpeakStartTime: 0,
    isProcessing: false,
    chatHistory: [],
    currentRequestId: 0,

    init() {
        this.stt.onEnd = () => {
            if (this.isCalling && this.isLiveMode && !window.speechSynthesis.speaking && !this.isProcessing) {
                this.stt.start();
            }
        };
    },

    async startCall(qIdx) {
        if (!localStorage.getItem('gemini_api_key')) { showToast("Vui lòng cài đặt API Key để dùng tính năng này."); return; }
        
        // 1. Reset trạng thái hoàn toàn
        this.isCalling = true;
        this.activeQIdx = qIdx;
        this.lastTranscript = '';
        this.chatHistory = []; // Reset lịch sử khi bắt đầu cuộc gọi mới
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        
        SpeechManager.stop(); // Ngắt các âm thanh đang phát khác
        this.stt.stop();      // Ngắt Microphone cũ nếu có
        
        const modal = document.getElementById('voiceCallModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        
        // Cưỡng bức hiện khung chat ngay lập tức
        const chatInput = document.getElementById('voiceInputContainer');
        if (chatInput) chatInput.classList.remove('hidden');
        
        // 2. Gán sự kiện nút Copy & Chat Text
        const copyBtn = document.getElementById('copyVoiceTranscriptBtn');
        if (copyBtn) {
            copyBtn.onclick = () => {
                const text = document.getElementById('voiceTranscript').innerText;
                navigator.clipboard.writeText(text).then(() => showToast("✅ Đã sao chép nội dung!")).catch(() => showToast("❌ Không thể sao chép"));
            };
        }

        const sendBtn = document.getElementById('sendVoiceTextBtn');
        const textInput = document.getElementById('voiceTextInput');
        if (sendBtn && textInput) {
            sendBtn.onclick = () => this.handleTextSubmit();
            textInput.onkeypress = (e) => { if (e.key === 'Enter') this.handleTextSubmit(); };
        }

        // Luôn xóa nội dung cũ
        document.getElementById('voiceTranscript').innerText = "Đang kết nối...";
        document.getElementById('voiceTextInput').value = "";
        
        // Hiện ô nhập liệu văn bản ngay khi bắt đầu cuộc gọi
        const inputContainer = document.getElementById('voiceInputContainer');
        inputContainer?.classList.remove('hidden');

        const greeting = 'Tôi đang nghe đây. Bạn cần tôi hỗ trợ gì về câu hỏi số ' + (qIdx + 1) + '?';
        this.updateUI('speaking', greeting);
        
        // Chờ 1 chút để UI modal hiện ra mượt mà rồi mới nói
        setTimeout(() => {
            SpeechManager.speak(greeting, 'voice-tutor', () => {
                if (this.isCalling) this.startListening();
            });
        }, 300);
    },


    updateUI(state, text = "") {
        const badge = document.getElementById('voiceStatusBadge');
        const transcript = document.getElementById('voiceTranscript');
        const avatar = document.getElementById('aiAvatar');
        const wave = document.getElementById('aiWaveform');
        const pulse = document.getElementById('userMicPulse');

        if (text) {
            transcript.innerText = text;
            const container = transcript.parentElement;
            if (container) {
                setTimeout(() => {
                    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
                }, 100);
            }
        }

        badge.className = 'voice-status-badge text-[10px] font-medium';
        if (wave) wave.classList.add('hidden');
        if (pulse) pulse.classList.add('hidden');
        if (avatar) avatar.classList.remove('speaking');

        if (state === 'listening') {
            badge.innerText = 'Đang lắng nghe...';
            badge.classList.add('text-indigo-500');
            if (pulse) pulse.classList.remove('hidden');
        } else if (state === 'speaking') {
            badge.innerText = 'Gia sư đang nói...';
            badge.classList.add('voice-status-speaking');
            if (wave) wave.classList.remove('hidden');
            if (avatar) avatar.classList.add('speaking');
        } else if (state === 'thinking') {
            badge.innerText = 'Đang suy nghĩ...';
            badge.classList.add('voice-status-thinking');
        }
    },

    handleTextSubmit() {
        const input = document.getElementById('voiceTextInput');
        const text = input.value.trim();
        if (text && this.isCalling) {
            // Ngắt AI ngay lập tức nếu đang nói hoặc đang xử lý câu cũ
            SpeechManager.stop();
            this.stt.stop();
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            if (this.safetyTimer) clearTimeout(this.safetyTimer);
            
            // Giải phóng isProcessing để ưu tiên tin nhắn mới nhất
            this.isProcessing = false;
            
            input.value = '';
            this.updateUI('listening', text); 
            this.askGemini(text);
        }
    },

    async unlockMicrophone() {
        try {
            showLoading(true, "Đang yêu cầu quyền Micro...");
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            showLoading(false);
            showToast("✅ Đã cấp quyền Micro thành công! Bây giờ bạn có thể dùng Voice Chat.");
            return true;
        } catch (err) {
            showLoading(false);
            showToast("❌ Lỗi Micro: " + err.message);
            return false;
        }
    },

    startListening() {
        if (!this.isCalling) return;
        
        console.log("VoiceTutor: startListening() called.");
        if (!SpeechToTextManager.isSupported()) {
            this.updateUI('speaking', 'Trình duyệt không hỗ trợ nhận diện giọng nói.');
            return;
        }

        // Hiện khung chat khi người dùng tương tác với mic
        const chatInput = document.getElementById('voiceInputContainer');
        if (chatInput) chatInput.classList.remove('hidden');

        this.updateUI('listening', this.isLiveMode ? 'Đang lắng nghe rảnh tay...' : 'Hãy nói đi, tôi đang nghe...');
        
        this.stt.onResult = (text, isFinal) => {
            if (!text || this.isProcessing) return; // Bỏ qua nếu đang xử lý câu trả lời cũ
            this.updateUI('listening', text); 
            this.lastTranscript = text;

            if (this.isLiveMode) {
                // BARGE-IN: Nếu AI đang nói, cho phép ngắt lời
                if (window.speechSynthesis.speaking) {
                    const timeSpeaking = Date.now() - this.aiSpeakStartTime;
                    if (timeSpeaking > 500 && text.trim().split(/\s+/).length >= 2) {
                        console.log("Barge-in: Interrupting AI...");
                        SpeechManager.stop();
                        this.aiSpeakStartTime = 0; 
                        this.updateUI('listening', text);
                    }
                    return; 
                }

                if (this.silenceTimer) clearTimeout(this.silenceTimer);
                this.silenceTimer = setTimeout(() => {
                    if (this.lastTranscript.trim().length > 1 && !window.speechSynthesis.speaking && !this.isProcessing) {
                        this.askGemini(this.lastTranscript);
                    }
                }, 1100);
            }
        };
        
        this.stt.start();
    },

    stopListeningAndSubmit() {
        if (!this.isCalling || this.isLiveMode) return;
        
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        const finalContent = this.lastTranscript;
        
        this.stt.stop();
        if (finalContent.trim().length > 1) {
            this.askGemini(finalContent);
        } else {
            this.updateUI('listening', 'Bạn chưa nói gì cả...');
        }
        this.lastTranscript = '';
    },

    toggleLiveMode() {
        this.isLiveMode = !this.isLiveMode;
        const btn = document.getElementById('liveModeToggle');
        if (!btn) return;

        if (this.isLiveMode) {
            btn.classList.add('active');
            btn.innerHTML = '<div class="w-2 h-2 rounded-full bg-indigo-500 status-dot"></div> LIVE MODE: ON';
            showToast("🚀 Đã bật Chế độ Live (Tự động đàm thoại)");
            this.startListening();
        } else {
            btn.classList.remove('active');
            btn.innerHTML = '<div class="w-2 h-2 rounded-full bg-gray-300 status-dot"></div> LIVE MODE: OFF';
            showToast("✋ Đã tắt Chế độ Live. Hãy nhấn giữ Mic để nói.");
            this.stt.stop();
        }
    },

    async askGemini(userText) {
        if (!this.isCalling) return;
        
        // Tạo ID mới cho yêu cầu này
        const requestId = ++this.currentRequestId;
        this.isProcessing = true;
        this.updateUI('thinking', 'Đang phân tích...');
        
        // Dừng STT và TTS cũ ngay lập tức
        this.stt.stop();
        SpeechManager.stop();
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        if (this.safetyTimer) clearTimeout(this.safetyTimer);

        // Safety: Tự động giải phóng sau 15s nếu kẹt (phòng lỗi TTS/API)
        this.safetyTimer = setTimeout(() => {
            if (this.isProcessing && requestId === this.currentRequestId) {
                console.warn("VoiceTutor: Safety timer triggered. Resetting isProcessing.");
                this.isProcessing = false;
            }
        }, 15000);

        try {
            const q = currentQuestions[this.activeQIdx];
            
            // 1. Cập nhật lịch sử với tin nhắn mới của người dùng
            this.chatHistory.push({ role: "user", parts: [{ text: userText }] });
            
            // 2. Giới hạn lịch sử (chỉ giữ 10 lượt gần nhất để tối ưu)
            if (this.chatHistory.length > 10) this.chatHistory = this.chatHistory.slice(-10);

            // 3. Xây dựng System Instruction kèm ngữ cảnh câu hỏi
            const contextPrompt = `Bạn là gia sư AI Hai Anh. Hãy hỗ trợ học sinh học tập.
            Bối cảnh câu hỏi hiện tại:
            - Nội dung: ${q.text}
            - Đáp án đúng: ${q.correctIndices.map(i => String.fromCharCode(65 + i)).join(", ")}
            
            Yêu cầu quan trọng: 
            1. PHẢN HỒI THEO YÊU CẦU: Nếu người dùng yêu cầu giải thích chi tiết, chuyên sâu hoặc dài, hãy đáp ứng chính xác. Nếu không yêu cầu gì đặc biệt, hãy giải thích đầy đủ nhưng súc tích.
            2. Xưng hô là "tôi" và "bạn". 
            3. ĐI THẲNG VÀO VẤN ĐỀ: Không chào hỏi lặp lại, không rườm rà.
            4. CHỐNG ẢO GIÁC: Tuyệt đối không bịa đặt thông tin.`;

            const payload = { 
                contents: [
                    { role: "user", parts: [{ text: contextPrompt }] },
                    { role: "model", parts: [{ text: "Tôi đã hiểu. Tôi sẽ giải thích dựa trên độ dài mà bạn yêu cầu." }] },
                    ...this.chatHistory 
                ], 
                generationConfig: { 
                    temperature: 0.7,
                    maxOutputTokens: 4096 // Tăng giới hạn để hỗ trợ bài viết dài
                } 
            };
            
            const data = await callAiProxy({ provider: 'google', model: 'gemini-1.5-flash', payload });
            const response = data.candidates[0].content.parts[0].text;
            
            // KIỂM TRA: Nếu có yêu cầu mới hơn (Barge-in), bỏ qua kết quả này
            if (requestId !== this.currentRequestId || !this.isCalling) {
                return;
            }

            // 4. Lưu câu trả lời của AI vào lịch sử
            this.chatHistory.push({ role: "model", parts: [{ text: response }] });
            
            if (!this.isCalling) {
                this.isProcessing = false;
                return;
            }

            this.updateUI('speaking', response);
            this.aiSpeakStartTime = Date.now();
            
            SpeechManager.speak(response, 'voice-tutor', () => {
                // Chỉ giải phóng và restart nếu đây vẫn là yêu cầu cuối cùng
                if (requestId === this.currentRequestId) {
                    if (this.safetyTimer) clearTimeout(this.safetyTimer);
                    this.isProcessing = false;
                    console.log("VoiceTutor: AI finished speaking.");
                    if (this.isCalling && this.isLiveMode) {
                        this.lastTranscript = '';
                        this.startListening();
                    }
                }
            });
        } catch (err) {
            if (requestId !== this.currentRequestId) return;
            console.error("Voice Gemini Error:", err);
            this.isProcessing = false;
            this.updateUI('listening', "Lỗi kết nối. Bạn hãy thử nhắn lại nhé.");
        }
    },

    endCall() {
        console.log("VoiceTutor: Ending call and performing hard reset...");
        this.isCalling = false;
        
        // 1. Dọn dẹp STT
        if (this.stt.safeStartTimer) clearTimeout(this.stt.safeStartTimer);
        this.stt.stop();
        
        // 2. Dọn dẹp TTS
        SpeechManager.stop();
        
        // 3. Dọn dẹp các bộ đệm nội bộ
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        
        // 5. UI Reset
        const modal = document.getElementById('voiceCallModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        
        document.getElementById('voiceTranscript').innerText = "Cuộc gọi đã kết thúc.";
        this.lastTranscript = '';
        this.aiSpeakStartTime = 0;
        this.isProcessing = false;
    }
};

// Khởi tạo VoiceTutor và gán vào window để debug
window.VoiceTutor = VoiceTutor;
VoiceTutor.init();

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
async function clearAllBanks() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readwrite'); const req = tx.objectStore(STORE_BANKS).clear(); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
async function getBankById(id) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_BANKS, 'readonly'); const req = tx.objectStore(STORE_BANKS).get(id); req.onsuccess = e => res(e.target.result); req.onerror = () => rej(req.error); }); }
async function saveHistory(bankId, bankName, totalQuestions, correctCount, wrongDetails, wrongQuestionsText) { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readwrite'); const req = tx.objectStore(STORE_HISTORY).add({ bankId, bankName, totalQuestions, correctCount, wrongCount: totalQuestions - correctCount, wrongDetails, wrongQuestionsText, date: new Date().toISOString(), timestamp: Date.now() }); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }
async function getAllHistory() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readonly'); const req = tx.objectStore(STORE_HISTORY).getAll(); req.onsuccess = e => res(e.target.result); req.onerror = () => rej(req.error); }); }
async function clearAllHistory() { await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE_HISTORY, 'readwrite'); const req = tx.objectStore(STORE_HISTORY).clear(); req.onsuccess = () => res(); req.onerror = () => rej(req.error); }); }

// ======================== DATA CENTER (BACKUP/RESTORE) ========================
async function exportAllData() {
    try {
        const banks = await getAllBanks();
        const history = await getAllHistory();
        const backupData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            banks: banks,
            history: history,
            settings: {
                apiKey: localStorage.getItem('gemini_api_key'),
                darkMode: localStorage.getItem('darkMode')
            }
        };
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HaiAnh_Backup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("✅ Đã xuất dữ liệu thành công!");
    } catch (err) {
        showToast("❌ Lỗi xuất dữ liệu: " + err.message);
    }
}

async function exportSingleBank(id) {
    if (!id) return;
    try {
        const bank = await getBankById(parseInt(id));
        if (!bank) throw new Error("Không tìm thấy bộ đề");
        const blob = new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Bank_${bank.name.replace(/\s+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast("✅ Đã xuất bộ đề!");
    } catch (err) {
        showToast("❌ Lỗi: " + err.message);
    }
}

async function importData(file) {
    if (!file) return;
    showLoading(true, "Đang nạp dữ liệu...");
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            await openDB();
            
            if (data.banks && Array.isArray(data.banks)) {
                const tx = db.transaction([STORE_BANKS, STORE_HISTORY], 'readwrite');
                const bankStore = tx.objectStore(STORE_BANKS);
                const historyStore = tx.objectStore(STORE_HISTORY);

                for (const b of data.banks) {
                    const cleanBank = { ...b };
                    delete cleanBank.id;
                    await new Promise((res, rej) => {
                        const req = bankStore.add(cleanBank);
                        req.onsuccess = res; req.onerror = rej;
                    });
                }
                if (data.history && Array.isArray(data.history)) {
                    for (const h of data.history) {
                        const cleanH = { ...h };
                        delete cleanH.id;
                        await new Promise((res, rej) => {
                            const req = historyStore.add(cleanH);
                            req.onsuccess = res; req.onerror = rej;
                        });
                    }
                }
                showToast("✅ Đã khôi phục toàn bộ dữ liệu!");
            } 
            else if (data.questions && data.name) {
                const cleanBank = { ...data };
                delete cleanBank.id;
                await saveBank(cleanBank.name, cleanBank.questions);
                showToast(`✅ Đã nạp bộ đề: ${cleanBank.name}`);
            } else {
                throw new Error("Định dạng file không hợp lệ");
            }

            await refreshBankDropdown();
            showLoading(false);
        } catch (err) {
            showLoading(false);
            showToast("❌ Lỗi nạp file: " + err.message);
        }
    };
    reader.onerror = () => { showLoading(false); showToast("❌ Lỗi đọc file"); };
    reader.readAsText(file);
}

// ======================== DOM CACHING & UTILS ========================
const loadingOverlay = document.getElementById('loadingOverlay'), loadingText = document.getElementById('loadingText');
const toastMsg = document.getElementById('toastMsg');
function showLoading(show, text = 'Đang xử lý...') { if (show) { if (loadingText) loadingText.innerText = text; if (loadingOverlay) loadingOverlay.style.display = 'flex'; } else if (loadingOverlay) loadingOverlay.style.display = 'none'; }
function showToast(msg, duration = 2500) { if (!toastMsg) return; toastMsg.innerHTML = msg; toastMsg.classList.remove('hidden'); if (window.toastTimeout) clearTimeout(window.toastTimeout); window.toastTimeout = setTimeout(() => toastMsg.classList.add('hidden'), duration); }
const customModal = document.getElementById('customModal'), customModalText = document.getElementById('customModalText'), customModalInput = document.getElementById('customModalInput'), customModalCancel = document.getElementById('customModalCancel'), customModalConfirm = document.getElementById('customModalConfirm');
function showConfirm(msg, callback, isInput = false) { 
    if (!customModalText) return; 
    customModalText.innerText = msg; 
    if (isInput) {
        customModalInput.classList.remove('hidden');
        customModalInput.value = '';
        customModalInput.placeholder = "Nhập yêu cầu tại đây...";
    } else {
        customModalInput.classList.add('hidden');
    }
    customModal.classList.remove('hidden'); 
    customModal.classList.add('flex'); 
    if (isInput) {
        setTimeout(() => customModalInput.focus(), 100);
    }
    customModalConfirm.onclick = () => { 
        const val = isInput ? customModalInput.value.trim() : null;
        customModal.classList.add('hidden'); 
        customModal.classList.remove('flex'); 
        callback(true, val); 
    }; 
    customModalCancel.onclick = () => { 
        customModal.classList.add('hidden'); 
        customModal.classList.remove('flex'); 
        callback(false); 
    }; 
}
function showPrompt(msg, defaultVal, callback) { if (!customModalText) return; customModalText.innerText = msg; customModalInput.value = defaultVal || ''; customModalInput.classList.remove('hidden'); customModal.classList.remove('hidden'); customModal.classList.add('flex'); customModalInput.focus(); customModalConfirm.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(customModalInput.value); }; customModalCancel.onclick = () => { customModal.classList.add('hidden'); customModal.classList.remove('flex'); callback(null); }; }

function initDarkMode() { 
    const isDark = localStorage.getItem('darkMode') === 'true'; 
    if (isDark) document.body.classList.add('dark'); 
    
    const darkModeToggle = document.getElementById('darkModeToggle'); 
    if (darkModeToggle) {
        darkModeToggle.onclick = () => {
            document.body.classList.toggle('dark');
            const dark = document.body.classList.contains('dark');
            localStorage.setItem('darkMode', dark);
            updateDarkModeUI();
        };
    }
    updateDarkModeUI();
}

function updateDarkModeUI() {
    const isDark = document.body.classList.contains('dark');
    const darkModeText = document.getElementById('darkModeText');
    if (darkModeText) darkModeText.innerText = isDark ? 'Chuyển sang: Sáng' : 'Chuyển sang: Tối';
}

// ======================== API SETTINGS ========================
function getApiKey() { return localStorage.getItem('gemini_api_key') || ""; }
function updateApiKeyBadge() { 
    const badge = document.getElementById('apiKeyBadge'); 
    if (!badge) return; 
    if (getApiKey()) { 
        badge.className = 'w-2 h-2 rounded-full bg-green-500'; 
        badge.title = 'API Key đã được lưu'; 
    } else { 
        badge.className = 'w-2 h-2 rounded-full bg-red-500'; 
        badge.title = 'Chưa có API Key'; 
    } 
}
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
    const baseModels = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-001',
        'gemini-1.5-flash-002',
        'gemini-1.5-flash-8b',
        'gemini-2.0-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-exp-1206',
        'gemini-1.5-pro-002',
        'learnlm-1.5-pro-experimental'
    ];
    
    const discovered = JSON.parse(localStorage.getItem('haianh_discovered_models') || '[]');
    
    // Thuật toán sắp xếp thông minh:
    // 1. Lấy danh sách cứng làm nòng cốt
    // 2. Thêm các model khám phá được mà không nằm trong danh sách cứng vào cuối
    const otherDiscovered = discovered.filter(m => !baseModels.includes(m));
    const allAvailable = [...baseModels, ...otherDiscovered];

    // Ưu tiên cao nhất: 1. Model người dùng chọn -> 2. Danh sách đã sắp xếp
    const userSelectedModel = localStorage.getItem('last_working_model');
    const modelsToTry = userSelectedModel && allAvailable.includes(userSelectedModel) 
        ? [userSelectedModel, ...allAvailable.filter(m => m !== userSelectedModel)]
        : allAvailable;
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

async function discoverModels() {
    const apiKey = getApiKey();
    if (!apiKey) return;
    try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
        const data = await res.json();
        if (data.models) {
            // Lọc các model hỗ trợ generateContent
            const activeModels = data.models
                .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                .map(m => m.name.replace('models/', ''));
            
            if (activeModels.length > 0) {
                const oldDiscovered = JSON.parse(localStorage.getItem('haianh_discovered_models') || '[]');
                localStorage.setItem('haianh_discovered_models', JSON.stringify(activeModels));
                updateModelDropdownUI(activeModels);
                
                // Nếu có model mới hoàn toàn so với trước đây
                if (activeModels.some(m => !oldDiscovered.includes(m))) {
                    showSettingsBadge(true);
                }
            }
        }
    } catch (e) { console.warn("Dynamic Discovery: Không thể kết nối API danh sách model."); }
}

function showSettingsBadge(show) {
    const btn = document.getElementById('settingsToggleBtn');
    if (!btn) return;
    let badge = btn.querySelector('.new-model-badge');
    if (show) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'new-model-badge absolute -top-1 -right-1 w-3 h-3 bg-red-500 border-2 border-white dark:border-slate-900 rounded-full animate-pulse';
            btn.appendChild(badge);
        }
    } else if (badge) {
        badge.remove();
    }
}

function updateModelDropdownUI(models) {
    const select = document.getElementById('aiModelSelect');
    if (!select) return;
    
    const currentVal = select.value;
    select.innerHTML = '';
    
    // Tạo nhóm "Khám phá từ API"
    const groupApi = document.createElement('optgroup');
    groupApi.label = "Đã cập nhật từ API (Mới nhất)";
    
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.text = m.replace('gemini-', '').toUpperCase();
        groupApi.appendChild(opt);
    });
    
    select.appendChild(groupApi);
    if (models.includes(currentVal)) select.value = currentVal;
}

async function checkAvailableModels() {
    const apiKey = getApiKey(); if (!apiKey) { showToast("❌ Hãy nhập và lưu API Key trước!"); return; }
    showLoading(true, "Đang quét các mô hình khả dụng...");
    try {
        await discoverModels();
        const discovered = JSON.parse(localStorage.getItem('haianh_discovered_models') || '[]');
        showLoading(false);
        if (discovered.length) {
            alert(`✅ Đã tìm thấy ${discovered.length} mô hình đang hoạt động!\n\nDanh sách đã được cập nhật vào mục Cài đặt.`);
        } else {
            alert("❌ Không tìm thấy mô hình nào hoặc API Key không hợp lệ.");
        }
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
            <div class="mb-3 pb-2 border-b border-purple-200 dark:border-slate-700 flex items-center justify-between gap-2 w-full relative z-20">
                <div class="flex items-center gap-1.5">
                    <button class="speak-toggle-btn w-8 h-8 flex items-center justify-center bg-transparent text-purple-700 dark:text-purple-400 rounded-lg hover:bg-purple-50 transition border border-purple-300 dark:border-purple-800" data-qidx="ai-${idx}" title="Nghe giải thích">
                        <i class="fas fa-volume-up text-base"></i>
                    </button>
                    <div class="relative speed-container">
                        <button class="speed-btn h-8 px-2 flex items-center gap-1 bg-transparent text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 transition text-xs font-bold border border-gray-300 dark:border-slate-700">
                            <span class="current-speed">${SpeechManager.rate.toFixed(1)}x</span>
                        </button>
                        <div class="speed-menu absolute top-full left-0 mt-1 w-16 bg-white dark:bg-slate-800 shadow-xl border border-gray-200 dark:border-slate-700 rounded-lg hidden z-[100] overflow-hidden">
                            ${[0.7, 0.9, 1.0, 1.2, 1.5, 2.0].map(r => `<div class="speed-opt px-2 py-1.5 hover:bg-purple-50 dark:hover:bg-purple-900 cursor-pointer text-xs text-center text-gray-800 dark:text-gray-200 ${SpeechManager.rate === r ? 'text-purple-600 font-bold' : ''}" data-rate="${r}" data-qidx="ai-${idx}">${r.toFixed(1)}x</div>`).join('')}
                        </div>
                    </div>
                    <button class="copy-ai-btn w-8 h-8 flex items-center justify-center bg-transparent text-blue-700 dark:text-blue-400 rounded-lg hover:bg-blue-50 transition border border-blue-300 dark:border-blue-800" data-qidx="ai-${idx}" title="Copy nội dung">
                        <i class="fas fa-copy text-base"></i>
                    </button>
                </div>
                <div class="flex items-center gap-1">
                    <button class="ai-length-btn text-[10px] font-bold px-2.5 py-1 rounded-md transition ${lengthMode === 'short' ? 'text-purple-800 border-2 border-purple-500 bg-purple-50' : 'text-gray-600 border border-gray-300 bg-white'}" data-qidx="${idx}" data-len="short">NGẮN</button>
                    <button class="ai-length-btn text-[10px] font-bold px-2.5 py-1 rounded-md transition ${lengthMode === 'normal' ? 'text-purple-800 border-2 border-purple-500 bg-purple-50' : 'text-gray-600 border border-gray-300 bg-white'}" data-qidx="${idx}" data-len="normal">VỪA</button>
                    <button class="ai-length-btn text-[10px] font-bold px-2.5 py-1 rounded-md transition ${lengthMode === 'long' ? 'text-purple-800 border-2 border-purple-500 bg-purple-50' : 'text-gray-600 border border-gray-300 bg-white'}" data-qidx="${idx}" data-len="long">DÀI</button>
                </div>
            </div>`;

        explainDiv.innerHTML = `
            <div class="font-bold text-purple-900 dark:text-purple-300 p-4 pb-0 flex items-center gap-2 text-sm">
                <i class="fas fa-robot text-lg"></i> AI Tutor Giải thích
            </div>
            <div class="p-4 pt-2 relative overflow-visible">
                ${toolbarHtml}
                <div class="ai-text-content leading-relaxed text-gray-800 dark:text-gray-200 text-sm md:text-base relative z-10">${formattedText}</div>
            </div>`;
        explainDiv.dataset.loaded = 'true';
    } catch (error) {
        explainDiv.innerHTML = `<span class="text-red-500 p-3 block"><i class="fas fa-exclamation-triangle"></i> Lỗi phân tích: ${error.message}</span>`;
    }
}

// ======================== APP CORE LOGIC ========================
function evaluateAll() { let correct = 0, details = []; for (let i = 0; i < currentQuestions.length; i++) { const res = checkAnswer(i); details.push({ index: i, correct: res.correct, correctIndices: res.correctAnswers, userIndices: res.userAnswers }); if (res.correct) correct++; } return { correctCount: correct, total: currentQuestions.length, details }; }

function normalizeHeaderText(text) {
    if (!text) return "";
    return removeAccents(String(text))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

const EXCEL_KEYWORDS = {
    question: ['cauhoi', 'noidung', 'question', 'ques', 'q', 'content', 'noidungcauhoi'],
    answer: ['dapan', 'answer', 'ans', 'a', 'key', 'result', 'dung', 'correct', 'dapandung', 'da'],
    type: ['loai', 'type', 'dang', 'loaicauhoi'],
    options: ['phuongan', 'luachon', 'option', 'choice', 'lua', 'phuong', 'traloi']
};

function detectExcelHeaders(rows) {
    let headerIdx = -1;
    let colMap = { question: -1, answer: -1, type: -1, options: [], allHeaders: [] };

    // --- GIAI ĐOẠN 1: KHỚP TỪ KHÓA NGUYÊN BẢN (STRICT) ---
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        const rowStr = row.map(c => String(c || "").trim().toLowerCase());
        const rowFullText = rowStr.join(" ");
        
        // Ưu tiên logic nguyên bản: Phải có cả "câu hỏi" (hoặc nội dung) và "đáp án" (hoặc đa, key)
        if ((rowFullText.includes("câu hỏi") || rowFullText.includes("nội dung")) && (rowFullText.includes("đáp án") || rowFullText.includes("đa") || rowFullText.includes("key"))) {
            headerIdx = i;
            colMap.allHeaders = row.map(c => String(c || "").trim());
            for (let j = 0; j < rowStr.length; j++) {
                const cell = rowStr[j];
                if (cell === "câu hỏi" || cell.includes("nội dung câu hỏi")) colMap.question = j;
                else if (cell === "đáp án" || cell.includes("trả lời")) colMap.answer = j;
                else if (cell.includes("loại câu hỏi") || cell === "loại" || cell === "type") colMap.type = j;
                else if (cell.includes("phương án") || cell.includes("lựa chọn") || cell.includes("option") || /^[a-f]$/.test(cell) || /^đáp án [a-f]$/.test(cell)) {
                    colMap.options.push(j);
                }
            }
            if (colMap.question !== -1 && colMap.answer !== -1) return { headerIdx, colMap };
        }
    }

    // --- GIAI ĐOẠN 2: KHỚP TỪ KHÓA CHUẨN HÓA (FUZZY) ---
    // (Nếu GĐ1 thất bại hoặc thiếu cột chính)
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
        const row = rows[i];
        if (!row) continue;
        const normalizedRow = row.map(c => normalizeHeaderText(c));
        const rowFullText = normalizedRow.join("");
        
        if (EXCEL_KEYWORDS.question.some(k => rowFullText.includes(k)) && EXCEL_KEYWORDS.answer.some(k => rowFullText.includes(k))) {
            headerIdx = i;
            colMap.allHeaders = row.map(c => String(c || "").trim());
            colMap.options = []; // Reset options để tìm theo kiểu fuzzy
            
            for (let j = 0; j < normalizedRow.length; j++) {
                const cell = normalizedRow[j];
                if (!cell) continue;
                if (EXCEL_KEYWORDS.question.some(k => cell === k || (cell.includes(k) && cell.length < k.length + 3))) colMap.question = j;
                else if (EXCEL_KEYWORDS.answer.some(k => cell === k || (cell.includes(k) && cell.length < k.length + 3))) colMap.answer = j;
                else if (EXCEL_KEYWORDS.type.some(k => cell === k)) colMap.type = j;
                else if (EXCEL_KEYWORDS.options.some(k => cell.includes(k)) || /^[a-f]$/.test(cell) || /^dapan[a-f]$/.test(cell)) {
                    colMap.options.push(j);
                }
            }
            if (colMap.question !== -1 && colMap.answer !== -1) return { headerIdx, colMap };
        }
    }

    // --- GIAI ĐOẠN 3: PHÂN TÍCH CẤU TRÚC DỮ LIỆU (HEURISTICS) ---
    // Áp dụng khi không tìm thấy dòng tiêu đề rõ ràng
    const scanRows = rows.slice(0, 50).filter(r => r && r.length > 1);
    if (scanRows.length > 2) { // Cần ít nhất 3 dòng dữ liệu để phân tích
        const colCount = Math.max(...scanRows.map(r => r.length));
        const colStats = Array.from({ length: colCount }, () => ({ avgLen: 0, ansScore: 0, optScore: 0, emptyCount: 0 }));

        scanRows.forEach(row => {
            for (let j = 0; j < colCount; j++) {
                const val = String(row[j] || "").trim();
                if (!val) { colStats[j].emptyCount++; continue; }
                colStats[j].avgLen += val.length;
                // Điểm đáp án: ngắn, thường là A-F hoặc 1-6, hoặc chuỗi số/chữ cách nhau bởi dấu phẩy (1,2 hoặc A,B)
                if (/^[A-Fa-f1-6]([ ,;]+[A-Fa-f1-6])*$/.test(val)) colStats[j].ansScore++;
                // Điểm phương án: độ dài vừa phải
                if (val.length > 0 && val.length < 200) colStats[j].optScore++;
            }
        });

        colStats.forEach(s => s.avgLen /= scanRows.length);

        // Đoán cột Câu hỏi: Cột có độ dài trung bình lớn nhất (thường > 20 ký tự)
        let bestQ = -1, maxLen = 15; 
        colStats.forEach((s, idx) => { if (s.avgLen > maxLen) { maxLen = s.avgLen; bestQ = idx; } });

        // Đoán cột Đáp án: Cột có nhiều ký tự đơn nhất, không phải cột câu hỏi
        let bestA = -1, maxAns = scanRows.length * 0.4; // Ít nhất 40% dòng phải khớp định dạng đáp án
        colStats.forEach((s, idx) => { if (idx !== bestQ && s.ansScore > maxAns) { maxAns = s.ansScore; bestA = idx; } });

        if (bestQ !== -1 && bestA !== -1) {
            colMap.question = bestQ;
            colMap.answer = bestA;
            headerIdx = -1; 
            colMap.options = [];
            colStats.forEach((s, idx) => {
                if (idx !== bestQ && idx !== bestA && s.emptyCount < scanRows.length * 0.5) {
                    colMap.options.push(idx);
                }
            });
            // Nếu tìm thấy ít nhất 2 cột phương án thì tự tin tự động nạp
            if (colMap.options.length >= 2) return { headerIdx, colMap };
        }
    }

    return { headerIdx: -1, colMap: { question: -1, answer: -1, type: -1, options: [] } };
}

function extractQuestionsFromRows(rows, colMap, headerIdx) {
    const qList = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[colMap.question]) continue;

        const qText = String(row[colMap.question]).trim();
        if (!qText) continue;

        let qType = 'single';
        if (colMap.type !== -1) {
            const typeRaw = String(row[colMap.type] || "").toUpperCase();
            if (typeRaw.includes('MC') || typeRaw.includes('MA')) qType = 'multiple';
        }

        const opts = [];
        colMap.options.forEach(colIdx => {
            const optVal = String(row[colIdx] || "").trim();
            if (optVal !== "") opts.push(optVal);
        });

        if (opts.length === 0) continue;

        let ansRaw = String(row[colMap.answer] || "").trim().toUpperCase();
        let ansIdx = [];
        const ansParts = ansRaw.split(/[,;|\s]+/).map(s => s.trim()).filter(s => s);
        
        ansParts.forEach(part => {
            if (/^\d+$/.test(part)) {
                const idx = parseInt(part) - 1;
                if (idx >= 0 && idx < opts.length) ansIdx.push(idx);
            } else if (/^[A-Z]$/.test(part)) {
                const idx = part.charCodeAt(0) - 65;
                if (idx >= 0 && idx < opts.length) ansIdx.push(idx);
            }
        });

        if (qType === 'single' && ansIdx.length > 1) qType = 'multiple';
        if (ansIdx.length === 0) continue;

        qList.push({ text: qText, options: opts, correctIndices: ansIdx, type: qType });
    }
    return qList;
}

function showExcelMappingModal(rows, fileName, sheetName) {
    return new Promise((resolve) => {
        const modal = document.getElementById('excelMappingModal');
        const previewArea = document.getElementById('excelPreviewTable');
        const selQuestion = document.getElementById('mapColQuestion');
        const selAnswer = document.getElementById('mapColAnswer');
        const selType = document.getElementById('mapColType');
        const optContainer = document.getElementById('mapColOptionsContainer');
        const confirmBtn = document.getElementById('confirmExcelMappingBtn');
        const cancelBtn = document.getElementById('cancelExcelMappingBtn');
        const closeBtn = document.getElementById('closeExcelMappingBtn');
        const modalDesc = modal?.querySelector('p.text-xs');

        if (!modal || !rows.length) return resolve(null);

        // Hiển thị thông tin file và sheet
        if (modalDesc) modalDesc.innerHTML = `File: <b>${fileName}</b> | Sheet: <span class="text-indigo-600 font-bold">${sheetName}</span><br>Vui lòng gán cột thủ công cho sheet này.`;

        // Xác định số cột thực tế (quét 5 dòng đầu)
        const maxCols = Math.max(...rows.slice(0, 5).map(r => r.length));
        const allColIndices = Array.from({ length: maxCols }, (_, i) => i);
        
        // Preview 3 dòng đầu
        let tableHtml = `<table class="min-w-full text-[10px] border"><thead><tr class="bg-gray-100">`;
        allColIndices.forEach(idx => tableHtml += `<th class="border p-1">Cột ${idx + 1}</th>`);
        tableHtml += `</tr></thead><tbody>`;
        rows.slice(0, 3).forEach(row => {
            tableHtml += `<tr>`;
            allColIndices.forEach(idx => tableHtml += `<td class="border p-1 truncate max-w-[100px]">${escapeHtml(row[idx] || "")}</td>`);
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table>`;
        previewArea.innerHTML = tableHtml;

        // Điền Dropdowns (Lấy text từ dòng đầu tiên làm gợi ý nếu có)
        const firstRow = rows[0] || [];
        const colOptions = allColIndices.map(idx => {
            const val = String(firstRow[idx] || "").trim();
            return `<option value="${idx}">Cột ${idx+1}${val ? `: ${val.substring(0,20)}` : ''}</option>`;
        }).join('');

        selQuestion.innerHTML = colOptions;
        selAnswer.innerHTML = colOptions;
        selType.innerHTML = `<option value="-1">-- Không có / Tự động --</option>` + colOptions;
        
        optContainer.innerHTML = allColIndices.map(idx => {
            const val = String(firstRow[idx] || "").trim();
            return `
                <label class="flex items-center gap-2 p-1 hover:bg-gray-100 dark:hover:bg-slate-700 rounded cursor-pointer text-xs">
                    <input type="checkbox" class="col-opt-check" value="${idx}">
                    <span class="truncate">Cột ${idx+1}${val ? `: ${val.substring(0,15)}` : ''}</span>
                </label>
            `;
        }).join('');

        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const cleanup = () => {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        };

        confirmBtn.onclick = () => {
            const colMap = {
                question: parseInt(selQuestion.value),
                answer: parseInt(selAnswer.value),
                type: parseInt(selType.value),
                options: Array.from(modal.querySelectorAll('.col-opt-check:checked')).map(cb => parseInt(cb.value))
            };
            if (colMap.options.length === 0) { showToast("Vui lòng chọn ít nhất 1 cột phương án!"); return; }
            cleanup();
            resolve({ colMap, headerIdx: 0 }); 
        };

        cancelBtn.onclick = closeBtn.onclick = () => { cleanup(); resolve(null); };
    });
}

async function uploadAndSaveFile(file) {
    showLoading(true, "Đang đọc file Excel...");
    try {
        const dataBuffer = await new Promise((res, rej) => {
            const reader = new FileReader();
            reader.onload = e => res(new Uint8Array(e.target.result));
            reader.onerror = rej;
            reader.readAsArrayBuffer(file);
        });

        const wb = XLSX.read(dataBuffer, { type: 'array' });
        let finalQuestions = [];

        for (const sheetName of wb.SheetNames) {
            const sheet = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
            if (!rows || rows.length < 2) continue;

            let { headerIdx, colMap } = detectExcelHeaders(rows);
            let parsed = [];

            // Thử trích xuất nếu đã tìm thấy cột chính
            if (colMap.question !== -1 && colMap.answer !== -1) {
                parsed = extractQuestionsFromRows(rows, colMap, headerIdx);
            }

            // Nếu không tìm thấy cột hoặc trích xuất ra 0 câu -> Hiện bảng thủ công
            if (parsed.length === 0) {
                showLoading(false);
                const manual = await showExcelMappingModal(rows, file.name, sheetName);
                if (manual) {
                    headerIdx = manual.headerIdx;
                    colMap = manual.colMap;
                    showLoading(true, `Đang xử lý Sheet "${sheetName}"...`);
                    parsed = extractQuestionsFromRows(rows, colMap, headerIdx);
                }
            }

            if (parsed.length > 0) {
                finalQuestions = finalQuestions.concat(parsed);
            }
        }

        showLoading(false);
        if (finalQuestions.length === 0) {
            showToast("❌ Không tìm thấy câu hỏi hợp lệ nào trong file.");
            return;
        }

        showPrompt(`Nạp thành công ${finalQuestions.length} câu từ tất cả các sheet. Nhập tên bộ đề:`, file.name.replace(/\.(xlsx|xls|csv)$/i, ''), async (name) => {
            if (!name) return;
            showLoading(true, "Đang lưu bộ đề...");
            try {
                await saveBank(name, finalQuestions);
                await refreshBankDropdown();
                const banks = await getAllBanks();
                await loadBankById(banks[banks.length - 1].id);
                showToast(`✅ Đã lưu bộ đề: ${name}`);
            } catch (err) {
                showToast("Lỗi: " + err.message);
            } finally {
                showLoading(false);
            }
        });
    } catch (err) {
        showLoading(false);
        showToast("❌ Lỗi: " + err.message);
    }
}

async function refreshBankDropdown() { const bankSelect = document.getElementById('bankSelect'); const banks = await getAllBanks(); if (bankSelect) { bankSelect.innerHTML = '<option value="">-- Chọn bộ câu hỏi --</option>'; banks.forEach(b => { const opt = document.createElement('option'); opt.value = b.id; opt.textContent = `${b.name} (${b.questions.length} câu)`; bankSelect.appendChild(opt); }); if (currentBankId) bankSelect.value = currentBankId; } }
async function loadBankById(id) { const bank = await getBankById(id); if (!bank) return false; masterQuestions = bank.questions; currentBankId = bank.id; currentBankName = bank.name; const currentBankInfo = document.getElementById('currentBankInfo'); if (currentBankInfo) currentBankInfo.innerText = `Đã tải: ${bank.name} (${bank.questions.length} câu)`; return true; }
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
function startTimer(seconds) { 
    stopTimer(); 
    timeRemainingSeconds = seconds; 
    updateTimerDisplay(); 
    timerInterval = setInterval(() => { 
        if (!examActive || isPaused || submitted) return; // Kiểm tra isPaused cực kỳ nghiêm ngặt
        if (timeRemainingSeconds <= 1) { 
            stopTimer(); 
            if (!submitted && currentQuestions.length) submitExam(); 
        } else { 
            timeRemainingSeconds--; 
            updateTimerDisplay(); 
            saveProgressToLocal(); 
        } 
    }, 1000); 
}
function pauseExam() { 
    if (!examActive || submitted) return; 
    isPaused = true; 
    stopTimer(); 
    const btns = [document.getElementById('pauseResumeBtn'), document.getElementById('pauseResumeBtnHeader')];
    btns.forEach(btn => { 
        if (btn) {
            if (btn.id === 'pauseResumeBtn') btn.innerHTML = '<i class="fas fa-play"></i> Tiếp tục';
            else btn.innerHTML = '<i class="fas fa-play"></i>';
        }
    });
    showToast("Đã tạm dừng."); 
    saveProgressToLocal(); 
}
function resumeExam() { 
    if (!examActive || submitted) return; 
    isPaused = false; 
    const btns = [document.getElementById('pauseResumeBtn'), document.getElementById('pauseResumeBtnHeader')];
    btns.forEach(btn => { 
        if (btn) {
            if (btn.id === 'pauseResumeBtn') btn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng';
            else btn.innerHTML = '<i class="fas fa-pause"></i>';
        }
    });
    startTimer(timeRemainingSeconds); 
    showToast("Tiếp tục."); 
    saveProgressToLocal(); 
}

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
    let html = ''; for (let i = 0; i < currentQuestions.length; i++) { 
        let bg = 'bg-blue-50 text-blue-300'; // Default
        if (submitted) {
            if (userAnswers[i]?.length === 0) bg = 'bg-gray-100 text-gray-400'; // Chưa làm
            else if (scoreDetails[i]?.correct) bg = 'bg-green-500 text-white'; // Đúng
            else bg = 'bg-red-500 text-white'; // Sai
        } else {
            if (userAnswers[i]?.length > 0) bg = 'bg-blue-600 text-white'; 
            if (flagged[i]) bg = 'bg-yellow-400 text-white'; 
        }
        html += `<div class="question-grid-item w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold ${bg} shadow-sm cursor-pointer hover:scale-105 transition-all" data-qidx="${i}">${i + 1}</div>`; 
    } questionGrid.innerHTML = html;
    document.querySelectorAll('.question-grid-item').forEach(el => { el.addEventListener('click', () => { 
        const idx = parseInt(el.dataset.qidx); 
        const searchInput = document.getElementById('searchInput'); 
        const clearSearchBtn = document.getElementById('clearSearchBtn'); 
        const scrollToQuestion = (id) => {
            setTimeout(() => {
                const target = document.getElementById(id);
                if (!target) return;
                const progressArea = document.getElementById('progressArea');
                const headerHeight = progressArea ? progressArea.offsetHeight : 160;
                const elementPosition = target.getBoundingClientRect().top + window.pageYOffset;
                const offsetPosition = elementPosition - headerHeight - 20; 
                window.scrollTo({ top: offsetPosition, behavior: "smooth" });
            }, 100);
        };
        if (!document.getElementById(`question-${idx}`)) { 
            if (searchInput) searchInput.value = ''; 
            if (clearSearchBtn) clearSearchBtn.classList.add('hidden'); 
            initLazyRender(() => { 
                while (displayedCount <= idx && displayedCount < filteredIndices.length) renderNextBatch(''); 
                setTimeout(() => scrollToQuestion(`question-${idx}`), 150); 
            }); 
        } else { 
            scrollToQuestion(`question-${idx}`); 
        } 
        document.getElementById('questionsContainer')?.classList.remove('hidden');
        document.getElementById('loadMoreTrigger')?.classList.remove('hidden');
        document.getElementById('questionGridPanel')?.classList.add('hidden'); 
    }); });
}

function initExam(questionsArray, timeMinutes) {
    try {
        if (!questionsArray || !questionsArray.length) { showToast("Chưa có ngân hàng."); return false; }
        stopTimer(); currentQuestions = [...questionsArray]; userAnswers = Array(currentQuestions.length).fill().map(() => []); flagged = Array(currentQuestions.length).fill(false); submitted = false; examActive = true; isPaused = false;
        const pauseResumeBtn = document.getElementById('pauseResumeBtn'); if (pauseResumeBtn) pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng';
        const pauseResumeBtnHeader = document.getElementById('pauseResumeBtnHeader'); if (pauseResumeBtnHeader) pauseResumeBtnHeader.innerHTML = '<i class="fas fa-pause"></i>';
        updateProgress(); initLazyRender();
        document.getElementById('questionsContainer')?.classList.remove('hidden');
        document.getElementById('loadMoreTrigger')?.classList.remove('hidden');
        document.getElementById('bottomActions')?.classList.remove('hidden');
        document.getElementById('questionGridPanel')?.classList.add('hidden');
        const resultPanel = document.getElementById('resultPanel'); if (resultPanel) resultPanel.classList.add('hidden');
        const setupArea = document.getElementById('setupArea'); if (setupArea) setupArea.classList.add('hidden');
        const progressArea = document.getElementById('progressArea'); if (progressArea) progressArea.classList.remove('hidden');
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

async function startReviewSession() {
    showLoading(true, "Đang quét các câu hỏi cần ôn tập...");
    try {
        const banks = await getAllBanks();
        const stats = ReviewManager.stats;
        const now = Date.now();
        
        let dueQuestions = [];
        let allLearningQuestions = [];
        
        const allQuestions = [];
        for (const bank of banks) {
            if (bank.questions) allQuestions.push(...bank.questions);
        }

        allQuestions.forEach(q => {
            const id = ReviewManager.getQId(q.text);
            const item = stats[id];
            if (item) {
                if (item.nextDate <= now) dueQuestions.push(q);
                allLearningQuestions.push(q);
            }
        });
        
        showLoading(false);

        if (dueQuestions.length > 0) {
            showConfirm(`Bạn có ${dueQuestions.length} câu hỏi đã đến hạn ôn tập. Bắt đầu ngay?`, (yes) => {
                if (yes) {
                    toggleReviewPanel(false);
                    initExam(dueQuestions, 15);
                    const modeInfo = document.getElementById('modeInfo');
                    if (modeInfo) modeInfo.innerText = "Chế độ: Ôn tập Định kỳ (Đến hạn)";
                }
            });
        } else if (allLearningQuestions.length > 0) {
            showConfirm(`Tuyệt vời! Bạn đã hoàn thành hết các câu của hôm nay. Bạn có muốn ôn lại ${allLearningQuestions.length} câu đang học để nhớ sâu hơn không?`, (yes) => {
                if (yes) {
                    toggleReviewPanel(false);
                    initExam(allLearningQuestions, 20);
                    const modeInfo = document.getElementById('modeInfo');
                    if (modeInfo) modeInfo.innerText = "Chế độ: Ôn tập Chủ động (Cram Mode)";
                }
            });
        } else {
            showToast("Bạn chưa có dữ liệu học tập. Hãy làm thử một bộ đề bất kỳ trước nhé!");
        }
    } catch (err) {
        console.error("Review Session Error:", err);
        showLoading(false);
        showToast("❌ Lỗi khởi tạo ôn tập: " + err.message);
    }
}
function resetCurrentExam() { if (!currentQuestions.length) showToast("Chưa có bài."); else if (!examActive) showToast("Bài đã nộp."); else { showToast("Đang làm mới bài thi..."); stopTimer(); userAnswers = Array(currentQuestions.length).fill().map(() => []); flagged = Array(currentQuestions.length).fill(false); submitted = false; examActive = true; isPaused = false; const btn = document.getElementById('pauseResumeBtn'); if (btn) btn.innerHTML = '<i class="fas fa-pause"></i> Tạm dừng'; updateProgress(); initLazyRender(); if (document.getElementById('resultPanel')) document.getElementById('resultPanel').classList.add('hidden'); startTimer((parseInt(document.getElementById('timeMinutes')?.value) || 30) * 60); saveProgressToLocal(); } }

function submitExam() {
    if (!currentQuestions.length || submitted) return;
    showConfirm("Bạn có chắc muốn nộp bài?", async (yes) => {
        if (!yes) return;
        try {
            stopTimer(); examActive = false; submitted = true; const evalRes = evaluateAll(); scoreDetails = evalRes.details; const percent = (evalRes.correctCount / evalRes.total * 100).toFixed(1);
            const resultContent = document.getElementById('resultContent'); if (resultContent) resultContent.innerHTML = `<div class="bg-gray-50 p-4 rounded-lg"><p class="text-lg font-semibold text-gray-800">✅ Điểm số: ${evalRes.correctCount}/${evalRes.total} (${percent}%)</p><p class="text-sm text-gray-700 mt-1">Đúng: ${evalRes.correctCount} | Sai: ${evalRes.total - evalRes.correctCount}</p><div class="w-full bg-gray-200 rounded-full h-2 mt-3"><div class="bg-green-500 h-2 rounded-full" style="width:${percent}%"></div></div></div><div class="mt-3 text-sm italic text-gray-600">💡 Kết quả chi tiết bên dưới. Tận dụng "Gia sư AI" để phân tích lỗi sai nhé!</div>`;
            const resultPanel = document.getElementById('resultPanel'); if (resultPanel) resultPanel.classList.remove('hidden');
            const setupArea = document.getElementById('setupArea'); if (setupArea) setupArea.classList.remove('hidden');
            const searchInput = document.getElementById('searchInput'); if (searchInput) searchInput.value = '';
            const clearSearchBtn = document.getElementById('clearSearchBtn'); if (clearSearchBtn) clearSearchBtn.classList.add('hidden');
            initLazyRender(() => { while (displayedCount < Math.min(50, filteredIndices.length)) renderNextBatch(''); setTimeout(() => resultPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); });
            const wrongIndices = [], wrongTexts = []; for (let i = 0; i < currentQuestions.length; i++) { if (userAnswers[i]?.length > 0 && !scoreDetails[i].correct) { wrongIndices.push(i); wrongTexts.push(currentQuestions[i].text); } }
            if (currentBankId) { await saveHistory(currentBankId, currentBankName, currentQuestions.length, evalRes.correctCount, wrongIndices, wrongTexts); }

            // GIAI ĐOẠN 2: Cập nhật Lộ trình ôn tập (SM-2)
            scoreDetails.forEach((detail, i) => {
                if (userAnswers[i]?.length > 0) { // Chỉ cập nhật nếu người dùng có làm câu đó
                    ReviewManager.update(currentQuestions[i].text, detail.correct);
                }
            });
            const bottomActions = document.getElementById('bottomActions'); if (bottomActions) bottomActions.classList.add('hidden');
            renderQuestionGrid();
            showToast("Đã lưu kết quả."); clearProgress();
        } catch (err) { console.error(err); showToast("Lỗi nộp bài!"); }
    });
}

function cancelExam() {
    if (!examActive && !submitted) return;
    showConfirm("Bạn có muốn huỷ bài thi hiện tại và quay về màn hình chính?", (yes) => {
        if (!yes) return;
        stopTimer();
        examActive = false;
        submitted = false;
        clearProgress();
        
        document.getElementById('progressArea')?.classList.add('hidden');
        document.getElementById('setupArea')?.classList.remove('hidden');
        document.getElementById('resultPanel')?.classList.add('hidden');
        document.getElementById('questionGridPanel')?.classList.add('hidden');
        document.getElementById('questionsContainer')?.classList.add('hidden');
        document.getElementById('loadMoreTrigger')?.classList.add('hidden');
        
        showToast("Đã huỷ bài thi.");
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
    const callBtn = e.target.closest('.ai-call-btn'); if (callBtn) { e.preventDefault(); VoiceTutor.startCall(parseInt(callBtn.dataset.qidx)); return; }
}
function attachGlobalEvents() { const container = document.getElementById('questionsContainer'); if (!container) return; container.removeEventListener('change', handleContainerChange); container.removeEventListener('click', handleContainerClick); container.addEventListener('change', handleContainerChange); container.addEventListener('click', handleContainerClick); }

async function restoreProgress() {
    try {
        const saved = loadProgress(); if (!saved || !saved.bankId) return false;
        
        // Hiển thị thông báo hỏi người dùng
        showConfirm(`♻️ Phát hiện bài tập đang làm dở từ phiên trước. Bạn có muốn tiếp tục làm bài "${saved.bankName}" không?`, async (yes) => {
            if (!yes) {
                clearProgress();
                return;
            }

            const bank = await getBankById(saved.bankId); if (!bank) { clearProgress(); return; }
            masterQuestions = bank.questions; currentBankId = bank.id; currentBankName = bank.name;
            const currentBankInfo = document.getElementById('currentBankInfo'); if (currentBankInfo) currentBankInfo.innerText = `Đã tải: ${bank.name} (${bank.questions.length} câu)`;
            
            if (saved.submitted) { 
                currentQuestions = [...masterQuestions]; 
                userAnswers = saved.userAnswers || Array(currentQuestions.length).fill().map(() => []); 
                flagged = saved.flagged || Array(currentQuestions.length).fill(false); 
                submitted = true; examActive = false; isPaused = false; 
                timeRemainingSeconds = 0; 
                updateProgress(); 
                initLazyRender(); 
                document.getElementById('questionsContainer')?.classList.remove('hidden');
                document.getElementById('loadMoreTrigger')?.classList.remove('hidden');
                const evalRes = evaluateAll();
                scoreDetails = evalRes.details;
                const resultPanel = document.getElementById('resultPanel');
                if (resultPanel) {
                    const percent = (evalRes.correctCount / evalRes.total * 100).toFixed(1);
                    const resultContent = document.getElementById('resultContent');
                    if (resultContent) resultContent.innerHTML = `<div class="bg-gray-50 p-4 rounded-lg"><p class="text-lg font-semibold text-gray-800">✅ Điểm số: ${evalRes.correctCount}/${evalRes.total} (${percent}%)</p></div>`;
                    resultPanel.classList.remove('hidden');
                }
                renderQuestionGrid();
                showToast(`✅ Đã khôi phục kết quả: ${bank.name}`); 
            }
            else if (saved.examActive) { 
                currentQuestions = [...masterQuestions]; 
                userAnswers = saved.userAnswers || Array(currentQuestions.length).fill().map(() => []); 
                flagged = saved.flagged || Array(currentQuestions.length).fill(false); 
                submitted = false; examActive = true; isPaused = saved.isPaused || false; 
                timeRemainingSeconds = saved.timeRemainingSeconds || 0; 
                const btn = document.getElementById('pauseResumeBtn'); 
                if (btn) btn.innerHTML = isPaused ? '<i class="fas fa-play"></i> Tiếp tục' : '<i class="fas fa-pause"></i> Tạm dừng'; 
                updateProgress(); initLazyRender(); 
                document.getElementById('questionsContainer')?.classList.remove('hidden');
                document.getElementById('loadMoreTrigger')?.classList.remove('hidden');
                document.getElementById('progressArea')?.classList.remove('hidden');
                document.getElementById('setupArea')?.classList.add('hidden');
                renderQuestionGrid();
                if (!isPaused) startTimer(timeRemainingSeconds); else updateTimerDisplay(); 
                if (document.getElementById('modeInfo')) document.getElementById('modeInfo').innerText = `Đang thi: ${currentQuestions.length} câu`; 
                showToast(`🚀 Tiếp tục làm bài: ${bank.name}`); 
            }
        });
        return true;
    } catch (e) { clearProgress(); return false; }
}

async function initGIA() {
    try {
        await openDB(); await refreshBankDropdown(); initDarkMode(); updateApiKeyBadge();
        FontSizeManager.init();
        discoverModels(); // Khởi chạy ngầm khám phá model mới
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
        document.getElementById('resetExamBtnHeader')?.addEventListener('click', resetCurrentExam);
        document.getElementById('pauseResumeBtn')?.addEventListener('click', () => { if (isPaused) resumeExam(); else pauseExam(); });
        document.getElementById('pauseResumeBtnHeader')?.addEventListener('click', () => { if (isPaused) resumeExam(); else pauseExam(); });
        document.getElementById('submitBtn')?.addEventListener('click', () => { if (currentQuestions.length && !submitted) submitExam(); else showToast("Chưa có bài hoặc đã nộp."); });
        document.getElementById('submitBtnHeader')?.addEventListener('click', () => { if (currentQuestions.length && !submitted) submitExam(); else showToast("Chưa có bài hoặc đã nộp."); });
        document.getElementById('endCallBtn')?.addEventListener('click', () => VoiceTutor.endCall());
        document.getElementById('toggleMicBtn')?.addEventListener('click', () => {
            if (VoiceTutor.isCalling) {
                SpeechManager.stop();
                VoiceTutor.startListening();
                // Hiện ô nhập liệu khi nhấn mic (để người dùng có thêm lựa chọn)
                document.getElementById('voiceInputContainer')?.classList.remove('hidden');
            }
        });
        document.getElementById('sendVoiceTextBtn')?.addEventListener('click', () => VoiceTutor.handleTextSubmit());
        document.getElementById('voiceTextInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') VoiceTutor.handleTextSubmit();
        });
        const toggleGridView = () => {
            if (currentQuestions.length) {
                const panel = document.getElementById('questionGridPanel');
                const container = document.getElementById('questionsContainer');
                const trigger = document.getElementById('loadMoreTrigger');
                if (!panel) return;

                const isCurrentlyHidden = panel.classList.contains('hidden');
                if (isCurrentlyHidden) {
                    // Chuyển sang chế độ Tổng quan
                    window.scrollTo(0, 0); // Reset cuộn về 0 trước
                    panel.classList.remove('hidden');
                    container?.classList.add('hidden');
                    trigger?.classList.add('hidden');
                    renderQuestionGrid();
                    setTimeout(() => {
                        const progressArea = document.getElementById('progressArea');
                        if (progressArea) {
                            window.scrollTo(0, progressArea.offsetTop);
                        }
                    }, 50);
                } else {
                    // Quay lại chế độ Câu hỏi
                    panel.classList.add('hidden');
                    container?.classList.remove('hidden');
                    trigger?.classList.remove('hidden');
                }
            } else {
                showToast("Chưa có bài thi.");
            }
        };
        document.getElementById('showGridBtn')?.addEventListener('click', toggleGridView);
        document.getElementById('showGridBtnHeader')?.addEventListener('click', toggleGridView);
        document.getElementById('cancelExamBtn')?.addEventListener('click', cancelExam);
        document.getElementById('cancelExamBtnHeader')?.addEventListener('click', cancelExam);
        document.getElementById('deleteAllBanksBtn')?.addEventListener('click', () => {
            document.getElementById('settingsDropdown')?.classList.remove('show');
            showConfirm("CẢNH BÁO: Bạn có chắc chắn muốn xoá TOÀN BỘ bộ đề đã lưu không? Hành động này không thể hoàn tác.", async (yes) => {
                if (!yes) return;
                await clearAllBanks();
                await clearAllHistory();
                clearProgress();
                location.reload();
            });
        });
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
        
        // Sidebar Toggle Logic
        const settingsSidePanel = document.getElementById('settingsSidePanel');
        const reviewSidePanel = document.getElementById('reviewDashboardCard');
        const overlay = document.getElementById('sidePanelOverlay');

        const toggleSettings = (show) => {
            if (show) {
                settingsSidePanel?.classList.remove('-translate-x-full');
                overlay?.classList.remove('hidden');
                showSettingsBadge(false);
                
                // 1. Nạp Cấu hình AI
                if (document.getElementById('apiKeyInput')) document.getElementById('apiKeyInput').value = localStorage.getItem('gemini_api_key') || '';
                if (document.getElementById('aiModelSelect')) document.getElementById('aiModelSelect').value = localStorage.getItem('last_working_model') || 'gemini-1.5-flash';

                // 2. Nạp Tính năng học tập
                const hintTog = document.getElementById('hintToggleSide');
                if (hintTog) hintTog.checked = (localStorage.getItem('haianh_hint_enabled') !== 'false');

                const explainTog = document.getElementById('aiExplainToggleSide');
                if (explainTog) explainTog.checked = (localStorage.getItem('haianh_show_ai_explain') !== 'false');

                const callTog = document.getElementById('aiCallToggleSide');
                if (callTog) callTog.checked = (localStorage.getItem('haianh_show_ai_call') !== 'false');

                // 3. Nạp Âm thanh
                const speedSlider = document.getElementById('aiSpeedSliderSide');
                const speedVal = document.getElementById('aiSpeedValSide');
                const savedRate = localStorage.getItem('voice_rate') || '1.0';
                if (speedSlider) speedSlider.value = savedRate;
                if (speedVal) speedVal.innerText = savedRate + 'x';

                // 4. Nạp Hiển thị
                const darkTog = document.getElementById('darkModeToggleSide');
                if (darkTog) darkTog.checked = document.body.classList.contains('dark');

                const sizeSlider = document.getElementById('sideFontSizeSlider');
                const sizeVal = document.getElementById('sideFontSizeVal');
                const savedScale = localStorage.getItem('haianh_font_scale') || '100';
                if (sizeSlider) sizeSlider.value = savedScale;
                if (sizeVal) sizeVal.innerText = savedScale + '%';

            } else {
                settingsSidePanel?.classList.add('-translate-x-full');
                if (reviewSidePanel?.classList.contains('translate-x-full')) overlay?.classList.add('hidden');
            }
        };

        const toggleReview = (show) => {
            if (show) {
                reviewSidePanel?.classList.remove('translate-x-full');
                overlay?.classList.remove('hidden');
                ReviewManager.updateDashboardUI();
            } else {
                reviewSidePanel?.classList.add('translate-x-full');
                if (settingsSidePanel?.classList.contains('-translate-x-full')) overlay?.classList.add('hidden');
            }
        };

        document.getElementById('settingsToggleBtn')?.addEventListener('click', () => toggleSettings(true));
        document.getElementById('closeSettingsPanel')?.addEventListener('click', () => toggleSettings(false));
        document.getElementById('toggleReviewCardBtn')?.addEventListener('click', () => toggleReview(true));
        document.getElementById('closeReviewPanel')?.addEventListener('click', () => toggleReview(false));
        overlay?.addEventListener('click', () => { toggleSettings(false); toggleReview(false); });

        // Logic Lưu toàn bộ cài đặt
        document.getElementById('saveAiSettingsBtn')?.addEventListener('click', () => {
            // 1. Lưu AI
            const key = document.getElementById('apiKeyInput').value.trim();
            const model = document.getElementById('aiModelSelect').value;
            localStorage.setItem('gemini_api_key', key);
            localStorage.setItem('last_working_model', model);
            updateApiKeyBadge();

            // 2. Lưu Tính năng
            const hintEnabledSide = document.getElementById('hintToggleSide').checked;
            localStorage.setItem('haianh_hint_enabled', hintEnabledSide);
            hintEnabled = hintEnabledSide;
            FontSizeManager.applyHintVisibility();

            const explainEnabled = document.getElementById('aiExplainToggleSide').checked;
            localStorage.setItem('haianh_show_ai_explain', explainEnabled);
            appSettings.showAiExplain = explainEnabled;

            const callEnabled = document.getElementById('aiCallToggleSide').checked;
            localStorage.setItem('haianh_show_ai_call', callEnabled);
            appSettings.showAiCall = callEnabled;
            // Cập nhật hiển thị nút gọi AI nổi nếu có
            const floatingAi = document.getElementById('floatingAiBtn');
            if (floatingAi) {
                if (callEnabled) floatingAi.classList.remove('hidden');
                else floatingAi.classList.add('hidden');
            }

            // 3. Lưu Âm thanh
            const rate = document.getElementById('aiSpeedSliderSide').value;
            localStorage.setItem('voice_rate', rate);
            SpeechManager.rate = parseFloat(rate);

            // 4. Lưu Dark Mode
            const isDark = document.getElementById('darkModeToggleSide').checked;
            if (isDark) document.body.classList.add('dark');
            else document.body.classList.remove('dark');
            localStorage.setItem('darkMode', isDark);

            // 5. Lưu Cỡ chữ
            const scale = document.getElementById('sideFontSizeSlider').value;
            localStorage.setItem('haianh_font_scale', scale);
            FontSizeManager.scale = parseInt(scale);
            FontSizeManager.apply();

            showToast("✅ Đã cập nhật toàn bộ cài đặt hệ thống!");
            toggleSettings(false);
        });

        // Event listeners cho các thanh trượt (Cập nhật số hiển thị tức thì)
        document.getElementById('aiSpeedSliderSide')?.addEventListener('input', (e) => {
            const val = document.getElementById('aiSpeedValSide');
            if (val) val.innerText = e.target.value + 'x';
        });

        document.getElementById('sideFontSizeSlider')?.addEventListener('input', (e) => {
            const val = document.getElementById('sideFontSizeVal');
            if (val) val.innerText = e.target.value + '%';
            // Áp dụng thử cỡ chữ ngay để người dùng thấy
            const decimal = e.target.value / 100;
            document.documentElement.style.setProperty('--font-scale', decimal);
            document.body.style.setProperty('--font-scale', decimal);
        });

        // Bổ sung: Kiểm tra Mic và Quét Model
        document.getElementById('sideUnlockMicBtn')?.addEventListener('click', () => {
            VoiceTutor.unlockMicrophone();
        });

        document.getElementById('sideCheckModelsBtn')?.addEventListener('click', () => {
            checkAvailableModels();
        });

        // Data Management in Sidebar
        document.getElementById('sideDataCenterBtn')?.addEventListener('click', () => {
            toggleSettings(false);
            document.getElementById('dataCenterModal')?.classList.remove('hidden');
            document.getElementById('dataCenterModal')?.classList.add('flex');
        });
        document.getElementById('sideClearAllBtn')?.addEventListener('click', () => {
            showConfirm("Xóa toàn bộ dữ liệu hệ thống?", async (yes) => {
                if (!yes) return;
                await clearAllBanks();
                localStorage.clear();
                location.reload();
            });
        });

        // AI Generator modal logic
        const openAiGenBtn = document.getElementById('openAiGenBtn');
        const aiGenModal = document.getElementById('aiGenModal');
        const closeAiGenBtn = document.getElementById('closeAiGenBtn');
        const uploadFileArea = document.getElementById('uploadFileArea');
        const fileInput = document.getElementById('fileInput');

        let currentAiFiles = [];
        let isBatchMode = false;

        const updateAiFileListUI = () => {
            const container = document.getElementById('multiFileContainer');
            const listWrapper = document.getElementById('fileListWrapper');
            const totalSizeDisplay = document.getElementById('totalSizeDisplay');
            const uploadArea = document.getElementById('uploadFileArea');

            if (!currentAiFiles.length) {
                container?.classList.add('hidden');
                uploadArea?.classList.remove('hidden');
                return;
            }

            container?.classList.remove('hidden');
            uploadArea?.classList.add('hidden');
            if (listWrapper) {
                listWrapper.innerHTML = currentAiFiles.map((f, i) => {
                    const isImg = f.type.startsWith('image/');
                    const previewSrc = isImg ? `data:${f.type};base64,${f.data}` : '';
                    
                    return `
                    <div class="flex items-center justify-between p-2 bg-white dark:bg-slate-900 rounded-xl border border-indigo-100 dark:border-slate-700 shadow-sm group">
                        <div class="flex items-center gap-3 overflow-hidden flex-1 cursor-pointer" onclick="viewFullAiFile(${i})">
                            ${isImg ? 
                                `<div class="w-12 h-12 rounded-lg overflow-hidden border border-gray-100 dark:border-slate-800 flex-shrink-0 bg-gray-50">
                                    <img src="${previewSrc}" class="w-full h-full object-cover">
                                 </div>` :
                                `<div class="w-12 h-12 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-500 flex-shrink-0">
                                    <i class="${f.type.startsWith('audio/') ? 'fas fa-volume-high' : 'fas fa-file-pdf'} text-xl"></i>
                                 </div>`
                            }
                            <div class="flex flex-col overflow-hidden">
                                <span class="text-xs font-bold text-gray-700 dark:text-gray-300 truncate">${f.name}</span>
                                <span class="text-[9px] text-gray-500 font-medium">${(f.size / (1024 * 1024)).toFixed(2)} MB</span>
                            </div>
                        </div>
                        <button class="remove-ai-file w-8 h-8 rounded-full text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition flex items-center justify-center" data-index="${i}">
                            <i class="fas fa-trash-alt text-sm"></i>
                        </button>
                    </div>
                `}).join('');

                listWrapper.querySelectorAll('.remove-ai-file').forEach(btn => {
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        const idx = parseInt(e.currentTarget.dataset.index);
                        currentAiFiles.splice(idx, 1);
                        updateAiFileListUI();
                    };
                });
            }

            const totalSize = currentAiFiles.reduce((acc, f) => acc + f.size, 0);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
            if (totalSizeDisplay) {
                totalSizeDisplay.innerText = `${totalMB}MB / 100MB`;
                totalSizeDisplay.className = totalSize > 100 * 1024 * 1024 ? "text-red-500 font-bold" : "text-gray-500 font-mono";
            }
        };

        openAiGenBtn?.addEventListener('click', () => { 
            aiGenModal?.classList.remove('hidden'); 
            aiGenModal?.classList.add('flex'); 
            currentAiFiles = []; 
            updateAiFileListUI();
            if (fileInput) fileInput.value = ''; 
            if (document.getElementById('aiGenTextArea')) document.getElementById('aiGenTextArea').value = ''; 
        });
        
        closeAiGenBtn?.addEventListener('click', () => { aiGenModal?.classList.add('hidden'); aiGenModal?.classList.remove('flex'); });
        uploadFileArea?.addEventListener('click', () => { isBatchMode = false; fileInput?.removeAttribute('capture'); fileInput?.click(); });
        
        let cameraStream = null;
        const cameraModal = document.getElementById('cameraModal');
        const cameraVideo = document.getElementById('cameraVideo');
        const cameraCanvas = document.getElementById('cameraCanvas');
        const cameraCountBadge = document.getElementById('cameraCountBadge');

        const stopCamera = () => {
            if (cameraStream) {
                cameraStream.getTracks().forEach(track => track.stop());
                cameraStream = null;
            }
            cameraModal?.classList.add('hidden');
            cameraModal?.classList.remove('flex');
        };

        const startCamera = async () => {
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }
                });
                if (cameraVideo) {
                    cameraVideo.srcObject = cameraStream;
                    cameraModal?.classList.remove('hidden');
                    cameraModal?.classList.add('flex');
                    cameraCountBadge.innerText = currentAiFiles.length;
                }
            } catch (err) {
                showToast("❌ Không thể truy cập Camera: " + err.message);
                isBatchMode = false;
            }
        };

        document.getElementById('batchScanBtn')?.addEventListener('click', () => {
            isBatchMode = true;
            startCamera();
        });

        document.getElementById('cancelCameraBtn')?.addEventListener('click', stopCamera);
        document.getElementById('finishCameraBtn')?.addEventListener('click', () => {
            stopCamera();
            isBatchMode = false;
            updateAiFileListUI();
        });

        document.getElementById('captureBtn')?.addEventListener('click', async () => {
            if (!cameraVideo || !cameraCanvas) return;
            const ctx = cameraCanvas.getContext('2d');
            
            // Tính toán khung crop (40px border từ HTML)
            const videoW = cameraVideo.videoWidth;
            const videoH = cameraVideo.videoHeight;
            
            // Giả định khung viền là 40px trên giao diện hiển thị
            // Ta sẽ crop lấy phần trung tâm 80% của video để đảm bảo chất lượng
            const cropScale = 0.8;
            const sw = videoW * cropScale;
            const sh = videoH * cropScale;
            const sx = (videoW - sw) / 2;
            const sy = (videoH - sh) / 2;

            cameraCanvas.width = sw;
            cameraCanvas.height = sh;
            ctx.drawImage(cameraVideo, sx, sy, sw, sh, 0, 0, sw, sh);

            // Hiệu ứng flash
            const flash = document.getElementById('cameraFlash');
            if (flash) {
                flash.classList.remove('active');
                void flash.offsetWidth;
                flash.classList.add('active');
                flash.classList.remove('hidden');
                setTimeout(() => flash.classList.add('hidden'), 400);
            }

            const dataUrl = cameraCanvas.toDataURL('image/jpeg', 0.85);
            const base64Data = dataUrl.split(',')[1];
            
            currentAiFiles.push({
                name: `Trang ${currentAiFiles.length + 1}`,
                type: 'image/jpeg',
                data: base64Data,
                size: Math.round(base64Data.length * 0.75)
            });

            cameraCountBadge.innerText = currentAiFiles.length;

            const toast = document.createElement('div');
            toast.className = 'camera-success-toast';
            toast.innerText = `📸 Đã quét trang ${currentAiFiles.length}`;
            cameraModal.appendChild(toast);
            setTimeout(() => toast.remove(), 1200);
        });

        // Hàm xem full ảnh AI
        window.viewFullAiFile = (idx) => {
            const file = currentAiFiles[idx];
            if (!file || !file.type.startsWith('image/')) return;
            
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 bg-black/90 z-[500] flex flex-col items-center justify-center p-4 backdrop-blur-md';
            modal.innerHTML = `
                <div class="absolute top-6 right-6 flex gap-4">
                    <button class="w-12 h-12 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20" onclick="this.closest('.fixed').remove()">
                        <i class="fas fa-times text-xl"></i>
                    </button>
                </div>
                <img src="data:${file.type};base64,${file.data}" class="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl border border-white/10">
                <div class="mt-6 text-white text-center">
                    <p class="font-bold">${file.name}</p>
                    <p class="text-xs text-gray-400 mt-1 uppercase tracking-widest">${(file.size/1024/1024).toFixed(2)} MB</p>
                </div>
            `;
            document.body.appendChild(modal);
        };

        fileInput?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) { isBatchMode = false; return; }

            showLoading(true, isBatchMode ? "Đang nạp trang sách..." : `Đang xử lý ${files.length} tệp tin...`);
            
            for (const file of files) {
                const fileName = file.name.toLowerCase();
                const currentTotal = currentAiFiles.reduce((acc, f) => acc + f.size, 0);
                if (currentTotal + file.size > 100 * 1024 * 1024) {
                    showToast(`⚠️ File "${file.name}" vượt quá hạn mức 100MB.`);
                    continue;
                }

                if (file.type.startsWith('image/') || file.type === 'application/pdf') {
                    const data = await new Promise((res) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => res(ev.target.result.split(',')[1]);
                        reader.readAsDataURL(file);
                    });
                    
                    let finalData = data;
                    if (file.type.startsWith('image/')) finalData = await compressImage(data);
                    
                    currentAiFiles.push({
                        name: isBatchMode ? `Trang ${currentAiFiles.length + 1}` : file.name,
                        type: file.type,
                        data: finalData,
                        size: file.size
                    });
                } else if (file.type.startsWith('audio/')) {
                    const data = await new Promise((res) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => res(ev.target.result.split(',')[1]);
                        reader.readAsDataURL(file);
                    });
                    currentAiFiles.push({ name: file.name, type: file.type, data: data, size: file.size });
                } else if (fileName.endsWith('.docx')) {
                    const text = await new Promise((res) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => mammoth.extractRawText({ arrayBuffer: ev.target.result }).then(r => res(r.value)).catch(() => res(""));
                        reader.readAsArrayBuffer(file);
                    });
                    if (text) { const area = document.getElementById('aiGenTextArea'); if (area) area.value += `\n--- NỘI DUNG TỪ ${file.name} ---\n${text}\n`; }
                } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
                    const text = await new Promise((res) => {
                        const reader = new FileReader();
                        reader.onload = (ev) => { try { const wb = XLSX.read(ev.target.result, { type: 'array' }); let rs = ""; wb.SheetNames.forEach(n => { const sh = wb.Sheets[n]; const js = XLSX.utils.sheet_to_json(sh, { header: 1 }); rs += js.map(r => r.join(" ")).join("\n") + "\n"; }); res(rs); } catch(e) { res(""); } };
                        reader.readAsArrayBuffer(file);
                    });
                    if (text) { const area = document.getElementById('aiGenTextArea'); if (area) area.value += `\n--- DỮ LIỆU TỪ ${file.name} ---\n${text}\n`; }
                } else if (file.type.startsWith('text/')) {
                    const text = await new Promise((res) => { const reader = new FileReader(); reader.onload = (ev) => res(ev.target.result); reader.readAsText(file); });
                    if (text) { const area = document.getElementById('aiGenTextArea'); if (area) area.value += `\n--- VĂN BẢN TỪ ${file.name} ---\n${text}\n`; }
                }
            }
            
            updateAiFileListUI();
            showLoading(false);
            if (fileInput) fileInput.value = '';

        });

        let tempAiQuestions = [];
        let tempBankName = "";

        const syncReviewData = () => {
            const cards = document.querySelectorAll('.ai-review-card');
            cards.forEach(card => {
                const idx = parseInt(card.dataset.idx);
                const qText = card.querySelector('textarea').value.trim();
                const optRows = card.querySelectorAll('.opt-edit-row');
                const options = [];
                const correctIndices = [];
                
                optRows.forEach((row, oIdx) => {
                    const optVal = row.querySelector('input[type="text"]').value.trim();
                    const isCorrect = row.querySelector('.opt-edit-checkbox').checked;
                    options.push(optVal);
                    if (isCorrect) correctIndices.push(oIdx);
                });

                if (tempAiQuestions[idx]) {
                    tempAiQuestions[idx].text = qText;
                    tempAiQuestions[idx].options = options;
                    tempAiQuestions[idx].correctIndices = correctIndices;
                }
            });
        };

        const showAiFixDialog = (idx) => {
            const modal = document.getElementById('aiFixModal');
            const input = document.getElementById('aiFixCustomInput');
            const confirmBtn = document.getElementById('confirmAiFixBtn');
            const closeBtn = document.getElementById('closeAiFixModal');
            const chips = document.querySelectorAll('.fix-chip');

            if (!modal || !input) return;

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            input.value = "";
            chips.forEach(c => c.classList.remove('active'));

            chips.forEach(chip => {
                chip.onclick = () => {
                    chips.forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');
                    input.value = chip.dataset.val;
                    if (chip.dataset.val === "") input.focus();
                };
            });

            confirmBtn.onclick = async () => {
                const instruction = input.value.trim();
                if (!instruction) { showToast("Vui lòng chọn hoặc nhập yêu cầu!"); return; }
                modal.classList.add('hidden');
                modal.classList.remove('flex');
                await handleAiFixQuestion(idx, instruction);
            };

            closeBtn.onclick = () => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            };
        };

        const renderAiReviewList = () => {
            const listWrapper = document.getElementById('aiReviewList');
            const countBadge = document.getElementById('aiReviewCount');
            if (!listWrapper) return;

            countBadge.innerText = `${tempAiQuestions.length} câu hỏi`;
            listWrapper.innerHTML = tempAiQuestions.map((q, idx) => `
                <div class="ai-review-card space-y-4" data-idx="${idx}">
                    <div class="flex justify-between items-start gap-4">
                        <span class="w-7 h-7 bg-indigo-600 text-white rounded-lg flex items-center justify-center font-bold text-xs flex-shrink-0">${idx + 1}</span>
                        <div class="flex-1">
                            <textarea class="q-edit-input font-bold text-gray-800" placeholder="Nội dung câu hỏi..." rows="2">${q.text}</textarea>
                        </div>
                        <div class="flex flex-col gap-2">
                            <button class="delete-btn" title="Xóa câu này" onclick="this.closest('.ai-review-card').remove();">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                            <button class="ai-fix-btn" title="AI Tinh chỉnh câu này" data-idx="${idx}">
                                <i class="fas fa-wand-magic-sparkles"></i> AI FIX
                            </button>
                        </div>
                    </div>
                    <div class="space-y-2 pl-11">
                        ${q.options.map((opt, optIdx) => `
                            <div class="opt-edit-row">
                                <input type="${q.type === 'multiple' ? 'checkbox' : 'radio'}" name="correct-${idx}" class="opt-edit-checkbox" ${q.correctIndices.includes(optIdx) ? 'checked' : ''} data-optidx="${optIdx}">
                                <input type="text" class="q-edit-input flex-1" value="${opt}" placeholder="Lựa chọn ${optIdx + 1}">
                            </div>
                        `).join('')}
                    </div>
                </div>
            `).join('');

            // Gán sự kiện AI FIX chuyên sâu
            listWrapper.querySelectorAll('.ai-fix-btn').forEach(btn => {
                btn.onclick = (e) => {
                    syncReviewData();
                    const idx = parseInt(e.currentTarget.dataset.idx);
                    showAiFixDialog(idx);
                };
            });
        };

        const handleAiFixQuestion = async (idx, instruction) => {
            if (!checkAiReady()) return;
            showLoading(true, "AI đang tinh chỉnh câu hỏi...");
            const currentQ = tempAiQuestions[idx];
            const prompt = `Bạn là chuyên gia đề thi. Hãy sửa lại câu hỏi trắc nghiệm sau đây theo yêu cầu: "${instruction}"\n\nCÂU HỎI HIỆN TẠI:\n${JSON.stringify(currentQ)}\n\nBẮT BUỘC trả về duy nhất 1 đối tượng JSON (không markdown) theo cấu trúc cũ.`;
            
            try {
                const payload = { contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, responseMimeType: "application/json" } };
                const data = await callAiProxy({ provider: 'google', model: 'gemini-1.5-flash', payload });
                if (!data.candidates || !data.candidates[0].content.parts[0].text) throw new Error("AI không phản hồi");
                
                let text = data.candidates[0].content.parts[0].text;
                text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
                const newQ = JSON.parse(text);
                tempAiQuestions[idx] = newQ;
                renderAiReviewList();
                showToast("✅ Đã cập nhật câu hỏi!");
            } catch (err) {
                showToast("❌ Lỗi AI: " + err.message);
            } finally {
                showLoading(false);
            }
        };

        const openAiReview = (bankName, questions) => {
            tempBankName = bankName;
            tempAiQuestions = JSON.parse(JSON.stringify(questions)); // Deep copy
            const modal = document.getElementById('aiReviewModal');
            if (modal) {
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                renderAiReviewList();
            }
        };

        document.getElementById('saveAiReviewBtn')?.addEventListener('click', async () => {
            // Thu thập dữ liệu từ các ô nhập liệu
            const cards = document.querySelectorAll('.ai-review-card');
            const updatedQuestions = [];
            
            cards.forEach(card => {
                const qText = card.querySelector('textarea').value.trim();
                const optRows = card.querySelectorAll('.opt-edit-row');
                const options = [];
                const correctIndices = [];
                
                optRows.forEach((row, oIdx) => {
                    const optVal = row.querySelector('input[type="text"]').value.trim();
                    const isCorrect = row.querySelector('.opt-edit-checkbox').checked;
                    if (optVal) {
                        options.push(optVal);
                        if (isCorrect) correctIndices.push(options.length - 1);
                    }
                });

                if (qText && options.length >= 2) {
                    updatedQuestions.push({
                        text: qText,
                        options: options,
                        correctIndices: correctIndices,
                        type: correctIndices.length > 1 ? 'multiple' : 'single'
                    });
                }
            });

            if (updatedQuestions.length === 0) {
                showToast("⚠️ Không có câu hỏi hợp lệ để lưu!");
                return;
            }

            showLoading(true, "Đang lưu bộ đề...");
            try {
                await saveBank(tempBankName, updatedQuestions);
                await refreshBankDropdown();
                const banks = await getAllBanks();
                const newBank = banks[banks.length - 1];
                document.getElementById('aiReviewModal')?.classList.add('hidden');
                showLoading(false);
                showConfirm(`🎉 Đã lưu ${updatedQuestions.length} câu hỏi! Bắt đầu làm ngay?`, async (yes) => {
                    if (yes) await loadBankById(newBank.id);
                });
            } catch (err) {
                showLoading(false);
                showToast("Lỗi lưu bộ đề: " + err.message);
            }
        });

        document.getElementById('cancelAiReviewBtn')?.addEventListener('click', () => {
            showConfirm("Hủy bỏ bộ đề vừa tạo? Toàn bộ nội dung sẽ bị mất.", (yes) => {
                if (yes) document.getElementById('aiReviewModal')?.classList.add('hidden');
            });
        });

        document.getElementById('addAiReviewQuestionBtn')?.addEventListener('click', () => {
            syncReviewData();
            tempAiQuestions.push({
                text: "Câu hỏi mới...",
                options: ["Đáp án 1", "Đáp án 2", "Đáp án 3", "Đáp án 4"],
                correctIndices: [0],
                type: "single"
            });
            renderAiReviewList();
            // Cuộn xuống cuối
            const list = document.getElementById('aiReviewList');
            if (list) setTimeout(() => list.scrollTop = list.scrollHeight, 100);
        });

        submitAiGenBtn?.addEventListener('click', async () => {
            if (!checkAiReady()) return;
            const rawText = document.getElementById('aiGenTextArea')?.value.trim();
            if (!currentAiFiles.length && !rawText) { showToast("Vui lòng tải file hoặc dán văn bản!"); return; }
            
            const totalSize = currentAiFiles.reduce((acc, f) => acc + f.size, 0);
            if (totalSize > 100 * 1024 * 1024) { showToast("Tổng dung lượng vượt quá 100MB. Vui lòng gỡ bớt file!"); return; }

            const count = parseInt(document.getElementById('aiGenCount')?.value) || 10;
            let bankName = document.getElementById('aiGenName')?.value.trim(); if (!bankName) bankName = "Bộ đề AI - " + new Date().toLocaleString('vi-VN');
            const diff = document.getElementById('aiGenDifficulty')?.value;
            const difficultyText = diff !== 'Mặc định' ? `Mức độ câu hỏi: ${diff}.` : '';
            
            const isOcrPro = document.getElementById('ocrProToggle')?.checked;
            const ocrProText = isOcrPro ? "\n[CHẾ ĐỘ OCR PRO KÍCH HOẠT]: Hãy phân tích cực kỳ chi tiết các hình ảnh. Chú ý đến các sơ đồ, bảng biểu, công thức toán học và các đoạn văn bản nhỏ trong hình vẽ. Đảm bảo bóc tách đúng cấu trúc kiến thức của trang sách giáo khoa." : "";
            
            aiGenModal?.classList.add('hidden'); aiGenModal?.classList.remove('flex');
            showLoading(true, isOcrPro ? "🚀 OCR Pro: Đang quét sâu dữ liệu hình ảnh..." : "AI đang tổng hợp dữ liệu... (Có thể mất 20-40 giây)");

            const basePrompt = `Bạn là chuyên gia thiết kế đề thi trắc nghiệm (OCR Pro & Voice Mode). ${ocrProText}
Hãy phân tích TẤT CẢ các tài liệu đính kèm (Hình ảnh sách giáo khoa, file âm thanh bài giảng, tài liệu văn bản). 
1. Với Hình ảnh: Hãy nhận diện cấu trúc trang sách, các công thức, hình vẽ và chuyển thành câu hỏi phù hợp.
2. Với Âm thanh: Hãy nghe nội dung bài giảng và trích xuất các ý chính để đặt câu hỏi.
3. Với Văn bản: Tổng hợp kiến thức chuyên sâu.

Tạo ra đúng ${count} câu hỏi trắc nghiệm chất lượng cao. ${difficultyText}
BẮT BUỘC trả về JSON array. Cấu trúc mẫu:
[
  {
    "text": "Câu hỏi?",
    "options": ["A", "B", "C", "D"],
    "correctIndices": [0],
    "type": "single"
  }
]
Tiếng Việt.`;
            
            let finalPrompt = basePrompt; if (rawText) finalPrompt += "\n\nVĂN BẢN TỔNG HỢP:\n" + rawText;
            
            const partsArray = [{ text: finalPrompt }];
            currentAiFiles.forEach(f => {
                partsArray.push({ inlineData: { mimeType: f.type, data: f.data } });
            });

            try {
                const payload = { contents: [{ role: "user", parts: partsArray }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } };
                const data = await callAiProxy({ provider: 'google', model: 'gemini-1.5-flash', payload });
                if (!data.candidates?.length || !data.candidates[0].content?.parts?.length) throw new Error("AI không trả về nội dung.");
                
                let aiResponseText = data.candidates[0].content.parts[0].text;
                aiResponseText = aiResponseText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
                
                const jsonArray = JSON.parse(aiResponseText);
                if (!Array.isArray(jsonArray) || jsonArray.length === 0) throw new Error("Dữ liệu AI trả về không đúng định dạng.");
                
                showLoading(false);
                openAiReview(bankName, jsonArray);
            } catch (error) { showLoading(false); showToast("❌ Lỗi tạo đề: " + error.message, 7000); aiGenModal?.classList.remove('hidden'); aiGenModal?.classList.add('flex'); }
        });

        // Nút nộp bài Header
        const submitBtnHeader = document.getElementById('submitBtnHeader');
        if (submitBtnHeader) submitBtnHeader.onclick = submitExam;

        // Đóng gợi ý AI và Thông báo (Toast) khi chạm vào vùng trống
        document.addEventListener('pointerdown', (e) => {
            // 1. Xử lý các bảng Giải thích AI
            const openedExplanations = document.querySelectorAll('.ai-explanation-box:not(.hidden)');
            openedExplanations.forEach(box => {
                const qIdx = box.id.replace('ai-explanation-', '');
                const aiBtn = document.querySelector(`.ai-explain-btn[data-qidx="${qIdx}"]`);
                if (!box.contains(e.target) && (!aiBtn || !aiBtn.contains(e.target))) {
                    box.classList.add('hidden');
                    if (aiBtn) aiBtn.innerHTML = `<i class="fas fa-magic"></i> Hiện giải thích`;
                }
            });

            // 2. Xử lý thông báo Toast (Gợi ý)
            const toast = document.getElementById('toastMsg');
            const isHintBtn = e.target.closest('.hint-btn');
            if (toast && !toast.classList.contains('hidden') && !toast.contains(e.target) && !isHintBtn) {
                toast.classList.add('hidden');
            }
        });

        // Data Center Events
        document.getElementById('dataCenterBtn')?.addEventListener('click', () => {
            document.getElementById('settingsDropdown')?.classList.remove('show');
            document.getElementById('dataCenterModal')?.classList.remove('hidden');
            document.getElementById('dataCenterModal')?.classList.add('flex');
        });

        document.getElementById('exportAllBtn')?.addEventListener('click', exportAllData);

        document.getElementById('importDataBtn')?.addEventListener('click', () => {
            document.getElementById('importFileInput')?.click();
        });

        document.getElementById('importFileInput')?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importData(e.target.files[0]);
                e.target.value = ''; // Reset
            }
        });

        // Voice Chat Modal Events
        document.getElementById('endCallBtn')?.addEventListener('pointerdown', (e) => { e.preventDefault(); VoiceTutor.endCall(); });
        
        const micBtn = document.getElementById('toggleMicBtn');
        if (micBtn) {
            // Nhấn xuống: Bắt đầu nghe
            micBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                if (VoiceTutor.isCalling) {
                    micBtn.classList.add('mic-active-pulse');
                    SpeechManager.stop();
                    VoiceTutor.startListening();
                }
            });

            // Nhả ra: Dừng và Gửi (PTT)
            const stopMic = (e) => {
                e.preventDefault();
                if (VoiceTutor.isCalling) {
                    micBtn.classList.remove('mic-active-pulse');
                    VoiceTutor.stopListeningAndSubmit();
                }
            };
            micBtn.addEventListener('pointerup', stopMic);
            micBtn.addEventListener('pointerleave', stopMic);
            micBtn.addEventListener('pointercancel', stopMic);
        }

        document.getElementById('liveModeToggle')?.addEventListener('click', () => VoiceTutor.toggleLiveMode());
        
        document.getElementById('sendVoiceTextBtn')?.addEventListener('pointerdown', (e) => { e.preventDefault(); VoiceTutor.handleTextSubmit(); });
        document.getElementById('voiceTextInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                VoiceTutor.handleTextSubmit();
            }
        });

        document.getElementById('shareBankBtn')?.addEventListener('click', () => {
            const bankId = document.getElementById('bankSelect')?.value;
            if (!bankId) {
                showToast("Vui lòng chọn bộ đề muốn chia sẻ!");
                return;
            }
            exportSingleBank(bankId);
        });

        document.getElementById('unlockMicBtn')?.addEventListener('click', () => VoiceTutor.unlockMicrophone());


        document.getElementById('toggleReviewCardBtn')?.addEventListener('click', () => toggleReviewPanel(true));
        document.getElementById('closeReviewPanel')?.addEventListener('click', () => toggleReviewPanel(false));
        document.getElementById('sidePanelOverlay')?.addEventListener('click', () => toggleReviewPanel(false));

        document.getElementById('startReviewBtn')?.addEventListener('click', startReviewSession);

        document.getElementById('copyVoiceTranscriptBtn')?.addEventListener('click', () => {
            const text = document.getElementById('voiceTranscript').innerText;
            if (!text || text.includes("Đang kết nối")) return;
            navigator.clipboard.writeText(text).then(() => {
                showToast("✅ Đã sao chép nội dung!");
            });
        });

        attachGlobalEvents();
        ReviewManager.updateDashboardUI();
    } catch (e) { console.error("Lỗi Khởi tạo Hệ thống:", e); }
}

// Chạy khởi tạo khi DOM sẵn sàng
window.addEventListener('DOMContentLoaded', () => {
    FontSizeManager.init();
    ReviewManager.init();
    AuthManager.init(); // Kích hoạt hệ thống đăng nhập
    ProgressManager.load();
    
    // Khởi tạo các sự kiện Global và UI
    initGIA();
});

// ======================== PWA SERVICE WORKER REGISTRATION ========================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('🚀 Hai Anh Study: Service Worker Registered!', reg.scope);
            })
            .catch(err => {
                console.error('❌ Hai Anh Study: Service Worker Registration Failed:', err);
            });
    });
}
