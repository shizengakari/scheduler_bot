document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // SECTION 0: 共通ユーティリティ (Core Utilities)
    // =========================================================================

    /** 数値を2桁ゼロ埋め文字列に変換 */
    const pad2 = (n) => String(n).padStart(2, '0');

    /** 年・月(1-12)・日から YYYY-MM-DD 形式のキーを生成 */
    const toDateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

    // =========================================================================
    // SECTION 1: アプリケーション状態管理 (State Management)
    // =========================================================================

    const state = {
        discordUserId: null,
        identifier: null,
        startDate: null,
        endDate: null,
        allDates: [],
        selectedSlots: new Set(),
        // ドラッグ選択インタラクション管理
        isMouseDown: false,
        isSelecting: true,
        lastMouseSlot: null,
        voteCounts: {},
        allowedSlots: null,
    };

    // =========================================================================
    // SECTION 2: DOM要素参照 (DOM Element Selectors)
    // =========================================================================

    const idInput = document.getElementById('schedule-id-input');
    const generateBtn = document.getElementById('generate-schedule-btn');
    const scheduleContainer = document.getElementById('schedule-container');
    const scheduleGrid = document.getElementById('schedule-grid');
    const currentPeriodDisplay = document.getElementById('current-period-display');
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const confirmBtn = document.getElementById('confirm-btn');
    const outputArea = document.querySelector('.output-area');
    const outputStringTextarea = document.getElementById('output-string');
    const themeToggle = document.getElementById('theme-toggle');
    const rotatingStep = document.getElementById('rotating-step');

    // 表示モードコンテナ
    const registerMode = document.getElementById('register-mode');
    const previewMode = document.getElementById('preview-mode');

    // ヘッダーガイドステップの自動ローテーション
    const steps = [
        '入力IDを貼り付けて「実行」→ スケジュール登録',
        'データを貼り付けて「実行」→ ステータス確認'
    ];
    let currentStepIndex = 0;
    let rotateInterval = null;

    function rotateSteps() {
        if (!rotatingStep) return;
        rotatingStep.style.opacity = '0';
        setTimeout(() => {
            rotatingStep.textContent = steps[currentStepIndex];
            rotatingStep.style.opacity = '1';
            currentStepIndex = (currentStepIndex + 1) % steps.length;
        }, 500);
    }

    if (rotatingStep) {
        rotatingStep.textContent = steps[0];
        currentStepIndex = 1;
        rotateInterval = setInterval(rotateSteps, 3000);
    }

    // =========================================================================
    // SECTION 3: 日本の祝日判定エンジン (Japanese Holidays Engine)
    // =========================================================================
    // 国民の祝日に関する法律（祝日法）に基づき、固定祝日・ハッピーマンデー・
    // 天文計算による春分/秋分の日・国民の休日・振替休日を動的に算出・キャッシュします。

    const holidayCache = new Map();

    function getJapaneseHolidays(year) {
        if (holidayCache.has(year)) {
            return holidayCache.get(year);
        }

        const holidays = new Map();
        const add = (m, d, name) => holidays.set(toDateKey(year, m, d), name);

        // 固定祝日（法改正の施行年に準拠）
        add(1, 1, '元日');
        add(2, 11, '建国記念の日');
        if (year >= 2020) add(2, 23, '天皇誕生日');
        add(4, 29, '昭和の日');
        add(5, 3, '憲法記念日');
        if (year >= 2007) add(5, 4, 'みどりの日');
        add(5, 5, 'こどもの日');
        // 山の日（2020年・2021年の東京五輪特例措置を含む）
        if (year === 2020) add(8, 10, '山の日');
        else if (year === 2021) add(8, 8, '山の日');
        else if (year >= 2016) add(8, 11, '山の日');
        add(11, 3, '文化の日');
        add(11, 23, '勤労感謝の日');

        // 春分の日・秋分の日（海上保安庁水路部略算式）
        const vernalDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        add(3, vernalDay, '春分の日');

        const autumnalDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        add(9, autumnalDay, '秋分の日');

        // ハッピーマンデー（指定月の第N月曜日を算出）
        const getNthMonday = (m, n) => {
            const firstDay = new Date(year, m - 1, 1).getDay();
            const offset = (8 - firstDay) % 7;
            return 1 + offset + (n - 1) * 7;
        };

        add(1, getNthMonday(1, 2), '成人の日');
        // 海の日・スポーツの日（五輪特例対応）
        if (year === 2020) {
            add(7, 23, '海の日');
            add(7, 24, 'スポーツの日');
        } else if (year === 2021) {
            add(7, 22, '海の日');
            add(7, 23, 'スポーツの日');
        } else {
            add(7, getNthMonday(7, 3), '海の日');
            add(10, getNthMonday(10, 2), 'スポーツの日');
        }
        add(9, getNthMonday(9, 3), '敬老の日');

        // 国民の休日（前日と翌日の双方が「祝日」である平日）
        const sortedKeys = Array.from(holidays.keys()).sort();
        for (let i = 0; i < sortedKeys.length - 1; i++) {
            const d1 = new Date(sortedKeys[i] + 'T00:00:00');
            const d2 = new Date(sortedKeys[i + 1] + 'T00:00:00');
            const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
            if (diffDays === 2) {
                const middle = new Date(d1.getTime() + 24 * 60 * 60 * 1000);
                if (middle.getDay() !== 0) { // 日曜日でない平日
                    add(middle.getMonth() + 1, middle.getDate(), '国民の休日');
                }
            }
        }

        // 振替休日（祝日が日曜日に当たる場合、翌日以降の直近の平日を休日とする）
        const finalHolidays = new Map(holidays);
        const originalKeys = Array.from(holidays.keys()).sort();
        for (const key of originalKeys) {
            const d = new Date(key + 'T00:00:00');
            if (d.getDay() === 0) {
                let next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
                while (true) {
                    const nextKey = toDateKey(next.getFullYear(), next.getMonth() + 1, next.getDate());
                    if (!holidays.has(nextKey)) {
                        finalHolidays.set(nextKey, '振替休日');
                        break;
                    }
                    next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
                }
            }
        }

        holidayCache.set(year, finalHolidays);
        return finalHolidays;
    }

    function getJapaneseHolidayName(date) {
        if (!date) return null;
        const d = date instanceof Date ? date : new Date(date);
        const holidays = getJapaneseHolidays(d.getFullYear());
        return holidays.get(toDateKey(d.getFullYear(), d.getMonth() + 1, d.getDate())) || null;
    }

    function isJapaneseHoliday(date) {
        return getJapaneseHolidayName(date) !== null;
    }

    function setHeaderMessage(text) {
        if (!rotatingStep) return;
        if (rotateInterval) {
            clearInterval(rotateInterval);
            rotateInterval = null;
        }
        rotatingStep.style.opacity = '0';
        setTimeout(() => {
            rotatingStep.textContent = text;
            rotatingStep.style.opacity = '1';
        }, 300);
    }

    // =========================================================================
    // SECTION 4: テーマ切り替え管理 (Theme Management)
    // =========================================================================

    function initTheme() {
        const savedTheme = localStorage.getItem('theme');
        const isLight = savedTheme === 'light';
        if (isLight) document.body.classList.add('light-theme');
        updateThemeIcon(isLight);
    }

    function toggleTheme() {
        const isLight = document.body.classList.toggle('light-theme');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
        updateThemeIcon(isLight);
    }

    function updateThemeIcon(isLight) {
        const icon = themeToggle ? themeToggle.querySelector('.icon') : null;
        if (icon) icon.textContent = isLight ? '☀️' : '🌙';
    }

    initTheme();

    // =========================================================================
    // SECTION 5: URLパラメータ解析 & 自動ロード (URL Parameter Handling)
    // =========================================================================

    const urlParams = new URLSearchParams(window.location.search);
    const idFromUrl = urlParams.get('id') || urlParams.get('data');
    const statusFromUrl = urlParams.get('c4') ? `c4-${urlParams.get('c4')}`
        : urlParams.get('s4') ? `s4-${urlParams.get('s4')}`
        : urlParams.get('c3') ? `c3-${urlParams.get('c3')}`
        : urlParams.get('s3') ? `s3-${urlParams.get('s3')}`
        : (urlParams.get('status') || urlParams.get('c') || null);

    if (idFromUrl && idInput) {
        idInput.value = idFromUrl;
        setTimeout(() => handleInput(), 200);
    } else if (statusFromUrl && idInput) {
        idInput.value = statusFromUrl;
        setTimeout(() => handleInput(), 200);
    }

    // =========================================================================
    // SECTION 6: 入力ディスパッチ & プレビュー制御 (Input Dispatcher & Preview Control)
    // =========================================================================

    generateBtn.addEventListener('click', handleInput);
    if (prevWeekBtn) prevWeekBtn.style.display = 'none';
    if (nextWeekBtn) nextWeekBtn.style.display = 'none';
    confirmBtn.addEventListener('click', handleConfirm);
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    /** 入力欄の文字列を解析し、登録モードまたはプレビューモードへ振り分け */
    function handleInput() {
        let inputValue = idInput.value.trim().replace(/\s+/g, '');

        // URL形式が直接貼り付けられた場合、パラメータ部分を自動抽出
        if (inputValue.includes('http://') || inputValue.includes('https://')) {
            try {
                const parsedUrl = new URL(inputValue);
                const extractedId = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('data');
                const extractedStatus = parsedUrl.searchParams.get('c4') ? `c4-${parsedUrl.searchParams.get('c4')}`
                    : parsedUrl.searchParams.get('s4') ? `s4-${parsedUrl.searchParams.get('s4')}`
                    : parsedUrl.searchParams.get('c3') ? `c3-${parsedUrl.searchParams.get('c3')}`
                    : parsedUrl.searchParams.get('s3') ? `s3-${parsedUrl.searchParams.get('s3')}`
                    : (parsedUrl.searchParams.get('status') || parsedUrl.searchParams.get('c'));
                if (extractedId) {
                    inputValue = extractedId;
                    idInput.value = extractedId;
                } else if (extractedStatus) {
                    inputValue = extractedStatus;
                    idInput.value = extractedStatus;
                }
            } catch (e) {
                // パース失敗時はそのまま継続
            }
        }

        if (!inputValue) {
            showToast('入力IDまたはステータスデータを貼り付けてください', 'warning');
            return;
        }

        // プレフィックスによるステータスプレビュー判定 (v4, v3, v2)
        const isStatus = ['status-', 's4-', 'c4-', 's3-', 'c3-'].some(prefix => inputValue.startsWith(prefix));
        if (isStatus) {
            handleStatusPreview(inputValue);
        } else {
            handleGenerateSchedule();
        }
    }

    /** 圧縮ステータスデータをデコードして集計プレビュー画面を描画 */
    function handleStatusPreview(encodedData) {
        try {
            let data = decodeCompressedData(encodedData);
            if (!data) {
                showToast('データのデコードに失敗しました。コピー内容を確認してください。', 'error');
                return;
            }
            if (data.v === 2 || data.v === 3) {
                data = expandCompactStatus(data);
            }
            registerMode.style.display = 'none';
            setHeaderMessage('投票状況プレビュー');
            previewMode.style.display = 'block';
            displaySchedulePreview(data);
        } catch (e) {
            console.error('Status preview error:', e);
            showToast(`データ処理中にエラーが発生しました: ${e.message}`, 'error');
        }
    }

    // =========================================================================
    // SECTION 7: リアルタイム入力検証 & UIフィードバック (Real-time Validation & Feedback)
    // =========================================================================

    const inputFeedback = document.getElementById('input-feedback');
    const feedbackIcon = inputFeedback.querySelector('.feedback-icon');
    const feedbackText = inputFeedback.querySelector('.feedback-text');
    const feedbackPopup = document.getElementById('feedback-popup');
    let validationTimeout;
    let collapseTimeout;
    let currentFeedbackMessage = '';

    function showFeedback(icon, message, type) {
        currentFeedbackMessage = message;
        feedbackIcon.textContent = icon;

        const marqueeContent = feedbackText.querySelector('.marquee-content');
        marqueeContent.textContent = message;
        marqueeContent.classList.remove('animate');
        marqueeContent.style.setProperty('--scroll-dist', '0px');

        inputFeedback.style.display = 'flex';
        inputFeedback.className = `input-feedback ${type} pop-in`;

        setTimeout(() => {
            inputFeedback.classList.add('expanded');
            setTimeout(() => {
                const scrollWidth = marqueeContent.scrollWidth;
                const containerWidth = feedbackText.clientWidth;

                if (scrollWidth > containerWidth) {
                    const dist = containerWidth - scrollWidth;
                    const duration = Math.max(1.5, scrollWidth / 100);
                    marqueeContent.style.setProperty('--scroll-dist', `${dist}px`);
                    marqueeContent.style.setProperty('--scroll-duration', `${duration}s`);
                    marqueeContent.classList.add('animate');
                    scheduleCollapse(duration * 1000 + 2000);
                } else {
                    scheduleCollapse(3000);
                }
            }, 500);
        }, 150);
    }

    function scheduleCollapse(delay) {
        clearTimeout(collapseTimeout);
        collapseTimeout = setTimeout(() => {
            inputFeedback.classList.remove('expanded');
            inputFeedback.classList.add('collapsed');
        }, delay);
    }

    function hideFeedback() {
        inputFeedback.style.display = 'none';
        feedbackPopup.classList.remove('visible');
    }

    // 折りたたみフィードバックのクリックでツールチップ展開
    inputFeedback.addEventListener('click', (e) => {
        e.stopPropagation();
        if (inputFeedback.classList.contains('collapsed')) {
            feedbackPopup.textContent = currentFeedbackMessage;
            feedbackPopup.classList.toggle('visible');
        }
    });

    document.addEventListener('click', () => {
        feedbackPopup.classList.remove('visible');
    });

    idInput.addEventListener('input', () => {
        clearTimeout(validationTimeout);
        feedbackPopup.classList.remove('visible');

        const inputValue = idInput.value.replace(/\s+/g, '');
        if (!inputValue) {
            hideFeedback();
            return;
        }

        validationTimeout = setTimeout(() => {
            const isStatus = ['status-', 's4-', 'c4-', 's3-', 'c3-'].some(p => inputValue.startsWith(p));
            if (isStatus) {
                showFeedback('📊', 'ステータスデータを検出（実行でプレビュー表示）', 'success');
                return;
            }

            const result = parseId(inputValue);
            if (result.success) {
                showFeedback('✅', '入力IDの形式が正しいです', 'success');
            } else if (result.corrected) {
                showFeedback('⚠️', '自動修正が可能です（ボタンを押して確認）', 'warning');
            } else {
                showFeedback('❌', result.error || '形式が正しくありません', 'error');
            }
        }, 500);
    });

    idInput.addEventListener('paste', () => {
        setTimeout(() => idInput.dispatchEvent(new Event('input')), 10);
    });

    // 編集中の誤離脱防止
    let hasUnsavedChanges = false;
    window.addEventListener('beforeunload', (e) => {
        if (hasUnsavedChanges && state.selectedSlots.size > 0) {
            const message = '選択した時間がまだ確定されていません。ページを離れてもよろしいですか？';
            e.preventDefault();
            e.returnValue = message;
            return message;
        }
    });

    // =========================================================================
    // SECTION 8: ドラッグ選択 & タッチ操作 (Drag Selection & Touch Interactions)
    // =========================================================================

    // PC マウスドラッグ選択
    scheduleGrid.addEventListener('mousedown', (e) => {
        const slot = e.target.closest('.time-slot');
        if (slot && !slot.classList.contains('disabled-slot')) {
            e.preventDefault();
            state.isMouseDown = true;
            state.isSelecting = !slot.classList.contains('selected');
            state.lastMouseSlot = slot;
            toggleSlotSelection(slot);
        }
    });

    scheduleGrid.addEventListener('mouseover', (e) => {
        const slot = e.target.closest('.time-slot');
        if (state.isMouseDown && slot && slot !== state.lastMouseSlot && !slot.classList.contains('disabled-slot')) {
            // 高速移動時の抜け漏れを Bresenham アルゴリズムで補間
            if (state.lastMouseSlot) {
                fillSelectionGap(state.lastMouseSlot, slot);
            }

            if (state.isSelecting) {
                selectSlot(slot);
            } else {
                deselectSlot(slot);
            }
            state.lastMouseSlot = slot;
        }
    });

    document.addEventListener('mouseup', () => {
        state.isMouseDown = false;
        state.lastMouseSlot = null;
    });

    /** Bresenhamの直線描画アルゴリズムを応用し、2スロット間の軌跡セルを漏れなく補間 */
    function fillSelectionGap(startSlot, endSlot) {
        let x1 = parseInt(startSlot.dataset.dayIdx, 10);
        let y1 = parseInt(startSlot.dataset.hourIdx, 10);
        const x2 = parseInt(endSlot.dataset.dayIdx, 10);
        const y2 = parseInt(endSlot.dataset.hourIdx, 10);

        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return;

        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const sx = (x1 < x2) ? 1 : -1;
        const sy = (y1 < y2) ? 1 : -1;
        let err = dx - dy;

        while (true) {
            const slot = scheduleGrid.querySelector(`.time-slot[data-day-idx="${x1}"][data-hour-idx="${y1}"]`);
            if (slot && !slot.classList.contains('disabled-slot')) {
                if (state.isSelecting) {
                    selectSlot(slot);
                } else {
                    deselectSlot(slot);
                }
            }

            if (x1 === x2 && y1 === y2) break;
            const e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x1 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y1 += sy;
            }
        }
    }

    // PC ホイール横スクロール (Shiftキー不要で直感スクロール)
    scheduleGrid.addEventListener('wheel', (e) => {
        if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            scheduleGrid.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    // モバイル タッチ操作 (タップ / 長押しドラッグ選択 / スクロール共存)
    let lastTouchedSlot = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isLongPress = false;
    let longPressTimer = null;
    let touchOnSlot = false;
    const LONG_PRESS_DURATION = 400; // 長押し判定閾値 (ms)
    const MOVE_THRESHOLD = 10;        // スクロール判定移動量 (px)

    // 長押し時のコンテキストメニュー（スマホ・PC共通）を無効化する
    scheduleGrid.addEventListener('contextmenu', (e) => {
        const slot = e.target.closest('.time-slot');
        if (slot) {
            e.preventDefault();
        }
    });

    scheduleGrid.addEventListener('touchstart', (e) => {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchStartTime = Date.now();
        isLongPress = false;
        touchOnSlot = false;

        const slot = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.time-slot');
        if (slot && !slot.classList.contains('disabled-slot')) {
            touchOnSlot = true;
            lastTouchedSlot = slot;
            isSelecting = !slot.classList.contains('selected');

            longPressTimer = setTimeout(() => {
                isLongPress = true;
                isMouseDown = true;
                if (navigator.vibrate) navigator.vibrate(40);
                // 長押し確定: そのセルを選択/解除
                if (isSelecting) {
                    selectSlot(slot);
                } else {
                    deselectSlot(slot);
                }
            }, LONG_PRESS_DURATION);
        }
    });

    scheduleGrid.addEventListener('touchmove', (e) => {
        if (!touchOnSlot) return;

        // 長押し確定後 → 常にスクロール抑制 & ドラッグ選択
        if (isLongPress && isMouseDown) {
            e.preventDefault();
            const touch = e.touches[0];
            const slot = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('.time-slot');
            if (slot && slot !== lastTouchedSlot && !slot.classList.contains('disabled-slot')) {
                if (isSelecting) {
                    selectSlot(slot);
                } else {
                    deselectSlot(slot);
                }
                if (navigator.vibrate) navigator.vibrate(15);
                lastTouchedSlot = slot;
            }
            return;
        }

        // 長押し前に動いた → スクロール意図。タイマーキャンセル
        const touch = e.touches[0];
        const deltaX = Math.abs(touch.clientX - touchStartX);
        const deltaY = Math.abs(touch.clientY - touchStartY);
        if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            touchOnSlot = false;
        }
    }, { passive: false });

    scheduleGrid.addEventListener('touchend', (e) => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        if (touchOnSlot && !isLongPress && lastTouchedSlot) {
            const touch = e.changedTouches[0];
            const deltaX = Math.abs(touch.clientX - touchStartX);
            const deltaY = Math.abs(touch.clientY - touchStartY);
            const didMove = deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD;

            // タップ: 動いていなければトグル
            if (!didMove) {
                e.preventDefault();
                toggleSlotSelection(lastTouchedSlot);
                if (navigator.vibrate) navigator.vibrate(10);
            }
        }

        isMouseDown = false;
        isLongPress = false;
        lastTouchedSlot = null;
        touchOnSlot = false;
    });

    // スクロールナビゲーションボタン
    const scrollLeftBtn = document.getElementById('scroll-left-btn');
    const scrollRightBtn = document.getElementById('scroll-right-btn');
    const scrollIndicator = document.querySelector('.scroll-indicator');
    const SCROLL_AMOUNT = 200; // pixels

    // Update button states based on scroll position and visibility
    function updateScrollButtons() {
        if (!scrollLeftBtn || !scrollRightBtn) return;

        const scrollLeft = scheduleGrid.scrollLeft;
        const maxScroll = scheduleGrid.scrollWidth - scheduleGrid.clientWidth;
        const needsScroll = maxScroll > 10; // Only show if there's meaningful scroll

        // Show/hide buttons based on whether scrolling is needed
        if (needsScroll) {
            if (scrollIndicator) scrollIndicator.style.display = 'block';

            // Hide button when at scroll limit, show otherwise
            scrollLeftBtn.style.display = scrollLeft <= 0 ? 'none' : 'flex';
            scrollRightBtn.style.display = scrollLeft >= maxScroll - 1 ? 'none' : 'flex';
        } else {
            scrollLeftBtn.style.display = 'none';
            scrollRightBtn.style.display = 'none';
            if (scrollIndicator) scrollIndicator.style.display = 'none';
        }
    }

    if (scrollLeftBtn && scrollRightBtn) {
        scrollLeftBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scheduleGrid.scrollBy({ left: -SCROLL_AMOUNT, behavior: 'smooth' });
        });

        scrollRightBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            scheduleGrid.scrollBy({ left: SCROLL_AMOUNT, behavior: 'smooth' });
        });

        scheduleGrid.addEventListener('scroll', updateScrollButtons);

        // Initial state - hide until needed
        scrollLeftBtn.style.display = 'none';
        scrollRightBtn.style.display = 'none';
    }

    // Hide scroll hint after first interaction
    const scrollHint = document.querySelector('.scroll-hint');
    if (scrollHint) {
        const hideHint = () => {
            scrollHint.style.opacity = '0';
            setTimeout(() => {
                if (scrollHint.parentElement) scrollHint.parentElement.style.display = 'none';
            }, 300);
        };


        scheduleGrid.addEventListener('scroll', hideHint, { once: true });
        scheduleGrid.addEventListener('touchstart', hideHint, { once: true });
    }


    // =========================================================================
    // SECTION 9: スケジュール表の生成 & 描画 (Schedule Grid Generation & Rendering)
    // =========================================================================

    function handleGenerateSchedule() {
        const idValue = idInput.value.trim();
        const result = parseId(idValue);

        if (!result.success) {
            // エラーメッセージを表示
            const errorMsg = [
                '❌ 入力IDの形式が正しくありません。',
                '',
                result.error,
                '',
                '📋 正しい形式:',
                'ユーザーID_開始日-終了日_識別子',
                '',
                '✅ 入力例:',
                '1234567890_20240710-20240717_meeting',
            ].join('\n');
            alert(errorMsg);
            return;
        }

        // 自動修正が行われた場合は通知
        if (result.corrected) {
            const confirmMsg = [
                '✏️ 入力IDを自動修正しました:',
                '',
                `修正前: ${idValue}`,
                `修正後: ${result.correctedValue}`,
                '',
                'この内容で続行しますか?',
            ].join('\n');

            if (!confirm(confirmMsg)) {
                return;
            }

            // 修正後の値を入力欄に反映
            idInput.value = result.correctedValue;
        }

        // Reset state for new generation
        state.selectedSlots.clear();
        hasUnsavedChanges = false;

        // URLからの初期スロット読み込み (初回のみ)
        if (!window.__slotsParsed) {
            const urlParams = new URLSearchParams(window.location.search);
            const slotsFromUrl = urlParams.get('s') || urlParams.get('slots');
            if (slotsFromUrl) {
                try {
                    const decodedSlots = decodeSlotsBitmask(state.startDate, state.endDate, slotsFromUrl);
                    decodedSlots.forEach(slot => state.selectedSlots.add(slot));
                    if (decodedSlots.length > 0) hasUnsavedChanges = true;
                } catch (e) {
                    console.error("Failed to decode slots from URL:", e);
                }
            }

            const allowedFromUrl = urlParams.get('a') || urlParams.get('allowed');
            if (allowedFromUrl) {
                try {
                    const decodedAllowed = decodeSlotsBitmask(state.startDate, state.endDate, allowedFromUrl);
                    state.allowedSlots = new Set(decodedAllowed);
                } catch (e) {
                    console.error("Failed to decode allowed slots from URL:", e);
                    state.allowedSlots = null;
                }
            } else {
                state.allowedSlots = null;
            }

            const statusFromUrl = urlParams.get('c') || urlParams.get('status');
            if (statusFromUrl) {
                try {
                    const decodedStatus = decodeCompressedData(statusFromUrl);
                    if (decodedStatus) {
                        if (decodedStatus.v === 3 && decodedStatus.vote_counts) {
                            state.voteCounts = { ...decodedStatus.vote_counts };
                        } else if (decodedStatus.v === 2 && decodedStatus.p) {
                            state.voteCounts = {};
                            decodedStatus.p.forEach(participant => {
                                const [pid, name, bitmask] = participant;
                                const slots = decodeSlotsBitmask(state.startDate, state.endDate, bitmask);
                                slots.forEach(slot => {
                                    state.voteCounts[slot] = (state.voteCounts[slot] || 0) + 1;
                                });
                            });
                        }
                    }
                } catch (e) {
                    console.error("Failed to decode status from URL:", e);
                }
            }

            window.__slotsParsed = true;
            // URLからパラメータを消去してリロード時などの再適用を防ぐ
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('s');
            newUrl.searchParams.delete('slots');
            newUrl.searchParams.delete('a');
            newUrl.searchParams.delete('allowed');
            newUrl.searchParams.delete('c');
            newUrl.searchParams.delete('status');
            window.history.replaceState({}, '', newUrl);
        }

        updateSelectionCounter();

        // Populate dates
        state.allDates = getDatesInRange(state.startDate, state.endDate);

        // プレビューモードを非表示、登録モードを表示
        previewMode.style.display = 'none';
        registerMode.style.display = 'block';
        setHeaderMessage('参加可能な時間をタップして選択');

        // Show the schedule and output areas
        scheduleContainer.style.display = 'block';
        outputArea.style.display = 'flex';

        renderSchedule();

        // Googleカレンダー自動同期が有効な場合は自動取得
        if (localStorage.getItem('gcal_auto_sync') === 'true') {
            tryAutoSyncGcal();
        }
    }

    function parseId(id) {
        // 結果オブジェクトを返す形式に変更
        const result = {
            success: false,
            corrected: false,
            correctedValue: null,
            error: null
        };

        if (!id || typeof id !== 'string') {
            result.error = '入力IDが空です。Botが発行したIDを貼り付けてください。';
            return result;
        }

        // 前後の空白や改行、特殊文字を除去
        let cleanId = id.trim();
        const originalId = cleanId;

        // よくある問題: コードブロック記号、バッククォート、引用符を除去
        cleanId = cleanId.replace(/^[`"'\[\]{}()]+|[`"'\[\]{}()]+$/g, '');

        // 複数行に分かれている場合は最初の行のみを使用
        if (cleanId.includes('\n')) {
            const lines = cleanId.split('\n').filter(line => line.trim());
            cleanId = lines[0].trim();
        }

        // マークダウンのコードブロック内のIDを抽出
        const codeBlockMatch = cleanId.match(/```[\s\S]*?([0-9]+_[0-9]{8}-[0-9]{8}_[A-Za-z0-9_-]+)[\s\S]*?```/);
        if (codeBlockMatch) {
            cleanId = codeBlockMatch[1];
        }

        // インラインコード内のIDを抽出
        const inlineCodeMatch = cleanId.match(/`([^`]+)`/);
        if (inlineCodeMatch) {
            cleanId = inlineCodeMatch[1];
        }

        // URL形式で貼り付けられた場合の処理
        if (cleanId.includes('http')) {
            // URLパラメータやフラグメントからIDを抽出
            const urlMatch = cleanId.match(/[?&#](?:id|token)=([^&\s]+)/);
            if (urlMatch) {
                cleanId = decodeURIComponent(urlMatch[1]);
            }
        }

        // 再度トリミング
        cleanId = cleanId.trim();

        // 修正が行われたかチェック
        if (cleanId !== originalId) {
            result.corrected = true;
            result.correctedValue = cleanId;
        }

        // 基本的な形式チェック: ユーザーID_日付範囲_識別子
        const idPattern = /^(\d+)_(\d{8})-(\d{8})_([A-Za-z0-9][A-Za-z0-9_-]{2,31})$/;
        const match = cleanId.match(idPattern);

        if (!match) {
            // より詳細なエラーメッセージを提供
            const parts = cleanId.split('_');

            if (parts.length < 3) {
                result.error = `アンダースコア(_)で区切られた3つの部分が必要です。\n現在: ${parts.length}個の部分が検出されました。`;
                return result;
            }

            // ユーザーIDのチェック
            if (!/^\d+$/.test(parts[0])) {
                result.error = `最初の部分（ユーザーID）は数字のみである必要があります。\n現在: "${parts[0]}"`;
                return result;
            }

            // 日付範囲のチェック
            const datePart = parts[1];
            if (!/^\d{8}-\d{8}$/.test(datePart)) {
                result.error = `2番目の部分（日付範囲）は "YYYYMMDD-YYYYMMDD" 形式である必要があります。\n現在: "${datePart}"`;
                return result;
            }

            // 識別子のチェック
            const identifierPart = parts.slice(2).join('_');
            if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(identifierPart)) {
                result.error = `3番目の部分（識別子）は英数字で始まり、3〜32文字である必要があります。\n現在: "${identifierPart}"`;
                return result;
            }

            result.error = '入力IDの形式が正しくありません。Botが発行したIDをそのまま貼り付けてください。';
            return result;
        }

        const userId = match[1];
        const startDateStr = match[2];
        const endDateStr = match[3];
        const identifier = match[4];

        // 日付の妥当性チェック
        const startDate = new Date(`${startDateStr.slice(0, 4)}-${startDateStr.slice(4, 6)}-${startDateStr.slice(6, 8)}T00:00:00`);
        const endDate = new Date(`${endDateStr.slice(0, 4)}-${endDateStr.slice(4, 6)}-${endDateStr.slice(6, 8)}T00:00:00`);

        if (isNaN(startDate.getTime())) {
            result.error = `開始日が無効です: ${startDateStr}\n正しい日付形式で入力されているか確認してください。`;
            return result;
        }

        if (isNaN(endDate.getTime())) {
            result.error = `終了日が無効です: ${endDateStr}\n正しい日付形式で入力されているか確認してください。`;
            return result;
        }

        if (startDate > endDate) {
            result.error = `開始日が終了日より後になっています。\n開始: ${startDateStr}\n終了: ${endDateStr}`;
            return result;
        }

        // 日付範囲が妥当かチェック（例：1年以上離れている場合は警告）
        const daysDiff = Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > 365) {
            result.error = `日付範囲が長すぎます（${daysDiff}日）。\n1年以内の範囲で指定してください。`;
            return result;
        }

        // 成功: 状態を更新
        state.startDate = startDate;
        state.endDate = endDate;
        state.discordUserId = userId;
        state.identifier = cleanId; // 修正後のIDを使用

        result.success = true;
        return result;
    }

    function getDatesInRange(start, end) {
        const dates = [];
        let currentDate = new Date(start);
        while (currentDate <= end) {
            dates.push(new Date(currentDate));
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return dates;
    }

    function decodeSlotsBitmask(startDate, endDate, bitmaskB64) {
        if (!bitmaskB64) return [];
        if (bitmaskB64.startsWith('B4:')) {
            return decodeUltraCompactSubmission(startDate, endDate, bitmaskB64, (state && state.mode) || 'time');
        }
        const sd = new Date(startDate);
        const ed = new Date(endDate);
        const totalDays = Math.floor((ed - sd) / (1000 * 60 * 60 * 24)) + 1;
        let standard = bitmaskB64.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';
        const binaryStr = atob(standard);
        const bitmask = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bitmask[i] = binaryStr.charCodeAt(i);
        }

        const slots = [];
        for (let day = 0; day < totalDays; day++) {
            const d = new Date(sd);
            d.setDate(d.getDate() + day);
            const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

            for (let hour = 0; hour < 24; hour++) {
                const bitIndex = day * 24 + hour;
                const byteIndex = Math.floor(bitIndex / 8);
                if (byteIndex < bitmask.length && (bitmask[byteIndex] & (1 << (7 - (bitIndex % 8))))) {
                    slots.push(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
                }
            }
        }
        return slots;
    }

    function validateSelectedTimes(times) {
        const result = { valid: true, error: null };

        if (!Array.isArray(times)) {
            result.valid = false;
            result.error = '選択された時間が配列ではありません。';
            return result;
        }

        const periodStart = state.startDate;
        const periodEnd = state.endDate;

        if (!periodStart || !periodEnd) {
            result.valid = false;
            result.error = '期間の開始日または終了日が設定されていません。';
            return result;
        }

        for (let i = 0; i < times.length; i++) {
            const slot = times[i];

            // 文字列であることを確認
            if (typeof slot !== 'string') {
                result.valid = false;
                result.error = `${i + 1}番目の時間が文字列ではありません: ${typeof slot}`;
                return result;
            }

            // ISO8601形式であることを確認
            const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
            if (!isoPattern.test(slot)) {
                result.valid = false;
                result.error = `${i + 1}番目の時間がISO8601形式ではありません: ${slot}\n正しい形式: YYYY-MM-DDTHH:MM:SS`;
                return result;
            }

            // 日付として解析可能か確認
            let dt;
            try {
                dt = new Date(slot);
                if (isNaN(dt.getTime())) {
                    throw new Error('無効な日付');
                }
            } catch (e) {
                result.valid = false;
                result.error = `${i + 1}番目の時間を解析できません: ${slot}`;
                return result;
            }

            // 分と秒が00であることを確認（1時間単位）
            const timePart = slot.split('T')[1];
            if (!timePart.endsWith(':00:00')) {
                result.valid = false;
                result.error = `${i + 1}番目の時間が1時間単位ではありません: ${slot}\n時間は00:00単位で指定してください（例: 14:00:00）`;
                return result;
            }

            // 期間内であることを確認
            const slotDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            const startDate = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
            const endDate = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());

            if (slotDate < startDate || slotDate > endDate) {
                const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
                const formatDate = (d) => `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${daysOfWeek[d.getDay()]})`;
                result.valid = false;
                result.error = `${i + 1}番目の時間が対象期間外です: ${slot}\n対象期間: ${formatDate(startDate)} ～ ${formatDate(endDate)}`;
                return result;
            }
        }

        return result;
    }

    function buildConfirmationMessage(times) {
        const count = times.length;
        if (count === 0) {
            return '参加可能な時間がないことを登録します。よろしいですか？';
        }

        const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
        const preview = times.slice(0, 5).map(t => {
            const dt = new Date(t);
            return `  ${dt.getMonth() + 1}/${dt.getDate()}(${daysOfWeek[dt.getDay()]}) ${String(dt.getHours()).padStart(2, '0')}:00`;
        }).join('\n');

        const moreText = count > 5 ? `\n  … 他 ${count - 5} 件` : '';

        return `📝 以下の内容で登録します:\n\n` +
            `選択数: ${count}件\n\n` +
            `最初の候補:\n${preview}${moreText}\n\n` +
            `よろしいですか？`;
    }

    function renderSchedule() {
        // Render ALL dates at once for continuous scrolling
        const datesToShow = state.allDates;

        if (datesToShow.length === 0) {
            scheduleGrid.innerHTML = '<p>表示する日付がありません。</p>';
            return;
        }

        const table = document.createElement('table');
        table.className = 'schedule-table';

        // ヘッダー行の生成（日付・曜日・祝日ハイライト）
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headerCorner = headerRow.insertCell();
        headerCorner.className = 'time-header-cell';
        headerCorner.innerHTML = ''; // Empty - 00:00 will be in first boundary row like 24:00

        const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
        datesToShow.forEach((date, dayIdx) => {
            const th = document.createElement('th');
            th.className = 'date-header-cell';
            const holidayName = getJapaneseHolidayName(date);
            const dayOfWeek = date.getDay();
            if (holidayName || dayOfWeek === 0) {
                th.classList.add('sunday');
                if (holidayName) {
                    th.classList.add('holiday');
                    th.title = holidayName;
                }
            } else if (dayOfWeek === 6) {
                th.classList.add('saturday');
            }
            th.innerHTML = `${date.getMonth() + 1}/${date.getDate()}<br><span class="day-name">(${daysOfWeek[dayOfWeek]})</span>`;
            headerRow.appendChild(th);
        });

        // スロット行の生成（時間枠セル・Google予定重複反映）
        const tbody = table.createTBody();

        // Add spacer row at top to create symmetry with 24:00 row at bottom
        const topSpacerRow = tbody.insertRow();
        const topSpacerLabelCell = topSpacerRow.insertCell();
        topSpacerLabelCell.className = 'time-label-cell spacer';
        datesToShow.forEach(() => {
            const cell = topSpacerRow.insertCell();
            cell.className = 'spacer-cell';
        });

        // Create rows for each hour from 0 to 23
        for (let hour = 0; hour < 24; hour++) {
            // Single row per hour: time label on left, slots on right
            const slotRow = tbody.insertRow();

            // Time label cell with the hour
            const labelCell = slotRow.insertCell();
            labelCell.className = 'time-label-cell';
            labelCell.innerHTML = `<span>${String(hour).padStart(2, '0')}:00</span>`;

            datesToShow.forEach((date, dayIdx) => {
                const slotCell = slotRow.insertCell();
                slotCell.className = 'time-slot';
                const isoDateTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00`;
                slotCell.dataset.datetime = isoDateTime;
                slotCell.dataset.dayIdx = dayIdx;
                slotCell.dataset.hourIdx = hour;

                if (state.allowedSlots && !state.allowedSlots.has(isoDateTime)) {
                    slotCell.classList.add('disabled-slot');
                } else {
                    if (state.selectedSlots.has(isoDateTime)) {
                        slotCell.classList.add('selected');
                    }
                }

                const count = state.voteCounts[isoDateTime];
                if (count > 0) {
                    const badge = document.createElement('div');
                    badge.className = 'slot-count';
                    badge.innerHTML = `${count}人`;
                    slotCell.appendChild(badge);
                }
            });
        }

        // Add a final row for 24:00 label at the very bottom
        const finalRow = tbody.insertRow();
        const finalLabelCell = finalRow.insertCell();
        finalLabelCell.className = 'time-label-cell final';
        finalLabelCell.innerHTML = '<span>24:00</span>';
        // Empty cells for alignment
        datesToShow.forEach(() => {
            const cell = finalRow.insertCell();
            cell.className = 'final-cell';
        });

        scheduleGrid.innerHTML = '';
        scheduleGrid.appendChild(table);

        updateControls(datesToShow);

        // グリッド描画完了後にスクロールボタンの表示状態を更新
        setTimeout(() => {
            scheduleGrid.dispatchEvent(new Event('scroll'));
        }, 50);
    }

    function updateControls(datesToShow) {
        // Update period display: Show the FULL range
        const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
        const firstDate = datesToShow[0];
        const lastDate = datesToShow[datesToShow.length - 1];
        currentPeriodDisplay.textContent = `${firstDate.getMonth() + 1}/${firstDate.getDate()}(${daysOfWeek[firstDate.getDay()]}) - ${lastDate.getMonth() + 1}/${lastDate.getDate()}(${daysOfWeek[lastDate.getDay()]})`;

        // Navigation buttons are hidden so no need to update their state
    }

    function toggleSlotSelection(slot) {
        const datetime = slot.dataset.datetime;
        if (state.selectedSlots.has(datetime)) {
            deselectSlot(slot);
        } else {
            selectSlot(slot);
        }
    }

    function selectSlot(slot) {
        const datetime = slot.dataset.datetime;
        slot.classList.add('selected');
        state.selectedSlots.add(datetime);
        hasUnsavedChanges = true;
        updateSelectionCounter();
    }

    function deselectSlot(slot) {
        const datetime = slot.dataset.datetime;
        slot.classList.remove('selected');
        state.selectedSlots.delete(datetime);
        hasUnsavedChanges = true;
        updateSelectionCounter();
    }

    function updateSelectionCounter() {
        const count = state.selectedSlots.size;

        // タイトルバーに表示
        if (count > 0) {
            document.title = `(${count}件選択中) Schedule Coordinator`;
        } else {
            document.title = 'Schedule Coordinator';
        }

        // 画面内のカウンター表示を更新
        const counter = document.getElementById('selection-counter');
        if (counter) {
            counter.textContent = `選択: ${count}件`;
            counter.style.color = count > 0 ? 'var(--selection-color)' : 'var(--text-secondary)';
            counter.style.fontWeight = count > 0 ? 'bold' : 'normal';
        }
    }

    // =========================================================================
    // SECTION 10: 確定処理 & クリップボード・トースト (Confirmation, Copy & Toast Feedback)
    // =========================================================================

    function handleConfirm() {
        try {
            // 基本検証
            if (!state.identifier) {
                showError(
                    '❌ スケジュールが初期化されていません',
                    '再度「スケジュールを作成」ボタンから開始してください。'
                );
                return;
            }

            // 選択された時間の配列を作成
            const selectedTimes = Array.from(state.selectedSlots).sort();

            // 選択数の確認（警告のみ）
            if (selectedTimes.length === 0) {
                const confirmEmpty = confirm(
                    '⚠️ 時間帯が1つも選択されていません。\n\n' +
                    '「参加可能な時間がない」ことを共有する場合は「OK」を押してください。\n' +
                    '時間を選択する場合は「キャンセル」を押してください。'
                );
                if (!confirmEmpty) {
                    return;
                }
            }

            // 大量選択の警告
            if (selectedTimes.length > 300) { // Increased limit for full week/month
                if (!confirm(
                    `⚠️ ${selectedTimes.length}件の時間帯が選択されています。\n\n` +
                    'これは非常に多い選択数です。続行しますか？'
                )) {
                    return;
                }
            }

            // 時間の形式と範囲を検証
            const validationResult = validateSelectedTimes(selectedTimes);
            if (!validationResult.valid) {
                showError('❌ 選択された時間に問題があります', validationResult.error);
                return;
            }

            // データオブジェクトを構築（BOTが期待する形式）
            const data = {
                discordUserId: state.discordUserId,
                id: state.identifier,
                selectedTimes: selectedTimes
            };

            // データの完全性チェック
            if (!data.discordUserId || !data.id) {
                showError(
                    '❌ 必要なデータが不足しています',
                    'DiscordユーザーIDまたは入力IDが見つかりません。\n再度スケジュールを作成してください。'
                );
                return;
            }

            // v4 超高圧縮（アダプティブ方式: Sparse / RLE / Deflate / Raw / Empty / All）でエンコード
            let base64String;
            try {
                base64String = encodeUltraCompactSubmission(selectedTimes, state.startDate, state.endDate, state.mode || 'time');
            } catch (encodeError) {
                console.warn('v4 encode failed, falling back to v2:', encodeError);
                try {
                    const bitmaskB64 = encodeBitmask(selectedTimes, state.startDate, state.endDate);
                    base64String = 'B:' + bitmaskB64;
                } catch (fallbackError) {
                    showError(
                        '❌ データのエンコードに失敗しました',
                        `エラー詳細: ${encodeError.message}\n\n` +
                        'ページを再読み込みしてお試しください。'
                    );
                    return;
                }
            }


            // 確認ダイアログ
            const confirmMessage = buildConfirmationMessage(selectedTimes);
            if (!confirm(confirmMessage)) {
                return;
            }

            // 出力用テキストエリアに値をセット（内部的なコピー用）
            outputStringTextarea.value = base64String;

            // 自動コピーを実行
            handleCopy();

            // ローカルストレージに保存（バックアップ）
            saveToLocalStorage(data, base64String);

            // 成功メッセージ
            showSuccess(
                `✅ 出力を生成し、クリップボードにコピーしました！（${selectedTimes.length}件の候補）\n\n` +
                'Discordの「結果を登録」ボタンに貼り付けてください。'
            );

        } catch (error) {
            console.error('handleConfirm error:', error);
            showError(
                '❌ 予期しないエラーが発生しました',
                `エラー詳細: ${error.message}\n\n` +
                'ページを再読み込みして、もう一度お試しください。'
            );
        }
    }

    function handleCopy() {
        try {
            const textToCopy = outputStringTextarea.value;

            if (!textToCopy) {
                showError('❌ コピーする内容がありません', '先に「確定」ボタンを押してください。');
                return;
            }

            // モダンなクリップボードAPIを試行
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(textToCopy)
                    .then(() => {
                        const originalText = confirmBtn.textContent;
                        confirmBtn.textContent = '✅ コピー完了!';
                        confirmBtn.style.backgroundColor = 'var(--selection-color)';
                        setHeaderMessage('Discordの「結果を登録」ボタンに貼り付けてください');
                        setTimeout(() => {
                            confirmBtn.textContent = originalText;
                            confirmBtn.style.backgroundColor = '';
                        }, 2000);
                    })
                    .catch(err => {
                        console.error('Clipboard API failed:', err);
                        fallbackCopy(textToCopy);
                    });
            } else {
                // フォールバック
                fallbackCopy(textToCopy);
            }
        } catch (error) {
            console.error('Copy error:', error);
            showError('❌ コピーに失敗しました', `エラー: ${error.message}\n手動でテキストを選択してコピーしてください。`);
        }
    }

    function fallbackCopy(text) {
        try {
            outputStringTextarea.select();
            outputStringTextarea.setSelectionRange(0, text.length);
            const success = document.execCommand('copy');

            if (success) {
                const originalText = confirmBtn.textContent;
                confirmBtn.textContent = '✅ コピー完了!';
                confirmBtn.style.backgroundColor = 'var(--selection-color)';
                setHeaderMessage('Discordの「結果を登録」ボタンに貼り付けてください');
                setTimeout(() => {
                    confirmBtn.textContent = originalText;
                    confirmBtn.style.backgroundColor = '';
                }, 2000);
            } else {
                throw new Error('execCommandが失敗しました');
            }
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert(
                '⚠️ 自動コピーに失敗しました。\n\n' +
                'テキストエリアの内容を手動で選択してコピーしてください。\n' +
                '（Ctrl+A → Ctrl+C）'
            );
        }
    }

    function showError(title, message) {
        showToast(`${title}: ${message}`, 'error');
        console.error('[Error]', title, message);
    }

    function showSuccess(message) {
        showToast(message, 'success');
        console.log('[Success]', message);
    }

    function showToast(message, type = 'info') {
        const existingToasts = document.querySelectorAll('.toast');
        existingToasts.forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️';
        toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${message.replace(/\n/g, ' ')}</span>`;
        document.body.appendChild(toast);

        // Force reflow
        toast.offsetHeight;

        toast.classList.add('visible');

        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3500);
    }

    function saveToLocalStorage(data, base64) {
        try {
            if (typeof localStorage === 'undefined') {
                return; // ローカルストレージ非対応の場合は無視
            }

            const backup = {
                data: data,
                base64: base64,
                timestamp: new Date().toISOString(),
                identifier: state.identifier
            };

            localStorage.setItem('schedule_last_submission', JSON.stringify(backup));

            // 古いバックアップを削除（最大5件まで保持）
            const allKeys = Object.keys(localStorage).filter(k => k.startsWith('schedule_backup_'));
            if (allKeys.length > 5) {
                allKeys.sort().slice(0, allKeys.length - 5).forEach(k => localStorage.removeItem(k));
            }
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
            // ローカルストレージエラーは無視（容量制限など）
        }
    }

    function loadFromLocalStorage() {
        try {
            if (typeof localStorage === 'undefined') {
                return null;
            }

            const backup = localStorage.getItem('schedule_last_submission');
            if (!backup) {
                return null;
            }

            return JSON.parse(backup);
        } catch (error) {
            console.warn('Failed to load from localStorage:', error);
            return null;
        }
    }

    // =========================================================================
    // SECTION 11: 高圧縮バイナリエンコード / デコード (Binary Compression Codecs)
    // =========================================================================
    // v4 (B4/s4/c4): Varint + Sparse/RLE/Deflate アダプティブ圧縮
    // v3 (s3/c3): 固定長バイナリ + zlib
    // v2 (B/status): Bitmask Base64 (後方互換用)

    /** LEB128 可変長整数 (Varint) エンコード */
    function encodeVarint(n) {
        const bytes = [];
        while (n >= 0x80) {
            bytes.push((n & 0x7F) | 0x80);
            n >>>= 7;
        }
        bytes.push(n & 0x7F);
        return new Uint8Array(bytes);
    }

    /**
     * LEB128 Varint デコード
     */
    function decodeVarint(bytes, offset = 0) {
        let res = 0;
        let shift = 0;
        let idx = offset;
        while (idx < bytes.length) {
            const b = bytes[idx++];
            res |= (b & 0x7F) << shift;
            if (!(b & 0x80)) {
                return [res, idx];
            }
            shift += 7;
        }
        throw new Error('Invalid varint');
    }

    /**
     * v4 超高圧縮 提出データエンコーダー
     * @param {string[]} selectedTimes - ISO日時文字列の配列
     * @param {Date} startDate - 期間開始日
     * @param {Date} endDate - 期間終了日
     * @param {string} mode - 'time' | 'date'
     * @returns {string} 'B4:' + Base64URL
     */
    function encodeUltraCompactSubmission(selectedTimes, startDate, endDate, mode = 'time') {
        const sd = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
        const ed = new Date(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()));
        const totalDays = Math.floor((ed - sd) / 86400000) + 1;
        const slotsPerDay = (mode === 'date') ? 1 : 24;
        const totalSlots = totalDays * slotsPerDay;

        const indicesSet = new Set();
        selectedTimes.forEach(slot => {
            const dt = new Date(slot.endsWith('Z') ? slot : slot + 'Z');
            const slotDate = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
            const dayOffset = Math.floor((slotDate - sd) / 86400000);
            if (dayOffset >= 0 && dayOffset < totalDays) {
                if (mode === 'date') {
                    indicesSet.add(dayOffset);
                } else {
                    const hour = dt.getUTCHours();
                    if (hour >= 0 && hour < 24) {
                        indicesSet.add(dayOffset * 24 + hour);
                    }
                }
            }
        });

        const indices = Array.from(indicesSet).sort((a, b) => a - b);

        function toBase64Url(u8Arr) {
            let binary = '';
            for (let i = 0; i < u8Arr.length; i++) binary += String.fromCharCode(u8Arr[i]);
            return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        // 1. 0件選択 (EMPTY)
        if (indices.length === 0) {
            return 'B4:' + toBase64Url(new Uint8Array([0x04, 0x00]));
        }

        // 2. 全選択 (ALL)
        if (indices.length === totalSlots) {
            return 'B4:' + toBase64Url(new Uint8Array([0x04, 0x01]));
        }

        const candidates = [];

        // 3. Sparse
        const sparseChunks = [[0x04, 0x02], Array.from(encodeVarint(indices.length))];
        let prev = 0;
        for (let i = 0; i < indices.length; i++) {
            const delta = (i === 0) ? indices[i] : (indices[i] - prev - 1);
            sparseChunks.push(Array.from(encodeVarint(delta)));
            prev = indices[i];
        }
        candidates.push(new Uint8Array(sparseChunks.flat()));

        // 4. Inverse Sparse
        const unselected = [];
        for (let i = 0; i < totalSlots; i++) {
            if (!indicesSet.has(i)) unselected.push(i);
        }
        const invChunks = [[0x04, 0x03], Array.from(encodeVarint(unselected.length))];
        prev = 0;
        for (let i = 0; i < unselected.length; i++) {
            const delta = (i === 0) ? unselected[i] : (unselected[i] - prev - 1);
            invChunks.push(Array.from(encodeVarint(delta)));
            prev = unselected[i];
        }
        candidates.push(new Uint8Array(invChunks.flat()));

        // 5. RLE
        const bitArray = [];
        for (let i = 0; i < totalSlots; i++) {
            bitArray.push(indicesSet.has(i) ? 1 : 0);
        }
        const runs = [];
        let currentBit = bitArray[0];
        let count = 0;
        for (const b of bitArray) {
            if (b === currentBit) count++;
            else {
                runs.push(count);
                currentBit = b;
                count = 1;
            }
        }
        runs.push(count);
        const rleChunks = [[0x04, 0x04, bitArray[0]]];
        for (const r of runs) {
            rleChunks.push(Array.from(encodeVarint(r)));
        }
        candidates.push(new Uint8Array(rleChunks.flat()));

        // 6. Raw Bitmask
        const rawBm = new Uint8Array(Math.ceil(totalSlots / 8));
        indices.forEach(idx => {
            rawBm[Math.floor(idx / 8)] |= (1 << (7 - (idx % 8)));
        });
        const rawFull = new Uint8Array(2 + rawBm.length);
        rawFull[0] = 0x04;
        rawFull[1] = 0x05;
        rawFull.set(rawBm, 2);
        candidates.push(rawFull);

        // 7. Deflate (pako)
        try {
            const deflated = pako.deflate(rawBm, { level: 9 });
            const deflateFull = new Uint8Array(2 + deflated.length);
            deflateFull[0] = 0x04;
            deflateFull[1] = 0x06;
            deflateFull.set(deflated, 2);
            candidates.push(deflateFull);
        } catch (e) {
            // ignore deflate error
        }

        let best = candidates[0];
        for (const c of candidates) {
            if (c.length < best.length) best = c;
        }

        return 'B4:' + toBase64Url(best);
    }

    /**
     * YYYYMMDD文字列に日数を加算したYYYY-MM-DD文字列を返す (タイムゾーン非依存)
     */
    function addDaysToYMD(ymdStr, dayOffset) {
        const clean = String(ymdStr).replace(/-/g, '').slice(0, 8);
        const y = parseInt(clean.slice(0, 4), 10);
        const m = parseInt(clean.slice(4, 6), 10) - 1;
        const d = parseInt(clean.slice(6, 8), 10);
        const dt = new Date(Date.UTC(y, m, d + dayOffset));
        const yyyy = dt.getUTCFullYear();
        const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(dt.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    /**
     * v4 超高圧縮 提出データデコーダー
     */
    function decodeUltraCompactSubmission(startDate, endDate, payload, mode = 'time') {
        const startYMD = (startDate instanceof Date) ?
            `${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}` :
            String(startDate).replace(/-/g, '').slice(0, 8);
        const endYMD = (endDate instanceof Date) ?
            `${endDate.getFullYear()}${String(endDate.getMonth() + 1).padStart(2, '0')}${String(endDate.getDate()).padStart(2, '0')}` :
            String(endDate).replace(/-/g, '').slice(0, 8);

        const sd = new Date(Date.UTC(parseInt(startYMD.slice(0, 4), 10), parseInt(startYMD.slice(4, 6), 10) - 1, parseInt(startYMD.slice(6, 8), 10)));
        const ed = new Date(Date.UTC(parseInt(endYMD.slice(0, 4), 10), parseInt(endYMD.slice(4, 6), 10) - 1, parseInt(endYMD.slice(6, 8), 10)));
        const totalDays = Math.floor((ed - sd) / 86400000) + 1;
        const slotsPerDay = (mode === 'date') ? 1 : 24;
        const totalSlots = totalDays * slotsPerDay;

        let cleaned = payload.trim();
        if (cleaned.startsWith('B4:')) cleaned = cleaned.slice(3);
        let standard = cleaned.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';

        const binaryString = atob(standard);
        const data = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) data[i] = binaryString.charCodeAt(i);

        if (data.length < 2 || data[0] !== 0x04) {
            throw new Error('Invalid B4 payload header');
        }

        const encType = data[1];
        let indices = [];

        if (encType === 0x00) {
            indices = [];
        } else if (encType === 0x01) {
            for (let i = 0; i < totalSlots; i++) indices.push(i);
        } else if (encType === 0x02) {
            let [count, offset] = decodeVarint(data, 2);
            let prev = 0;
            for (let i = 0; i < count; i++) {
                let [delta, nextOffset] = decodeVarint(data, offset);
                offset = nextOffset;
                const idx = (i === 0) ? delta : (prev + delta + 1);
                indices.push(idx);
                prev = idx;
            }
        } else if (encType === 0x03) {
            let [count, offset] = decodeVarint(data, 2);
            const unselectedSet = new Set();
            let prev = 0;
            for (let i = 0; i < count; i++) {
                let [delta, nextOffset] = decodeVarint(data, offset);
                offset = nextOffset;
                const idx = (i === 0) ? delta : (prev + delta + 1);
                unselectedSet.add(idx);
                prev = idx;
            }
            for (let i = 0; i < totalSlots; i++) {
                if (!unselectedSet.has(i)) indices.push(i);
            }
        } else if (encType === 0x04) {
            let currentBit = data[2];
            let offset = 3;
            let currIdx = 0;
            while (offset < data.length && currIdx < totalSlots) {
                let [runLen, nextOffset] = decodeVarint(data, offset);
                offset = nextOffset;
                if (currentBit === 1) {
                    const limit = Math.min(currIdx + runLen, totalSlots);
                    for (let i = currIdx; i < limit; i++) indices.push(i);
                }
                currIdx += runLen;
                currentBit = 1 - currentBit;
            }
        } else if (encType === 0x05) {
            const rawBm = data.subarray(2);
            for (let i = 0; i < totalSlots; i++) {
                const byteIdx = Math.floor(i / 8);
                if (byteIdx < rawBm.length && (rawBm[byteIdx] & (1 << (7 - (i % 8))))) {
                    indices.push(i);
                }
            }
        } else if (encType === 0x06) {
            const rawBm = pako.inflate(data.subarray(2));
            for (let i = 0; i < totalSlots; i++) {
                const byteIdx = Math.floor(i / 8);
                if (byteIdx < rawBm.length && (rawBm[byteIdx] & (1 << (7 - (i % 8))))) {
                    indices.push(i);
                }
            }
        } else {
            throw new Error('Unknown encoding type: ' + encType);
        }

        const slots = [];
        indices.forEach(idx => {
            if (mode === 'date') {
                const dateStr = addDaysToYMD(startYMD, idx);
                slots.push(`${dateStr}T00:00:00`);
            } else {
                const dayOffset = Math.floor(idx / 24);
                const hour = idx % 24;
                const dateStr = addDaysToYMD(startYMD, dayOffset);
                slots.push(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
            }
        });

        return slots.sort();
    }

    /**
     * v4バイナリ形式のステータスデータをデコード (s4-...)
     * @param {string} clean - s4-プレフィックス付きまたはなしのBase64URL文字列
     */
    function decodeV4BinaryStatus(clean) {
        if (clean.startsWith('s4-')) {
            clean = clean.slice(3);
        }
        let standard = clean.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';

        const binaryString = atob(standard);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const decompressed = pako.inflate(bytes);
        const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

        const version = view.getUint8(0);
        if (version !== 4) {
            throw new Error('Unsupported binary version: ' + version);
        }

        const flags = view.getUint8(1);
        const isClosed = (flags & 1) !== 0;
        const mode = (flags & 2) !== 0 ? 'date' : 'time';

        const startDateInt = view.getUint32(2, false);
        const endDateInt = view.getUint32(6, false);
        const startDate = String(startDateInt);
        const endDate = String(endDateInt);

        const sd = parseYMD(startDate);
        const ed = parseYMD(endDate);
        const totalDays = Math.floor((ed - sd) / 86400000) + 1;
        const slotsPerDay = (mode === 'date') ? 1 : 24;
        const totalSlots = totalDays * slotsPerDay;

        let offset = 10;
        const titleLen = view.getUint8(offset++);
        const titleBytes = decompressed.subarray(offset, offset + titleLen);
        const title = new TextDecoder('utf-8').decode(titleBytes);
        offset += titleLen;

        const ownerLen = view.getUint8(offset++);
        const ownerBytes = decompressed.subarray(offset, offset + ownerLen);
        const ownerName = new TextDecoder('utf-8').decode(ownerBytes);
        offset += ownerLen;

        let [pCount, nextOffset] = decodeVarint(decompressed, offset);
        offset = nextOffset;

        const participants = [];
        for (let i = 0; i < pCount; i++) {
            const nameLen = view.getUint8(offset++);
            const nameBytes = decompressed.subarray(offset, offset + nameLen);
            const name = new TextDecoder('utf-8').decode(nameBytes);
            offset += nameLen;

            const encType = view.getUint8(offset++);
            let indices = [];

            if (encType === 0x00) {
                indices = [];
            } else if (encType === 0x01) {
                for (let k = 0; k < totalSlots; k++) indices.push(k);
            } else if (encType === 0x02) {
                let [count, o2] = decodeVarint(decompressed, offset);
                offset = o2;
                let prev = 0;
                for (let k = 0; k < count; k++) {
                    let [delta, o3] = decodeVarint(decompressed, offset);
                    offset = o3;
                    const idx = (k === 0) ? delta : (prev + delta + 1);
                    indices.push(idx);
                    prev = idx;
                }
            } else if (encType === 0x05) {
                const rawLen = Math.ceil(totalSlots / 8);
                const rawBm = decompressed.subarray(offset, offset + rawLen);
                offset += rawLen;
                for (let k = 0; k < totalSlots; k++) {
                    if (Math.floor(k / 8) < rawBm.length && (rawBm[Math.floor(k / 8)] & (1 << (7 - (k % 8))))) {
                        indices.push(k);
                    }
                }
            }

            const rawBm = new Uint8Array(Math.ceil(totalSlots / 8));
            indices.forEach(idx => {
                rawBm[Math.floor(idx / 8)] |= (1 << (7 - (idx % 8)));
            });
            let binary = '';
            for (let j = 0; j < rawBm.length; j++) {
                binary += String.fromCharCode(rawBm[j]);
            }
            participants.push([String(i + 1), name, btoa(binary)]);
        }

        return {
            v: 2,
            t: title,
            s: startDate,
            e: endDate,
            c: isClosed,
            o: ownerName,
            p: participants,
            mode: mode
        };
    }

    /**
     * c4集計バイナリ形式のステータスデータをデコード (c4-...)
     * @param {string} clean - c4-プレフィックス付きまたはなしのBase64URL文字列
     */
    function decodeC4Counts(clean) {
        if (clean.startsWith('c4-')) {
            clean = clean.slice(3);
        }
        let standard = clean.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';

        const binaryString = atob(standard);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const decompressed = pako.inflate(bytes);
        const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

        const version = view.getUint8(0);
        if (version !== 4) {
            throw new Error('Unsupported c4 binary version: ' + version);
        }

        const flags = view.getUint8(1);
        const isClosed = (flags & 1) !== 0;
        const mode = (flags & 2) !== 0 ? 'date' : 'time';

        const startDateInt = view.getUint32(2, false);
        const endDateInt = view.getUint32(6, false);
        const startDate = String(startDateInt);
        const endDate = String(endDateInt);

        let offset = 10;
        let [submissionsCount, o1] = decodeVarint(decompressed, offset);
        offset = o1;

        const titleLen = view.getUint8(offset++);
        const titleBytes = decompressed.subarray(offset, offset + titleLen);
        const title = new TextDecoder('utf-8').decode(titleBytes);
        offset += titleLen;

        const ownerLen = view.getUint8(offset++);
        const ownerBytes = decompressed.subarray(offset, offset + ownerLen);
        const ownerName = new TextDecoder('utf-8').decode(ownerBytes);
        offset += ownerLen;

        let [nonZeroCount, o2] = decodeVarint(decompressed, offset);
        offset = o2;

        const voteCounts = {};
        let prev = 0;
        for (let i = 0; i < nonZeroCount; i++) {
            let [delta, o3] = decodeVarint(decompressed, offset);
            offset = o3;
            let [count, o4] = decodeVarint(decompressed, offset);
            offset = o4;

            const sIdx = (i === 0) ? delta : (prev + delta + 1);
            prev = sIdx;

            if (mode === 'date') {
                const dateStr = addDaysToYMD(startDate, sIdx);
                voteCounts[`${dateStr}T00:00:00`] = count;
            } else {
                const dayOffset = Math.floor(sIdx / 24);
                const hour = sIdx % 24;
                const dateStr = addDaysToYMD(startDate, dayOffset);
                voteCounts[`${dateStr}T${String(hour).padStart(2, '0')}:00:00`] = count;
            }
        }

        return {
            v: 3,
            t: title,
            s: startDate,
            e: endDate,
            c: isClosed,
            o: ownerName,
            participant_count: submissionsCount,
            vote_counts: voteCounts,
            mode: mode
        };
    }

    /**
     * v3バイナリ形式のステータスデータをデコード (後方互換)
     */
    function decodeV3BinaryStatus(clean) {
        if (clean.startsWith('s3-')) {
            clean = clean.slice(3);
        }
        let standard = clean.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';

        const binaryString = atob(standard);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const decompressed = pako.inflate(bytes);
        const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

        const version = view.getUint8(0);
        if (version !== 3) {
            throw new Error('Unsupported binary version: ' + version);
        }

        const flags = view.getUint8(1);
        const isClosed = (flags & 1) !== 0;

        const startDateInt = view.getUint32(2, false);
        const endDateInt = view.getUint32(6, false);
        const startDate = String(startDateInt);
        const endDate = String(endDateInt);

        let offset = 10;
        const titleLen = view.getUint8(offset++);
        const titleBytes = decompressed.subarray(offset, offset + titleLen);
        const title = new TextDecoder('utf-8').decode(titleBytes);
        offset += titleLen;

        const ownerLen = view.getUint8(offset++);
        const ownerBytes = decompressed.subarray(offset, offset + ownerLen);
        const ownerName = new TextDecoder('utf-8').decode(ownerBytes);
        offset += ownerLen;

        const pCount = view.getUint16(offset, false);
        offset += 2;
        const bitmaskBytes = view.getUint16(offset, false);
        offset += 2;

        const participants = [];
        for (let i = 0; i < pCount; i++) {
            const nameLen = view.getUint8(offset++);
            const nameBytes = decompressed.subarray(offset, offset + nameLen);
            const name = new TextDecoder('utf-8').decode(nameBytes);
            offset += nameLen;

            const bitmaskRaw = decompressed.subarray(offset, offset + bitmaskBytes);
            offset += bitmaskBytes;

            let binary = '';
            for (let j = 0; j < bitmaskRaw.length; j++) {
                binary += String.fromCharCode(bitmaskRaw[j]);
            }
            const bitmaskB64 = btoa(binary);
            participants.push([String(i + 1), name, bitmaskB64]);
        }

        return {
            v: 2,
            t: title,
            s: startDate,
            e: endDate,
            c: isClosed,
            o: ownerName,
            p: participants
        };
    }

    /**
     * c3集計バイナリ形式のステータスデータをデコード (後方互換)
     */
    function decodeC3Counts(clean) {
        if (clean.startsWith('c3-')) {
            clean = clean.slice(3);
        }
        let standard = clean.replace(/-/g, '+').replace(/_/g, '/');
        while (standard.length % 4) standard += '=';

        const binaryString = atob(standard);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        const decompressed = pako.inflate(bytes);
        const view = new DataView(decompressed.buffer, decompressed.byteOffset, decompressed.byteLength);

        const version = view.getUint8(0);
        if (version !== 3) {
            throw new Error('Unsupported c3 binary version: ' + version);
        }

        const flags = view.getUint8(1);
        const isClosed = (flags & 1) !== 0;

        const startDateInt = view.getUint32(2, false);
        const endDateInt = view.getUint32(6, false);
        const startDate = String(startDateInt);
        const endDate = String(endDateInt);

        const pCount = view.getUint16(10, false);
        const nonZeroCount = view.getUint16(12, false);

        let offset = 14;
        const titleLen = view.getUint8(offset++);
        const titleBytes = decompressed.subarray(offset, offset + titleLen);
        const title = new TextDecoder('utf-8').decode(titleBytes);
        offset += titleLen;

        const ownerLen = view.getUint8(offset++);
        const ownerBytes = decompressed.subarray(offset, offset + ownerLen);
        const ownerName = new TextDecoder('utf-8').decode(ownerBytes);
        offset += ownerLen;

        const sYear = parseInt(startDate.slice(0, 4), 10);
        const sMonth = parseInt(startDate.slice(4, 6), 10) - 1;
        const sDay = parseInt(startDate.slice(6, 8), 10);
        const sDate = new Date(Date.UTC(sYear, sMonth, sDay));

        const voteCounts = {};
        for (let i = 0; i < nonZeroCount; i++) {
            const slotIdx = view.getUint16(offset, false);
            offset += 2;
            const count = view.getUint16(offset, false);
            offset += 2;

            const dayOffset = Math.floor(slotIdx / 24);
            const hour = slotIdx % 24;

            const slotDate = new Date(sDate.getTime() + dayOffset * 86400000);
            const yyyy = slotDate.getUTCFullYear();
            const mm = String(slotDate.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(slotDate.getUTCDate()).padStart(2, '0');
            const hh = String(hour).padStart(2, '0');
            const slotTime = `${yyyy}-${mm}-${dd}T${hh}:00:00`;
            voteCounts[slotTime] = count;
        }

        return {
            v: 3,
            t: title,
            s: startDate,
            e: endDate,
            c: isClosed,
            o: ownerName,
            participant_count: pCount,
            vote_counts: voteCounts
        };
    }

    /**
     * 圧縮データをデコードしてJSONオブジェクトを返す
     * @param {string} encodedText - Base64エンコードされた圧縮データ (s4-, c4-, s3-, c3-, status-, etc.)
     * @returns {Object|null} デコードされたJSONオブジェクト
     */
    function decodeCompressedData(encodedText) {
        try {
            // 空白を除去
            const cleaned = encodedText.trim().replace(/\s+/g, '');

            if (cleaned.startsWith('s4-')) {
                return decodeV4BinaryStatus(cleaned);
            }

            if (cleaned.startsWith('c4-')) {
                return decodeC4Counts(cleaned);
            }

            if (cleaned.startsWith('s3-')) {
                return decodeV3BinaryStatus(cleaned);
            }

            if (cleaned.startsWith('c3-')) {
                return decodeC3Counts(cleaned);
            }

            let textToDecode = cleaned;
            if (textToDecode.startsWith('status-v4-')) {
                textToDecode = textToDecode.slice(10);
            } else if (textToDecode.startsWith('status-')) {
                textToDecode = textToDecode.slice(7);
            }

            // URL-safe Base64 → 標準 Base64 に変換 + パディング復元
            let standard = textToDecode.replace(/-/g, '+').replace(/_/g, '/');
            while (standard.length % 4) standard += '=';

            // Base64デコード
            const binaryString = atob(standard);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // zlibデータかどうかを判定（先頭バイトが0x78）
            if (bytes.length > 0 && bytes[0] === 0x78) {
                // zlib解凍 (pako.inflate を使用)
                const decompressed = pako.inflate(bytes, { to: 'string' });
                return JSON.parse(decompressed);
            } else {
                // 非圧縮のBase64 JSON (後方互換性)
                const jsonStr = decodeURIComponent(escape(binaryString));
                return JSON.parse(jsonStr);
            }
        } catch (e) {
            console.error('デコードエラー:', e);
            return null;
        }
    }

    /**
     * JSONオブジェクトを圧縮してBase64文字列を返す
     * @param {Object} data - 送信するデータ
     * @returns {string} Base64エンコードされたzlib圧縮データ
     */
    function encodeCompressedData(data) {
        try {
            // JSONを文字列化（コンパクト形式）
            const jsonStr = JSON.stringify(data);

            // zlib圧縮 (pako.deflate を使用)
            const compressed = pako.deflate(jsonStr, { level: 9 });

            // Base64エンコード
            let binary = '';
            for (let i = 0; i < compressed.length; i++) {
                binary += String.fromCharCode(compressed[i]);
            }
            return btoa(binary);
        } catch (e) {
            console.error('エンコードエラー:', e);
            return null;
        }
    }

    // Bitmask Codec: v2 コンパクト形式 (後方互換用)

    /**
     * YYYYMMDD文字列をDateオブジェクトに変換 (ローカル時間)
     */
    function parseYMD(ymd) {
        return new Date(
            parseInt(ymd.slice(0, 4), 10),
            parseInt(ymd.slice(4, 6), 10) - 1,
            parseInt(ymd.slice(6, 8), 10)
        );
    }

    /**
     * 選択された時間スロットをビットマスクBase64にエンコード
     * @param {string[]} selectedTimes - ISO日時文字列の配列
     * @param {Date} startDate - 期間開始日
     * @param {Date} endDate - 期間終了日
     * @returns {string} Base64エンコードされたビットマスク
     */
    function encodeBitmask(selectedTimes, startDate, endDate) {
        const sd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        const ed = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const totalDays = Math.floor((ed - sd) / (1000 * 60 * 60 * 24)) + 1;
        const totalBits = totalDays * 24;
        const bytes = new Uint8Array(Math.ceil(totalBits / 8));
        selectedTimes.forEach(slot => {
            const dt = new Date(slot);
            const slotDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
            const dayOffset = Math.floor((slotDate - sd) / (1000 * 60 * 60 * 24));
            const hour = dt.getHours();
            if (dayOffset >= 0 && dayOffset < totalDays && hour >= 0 && hour < 24) {
                const bitIndex = dayOffset * 24 + hour;
                bytes[Math.floor(bitIndex / 8)] |= (1 << (7 - bitIndex % 8));
            }
        });
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    }

    /**
     * ビットマスクBase64をISO日時文字列の配列にデコード
     * @param {string} bitmaskB64 - Base64エンコードされたビットマスク
     * @param {Date} startDate - 期間開始日
     * @param {number} totalDays - 期間の日数
     * @returns {string[]} ISO日時文字列の配列
     */
    function decodeBitmask(bitmaskB64, startDate, totalDays) {
        const binaryStr = atob(bitmaskB64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const slots = [];
        for (let day = 0; day < totalDays; day++) {
            const d = new Date(startDate.getTime());
            d.setDate(d.getDate() + day);
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            for (let hour = 0; hour < 24; hour++) {
                const bitIndex = day * 24 + hour;
                const byteIndex = Math.floor(bitIndex / 8);
                if (byteIndex < bytes.length && (bytes[byteIndex] & (1 << (7 - bitIndex % 8)))) {
                    slots.push(`${dateStr}T${String(hour).padStart(2, '0')}:00:00`);
                }
            }
        }
        return slots;
    }

    /**
     * v2コンパクトステータスデータを、既存の表示関数が期待するフル形式に展開
     * @param {Object} data - v2形式のデータ ({v:2, t, s, e, c, o, p})
     * @returns {Object} フル形式のデータ
     */
    function expandCompactStatus(data) {
        if (data.v === 3) {
            // c3 集計データ形式
            const chronological = [];
            const allSlots = Object.keys(data.vote_counts || {}).sort();
            const counts = data.vote_counts || {};

            let maxVotes = 0;
            allSlots.forEach(slot => {
                const votes = counts[slot] || 0;
                if (votes > maxVotes) maxVotes = votes;
                chronological.push({
                    slot: slot,
                    slot_formatted: formatISODateTime(slot),
                    votes: votes
                });
            });

            const byVotes = [...chronological].sort((a, b) => b.votes - a.votes);
            const unanimous = (data.participant_count > 0 && maxVotes >= data.participant_count)
                ? chronological.filter(s => s.votes >= data.participant_count)
                : [];

            return {
                session: {
                    title: data.t,
                    start_date: data.s,
                    end_date: data.e,
                    is_closed: data.c,
                    owner_display_name: data.o,
                },
                summary: {
                    status: data.c ? '募集終了' : '受付中',
                    participant_count: data.participant_count || 0,
                    slot_count: allSlots.length,
                    total_participants_with_selection: data.participant_count || 0,
                },
                participants: [],
                slots: {
                    chronological: chronological,
                    by_votes: byVotes,
                    unanimous: unanimous,
                },
                submissions: []
            };
        }

        const sd = parseYMD(data.s);
        const ed = parseYMD(data.e);
        const totalDays = Math.floor((ed - sd) / (1000 * 60 * 60 * 24)) + 1;

        const participants = [];
        const submissions = [];
        const slotCounts = {};

        (data.p || []).forEach(([id, name, bitmaskB64]) => {
            participants.push({ id, display_name: name });
            const slots = decodeBitmask(bitmaskB64, sd, totalDays);
            submissions.push({
                submitted_by: id,
                selected_times: slots,
                selected_times_formatted: slots.map(s => formatISODateTime(s)),
            });
            slots.forEach(slot => {
                slotCounts[slot] = (slotCounts[slot] || 0) + 1;
            });
        });

        const totalWithSelection = submissions.filter(s => s.selected_times.length > 0).length;
        const chronological = Object.entries(slotCounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([slot, votes]) => ({ slot, slot_formatted: formatISODateTime(slot), votes }));
        const unanimousSlots = Object.entries(slotCounts)
            .filter(([, count]) => totalWithSelection > 0 && count === totalWithSelection)
            .map(([slot]) => slot)
            .sort();

        return {
            session: {
                title: data.t,
                start_date: data.s,
                end_date: data.e,
                is_closed: data.c,
                owner_display_name: data.o,
            },
            summary: {
                status: data.c ? '募集終了' : '受付中',
                participant_count: participants.length,
                slot_count: Object.keys(slotCounts).length,
                total_participants_with_selection: totalWithSelection,
            },
            participants,
            slots: {
                chronological,
                by_votes: [...chronological].sort((a, b) => b.votes - a.votes),
                unanimous: unanimousSlots.map(slot => ({
                    slot,
                    slot_formatted: formatISODateTime(slot),
                    votes: slotCounts[slot],
                })),
            },
            submissions,
        };
    }

    // =========================================================================
    // SECTION 12: 投票状況プレビュー & ヒートマップ (Status Preview & Heatmap)
    // =========================================================================

    function handlePreview() {
        const input = previewDataInput.value.trim();
        if (!input) {
            alert('データを入力してください');
            return;
        }

        const data = decodeCompressedData(input);
        if (data) {
            displaySchedulePreview(data);
        } else {
            alert('データの形式が正しくありません。\nBotからコピーしたステータスデータを貼り付けてください。');
        }
    }

    function displaySchedulePreview(data) {
        // previewModeはhandleStatusPreviewで既に表示されている

        // タイトルと基本情報
        const titleEl = document.getElementById('preview-title');
        const statusBadge = document.getElementById('status-badge');
        const participantCount = document.getElementById('participant-count');
        const slotCount = document.getElementById('slot-count');
        const sessionPeriod = document.getElementById('session-period');
        const sessionOwner = document.getElementById('session-owner');

        if (data.session) {
            titleEl.textContent = data.session.title || 'スケジュール';
            sessionPeriod.textContent = `📅 ${data.session.start_date} ～ ${data.session.end_date}`;
            sessionOwner.textContent = `👤 作成者: ${data.session.owner_display_name || '不明'}`;
        }

        if (data.summary) {
            statusBadge.textContent = data.summary.status === '受付中' ? '🟢 ' + data.summary.status : '🔴 ' + data.summary.status;
            participantCount.textContent = `${data.summary.participant_count || 0}人`;
            slotCount.textContent = `📅 ${data.summary.slot_count || 0}候補`;
        }

        // 全員一致の候補
        displayUnanimousSlots(data);

        // ヒートマップ生成
        generateHeatmap(data);

        // 参加者一覧
        displayParticipants(data);
    }

    function displayUnanimousSlots(data) {
        const unanimousInline = document.getElementById('unanimous-inline');
        unanimousInline.innerHTML = '';

        if (data.slots && data.slots.unanimous && data.slots.unanimous.length > 0) {
            data.slots.unanimous.forEach(slot => {
                const badge = document.createElement('span');
                badge.className = 'unanimous-badge';
                badge.textContent = slot.slot_formatted;
                unanimousInline.appendChild(badge);
            });
        } else {
            const noMatch = document.createElement('span');
            noMatch.className = 'no-unanimous';
            noMatch.textContent = '全員一致の候補はまだありません';
            unanimousInline.appendChild(noMatch);
        }
    }

    function generateHeatmap(data, filterUserIds = 'all') {
        const container = document.getElementById('heatmap');
        const filterWrapper = document.getElementById('heatmap-user-filter-wrapper');
        const filterOptions = document.getElementById('heatmap-user-filter-options');
        const filterTrigger = document.getElementById('heatmap-user-filter-trigger');
        const selectedText = document.getElementById('selected-users-text');

        container.innerHTML = '';

        // ユーザーフィルターのオプションを更新
        if (filterWrapper && data.participants && !filterWrapper.dataset.initialized) {
            filterOptions.innerHTML = '';

            // 「すべて」オプション
            const allOption = document.createElement('label');
            allOption.className = 'filter-option all-option';
            allOption.innerHTML = `
                <input type="checkbox" id="user-filter-all" checked>
                <span>👥 すべて選択</span>
            `;
            filterOptions.appendChild(allOption);

            // 各ユーザーオプション
            data.participants.forEach(p => {
                const option = document.createElement('label');
                option.className = 'filter-option';
                option.innerHTML = `
                    <input type="checkbox" value="${p.id}" checked class="user-checkbox">
                    <span>${p.display_name}</span>
                `;
                filterOptions.appendChild(option);
            });

            // イベントリスナーの設定
            const allCheckbox = document.getElementById('user-filter-all');
            const userCheckboxes = filterOptions.querySelectorAll('.user-checkbox');

            filterTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                filterWrapper.classList.toggle('active');
            });

            document.addEventListener('click', () => {
                filterWrapper.classList.remove('active');
            });

            filterOptions.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            const updateFilterResult = () => {
                const selected = Array.from(userCheckboxes)
                    .filter(cb => cb.checked)
                    .map(cb => cb.value);

                const totalCount = userCheckboxes.length;
                const selectedCount = selected.length;

                allCheckbox.checked = selectedCount === totalCount;
                allCheckbox.indeterminate = selectedCount > 0 && selectedCount < totalCount;

                if (selectedCount === totalCount) {
                    selectedText.textContent = '👥 すべて';
                } else if (selectedCount === 0) {
                    selectedText.textContent = '選択なし';
                } else if (selectedCount === 1) {
                    const userId = selected[0];
                    const user = data.participants.find(p => p.id === userId);
                    selectedText.textContent = user ? user.display_name : '1人選択';
                } else {
                    selectedText.textContent = `${selectedCount}人を選択中`;
                }

                generateHeatmap(data, selectedCount === totalCount ? 'all' : selected);
            };

            allCheckbox.addEventListener('change', () => {
                userCheckboxes.forEach(cb => cb.checked = allCheckbox.checked);
                updateFilterResult();
            });

            userCheckboxes.forEach(cb => {
                cb.addEventListener('change', updateFilterResult);
            });

            filterWrapper.dataset.initialized = 'true';
        }

        let slotsData = [];
        const isAllSelected = filterUserIds === 'all';
        const selectedIds = isAllSelected ? null : new Set(filterUserIds);

        if (isAllSelected) {
            slotsData = data.slots?.chronological || [];
        } else if (selectedIds && selectedIds.size > 0) {
            // 選択されたユーザーのサブミッションを抽出
            const selectedSubmissions = data.submissions?.filter(s => selectedIds.has(s.submitted_by)) || [];

            // 日付範囲を取得（データ全体から）
            const allDates = [...new Set(data.slots.chronological.map(s => s.slot.split('T')[0]))].sort();
            const allHours = [...new Set(data.slots.chronological.map(s => s.slot.split('T')[1].slice(0, 5)))].sort();

            allDates.forEach(date => {
                allHours.forEach(hour => {
                    const slotTime = `${date}T${hour}:00`;
                    // 選択されたユーザーの中でこのスロットを選んだ人数をカウント
                    const votes = selectedSubmissions.reduce((count, s) => {
                        return count + (s.selected_times.includes(slotTime) ? 1 : 0);
                    }, 0);

                    slotsData.push({
                        slot: slotTime,
                        slot_formatted: formatISODateTime(slotTime),
                        votes: votes
                    });
                });
            });
        }

        if (slotsData.length === 0) {
            container.innerHTML = '<p style="color: var(--text-secondary); padding: 50px; text-align: center;">選択されたユーザーの投票データがありません</p>';
            return;
        }

        const maxVotes = isAllSelected && data.summary
            ? data.summary.participant_count
            : (selectedIds ? selectedIds.size : 1);

        const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];

        // 日付でグループ化
        const slotsByDate = {};
        slotsData.forEach(slot => {
            const date = slot.slot.split('T')[0];
            if (!slotsByDate[date]) slotsByDate[date] = [];
            slotsByDate[date].push(slot);
        });

        // テーブル生成
        const table = document.createElement('table');
        table.className = 'heatmap-table';

        // ヘッダー行（日付 + 曜日）
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th></th>';
        Object.keys(slotsByDate).sort().forEach(date => {
            const th = document.createElement('th');
            const dateParts = date.split('-');
            const dateObj = new Date(parseInt(dateParts[0], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[2], 10));
            const dayOfWeek = dateObj.getDay();
            const holidayName = getJapaneseHolidayName(dateObj);
            if (holidayName || dayOfWeek === 0) {
                th.classList.add('sunday');
                if (holidayName) {
                    th.classList.add('holiday');
                    th.title = holidayName;
                }
            } else if (dayOfWeek === 6) {
                th.classList.add('saturday');
            }
            const dayName = daysOfWeek[dayOfWeek];
            const dateStr = date.slice(5).replace('-', '/'); // MM/DD
            th.innerHTML = `${dateStr}<span class="day-name">(${dayName})</span>`;
            headerRow.appendChild(th);
        });
        table.appendChild(headerRow);

        // 時間行
        const hours = [...new Set(slotsData.map(s => s.slot.split('T')[1].slice(0, 5)))];
        hours.sort().forEach(hour => {
            const row = document.createElement('tr');
            row.innerHTML = `<td class="hour-label">${hour}</td>`;

            Object.keys(slotsByDate).sort().forEach(date => {
                const slot = slotsByDate[date].find(s => s.slot.includes(`T${hour}`));
                const td = document.createElement('td');
                td.className = 'vote-cell';

                if (slot && slot.votes > 0) {
                    const intensity = slot.votes / Math.max(maxVotes, 1);

                    if (isAllSelected || (selectedIds && selectedIds.size > 1)) {
                        // 複数選択：緑色のグラデーション
                        const r = Math.round(22 + (1 - intensity) * 40);
                        const g = Math.round(163 + intensity * 34);
                        const b = Math.round(74 + intensity * 20);
                        const alpha = 0.3 + intensity * 0.6;
                        td.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                        td.textContent = slot.votes;

                        // 全体の中での「全員一致」か、選択中のユーザーの中での「全員一致」か
                        const isUnanimousLocal = slot.votes === maxVotes;
                        if (isUnanimousLocal) {
                            td.classList.add('unanimous');
                        }
                    } else {
                        // 単一選択：青色
                        td.style.backgroundColor = 'var(--primary-gradient)';
                        td.style.background = 'var(--primary-gradient)';
                        td.style.color = 'white';
                        td.textContent = '●';
                    }

                    td.title = `${slot.slot_formatted}: ${slot.votes}人`;
                }

                row.appendChild(td);
            });

            table.appendChild(row);
        });

        container.appendChild(table);
    }

    // 現在のプレビューデータを保持
    let currentPreviewData = null;

    function displayParticipants(data) {
        currentPreviewData = data;
        const list = document.getElementById('participant-list');
        const detailPanel = document.getElementById('participant-detail');
        list.innerHTML = '';

        // Close button handler
        const closeBtn = document.getElementById('close-detail');
        if (closeBtn) {
            closeBtn.onclick = () => {
                detailPanel.style.display = 'none';
                document.querySelectorAll('.participants li.selected').forEach(li => li.classList.remove('selected'));
            };
        }

        if (!data.participants || data.participants.length === 0) {
            list.innerHTML = '<li style="color: var(--text-secondary); padding: 12px; cursor: default;">参加者がいません</li>';
            return;
        }

        data.participants.forEach(p => {
            const submission = data.submissions ? data.submissions.find(s => s.submitted_by === p.id) : null;
            const count = submission ? submission.selected_times.length : 0;

            const li = document.createElement('li');
            li.innerHTML = `<span class="name">${p.display_name}</span> <span class="count">(${count}件選択)</span>`;
            li.dataset.participantId = p.id;

            li.addEventListener('click', () => {
                // Remove selected from others
                document.querySelectorAll('.participants li.selected').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
                showParticipantDetail(p, submission);
            });

            list.appendChild(li);
        });
    }

    function showParticipantDetail(participant, submission) {
        const detailPanel = document.getElementById('participant-detail');
        const detailName = document.getElementById('detail-name');
        const detailCount = document.getElementById('detail-count');
        const detailTimes = document.getElementById('detail-times');

        detailName.textContent = participant.display_name;

        if (!submission || !submission.selected_times || submission.selected_times.length === 0) {
            detailCount.textContent = '選択した時間枠はありません';
            detailTimes.innerHTML = '';
        } else {
            detailCount.textContent = `${submission.selected_times.length}件の時間を選択`;
            detailTimes.innerHTML = '';

            // Format and display times
            const formattedTimes = submission.selected_times_formatted || submission.selected_times;
            formattedTimes.forEach(time => {
                const chip = document.createElement('span');
                chip.className = 'time-chip';
                chip.textContent = typeof time === 'string' && time.includes('T')
                    ? formatISODateTime(time)
                    : time;
                detailTimes.appendChild(chip);
            });
        }

        detailPanel.style.display = 'block';
        detailPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function formatISODateTime(isoString) {
        try {
            const date = new Date(isoString);
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const hours = String(date.getHours()).padStart(2, '0');
            const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
            const dayName = daysOfWeek[date.getDay()];
            return `${month}/${day}(${dayName}) ${hours}:00`;
        } catch (e) {
            return isoString;
        }
    }

    // =========================================================================
    // SECTION 13: Google カレンダー連携 & 認証ガイド (Google Calendar OAuth & Guide)
    // =========================================================================
    const DEFAULT_GCAL_CLIENT_ID = '827203323462-tj8n0bhn351ed1hcmdgpsfdtvslovplc.apps.googleusercontent.com';
    let gcalTokenClient = null;
    const importGcalBtn = document.getElementById('import-gcal-btn');
    const gcalHelpBtn = document.getElementById('gcal-help-btn');
    const gcalHelpModal = document.getElementById('gcal-help-modal');
    const closeGcalHelpModal = document.getElementById('close-gcal-help-modal');
    const ackGcalHelpBtn = document.getElementById('ack-gcal-help-btn');
    const gcalStatusBadge = document.getElementById('gcal-status-badge');
    const gcalModal = document.getElementById('gcal-modal');
    const closeGcalModal = document.getElementById('close-gcal-modal');
    const gcalClientIdInput = document.getElementById('gcal-client-id-input');
    const saveGcalIdBtn = document.getElementById('save-gcal-id-btn');
    const clearGcalIdBtn = document.getElementById('clear-gcal-id-btn');

    // Guide Modal Elements & Multi-Scene Animation (5-Step OAuth Flow)
    const simScene1 = document.getElementById('sim-scene-1');
    const simScene2 = document.getElementById('sim-scene-2');
    const simScene3 = document.getElementById('sim-scene-3');
    const simScene4 = document.getElementById('sim-scene-4');
    const simScene5 = document.getElementById('sim-scene-5');
    const simStepNode1 = document.getElementById('sim-step-node-1');
    const simStepNode2 = document.getElementById('sim-step-node-2');
    const simStepNode3 = document.getElementById('sim-step-node-3');
    const simStepNode4 = document.getElementById('sim-step-node-4');
    const simStepNode5 = document.getElementById('sim-step-node-5');

    const simStartGcalBtn = document.getElementById('sim-start-gcal-btn');
    const simAccountItem = document.getElementById('sim-account-item');
    const simDetailsBtn = document.getElementById('sim-details-btn');
    const simExpandedSection = document.getElementById('sim-expanded-section');
    const simDangerLink = document.getElementById('sim-danger-link');
    const simConsentBtn = document.getElementById('sim-consent-btn');
    const virtualCursor = document.getElementById('virtual-cursor');

    let simTimers = [];

    function addSimTimer(fn, delay) {
        const id = setTimeout(fn, delay);
        simTimers.push(id);
        return id;
    }

    function clearAllSimTimers() {
        simTimers.forEach(id => clearTimeout(id));
        simTimers = [];
    }

    function openGcalHelpModal() {
        if (gcalHelpModal) {
            gcalHelpModal.style.display = 'flex';
            startSimulationAnimation();
        }
    }

    function closeGcalHelpModalFunc() {
        if (gcalHelpModal) {
            gcalHelpModal.style.display = 'none';
            stopSimulationAnimation();
        }
    }

    if (gcalHelpBtn) gcalHelpBtn.addEventListener('click', openGcalHelpModal);
    if (closeGcalHelpModal) closeGcalHelpModal.addEventListener('click', closeGcalHelpModalFunc);
    if (ackGcalHelpBtn) ackGcalHelpBtn.addEventListener('click', closeGcalHelpModalFunc);
    if (gcalHelpModal) {
        gcalHelpModal.addEventListener('click', (e) => {
            if (e.target === gcalHelpModal) closeGcalHelpModalFunc();
        });
    }

    function switchSimScene(sceneIndex) {
        [simScene1, simScene2, simScene3, simScene4, simScene5].forEach((s, idx) => {
            if (s) {
                if (idx + 1 === sceneIndex) {
                    s.classList.add('sim-scene-active');
                } else {
                    s.classList.remove('sim-scene-active');
                }
            }
        });
        [simStepNode1, simStepNode2, simStepNode3, simStepNode4, simStepNode5].forEach((node, idx) => {
            if (node) {
                if (idx + 1 === sceneIndex) {
                    node.classList.add('active');
                } else {
                    node.classList.remove('active');
                }
            }
        });
    }

    // Step Node Click & Keyboard Navigators (Jump directly to Step 1, 2, 3, 4, or 5)
    [simStepNode1, simStepNode2, simStepNode3, simStepNode4, simStepNode5].forEach((node, idx) => {
        if (node) {
            node.addEventListener('click', () => {
                playSimStep(idx + 1);
            });
            node.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    playSimStep(idx + 1);
                }
            });
        }
    });

    function toggleSimDetails(forceState) {
        if (!simExpandedSection) return;
        const shouldExpand = forceState !== undefined ? forceState : !simExpandedSection.classList.contains('expanded');
        if (shouldExpand) {
            simExpandedSection.classList.add('expanded');
            const txt = document.getElementById('sim-details-text');
            if (txt) txt.textContent = '詳細を非表示';
        } else {
            simExpandedSection.classList.remove('expanded');
            const txt = document.getElementById('sim-details-text');
            if (txt) txt.textContent = '詳細';
        }
    }

    function playSimStep(stepIndex) {
        clearAllSimTimers();
        if (!virtualCursor) return;

        switchSimScene(stepIndex);
        const viewport = document.querySelector('.sim-stage-viewport');
        if (!viewport) return;

        const getCoord = (elem, offsetXRatio = 0.5, offsetYRatio = 0.5) => {
            if (!elem) return { x: 100, y: 100 };
            const vp = viewport.getBoundingClientRect();
            const el = elem.getBoundingClientRect();
            return {
                x: Math.max(10, el.left - vp.left + el.width * offsetXRatio),
                y: Math.max(10, el.top - vp.top + el.height * offsetYRatio)
            };
        };

        const simToast = document.getElementById('sim-toast');
        if (simToast) simToast.classList.remove('visible');

        virtualCursor.style.opacity = '1';

        switch (stepIndex) {
            case 1: {
                // SCENE 1: Click "Googleカレンダー連携" Button
                virtualCursor.style.transition = 'none';
                virtualCursor.style.transform = 'translate(280px, 35px)';

                addSimTimer(() => {
                    if (!simStartGcalBtn) return;
                    const pos = getCoord(simStartGcalBtn, 0.6, 0.5);
                    virtualCursor.style.transition = 'transform 1.1s cubic-bezier(0.25, 1, 0.5, 1)';
                    virtualCursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

                    addSimTimer(() => {
                        triggerCursorRipple();
                        simStartGcalBtn.style.transform = 'scale(0.95)';
                        setTimeout(() => { simStartGcalBtn.style.transform = ''; }, 180);

                        addSimTimer(() => {
                            playSimStep(2);
                        }, 700);
                    }, 1100);
                }, 600);
                break;
            }

            case 2: {
                // SCENE 2: Google Account Chooser Screen
                virtualCursor.style.transition = 'none';
                virtualCursor.style.transform = 'translate(280px, 50px)';

                addSimTimer(() => {
                    if (!simAccountItem) return;
                    const pos = getCoord(simAccountItem, 0.45, 0.5);
                    virtualCursor.style.transition = 'transform 1.0s cubic-bezier(0.25, 1, 0.5, 1)';
                    virtualCursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

                    addSimTimer(() => {
                        triggerCursorRipple();
                        simAccountItem.style.transform = 'scale(0.97)';
                        setTimeout(() => { simAccountItem.style.transform = ''; }, 180);

                        addSimTimer(() => {
                            playSimStep(3);
                        }, 800);
                    }, 1000);
                }, 700);
                break;
            }

            case 3: {
                // SCENE 3: Google Warning Screen (Unverified App)
                toggleSimDetails(false);
                virtualCursor.style.transition = 'none';
                virtualCursor.style.transform = 'translate(280px, 50px)';

                addSimTimer(() => {
                    if (!simDetailsBtn) return;
                    const pos = getCoord(simDetailsBtn);
                    virtualCursor.style.transition = 'transform 1.0s cubic-bezier(0.25, 1, 0.5, 1)';
                    virtualCursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

                    addSimTimer(() => {
                        triggerCursorRipple();
                        simDetailsBtn.style.transform = 'scale(0.95)';
                        setTimeout(() => { simDetailsBtn.style.transform = ''; }, 180);
                        toggleSimDetails(true);

                        addSimTimer(() => {
                            if (!simDangerLink) return;
                            const posDanger = getCoord(simDangerLink, 0.35, 0.5);
                            virtualCursor.style.transform = `translate(${posDanger.x}px, ${posDanger.y}px)`;

                            addSimTimer(() => {
                                triggerCursorRipple();
                                simDangerLink.style.transform = 'scale(0.96)';
                                setTimeout(() => { simDangerLink.style.transform = ''; }, 180);

                                addSimTimer(() => {
                                    playSimStep(4);
                                }, 800);
                            }, 1000);
                        }, 700);
                    }, 1000);
                }, 800);
                break;
            }

            case 4: {
                // SCENE 4: Google Consent Screen
                virtualCursor.style.transition = 'none';
                virtualCursor.style.transform = 'translate(260px, 140px)';

                addSimTimer(() => {
                    if (!simConsentBtn) return;
                    const pos = getCoord(simConsentBtn);
                    virtualCursor.style.transition = 'transform 1.0s cubic-bezier(0.25, 1, 0.5, 1)';
                    virtualCursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

                    addSimTimer(() => {
                        triggerCursorRipple();
                        simConsentBtn.style.transform = 'scale(0.95)';
                        setTimeout(() => { simConsentBtn.style.transform = ''; }, 180);

                        addSimTimer(() => {
                            playSimStep(5);
                        }, 800);
                    }, 1000);
                }, 800);
                break;
            }

            case 5: {
                // SCENE 5: Auto-exclude Schedule Preview & Interactive Demo
                const busySlot1 = document.getElementById('sim-busy-slot-1');
                const busySlot2 = document.getElementById('sim-busy-slot-2');
                const simCounter = document.getElementById('sim-selection-counter') || document.querySelector('.sim-cutout-output .selection-info span');
                const toast = document.getElementById('sim-toast');
                const toastMsg = toast?.querySelector('.sim-toast-msg');

                if (busySlot1) { busySlot1.className = 'time-slot selected'; }
                if (busySlot2) { busySlot2.className = 'time-slot selected'; }
                if (simCounter) { simCounter.textContent = '選択: 16件'; }
                if (toast) { toast.classList.remove('visible'); }
                if (toastMsg) { toastMsg.textContent = 'Google予定 2件（計2時間）を検知・除外しました'; }

                virtualCursor.style.transition = 'none';
                virtualCursor.style.transform = 'translate(280px, 30px)';

                addSimTimer(() => {
                    if (toast) { toast.classList.add('visible'); }
                    if (busySlot1) { busySlot1.className = 'time-slot gcal-busy'; }
                    if (busySlot2) { busySlot2.className = 'time-slot gcal-busy'; }
                    if (simCounter) { simCounter.textContent = '選択: 14件'; }

                    addSimTimer(() => {
                        if (!busySlot1) return;
                        const pos = getCoord(busySlot1);
                        virtualCursor.style.transition = 'transform 1.1s cubic-bezier(0.25, 1, 0.5, 1)';
                        virtualCursor.style.transform = `translate(${pos.x}px, ${pos.y}px)`;

                        addSimTimer(() => {
                            triggerCursorRipple();
                            busySlot1.classList.add('selected');
                            if (simCounter) { simCounter.textContent = '選択: 15件'; }
                            if (toastMsg) { toastMsg.textContent = 'クリックで予定枠を手動で有効化（候補に追加）'; }

                            addSimTimer(() => {
                                triggerCursorRipple();
                                busySlot1.classList.remove('selected');
                                if (simCounter) { simCounter.textContent = '選択: 14件'; }
                                if (toastMsg) { toastMsg.textContent = '再度クリックで無効化（除外）に切り替え可能'; }

                                addSimTimer(() => {
                                    playSimStep(1);
                                }, 5000);
                            }, 1800);
                        }, 1100);
                    }, 1300);
                }, 600);
                break;
            }
        }
    }

    function startSimulationAnimation() {
        playSimStep(1);
    }

    function triggerCursorRipple() {
        const ripple = virtualCursor?.querySelector('.cursor-ripple');
        if (ripple) {
            ripple.classList.remove('ripple-active');
            void ripple.offsetWidth;
            ripple.classList.add('ripple-active');
        }
    }

    function stopSimulationAnimation() {
        clearAllSimTimers();
        if (virtualCursor) virtualCursor.style.opacity = '0';
        const simToast = document.getElementById('sim-toast');
        if (simToast) simToast.classList.remove('visible');
    }

    function getGcalClientId() {
        return (localStorage.getItem('gcal_client_id') || DEFAULT_GCAL_CLIENT_ID).trim();
    }

    function setGcalClientId(id) {
        if (id && id !== DEFAULT_GCAL_CLIENT_ID) {
            localStorage.setItem('gcal_client_id', id.trim());
        } else {
            localStorage.removeItem('gcal_client_id');
        }
    }

    function openGcalModal() {
        if (gcalClientIdInput) {
            gcalClientIdInput.value = getGcalClientId();
            gcalClientIdInput.placeholder = DEFAULT_GCAL_CLIENT_ID;
        }
        if (gcalModal) {
            gcalModal.style.display = 'flex';
        }
    }

    function closeGcalModalFunc() {
        if (gcalModal) {
            gcalModal.style.display = 'none';
        }
    }

    if (closeGcalModal) closeGcalModal.addEventListener('click', closeGcalModalFunc);
    if (gcalModal) {
        gcalModal.addEventListener('click', (e) => {
            if (e.target === gcalModal) closeGcalModalFunc();
        });
    }

    if (saveGcalIdBtn) {
        saveGcalIdBtn.addEventListener('click', () => {
            const val = (gcalClientIdInput.value || '').trim();
            setGcalClientId(val);
            closeGcalModalFunc();
            showToast(val ? 'Google Client ID を保存しました' : 'Client ID をクリアしました');
            gcalTokenClient = null; // Re-initialize token client
        });
    }

    if (clearGcalIdBtn) {
        clearGcalIdBtn.addEventListener('click', () => {
            setGcalClientId('');
            if (gcalClientIdInput) gcalClientIdInput.value = '';
            showToast('Client ID を初期化しました');
            gcalTokenClient = null;
        });
    }

    function initGcalTokenClient(clientId, callback) {
        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            alert('Google Identity サービスの読み込み中です。少々お待ちの上、再度お試しください。');
            return null;
        }
        try {
            return google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/calendar.events.readonly',
                callback: callback,
                error_callback: (err) => {
                    console.error('GIS Error Callback:', err);
                    if (err && err.type === 'popup_closed') {
                        showToast('Google認証ポップアップが閉じられました');
                    } else if (err && err.type === 'popup_blocked') {
                        alert('ポップアップがブロックされました。ブラウザのポップアップブロックを許可してください。');
                    } else {
                        alert(`Google認証エラー: ${err ? (err.message || err.type || JSON.stringify(err)) : '不明なエラー'}`);
                    }
                }
            });
        } catch (e) {
            console.error('Failed to initTokenClient:', e);
            alert(`Google Client 初期化エラー: ${e.message}`);
            return null;
        }
    }

    async function handleGcalImport() {
        if (!state.startDate || !state.endDate) {
            alert('先にスケジュール表を表示してください。');
            return;
        }

        const clientId = getGcalClientId();
        if (!clientId) {
            // Client ID未設定時は設定モーダルを開く
            openGcalModal();
            return;
        }

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            alert('Google Identity サービスを読み込み中です。しばらくしてから再度クリックしてください。');
            return;
        }

        try {
            if (!gcalTokenClient) {
                gcalTokenClient = initGcalTokenClient(clientId, async (response) => {
                    if (response.error) {
                        console.error('Google OAuth Error:', response);
                        alert(`Google認証エラー: ${response.error_description || response.error}`);
                        return;
                    }
                    if (response.access_token) {
                        await fetchGcalEvents(response.access_token);
                    }
                });
            }

            if (gcalTokenClient) {
                // Request access token with popup consent window
                gcalTokenClient.requestAccessToken({ prompt: 'consent' });
            }
        } catch (err) {
            console.error('Failed to launch Google Auth:', err);
            alert(`Googleカレンダー連携の起動に失敗しました: ${err.message}`);
        }
    }

    async function fetchGcalEvents(accessToken) {
        if (!state.startDate || !state.endDate) return;

        const startIso = `${state.startDate.getFullYear()}-${String(state.startDate.getMonth() + 1).padStart(2, '0')}-${String(state.startDate.getDate()).padStart(2, '0')}T00:00:00+09:00`;
        const endPlusOne = new Date(state.endDate.getFullYear(), state.endDate.getMonth(), state.endDate.getDate() + 1);
        const endIso = `${endPlusOne.getFullYear()}-${String(endPlusOne.getMonth() + 1).padStart(2, '0')}-${String(endPlusOne.getDate()).padStart(2, '0')}T00:00:00+09:00`;

        const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(startIso)}&timeMax=${encodeURIComponent(endIso)}&singleEvents=true&orderBy=startTime`;

        showToast('Googleカレンダーから予定を取得中...');

        try {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                const msg = (errData.error && errData.error.message) || `HTTP ${res.status}`;
                throw new Error(msg);
            }

            const data = await res.json();
            const events = data.items || [];
            sessionStorage.setItem('gcal_token', accessToken);
            sessionStorage.setItem('gcal_token_exp', String(Date.now() + 3500 * 1000));
            localStorage.setItem('gcal_auto_sync', 'true');
            applyEventsToSchedule(events);
        } catch (err) {
            console.error('Failed to fetch Google Calendar events:', err);
            alert(`Googleカレンダーの取得に失敗しました:\n${err.message}`);
        }
    }

    function applyEventsToSchedule(events) {
        gcalImportedEvents = events;

        // Clear existing busy markings
        document.querySelectorAll('.time-slot.gcal-busy').forEach(slot => {
            slot.classList.remove('gcal-busy');
            delete slot.dataset.gcalEvent;
        });

        let excludedCount = 0;
        const busySlotSet = new Set();

        events.forEach(event => {
            if (event.status === 'cancelled') return;

            // 終日の予定（start.date のみで dateTime がないもの）は反映・除外させない
            if (event.start && event.start.date && !event.start.dateTime) {
                return;
            }

            if (!event.start || !event.start.dateTime || !event.end || !event.end.dateTime) {
                return;
            }

            const evStart = new Date(event.start.dateTime);
            const evEnd = new Date(event.end.dateTime);

            const summary = event.summary || '予定あり';

            // Check against all visible time slots
            document.querySelectorAll('.time-slot').forEach(slotCell => {
                const dtStr = slotCell.dataset.datetime;
                if (!dtStr) return;

                const slotStart = new Date(dtStr);
                const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000); // 1 hour

                // Overlap condition: slotStart < evEnd && slotEnd > evStart
                if (slotStart < evEnd && slotEnd > evStart) {
                    slotCell.classList.add('gcal-busy');
                    slotCell.dataset.gcalEvent = summary;
                    const originalTitle = slotCell.title || '';
                    if (!originalTitle.includes('Google予定')) {
                        slotCell.title = `${originalTitle} [📅 Google予定: ${summary}]`.trim();
                    }

                    // 重複スロットを選択解除
                    if (state.selectedSlots.has(dtStr)) {
                        state.selectedSlots.delete(dtStr);
                        slotCell.classList.remove('selected');
                        excludedCount++;
                    }
                    busySlotSet.add(dtStr);
                }
            });
        });

        // Update counter & badge
        const selectionCounter = document.getElementById('selection-counter');
        if (selectionCounter) {
            selectionCounter.textContent = `選択: ${state.selectedSlots.size}件`;
        }

        updateGcalStatusBadge(events.length, busySlotSet.size, excludedCount);
        showToast(`📅 Google予定 ${events.length}件（計${busySlotSet.size}時間）を検知・除外しました`);
    }

    function updateGcalStatusBadge(eventCount, busySlotCount, excludedCount) {
        if (!gcalStatusBadge) return;
        if (eventCount === 0) {
            gcalStatusBadge.style.display = 'inline-flex';
            gcalStatusBadge.innerHTML = `<span>📅 該当期間の予定なし</span> <button class="clear-gcal-btn" title="クリア">✕</button>`;
        } else {
            gcalStatusBadge.style.display = 'inline-flex';
            gcalStatusBadge.innerHTML = `<span>📅 Google予定: ${eventCount}件 (${busySlotCount}時間)</span> <button class="clear-gcal-btn" title="連携解除・クリア">✕</button>`;
        }

        const clearBtn = gcalStatusBadge.querySelector('.clear-gcal-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearGcalImport);
        }

        if (importGcalBtn) {
            importGcalBtn.classList.add('connected');
        }
    }

    function clearGcalImport() {
        gcalImportedEvents = [];
        localStorage.removeItem('gcal_auto_sync');
        sessionStorage.removeItem('gcal_token');
        sessionStorage.removeItem('gcal_token_exp');
        document.querySelectorAll('.time-slot.gcal-busy').forEach(slot => {
            slot.classList.remove('gcal-busy');
            delete slot.dataset.gcalEvent;
            if (slot.title && slot.title.includes(' [📅 Google予定:')) {
                slot.title = slot.title.split(' [📅 Google予定:')[0];
            }
        });

        if (gcalStatusBadge) {
            gcalStatusBadge.style.display = 'none';
        }
        if (importGcalBtn) {
            importGcalBtn.classList.remove('connected');
        }
        showToast('Googleカレンダーの予定除外をクリアしました');
    }

    async function tryAutoSyncGcal() {
        const token = sessionStorage.getItem('gcal_token');
        const exp = parseInt(sessionStorage.getItem('gcal_token_exp') || '0', 10);
        if (token && Date.now() < exp) {
            await fetchGcalEvents(token);
        }
    }

    if (importGcalBtn) {
        importGcalBtn.addEventListener('click', handleGcalImport);
    }
});