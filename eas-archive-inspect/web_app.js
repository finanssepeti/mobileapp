window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());

      gtag('config', 'G-6CW8DD1N1N');

function whenIdle(fn, timeoutMs) {
    timeoutMs = timeoutMs || 2000;
    if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(function() { fn(); }, { timeout: timeoutMs });
    else setTimeout(fn, 1);
}
function loadExternalScriptOnce(src, globalGuard, promiseKey) {
    try {
        if (globalGuard && globalGuard()) return Promise.resolve(true);
        if (promiseKey && window[promiseKey]) return window[promiseKey];
        var p = new Promise(function(resolve, reject) {
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = function() { resolve(true); };
            s.onerror = function() { reject(new Error('Script yüklenemedi: ' + src)); };
            document.head.appendChild(s);
        });
        if (promiseKey) window[promiseKey] = p.finally(function() { window[promiseKey] = null; });
        return p;
    } catch (e) { return Promise.reject(e); }
}

function ensureChartJsLoaded() {
    return loadExternalScriptOnce(
        'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
        function() { return typeof window.Chart !== 'undefined'; },
        '__chartJsLoadingPromise'
    );
}

function ensureJspdfLoaded() {
    // jsPDF UMD + autotable plugin
    return loadExternalScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
        function() { return !!(window.jspdf && window.jspdf.jsPDF); },
        '__jspdfLoadingPromise'
    ).then(function() {
        return loadExternalScriptOnce(
            'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
            function() { return !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable); },
            '__jspdfAutoTableLoadingPromise'
        );
    });
}

function ensureHtml2CanvasLoaded() {
    return loadExternalScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
        function() { return typeof window.html2canvas === 'function'; },
        '__html2canvasLoadingPromise'
    );
}

function ensurePdfMakeLoaded() {
    return loadExternalScriptOnce(
        'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/pdfmake.min.js',
        function() { return !!window.pdfMake; },
        '__pdfMakeLoadingPromise'
    ).then(function() {
        return loadExternalScriptOnce(
            'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.10/vfs_fonts.min.js',
            function() { return !!(window.pdfMake && window.pdfMake.vfs); },
            '__pdfMakeVfsLoadingPromise'
        );
    });
}

/** Pie chart legend: wrap / shrink on narrow viewports so the canvas does not overflow. */
function pieLegendLabelOpts(textColor) {
    var w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    var narrow = w < 640;
    return {
        color: textColor,
        maxWidth: narrow ? Math.min(130, Math.max(70, w - 56)) : 200,
        boxWidth: narrow ? 10 : 12,
        font: { size: narrow ? 10 : 12, weight: '600' },
        padding: narrow ? 6 : 15
    };
}

let incomeChart = null;
let currentIncomeDocId = null;
let currentExpenseDocId = null;
let currentEBITDADocId = null;
        /* NAKİT AKIŞ TABLOSU JS */
        let currentCashFlowDocId = null;

        function initCashFlowYearSelect() {
            const yearSelect = document.getElementById('cashFlowYearSelect');
            if (!yearSelect) return;
            yearSelect.innerHTML = '';
            const currentYear = new Date().getFullYear();
            for (let y = 2200; y >= 2010; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
        }

        async function syncCashFlowYearToData() {
            const user = auth.currentUser;
            if (!user) return;
            const yearSelect = document.getElementById('cashFlowYearSelect');
            if (!yearSelect) return;
            try {
                const ebitdaSnap = await db.collection('ebitdaProjections').where('userId', '==', user.uid).get();
                let latestYear = 0;
                ebitdaSnap.docs.forEach(doc => {
                    const y = Number(doc.data().year) || 0;
                    if (y > latestYear) latestYear = y;
                });
                if (latestYear > 0 && yearSelect.querySelector(`option[value="${latestYear}"]`)) {
                    yearSelect.value = latestYear;
                }
            } catch (e) { /* Hata olursa mevcut yılı kullan */ }
        }

        function updateCashFlowMonthHeaders() {
            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            for (let i = 1; i <= 12; i++) {
                const header1 = document.getElementById('cfMonth' + i);
                const header2 = document.getElementById('cfDetailMonth' + i);
                if (header1) header1.textContent = monthNames[i] + '.' + yearShort;
                if (header2) header2.textContent = monthNames[i] + '.' + yearShort;
            }
        }

        async function loadCashFlowTableData() {
            const user = auth.currentUser;
            if (!user) return;

            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);

            try {
                // Nakit Akış Tablosu verilerini önce kontrol et
                const cashFlowSnap = await db.collection('cashFlowTables')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                const hasExistingCashFlow = !cashFlowSnap.empty;

                // EBITDA verilerini yükle
                const ebitdaSnap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                // Gelir kalemlerinden verileri al
                const incomeItemsSnap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();
                
                // Gider kalemlerinden verileri al
                const expenseItemsSnap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();

                // Kullandığım Krediler: hangi ay/yıl kaydedildiyse o aya kredi tutarını aktar
                let usedCreditsByMonth = {};
                try {
                    const userCreditsSnap = await db.collection('userCredits').where('userId', '==', user.uid).get();
                    userCreditsSnap.docs.forEach(doc => {
                        const d = doc.data();
                        const tarih = (d.tarih || '').toString();
                        if (!tarih || tarih.length < 7) return;
                        const credYear = parseInt(tarih.slice(0, 4), 10);
                        if (credYear !== year) return;
                        const credMonth = parseInt(tarih.slice(5, 7), 10);
                        if (credMonth < 1 || credMonth > 12) return;
                        usedCreditsByMonth[credMonth] = (usedCreditsByMonth[credMonth] || 0) + (Number(d.tutar) || 0);
                    });
                } catch (e) { console.error('userCredits yükleme:', e); }

                // EBITDA verilerini önce yükle
                let ebitdaMonthlyData = {};
                if (!ebitdaSnap.empty) {
                    const ebitdaData = ebitdaSnap.docs[0].data();
                    if (ebitdaData.monthlyData) {
                        ebitdaMonthlyData = ebitdaData.monthlyData;
                    }
                }

                // Temettü/İkramiye/Prim satırlarını göster/gizle (Gelirlerim'de tiklenmişse gizle)
                let hideDividend = false, hideBonus = false, hidePremium = false;
                incomeItemsSnap.docs.forEach(doc => {
                    const d = doc.data();
                    if (d.dividendDisabled) hideDividend = true;
                    if (d.bonusDisabled) hideBonus = true;
                    if (d.premiumDisabled) hidePremium = true;
                });
                const divRow = document.querySelector('#cashFlowModal tr[data-cf-row="dividend"]');
                const bonRow = document.querySelector('#cashFlowModal tr[data-cf-row="bonus"]');
                const premRow = document.querySelector('#cashFlowModal tr[data-cf-row="premium"]');
                if (divRow) { divRow.style.display = hideDividend ? 'none' : ''; if (hideDividend) divRow.querySelectorAll('input').forEach(inp => inp.value = ''); }
                if (bonRow) { bonRow.style.display = hideBonus ? 'none' : ''; if (hideBonus) bonRow.querySelectorAll('input').forEach(inp => inp.value = ''); }
                if (premRow) { premRow.style.display = hidePremium ? 'none' : ''; if (hidePremium) premRow.querySelectorAll('input').forEach(inp => inp.value = ''); }

                // Temettü: yıllık toplam sadece MART ayına; İkramiye/Prim: Ocak,Nisan,Temmuz,Ekim
                let totalDividendYear = 0;
                const bonusByMonth = {}; const premiumByMonth = {};
                incomeItemsSnap.docs.forEach(doc => {
                    const data = doc.data();
                    const m = Number(data.month) || 1;
                    if (!hideDividend) totalDividendYear += Number(data.dividend) || 0;
                    if (!hideBonus && [1,4,7,10].includes(m)) bonusByMonth[m] = (bonusByMonth[m] || 0) + (Number(data.bonus) || 0);
                    if (!hidePremium && [1,4,7,10].includes(m)) premiumByMonth[m] = (premiumByMonth[m] || 0) + (Number(data.premium) || 0);
                });

                // Yatırımlar: Aylık Portföy'den (dailyPortfolios) ay/yıl bazında toplam
                const portfolioSnap = await db.collection('dailyPortfolios').where('userId', '==', user.uid).get();
                const investmentsByMonth = {};
                portfolioSnap.docs.forEach(doc => {
                    const d = doc.data();
                    const date = (d.date || '').toString();
                    if (date.startsWith(String(year))) {
                        const m = parseInt(date.slice(5, 7), 10);
                        investmentsByMonth[m] = (investmentsByMonth[m] || 0) + (Number(d.total) || 0);
                    }
                });

                for (let month = 1; month <= 12; month++) {
                    // EBITDA: Her ay EBITDA Projeksiyonum'dan doğrudan çek (ay bazında yansıt)
                    const ebitdaDetailInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="ebitda-detail"]`);
                    if (ebitdaDetailInput) {
                        const md = ebitdaMonthlyData[month] || ebitdaMonthlyData[String(month)];
                    const ebitdaVal = (md && md.ebitda != null) ? Number(md.ebitda) : 0;
                        ebitdaDetailInput.value = valueForNumberInput(ebitdaVal);
                    }

                    // Temettü: sadece Mart ayına - Gelirlerim'de kaydedildiyse her zaman yansıt
                    const dividendInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="dividend"]`);
                    if (dividendInput && !hideDividend) {
                        dividendInput.value = valueForNumberInput(month === 3 ? totalDividendYear : 0);
                    }
                    // İkramiye, Prim: Ocak, Nisan, Temmuz, Ekim - Gelirlerim'de kaydedildiyse her zaman yansıt
                    const bonusInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="bonus"]`);
                    const premiumInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="premium"]`);
                    if (bonusInput && !hideBonus) bonusInput.value = valueForNumberInput(bonusByMonth[month] || 0);
                    if (premiumInput && !hidePremium) premiumInput.value = valueForNumberInput(premiumByMonth[month] || 0);

                    // Yatırımlar: Her zaman Aylık Portföy'den çek
                    const invInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="investments"]`);
                    if (invInput) invInput.value = valueForNumberInput(investmentsByMonth[month] || 0);

                    // Gider verileri - Kredi Kartları ve Krediler (month karşılaştırması tip uyumluluğu için)
                    const monthExpenseItems = expenseItemsSnap.docs.filter(doc => Number(doc.data().month) === month || doc.data().month === month);
                    let monthlyCreditCards = 0;
                    let monthlyCredits = 0;
                    
                    monthExpenseItems.forEach(doc => {
                        const data = doc.data();
                        monthlyCreditCards += Number(data.creditCardsTotal) || 0;
                        monthlyCredits += Number(data.creditsTotal) || 0;
                    });

                    // Kredi Kartları ve Krediler: Her zaman Giderlerim'den çek (Şubat 30.000 ise Şubat'a direkt aktar)
                    const creditCardInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="credit-card"]`);
                    const loansInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="loans"]`);
                    if (creditCardInput) creditCardInput.value = valueForNumberInput(monthlyCreditCards);
                    if (loansInput) loansInput.value = valueForNumberInput(monthlyCredits);
                }

                // Nakit Akış Tablosu verilerini yükle (yukarıda zaten kontrol edildi)
                if (hasExistingCashFlow) {
                    // Mevcut kayıt varsa tüm alanları geri yükle (nokta ayırcı: valueForNumberInput)
                    currentCashFlowDocId = cashFlowSnap.docs[0].id;
                    const data = cashFlowSnap.docs[0].data();
                    
                    // Dönem başı nakit
                    if (data.beginningCash !== undefined) {
                        document.getElementById('cashFlowBeginningCash').value = valueForNumberInput(data.beginningCash || 0);
                    }

                    // Aylık verileri yükle - tüm kalemler (ay key sayı veya string olabilir)
                    if (data.monthlyData) {
                        for (let month = 1; month <= 12; month++) {
                            const monthData = data.monthlyData[month] || data.monthlyData[String(month)];
                            if (monthData) {
                                const setVal = (type, val) => {
                                    const input = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="${type}"]`);
                                    if (input) input.value = valueForNumberInput(val || 0);
                                };
                                setVal('beginning', monthData.beginning);
                                setVal('dividend', monthData.dividend);
                                setVal('bonus', monthData.bonus);
                                setVal('premium', monthData.premium);
                                setVal('ebitda-detail', monthData.ebitda);
                                setVal('inflows', monthData.inflows);
                                setVal('credit-card', monthData.creditCard);
                                setVal('loans', monthData.loans);
                                setVal('investments', monthData.investments);
                                setVal('outflows', monthData.outflows);
                                setVal('periodic-diff', monthData.periodicDiff);
                                setVal('cumulative-diff', monthData.cumulativeDiff);
                            }
                        }
                    }
                } else {
                    // Yeni kayıt için otomatik verileri doldur (sadece boş alanlar için)
                    // Dönem başı nakti ilk aya kopyala (sadece manuel girilmişse)
                    const beginningCash = parseFormattedNumber(document.getElementById('cashFlowBeginningCash').value);
                    const firstMonthInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="1"][data-type="beginning"]`);
                    if (firstMonthInput && beginningCash > 0 && !firstMonthInput.value) {
                        firstMonthInput.value = valueForNumberInput(beginningCash);
                    }
                }

                // EBITDA ve gider kalemleri (Toplam Kredi Kartı, Toplam Krediler) her zaman canlı kaynaktan nakit akış tablosuna aktarılır
                for (let month = 1; month <= 12; month++) {
                    const ebitdaDetailInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="ebitda-detail"]`);
                    if (ebitdaDetailInput) {
                        const md = ebitdaMonthlyData[month] || ebitdaMonthlyData[String(month)];
                        const ebitdaVal = (md && md.ebitda != null) ? Number(md.ebitda) : 0;
                        ebitdaDetailInput.value = valueForNumberInput(ebitdaVal);
                    }
                    const monthExpenseItems = expenseItemsSnap.docs.filter(doc => Number(doc.data().month) === month || doc.data().month === month);
                    let monthlyCreditCards = 0;
                    let monthlyCredits = 0;
                    monthExpenseItems.forEach(doc => {
                        const data = doc.data();
                        monthlyCreditCards += Number(data.creditCardsTotal) || 0;
                        monthlyCredits += Number(data.creditsTotal) || 0;
                    });
                    const creditCardInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="credit-card"]`);
                    const loansInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="loans"]`);
                    if (creditCardInput) creditCardInput.value = valueForNumberInput(monthlyCreditCards);
                    if (loansInput) loansInput.value = valueForNumberInput(monthlyCredits);
                }

                // Kullandığım Krediler satırını doldur (kaydedilen ay/yıla göre; manuel müdahale yok)
                for (let month = 1; month <= 12; month++) {
                    const usedCreditsInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="used-credits"]`);
                    if (usedCreditsInput) usedCreditsInput.value = valueForNumberInput(usedCreditsByMonth[month] || 0);
                }

                // Nakit akış hesaplamalarını yap
                calculateCashFlow();
            } catch (err) {
                console.error('Nakit akış tablosu verileri yüklenirken hata:', err);
                alert('Nakit akış tablosu yüklenirken hata oluştu: ' + (err.message || err));
            }
        }

        // Kullandığım Krediler kaydedildikten sonra nakit akış tablosu açıksa ilgili yılın satırını güncelle
        async function refreshCashFlowUsedCreditsForYear(year) {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user || typeof db === 'undefined') return;
            var modal = document.getElementById('cashFlowModal');
            if (!modal || modal.style.display === 'none') return;
            var yearSelect = document.getElementById('cashFlowYearSelect');
            if (!yearSelect || parseInt(yearSelect.value, 10) !== year) return;
            try {
                var usedCreditsByMonth = {};
                var snap = await db.collection('userCredits').where('userId', '==', user.uid).get();
                snap.docs.forEach(function(doc) {
                    var d = doc.data();
                    var tarih = (d.tarih || '').toString();
                    if (!tarih || tarih.length < 7) return;
                    var credYear = parseInt(tarih.slice(0, 4), 10);
                    if (credYear !== year) return;
                    var credMonth = parseInt(tarih.slice(5, 7), 10);
                    if (credMonth < 1 || credMonth > 12) return;
                    usedCreditsByMonth[credMonth] = (usedCreditsByMonth[credMonth] || 0) + (Number(d.tutar) || 0);
                });
                for (var month = 1; month <= 12; month++) {
                    var usedCreditsInput = document.querySelector('#cashFlowModal .cashflow-month-input[data-month="' + month + '"][data-type="used-credits"]');
                    if (usedCreditsInput) usedCreditsInput.value = valueForNumberInput(usedCreditsByMonth[month] || 0);
                }
                if (typeof calculateCashFlow === 'function') calculateCashFlow();
                if (typeof calculateCashFlowTotals === 'function') calculateCashFlowTotals();
            } catch (e) { console.error('refreshCashFlowUsedCreditsForYear:', e); }
        }

        function transferBeginningCashToTable() {
            const beginningCashInput = document.getElementById('cashFlowBeginningCash');
            if (!beginningCashInput) return;
            const raw = (beginningCashInput.value || '').toString().trim();
            const beginningCash = (typeof parseFormattedNumber !== 'undefined' ? parseFormattedNumber : window.parseFormattedNumber)(raw) || 0;
            const firstMonthInput = document.querySelector('#cashFlowModal .cashflow-month-input[data-month="1"][data-type="beginning"]');
            if (firstMonthInput) {
                const valueForNumberInputFn = (typeof valueForNumberInput !== 'undefined' ? valueForNumberInput : window.valueForNumberInput);
                firstMonthInput.value = valueForNumberInputFn ? valueForNumberInputFn(beginningCash) : String(beginningCash);
                if (typeof calculateCashFlow === 'function') calculateCashFlow();
            }
        }

        function updateBeginningCashToFirstMonth() {
            const beginningCash = parseFormattedNumber(document.getElementById('cashFlowBeginningCash').value);
            const firstMonthInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="1"][data-type="beginning"]`);
            if (firstMonthInput) {
                firstMonthInput.value = valueForNumberInput(beginningCash);
            }
            calculateCashFlow();
        }

        function calculateCashFlow() {
            // Dönem başı nakti her zaman ilk aya kopyala
            const beginningCash = parseFormattedNumber(document.getElementById('cashFlowBeginningCash').value);
            const firstMonthInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="1"][data-type="beginning"]`);
            if (firstMonthInput && beginningCash > 0) {
                firstMonthInput.value = valueForNumberInput(beginningCash);
            }

            let cumulativeDiff = 0;

            for (let month = 1; month <= 12; month++) {
                // Nakit girişleri: Dönem Başı, Kullandığım Krediler, Temettü, İkramiye, Prim, EBITDA
                const beginning = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="beginning"]`)?.value) || 0;
                const usedCredits = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="used-credits"]`)?.value) || 0;
                const dividend = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="dividend"]`)?.value) || 0;
                const bonus = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="bonus"]`)?.value) || 0;
                const premium = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="premium"]`)?.value) || 0;
                const ebitda = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="ebitda-detail"]`)?.value) || 0;

                const inflows = beginning + usedCredits + dividend + bonus + premium + ebitda;
                const inflowsInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="inflows"]`);
                if (inflowsInput) inflowsInput.value = valueForNumberInput(inflows);

                // Nakit çıkışları (Toplam Kredi Kartı, Toplam Krediler, Yatırımlar)
                const creditCard = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="credit-card"]`)?.value) || 0;
                const loans = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="loans"]`)?.value) || 0;
                const investments = parseFormattedNumber(document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="investments"]`)?.value) || 0;

                const outflows = creditCard + loans + investments;
                const outflowsInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="outflows"]`);
                if (outflowsInput) outflowsInput.value = valueForNumberInput(outflows);

                // Dönemsel nakit farkı
                const periodicDiff = inflows - outflows;
                const periodicDiffInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="periodic-diff"]`);
                if (periodicDiffInput) periodicDiffInput.value = valueForNumberInput(periodicDiff);

                // Kümülatif nakit farkı
                cumulativeDiff += periodicDiff;
                const cumulativeDiffInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="cumulative-diff"]`);
                if (cumulativeDiffInput) cumulativeDiffInput.value = valueForNumberInput(cumulativeDiff);
                // Aralık (ay 12) yazıldığında TOPLAM sütununu da aynı değer yap (turuncu hücre = Ara.26 ile aynı)
                if (month === 12) {
                    const totalInput = document.querySelector(`#cashFlowModal .cashflow-total-input[data-type="cumulative-diff-total"]`);
                    if (totalInput) totalInput.value = valueForNumberInput(cumulativeDiff);
                }

                // Sonraki ayın dönem başı nakti = bu ayın dönemsel nakit farkı (Ocak farkı → Şubat başı, Şubat farkı → Mart başı, ... Aralık başına kadar)
                if (month < 12) {
                    const nextMonthInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month + 1}"][data-type="beginning"]`);
                    if (nextMonthInput) {
                        nextMonthInput.value = valueForNumberInput(periodicDiff);
                    }
                }
            }

            // Toplamları hesapla
            calculateCashFlowTotals();
        }

        function calculateCashFlowTotals() {
            const types = ['beginning', 'used-credits', 'dividend', 'bonus', 'premium', 'ebitda-detail', 'inflows', 'credit-card', 'loans', 'investments', 'outflows', 'periodic-diff', 'cumulative-diff'];
            
            types.forEach(type => {
                let total;
                if (type === 'cumulative-diff') {
                    // Kümülatif nakit farkı: TOPLAM sütunu = Aralık (ay 12) hücresindeki değer (yıl sonu kümülatif)
                    const decInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="12"][data-type="${type}"]`);
                    total = decInput ? parseFormattedNumber(decInput.value) : 0;
                } else if (type === 'beginning') {
                    // Dönem Başı Nakit: Toplam sütunu = Ocak (ay 1) hücresindeki değer (toplama yapma)
                    const janInput = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="1"][data-type="beginning"]`);
                    total = janInput ? parseFormattedNumber(janInput.value) : 0;
                } else {
                    total = 0;
                    for (let month = 1; month <= 12; month++) {
                        const input = document.querySelector(`#cashFlowModal .cashflow-month-input[data-month="${month}"][data-type="${type}"]`);
                        if (input) {
                            total += parseFormattedNumber(input.value);
                        }
                    }
                }
                const totalInput = document.querySelector(`#cashFlowModal .cashflow-total-input[data-type="${type}-total"]`);
                if (totalInput) totalInput.value = valueForNumberInput(total);
            });
        }

        // Nakit akış tablosu: hücreden çıkınca sayıyı binlik nokta ile formatla (10.000,00)
        (function() {
            var modal = document.getElementById('cashFlowModal');
            if (!modal) return;
            modal.addEventListener('blur', function(e) {
                var el = e.target;
                if (!el || !el.classList) return;
                if (!el.classList.contains('cashflow-month-input') && !el.classList.contains('cashflow-total-input')) return;
                if (el.readOnly) return;
                var val = (typeof parseFormattedNumber !== 'undefined' ? parseFormattedNumber(el.value) : parseFloat(String(el.value).replace(/\./g,'').replace(',','.')) || 0);
                var formatted = (typeof valueForNumberInput !== 'undefined' ? valueForNumberInput(val) : (typeof formatNumber !== 'undefined' ? formatNumber(val) : String(val)));
                if (formatted !== undefined && formatted !== '') el.value = formatted;
                calculateCashFlow();
            }, true);
        })();

        async function saveCashFlowTable() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kayıt için önce giriş yapmanız gerekiyor.');
                return;
            }

            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);
            const beginningCash = parseFormattedNumber(document.getElementById('cashFlowBeginningCash').value) || 0;
            const monthlyData = {};

            for (let month = 1; month <= 12; month++) {
                const getVal = (type) => parseFormattedNumber(document.querySelector(`.cashflow-month-input[data-month="${month}"][data-type="${type}"]`)?.value) || 0;
                monthlyData[month] = {
                    beginning: getVal('beginning'),
                    dividend: getVal('dividend'),
                    bonus: getVal('bonus'),
                    premium: getVal('premium'),
                    ebitda: getVal('ebitda-detail'),
                    inflows: getVal('inflows'),
                    creditCard: getVal('credit-card'),
                    loans: getVal('loans'),
                    investments: getVal('investments'),
                    outflows: getVal('outflows'),
                    periodicDiff: getVal('periodic-diff'),
                    cumulativeDiff: getVal('cumulative-diff')
                };
            }

            const data = {
                userId: user.uid,
                year,
                beginningCash,
                monthlyData,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                if (currentCashFlowDocId) {
                    await db.collection('cashFlowTables').doc(currentCashFlowDocId).update(data);
                    alert('Nakit akış tablosu başarıyla güncellendi!');
                    currentCashFlowDocId = null;
                } else {
                    const existingSnap = await db.collection('cashFlowTables')
                        .where('userId', '==', user.uid)
                        .where('year', '==', year)
                        .limit(1)
                        .get();

                    if (!existingSnap.empty) {
                        await existingSnap.docs[0].ref.update(data);
                        alert('Nakit akış tablosu güncellendi!');
                    } else {
                        await db.collection('cashFlowTables').add(data);
                        alert('Nakit akış tablosu kaydedildi!');
                    }
                }
                closeCashFlowModal();
            } catch (err) {
                console.error(err);
                alert('Kayıt sırasında hata oluştu.');
            }
        }

        async function editCashFlowTable() {
            const user = auth.currentUser;
            if (!user) {
                alert('Düzenlemek için giriş yapmanız gerekiyor.');
                return;
            }

            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);

            try {
                const snap = await db.collection('cashFlowTables')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu yıl için kayıtlı nakit akış tablosu bulunamadı.');
                    return;
                }

                currentCashFlowDocId = snap.docs[0].id;
                await loadCashFlowTableData();
                alert('Nakit akış tablosu yüklendi. Düzenleyip kaydedebilirsiniz.');
            } catch (err) {
                console.error('Nakit akış tablosu yüklenirken hata:', err);
                alert('Veriler yüklenirken hata oluştu.');
            }
        }

        async function deleteCashFlowTable() {
            const user = auth.currentUser;
            if (!user) {
                alert('Silmek için giriş yapmanız gerekiyor.');
                return;
            }

            if (!confirm('Bu yıl için kayıtlı nakit akış tablosunu silmek istediğinize emin misiniz?')) {
                return;
            }

            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);

            try {
                const snap = await db.collection('cashFlowTables')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu yıl için kayıtlı nakit akış tablosu bulunamadı.');
                    return;
                }

                await snap.docs[0].ref.delete();
                alert('Nakit akış tablosu başarıyla silindi!');
                
                // Form alanlarını temizle
                document.getElementById('cashFlowBeginningCash').value = '';
                const allInputs = document.querySelectorAll('#cashFlowModal .cashflow-month-input');
                allInputs.forEach(input => input.value = '');
                currentCashFlowDocId = null;
            } catch (err) {
                console.error('Nakit akış tablosu silinirken hata:', err);
                alert('Silme işlemi sırasında hata oluştu.');
            }
        }

        async function openCashFlowListModal() {
            document.getElementById('cashFlowModal').style.display = 'none';
            document.getElementById('cashFlowListModal').style.display = 'flex';
            await loadCashFlowList();
        }

        function closeCashFlowListModal() {
            document.getElementById('cashFlowListModal').style.display = 'none';
            document.getElementById('cashFlowModal').style.display = 'flex';
        }

        async function loadCashFlowList() {
            const user = auth.currentUser;
            if (!user) return;

            const container = document.getElementById('cashFlowListContainer');
            container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Yükleniyor...</p>';

            try {
                const snap = await db.collection('cashFlowTables')
                    .where('userId', '==', user.uid)
                    .orderBy('year', 'desc')
                    .get();

                if (snap.empty) {
                    container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Henüz kaydedilmiş nakit akış tablosu yok.</p>';
                    return;
                }

                let html = '<div style="display:grid; gap:15px;">';
                
                snap.forEach(doc => {
                    const data = doc.data();
                    html += `
                        <div style="background:rgba(26,35,126,0.3); padding:15px; border-radius:8px; border:1px solid rgba(203,213,245,0.2);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                <div>
                                    <h3 style="color:var(--light-blue); margin:0; font-size:18px;">${data.year} Yılı</h3>
                                    <p style="color:#cbd5f5; margin:5px 0 0 0; font-size:14px;">Dönem Başı Nakit: ${formatNumber(data.beginningCash || 0)} ₺</p>
                                </div>
                                <div style="display:flex; gap:10px;">
                                    <button class="btn-edit-income" onclick="editCashFlowFromList('${doc.id}', ${data.year})" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-edit"></i> DÜZENLE
                                    </button>
                                    <button class="btn-delete-income" onclick="deleteCashFlowFromList('${doc.id}')" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-trash"></i> SİL
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                container.innerHTML = html;
            } catch (err) {
                console.error('Nakit akış tablosu listesi yüklenirken hata:', err);
                container.innerHTML = '<p style="color:#ef4444; text-align:center;">Liste yüklenirken hata oluştu.</p>';
            }
        }

        async function editCashFlowFromList(docId, year) {
            document.getElementById('cashFlowListModal').style.display = 'none';
            document.getElementById('cashFlowModal').style.display = 'flex';
            document.getElementById('cashFlowYearSelect').value = year;
            currentCashFlowDocId = docId;
            await loadCashFlowTableData();
        }

        async function deleteCashFlowFromList(docId) {
            if (!confirm('Bu nakit akış tablosunu silmek istediğinize emin misiniz?')) return;

            try {
                await db.collection('cashFlowTables').doc(docId).delete();
                alert('Nakit akış tablosu başarıyla silindi!');
                await loadCashFlowList();
            } catch (err) {
                console.error('Silme hatası:', err);
                alert('Silme sırasında hata oluştu.');
            }
        }

        async function searchCashFlowByDateRange() {
            const user = auth.currentUser;
            if (!user) {
                alert('Arama yapmak için giriş yapmanız gerekiyor.');
                return;
            }

            const startDate = document.getElementById('cashFlowStartDate').value;
            const endDate = document.getElementById('cashFlowEndDate').value;

            if (!startDate || !endDate) {
                alert('Lütfen başlangıç ve bitiş tarihlerini seçiniz.');
                return;
            }

            if (new Date(startDate) > new Date(endDate)) {
                alert('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
                return;
            }

            // Tarih aralığına göre verileri filtrele ve göster
            alert('Tarih aralığı arama özelliği yakında eklenecek.');
        }

        function exportCashFlowToExcel() {
            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            
            // HTML tablosu olarak Excel export (stil desteği için)
            let html = `
                <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
                <head>
                    <meta charset="utf-8">
                    <!--[if gte mso 9]>
                    <xml>
                        <x:ExcelWorkbook>
                            <x:ExcelWorksheets>
                                <x:ExcelWorksheet>
                                    <x:Name>Nakit Akış Tablosu</x:Name>
                                    <x:WorksheetOptions>
                                        <x:DefaultRowHeight>15</x:DefaultRowHeight>
                                    </x:WorksheetOptions>
                                </x:ExcelWorksheet>
                            </x:ExcelWorksheets>
                        </x:ExcelWorkbook>
                    </xml>
                    <![endif]-->
                    <style>
                        table { border-collapse: collapse; width: 100%; }
                        td { border: 1px solid #ddd; padding: 5px; text-align: left; }
                        th { border: 1px solid #ddd; padding: 5px; background-color: #1a237e; color: white; text-align: center; font-weight: bold; }
                        .label-normal { font-style: italic; }
                        .label-bold-blue { font-weight: bold; color: #1a237e !important; }
                        .number-cell { text-align: right; }
                        .total-col { background-color: #ff6d00; color: white; font-weight: bold; text-align: center; }
                        td[style*="color: #1a237e"] { color: #1a237e !important; }
                    </style>
                </head>
                <body>
                    <h2>Nakit Akış Tablosu - ${year}</h2>
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                ${monthNames.slice(1).map(m => `<th>${m}.${yearShort}</th>`).join('')}
                                <th class="total-col">TOPLAM</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${[
                                {label: 'dönem başı nakit', type: 'beginning', style: 'label-normal', checkboxId: null},
                                {label: 'Kullandığım Krediler', type: 'used-credits', style: 'label-normal', checkboxId: null},
                                {label: 'temettü', type: 'dividend', style: 'label-normal', checkboxId: 'incomeDividendCheck'},
                                {label: 'ikramiye', type: 'bonus', style: 'label-normal', checkboxId: 'incomeBonusCheck'},
                                {label: 'prim', type: 'premium', style: 'label-normal', checkboxId: 'incomePremiumCheck'},
                                {label: 'ebitda', type: 'ebitda-detail', style: 'label-normal', checkboxId: null},
                                {label: 'TOPLAM NAKİT GİRİŞLERİ', type: 'inflows', style: 'label-bold-blue', checkboxId: null},
                                {label: 'toplam kredi kartı', type: 'credit-card', style: 'label-normal', checkboxId: null},
                                {label: 'toplam krediler', type: 'loans', style: 'label-normal', checkboxId: null},
                                {label: 'Yatırımlarım(Emtia,Hisse,Fon v.s.)', type: 'investments', style: 'label-normal', checkboxId: null},
                                {label: 'TOPLAM NAKİT ÇIKIŞLARI', type: 'outflows', style: 'label-bold-blue', checkboxId: null},
                                {label: 'Dönemsel nakit farkı', type: 'periodic-diff', style: 'label-normal', checkboxId: null},
                                {label: 'Kümülatif nakit farkı', type: 'cumulative-diff', style: 'label-normal', checkboxId: null}
                            ].filter(item => {
                                // Checkbox işaretliyse bu satırı filtrele
                                if (item.checkboxId) {
                                    const checkbox = document.getElementById(item.checkboxId);
                                    if (checkbox && checkbox.checked) {
                                        return false; // Bu satırı gösterme
                                    }
                                }
                                return true;
                            }).map((item, rowIndex) => {
                                const isTotalRow = item.type === 'inflows' || item.type === 'outflows';
                                const rowStyle = '';
                                const labelStyle = item.style === 'label-bold-blue' 
                                    ? 'style="font-weight: bold; color: #1a237e !important; text-align: left; text-decoration: underline; border-bottom: 2px solid #1a237e;"' 
                                    : 'style="font-style: italic; text-align: left;"';
                                const cellStyle = isTotalRow 
                                    ? 'style="color: #1a237e !important; text-align: right; text-decoration: underline; border-bottom: 2px solid #1a237e; font-weight: bold;"' 
                                    : 'class="number-cell"';
                                const totalCellStyle = isTotalRow 
                                    ? 'style="color: #1a237e !important; font-weight: bold; text-align: center; text-decoration: underline; border-bottom: 2px solid #1a237e;"' 
                                    : 'class="total-col number-cell"';
                                return `<tr ${rowStyle}>
                                    <td ${labelStyle}>${item.label}</td>
                                    ${Array.from({length: 12}, (_, i) => {
                                        const input = document.querySelector(`.cashflow-month-input[data-month="${i+1}"][data-type="${item.type}"]`);
                                        const val = parseFormattedNumber(input?.value || 0);
                                        return `<td ${cellStyle}>${formatNumber(val)}</td>`;
                                    }).join('')}
                                    <td ${totalCellStyle}>${formatNumber(parseFormattedNumber(document.querySelector(`.cashflow-total-input[data-type="${item.type}-total"]`)?.value || 0))}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'nakit-akis-tablosu-' + year + '.xls';
            link.click();
            URL.revokeObjectURL(link.href);
        }

        function exportCashFlowToPDF() {
            const year = parseInt(document.getElementById('cashFlowYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            
            let html = `
                <html>
                <head>
                    <title>Nakit Akış Tablosu</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { color: #1a237e; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 10px; }
                        th, td { border: 1px solid #ddd; padding: 6px; }
                        th { background-color: #1a237e; color: white; text-align: center; }
                        td { text-align: left; }
                        .number-cell { text-align: right; }
                        .label-italic { font-style: italic; text-align: left; }
                        .label-bold-blue { font-weight: bold; color: #1a237e; text-align: left; }
                        .total-col { background-color: #ff6d00; color: white; font-weight: bold; text-align: center; }
                    </style>
                </head>
                <body>
                    <h1>Nakit Akış Tablosu - ${year}</h1>
                    <table>
                        <thead>
                            <tr>
                                <th style="text-align: left;"></th>
                                ${monthNames.slice(1).map(m => `<th>${m}.${yearShort}</th>`).join('')}
                                <th class="total-col">TOPLAM</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${[
                                {label: 'Dönem Başı Nakit', type: 'beginning', style: 'italic'},
                                {label: 'Kullandığım Krediler', type: 'used-credits', style: 'italic'},
                                {label: 'Temettü', type: 'dividend', style: 'italic'},
                                {label: 'İkramiye', type: 'bonus', style: 'italic'},
                                {label: 'Prim', type: 'premium', style: 'italic'},
                                {label: 'EBITDA', type: 'ebitda-detail', style: 'italic'},
                                {label: 'TOPLAM NAKİT GİRİŞLERİ', type: 'inflows', style: 'bold-blue'},
                                {label: 'Toplam Kredi Kartı', type: 'credit-card', style: 'italic'},
                                {label: 'Toplam Krediler', type: 'loans', style: 'italic'},
                                {label: 'Yatırımlarım(Emtia,Hisse,Fon v.s.)', type: 'investments', style: 'italic'},
                                {label: 'TOPLAM NAKİT ÇIKIŞLARI', type: 'outflows', style: 'bold-blue'},
                                {label: 'Dönemsel Nakit Farkı', type: 'periodic-diff', style: 'italic'},
                                {label: 'Kümülatif Nakit Farkı', type: 'cumulative-diff', style: 'italic'}
                            ].map((item) => {
                                const labelStyle = item.style === 'bold-blue' 
                                    ? 'style="font-weight: bold; color: #1a237e; text-align: left;"' 
                                    : 'style="font-style: italic; text-align: left;"';
                                return `<tr>
                                    <td ${labelStyle}>${item.label}</td>
                                    ${Array.from({length: 12}, (_, i) => {
                                        const input = document.querySelector(`.cashflow-month-input[data-month="${i+1}"][data-type="${item.type}"]`);
                                        const val = parseFormattedNumber(input?.value || 0);
                                        return `<td style="text-align: right;">${formatNumber(val)}</td>`;
                                    }).join('')}
                                    <td class="total-col" style="text-align: right;">${formatNumber(parseFormattedNumber(document.querySelector(`.cashflow-total-input[data-type="${item.type}-total"]`)?.value || 0))}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
        }

        function initIncomeYearSelect() {
            const yearSelect = document.getElementById('incomeYearSelect');
            if (!yearSelect) return;
            yearSelect.innerHTML = '';
            const currentYear = new Date().getFullYear();
            for (let y = 2200; y >= 2000; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
            const monthSelect = document.getElementById('incomeMonthSelect');
            if (monthSelect) {
                const currentMonth = new Date().getMonth() + 1;
                monthSelect.value = currentMonth;
            }
        }

        function toggleIncomeInput(inputId) {
            const input = document.getElementById(inputId);
            const checkbox = document.getElementById(inputId + 'Check');
            if (!input || !checkbox) return;
            
            if (checkbox.checked) {
                input.disabled = true;
                input.value = '';
                updateIncomeChart();
                updateIncomeTotal();
            } else {
                input.disabled = false;
            }
        }

        function updateIncomeTotal() {
            const salary = parseFormattedNumber(document.getElementById('incomeSalary').value) || 0;
            const dividend = parseFormattedNumber(document.getElementById('incomeDividend').value) || 0;
            const bonus = parseFormattedNumber(document.getElementById('incomeBonus').value) || 0;
            const premium = parseFormattedNumber(document.getElementById('incomePremium').value) || 0;
            const other = parseFormattedNumber(document.getElementById('incomeOther').value) || 0;
            const total = salary + dividend + bonus + premium + other;
            const totalInput = document.getElementById('incomeTotal');
            if (totalInput) {
                totalInput.value = formatNumber(total);
            }
        }

        function initIncomeChart() {
            const ctx = document.getElementById('incomeChart');
            if (!ctx) return;

            if (typeof Chart === 'undefined') {
                ensureChartJsLoaded().then(function() { initIncomeChart(); }).catch(function() {});
                return;
            }
            
            if (incomeChart) {
                incomeChart.destroy();
            }

            incomeChart = new Chart(ctx, {
                type: 'pie',
                data: {
                    labels: ['Maaş', 'Temettü', 'İkramiye', 'Prim', 'Diğer Gelirler'],
                    datasets: [{
                        data: [0, 0, 0, 0, 0],
                        backgroundColor: [
                            '#3b82f6',
                            '#10b981',
                            '#f59e0b',
                            '#ef4444',
                            '#8b5cf6'
                        ],
                        borderWidth: 2,
                        borderColor: '#05103a'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: 6 },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: pieLegendLabelOpts('#e5e7eb')
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed || 0;
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                    return label + ': ' + value.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + ' TL (' + percentage + '%)';
                                }
                            }
                        }
                    }
                }
            });

            if (!window.__incomePieChartResizeBound) {
                window.__incomePieChartResizeBound = true;
                var resizeTimer;
                window.addEventListener('resize', function() {
                    clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(function() {
                        if (!incomeChart || !incomeChart.options || !incomeChart.options.plugins.legend) return;
                        Object.assign(incomeChart.options.plugins.legend.labels, pieLegendLabelOpts('#e5e7eb'));
                        incomeChart.update('none');
                        incomeChart.resize();
                    }, 200);
                });
            }
        }

        function updateIncomeChart() {
            if (!incomeChart) return;

            const salary = parseFormattedNumber(document.getElementById('incomeSalary').value) || 0;
            const dividend = parseFormattedNumber(document.getElementById('incomeDividend').value) || 0;
            const bonus = parseFormattedNumber(document.getElementById('incomeBonus').value) || 0;
            const premium = parseFormattedNumber(document.getElementById('incomePremium').value) || 0;
            const other = parseFormattedNumber(document.getElementById('incomeOther').value) || 0;

            const total = salary + dividend + bonus + premium + other;
            
            incomeChart.data.datasets[0].data = [salary, dividend, bonus, premium, other];
            
            // Update labels with percentages
            const labels = ['Maaş', 'Temettü', 'İkramiye', 'Prim', 'Diğer Gelirler'];
            incomeChart.data.labels = labels.map((label, index) => {
                const value = [salary, dividend, bonus, premium, other][index];
                const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                return label + ' (' + percentage + '%)';
            });

            incomeChart.update();
        }

        async function saveIncomeItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kayıt için önce giriş yapmanız gerekiyor.');
                return;
            }

            const month = parseInt(document.getElementById('incomeMonthSelect').value, 10);
            const year = parseInt(document.getElementById('incomeYearSelect').value, 10);
            const salary = parseFormattedNumber(document.getElementById('incomeSalary').value);
            const dividend = parseFormattedNumber(document.getElementById('incomeDividend').value);
            const bonus = parseFormattedNumber(document.getElementById('incomeBonus').value);
            const premium = parseFormattedNumber(document.getElementById('incomePremium').value);
            const other = parseFormattedNumber(document.getElementById('incomeOther').value);

            const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            
            const dividendCheck = document.getElementById('incomeDividendCheck');
            const bonusCheck = document.getElementById('incomeBonusCheck');
            const premiumCheck = document.getElementById('incomePremiumCheck');
            const data = {
                userId: user.uid,
                year,
                month,
                monthName: monthNames[month],
                salary,
                dividend,
                bonus,
                premium,
                other,
                dividendDisabled: dividendCheck ? dividendCheck.checked : false,
                bonusDisabled: bonusCheck ? bonusCheck.checked : false,
                premiumDisabled: premiumCheck ? premiumCheck.checked : false,
                total: salary + dividend + bonus + premium + other,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                if (currentIncomeDocId) {
                    // Güncelle
                    await db.collection('incomeItems').doc(currentIncomeDocId).update(data);
                    alert('Gelir kalemleri başarıyla güncellendi!');
                    currentIncomeDocId = null;
                } else {
                    // Yeni kayıt
                    await db.collection('incomeItems').add(data);
                    alert('Gelir kalemleri başarıyla kaydedildi!');
                }
                // EBITDA projeksiyonunu otomatik güncelle
                await updateEBITDAProjectionFromIncomeExpenses(year);
                closeIncomeModal();
            } catch (err) {
                console.error(err);
                alert('Kayıt sırasında hata oluştu.');
            }
        }

        async function editIncomeItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Düzenlemek için giriş yapmanız gerekiyor.');
                return;
            }

            const month = parseInt(document.getElementById('incomeMonthSelect').value, 10);
            const year = parseInt(document.getElementById('incomeYearSelect').value, 10);

            try {
                const snap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu ay için kayıtlı gelir kalemi bulunamadı.');
                    return;
                }

                currentIncomeDocId = snap.docs[0].id;
                await loadIncomeData();
                alert('Gelir kalemleri yüklendi. Düzenleyip kaydedebilirsiniz.');
            } catch (err) {
                console.error('Gelir kalemleri yüklenirken hata:', err);
                alert('Veriler yüklenirken hata oluştu.');
            }
        }

        async function deleteIncomeItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Silmek için giriş yapmanız gerekiyor.');
                return;
            }

            if (!confirm('Bu ay için kayıtlı gelir kalemini silmek istediğinize emin misiniz?')) {
                return;
            }

            const month = parseInt(document.getElementById('incomeMonthSelect').value, 10);
            const year = parseInt(document.getElementById('incomeYearSelect').value, 10);

            try {
                const snap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu ay için kayıtlı gelir kalemi bulunamadı.');
                    return;
                }

                await snap.docs[0].ref.delete();
                alert('Gelir kalemi başarıyla silindi!');
                
                // Form alanlarını temizle
                document.getElementById('incomeSalary').value = '';
                document.getElementById('incomeDividend').value = '';
                document.getElementById('incomeBonus').value = '';
                document.getElementById('incomePremium').value = '';
                document.getElementById('incomeOther').value = '';
                updateIncomeChart();
                updateIncomeTotal();
                currentIncomeDocId = null;
            } catch (err) {
                console.error('Gelir kalemi silinirken hata:', err);
                alert('Silme işlemi sırasında hata oluştu.');
            }
        }

        async function loadIncomeData() {
            const user = auth.currentUser;
            if (!user) return;

            const month = parseInt(document.getElementById('incomeMonthSelect').value, 10);
            const year = parseInt(document.getElementById('incomeYearSelect').value, 10);

            try {
                const snap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (!snap.empty) {
                    const doc = snap.docs[0];
                    currentIncomeDocId = doc.id;
                    const data = doc.data();
                    document.getElementById('incomeSalary').value = data.salary || '';
                    document.getElementById('incomeDividend').value = data.dividend || '';
                    document.getElementById('incomeBonus').value = data.bonus || '';
                    document.getElementById('incomePremium').value = data.premium || '';
                    document.getElementById('incomeOther').value = data.other || '';
                    const divChk = document.getElementById('incomeDividendCheck');
                    const bonChk = document.getElementById('incomeBonusCheck');
                    const premChk = document.getElementById('incomePremiumCheck');
                    if (divChk) divChk.checked = !!data.dividendDisabled;
                    if (bonChk) bonChk.checked = !!data.bonusDisabled;
                    if (premChk) premChk.checked = !!data.premiumDisabled;
                    toggleIncomeInput('incomeDividend');
                    toggleIncomeInput('incomeBonus');
                    toggleIncomeInput('incomePremium');
                    updateIncomeChart();
                    updateIncomeTotal();
                } else {
                    // Veri yoksa input alanlarını temizle
                    currentIncomeDocId = null;
                    document.getElementById('incomeSalary').value = '';
                    document.getElementById('incomeDividend').value = '';
                    document.getElementById('incomeBonus').value = '';
                    document.getElementById('incomePremium').value = '';
                    document.getElementById('incomeOther').value = '';
                    updateIncomeChart();
                    updateIncomeTotal();
                }
            } catch (err) {
                console.error('Gelir verileri yüklenirken hata:', err);
            }
        }

        // GELİR KALEMLERİ LİSTE FONKSİYONLARI
        async function openIncomeListModal() {
            document.getElementById('incomeModal').style.display = 'none';
            document.getElementById('incomeListModal').style.display = 'flex';
            await loadIncomeList();
        }

        function closeIncomeListModal() {
            document.getElementById('incomeListModal').style.display = 'none';
            document.getElementById('incomeModal').style.display = 'flex';
        }

        async function loadIncomeList() {
            const user = auth.currentUser;
            if (!user) return;

            const container = document.getElementById('incomeListContainer');
            container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Yükleniyor...</p>';

            try {
                const snap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .orderBy('year', 'desc')
                    .orderBy('month', 'desc')
                    .get();

                if (snap.empty) {
                    container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Henüz kaydedilmiş gelir kalemi yok.</p>';
                    return;
                }

                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                let html = '<div style="display:grid; gap:15px;">';
                
                snap.forEach(doc => {
                    const data = doc.data();
                    const total = (data.salary || 0) + (data.dividend || 0) + (data.bonus || 0) + (data.premium || 0) + (data.other || 0);
                    html += `
                        <div style="background:rgba(26,35,126,0.3); padding:15px; border-radius:8px; border:1px solid rgba(203,213,245,0.2);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                <div>
                                    <h3 style="color:var(--light-blue); margin:0; font-size:18px;">${monthNames[data.month]} ${data.year}</h3>
                                    <p style="color:#cbd5f5; margin:5px 0 0 0; font-size:14px;">Toplam: ${formatNumber(total)} ₺</p>
                                </div>
                                <div style="display:flex; gap:10px;">
                                    <button class="btn-edit-income" onclick="editIncomeFromList('${doc.id}', ${data.month}, ${data.year})" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-edit"></i> DÜZENLE
                                    </button>
                                    <button class="btn-delete-income" onclick="deleteIncomeFromList('${doc.id}')" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-trash"></i> SİL
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                container.innerHTML = html;
            } catch (err) {
                console.error('Gelir listesi yüklenirken hata:', err);
                container.innerHTML = '<p style="color:#ef4444; text-align:center;">Liste yüklenirken hata oluştu.</p>';
            }
        }

        async function editIncomeFromList(docId, month, year) {
            document.getElementById('incomeListModal').style.display = 'none';
            document.getElementById('incomeModal').style.display = 'flex';
            document.getElementById('incomeMonthSelect').value = month;
            document.getElementById('incomeYearSelect').value = year;
            currentIncomeDocId = docId;
            const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            document.getElementById('incomeModalTitle').textContent = 'GELİRLERİM - ' + monthNames[month] + ' ' + year;
            await loadIncomeData();
        }

        async function deleteIncomeFromList(docId) {
            if (!confirm('Bu gelir kalemini silmek istediğinize emin misiniz?')) return;

            try {
                await db.collection('incomeItems').doc(docId).delete();
                alert('Gelir kalemi başarıyla silindi!');
                await loadIncomeList();
            } catch (err) {
                console.error('Silme hatası:', err);
                alert('Silme sırasında hata oluştu.');
            }
        }

        // Eski loadCashFlowData fonksiyonu artık kullanılmıyor, loadCashFlowTableData kullanılıyor

        /* GİDERLERİM JS */
        let expensesPieChart = null;
        let expensesBarChart = null;
        const BANK_LIST = [
            'Vakıfbank', 'Ziraat Bankası', 'Halkbank', 'Akbank', 'Anadolubank', 'Fibabanka',
            'Şekerbank', 'Turkish Bank', 'Türk Ticaret Bankası', 'Türkiye İş Bankası',
            'Turkland Bank A.Ş.', 'Yapı Kredi', 'Alternatif Bank', 'Bank of China Turkey',
            'Arap Türk Bankası', 'Burgan Bank', 'Citibank', 'DenizBank', 'Enpara Bank',
            'Garanti BBVA', 'HSBC', 'ICBC Turkey Bank', 'ING', 'Odeabank', 'QNB',
            'Türk Ekonomi Bankası'
        ];

        function openExpensesDetailModal() {
            document.getElementById('expensesMainModal').style.display = 'none';
            document.getElementById('expensesDetailModal').style.display = 'flex';
            document.getElementById('expensesModalTitle').textContent = 'GİDERLERİM';
            initExpensesYearSelect();
            initCreditCards();
            initExpensesCharts();
            loadExpensesData();
            // Kaydet butonunu göster
            document.getElementById('btnSaveExpenses').style.display = 'block';
            // Tarih aralığı sonuçlarını gizle
            document.getElementById('expensesDateRangeResults').style.display = 'none';
            // Düzenleme durumunu sıfırla
            currentExpenseDocId = null;
            attachExpensesInputFormatting();
        }

        function attachExpensesInputFormatting() {
            // Formatlama event listener'ları kaldırıldı - değerleri silme sorununa neden oluyordu
            // Input alanları normal sayı girişi yapacak, formatlama sadece gösterimde kullanılacak
        }

        function closeExpensesDetailModal() {
            document.getElementById('expensesDetailModal').style.display = 'none';
            document.getElementById('expensesMainModal').style.display = 'flex';
        }

        function initExpensesYearSelect() {
            const yearSelect = document.getElementById('expensesYearSelect');
            if (!yearSelect) return;
            yearSelect.innerHTML = '';
            const currentYear = new Date().getFullYear();
            for (let y = 2200; y >= 2010; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
            const monthSelect = document.getElementById('expensesMonthSelect');
            if (monthSelect) {
                const currentMonth = new Date().getMonth() + 1;
                monthSelect.value = currentMonth;
            }
        }

        function initCreditCards() {
            const container = document.getElementById('creditCardsContainer');
            if (!container) return;
            container.innerHTML = '';
            
            for (let i = 0; i < 6; i++) {
                const cardDiv = document.createElement('div');
                cardDiv.className = 'credit-card-item';
                cardDiv.innerHTML = `
                    <select id="creditCardBank${i}" onchange="updateExpensesTotals()" style="flex: 1; min-width: 150px;">
                        <option value="">Banka Seçiniz</option>
                        ${BANK_LIST.map(bank => `<option value="${bank}">${bank}</option>`).join('')}
                    </select>
                    <input type="number" id="creditCardAmount${i}" step="0.01" placeholder="0.00" oninput="updateExpensesTotals()" />
                    <div class="expenses-checkbox-wrapper">
                        <input type="checkbox" id="creditCardCheck${i}" onchange="toggleExpensesInput('creditCardAmount${i}')" />
                        <span>Yok</span>
                    </div>
                `;
                container.appendChild(cardDiv);
            }
        }

        function toggleExpensesInput(inputId) {
            const input = document.getElementById(inputId);
            const checkbox = document.getElementById(inputId + 'Check');
            if (!input || !checkbox) return;
            
            if (checkbox.checked) {
                input.disabled = true;
                input.value = '';
                updateExpensesTotals();
            } else {
                input.disabled = false;
            }
        }

        function updateExpensesTotals() {
            // Faturalarım toplamı
            const billsTotal = (
                parseFormattedNumber(document.getElementById('expElectricity').value) +
                parseFormattedNumber(document.getElementById('expWater').value) +
                parseFormattedNumber(document.getElementById('expGas').value) +
                parseFormattedNumber(document.getElementById('expMobile').value) +
                parseFormattedNumber(document.getElementById('expTV').value) +
                parseFormattedNumber(document.getElementById('expInternet').value) +
                parseFormattedNumber(document.getElementById('expHomePhone').value) +
                parseFormattedNumber(document.getElementById('expOtherBills').value)
            );
            document.getElementById('expBillsTotal').textContent = formatNumber(billsTotal);

            // Genel Giderler toplamı
            const generalTotal = (
                parseFormattedNumber(document.getElementById('expSchool').value) +
                parseFormattedNumber(document.getElementById('expService').value) +
                parseFormattedNumber(document.getElementById('expFood').value) +
                parseFormattedNumber(document.getElementById('expShopping').value) +
                parseFormattedNumber(document.getElementById('expPersonal').value) +
                parseFormattedNumber(document.getElementById('expClothing').value) +
                parseFormattedNumber(document.getElementById('expVehicle').value) +
                parseFormattedNumber(document.getElementById('expOtherGeneral').value)
            );
            document.getElementById('expGeneralTotal').textContent = formatNumber(generalTotal);

            // Kredi Kartları toplamı
            let creditCardsTotal = 0;
            for (let i = 0; i < 6; i++) {
                const amount = parseFormattedNumber(document.getElementById('creditCardAmount' + i).value);
                creditCardsTotal += amount;
            }
            document.getElementById('expCreditCardsTotal').textContent = formatNumber(creditCardsTotal);

            // Kredi Giderleri toplamı
            const creditsTotal = (
                parseFormattedNumber(document.getElementById('expNeedCredit').value) +
                parseFormattedNumber(document.getElementById('expVehicleCredit').value) +
                parseFormattedNumber(document.getElementById('expHousingCredit').value) +
                parseFormattedNumber(document.getElementById('expInstallmentCredit').value) +
                parseFormattedNumber(document.getElementById('expSMECredit').value) +
                parseFormattedNumber(document.getElementById('expCommercialCredit').value) +
                parseFormattedNumber(document.getElementById('expProjectCredit').value) +
                parseFormattedNumber(document.getElementById('expOtherCredits').value)
            );
            document.getElementById('expCreditsTotal').textContent = formatNumber(creditsTotal);

            // Grafikleri güncelle
            updateExpensesCharts();
        }

        function initExpensesCharts() {
            if (typeof Chart === 'undefined') {
                ensureChartJsLoaded().then(function() { initExpensesCharts(); }).catch(function() {});
                return;
            }
            // Pasta grafik
            const pieCtx = document.getElementById('expensesPieChart');
            if (pieCtx) {
                if (expensesPieChart) expensesPieChart.destroy();
                expensesPieChart = new Chart(pieCtx, {
                    type: 'pie',
                    data: {
                        labels: ['Faturalarım', 'Genel Giderler', 'Kredi Kartları', 'Kredi Giderleri'],
                        datasets: [{
                            data: [0, 0, 0, 0],
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
                            borderWidth: 2,
                            borderColor: '#05103a'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: {
                                    color: '#cbd5f5',
                                    font: { size: 12 }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.parsed || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return label + ': ' + value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }

            // Bar grafik
            const barCtx = document.getElementById('expensesBarChart');
            if (barCtx) {
                if (expensesBarChart) expensesBarChart.destroy();
                expensesBarChart = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: ['Faturalarım', 'Genel Giderler', 'Kredi Kartları', 'Kredi Giderleri'],
                        datasets: [{
                            label: 'Gider Tutarı (₺)',
                            data: [0, 0, 0, 0],
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
                            borderColor: ['#2563eb', '#059669', '#d97706', '#dc2626'],
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    color: '#cbd5f5',
                                    callback: function(value) {
                                        return value.toFixed(0) + ' ₺';
                                    }
                                },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            },
                            x: {
                                ticks: { color: '#cbd5f5' },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.parsed.y || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        function updateExpensesCharts() {
            const billsTotal = parseFormattedNumber(document.getElementById('expBillsTotal').textContent);
            const generalTotal = parseFormattedNumber(document.getElementById('expGeneralTotal').textContent);
            const creditCardsTotal = parseFormattedNumber(document.getElementById('expCreditCardsTotal').textContent);
            const creditsTotal = parseFormattedNumber(document.getElementById('expCreditsTotal').textContent);

            const data = [billsTotal, generalTotal, creditCardsTotal, creditsTotal];

            if (expensesPieChart) {
                expensesPieChart.data.datasets[0].data = data;
                expensesPieChart.update();
            }

            if (expensesBarChart) {
                expensesBarChart.data.datasets[0].data = data;
                expensesBarChart.update();
            }
        }

        async function saveExpenseItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kayıt için önce giriş yapmanız gerekiyor.');
                return;
            }

            const month = parseInt(document.getElementById('expensesMonthSelect').value, 10);
            const year = parseInt(document.getElementById('expensesYearSelect').value, 10);
            
            // Faturalarım
            const electricity = parseFormattedNumber(document.getElementById('expElectricity').value);
            const water = parseFormattedNumber(document.getElementById('expWater').value);
            const gas = parseFormattedNumber(document.getElementById('expGas').value);
            const mobile = parseFormattedNumber(document.getElementById('expMobile').value);
            const tv = parseFormattedNumber(document.getElementById('expTV').value);
            const internet = parseFormattedNumber(document.getElementById('expInternet').value);
            const homePhone = parseFormattedNumber(document.getElementById('expHomePhone').value);
            const otherBills = parseFormattedNumber(document.getElementById('expOtherBills').value);
            const billsTotal = parseFormattedNumber(document.getElementById('expBillsTotal').textContent);

            // Genel Giderler
            const school = parseFormattedNumber(document.getElementById('expSchool').value);
            const service = parseFormattedNumber(document.getElementById('expService').value);
            const food = parseFormattedNumber(document.getElementById('expFood').value);
            const shopping = parseFormattedNumber(document.getElementById('expShopping').value);
            const personal = parseFormattedNumber(document.getElementById('expPersonal').value);
            const clothing = parseFormattedNumber(document.getElementById('expClothing').value);
            const vehicle = parseFormattedNumber(document.getElementById('expVehicle').value);
            const otherGeneral = parseFormattedNumber(document.getElementById('expOtherGeneral').value);
            const generalTotal = parseFormattedNumber(document.getElementById('expGeneralTotal').textContent);

            // Kredi Kartları
            const creditCards = [];
            for (let i = 0; i < 6; i++) {
                const bank = document.getElementById('creditCardBank' + i).value;
                const amount = parseFormattedNumber(document.getElementById('creditCardAmount' + i).value);
                if (bank && amount > 0) {
                    creditCards.push({ bank, amount });
                }
            }
            const creditCardsTotal = parseFormattedNumber(document.getElementById('expCreditCardsTotal').textContent);

            // Kredi Giderleri
            const needCredit = parseFormattedNumber(document.getElementById('expNeedCredit').value);
            const vehicleCredit = parseFormattedNumber(document.getElementById('expVehicleCredit').value);
            const housingCredit = parseFormattedNumber(document.getElementById('expHousingCredit').value);
            const installmentCredit = parseFormattedNumber(document.getElementById('expInstallmentCredit').value);
            const smeCredit = parseFormattedNumber(document.getElementById('expSMECredit').value);
            const commercialCredit = parseFormattedNumber(document.getElementById('expCommercialCredit').value);
            const projectCredit = parseFormattedNumber(document.getElementById('expProjectCredit').value);
            const otherCredits = parseFormattedNumber(document.getElementById('expOtherCredits').value);
            const creditsTotal = parseFormattedNumber(document.getElementById('expCreditsTotal').textContent);

            const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            
            const data = {
                userId: user.uid,
                year,
                month,
                monthName: monthNames[month],
                // Faturalarım
                electricity, water, gas, mobile, tv, internet, homePhone, otherBills, billsTotal,
                // Genel Giderler
                school, service, food, shopping, personal, clothing, vehicle, otherGeneral, generalTotal,
                // Kredi Kartları
                creditCards, creditCardsTotal,
                // Kredi Giderleri
                needCredit, vehicleCredit, housingCredit, installmentCredit, smeCredit, commercialCredit, projectCredit, otherCredits, creditsTotal,
                // Toplam
                total: billsTotal + generalTotal + creditCardsTotal + creditsTotal,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                if (currentExpenseDocId) {
                    // Güncelle
                    await db.collection('expenseItems').doc(currentExpenseDocId).update(data);
                    alert('Gider kalemleri başarıyla güncellendi!');
                    currentExpenseDocId = null;
                } else {
                    // Yeni kayıt
                    await db.collection('expenseItems').add(data);
                    alert('Gider kalemleri başarıyla kaydedildi!');
                }
                // EBITDA projeksiyonunu otomatik güncelle
                await updateEBITDAProjectionFromIncomeExpenses(year);
                closeExpensesDetailModal();
            } catch (err) {
                console.error(err);
                alert('Kayıt sırasında hata oluştu.');
            }
        }

        async function editExpenseItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Düzenlemek için giriş yapmanız gerekiyor.');
                return;
            }

            const month = parseInt(document.getElementById('expensesMonthSelect').value, 10);
            const year = parseInt(document.getElementById('expensesYearSelect').value, 10);

            try {
                const snap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu ay için kayıtlı gider kalemi bulunamadı.');
                    return;
                }

                currentExpenseDocId = snap.docs[0].id;
                await loadExpensesData();
                alert('Gider kalemleri yüklendi. Düzenleyip kaydedebilirsiniz.');
            } catch (err) {
                console.error('Gider kalemleri yüklenirken hata:', err);
                alert('Veriler yüklenirken hata oluştu.');
            }
        }

        async function deleteExpenseItems() {
            const user = auth.currentUser;
            if (!user) {
                alert('Silmek için giriş yapmanız gerekiyor.');
                return;
            }

            if (!confirm('Bu ay için kayıtlı gider kalemini silmek istediğinize emin misiniz?')) {
                return;
            }

            const month = parseInt(document.getElementById('expensesMonthSelect').value, 10);
            const year = parseInt(document.getElementById('expensesYearSelect').value, 10);

            try {
                const snap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu ay için kayıtlı gider kalemi bulunamadı.');
                    return;
                }

                await snap.docs[0].ref.delete();
                alert('Gider kalemi başarıyla silindi!');
                
                // Form alanlarını temizle
                const allInputs = document.querySelectorAll('#expensesDetailModal input[type="number"]');
                allInputs.forEach(input => input.value = '');
                updateExpensesTotals();
                currentExpenseDocId = null;
            } catch (err) {
                console.error('Gider kalemi silinirken hata:', err);
                alert('Silme işlemi sırasında hata oluştu.');
            }
        }

        async function loadExpensesData() {
            const user = auth.currentUser;
            if (!user) return;

            const month = parseInt(document.getElementById('expensesMonthSelect').value, 10);
            const year = parseInt(document.getElementById('expensesYearSelect').value, 10);

            try {
                const snap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .where('month', '==', month)
                    .limit(1)
                    .get();

                if (!snap.empty) {
                    const doc = snap.docs[0];
                    currentExpenseDocId = doc.id;
                    const data = doc.data();
                    
                    // Faturalarım
                    if (data.electricity !== undefined) document.getElementById('expElectricity').value = formatNumber(data.electricity || 0);
                    if (data.water !== undefined) document.getElementById('expWater').value = formatNumber(data.water || 0);
                    if (data.gas !== undefined) document.getElementById('expGas').value = formatNumber(data.gas || 0);
                    if (data.mobile !== undefined) document.getElementById('expMobile').value = formatNumber(data.mobile || 0);
                    if (data.tv !== undefined) document.getElementById('expTV').value = formatNumber(data.tv || 0);
                    if (data.internet !== undefined) document.getElementById('expInternet').value = formatNumber(data.internet || 0);
                    if (data.homePhone !== undefined) document.getElementById('expHomePhone').value = formatNumber(data.homePhone || 0);
                    if (data.otherBills !== undefined) document.getElementById('expOtherBills').value = formatNumber(data.otherBills || 0);

                    // Genel Giderler
                    if (data.school !== undefined) document.getElementById('expSchool').value = formatNumber(data.school || 0);
                    if (data.service !== undefined) document.getElementById('expService').value = formatNumber(data.service || 0);
                    if (data.food !== undefined) document.getElementById('expFood').value = formatNumber(data.food || 0);
                    if (data.shopping !== undefined) document.getElementById('expShopping').value = formatNumber(data.shopping || 0);
                    if (data.personal !== undefined) document.getElementById('expPersonal').value = formatNumber(data.personal || 0);
                    if (data.clothing !== undefined) document.getElementById('expClothing').value = formatNumber(data.clothing || 0);
                    if (data.vehicle !== undefined) document.getElementById('expVehicle').value = formatNumber(data.vehicle || 0);
                    if (data.otherGeneral !== undefined) document.getElementById('expOtherGeneral').value = formatNumber(data.otherGeneral || 0);

                    // Kredi Kartları
                    if (data.creditCards && Array.isArray(data.creditCards)) {
                        data.creditCards.forEach((card, index) => {
                            if (index < 6) {
                                document.getElementById('creditCardBank' + index).value = card.bank || '';
                                document.getElementById('creditCardAmount' + index).value = formatNumber(card.amount || 0);
                            }
                        });
                    }

                    // Kredi Giderleri
                    if (data.needCredit !== undefined) document.getElementById('expNeedCredit').value = formatNumber(data.needCredit || 0);
                    if (data.vehicleCredit !== undefined) document.getElementById('expVehicleCredit').value = formatNumber(data.vehicleCredit || 0);
                    if (data.housingCredit !== undefined) document.getElementById('expHousingCredit').value = formatNumber(data.housingCredit || 0);
                    if (data.installmentCredit !== undefined) document.getElementById('expInstallmentCredit').value = formatNumber(data.installmentCredit || 0);
                    if (data.smeCredit !== undefined) document.getElementById('expSMECredit').value = formatNumber(data.smeCredit || 0);
                    if (data.commercialCredit !== undefined) document.getElementById('expCommercialCredit').value = formatNumber(data.commercialCredit || 0);
                    if (data.projectCredit !== undefined) document.getElementById('expProjectCredit').value = formatNumber(data.projectCredit || 0);
                    if (data.otherCredits !== undefined) document.getElementById('expOtherCredits').value = formatNumber(data.otherCredits || 0);

                    updateExpensesTotals();
                } else {
                    currentExpenseDocId = null;
                }
            } catch (err) {
                console.error('Gider verileri yüklenirken hata:', err);
            }
        }

        // GİDER KALEMLERİ LİSTE FONKSİYONLARI
        async function openExpenseListModal() {
            document.getElementById('expensesDetailModal').style.display = 'none';
            document.getElementById('expenseListModal').style.display = 'flex';
            await loadExpenseList();
        }

        function closeExpenseListModal() {
            document.getElementById('expenseListModal').style.display = 'none';
            document.getElementById('expensesDetailModal').style.display = 'flex';
        }

        async function loadExpenseList() {
            const user = auth.currentUser;
            if (!user) return;

            const container = document.getElementById('expenseListContainer');
            container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Yükleniyor...</p>';

            try {
                const snap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .orderBy('year', 'desc')
                    .orderBy('month', 'desc')
                    .get();

                if (snap.empty) {
                    container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Henüz kaydedilmiş gider kalemi yok.</p>';
                    return;
                }

                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                let html = '<div style="display:grid; gap:15px;">';
                
                snap.forEach(doc => {
                    const data = doc.data();
                    const total = (data.billsTotal || 0) + (data.generalTotal || 0) + (data.creditCardsTotal || 0) + (data.creditsTotal || 0);
                    html += `
                        <div style="background:rgba(26,35,126,0.3); padding:15px; border-radius:8px; border:1px solid rgba(203,213,245,0.2);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                <div>
                                    <h3 style="color:var(--light-blue); margin:0; font-size:18px;">${monthNames[data.month]} ${data.year}</h3>
                                    <p style="color:#cbd5f5; margin:5px 0 0 0; font-size:14px;">Toplam: ${formatNumber(total)} ₺</p>
                                </div>
                                <div style="display:flex; gap:10px;">
                                    <button class="btn-edit-income" onclick="editExpenseFromList('${doc.id}', ${data.month}, ${data.year})" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-edit"></i> DÜZENLE
                                    </button>
                                    <button class="btn-delete-income" onclick="deleteExpenseFromList('${doc.id}')" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-trash"></i> SİL
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                container.innerHTML = html;
            } catch (err) {
                console.error('Gider listesi yüklenirken hata:', err);
                container.innerHTML = '<p style="color:#ef4444; text-align:center;">Liste yüklenirken hata oluştu.</p>';
            }
        }

        async function editExpenseFromList(docId, month, year) {
            document.getElementById('expenseListModal').style.display = 'none';
            document.getElementById('expensesDetailModal').style.display = 'flex';
            document.getElementById('expensesMonthSelect').value = month;
            document.getElementById('expensesYearSelect').value = year;
            currentExpenseDocId = docId;
            const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            document.getElementById('expensesModalTitle').textContent = 'GİDERLERİM - ' + monthNames[month] + ' ' + year;
            await loadExpensesData();
        }

        async function deleteExpenseFromList(docId) {
            if (!confirm('Bu gider kalemini silmek istediğinize emin misiniz?')) return;

            try {
                await db.collection('expenseItems').doc(docId).delete();
                alert('Gider kalemi başarıyla silindi!');
                await loadExpenseList();
            } catch (err) {
                console.error('Silme hatası:', err);
                alert('Silme sırasında hata oluştu.');
            }
        }

        // TARİH ARALIĞI ARAMA FONKSİYONLARI
        let incomeRangePieChart = null;
        let incomeRangeBarChart = null;
        let expensesRangePieChart = null;
        let expensesRangeBarChart = null;
        let incomeRangeData = [];
        let expensesRangeData = [];

        async function searchIncomeByDateRange() {
            const user = auth.currentUser;
            if (!user) {
                alert('Arama yapmak için giriş yapmanız gerekiyor.');
                return;
            }

            const startDate = document.getElementById('incomeStartDate').value;
            const endDate = document.getElementById('incomeEndDate').value;

            if (!startDate || !endDate) {
                alert('Lütfen başlangıç ve bitiş tarihlerini seçiniz.');
                return;
            }

            if (new Date(startDate) > new Date(endDate)) {
                alert('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
                return;
            }

            try {
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);

                // Firebase'de orderBy ile where birlikte kullanımda index sorunu olabilir, 
                // bu yüzden tüm verileri çekip client-side'da filtreliyoruz
                const snap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .get();

                incomeRangeData = [];
                let totalSalary = 0, totalDividend = 0, totalBonus = 0, totalPremium = 0, totalOther = 0;

                snap.forEach(doc => {
                    const data = doc.data();
                    const recordDate = new Date(data.year, data.month - 1, 1);
                    
                    if (recordDate >= start && recordDate <= end) {
                        incomeRangeData.push(data);
                        totalSalary += data.salary || 0;
                        totalDividend += data.dividend || 0;
                        totalBonus += data.bonus || 0;
                        totalPremium += data.premium || 0;
                        totalOther += data.other || 0;
                    }
                });

                // Tarihe göre sırala
                incomeRangeData.sort((a, b) => {
                    if (a.year !== b.year) return a.year - b.year;
                    return a.month - b.month;
                });

                // Tabloyu göster
                displayIncomeRangeTable();
                
                // Grafikleri güncelle
                updateIncomeRangeCharts([totalSalary, totalDividend, totalBonus, totalPremium, totalOther]);

                // Sonuçları göster
                document.getElementById('incomeDateRangeResults').style.display = 'block';
                
                // Kaydet butonunu gizle
                document.getElementById('btnSaveIncome').style.display = 'none';
            } catch (err) {
                console.error('Gelir arama hatası:', err);
                alert('Arama sırasında hata oluştu.');
            }
        }

        function displayIncomeRangeTable() {
            const container = document.getElementById('incomeRangeTableContainer');
            if (!container) return;

            let html = '<div class="portfolio-table-wrap"><table class="portfolio-list"><thead><tr><th>Tarih</th><th>Maaş</th><th>Temettü</th><th>İkramiye</th><th>Prim</th><th>Diğer Gelirler</th><th>Toplam</th></tr></thead><tbody>';
            
            let grandTotal = 0;
            incomeRangeData.forEach(data => {
                const total = (data.salary || 0) + (data.dividend || 0) + (data.bonus || 0) + (data.premium || 0) + (data.other || 0);
                grandTotal += total;
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                html += `<tr>
                    <td>${data.monthName || monthNames[data.month]} ${data.year}</td>
                    <td>${(data.salary || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td>${(data.dividend || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td>${(data.bonus || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td>${(data.premium || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td>${(data.other || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                    <td>${total.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                </tr>`;
            });

            html += `</tbody><tfoot><tr class="portfolio-total-row"><td colspan="6" style="text-align:right;">Genel Toplam</td><td>${formatNumber(grandTotal)}</td></tr></tfoot></table></div>`;
            container.innerHTML = html;
        }

        function updateIncomeRangeCharts(data) {
            if (typeof Chart === 'undefined') {
                ensureChartJsLoaded().then(function() { updateIncomeRangeCharts(data); }).catch(function() {});
                return;
            }
            const pieCtx = document.getElementById('incomeRangePieChart');
            const barCtx = document.getElementById('incomeRangeBarChart');

            if (pieCtx) {
                if (incomeRangePieChart) incomeRangePieChart.destroy();
                incomeRangePieChart = new Chart(pieCtx, {
                    type: 'pie',
                    data: {
                        labels: ['Maaş', 'Temettü', 'İkramiye', 'Prim', 'Diğer Gelirler'],
                        datasets: [{
                            data: data,
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                            borderWidth: 2,
                            borderColor: '#05103a'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: { padding: 6 },
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: pieLegendLabelOpts('#cbd5f5')
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.parsed || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return label + ': ' + value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }

            if (barCtx) {
                if (incomeRangeBarChart) incomeRangeBarChart.destroy();
                incomeRangeBarChart = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: ['Maaş', 'Temettü', 'İkramiye', 'Prim', 'Diğer Gelirler'],
                        datasets: [{
                            label: 'Gelir Tutarı (₺)',
                            data: data,
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
                            borderColor: ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'],
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    color: '#cbd5f5',
                                    callback: function(value) {
                                        return value.toFixed(0) + ' ₺';
                                    }
                                },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            },
                            x: {
                                ticks: { color: '#cbd5f5' },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.parsed.y || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        async function searchExpensesByDateRange() {
            const user = auth.currentUser;
            if (!user) {
                alert('Arama yapmak için giriş yapmanız gerekiyor.');
                return;
            }

            const startDate = document.getElementById('expensesStartDate').value;
            const endDate = document.getElementById('expensesEndDate').value;

            if (!startDate || !endDate) {
                alert('Lütfen başlangıç ve bitiş tarihlerini seçiniz.');
                return;
            }

            if (new Date(startDate) > new Date(endDate)) {
                alert('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
                return;
            }

            try {
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);

                // Firebase'de orderBy ile where birlikte kullanımda index sorunu olabilir, 
                // bu yüzden tüm verileri çekip client-side'da filtreliyoruz
                const snap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .get();

                expensesRangeData = [];
                let totalBills = 0, totalGeneral = 0, totalCreditCards = 0, totalCredits = 0;

                snap.forEach(doc => {
                    const data = doc.data();
                    const recordDate = new Date(data.year, data.month - 1, 1);
                    
                    if (recordDate >= start && recordDate <= end) {
                        expensesRangeData.push(data);
                        totalBills += data.billsTotal || 0;
                        totalGeneral += data.generalTotal || 0;
                        totalCreditCards += data.creditCardsTotal || 0;
                        totalCredits += data.creditsTotal || 0;
                    }
                });

                // Tabloyu göster
                displayExpensesRangeTable();
                
                // Grafikleri güncelle
                updateExpensesRangeCharts([totalBills, totalGeneral, totalCreditCards, totalCredits]);

                // Sonuçları göster
                document.getElementById('expensesDateRangeResults').style.display = 'block';
                
                // Kaydet butonunu gizle
                document.getElementById('btnSaveExpenses').style.display = 'none';
            } catch (err) {
                console.error('Gider arama hatası:', err);
                alert('Arama sırasında hata oluştu.');
            }
        }

        function displayExpensesRangeTable() {
            const container = document.getElementById('expensesRangeTableContainer');
            if (!container) return;

            let html = '<div class="portfolio-table-wrap"><table class="portfolio-list"><thead><tr><th>Tarih</th><th>Faturalarım</th><th>Genel Giderler</th><th>Kredi Kartları</th><th>Kredi Giderleri</th><th>Toplam</th></tr></thead><tbody>';
            
            let grandTotal = 0;
            expensesRangeData.forEach(data => {
                const total = (data.billsTotal || 0) + (data.generalTotal || 0) + (data.creditCardsTotal || 0) + (data.creditsTotal || 0);
                grandTotal += total;
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                html += `<tr>
                    <td>${data.monthName || monthNames[data.month]} ${data.year}</td>
                    <td>${formatNumber(data.billsTotal || 0)}</td>
                    <td>${formatNumber(data.generalTotal || 0)}</td>
                    <td>${formatNumber(data.creditCardsTotal || 0)}</td>
                    <td>${formatNumber(data.creditsTotal || 0)}</td>
                    <td>${formatNumber(total)}</td>
                </tr>`;
            });

            html += `</tbody><tfoot><tr class="portfolio-total-row"><td colspan="5" style="text-align:right;">Genel Toplam</td><td>${formatNumber(grandTotal)}</td></tr></tfoot></table></div>`;
            container.innerHTML = html;
        }

        function updateExpensesRangeCharts(data) {
            if (typeof Chart === 'undefined') {
                ensureChartJsLoaded().then(function() { updateExpensesRangeCharts(data); }).catch(function() {});
                return;
            }
            const pieCtx = document.getElementById('expensesRangePieChart');
            const barCtx = document.getElementById('expensesRangeBarChart');

            if (pieCtx) {
                if (expensesRangePieChart) expensesRangePieChart.destroy();
                expensesRangePieChart = new Chart(pieCtx, {
                    type: 'pie',
                    data: {
                        labels: ['Faturalarım', 'Genel Giderler', 'Kredi Kartları', 'Kredi Giderleri'],
                        datasets: [{
                            data: data,
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
                            borderWidth: 2,
                            borderColor: '#05103a'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { color: '#cbd5f5', font: { size: 12 } }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.parsed || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return label + ': ' + value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }

            if (barCtx) {
                if (expensesRangeBarChart) expensesRangeBarChart.destroy();
                expensesRangeBarChart = new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: ['Faturalarım', 'Genel Giderler', 'Kredi Kartları', 'Kredi Giderleri'],
                        datasets: [{
                            label: 'Gider Tutarı (₺)',
                            data: data,
                            backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
                            borderColor: ['#2563eb', '#059669', '#d97706', '#dc2626'],
                            borderWidth: 2
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: true,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    color: '#cbd5f5',
                                    callback: function(value) {
                                        return value.toFixed(0) + ' ₺';
                                    }
                                },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            },
                            x: {
                                ticks: { color: '#cbd5f5' },
                                grid: { color: 'rgba(203, 213, 245, 0.1)' }
                            }
                        },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const value = context.parsed.y || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                        return value.toFixed(2) + ' ₺ (' + percentage + '%)';
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }

        // EXCEL VE PDF EXPORT FONKSİYONLARI
        function exportIncomeToExcel() {
            if (incomeRangeData.length === 0) {
                alert('İndirilecek veri bulunmuyor.');
                return;
            }

            const rows = incomeRangeData.map(data => {
                const total = (data.salary || 0) + (data.dividend || 0) + (data.bonus || 0) + (data.premium || 0) + (data.other || 0);
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                return [
                    data.monthName || monthNames[data.month] + ' ' + data.year,
                    (data.salary || 0).toFixed(2),
                    (data.dividend || 0).toFixed(2),
                    (data.bonus || 0).toFixed(2),
                    (data.premium || 0).toFixed(2),
                    (data.other || 0).toFixed(2),
                    total.toFixed(2)
                ];
            });

            const header = ['Tarih', 'Maaş', 'Temettü', 'İkramiye', 'Prim', 'Diğer Gelirler', 'Toplam'];
            const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'gelir-raporu-' + new Date().toISOString().slice(0,10) + '.csv';
            link.click();
            URL.revokeObjectURL(link.href);
        }

        function exportIncomeToPDF() {
            if (incomeRangeData.length === 0) {
                alert('İndirilecek veri bulunmuyor.');
                return;
            }

            const startDate = document.getElementById('incomeStartDate').value;
            const endDate = document.getElementById('incomeEndDate').value;
            
            let html = `
                <html>
                <head>
                    <title>Gelir Raporu</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { color: #1a237e; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #1a237e; color: white; }
                        tr:nth-child(even) { background-color: #f2f2f2; }
                        .total { font-weight: bold; }
                    </style>
                </head>
                <body>
                    <h1>Gelir Raporu</h1>
                    <p>Tarih Aralığı: ${startDate} - ${endDate}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Tarih</th>
                                <th>Maaş</th>
                                <th>Temettü</th>
                                <th>İkramiye</th>
                                <th>Prim</th>
                                <th>Diğer Gelirler</th>
                                <th>Toplam</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            let grandTotal = 0;
            incomeRangeData.forEach(data => {
                const total = (data.salary || 0) + (data.dividend || 0) + (data.bonus || 0) + (data.premium || 0) + (data.other || 0);
                grandTotal += total;
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                html += `
                    <tr>
                        <td>${data.monthName || monthNames[data.month]} ${data.year}</td>
                        <td>${formatNumber(data.salary || 0)}</td>
                        <td>${formatNumber(data.dividend || 0)}</td>
                        <td>${formatNumber(data.bonus || 0)}</td>
                        <td>${formatNumber(data.premium || 0)}</td>
                        <td>${formatNumber(data.other || 0)}</td>
                        <td>${formatNumber(total)}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                        <tfoot>
                            <tr class="total">
                                <td colspan="6">Genel Toplam</td>
                                <td>${formatNumber(grandTotal)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
        }

        function exportExpensesToExcel() {
            if (expensesRangeData.length === 0) {
                alert('İndirilecek veri bulunmuyor.');
                return;
            }

            const rows = expensesRangeData.map(data => {
                const total = (data.billsTotal || 0) + (data.generalTotal || 0) + (data.creditCardsTotal || 0) + (data.creditsTotal || 0);
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                return [
                    data.monthName || monthNames[data.month] + ' ' + data.year,
                    formatNumber(data.billsTotal || 0),
                    formatNumber(data.generalTotal || 0),
                    formatNumber(data.creditCardsTotal || 0),
                    formatNumber(data.creditsTotal || 0),
                    formatNumber(total)
                ];
            });

            const header = ['Tarih', 'Faturalarım', 'Genel Giderler', 'Kredi Kartları', 'Kredi Giderleri', 'Toplam'];
            const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'gider-raporu-' + new Date().toISOString().slice(0,10) + '.csv';
            link.click();
            URL.revokeObjectURL(link.href);
        }

        function exportExpensesToPDF() {
            if (expensesRangeData.length === 0) {
                alert('İndirilecek veri bulunmuyor.');
                return;
            }

            const startDate = document.getElementById('expensesStartDate').value;
            const endDate = document.getElementById('expensesEndDate').value;
            
            let html = `
                <html>
                <head>
                    <title>Gider Raporu</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { color: #1a237e; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #1a237e; color: white; }
                        tr:nth-child(even) { background-color: #f2f2f2; }
                        .total { font-weight: bold; }
                    </style>
                </head>
                <body>
                    <h1>Gider Raporu</h1>
                    <p>Tarih Aralığı: ${startDate} - ${endDate}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Tarih</th>
                                <th>Faturalarım</th>
                                <th>Genel Giderler</th>
                                <th>Kredi Kartları</th>
                                <th>Kredi Giderleri</th>
                                <th>Toplam</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            let grandTotal = 0;
            expensesRangeData.forEach(data => {
                const total = (data.billsTotal || 0) + (data.generalTotal || 0) + (data.creditCardsTotal || 0) + (data.creditsTotal || 0);
                grandTotal += total;
                const monthNames = ['', 'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                html += `
                    <tr>
                        <td>${data.monthName || monthNames[data.month]} ${data.year}</td>
                        <td>${formatNumber(data.billsTotal || 0)}</td>
                        <td>${formatNumber(data.generalTotal || 0)}</td>
                        <td>${formatNumber(data.creditCardsTotal || 0)}</td>
                        <td>${formatNumber(data.creditsTotal || 0)}</td>
                        <td>${formatNumber(total)}</td>
                    </tr>
                `;
            });

            html += `
                        </tbody>
                        <tfoot>
                            <tr class="total">
                                <td colspan="5">Genel Toplam</td>
                                <td>${formatNumber(grandTotal)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
        }

        /* EBITDA PROJEKSİYONUM JS */
        function openEBITDAModal() {
            document.getElementById('expensesMainModal').style.display = 'none';
            document.getElementById('ebitdaModal').style.display = 'flex';
            initEBITDAYearSelect();
            const monthSelect = document.getElementById('ebitdaMonthSelect');
            if (monthSelect) monthSelect.value = new Date().getMonth() + 1;
            loadEBITDAData();
            updateMonthHeaders();
            // Düzenleme durumunu sıfırla
            currentEBITDADocId = null;
            attachEBITDAInputFormatting();
        }

        function attachEBITDAInputFormatting() {
            // Formatlama event listener'ları kaldırıldı - değerleri silme sorununa neden oluyordu
            // Input alanları normal sayı girişi yapacak, formatlama sadece gösterimde kullanılacak
        }

        function closeEBITDAModal() {
            document.getElementById('ebitdaModal').style.display = 'none';
            document.getElementById('expensesMainModal').style.display = 'flex';
        }

        // EBITDA LİSTE FONKSİYONLARI
        async function openEBITDAListModal() {
            document.getElementById('ebitdaModal').style.display = 'none';
            document.getElementById('ebitdaListModal').style.display = 'flex';
            await loadEBITDAList();
        }

        function closeEBITDAListModal() {
            document.getElementById('ebitdaListModal').style.display = 'none';
            document.getElementById('ebitdaModal').style.display = 'flex';
        }

        async function loadEBITDAList() {
            const user = auth.currentUser;
            if (!user) return;

            const container = document.getElementById('ebitdaListContainer');
            container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Yükleniyor...</p>';

            try {
                const snap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .orderBy('year', 'desc')
                    .get();

                if (snap.empty) {
                    container.innerHTML = '<p style="color:#cbd5f5; text-align:center;">Henüz kaydedilmiş EBITDA projeksiyonu yok.</p>';
                    return;
                }

                let html = '<div style="display:grid; gap:15px;">';
                
                snap.forEach(doc => {
                    const data = doc.data();
                    let totalEBITDA = 0;
                    if (data.monthlyData) {
                        Object.values(data.monthlyData).forEach(monthData => {
                            totalEBITDA += monthData.ebitda || 0;
                        });
                    }
                    html += `
                        <div style="background:rgba(26,35,126,0.3); padding:15px; border-radius:8px; border:1px solid rgba(203,213,245,0.2);">
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                                <div>
                                    <h3 style="color:var(--light-blue); margin:0; font-size:18px;">${data.year} Yılı</h3>
                                    <p style="color:#cbd5f5; margin:5px 0 0 0; font-size:14px;">Toplam EBITDA: ${formatNumber(totalEBITDA)} ₺</p>
                                </div>
                                <div style="display:flex; gap:10px;">
                                    <button class="btn-edit-income" onclick="editEBITDAFromList('${doc.id}', ${data.year})" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-edit"></i> DÜZENLE
                                    </button>
                                    <button class="btn-delete-income" onclick="deleteEBITDAFromList('${doc.id}')" style="padding:8px 15px; font-size:12px;">
                                        <i class="fas fa-trash"></i> SİL
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                html += '</div>';
                container.innerHTML = html;
            } catch (err) {
                console.error('EBITDA listesi yüklenirken hata:', err);
                container.innerHTML = '<p style="color:#ef4444; text-align:center;">Liste yüklenirken hata oluştu.</p>';
            }
        }

        async function editEBITDAFromList(docId, year) {
            document.getElementById('ebitdaListModal').style.display = 'none';
            document.getElementById('ebitdaModal').style.display = 'flex';
            document.getElementById('ebitdaYearSelect').value = year;
            currentEBITDADocId = docId;
            await loadEBITDAData();
        }

        async function deleteEBITDAFromList(docId) {
            if (!confirm('Bu EBITDA projeksiyonunu silmek istediğinize emin misiniz?')) return;

            try {
                await db.collection('ebitdaProjections').doc(docId).delete();
                alert('EBITDA projeksiyonu başarıyla silindi!');
                await loadEBITDAList();
            } catch (err) {
                console.error('Silme hatası:', err);
                alert('Silme sırasında hata oluştu.');
            }
        }

        function initEBITDAYearSelect() {
            const yearSelect = document.getElementById('ebitdaYearSelect');
            if (!yearSelect) return;
            yearSelect.innerHTML = '';
            const currentYear = new Date().getFullYear();
            for (let y = 2200; y >= 2010; y--) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                if (y === currentYear) opt.selected = true;
                yearSelect.appendChild(opt);
            }
            const monthSelect = document.getElementById('ebitdaMonthSelect');
            if (monthSelect) {
                const currentMonth = new Date().getMonth() + 1;
                monthSelect.value = currentMonth;
            }
        }

        function updateMonthHeaders() {
            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            for (let i = 1; i <= 12; i++) {
                const header = document.getElementById('ebitdaMonth' + i);
                if (header) {
                    header.textContent = monthNames[i] + '.' + yearShort;
                }
            }
        }

        // Gelir ve Gider verilerinden EBITDA projeksiyonunu otomatik güncelle
        async function updateEBITDAProjectionFromIncomeExpenses(year) {
            const user = auth.currentUser;
            if (!user) return;

            try {
                // Gelir verilerini yükle
                const incomeSnap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();

                let totalSalary = 0, totalDividend = 0, totalBonus = 0, totalPremium = 0, totalOtherIncome = 0;
                const monthlyIncome = {};

                incomeSnap.forEach(doc => {
                    const data = doc.data();
                    const month = data.month || 1;
                    totalSalary += data.salary || 0;
                    totalDividend += data.dividend || 0;
                    totalBonus += data.bonus || 0;
                    totalPremium += data.premium || 0;
                    totalOtherIncome += data.other || 0;

                    if (!monthlyIncome[month]) {
                        monthlyIncome[month] = {
                            salary: 0,
                            dividend: 0,
                            bonus: 0,
                            premium: 0,
                            other: 0
                        };
                    }
                    monthlyIncome[month].salary += data.salary || 0;
                    monthlyIncome[month].dividend += data.dividend || 0;
                    monthlyIncome[month].bonus += data.bonus || 0;
                    monthlyIncome[month].premium += data.premium || 0;
                    monthlyIncome[month].other += data.other || 0;
                });

                // Gider verilerini yükle
                const expenseSnap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();

                let totalBills = 0, totalGeneral = 0, totalCreditCards = 0, totalCredits = 0;
                const monthlyExpenses = {};

                expenseSnap.forEach(doc => {
                    const data = doc.data();
                    const month = data.month || 1;
                    totalBills += data.billsTotal || 0;
                    totalGeneral += data.generalTotal || 0;
                    totalCreditCards += data.creditCardsTotal || 0;
                    totalCredits += data.creditsTotal || 0;

                    if (!monthlyExpenses[month]) {
                        monthlyExpenses[month] = {
                            bills: 0,
                            general: 0
                        };
                    }
                    monthlyExpenses[month].bills += data.billsTotal || 0;
                    monthlyExpenses[month].general += data.generalTotal || 0;
                });

                // Aylık verileri hazırla (GELİRLER = Maaş + Diğer Gelirler)
                const monthData = {};
                for (let month = 1; month <= 12; month++) {
                    const monthIncome = monthlyIncome[month] || { salary: 0, other: 0 };
                    const monthExpenses = monthlyExpenses[month] || { bills: 0, general: 0 };
                    
                    const incomeTotal = (monthIncome.salary || 0) + (monthIncome.other || 0);
                    const expensesTotal = monthExpenses.bills + monthExpenses.general;
                    // EBITDA formülü: TOPLAM GELİRLER - TOPLAM GİDERLER = EBITDA
                    const ebitda = incomeTotal - expensesTotal;

                    monthData[month] = {
                        income: incomeTotal,
                        expenses: expensesTotal,
                        ebitda: ebitda
                    };
                }

                const totalIncome = totalSalary + totalOtherIncome;
                const totalExpenses = totalBills + totalGeneral;

                // EBITDA projeksiyonunu kaydet veya güncelle
                const data = {
                    userId: user.uid,
                    year,
                    totalIncome,
                    totalExpenses,
                    totalCreditCards,
                    totalCredits,
                    monthlyData: monthData,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };

                const existingSnap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                if (!existingSnap.empty) {
                    await existingSnap.docs[0].ref.update(data);
                } else {
                    await db.collection('ebitdaProjections').add(data);
                }
            } catch (err) {
                console.error('EBITDA projeksiyonu güncellenirken hata:', err);
            }
        }

        async function loadEBITDAData() {
            const user = auth.currentUser;
            if (!user) return;

            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);
            
            // Mevcut kaydı kontrol et
            try {
                const existingSnap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();
                
                if (!existingSnap.empty) {
                    currentEBITDADocId = existingSnap.docs[0].id;
                } else {
                    currentEBITDADocId = null;
                }
            } catch (err) {
                console.error('EBITDA kaydı kontrol edilirken hata:', err);
            }

            try {
                // Gelir verilerini yükle
                const incomeSnap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();

                let totalSalary = 0, totalDividend = 0, totalBonus = 0, totalPremium = 0, totalOtherIncome = 0;
                const monthlyIncome = {};

                incomeSnap.forEach(doc => {
                    const data = doc.data();
                    const month = data.month || 1;
                    totalSalary += data.salary || 0;
                    totalDividend += data.dividend || 0;
                    totalBonus += data.bonus || 0;
                    totalPremium += data.premium || 0;
                    totalOtherIncome += data.other || 0;

                    if (!monthlyIncome[month]) {
                        monthlyIncome[month] = {
                            salary: 0,
                            dividend: 0,
                            bonus: 0,
                            premium: 0,
                            other: 0
                        };
                    }
                    monthlyIncome[month].salary += data.salary || 0;
                    monthlyIncome[month].dividend += data.dividend || 0;
                    monthlyIncome[month].bonus += data.bonus || 0;
                    monthlyIncome[month].premium += data.premium || 0;
                    monthlyIncome[month].other += data.other || 0;
                });

                // Gider verilerini yükle
                const expenseSnap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .get();

                let totalBills = 0, totalGeneral = 0, totalCreditCards = 0, totalCredits = 0;
                const monthlyExpenses = {};

                expenseSnap.forEach(doc => {
                    const data = doc.data();
                    const month = data.month || 1;
                    totalBills += data.billsTotal || 0;
                    totalGeneral += data.generalTotal || 0;
                    totalCreditCards += data.creditCardsTotal || 0;
                    totalCredits += data.creditsTotal || 0;

                    if (!monthlyExpenses[month]) {
                        monthlyExpenses[month] = {
                            bills: 0,
                            general: 0
                        };
                    }
                    monthlyExpenses[month].bills += data.billsTotal || 0;
                    monthlyExpenses[month].general += data.generalTotal || 0;
                });

                // Özet kısmını seçilen ayın verileriyle doldur (Maaş, Diğer Gelirler, Fatura, Genel Gider)
                const selectedMonth = parseInt(document.getElementById('ebitdaMonthSelect').value, 10);
                const monthIncome = monthlyIncome[selectedMonth] || { salary: 0, other: 0 };
                const monthExpenses = monthlyExpenses[selectedMonth] || { bills: 0, general: 0 };
                
                const selSalary = monthIncome.salary || 0;
                const selOther = monthIncome.other || 0;
                const selBills = monthExpenses.bills || 0;
                const selGeneral = monthExpenses.general || 0;
                
                document.getElementById('ebitdaSalary').value = formatNumber(selSalary);
                document.getElementById('ebitdaOtherIncome').value = formatNumber(selOther);
                document.getElementById('ebitdaTotalIncome').value = formatNumber(selSalary + selOther);

                document.getElementById('ebitdaTotalBills').value = formatNumber(selBills);
                document.getElementById('ebitdaTotalGeneral').value = formatNumber(selGeneral);
                document.getElementById('ebitdaTotalExpenses').value = formatNumber(selBills + selGeneral);

                // Kredi bilgileri yıllık toplam olarak kalır
                document.getElementById('ebitdaTotalCreditCards').value = formatNumber(totalCreditCards);
                document.getElementById('ebitdaTotalCredits').value = formatNumber(totalCredits);

                // Aylık projeksiyon tablosunu doldur (GELİRLER = Maaş + Diğer Gelirler)
                for (let month = 1; month <= 12; month++) {
                    const monthIncome = monthlyIncome[month] || { salary: 0, other: 0 };
                    const monthExpenses = monthlyExpenses[month] || { bills: 0, general: 0 };
                    
                    const incomeTotal = (monthIncome.salary || 0) + (monthIncome.other || 0);
                    const expensesTotal = monthExpenses.bills + monthExpenses.general;
                    // EBITDA formülü: TOPLAM GELİRLER - TOPLAM GİDERLER = EBITDA
                    const ebitda = incomeTotal - expensesTotal;

                    const incomeInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="income"]`);
                    const expensesInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="expenses"]`);
                    const ebitdaInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="ebitda"]`);

                    if (incomeInput) incomeInput.value = formatNumber(incomeTotal);
                    if (expensesInput) expensesInput.value = formatNumber(expensesTotal);
                    if (ebitdaInput) ebitdaInput.value = formatNumber(ebitda);
                }

                // Input değişikliklerini dinle
                attachEBITDAInputListeners();
            } catch (err) {
                console.error('EBITDA verileri yüklenirken hata:', err);
            }
        }

        function attachEBITDAInputListeners() {
            // GELİRLER ve GİDERLER otomatik geldiği için sadece manuel düzenlenebilir alanlar dinlenir
            // GELİRLER ve GİDERLER readonly olduğundan listener gerekmez
        }

        function calculateEBITDAForMonth() {
            const month = parseInt(this.getAttribute('data-month'), 10);
            const incomeInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="income"]`);
            const expensesInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="expenses"]`);
            const ebitdaInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="ebitda"]`);

            if (incomeInput && expensesInput && ebitdaInput) {
                // EBITDA formülü: TOPLAM GELİRLER - TOPLAM GİDERLER = EBITDA
                const income = parseFormattedNumber(incomeInput.value) || 0;
                const expenses = parseFormattedNumber(expensesInput.value) || 0;
                const ebitda = income - expenses;
                ebitdaInput.value = formatNumber(ebitda);
            }
        }

        async function editEBITDAProjection() {
            const user = auth.currentUser;
            if (!user) {
                alert('Düzenlemek için giriş yapmanız gerekiyor.');
                return;
            }

            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);

            try {
                const snap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu yıl için kayıtlı EBITDA projeksiyonu bulunamadı.');
                    return;
                }

                currentEBITDADocId = snap.docs[0].id;
                await loadEBITDAData();
                alert('EBITDA projeksiyonu yüklendi. Düzenleyip kaydedebilirsiniz.');
            } catch (err) {
                console.error('EBITDA projeksiyonu yüklenirken hata:', err);
                alert('Veriler yüklenirken hata oluştu.');
            }
        }

        async function deleteEBITDAProjection() {
            const user = auth.currentUser;
            if (!user) {
                alert('Silmek için giriş yapmanız gerekiyor.');
                return;
            }

            if (!confirm('Bu yıl için kayıtlı EBITDA projeksiyonunu silmek istediğinize emin misiniz?')) {
                return;
            }

            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);

            try {
                const snap = await db.collection('ebitdaProjections')
                    .where('userId', '==', user.uid)
                    .where('year', '==', year)
                    .limit(1)
                    .get();

                if (snap.empty) {
                    alert('Bu yıl için kayıtlı EBITDA projeksiyonu bulunamadı.');
                    return;
                }

                await snap.docs[0].ref.delete();
                alert('EBITDA projeksiyonu başarıyla silindi!');
                
                // Form alanlarını temizle
                const allInputs = document.querySelectorAll('#ebitdaModal .ebitda-month-input');
                allInputs.forEach(input => input.value = '');
                currentEBITDADocId = null;
            } catch (err) {
                console.error('EBITDA projeksiyonu silinirken hata:', err);
                alert('Silme işlemi sırasında hata oluştu.');
            }
        }

        async function saveEBITDAProjection() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kayıt için önce giriş yapmanız gerekiyor.');
                return;
            }

            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);
            const monthData = {};

            // Aylık verileri topla
            for (let month = 1; month <= 12; month++) {
                const incomeInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="income"]`);
                const expensesInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="expenses"]`);
                const ebitdaInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="ebitda"]`);

                if (incomeInput && expensesInput && ebitdaInput) {
                    monthData[month] = {
                        income: parseFormattedNumber(incomeInput.value),
                        expenses: parseFormattedNumber(expensesInput.value),
                        ebitda: parseFormattedNumber(ebitdaInput.value)
                    };
                }
            }

            // Özet verileri al
            const totalIncome = parseFormattedNumber(document.getElementById('ebitdaTotalIncome').value);
            const totalExpenses = parseFormattedNumber(document.getElementById('ebitdaTotalExpenses').value);
            const totalCreditCards = parseFormattedNumber(document.getElementById('ebitdaTotalCreditCards').value);
            const totalCredits = parseFormattedNumber(document.getElementById('ebitdaTotalCredits').value);

            const data = {
                userId: user.uid,
                year,
                totalIncome,
                totalExpenses,
                totalCreditCards,
                totalCredits,
                monthlyData: monthData,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };

            try {
                if (currentEBITDADocId) {
                    // Güncelle
                    await db.collection('ebitdaProjections').doc(currentEBITDADocId).update(data);
                    alert('EBITDA projeksiyonu başarıyla güncellendi!');
                    currentEBITDADocId = null;
                } else {
                    // Mevcut kaydı kontrol et
                    const existingSnap = await db.collection('ebitdaProjections')
                        .where('userId', '==', user.uid)
                        .where('year', '==', year)
                        .limit(1)
                        .get();

                    if (!existingSnap.empty) {
                        // Güncelle
                        await existingSnap.docs[0].ref.update(data);
                        alert('EBITDA projeksiyonu güncellendi!');
                    } else {
                        // Yeni kayıt
                        await db.collection('ebitdaProjections').add(data);
                        alert('EBITDA projeksiyonu kaydedildi!');
                    }
                }
                closeEBITDAModal();
            } catch (err) {
                console.error(err);
                alert('Kayıt sırasında hata oluştu.');
            }
        }

        async function searchEBITDAByDateRange() {
            const user = auth.currentUser;
            if (!user) {
                alert('Arama yapmak için giriş yapmanız gerekiyor.');
                return;
            }

            const startDate = document.getElementById('ebitdaStartDate').value;
            const endDate = document.getElementById('ebitdaEndDate').value;

            if (!startDate || !endDate) {
                alert('Lütfen başlangıç ve bitiş tarihlerini seçiniz.');
                return;
            }

            if (new Date(startDate) > new Date(endDate)) {
                alert('Başlangıç tarihi bitiş tarihinden sonra olamaz.');
                return;
            }

            try {
                const start = new Date(startDate);
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);

                // Gelir verilerini yükle
                const incomeSnap = await db.collection('incomeItems')
                    .where('userId', '==', user.uid)
                    .get();

                // Gider verilerini yükle
                const expenseSnap = await db.collection('expenseItems')
                    .where('userId', '==', user.uid)
                    .get();

                let totalSalary = 0, totalDividend = 0, totalBonus = 0, totalPremium = 0, totalOtherIncome = 0;
                let totalBills = 0, totalGeneral = 0, totalCreditCards = 0, totalCredits = 0;

                incomeSnap.forEach(doc => {
                    const data = doc.data();
                    const recordDate = new Date(data.year, data.month - 1, 1);
                    
                    if (recordDate >= start && recordDate <= end) {
                        totalSalary += data.salary || 0;
                        totalDividend += data.dividend || 0;
                        totalBonus += data.bonus || 0;
                        totalPremium += data.premium || 0;
                        totalOtherIncome += data.other || 0;
                    }
                });

                expenseSnap.forEach(doc => {
                    const data = doc.data();
                    const recordDate = new Date(data.year, data.month - 1, 1);
                    
                    if (recordDate >= start && recordDate <= end) {
                        totalBills += data.billsTotal || 0;
                        totalGeneral += data.generalTotal || 0;
                        totalCreditCards += data.creditCardsTotal || 0;
                        totalCredits += data.creditsTotal || 0;
                    }
                });

                // Özet kısmını güncelle (sadece Maaş ve Diğer Gelirler)
                document.getElementById('ebitdaSalary').value = formatNumber(totalSalary);
                document.getElementById('ebitdaOtherIncome').value = formatNumber(totalOtherIncome);
                const totalIncome = totalSalary + totalOtherIncome;
                document.getElementById('ebitdaTotalIncome').value = formatNumber(totalIncome);

                document.getElementById('ebitdaTotalBills').value = formatNumber(totalBills);
                document.getElementById('ebitdaTotalGeneral').value = formatNumber(totalGeneral);
                const totalExpenses = totalBills + totalGeneral;
                document.getElementById('ebitdaTotalExpenses').value = formatNumber(totalExpenses);

                document.getElementById('ebitdaTotalCreditCards').value = formatNumber(totalCreditCards);
                document.getElementById('ebitdaTotalCredits').value = formatNumber(totalCredits);

                // Aylık projeksiyon tablosunu temizle (tarih aralığı için aylık detay yok)
                for (let month = 1; month <= 12; month++) {
                    const incomeInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="income"]`);
                    const expensesInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="expenses"]`);
                    const ebitdaInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="ebitda"]`);

                    if (incomeInput) incomeInput.value = '';
                    if (expensesInput) expensesInput.value = '';
                    if (ebitdaInput) ebitdaInput.value = '';
                }
            } catch (err) {
                console.error('EBITDA arama hatası:', err);
                alert('Arama sırasında hata oluştu.');
            }
        }

        function exportEBITDAToExcel() {
            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            
            const rows = [];
            const incomeRow = ['GELİRLER'];
            const expensesRow = ['GİDERLER'];
            const ebitdaRow = ['EBITDA'];

            for (let month = 1; month <= 12; month++) {
                const incomeInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="income"]`);
                const expensesInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="expenses"]`);
                const ebitdaInput = document.querySelector(`.ebitda-month-input[data-month="${month}"][data-type="ebitda"]`);

                incomeRow.push((parseFloat(incomeInput?.value) || 0).toFixed(2));
                expensesRow.push((parseFloat(expensesInput?.value) || 0).toFixed(2));
                ebitdaRow.push((parseFloat(ebitdaInput?.value) || 0).toFixed(2));
            }

            rows.push(incomeRow);
            rows.push(expensesRow);
            rows.push(ebitdaRow);

            const header = ['', ...monthNames.slice(1).map((m, i) => m + '.' + yearShort)];
            const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'ebitda-projeksiyonu-' + year + '.csv';
            link.click();
            URL.revokeObjectURL(link.href);
        }

        function exportEBITDAToPDF() {
            const year = parseInt(document.getElementById('ebitdaYearSelect').value, 10);
            const yearShort = year.toString().slice(-2);
            const monthNames = ['', 'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
            
            let html = `
                <html>
                <head>
                    <title>EBITDA Projeksiyonu</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        h1 { color: #1a237e; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
                        th { background-color: #1a237e; color: white; }
                        .summary { margin-top: 30px; }
                        .summary h2 { color: #1a237e; }
                        .summary-item { margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <h1>EBITDA Projeksiyonu - ${year}</h1>
                    <div class="summary">
                        <h2>Özet</h2>
                        <div class="summary-item"><strong>Toplam Gelirler:</strong> ${formatNumber(parseFormattedNumber(document.getElementById('ebitdaTotalIncome').value))} ₺</div>
                        <div class="summary-item"><strong>Toplam Giderler:</strong> ${formatNumber(parseFormattedNumber(document.getElementById('ebitdaTotalExpenses').value))} ₺</div>
                        <div class="summary-item"><strong>Toplam Kredi Kartları:</strong> ${formatNumber(parseFormattedNumber(document.getElementById('ebitdaTotalCreditCards').value))} ₺</div>
                        <div class="summary-item"><strong>Toplam Krediler:</strong> ${formatNumber(parseFormattedNumber(document.getElementById('ebitdaTotalCredits').value))} ₺</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                ${monthNames.slice(1).map(m => `<th>${m}.${yearShort}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td><strong>GELİRLER</strong></td>
                                ${Array.from({length: 12}, (_, i) => {
                                    const input = document.querySelector(`.ebitda-month-input[data-month="${i+1}"][data-type="income"]`);
                                    return `<td>${formatNumber(parseFormattedNumber(input?.value || 0))}</td>`;
                                }).join('')}
                            </tr>
                            <tr>
                                <td><strong>GİDERLER</strong></td>
                                ${Array.from({length: 12}, (_, i) => {
                                    const input = document.querySelector(`.ebitda-month-input[data-month="${i+1}"][data-type="expenses"]`);
                                    return `<td>${formatNumber(parseFormattedNumber(input?.value || 0))}</td>`;
                                }).join('')}
                            </tr>
                            <tr>
                                <td><strong>EBITDA</strong></td>
                                ${Array.from({length: 12}, (_, i) => {
                                    const input = document.querySelector(`.ebitda-month-input[data-month="${i+1}"][data-type="ebitda"]`);
                                    return `<td>${formatNumber(parseFormattedNumber(input?.value || 0))}</td>`;
                                }).join('')}
                            </tr>
                        </tbody>
                    </table>
                </body>
                </html>
            `;

            const printWindow = window.open('', '_blank');
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
        }

        // Ay ve yıl değiştiğinde verileri yükle (sayfa yüklendiğinde)
        setTimeout(function() {
            const monthSelect = document.getElementById('incomeMonthSelect');
            const yearSelect = document.getElementById('incomeYearSelect');
            if (monthSelect) {
                monthSelect.addEventListener('change', function() {
                    loadIncomeData();
                    document.getElementById('btnSaveIncome').style.display = 'block';
                    document.getElementById('incomeDateRangeResults').style.display = 'none';
                });
            }
            if (yearSelect) {
                yearSelect.addEventListener('change', function() {
                    loadIncomeData();
                    document.getElementById('btnSaveIncome').style.display = 'block';
                    document.getElementById('incomeDateRangeResults').style.display = 'none';
                });
            }
            
            // Giderlerim için de event listener ekle
            const expMonthSelect = document.getElementById('expensesMonthSelect');
            const expYearSelect = document.getElementById('expensesYearSelect');
            if (expMonthSelect) {
                expMonthSelect.addEventListener('change', function() {
                    loadExpensesData();
                    document.getElementById('btnSaveExpenses').style.display = 'block';
                    document.getElementById('expensesDateRangeResults').style.display = 'none';
                });
            }
            if (expYearSelect) {
                expYearSelect.addEventListener('change', function() {
                    loadExpensesData();
                    document.getElementById('btnSaveExpenses').style.display = 'block';
                    document.getElementById('expensesDateRangeResults').style.display = 'none';
                });
            }
            
            // Tarih aralığı değiştiğinde sonuçları gizle
            const incomeStartDate = document.getElementById('incomeStartDate');
            const incomeEndDate = document.getElementById('incomeEndDate');
            if (incomeStartDate) {
                incomeStartDate.addEventListener('change', function() {
                    document.getElementById('incomeDateRangeResults').style.display = 'none';
                    document.getElementById('btnSaveIncome').style.display = 'block';
                });
            }
            if (incomeEndDate) {
                incomeEndDate.addEventListener('change', function() {
                    document.getElementById('incomeDateRangeResults').style.display = 'none';
                    document.getElementById('btnSaveIncome').style.display = 'block';
                });
            }
            
            const expensesStartDate = document.getElementById('expensesStartDate');
            const expensesEndDate = document.getElementById('expensesEndDate');
            if (expensesStartDate) {
                expensesStartDate.addEventListener('change', function() {
                    document.getElementById('expensesDateRangeResults').style.display = 'none';
                    document.getElementById('btnSaveExpenses').style.display = 'block';
                });
            }
            if (expensesEndDate) {
                expensesEndDate.addEventListener('change', function() {
                    document.getElementById('expensesDateRangeResults').style.display = 'none';
                    document.getElementById('btnSaveExpenses').style.display = 'block';
                });
            }

            // EBITDA için event listener ekle
            const ebitdaMonthSelect = document.getElementById('ebitdaMonthSelect');
            const ebitdaYearSelect = document.getElementById('ebitdaYearSelect');
            if (ebitdaYearSelect) {
                ebitdaYearSelect.addEventListener('change', function() {
                    updateMonthHeaders();
                    loadEBITDAData();
                });
            }

            // Nakit Akış Tablosu için event listener ekle
            const cashFlowYearSelect = document.getElementById('cashFlowYearSelect');
            if (cashFlowYearSelect) {
                cashFlowYearSelect.addEventListener('change', function() {
                    updateCashFlowMonthHeaders();
                    loadCashFlowTableData();
                });
            }
            // Nakit akış hücrelerinde blur'da binlik nokta formatı (10.000,00)
            document.addEventListener('blur', function(e) {
                if (e.target && e.target.matches && e.target.matches('#cashFlowModal .cashflow-month-input, #cashFlowModal .cashflow-total-input')) {
                    var val = (typeof parseFormattedNumber !== 'undefined' ? parseFormattedNumber : window.parseFormattedNumber)(e.target.value);
                    e.target.value = (typeof valueForNumberInput !== 'undefined' ? valueForNumberInput : window.valueForNumberInput)(val);
                    if (typeof calculateCashFlow === 'function') calculateCashFlow();
                }
                if (e.target && e.target.id === 'cashFlowBeginningCash') {
                    var v = (typeof parseFormattedNumber !== 'undefined' ? parseFormattedNumber : window.parseFormattedNumber)(e.target.value);
                    e.target.value = (typeof formatNumber !== 'undefined' ? formatNumber : window.formatNumber)(v);
                }
            }, true);
        }, 1000);

const firebaseConfig = {
            apiKey: "AIzaSyAuBrNSd6HPNeWNpjfQQjK-cs8H2mn_X6s",
            authDomain: "finans-sepeti.firebaseapp.com",
            projectId: "finans-sepeti",
            storageBucket: "finans-sepeti.firebasestorage.app",
            messagingSenderId: "25944539327",
            appId: "1:25944539327:web:ceac9814113c60b8b8c60a"
        };

        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();
        const storage = firebase.storage();
        const googleProvider = new firebase.auth.GoogleAuthProvider();
        googleProvider.addScope('email');
        googleProvider.addScope('profile');
        googleProvider.setCustomParameters({ prompt: 'select_account' });
        let currentAuthMode = 'login';

        function isFinansSepetiApp() {
            try {
                return typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.indexOf('FinansSepetiApp') !== -1;
            } catch (e) {
                return false;
            }
        }
        function isIosDevice() {
            try {
                var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
                return /iPad|iPhone|iPod/i.test(ua);
            } catch (e) {
                return false;
            }
        }
        function isLikelyInAppBrowser() {
            try {
                var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
                return /FBAN|FBAV|Instagram|Line|Twitter|LinkedInApp|wv|WebView/i.test(ua);
            } catch (e) {
                return false;
            }
        }
        function isAndroidDevice() {
            try {
                var ua = (navigator && navigator.userAgent) ? navigator.userAgent : '';
                return /Android/i.test(ua);
            } catch (e) {
                return false;
            }
        }
        function isMobileDevice() {
            return isIosDevice() || isAndroidDevice();
        }
        function markGoogleRedirectInFlight() {
            try { window.__fsGoogleRedirectFinalizeDone = false; } catch (eR) {}
            var ts = String(Date.now());
            try { sessionStorage.setItem('fs_google_redirect_pending', '1'); } catch (eP) {}
            try { sessionStorage.setItem('fs_google_redirect_started_at', String(Date.now())); } catch (eT) {}
            try { localStorage.setItem('fs_google_redirect_in_flight', ts); } catch (e) {}
            try { sessionStorage.setItem('fs_google_redirect_in_flight', ts); } catch (e2) {}
            try { document.cookie = 'fs_google_redirect_in_flight=' + encodeURIComponent(ts) + '; path=/; max-age=600; SameSite=Lax'; } catch (e3) {}
            var ret = (window.location && window.location.href) ? String(window.location.href) : ((window.location.pathname || '/') + (window.location.search || '') + (window.location.hash || ''));
            try {
                localStorage.setItem('fs_google_redirect_return_url', ret);
                sessionStorage.setItem('fs_google_redirect_return_url', ret);
                document.cookie = 'fs_google_redirect_return_url=' + encodeURIComponent(ret) + '; path=/; max-age=600; SameSite=Lax';
            } catch (e4) {}
            /* www / kök alan arası dönüşte aynı çerezi görmek için (Üretim: finanssepeti.net) */
            try {
                var hn = (window.location && window.location.hostname) ? String(window.location.hostname) : '';
                if (hn.indexOf('finanssepeti.net') !== -1) {
                    var sec = (window.location && window.location.protocol === 'https:') ? '; Secure' : '';
                    document.cookie = 'fs_google_redirect_in_flight=' + encodeURIComponent(ts) + '; path=/; max-age=600; SameSite=Lax; Domain=.finanssepeti.net' + sec;
                    document.cookie = 'fs_google_redirect_return_url=' + encodeURIComponent(ret) + '; path=/; max-age=600; SameSite=Lax; Domain=.finanssepeti.net' + sec;
                }
            } catch (e5) {}
        }
        try { window.fsMarkGoogleRedirectInFlight = markGoogleRedirectInFlight; } catch (e) {}
        function hasGoogleRedirectInFlight() {
            try {
                if (sessionStorage.getItem('fs_google_redirect_pending') === '1') {
                    var st = parseInt(sessionStorage.getItem('fs_google_redirect_started_at') || '0', 10);
                    if (st && (Date.now() - st) > 25 * 60 * 1000) {
                        sessionStorage.removeItem('fs_google_redirect_pending');
                        sessionStorage.removeItem('fs_google_redirect_started_at');
                    } else {
                        return true;
                    }
                }
            } catch (e0) {}
            try { if (localStorage.getItem('fs_google_redirect_in_flight')) return true; } catch (e) {}
            try { if (sessionStorage.getItem('fs_google_redirect_in_flight')) return true; } catch (e2) {}
            try { if ((document.cookie || '').indexOf('fs_google_redirect_in_flight=') !== -1) return true; } catch (e3) {}
            return false;
        }
        function clearGoogleRedirectInFlight() {
            try { sessionStorage.removeItem('fs_google_redirect_pending'); } catch (eP) {}
            try { sessionStorage.removeItem('fs_google_redirect_started_at'); } catch (eTs) {}
            try { localStorage.removeItem('fs_google_redirect_in_flight'); } catch (e) {}
            try { sessionStorage.removeItem('fs_google_redirect_in_flight'); } catch (e2) {}
            try { document.cookie = 'fs_google_redirect_in_flight=; path=/; max-age=0; SameSite=Lax'; } catch (e3) {}
            try { localStorage.removeItem('fs_google_redirect_return_url'); } catch (e4) {}
            try { sessionStorage.removeItem('fs_google_redirect_return_url'); } catch (e5) {}
            try { document.cookie = 'fs_google_redirect_return_url=; path=/; max-age=0; SameSite=Lax'; } catch (e6) {}
            try {
                var hn = (window.location && window.location.hostname) ? String(window.location.hostname) : '';
                if (hn.indexOf('finanssepeti.net') !== -1) {
                    document.cookie = 'fs_google_redirect_in_flight=; path=/; max-age=0; SameSite=Lax; Domain=.finanssepeti.net';
                    document.cookie = 'fs_google_redirect_return_url=; path=/; max-age=0; SameSite=Lax; Domain=.finanssepeti.net';
                }
            } catch (e7) {}
        }
        function getGoogleRedirectReturnUrl() {
            var r = '';
            try { r = localStorage.getItem('fs_google_redirect_return_url') || ''; } catch (e) {}
            if (!r) { try { r = sessionStorage.getItem('fs_google_redirect_return_url') || ''; } catch (e2) {} }
            if (!r) {
                try {
                    var m = (document.cookie || '').match(/(?:^|;\s*)fs_google_redirect_return_url=([^;]+)/);
                    if (m && m[1]) r = decodeURIComponent(m[1]);
                } catch (e3) {}
            }
            return r || '';
        }

        // Mobilde redirect dönüşünde oturumun kaybolmaması için varsayılan persistence'ı LOCAL'e çek.
        try {
            if (isMobileDevice() || isLikelyInAppBrowser() || isFinansSepetiApp()) {
                auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function() {});
            }
        } catch (e) {}

        var siteTranslations = {
            tr: { ayarlar: 'Ayarlar', 'ayarlar.sifre': 'Şifre Değiştir', 'ayarlar.dil.menu': 'Dil Seçenekleri', 'ayarlar.gorunum': 'Site Görünümü', 'ayarlar.uye': 'Site üyeliği kişi sayısı', 'ayarlar.sifre.baslik': 'Şifre Değiştir', 'ayarlar.sifre.desc': 'Üye olurken girdiğiniz şifreyi buradan güncelleyebilirsiniz.', 'ayarlar.sifre.mevcut': 'Mevcut Şifre:', 'ayarlar.sifre.yeni': 'Yeni Şifre:', 'ayarlar.sifre.tekrar': 'Tekrar Yeni Şifre:', 'common.kaydet': 'Kaydet', 'ayarlar.dil.baslik': 'Dil Seçenekleri', 'ayarlar.dil.desc': 'Seçtiğiniz dil kaydedildikten sonra sitenin tüm metinleri o dile çevrilir.', 'dil.tr': 'Türkçe', 'dil.en': 'İngilizce', 'dil.de': 'Almanca', 'dil.it': 'İtalyanca', 'dil.fr': 'Fransızca', 'dil.es': 'İspanyolca', 'dil.ru': 'Rusça', 'dil.zh': 'Çince', 'dil.pt': 'Portekizce', 'dil.ar': 'Arapça', 'nav.sosyal': 'SOSYAL AĞ', 'nav.kiyasla': 'KIYASLA', 'nav.piyasalar': 'PİYASALAR', 'nav.yatirim': 'YATIRIM EKLE', 'nav.portfoy': 'PORTFÖYÜM', 'nav.harcama': 'HARCAMALARIM', 'nav.teknik': 'TEKNİK ANALİZ', 'nav.kredi': 'KREDİLER', 'nav.haber': 'HABERLER', 'nav.menu': 'MENÜ', 'nav.giris': 'GİRİŞ', 'nav.uyeol': 'ÜYE OL', 'social.profil': 'Profilim', 'social.ana': 'Ana Sayfam', 'social.kisi': 'Kişi Ara', 'social.bildirim': 'Bildirimler', 'social.mesaj': 'Mesajlarım', 'social.yorum': 'Yorumlarım', 'social.yorumYaz': 'Yorum Yaz', 'social.yorumlarim': 'Yorumlarım', 'social.begendik': 'Beğendiklerim', 'social.foto': 'Fotoğraflarım', 'social.video': 'Videolarım', 'social.favori': 'Favorilerim', 'social.forum': 'Forum', 'social.kariyer': 'Kariyerim', 'social.toplanti': 'Toplantılarım', 'social.canli': 'Canlı Yayınlarım', 'social.ayarlar': 'Ayarlar', 'auth.title': 'Giriş Yap', 'auth.subtitle': 'FinansSepeti hesabınla terminale giriş yap.', 'auth.username': 'Kullanıcı Adı', 'auth.email': 'E-mail', 'auth.password': 'Şifre', 'auth.password2': 'Yeniden Şifre Oluştur', 'auth.robot': 'Ben robot değilim', 'auth.submit': 'GİRİŞ YAP', 'auth.google': 'Google ile Giriş Yap', 'auth.toggle': 'Hesabın yok mu?', 'auth.register': 'Üye ol', 'auth.submitRegister': 'ÜYE OL' },
            en: { ayarlar: 'Settings', 'ayarlar.sifre': 'Change Password', 'ayarlar.dil.menu': 'Language Options', 'ayarlar.gorunum': 'Site Appearance', 'ayarlar.uye': 'Site membership count', 'ayarlar.sifre.baslik': 'Change Password', 'ayarlar.sifre.desc': 'Update the password you set when registering.', 'ayarlar.sifre.mevcut': 'Current Password:', 'ayarlar.sifre.yeni': 'New Password:', 'ayarlar.sifre.tekrar': 'Confirm New Password:', 'common.kaydet': 'Save', 'ayarlar.dil.baslik': 'Language Options', 'ayarlar.dil.desc': 'After saving, the entire site will be displayed in the selected language.', 'dil.en': 'English', 'dil.de': 'German', 'dil.it': 'Italian', 'dil.fr': 'French', 'dil.es': 'Spanish', 'dil.ru': 'Russian', 'dil.zh': 'Chinese', 'dil.pt': 'Portuguese', 'dil.ar': 'Arabic', 'nav.sosyal': 'SOCIAL', 'nav.kiyasla': 'COMPARE', 'nav.piyasalar': 'MARKETS', 'nav.yatirim': 'ADD INVESTMENT', 'nav.portfoy': 'MY PORTFOLIO', 'nav.harcama': 'MY EXPENSES', 'nav.teknik': 'TECHNICAL ANALYSIS', 'nav.kredi': 'LOANS', 'nav.haber': 'NEWS', 'nav.menu': 'MENU', 'nav.giris': 'LOG IN', 'nav.uyeol': 'SIGN UP', 'social.profil': 'My Profile', 'social.ana': 'Home', 'social.kisi': 'Find People', 'social.bildirim': 'Notifications', 'social.mesaj': 'Messages', 'social.yorum': 'Comments', 'social.yorumYaz': 'Write Comment', 'social.yorumlarim': 'My Comments', 'social.begendik': 'Liked', 'social.foto': 'My Photos', 'social.video': 'My Videos', 'social.favori': 'Favorites', 'social.forum': 'Forum', 'social.kariyer': 'My Career', 'social.toplanti': 'My Meetings', 'social.canli': 'Live Streams', 'social.ayarlar': 'Settings', 'auth.title': 'Log In', 'auth.subtitle': 'Log in to the terminal with your FinansSepeti account.', 'auth.username': 'Username', 'auth.email': 'Email', 'auth.password': 'Password', 'auth.password2': 'Confirm Password', 'auth.robot': "I'm not a robot", 'auth.submit': 'LOG IN', 'auth.google': 'Log in with Google', 'auth.toggle': "Don't have an account?", 'auth.register': 'Sign up' },
            de: { ayarlar: 'Einstellungen', 'ayarlar.sifre': 'Passwort ändern', 'ayarlar.dil.menu': 'Sprachoptionen', 'ayarlar.gorunum': 'Darstellung', 'ayarlar.uye': 'Anzahl der Site-Mitglieder', 'ayarlar.sifre.baslik': 'Passwort ändern', 'ayarlar.sifre.desc': 'Aktualisieren Sie Ihr Passwort.', 'ayarlar.sifre.mevcut': 'Aktuelles Passwort:', 'ayarlar.sifre.yeni': 'Neues Passwort:', 'ayarlar.sifre.tekrar': 'Passwort bestätigen:', 'common.kaydet': 'Speichern', 'ayarlar.dil.baslik': 'Sprachoptionen', 'ayarlar.dil.desc': 'Die gesamte Seite wird in der gewählten Sprache angezeigt.', 'dil.tr': 'Türkisch', 'dil.en': 'Englisch', 'dil.de': 'Deutsch', 'dil.it': 'Italienisch', 'dil.fr': 'Französisch', 'dil.es': 'Spanisch', 'dil.ru': 'Russisch', 'dil.zh': 'Chinesisch', 'dil.pt': 'Portugiesisch', 'nav.sosyal': 'SOZIALES', 'nav.piyasalar': 'MÄRKTE', 'nav.yatirim': 'INVESTITION', 'nav.portfoy': 'PORTFOLIO', 'nav.harcama': 'AUSGABEN', 'nav.teknik': 'TECHNISCHE ANALYSE', 'nav.kredi': 'KREDITE', 'nav.haber': 'NACHRICHTEN', 'nav.menu': 'MENÜ', 'nav.giris': 'ANMELDEN', 'nav.uyeol': 'REGISTRIEREN', 'social.profil': 'Profil', 'social.ana': 'Startseite', 'social.kisi': 'Personen suchen', 'social.bildirim': 'Benachrichtigungen', 'social.mesaj': 'Nachrichten', 'social.yorum': 'Kommentare', 'social.yorumYaz': 'Kommentar schreiben', 'social.yorumlarim': 'Meine Kommentare', 'social.begendik': 'Gefällt mir', 'social.foto': 'Fotos', 'social.video': 'Videos', 'social.favori': 'Favoriten', 'social.forum': 'Forum', 'social.kariyer': 'Karriere', 'social.toplanti': 'Meine Meetings', 'social.canli': 'Live', 'social.ayarlar': 'Einstellungen', 'auth.title': 'Anmelden', 'auth.subtitle': 'Mit Ihrem Konto anmelden.', 'auth.username': 'Benutzername', 'auth.email': 'E-Mail', 'auth.password': 'Passwort', 'auth.password2': 'Passwort bestätigen', 'auth.robot': 'Ich bin kein Robot', 'auth.submit': 'ANMELDEN', 'auth.google': 'Mit Google anmelden', 'auth.toggle': 'Noch kein Konto?', 'auth.register': 'Registrieren', 'auth.submitRegister': 'REGISTRIEREN' },
            es: { ayarlar: 'Ajustes', 'ayarlar.sifre': 'Cambiar contraseña', 'ayarlar.dil.menu': 'Idioma', 'ayarlar.gorunum': 'Apariencia', 'ayarlar.uye': 'Número de miembros del sitio', 'ayarlar.sifre.baslik': 'Cambiar contraseña', 'ayarlar.sifre.desc': 'Actualice su contraseña.', 'ayarlar.sifre.mevcut': 'Contraseña actual:', 'ayarlar.sifre.yeni': 'Nueva contraseña:', 'ayarlar.sifre.tekrar': 'Confirmar:', 'common.kaydet': 'Guardar', 'ayarlar.dil.baslik': 'Idioma', 'ayarlar.dil.desc': 'El sitio se mostrará en el idioma seleccionado.', 'dil.en': 'Inglés', 'dil.de': 'Alemán', 'dil.it': 'Italiano', 'dil.fr': 'Francés', 'dil.es': 'Español', 'dil.ru': 'Ruso', 'dil.zh': 'Chino', 'dil.pt': 'Portugués', 'dil.ar': 'Árabe', 'nav.sosyal': 'RED', 'nav.piyasalar': 'MERCADOS', 'nav.yatirim': 'INVERSIÓN', 'nav.portfoy': 'PORTFOLIO', 'nav.harcama': 'GASTOS', 'nav.teknik': 'ANÁLISIS TÉCNICO', 'nav.kredi': 'CRÉDITOS', 'nav.haber': 'NOTICIAS', 'nav.menu': 'MENÚ', 'nav.giris': 'ENTRAR', 'nav.uyeol': 'REGISTRARSE', 'social.profil': 'Perfil', 'social.ana': 'Inicio', 'social.kisi': 'Buscar personas', 'social.bildirim': 'Notificaciones', 'social.mesaj': 'Mensajes', 'social.yorum': 'Comentarios', 'social.yorumYaz': 'Escribir comentario', 'social.yorumlarim': 'Mis comentarios', 'social.begendik': 'Me gusta', 'social.foto': 'Fotos', 'social.video': 'Vídeos', 'social.favori': 'Favoritos', 'social.forum': 'Foro', 'social.kariyer': 'Carrera', 'social.toplanti': 'Reuniones', 'social.canli': 'En directo', 'social.ayarlar': 'Ajustes', 'auth.title': 'Entrar', 'auth.subtitle': 'Inicia sesión con tu cuenta.', 'auth.username': 'Usuario', 'auth.email': 'Correo', 'auth.password': 'Contraseña', 'auth.password2': 'Confirmar', 'auth.robot': 'No soy un robot', 'auth.submit': 'ENTRAR', 'auth.google': 'Entrar con Google', 'auth.toggle': '¿No tienes cuenta?', 'auth.register': 'Registrarse' },
            fr: { ayarlar: 'Paramètres', 'ayarlar.sifre': 'Changer le mot de passe', 'ayarlar.dil.menu': 'Langue', 'ayarlar.gorunum': 'Apparence du site', 'ayarlar.uye': "Nombre d’utilisateurs", 'ayarlar.sifre.baslik': 'Changer le mot de passe', 'ayarlar.sifre.desc': 'Mettez à jour le mot de passe défini lors de votre inscription.', 'ayarlar.sifre.mevcut': 'Mot de passe actuel :', 'ayarlar.sifre.yeni': 'Nouveau mot de passe :', 'ayarlar.sifre.tekrar': 'Confirmer le mot de passe :', 'common.kaydet': 'Enregistrer', 'ayarlar.dil.baslik': 'Langue', 'ayarlar.dil.desc': 'Après enregistrement, tout le site sera affiché dans la langue choisie.', 'dil.en': 'Anglais', 'dil.de': 'Allemand', 'dil.it': 'Italien', 'dil.fr': 'Français', 'dil.es': 'Espagnol', 'dil.ru': 'Russe', 'dil.zh': 'Chinois', 'dil.pt': 'Portugais', 'dil.ar': 'Arabe', 'nav.sosyal': 'RÉSEAU SOCIAL', 'nav.piyasalar': 'MARCHÉS', 'nav.yatirim': 'AJOUTER INVEST.', 'nav.portfoy': 'PORTFOLIO', 'nav.harcama': 'DÉPENSES', 'nav.teknik': 'ANALYSE TECHNIQUE', 'nav.kredi': 'CRÉDITS', 'nav.haber': 'ACTUALITÉS', 'nav.menu': 'MENU', 'nav.giris': 'CONNEXION', 'nav.uyeol': 'INSCRIPTION', 'social.profil': 'Mon profil', 'social.ana': 'Accueil', 'social.kisi': 'Rechercher des personnes', 'social.bildirim': 'Notifications', 'social.mesaj': 'Messages', 'social.yorum': 'Commentaires', 'social.yorumYaz': 'Écrire un commentaire', 'social.yorumlarim': 'Mes commentaires', 'social.begendik': 'J’aime', 'social.foto': 'Mes photos', 'social.video': 'Mes vidéos', 'social.favori': 'Favoris', 'social.forum': 'Forum', 'social.kariyer': 'Ma carrière', 'social.toplanti': 'Mes réunions', 'social.canli': 'En direct', 'social.ayarlar': 'Paramètres', 'auth.title': 'Connexion', 'auth.subtitle': 'Connectez-vous avec votre compte FinansSepeti.', 'auth.username': "Nom d’utilisateur", 'auth.email': 'E‑mail', 'auth.password': 'Mot de passe', 'auth.password2': 'Confirmer le mot de passe', 'auth.robot': 'Je ne suis pas un robot', 'auth.submit': 'SE CONNECTER', 'auth.google': 'Connexion avec Google', 'auth.toggle': 'Pas de compte ?', 'auth.register': 'Créer un compte', 'auth.submitRegister': 'INSCRIPTION' },
            ru: { ayarlar: 'Настройки', 'ayarlar.sifre': 'Сменить пароль', 'ayarlar.dil.menu': 'Язык', 'ayarlar.gorunum': 'Вид сайта', 'ayarlar.uye': 'Количество участников сайта', 'ayarlar.sifre.baslik': 'Сменить пароль', 'ayarlar.sifre.desc': 'Обновите пароль.', 'ayarlar.sifre.mevcut': 'Текущий пароль:', 'ayarlar.sifre.yeni': 'Новый пароль:', 'ayarlar.sifre.tekrar': 'Подтвердите:', 'common.kaydet': 'Сохранить', 'ayarlar.dil.baslik': 'Язык', 'ayarlar.dil.desc': 'Сайт отобразится на выбранном языке.', 'dil.en': 'Английский', 'dil.de': 'Немецкий', 'dil.it': 'Итальянский', 'dil.fr': 'Французский', 'dil.es': 'Испанский', 'dil.ru': 'Русский', 'dil.zh': 'Китайский', 'dil.pt': 'Португальский', 'dil.ar': 'Арабский', 'nav.sosyal': 'СОЦИАЛЬНАЯ СЕТЬ', 'nav.piyasalar': 'РЫНКИ', 'nav.yatirim': 'ИНВЕСТИЦИИ', 'nav.portfoy': 'ПОРТФЕЛЬ', 'nav.harcama': 'РАСХОДЫ', 'nav.teknik': 'ТЕХНИЧЕСКИЙ АНАЛИЗ', 'nav.kredi': 'КРЕДИТЫ', 'nav.haber': 'НОВОСТИ', 'nav.menu': 'МЕНЮ', 'nav.giris': 'ВХОД', 'nav.uyeol': 'РЕГИСТРАЦИЯ', 'social.profil': 'Профиль', 'social.ana': 'Главная', 'social.kisi': 'Поиск людей', 'social.bildirim': 'Уведомления', 'social.mesaj': 'Сообщения', 'social.yorum': 'Комментарии', 'social.yorumYaz': 'Написать', 'social.yorumlarim': 'Мои комментарии', 'social.begendik': 'Понравилось', 'social.foto': 'Фото', 'social.video': 'Видео', 'social.favori': 'Избранное', 'social.forum': 'Форум', 'social.kariyer': 'Карьера', 'social.toplanti': 'Встречи', 'social.canli': 'Трансляции', 'social.ayarlar': 'Настройки', 'auth.title': 'Вход', 'auth.subtitle': 'Войдите в свой аккаунт.', 'auth.username': 'Имя пользователя', 'auth.email': 'Email', 'auth.password': 'Пароль', 'auth.password2': 'Подтвердите', 'auth.robot': 'Я не робот', 'auth.submit': 'ВОЙТИ', 'auth.google': 'Войти через Google', 'auth.toggle': 'Нет аккаунта?', 'auth.register': 'Регистрация', 'auth.submitRegister': 'РЕГИСТРАЦИЯ' },
            zh: { ayarlar: '设置', 'ayarlar.sifre': '修改密码', 'ayarlar.dil.menu': '语言', 'ayarlar.gorunum': '外观', 'ayarlar.uye': '网站会员人数', 'ayarlar.sifre.baslik': '修改密码', 'ayarlar.sifre.desc': '更新您的密码。', 'ayarlar.sifre.mevcut': '当前密码：', 'ayarlar.sifre.yeni': '新密码：', 'ayarlar.sifre.tekrar': '确认密码：', 'common.kaydet': '保存', 'ayarlar.dil.baslik': '语言', 'ayarlar.dil.desc': '网站将显示为您选择的语言。', 'dil.en': '英语', 'dil.de': '德语', 'dil.it': '意大利语', 'dil.fr': '法语', 'dil.es': '西班牙语', 'dil.ru': '俄语', 'dil.zh': '中文', 'dil.pt': '葡萄牙语', 'dil.ar': '阿拉伯语', 'nav.sosyal': '社交', 'nav.piyasalar': '市场', 'nav.yatirim': '投资', 'nav.portfoy': '投资组合', 'nav.harcama': '支出', 'nav.teknik': '技术分析', 'nav.kredi': '贷款', 'nav.haber': '新闻', 'nav.menu': '菜单', 'nav.giris': '登录', 'nav.uyeol': '注册', 'social.profil': '个人资料', 'social.ana': '首页', 'social.kisi': '找人', 'social.bildirim': '通知', 'social.mesaj': '消息', 'social.yorum': '评论', 'social.yorumYaz': '写评论', 'social.yorumlarim': '我的评论', 'social.begendik': '喜欢', 'social.foto': '照片', 'social.video': '视频', 'social.favori': '收藏', 'social.forum': '论坛', 'social.kariyer': '职业', 'social.toplanti': '会议', 'social.canli': '直播', 'social.ayarlar': '设置', 'auth.title': '登录', 'auth.subtitle': '使用您的账户登录。', 'auth.username': '用户名', 'auth.email': '电子邮件', 'auth.password': '密码', 'auth.password2': '确认密码', 'auth.robot': '我不是机器人', 'auth.submit': '登录', 'auth.google': '使用 Google 登录', 'auth.toggle': '没有账户？', 'auth.register': '注册' },
            pt: { ayarlar: 'Definições', 'ayarlar.sifre': 'Alterar senha', 'ayarlar.dil.menu': 'Idioma', 'ayarlar.gorunum': 'Aparência', 'ayarlar.uye': 'Número de membros do site', 'ayarlar.sifre.baslik': 'Alterar senha', 'ayarlar.sifre.desc': 'Atualize sua senha.', 'ayarlar.sifre.mevcut': 'Senha atual:', 'ayarlar.sifre.yeni': 'Nova senha:', 'ayarlar.sifre.tekrar': 'Confirmar:', 'common.kaydet': 'Guardar', 'ayarlar.dil.baslik': 'Idioma', 'ayarlar.dil.desc': 'O site será exibido no idioma selecionado.', 'dil.en': 'Inglês', 'dil.de': 'Alemão', 'dil.it': 'Italiano', 'dil.fr': 'Francês', 'dil.es': 'Espanhol', 'dil.ru': 'Russo', 'dil.zh': 'Chinês', 'dil.pt': 'Português', 'dil.ar': 'Árabe', 'nav.sosyal': 'REDE SOCIAL', 'nav.piyasalar': 'MERCADOS', 'nav.yatirim': 'INVESTIR', 'nav.portfoy': 'PORTFÓLIO', 'nav.harcama': 'DESPESAS', 'nav.teknik': 'ANÁLISE TÉCNICA', 'nav.kredi': 'CRÉDITOS', 'nav.haber': 'NOTÍCIAS', 'nav.menu': 'MENU', 'nav.giris': 'ENTRAR', 'nav.uyeol': 'REGISTAR', 'social.profil': 'Perfil', 'social.ana': 'Início', 'social.kisi': 'Encontrar pessoas', 'social.bildirim': 'Notificações', 'social.mesaj': 'Mensagens', 'social.yorum': 'Comentários', 'social.yorumYaz': 'Escrever comentário', 'social.yorumlarim': 'Meus comentários', 'social.begendik': 'Gostei', 'social.foto': 'Fotos', 'social.video': 'Vídeos', 'social.favori': 'Favoritos', 'social.forum': 'Fórum', 'social.kariyer': 'Carreira', 'social.toplanti': 'Reuniões', 'social.canli': 'Ao vivo', 'social.ayarlar': 'Definições', 'auth.title': 'Entrar', 'auth.subtitle': 'Entre com a sua conta.', 'auth.username': 'Utilizador', 'auth.email': 'Email', 'auth.password': 'Senha', 'auth.password2': 'Confirmar', 'auth.robot': 'Não sou um robot', 'auth.submit': 'ENTRAR', 'auth.google': 'Entrar com Google', 'auth.toggle': 'Não tem conta?', 'auth.register': 'Registar', 'auth.submitRegister': 'REGISTAR' },
            ar: { ayarlar: 'الإعدادات', 'ayarlar.sifre': 'تغيير كلمة المرور', 'ayarlar.dil.menu': 'اللغة', 'ayarlar.gorunum': 'مظهر الموقع', 'ayarlar.uye': 'عدد أعضاء الموقع', 'ayarlar.sifre.baslik': 'تغيير كلمة المرور', 'ayarlar.sifre.desc': 'قم بتحديث كلمة المرور التي استخدمتها عند التسجيل.', 'ayarlar.sifre.mevcut': 'كلمة المرور الحالية:', 'ayarlar.sifre.yeni': 'كلمة المرور الجديدة:', 'ayarlar.sifre.tekrar': 'تأكيد كلمة المرور:', 'common.kaydet': 'حفظ', 'ayarlar.dil.baslik': 'خيارات اللغة', 'ayarlar.dil.desc': 'بعد الحفظ سيتم عرض الموقع بالكامل باللغة التي تختارها.', 'dil.en': 'الإنجليزية', 'dil.de': 'الألمانية', 'dil.it': 'الإيطالية', 'dil.fr': 'الفرنسية', 'dil.es': 'الإسبانية', 'dil.ru': 'الروسية', 'dil.zh': 'الصينية', 'dil.pt': 'البرتغالية', 'dil.ar': 'العربية', 'nav.sosyal': 'الشبكة الاجتماعية', 'nav.piyasalar': 'الأسواق', 'nav.yatirim': 'إضافة استثمار', 'nav.portfoy': 'محفظتي', 'nav.harcama': 'مصروفاتي', 'nav.teknik': 'التحليل الفني', 'nav.kredi': 'القروض', 'nav.haber': 'الأخبار', 'nav.menu': 'القائمة', 'nav.giris': 'تسجيل الدخول', 'nav.uyeol': 'إنشاء حساب', 'social.profil': 'ملفي الشخصي', 'social.ana': 'الصفحة الرئيسية', 'social.kisi': 'البحث عن شخص', 'social.bildirim': 'الإشعارات', 'social.mesaj': 'رسائلي', 'social.yorum': 'التعليقات', 'social.yorumYaz': 'اكتب تعليقاً', 'social.yorumlarim': 'تعليقاتي', 'social.begendik': 'إعجابي', 'social.foto': 'صوري', 'social.video': 'فيديوهاتي', 'social.favori': 'المفضلة', 'social.forum': 'المنتدى', 'social.kariyer': 'مسيرتي المهنية', 'social.toplanti': 'اجتماعاتي', 'social.canli': 'البث المباشر', 'social.ayarlar': 'الإعدادات', 'auth.title': 'تسجيل الدخول', 'auth.subtitle': 'سجّل الدخول بحساب FinansSepeti الخاص بك.', 'auth.username': 'اسم المستخدم', 'auth.email': 'البريد الإلكتروني', 'auth.password': 'كلمة المرور', 'auth.password2': 'تأكيد كلمة المرور', 'auth.robot': 'لستُ برنامجاً آلياً', 'auth.submit': 'تسجيل الدخول', 'auth.google': 'تسجيل الدخول بواسطة Google', 'auth.toggle': 'ليس لديك حساب؟', 'auth.register': 'إنشاء حساب', 'auth.submitRegister': 'إنشاء حساب' }
        };
        if (window.I18N_EXTRA) { for (var lang in window.I18N_EXTRA) { if (!siteTranslations[lang]) siteTranslations[lang] = {}; for (var key in window.I18N_EXTRA[lang]) siteTranslations[lang][key] = window.I18N_EXTRA[lang][key]; } }
        window.siteTranslations = siteTranslations;
        function getSiteLang() { try { return localStorage.getItem('siteLang') || 'tr'; } catch (e) { return 'tr'; } }
        function setSiteLang(lang) { try { localStorage.setItem('siteLang', lang); } catch (e) {} }
        function getTranslationValue(lang, key) {
            if (!key) return '';
            if (siteTranslations[lang] && siteTranslations[lang][key]) return siteTranslations[lang][key];
            if (siteTranslations.en && siteTranslations.en[key]) return siteTranslations.en[key];
            if (siteTranslations.tr && siteTranslations.tr[key]) return siteTranslations.tr[key];
            return '';
        }
        function applyLanguage(lang) {
            if (!siteTranslations[lang]) lang = 'tr';
            document.documentElement.lang = lang;
            document.documentElement.dir = (lang === 'ar' ? 'rtl' : 'ltr');
            document.querySelectorAll('[data-i18n]').forEach(function(el) {
                var k = el.getAttribute('data-i18n');
                if (!k) return;
                var t = getTranslationValue(lang, k);
                if (t) el.textContent = t;
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
                var k = el.getAttribute('data-i18n-placeholder');
                if (!k) return;
                var t = getTranslationValue(lang, k);
                if (t) el.placeholder = t;
            });
            document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
                var k = el.getAttribute('data-i18n-title');
                if (!k) return;
                var t = getTranslationValue(lang, k);
                if (t) el.title = t;
            });
            var toggleBtn = document.getElementById('authToggleBtn');
            var authTitle = document.getElementById('authTitle');
            var authSubmitBtn = document.getElementById('authSubmitBtn');
            if (toggleBtn && siteTranslations[lang]) toggleBtn.textContent = siteTranslations[lang]['auth.register'];
            if (currentAuthMode === 'login' && authTitle && siteTranslations[lang]) { authTitle.textContent = siteTranslations[lang]['auth.title']; if (authSubmitBtn) authSubmitBtn.textContent = siteTranslations[lang]['auth.submit']; }
            if (currentAuthMode === 'register' && authTitle && siteTranslations[lang]) { authTitle.textContent = siteTranslations[lang]['auth.register']; if (authSubmitBtn) authSubmitBtn.textContent = (siteTranslations[lang]['auth.submitRegister'] || 'SIGN UP'); }
            document.querySelectorAll('.header-lang-flag-item').forEach(function(el) { el.classList.remove('selected'); if (el.getAttribute('data-lang') === lang) el.classList.add('selected'); });
        }
        var ayarlarSelectedLang = null;
        function ayarlarDilSec(lang) {
            ayarlarSelectedLang = lang;
            document.querySelectorAll('.ayarlar-dil-item').forEach(function(el) { el.classList.remove('selected'); if (el.getAttribute('data-lang') === lang) el.classList.add('selected'); });
            document.querySelectorAll('.header-lang-flag-item').forEach(function(el) { el.classList.remove('selected'); if (el.getAttribute('data-lang') === lang) el.classList.add('selected'); });
        }
        function ayarlarDilKaydet() {
            var msgEl = document.getElementById('ayarlarDilMesaj');
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'ayarlar-dil-mesaj'; }
            var lang = ayarlarSelectedLang || getSiteLang();
            setSiteLang(lang);
            applyLanguage(lang);
            if (msgEl) { msgEl.textContent = (lang === 'tr' ? 'Dil kaydedildi.' : (siteTranslations[lang] && siteTranslations[lang]['common.kaydet']) ? 'Saved.' : 'Dil kaydedildi.'); msgEl.className = 'ayarlar-dil-mesaj success'; }
        }
        window.ayarlarDilSec = ayarlarDilSec;
        window.ayarlarDilKaydet = ayarlarDilKaydet;
        window.applyLanguage = applyLanguage;
        window.getSiteLang = getSiteLang;

        function openLangPopup() {
            ayarlarDilSec(getSiteLang());
            var popup = document.getElementById('langPopup');
            if (popup) { popup.classList.add('open'); popup.setAttribute('aria-hidden', 'false'); }
        }
        function closeLangPopup() {
            var popup = document.getElementById('langPopup');
            if (popup) { popup.classList.remove('open'); popup.setAttribute('aria-hidden', 'true'); }
        }
        function langPopupKaydet() {
            ayarlarDilKaydet();
            if (typeof showToast === 'function') showToast('Dil kaydedildi.');
            closeLangPopup();
        }
        window.openLangPopup = openLangPopup;
        window.closeLangPopup = closeLangPopup;
        window.langPopupKaydet = langPopupKaydet;

        function kiyaslaUpdateCategoryOptions(tabName) {
            var select = document.getElementById('kiyaslaVarlikKategori');
            var label = document.getElementById('kiyaslaVarlikKategoriLabel');
            if (!select || !label) return;
            var isAsset = String(tabName || 'ev-araba-arsa') === 'yatirim';
            var title = isAsset ? 'Varlık Türü' : 'Gayrimenkul Türü';
            var list = isAsset
                ? ['Televizyon', 'Cep Telefonu', 'Beyaz Eşya', 'Salon Takımı', 'Yatak Odası Takımı', 'Ev Tadilatı', 'Bilgisayar', 'Çocuk Odası Takımı', 'Oturma Odası Takımı']
                : ['Ev', 'Arsa', 'Tarla', 'Araç Taşıt'];
            var prev = select.value || '';
            label.textContent = title;
            select.innerHTML = list.map(function(v) { return '<option value="' + v.replace(/"/g, '&quot;') + '">' + v + '</option>'; }).join('');
            if (prev && list.indexOf(prev) !== -1) select.value = prev;
        }

        function kiyaslaCollectTableRows() {
            var rows = document.querySelectorAll('.kiyasla-table-rows .kiyasla-row');
            var out = [];
            rows.forEach(function(row) {
                var ad = (row.querySelector('.col-varlik') && row.querySelector('.col-varlik').textContent || '').trim();
                var p = (row.querySelector('.col-ana-para') && row.querySelector('.col-ana-para').value || '').trim();
                var k = (row.querySelector('.col-getiri') && row.querySelector('.col-getiri').value || '').trim();
                var t = (row.querySelector('.col-toplam') && row.querySelector('.col-toplam').value || '').trim();
                out.push([ad, p, k, t]);
            });
            return out;
        }

        function kiyaslaExportExcel() {
            try {
                var header = ['Varlık', 'Peşinat Getirisi', 'Kredi Getirisi', 'Toplam Tutar'];
                var rows = kiyaslaCollectTableRows();
                var csv = [header.join(';')].concat(rows.map(function(r) { return r.join(';'); })).join('\n');
                var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                var a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'kiyasla-raporu-' + new Date().toISOString().slice(0, 10) + '.csv';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
            } catch (e) {
                alert('Excel indirme hatası: ' + (e.message || ''));
            }
        }

        function kiyaslaExportPDF() {
            try {
                ensurePdfMakeLoaded().then(function() {
                    if (!window.pdfMake || !window.pdfMake.createPdf) {
                        throw new Error('PDF motoru yüklenemedi.');
                    }
                    var rows = kiyaslaCollectTableRows();
                    function val(id) {
                        var el = document.getElementById(id);
                        return (el && (el.value != null ? String(el.value) : '').trim()) || '';
                    }
                    function activeTabLabel() {
                        var t = document.querySelector('.kiyasla-tab.kiyasla-tab-active');
                        var name = t && t.getAttribute('data-tab');
                        if (name === 'yatirim') return 'Varlık Karşılaştırma';
                        return 'Gayrimenkul Satın Alma';
                    }

                    var formBody = [
                        [{ text: 'Alan', bold: true, fillColor: '#182244', color: '#ffffff' }, { text: 'Değer', bold: true, fillColor: '#182244', color: '#ffffff' }],
                        ['Başlık', activeTabLabel()],
                        ['Peşinat Tutarı', val('kiyaslaPesinatTutar')],
                        ['Peşinat Tarihi', val('kiyaslaPesinatTarih')],
                        ['Aylık Kredi Taksit Tutarı', val('kiyaslaKrediTutar')],
                        ['İlk Taksit Tarihi', val('kiyaslaKrediTarih')],
                        ['Vade (Ay)', val('kiyaslaTaksitSayisi')],
                        ['Kıyas Tarihi', val('kiyaslaKiyasTarih')],
                        ['Toplam Tutar', val('kiyaslaToplamTutar')]
                    ];

                    var tableBody = [[
                        { text: 'Varlık', bold: true, fillColor: '#182244', color: '#ffffff' },
                        { text: 'Peşinat Getirisi', bold: true, fillColor: '#182244', color: '#ffffff' },
                        { text: 'Kredi Getirisi', bold: true, fillColor: '#182244', color: '#ffffff' },
                        { text: 'Toplam Tutar', bold: true, fillColor: '#182244', color: '#ffffff' }
                    ]];
                    rows.forEach(function(r) { tableBody.push([r[0] || '-', r[1] || '-', r[2] || '-', r[3] || '-']); });

                    var docDefinition = {
                        pageSize: 'A4',
                        pageOrientation: 'landscape',
                        pageMargins: [24, 24, 24, 24],
                        content: [
                            { text: 'Kıyasla Raporu', style: 'title' },
                            { text: ' ', margin: [0, 2] },
                            {
                                table: { headerRows: 1, widths: ['35%', '65%'], body: formBody },
                                layout: 'lightHorizontalLines'
                            },
                            { text: ' ', margin: [0, 6] },
                            {
                                table: { headerRows: 1, widths: ['28%', '24%', '24%', '24%'], body: tableBody },
                                layout: 'lightHorizontalLines'
                            }
                        ],
                        defaultStyle: { font: 'Roboto', fontSize: 10 },
                        styles: { title: { fontSize: 16, bold: true } }
                    };

                    window.pdfMake.createPdf(docDefinition).download('kiyasla-raporu-' + new Date().toISOString().slice(0, 10) + '.pdf');
                }).catch(function(err) {
                    alert('PDF indirme hatası: ' + (err && err.message ? err.message : ''));
                });
            } catch (e) {
                alert('PDF indirme hatası: ' + (e.message || ''));
            }
        }
        try { window.kiyaslaExportExcel = kiyaslaExportExcel; window.kiyaslaExportPDF = kiyaslaExportPDF; } catch (e) {}

        // Kıyasla modal aç/kapat
        window.openKiyaslaModal = function() {
            var m = document.getElementById('kiyaslaModal');
            if (!m) return;
            m.style.display = 'flex';
            m.classList.add('open');
            m.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
            // Modal açılışında eski/önbellekli hata metnini temizle.
            try { kiyaslaShowMesaj('', ''); } catch (e) {}
            kiyaslaUpdateCategoryOptions('ev-araba-arsa');
        };
        window.closeKiyaslaModal = function() {
            var m = document.getElementById('kiyaslaModal');
            if (!m) return;
            m.style.display = 'none';
            m.classList.remove('open');
            m.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        };

        document.addEventListener('click', function(ev) {
            var tab = ev.target.closest && ev.target.closest('.kiyasla-tab');
            if (!tab) return;
            var tabName = tab.getAttribute('data-tab');
            document.querySelectorAll('.kiyasla-tab').forEach(function(btn) {
                btn.classList.remove('kiyasla-tab-active');
            });
            tab.classList.add('kiyasla-tab-active');
            kiyaslaUpdateCategoryOptions(tabName);
            document.querySelectorAll('.kiyasla-section').forEach(function(sec) {
                var secKey = sec.getAttribute('data-section');
                var showMain = (tabName === 'ev-araba-arsa' || tabName === 'yatirim');
                if (secKey === 'ev-araba-arsa' && showMain) {
                    sec.style.display = '';
                } else {
                    sec.style.display = 'none';
                }
            });
        });

        // Kıyasla sayı alanlarında binlik ayırıcı (nokta) formatı
        document.addEventListener('input', function (ev) {
            var inp = ev.target;
            if (!inp.classList || !inp.classList.contains('kiyasla-number')) return;
            var raw = inp.value.replace(/\D/g, '');
            if (!raw) { inp.value = ''; return; }
            var parts = [];
            while (raw.length > 3) {
                parts.unshift(raw.slice(-3));
                raw = raw.slice(0, -3);
            }
            if (raw) parts.unshift(raw);
            inp.value = parts.join('.');
        });

        function kiyaslaParseNumber(str) {
            if (!str) return 0;
            var raw = String(str).replace(/\D/g, '');
            if (!raw) return 0;
            return parseFloat(raw);
        }

        function kiyaslaFormatTL(val) {
            if (!isFinite(val)) return '';
            var n = Math.round(val);
            var s = String(Math.abs(n));
            var parts = [];
            while (s.length > 3) {
                parts.unshift(s.slice(-3));
                s = s.slice(0, -3);
            }
            if (s) parts.unshift(s);
            var out = parts.join('.');
            if (n < 0) out = '-' + out;
            return out;
        }

        function kiyaslaBuildCashflows() {
            var pesinatTutar = kiyaslaParseNumber(document.getElementById('kiyaslaPesinatTutar') && document.getElementById('kiyaslaPesinatTutar').value);
            var krediTutar = kiyaslaParseNumber(document.getElementById('kiyaslaKrediTutar') && document.getElementById('kiyaslaKrediTutar').value);
            var krediYokEl = document.getElementById('kiyaslaKrediYok');
            var krediYok = !!(krediYokEl && krediYokEl.checked);
            var taksitSayisiEl = document.getElementById('kiyaslaTaksitSayisi');
            var pesinatTarihEl = document.getElementById('kiyaslaPesinatTarih');
            var krediTarihEl = document.getElementById('kiyaslaKrediTarih');
            var kiyasTarihEl = document.getElementById('kiyaslaKiyasTarih');
            if (!pesinatTutar || !taksitSayisiEl || !pesinatTarihEl || !kiyasTarihEl) return null;
            var taksitSayisi = parseInt(taksitSayisiEl.value || '0', 10) || 0;
            var pesinatTarih = pesinatTarihEl.value;
            var ilkTaksitTarih = krediTarihEl && krediTarihEl.value;
            var kiyasTarih = kiyasTarihEl.value;
            if (!pesinatTarih || !kiyasTarih) return null;
            if (!krediYok && (!krediTutar || !ilkTaksitTarih || !taksitSayisi)) return null;

            function addMonths(dateStr, m) {
                var src = String(dateStr || '');
                var mt = src.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if (!mt) return src;
                var y = parseInt(mt[1], 10);
                var mo = parseInt(mt[2], 10);
                var da = parseInt(mt[3], 10);
                var totalMonths = (y * 12 + (mo - 1)) + (parseInt(m, 10) || 0);
                var targetY = Math.floor(totalMonths / 12);
                var targetM = (totalMonths % 12) + 1;
                var lastDay = new Date(targetY, targetM, 0).getDate();
                var targetD = Math.min(da, lastDay);
                return String(targetY).padStart(4, '0') + '-' + String(targetM).padStart(2, '0') + '-' + String(targetD).padStart(2, '0');
            }

            var flows = [];
            flows.push({ date: pesinatTarih, amount: pesinatTutar });
            if (!krediYok) {
                for (var i = 0; i < taksitSayisi; i++) {
                    var d = addMonths(ilkTaksitTarih, i);
                    if (d > kiyasTarih) break;
                    flows.push({ date: d, amount: krediTutar });
                }
            }
            return { flows: flows, kiyasTarih: kiyasTarih, toplamTutar: krediYok ? pesinatTutar : (pesinatTutar + (krediTutar * taksitSayisi)), krediYok: krediYok };
        }

        function kiyaslaFillToplamTutar(calc) {
            var inp = document.getElementById('kiyaslaToplamTutar');
            if (!inp || !calc) return;
            inp.value = kiyaslaFormatTL(calc.toplamTutar);
        }

        // Kıyasla – API ile peşinat getirisi / kredi getirisi hesaplatıp tabloyu doldur
        function kiyaslaT(key, fallback) {
            var lang = (typeof getSiteLang === 'function' ? getSiteLang() : 'tr');
            var t = (typeof getTranslationValue === 'function') ? getTranslationValue(lang, key) : '';
            return t || fallback || key;
        }
        function kiyaslaShowMesaj(text, type) {
            var el = document.getElementById('kiyaslaMesaj');
            if (!el) return;
            // Bu uyarı hiçbir koşulda görünmesin.
            var t = String(text || '').toLowerCase();
            if (
                t.indexOf('eksik veya geçersiz') !== -1 ||
                t.indexOf('missing or invalid') !== -1 ||
                t.indexOf('ungültig') !== -1 ||
                t.indexOf('manquants ou invalides') !== -1 ||
                t.indexOf('faltan o son inválidos') !== -1 ||
                t.indexOf('неверно') !== -1 ||
                t.indexOf('缺失或无效') !== -1 ||
                t.indexOf('em falta ou inválidos') !== -1 ||
                t.indexOf('ناقصة أو غير صالحة') !== -1
            ) {
                text = '';
                type = '';
            }
            el.textContent = text || '';
            el.className = 'kiyasla-mesaj' + (type ? ' kiyasla-' + type : '');
            el.style.display = text ? 'block' : 'none';
        }
        // Inline onclick ve farklı scope durumları için global'e bağla
        try { window.kiyaslaShowMesaj = kiyaslaShowMesaj; } catch (e) {}
        async function kiyaslaFetchData(silentInvalid) {
            try { window.__kiyaslaLastClickAt = Date.now(); } catch (e) {}
            var calc = kiyaslaBuildCashflows();
            if (!calc) {
                kiyaslaShowMesaj('', '');
                return;
            }
            kiyaslaFillToplamTutar(calc);

            var flows = calc.flows || [];
            var pesinatTarih = document.getElementById('kiyaslaPesinatTarih') && document.getElementById('kiyaslaPesinatTarih').value;
            var krediTarih = document.getElementById('kiyaslaKrediTarih') && document.getElementById('kiyaslaKrediTarih').value;
            var kiyasTarih = document.getElementById('kiyaslaKiyasTarih') && document.getElementById('kiyaslaKiyasTarih').value;
            var taksitSayisi = parseInt(document.getElementById('kiyaslaTaksitSayisi') && document.getElementById('kiyaslaTaksitSayisi').value || '0', 10) || 0;
            var krediYok = !!(calc && calc.krediYok);

            if (!flows.length || !pesinatTarih || !kiyasTarih || (!krediYok && (!krediTarih || !taksitSayisi))) {
                kiyaslaApplyManualPrices(calc, null);
                kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.missingFields', 'Peşinat, kredi ve kıyas tarihleri ile taksit sayısını doldurun.'), 'error');
                return;
            }
            function kiyaslaParseDateAny(s) {
                if (!s) return null;
                // YYYY-MM-DD
                if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
                // DD.MM.YYYY
                var m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                if (m) return new Date(m[3] + '-' + m[2] + '-' + m[1] + 'T00:00:00');
                // fallback
                var d = new Date(s);
                return isNaN(d.getTime()) ? null : d;
            }
            function kiyaslaToYmd(s) {
                var d = kiyaslaParseDateAny(s);
                if (!d) return s;
                var y = d.getFullYear();
                var mo = String(d.getMonth() + 1).padStart(2, '0');
                var da = String(d.getDate()).padStart(2, '0');
                return y + '-' + mo + '-' + da;
            }

            var pD = kiyaslaParseDateAny(pesinatTarih);
            var kD = krediYok ? pD : kiyaslaParseDateAny(krediTarih);
            var qD = kiyaslaParseDateAny(kiyasTarih);
            if (!pD || !kD || !qD) {
                kiyaslaApplyManualPrices(calc, null);
                kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.badDate', 'Tarih formatı hatalı. YYYY-MM-DD veya DD.MM.YYYY girin.'), 'error');
                return;
            }
            var dateMin = (kD < pD) ? krediTarih : pesinatTarih;
            // API her zaman Y-m-d alsın
            var startYmd = kiyaslaToYmd(dateMin);
            var endYmd = kiyaslaToYmd(kiyasTarih);
            var pesinatYmd = kiyaslaToYmd(pesinatTarih);
            var krediYmd = krediYok ? pesinatYmd : kiyaslaToYmd(krediTarih);

            var btn = document.getElementById('kiyaslaHesaplaBtn');
            if (btn) { btn.disabled = true; }
            kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.loading', 'Hesaplanıyor…'), 'loading');

            var baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '') + '/';
            var apiUrl = baseUrl + 'api-kiyasla-data.php?start=' + encodeURIComponent(startYmd) + '&end=' + encodeURIComponent(endYmd) +
                '&pesinat_tutar=' + encodeURIComponent(calc.flows[0].amount) + '&pesinat_tarih=' + encodeURIComponent(pesinatYmd) +
                '&kredi_tutar=' + encodeURIComponent(krediYok ? 0 : (flows.length > 1 ? flows[1].amount : 0)) + '&kredi_tarih=' + encodeURIComponent(krediYmd) +
                '&taksit_sayisi=' + encodeURIComponent(krediYok ? 0 : taksitSayisi) + '&kiyas_tarih=' + encodeURIComponent(endYmd);
            try { window.__kiyaslaLastApiUrl = apiUrl; } catch (e) {}
            try {
                var res = await fetch(apiUrl);
                var text = await res.text();
                var data = null;
                try { data = JSON.parse(text); } catch (parseErr) {
                    kiyaslaApplyManualPrices(calc, null);
                    kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.apiNotJson', 'API yanıtı JSON değil') + ' (HTTP ' + res.status + '). ' + apiUrl, 'error');
                    if (btn) { btn.disabled = false; }
                    return;
                }
                if (data && data.rows && data.rows.length >= 9) {
                    // En az bir varlıkta gerçek hesap sonucu var mı?
                    var hasAnyValue = false;
                    try {
                        for (var i = 0; i < data.rows.length; i++) {
                            var r = data.rows[i] || {};
                            if ((r.toplam != null && isFinite(r.toplam) && r.toplam > 0) ||
                                (r.pesinatGetirisi != null && isFinite(r.pesinatGetirisi) && r.pesinatGetirisi > 0) ||
                                (r.krediGetirisi != null && isFinite(r.krediGetirisi) && r.krediGetirisi > 0)) {
                                hasAnyValue = true;
                                break;
                            }
                        }
                    } catch (e) {}

                    kiyaslaApplyManualPrices(calc, data.rows);
                    if (hasAnyValue) {
                        kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.done', 'Kıyaslama tamamlandı.'), 'ok');
                    } else {
                        var warnMsg = kiyaslaT('kiyasla.msg.allZero', 'Veriler çekilemedi (tüm satırlar 0 döndü).');
                        if (data && data.errors && typeof data.errors === 'object' && Object.keys(data.errors).length) {
                            warnMsg += ' ' + kiyaslaT('kiyasla.msg.errors', 'Hatalar:') + ' ' + JSON.stringify(data.errors);
                        }
                        kiyaslaShowMesaj(warnMsg + ' | ' + apiUrl, 'error');
                    }
                } else {
                    kiyaslaApplyManualPrices(calc, null);
                    var errMsg = (data && data.error) ? data.error : kiyaslaT('kiyasla.msg.noData', 'Veri alınamadı.');
                    if (data && data.errors && typeof data.errors === 'object' && Object.keys(data.errors).length) {
                        errMsg += ' ' + kiyaslaT('kiyasla.msg.errors', 'Hatalar:') + ' ' + JSON.stringify(data.errors);
                    }
                    kiyaslaShowMesaj(errMsg + ' | ' + apiUrl, 'error');
                }
            } catch (e) {
                kiyaslaApplyManualPrices(calc, null);
                kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.connection', 'Bağlantı hatası:') + ' ' + (e.message || kiyaslaT('kiyasla.msg.apiUnreachable', 'api-kiyasla-data.php erişilemiyor.')) + ' | ' + apiUrl, 'error');
            }
            if (btn) { btn.disabled = false; }
        }
        // Inline onclick için global'e bağla
        try { window.kiyaslaFetchData = kiyaslaFetchData; } catch (e) {}

        document.addEventListener('change', function(ev) {
            // Kullanıcı isteği: tarih seçilince otomatik hesaplama yapma.
            // Sadece "Kıyasla" butonuna basınca hesapla.
            var id = ev.target && ev.target.id;
            if (id === 'kiyaslaKrediYok') {
                kiyaslaToggleKrediYok();
            }
        });
        document.addEventListener('input', function(ev) {
            var id = ev.target && ev.target.id;
            if (id === 'kiyaslaKrediTutar' || id === 'kiyaslaKrediTarih' || id === 'kiyaslaTaksitSayisi') {
                var cb = document.getElementById('kiyaslaKrediYok');
                if (cb && cb.checked) {
                    kiyaslaToggleKrediYok();
                    ev.preventDefault();
                }
            }
        });
        document.addEventListener('click', function(ev) {
            var label = ev.target && ev.target.closest && ev.target.closest('.kiyasla-kredi-yok');
            if (label) {
                setTimeout(function() {
                    kiyaslaToggleKrediYok();
                }, 0);
            }
        });

        function kiyaslaToggleKrediYok() {
            var cb = document.getElementById('kiyaslaKrediYok');
            var krediInp = document.getElementById('kiyaslaKrediTutar');
            var krediTarihInp = document.getElementById('kiyaslaKrediTarih');
            var taksitSayisiInp = document.getElementById('kiyaslaTaksitSayisi');
            if (!cb || !krediInp) return;
            if (cb.checked) {
                krediInp.value = '';
                krediInp.disabled = true;
                krediInp.readOnly = true;
                krediInp.setAttribute('aria-disabled', 'true');
                if (krediTarihInp) {
                    krediTarihInp.value = '';
                    krediTarihInp.disabled = true;
                    krediTarihInp.readOnly = true;
                    krediTarihInp.setAttribute('aria-disabled', 'true');
                }
                if (taksitSayisiInp) {
                    taksitSayisiInp.value = '';
                    taksitSayisiInp.disabled = true;
                    taksitSayisiInp.readOnly = true;
                    taksitSayisiInp.setAttribute('aria-disabled', 'true');
                }
            } else {
                krediInp.disabled = false;
                krediInp.readOnly = false;
                krediInp.removeAttribute('aria-disabled');
                if (krediTarihInp) krediTarihInp.disabled = false;
                if (krediTarihInp) krediTarihInp.readOnly = false;
                if (krediTarihInp) krediTarihInp.removeAttribute('aria-disabled');
                if (taksitSayisiInp) taksitSayisiInp.disabled = false;
                if (taksitSayisiInp) taksitSayisiInp.readOnly = false;
                if (taksitSayisiInp) taksitSayisiInp.removeAttribute('aria-disabled');
            }
        }
        try { window.kiyaslaToggleKrediYok = kiyaslaToggleKrediYok; } catch (e) {}
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', kiyaslaToggleKrediYok);
        } else {
            kiyaslaToggleKrediYok();
        }

        function kiyaslaApplyManualPrices(calc, apiRows) {
            if (!calc) return;
            var krediYok = !!(calc && calc.krediYok);
            function fillRow(rowEl, hesap) {
                if (!rowEl) return;
                var anaInput = rowEl.querySelector('.col-ana-para');
                var getiriInput = rowEl.querySelector('.col-getiri');
                var toplamInput = rowEl.querySelector('.col-toplam');
                var pesinatVal = (hesap && hesap.pesinatGetirisi != null && isFinite(hesap.pesinatGetirisi)) ? Number(hesap.pesinatGetirisi) : 0;
                var krediVal = krediYok ? 0 : ((hesap && hesap.krediGetirisi != null && isFinite(hesap.krediGetirisi)) ? Number(hesap.krediGetirisi) : 0);
                var toplamVal = (hesap && hesap.toplam != null && isFinite(hesap.toplam))
                    ? Number(hesap.toplam)
                    : (krediYok ? pesinatVal : (pesinatVal + krediVal));
                if (anaInput) anaInput.value = hesap ? kiyaslaFormatTL(pesinatVal) : '';
                if (getiriInput) getiriInput.value = hesap ? kiyaslaFormatTL(krediVal) : '';
                if (toplamInput) toplamInput.value = hesap ? kiyaslaFormatTL(toplamVal) : '';
            }

            var rows = document.querySelectorAll('.kiyasla-table-rows .kiyasla-row');
            if (!rows || rows.length < 9) {
                kiyaslaShowMesaj(kiyaslaT('kiyasla.msg.rowsMissing', 'Tablo satırları bulunamadı (beklenen: 9). Sayfada HTML güncel mi?'), 'error');
                return;
            }

            rows.forEach(function(row, idx) {
                var hesap = (apiRows && apiRows[idx]) ? apiRows[idx] : null;
                fillRow(row, hesap);
            });
        }
        try { window.kiyaslaApplyManualPrices = kiyaslaApplyManualPrices; } catch (e) {}

        document.addEventListener('click', function(ev) {
            var wrap = ev.target.closest && ev.target.closest('#headerLangWrap');
            var item = ev.target.closest && ev.target.closest('.header-lang-flag-item');
            if (wrap || (item && item.getAttribute('data-lang'))) {
                ev.preventDefault();
                ev.stopPropagation();
                openLangPopup();
            }
        });
        document.addEventListener('keydown', function(ev) {
            if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('.header-lang-flag-item')) {
                var item = ev.target.closest('.header-lang-flag-item');
                if (item && item.getAttribute('data-lang')) { ev.preventDefault(); openLangPopup(); }
            }
        });

        document.addEventListener('keydown', function(ev) {
            if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('.ayarlar-dil-item')) {
                var item = ev.target.closest('.ayarlar-dil-item');
                if (item && item.getAttribute('data-lang')) { ev.preventDefault(); ayarlarDilSec(item.getAttribute('data-lang')); }
            }
        });
        function defaultGoogleReturnUrlShouldNavigate(retUrl) {
            if (!retUrl) return false;
            try {
                var pathOnly = (window.location.pathname || '/') + (window.location.search || '') + (window.location.hash || '');
                var full = (window.location && window.location.href) ? String(window.location.href) : '';
                return retUrl !== full && retUrl !== pathOnly;
            } catch (e) { return false; }
        }
        function userHasGoogleProvider(user) {
            if (!user || !user.providerData) return false;
            try {
                for (var i = 0; i < user.providerData.length; i++) {
                    if (user.providerData[i] && user.providerData[i].providerId === 'google.com') return true;
                }
            } catch (e) {}
            return false;
        }
        function finalizeGoogleRedirectLanding(user, shouldNavigateToReturnUrlFn) {
            if (!user) return;
            if (window.__fsGoogleRedirectFinalizeDone) return;
            try {
                updateAuthButtons(user);
                window.__fsGoogleRedirectFinalizeDone = true;
                var retUrl = getGoogleRedirectReturnUrl();
                clearGoogleRedirectInFlight();
                try { sessionStorage.removeItem('fs_ios_redirect_retry_reloaded_v2'); } catch (e0) {}
                try { if (typeof fsSetGoogleLoginUiBusy === 'function') fsSetGoogleLoginUiBusy(false); } catch (eB) {}
                try { sessionStorage.removeItem('fs_ios_post_auth_reloaded'); } catch (e1) {}
                if (shouldNavigateToReturnUrlFn && shouldNavigateToReturnUrlFn(retUrl)) {
                    window.location.replace(retUrl);
                    return;
                }
                var msg = document.getElementById('authMessage');
                if (msg) {
                    msg.className = 'auth-success';
                    msg.textContent = 'Google ile giriş başarılı. Hoş geldin: ' + (user.displayName || user.email || '');
                    msg.style.display = 'block';
                }
                setTimeout(function () { if (typeof closeAuthModal === 'function') closeAuthModal(); }, 500);
            } catch (e) {
                console.error(e);
                try { window.__fsGoogleRedirectFinalizeDone = false; } catch (e2) {}
            }
        }
        try {
            window.fsFinalizeGooglePopupLogin = function (user) {
                if (!user) return;
                try { if (typeof window.fsSetGoogleLoginUiBusy === 'function') window.fsSetGoogleLoginUiBusy(false); } catch (eB) {}
                try {
                    updateAuthButtons(user);
                    var msgP = document.getElementById('authMessage');
                    if (msgP) {
                        msgP.className = 'auth-success';
                        msgP.textContent = 'Google ile giriş başarılı. Hoş geldin: ' + (user.displayName || user.email || '');
                        msgP.style.display = 'block';
                    }
                    setTimeout(function () { if (typeof closeAuthModal === 'function') closeAuthModal(); }, 1200);
                } catch (e) { console.error(e); }
            };
        } catch (eF) {}
        function tryFinishGoogleRedirectFromAuthState() {
            if (window.__fsGoogleRedirectFinalizeDone) return;
            if (!hasGoogleRedirectInFlight()) return;
            var readyP = (typeof auth.authStateReady === 'function') ? auth.authStateReady() : Promise.resolve();
            readyP.then(function() { return auth.getRedirectResult(); }).then(function(result) {
                if (window.__fsGoogleRedirectFinalizeDone) return;
                if (result && result.user) {
                    finalizeGoogleRedirectLanding(result.user, defaultGoogleReturnUrlShouldNavigate);
                } else if (auth.currentUser && userHasGoogleProvider(auth.currentUser)) {
                    /* getRedirectResult ikinci çağrıda veya mobilde boş; oturum Google ise yine tamamla */
                    finalizeGoogleRedirectLanding(auth.currentUser, defaultGoogleReturnUrlShouldNavigate);
                }
            }).catch(function() {});
        }
        function tryFinishGoogleRedirectAfterPageRestore() {
            if (window.__fsGoogleRedirectFinalizeDone) return;
            if (!hasGoogleRedirectInFlight()) return;
            var ap = (typeof auth !== 'undefined' && auth && typeof auth.authStateReady === 'function') ? auth.authStateReady() : Promise.resolve();
            ap.then(function() {
                if (window.__fsGoogleRedirectFinalizeDone) return;
                var u = auth.currentUser;
                if (u && userHasGoogleProvider(u)) {
                    finalizeGoogleRedirectLanding(u, defaultGoogleReturnUrlShouldNavigate);
                }
            }).catch(function() {});
        }
        try {
            window.addEventListener('pageshow', function(ev) {
                setTimeout(tryFinishGoogleRedirectAfterPageRestore, 40);
                setTimeout(tryFinishGoogleRedirectAfterPageRestore, 450);
            });
            window.addEventListener('load', function() {
                setTimeout(tryFinishGoogleRedirectAfterPageRestore, 80);
                setTimeout(tryFinishGoogleRedirectAfterPageRestore, 700);
            });
        } catch (ePs) {}
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() {
            applyLanguage(getSiteLang());
            // Redirect akışı için "in flight" bayrağı kontrolü
            var hadRedirectFlag = hasGoogleRedirectInFlight();
            function currentUrlForRedirectCompare() {
                try {
                    return (window.location && window.location.href) ? String(window.location.href) : '';
                } catch (e) { return ''; }
            }
            function shouldNavigateToReturnUrl(retUrl) {
                if (!retUrl) return false;
                var pathOnly = (window.location.pathname || '/') + (window.location.search || '') + (window.location.hash || '');
                var full = currentUrlForRedirectCompare();
                return retUrl !== full && retUrl !== pathOnly;
            }
            var authReadyChain = (typeof auth.authStateReady === 'function') ? auth.authStateReady() : Promise.resolve();
            authReadyChain.then(function() { return auth.getRedirectResult(); }).then(function (result) {
                if (result && result.user) {
                    finalizeGoogleRedirectLanding(result.user, shouldNavigateToReturnUrl);
                } else if (auth.currentUser && userHasGoogleProvider(auth.currentUser) && (hasGoogleRedirectInFlight() || hadRedirectFlag)) {
                    /* Mobil: getRedirectResult boş; oturum ve Google sağlayıcı hazırsa tamamla (çerez/bayrak www-kök ile taşınabildi). */
                    finalizeGoogleRedirectLanding(auth.currentUser, shouldNavigateToReturnUrl);
                } else if (hadRedirectFlag) {
                    (function retryAuthState(attempt) {
                        setTimeout(function() {
                            try {
                                var u = auth.currentUser;
                                if (u && userHasGoogleProvider(u)) {
                                    finalizeGoogleRedirectLanding(u, shouldNavigateToReturnUrl);
                                    return;
                                }
                            } catch (e) {}
                            var maxTry = (isIosDevice() || isAndroidDevice()) ? 24 : 10;
                            if (attempt < maxTry) {
                                retryAuthState(attempt + 1);
                            } else if (isIosDevice() || isAndroidDevice()) {
                                try {
                                    if (!sessionStorage.getItem('fs_ios_redirect_retry_reloaded_v2')) {
                                        sessionStorage.setItem('fs_ios_redirect_retry_reloaded_v2', '1');
                                        window.location.reload();
                                        return;
                                    }
                                } catch (e2) {}
                            }
                        }, 400);
                    })(0);
                }
            }).catch(function (err) {
                console.error('Google redirect sonucu hata:', err);
                if (hasGoogleRedirectInFlight() && err && err.code === 'auth/account-exists-with-different-credential') {
                    clearGoogleRedirectInFlight();
                    var msgE = document.getElementById('authMessage');
                    if (msgE) {
                        msgE.className = 'auth-error';
                        msgE.textContent = 'Bu e-posta ile zaten üyeliğiniz var. E-posta ve şifre ile giriş yapın.';
                        msgE.style.display = 'block';
                    }
                }
            });
        });
        else {
            applyLanguage(getSiteLang());
            var hadRedirectFlag2 = hasGoogleRedirectInFlight();
            function currentUrlForRedirectCompare2() {
                try { return (window.location && window.location.href) ? String(window.location.href) : ''; } catch (e) { return ''; }
            }
            function shouldNavigate_toReturnUrl2(retUrl) {
                if (!retUrl) return false;
                var pathOnly = (window.location.pathname || '/') + (window.location.search || '') + (window.location.hash || '');
                var full = currentUrlForRedirectCompare2();
                return retUrl !== full && retUrl !== pathOnly;
            }
            var authReadyChain2 = (typeof auth.authStateReady === 'function') ? auth.authStateReady() : Promise.resolve();
            authReadyChain2.then(function() { return auth.getRedirectResult(); }).then(function (result) {
                if (result && result.user) {
                    finalizeGoogleRedirectLanding(result.user, shouldNavigate_toReturnUrl2);
                } else if (auth.currentUser && userHasGoogleProvider(auth.currentUser) && (hasGoogleRedirectInFlight() || hadRedirectFlag2)) {
                    finalizeGoogleRedirectLanding(auth.currentUser, shouldNavigate_toReturnUrl2);
                } else if (hadRedirectFlag2) {
                    (function retryAuthState2(attempt) {
                        setTimeout(function() {
                            try {
                                var u = auth.currentUser;
                                if (u && userHasGoogleProvider(u)) {
                                    finalizeGoogleRedirectLanding(u, shouldNavigate_toReturnUrl2);
                                    return;
                                }
                            } catch (e) {}
                            var maxTry2 = (isIosDevice() || isAndroidDevice()) ? 24 : 10;
                            if (attempt < maxTry2) {
                                retryAuthState2(attempt + 1);
                            } else if (isIosDevice() || isAndroidDevice()) {
                                try {
                                    if (!sessionStorage.getItem('fs_ios_redirect_retry_reloaded_v2')) {
                                        sessionStorage.setItem('fs_ios_redirect_retry_reloaded_v2', '1');
                                        window.location.reload();
                                        return;
                                    }
                                } catch (e2) {}
                            }
                        }, 400);
                    })(0);
                }
            }).catch(function (err) {
                console.error('Google redirect sonucu hata:', err);
                if (hasGoogleRedirectInFlight() && err && err.code === 'auth/account-exists-with-different-credential') {
                    clearGoogleRedirectInFlight();
                    var msgE2 = document.getElementById('authMessage');
                    if (msgE2) {
                        msgE2.className = 'auth-error';
                        msgE2.textContent = 'Bu e-posta ile zaten üyeliğiniz var. E-posta ve şifre ile giriş yapın.';
                        msgE2.style.display = 'block';
                    }
                }
            });
        }

        function showToast(msg) {
            var container = document.getElementById('toastContainer');
            if (!container) return;
            var el = document.createElement('div');
            el.className = 'toast-item';
            el.textContent = msg;
            container.appendChild(el);
            setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 2800);
        }

        function updateAuthButtons(user) {
            const loginBtn = document.getElementById('loginBtn');
            const registerBtn = document.getElementById('registerBtn');
            const logoutBtn = document.getElementById('logoutBtn');

            if (user) {
                if (loginBtn) loginBtn.style.display = 'none';
                if (registerBtn) registerBtn.style.display = 'none';
                if (logoutBtn) logoutBtn.style.display = 'inline-block';
            } else {
                if (loginBtn) loginBtn.style.display = 'inline-block';
                if (registerBtn) registerBtn.style.display = 'inline-block';
                if (logoutBtn) logoutBtn.style.display = 'none';
            }
        }

        function logout() {
            auth.signOut()
                .then(() => { console.log('Çıkış yapıldı'); })
                .catch(err => { console.error('Çıkış hatası:', err); });
        }

        function openAuthModal(mode) {
            currentAuthMode = mode || 'login';
            const modal = document.getElementById('authModal');
            if (!modal) return;
            const loginChoicePanel = document.getElementById('loginChoicePanel');
            const choicePanel = document.getElementById('authChoicePanel');
            const formWrap = document.getElementById('authFormWrap');
            const corporateWrap = document.getElementById('authCorporateFormWrap');
            const corporateLoginWrap = document.getElementById('authCorporateLoginWrap');
            const msg = document.getElementById('authMessage');

            if (msg) {
                msg.style.display = 'none';
                msg.textContent = '';
                msg.className = 'auth-error';
            }

            if (loginChoicePanel) loginChoicePanel.style.display = 'none';
            if (formWrap) formWrap.style.display = 'none';
            if (corporateWrap) corporateWrap.style.display = 'none';
            if (corporateLoginWrap) corporateLoginWrap.style.display = 'none';

            if (currentAuthMode === 'register') {
                if (choicePanel) choicePanel.style.display = 'block';
            } else {
                if (choicePanel) choicePanel.style.display = 'none';
                if (loginChoicePanel) loginChoicePanel.style.display = 'block';
            }

            modal.style.display = 'flex';
        }

        function backToLoginChoice() {
            document.getElementById('loginChoicePanel').style.display = 'block';
            document.getElementById('authFormWrap').style.display = 'none';
            var cl = document.getElementById('authCorporateLoginWrap');
            if (cl) cl.style.display = 'none';
        }
        window.backToLoginChoice = backToLoginChoice;
        window.showLoginForm = showLoginForm;

        function showLoginForm(type) {
            var loginChoicePanel = document.getElementById('loginChoicePanel');
            var formWrap = document.getElementById('authFormWrap');
            var corporateLoginWrap = document.getElementById('authCorporateLoginWrap');
            if (loginChoicePanel) loginChoicePanel.style.display = 'none';

            if (type === 'bireysel') {
                if (corporateLoginWrap) corporateLoginWrap.style.display = 'none';
                if (formWrap) formWrap.style.display = 'block';
                currentAuthMode = 'login';
                var title = document.getElementById('authTitle');
                var subtitle = document.getElementById('authSubtitle');
                var submitBtn = document.getElementById('authSubmitBtn');
                var toggleText = document.getElementById('authToggleText');
                var toggleBtn = document.getElementById('authToggleBtn');
                var usernameGroup = document.getElementById('usernameGroup');
                var emailGroup = document.getElementById('emailGroup');
                var password2Group = document.getElementById('password2Group');
                var robotGroup = document.getElementById('robotGroup');
                var rememberMeGroup = document.getElementById('rememberMeGroup');
                var kvkkGroupBireysel = document.getElementById('kvkkGroupBireysel');
                var googleBtnEl = document.getElementById('googleBtn');
                var backBtn = document.getElementById('authBackToLoginChoice');
                if (title) title.textContent = 'Giriş Yap';
                if (subtitle) subtitle.textContent = 'Kullanıcı adın (e-posta) ve şifrenle giriş yap.';
                if (submitBtn) submitBtn.textContent = 'GİRİŞ YAP';
                if (toggleText) toggleText.textContent = 'Hesabın yok mu?';
                if (toggleBtn) toggleBtn.textContent = 'Üye ol';
                if (usernameGroup) usernameGroup.style.display = 'none';
                if (emailGroup) emailGroup.querySelector('label').textContent = 'Kullanıcı Adı (E-mail)';
                if (password2Group) password2Group.style.display = 'none';
                if (robotGroup) robotGroup.style.display = 'block';
                if (rememberMeGroup) rememberMeGroup.style.display = 'block';
                if (kvkkGroupBireysel) kvkkGroupBireysel.style.display = 'block';
                if (googleBtnEl) googleBtnEl.style.display = 'block';
                if (backBtn) backBtn.style.display = 'block';
                document.getElementById('authUsername').value = '';
                document.getElementById('authPassword2').value = '';
                document.getElementById('authRobot').checked = false;
                var savedEmail = localStorage.getItem('finanssepeti_remember_email');
                if (savedEmail) document.getElementById('authEmail').value = savedEmail;
                else document.getElementById('authEmail').value = '';
                document.getElementById('authPassword').value = '';
                var rm = document.getElementById('authRememberMe');
                if (rm) rm.checked = !!savedEmail;
            } else {
                if (formWrap) formWrap.style.display = 'none';
                if (corporateLoginWrap) corporateLoginWrap.style.display = 'block';
                document.getElementById('authCorporateLoginUsername').value = '';
                document.getElementById('authCorporateLoginPassword').value = '';
                var savedCorp = localStorage.getItem('finanssepeti_remember_corporate_email');
                if (savedCorp) document.getElementById('authCorporateLoginUsername').value = savedCorp;
                document.getElementById('authCorporateRobot').checked = false;
                document.getElementById('authCorporateRememberMe').checked = !!savedCorp;
            }
        }

        function showAuthChoicePanel() {
            document.getElementById('authChoicePanel').style.display = 'block';
            document.getElementById('authFormWrap').style.display = 'none';
            var c = document.getElementById('authCorporateFormWrap');
            if (c) c.style.display = 'none';
        }

        function showAuthForm(type) {
            var choicePanel = document.getElementById('authChoicePanel');
            var formWrap = document.getElementById('authFormWrap');
            var corporateWrap = document.getElementById('authCorporateFormWrap');
            var backBtn = document.getElementById('authBackToLoginChoice');
            choicePanel.style.display = 'none';

            if (type === 'bireysel') {
                if (corporateWrap) corporateWrap.style.display = 'none';
                formWrap.style.display = 'block';
                currentAuthMode = 'register';
                var title = document.getElementById('authTitle');
                var subtitle = document.getElementById('authSubtitle');
                var submitBtn = document.getElementById('authSubmitBtn');
                var toggleText = document.getElementById('authToggleText');
                var toggleBtn = document.getElementById('authToggleBtn');
                var usernameGroup = document.getElementById('usernameGroup');
                var emailGroup = document.getElementById('emailGroup');
                var passwordGroup = document.getElementById('passwordGroup');
                var password2Group = document.getElementById('password2Group');
                var robotGroup = document.getElementById('robotGroup');
                var rememberMeGroup = document.getElementById('rememberMeGroup');
                var kvkkGroupBireysel = document.getElementById('kvkkGroupBireysel');
                var googleBtnEl = document.getElementById('googleBtn');
                title.textContent = 'Bireysel Üye Ol';
                subtitle.textContent = 'Kullanıcı adı, e-posta ve şifrenle yeni hesap oluştur.';
                submitBtn.textContent = 'ÜYE OL';
                toggleText.textContent = 'Zaten hesabın var mı?';
                toggleBtn.textContent = 'Giriş yap';
                usernameGroup.style.display = 'block';
                emailGroup.querySelector('label').textContent = 'E‑mail';
                passwordGroup.querySelector('label').textContent = 'Şifre Oluştur';
                password2Group.style.display = 'block';
                robotGroup.style.display = 'none';
                if (rememberMeGroup) rememberMeGroup.style.display = 'none';
                if (kvkkGroupBireysel) kvkkGroupBireysel.style.display = 'block';
                if (googleBtnEl) googleBtnEl.style.display = 'none';
                if (backBtn) backBtn.style.display = 'none';
                document.getElementById('authUsername').value = '';
                document.getElementById('authEmail').value = '';
                document.getElementById('authPassword').value = '';
                document.getElementById('authPassword2').value = '';
                document.getElementById('authKvkkBireysel').checked = false;
            } else {
                formWrap.style.display = 'none';
                if (corporateWrap) corporateWrap.style.display = 'block';
                if (backBtn) backBtn.style.display = 'none';
                document.getElementById('authFirmaKullanici').value = '';
                document.getElementById('authKurumsalEmail').value = '';
                document.getElementById('authSektor').value = '';
                document.getElementById('authVKN').value = '';
                document.getElementById('authKurumsalPassword').value = '';
                document.getElementById('authKurumsalPassword2').value = '';
                document.getElementById('authKvkkKurumsalRegister').checked = false;
            }
        }

        function closeAuthModal() {
            var m = document.getElementById('authModal');
            if (m) m.style.display = 'none';
        }

        window.openAuthModal = openAuthModal;
        window.closeAuthModal = closeAuthModal;
        window.showAuthForm = showAuthForm;
        window.showAuthChoicePanel = showAuthChoicePanel;
        window.logout = logout;

        function toggleAuthMode() {
            openAuthModal(currentAuthMode === 'login' ? 'register' : 'login');
        }
        window.toggleAuthMode = toggleAuthMode;

        function fsMainNavGuestBlockMessage() {
            return 'Üye olmadan işlem yapılmamaktadır.';
        }
        function attachMainNavLoginGuard() {
            var navEl = document.querySelector('main#main-content nav') || document.querySelector('nav');
            if (!navEl || navEl._fsNavLoginGuard) return;
            navEl._fsNavLoginGuard = true;
            navEl.addEventListener('click', function (e) {
                var btn = e.target && e.target.closest && e.target.closest('.nav-btn-3d');
                if (!btn || btn.id === 'navMenuBtn') return;
                var loggedIn = false;
                try {
                    loggedIn = !!(auth && auth.currentUser);
                } catch (err) { loggedIn = false; }
                if (loggedIn) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                alert(fsMainNavGuestBlockMessage());
            }, true);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', attachMainNavLoginGuard);
        } else {
            attachMainNavLoginGuard();
        }

        document.getElementById('authForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            const email = document.getElementById('authEmail').value.trim();
            const password = document.getElementById('authPassword').value;
            const password2 = document.getElementById('authPassword2').value;
            const username = document.getElementById('authUsername').value.trim();
            const robotChecked = document.getElementById('authRobot').checked;
            const rememberMe = document.getElementById('authRememberMe') && document.getElementById('authRememberMe').checked;
            const kvkkBireysel = document.getElementById('authKvkkBireysel') && document.getElementById('authKvkkBireysel').checked;
            const msg = document.getElementById('authMessage');
            const submitBtn = document.getElementById('authSubmitBtn');

            msg.style.display = 'none';
            msg.textContent = '';
            msg.className = 'auth-error';

            if (currentAuthMode === 'login') {
                if (!robotChecked) {
                    msg.textContent = 'Lütfen "Ben robot değilim" kutucuğunu işaretleyin.';
                    msg.style.display = 'block';
                    return;
                }
            } else {
                if (!username) {
                    msg.textContent = 'Kullanıcı adı alanı boş bırakılamaz.';
                    msg.style.display = 'block';
                    return;
                }
                if (password !== password2) {
                    msg.textContent = 'Şifre ve tekrar şifre aynı olmalıdır.';
                    msg.style.display = 'block';
                    return;
                }
                if (!kvkkBireysel) {
                    msg.textContent = 'Üye olmak için Gizlilik Politikası ve KVKK Aydınlatma Metni\'ni kabul etmeniz gerekmektedir.';
                    msg.style.display = 'block';
                    return;
                }
            }

            submitBtn.disabled = true;

            try {
                if (currentAuthMode === 'login') {
                    auth.setPersistence(rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION).catch(function() {});
                }
                let userCredential;
                if (currentAuthMode === 'login') {
                    userCredential = await auth.signInWithEmailAndPassword(email, password);
                    if (rememberMe) {
                        try { localStorage.setItem('finanssepeti_remember_email', email); } catch (e) {}
                        try {
                            var snap = await db.collection('userProfiles').where('userId', '==', userCredential.user.uid).limit(1).get();
                            if (!snap.empty) {
                                await snap.docs[0].ref.update({ rememberMe: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                            } else {
                                await db.collection('userProfiles').add({
                                    userId: userCredential.user.uid,
                                    email: email,
                                    rememberMe: true,
                                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                                });
                            }
                        } catch (er) { console.warn('Remember me db update:', er); }
                    } else {
                        try { localStorage.removeItem('finanssepeti_remember_email'); } catch (e) {}
                    }
                    msg.className = 'auth-success';
                    msg.textContent = 'Giriş başarılı. Hoş geldin: ' + (userCredential.user.email || '');
                } else {
                    userCredential = await auth.createUserWithEmailAndPassword(email, password);
                    if (username) {
                        await userCredential.user.updateProfile({ displayName: username });
                    }
                    try {
                        await db.collection('userProfiles').add({
                            userId: userCredential.user.uid,
                            username: username,
                            email: email,
                            kvkkAccepted: true,
                            kvkkAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                        });
                        if (typeof incrementTotalMemberCount === 'function') incrementTotalMemberCount();
                    } catch (er) { console.warn('Profil KVKK kayıt:', er); }
                    msg.className = 'auth-success';
                    msg.textContent = 'Üyelik başarıyla oluşturuldu. Artık giriş yapabilirsin.';
                }
                msg.style.display = 'block';
                setTimeout(() => { closeAuthModal(); }, 1500);
            } catch (err) {
                console.error(err);
                let text = 'İşlem sırasında hata oluştu.';
                var passLogin = String(password || '').replace(/\s/g, '');
                var loginUsedSixDigitCode = currentAuthMode === 'login' && /^\d{6}$/.test(passLogin);
                if (err.code === 'auth/email-already-in-use') text = 'Bu e‑posta ile zaten kayıt olunmış.';
                else if (err.code === 'auth/invalid-email') text = 'Geçerli bir e‑posta adresi gir.';
                else if (err.code === 'auth/weak-password') text = 'Şifre en az 6 karakter olmalı.';
                else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                    text = loginUsedSixDigitCode
                        ? 'E-postadaki 6 haneli kod, giriş şifreniz değildir. «Şifremi unuttum» sonrası gelen şifre sıfırlama bağlantısına tıklayıp yeni şifre oluşturun; girişte o yeni şifreyi kullanın.'
                        : 'E-posta veya şifre hatalı.';
                }
                msg.textContent = text;
                msg.style.display = 'block';
            } finally {
                submitBtn.disabled = false;
            }
        });

        var authCorporateFormEl = document.getElementById('authCorporateForm');
        if (authCorporateFormEl) {
            authCorporateFormEl.addEventListener('submit', async function (e) {
                e.preventDefault();
                var firmaKullanici = document.getElementById('authFirmaKullanici').value.trim();
                var kurumsalEmail = document.getElementById('authKurumsalEmail').value.trim();
                var sektor = document.getElementById('authSektor').value.trim();
                var vkn = document.getElementById('authVKN').value.trim();
                var password = document.getElementById('authKurumsalPassword').value;
                var password2 = document.getElementById('authKurumsalPassword2').value;
                var msg = document.getElementById('authMessage');
                var submitBtn = document.getElementById('authCorporateSubmitBtn');
                msg.style.display = 'none';
                msg.textContent = '';
                msg.className = 'auth-error';
                if (!firmaKullanici) { msg.textContent = 'Firma kullanıcı adı girin.'; msg.style.display = 'block'; return; }
                if (!kurumsalEmail) { msg.textContent = 'Kurumsal e-posta girin.'; msg.style.display = 'block'; return; }
                if (password !== password2) { msg.textContent = 'Şifre ve tekrar şifre aynı olmalıdır.'; msg.style.display = 'block'; return; }
                if (password.length < 6) { msg.textContent = 'Şifre en az 6 karakter olmalı.'; msg.style.display = 'block'; return; }
                var kvkkKurumsalReg = document.getElementById('authKvkkKurumsalRegister');
                if (kvkkKurumsalReg && !kvkkKurumsalReg.checked) { msg.textContent = 'Üye olmak için Gizlilik Politikası ve KVKK Aydınlatma Metni\'ni kabul etmeniz gerekmektedir.'; msg.style.display = 'block'; return; }
                submitBtn.disabled = true;
                try {
                    var userCredential = await auth.createUserWithEmailAndPassword(kurumsalEmail, password);
                    await userCredential.user.updateProfile({ displayName: firmaKullanici });
                    var data = {
                        userId: userCredential.user.uid,
                        username: firmaKullanici,
                        adSoyad: firmaKullanici,
                        email: kurumsalEmail,
                        sektor: sektor,
                        vkn: vkn,
                        memberType: 'corporate',
                        kvkkAccepted: true,
                        kvkkAcceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    await db.collection('userProfiles').add(data);
                    if (typeof incrementTotalMemberCount === 'function') incrementTotalMemberCount();
                    msg.className = 'auth-success';
                    msg.textContent = 'Kurumsal üyelik başarıyla oluşturuldu. Giriş yapabilirsiniz.';
                    msg.style.display = 'block';
                    setTimeout(function () { closeAuthModal(); }, 1500);
                } catch (err) {
                    console.error(err);
                    var text = 'İşlem sırasında hata oluştu.';
                    if (err.code === 'auth/email-already-in-use') text = 'Bu e-posta ile zaten kayıt olunmuş.';
                    else if (err.code === 'auth/invalid-email') text = 'Geçerli bir e-posta adresi girin.';
                    else if (err.code === 'auth/weak-password') text = 'Şifre en az 6 karakter olmalı.';
                    msg.textContent = text;
                    msg.style.display = 'block';
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        function setGoogleButtonsDisabled(disabled) {
            var b1 = document.getElementById('googleBtn');
            var b2 = document.getElementById('googleBtnCorporate');
            try { if (b1) b1.disabled = !!disabled; } catch (e) {}
            try { if (b2) b2.disabled = !!disabled; } catch (e2) {}
        }

        window.doGoogleLogin = async function () {
            // Çift tetiklenmeyi engelle (onclick + event listener vb.)
            if (window.__googleLoginInFlight) return;
            window.__googleLoginInFlight = true;

            const msg = document.getElementById('authMessage');
            if (msg) { msg.style.display = 'none'; msg.textContent = ''; msg.className = 'auth-error'; }
            setGoogleButtonsDisabled(true);

            try {
                // Mobilde redirect dönüşünde oturumun kaybolmaması için persistence'ı LOCAL yap.
                // (WebView / mobil tarayıcıda SESSION bazen geri dönüşte boş kalabiliyor.)
                try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e) {}

                // iOS Safari'de popup genelde sorunlu: redirect daha stabil.
                // WebView / uygulama ici tarayicida da redirect daha stabil.
                if (isIosDevice() || isAndroidDevice() || isFinansSepetiApp() || isLikelyInAppBrowser()) {
                    if (msg) {
                        msg.className = 'auth-success';
                        msg.textContent = 'Google girişi açılıyor…';
                        msg.style.display = 'block';
                    }
                    markGoogleRedirectInFlight();
                    await auth.signInWithRedirect(googleProvider);
                    return;
                }
                const result = await auth.signInWithPopup(googleProvider);
                if (msg) { msg.className = 'auth-success'; msg.textContent = 'Google ile giriş başarılı. Hoş geldin: ' + (result.user.displayName || result.user.email || ''); msg.style.display = 'block'; }
                updateAuthButtons(auth.currentUser);
                setTimeout(() => { closeAuthModal(); }, 1500);
            } catch (err) {
                console.error('Google giriş hatası:', err);
                if (msg) {
                    if (err && err.code === 'auth/popup-blocked') {
                        msg.textContent = 'Açılır pencere engellendi. Google giriş için yönlendirme ile tekrar deneyin.';
                    } else if (err && err.code === 'auth/operation-not-supported-in-this-environment') {
                        msg.textContent = 'Google girişi bu tarayıcı modunda desteklenmiyor. iPhone\'da Safari ile açıp tekrar deneyin.';
                    } else {
                        msg.textContent = err.message || 'Google ile giriş sırasında hata oluştu.';
                    }
                    msg.style.display = 'block';
                }
                // Popup engellendi veya bu ortam popup desteklemiyorsa redirect fallback.
                try {
                    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
                        try { await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL); } catch (e3) {}
                        markGoogleRedirectInFlight();
                        await auth.signInWithRedirect(googleProvider);
                        return;
                    }
                } catch (e2) {}
            } finally {
                window.__googleLoginInFlight = false;
                setGoogleButtonsDisabled(false);
            }
        };
        // Not: Google butonları zaten HTML'de onclick ile bağlı. Burada ikinci bir click listener eklemiyoruz.

        var authCorporateLoginFormEl = document.getElementById('authCorporateLoginForm');
        if (authCorporateLoginFormEl) {
            authCorporateLoginFormEl.addEventListener('submit', async function (e) {
                e.preventDefault();
                var firmaUser = document.getElementById('authCorporateLoginUsername').value.trim();
                var firmaPass = document.getElementById('authCorporateLoginPassword').value;
                var robotCorp = document.getElementById('authCorporateRobot').checked;
                var rememberCorp = document.getElementById('authCorporateRememberMe').checked;
                var msg = document.getElementById('authMessage');
                var submitBtn = document.getElementById('authCorporateLoginSubmitBtn');
                msg.style.display = 'none';
                msg.textContent = '';
                msg.className = 'auth-error';
                if (!robotCorp) { msg.textContent = 'Lütfen "Ben robot değilim" kutucuğunu işaretleyin.'; msg.style.display = 'block'; return; }
                if (!firmaUser || !firmaPass) { msg.textContent = 'Firma kullanıcı adı ve şifre girin.'; msg.style.display = 'block'; return; }
                submitBtn.disabled = true;
                try {
                    auth.setPersistence(rememberCorp ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION).catch(function() {});
                    var snap = await db.collection('userProfiles').where('memberType', '==', 'corporate').where('username', '==', firmaUser).limit(1).get();
                    if (snap.empty) { msg.textContent = 'Firma kullanıcı adı veya şifre hatalı.'; msg.style.display = 'block'; submitBtn.disabled = false; return; }
                    var email = snap.docs[0].data().email;
                    var userCredential = await auth.signInWithEmailAndPassword(email, firmaPass);
                    if (rememberCorp) {
                        try { localStorage.setItem('finanssepeti_remember_corporate_email', firmaUser); } catch (e) {}
                        try {
                            await snap.docs[0].ref.update({ rememberMe: true, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                        } catch (er) { console.warn('Remember me corporate:', er); }
                    } else {
                        try { localStorage.removeItem('finanssepeti_remember_corporate_email'); } catch (e) {}
                    }
                    msg.className = 'auth-success';
                    msg.textContent = 'Giriş başarılı. Hoş geldiniz.';
                    msg.style.display = 'block';
                    setTimeout(function () { closeAuthModal(); }, 1500);
                } catch (err) {
                    console.error(err);
                    var passCorp = String(firmaPass || '').replace(/\s/g, '');
                    var corpSixDigit = /^\d{6}$/.test(passCorp);
                    if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
                        msg.textContent = corpSixDigit
                            ? '6 haneli kod firma giriş şifresi değildir. Şifre sıfırlama e-postasındaki bağlantıyla yeni şifre oluşturup onunla girin.'
                            : 'Firma kullanıcı adı veya şifre hatalı.';
                    } else {
                        msg.textContent = err.message || 'Giriş sırasında hata oluştu.';
                    }
                    msg.style.display = 'block';
                } finally {
                    submitBtn.disabled = false;
                }
            });
        }

        var KVKK_METIN = '<h4>1. Veri Sorumlusu</h4><p>Bu Gizlilik Politikası ve Aydınlatma Metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu ("KVKK") uyarınca, veri sorumlusu sıfatıyla Finanssepeti.net (E-posta: finanssepeti.net@gmail.com) tarafından hazırlanmıştır.</p>' +
            '<h4>2. Toplanan Kişisel Veriler</h4><p>Web sitemize üye olmanız ve giriş yapmanız kapsamında aşağıdaki kişisel verileriniz işlenebilir: Ad – Soyad, E-posta adresi, Telefon numarası, Kullanıcı adı, Şifre (şifrelenmiş şekilde saklanır), IP adresi, Cihaz bilgileri, İşlem ve kullanım geçmişi, Çerez (cookie) verileri.</p>' +
            '<h4>3. Kişisel Verilerin İşlenme Amaçları</h4><p>Üyelik kaydının oluşturulması ve yönetilmesi, Kullanıcı hesabına giriş işlemlerinin sağlanması, Hizmetlerin sunulması ve geliştirilmesi, Kullanıcı deneyiminin iyileştirilmesi, Güvenliğin sağlanması, Yasal yükümlülüklerin yerine getirilmesi, Talep ve şikayetlerin değerlendirilmesi.</p>' +
            '<h4>4. Kişisel Verilerin İşlenme Hukuki Sebepleri</h4><p>Açık rızanızın bulunması, Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması, Veri sorumlusunun hukuki yükümlülüğünü yerine getirebilmesi için zorunlu olması, Veri sorumlusunun meşru menfaati hukuki sebeplerine dayanılarak işlenmektedir.</p>' +
            '<h4>5. Kişisel Verilerin Aktarımı</h4><p>Yetkili kamu kurum ve kuruluşlarına, Hukuken yetkili özel kişilere, Sunucu ve altyapı hizmeti alınan firmalara, KVKK\'nın 8. ve 9. maddelerine uygun olarak aktarılabilir.</p>' +
            '<h4>6. Verilerin Saklama Süresi</h4><p>Kişisel verileriniz, işleme amacının gerektirdiği süre boyunca ve ilgili mevzuatta öngörülen saklama süreleri kadar muhafaza edilir.</p>' +
            '<h4>7. KVKK Kapsamındaki Haklarınız</h4><p>Kişisel verilerinizin işlenip işlenmediğini öğrenme, İşlenmişse bilgi talep etme, İşlenme amacını öğrenme, Yanlış veya eksik işlenmişse düzeltilmesini isteme, Silinmesini veya yok edilmesini isteme, Aktarıldığı üçüncü kişileri bilme, Otomatik sistemler vasıtasıyla analiz suretiyle aleyhinize bir sonucun ortaya çıkmasına itiraz etme, Zarara uğramanız halinde tazminat talep etme. Taleplerinizi finanssepeti.net@gmail.com üzerinden iletebilirsiniz.</p>' +
            '<h4>8. Veri Güvenliği</h4><p>Şirketimiz, kişisel verilerinizin güvenliği için gerekli teknik ve idari tedbirleri almaktadır.</p>' +
            '<h4>9. Çerez (Cookie) Politikası</h4><p>Web sitemizde çerezler kullanılmaktadır. Tarayıcı ayarlarınızdan çerezleri kontrol edebilirsiniz.</p>' +
            '<h4>10. Değişiklikler</h4><p>Bu metin gerek görüldüğünde güncellenebilir. Güncel versiyon web sitemizde yayınlandığı tarihte yürürlüğe girer.</p>';

        function openKvkkModal() {
            var el = document.getElementById('kvkkModalContent');
            if (el) el.innerHTML = KVKK_METIN;
            document.getElementById('kvkkModal').style.display = 'flex';
        }
        function closeKvkkModal() {
            document.getElementById('kvkkModal').style.display = 'none';
        }
        window.openKvkkModal = openKvkkModal;
        window.closeKvkkModal = closeKvkkModal;

        var forgotPasswordEmail = '';
        var FS_FORGOT_EMAIL_KEY = 'fs_forgot_email_v1';
        var FS_FORGOT_DOCID_KEY = 'fs_forgot_code_docid_v1';
        var RESET_CODE_MAIL_ENDPOINT = 'https://us-central1-finans-sepeti.cloudfunctions.net/sendPasswordResetCodeEmail';
        var RESET_CODE_VERIFY_ENDPOINT = 'https://us-central1-finans-sepeti.cloudfunctions.net/verifyPasswordResetCode';
        function openForgotPasswordModal(type) {
            document.getElementById('forgotMessage').style.display = 'none';
            document.getElementById('forgotMessage').textContent = '';
            document.getElementById('forgotPasswordModal').style.display = 'flex';
            var sid = '';
            var sem = '';
            try {
                sid = (sessionStorage.getItem(FS_FORGOT_DOCID_KEY) || '').trim();
                sem = (sessionStorage.getItem(FS_FORGOT_EMAIL_KEY) || '').trim();
            } catch (eSe) {}
            if (sid && sem) {
                forgotPasswordEmail = sem.toLowerCase();
                document.getElementById('forgotStep1').style.display = 'none';
                document.getElementById('forgotStep2').style.display = 'block';
                document.getElementById('forgotEmail').value = sem;
                document.getElementById('forgotCode').value = '';
            } else {
                forgotPasswordEmail = '';
                try { sessionStorage.removeItem(FS_FORGOT_EMAIL_KEY); sessionStorage.removeItem(FS_FORGOT_DOCID_KEY); } catch (eSe2) {}
                document.getElementById('forgotStep1').style.display = 'block';
                document.getElementById('forgotStep2').style.display = 'none';
                document.getElementById('forgotEmail').value = '';
                document.getElementById('forgotCode').value = '';
            }
        }
        function closeForgotPasswordModal() {
            document.getElementById('forgotPasswordModal').style.display = 'none';
        }
        window.openForgotPasswordModal = openForgotPasswordModal;
        window.closeForgotPasswordModal = closeForgotPasswordModal;

        document.getElementById('forgotSendCodeBtn').addEventListener('click', async function () {
            var sendBtn = document.getElementById('forgotSendCodeBtn');
            var SEND_BTN_LABEL = 'Kod Gönder';
            function restoreForgotSendBtn() {
                if (!sendBtn) return;
                sendBtn.disabled = false;
                sendBtn.textContent = SEND_BTN_LABEL;
                sendBtn.style.cursor = '';
                sendBtn.removeAttribute('aria-busy');
            }
            var email = document.getElementById('forgotEmail').value.trim();
            var msgEl = document.getElementById('forgotMessage');
            msgEl.style.display = 'none';
            if (!email) { msgEl.textContent = 'E-posta adresi girin.'; msgEl.style.display = 'block'; msgEl.className = 'auth-error'; return; }
            email = email.toLowerCase();
            var code = String(Math.floor(100000 + Math.random() * 900000));
            sendBtn.disabled = true;
            sendBtn.textContent = 'Gönderiliyor…';
            sendBtn.style.cursor = 'wait';
            sendBtn.setAttribute('aria-busy', 'true');
            try {
                var forgotCodeDocRef = await db.collection('passwordResetCodes').add({
                    email: email,
                    code: code,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                try { sessionStorage.setItem(FS_FORGOT_DOCID_KEY, forgotCodeDocRef.id); } catch (eSe) {}
                msgEl.className = 'auth-success';
                msgEl.textContent = 'Kod oluşturuldu; e-posta gönderiliyor… (sunucu SMTP birkaç saniye sürebilir)';
                msgEl.style.display = 'block';
                var mailOk = false;
                try {
                    var resp = await fetch(RESET_CODE_MAIL_ENDPOINT, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: email, code: code }),
                        mode: 'cors',
                        credentials: 'omit'
                    });
                    var body = {};
                    var rawText = '';
                    try {
                        rawText = await resp.text();
                        if (rawText) body = JSON.parse(rawText);
                    } catch (eParse) { body = {}; }
                    mailOk = !!(resp.ok && body && body.ok);
                    if (!mailOk && body && body.error) {
                        if (body.error === 'smtp_not_configured') {
                            var missTxt = (body.missing && body.missing.length) ? (' Eksik: ' + body.missing.join(', ') + '.') : '';
                            var diag = body.diagnostics;
                            var diagTxt = '';
                            if (diag && diag.env_vars_nonempty && diag.firebase_functions_config_smtp_nonempty) {
                                var ev = diag.env_vars_nonempty;
                                var fc = diag.firebase_functions_config_smtp_nonempty;
                                var allEmpty = !ev.SMTP_HOST && !ev.SMTP_USER && !ev.SMTP_PASS && !fc.host && !fc.user && !fc.pass;
                                if (allEmpty) {
                                    diagTxt = ' Sunucu hiç SMTP görmüyor: Cloud Shellde firebase functions:config:set smtp.* yapıp firebase deploy şart; veya Google Cloudta Variables + Deploy (PCden firebase deploy bu değişkenleri silebilir).';
                                }
                            }
                            msgEl.textContent = 'Mail servisi henüz aktif değil (SMTP ayarı eksik).' + missTxt + diagTxt;
                        } else if (body.error === 'invalid_email') {
                            msgEl.textContent = 'Geçerli bir e-posta adresi girin.';
                        } else if (body.error === 'send_failed') {
                            var smtpHint = body.hint ? (' (' + body.hint + ')') : '';
                            msgEl.textContent = 'Kod oluşturuldu ancak e-posta gönderilemedi (sunucu SMTP). Gmail ise uygulama şifresi ve SMTP_FROM kullanın.' + smtpHint;
                        } else {
                            msgEl.textContent = 'Kod üretildi ancak mail gönderimi başarısız oldu. Lütfen tekrar deneyin.';
                        }
                    } else if (!mailOk && !resp.ok) {
                        msgEl.textContent = 'Kod oluşturuldu ancak mail servisi yanıt vermedi (HTTP ' + resp.status + '). Lütfen daha sonra tekrar deneyin.';
                    } else if (!mailOk && resp.ok) {
                        msgEl.textContent = 'Sunucu yanıtı beklenmedik (boş veya geçersiz). Sayfayı yenileyin; sorun sürerse Cloud Function yeniden deploy edilmeli.';
                        try { console.error('sendPasswordResetCodeEmail raw:', rawText && rawText.slice(0, 500)); } catch (eL) {}
                    }
                } catch (e) {
                    mailOk = false;
                    try { console.error('Şifre sıfırlama mail isteği:', e); } catch (e2) {}
                    var isNet = e && (e.name === 'TypeError' || /fetch|Failed to fetch|NetworkError|NETWORK/i.test(String(e.message || '')));
                    if (isNet) msgEl.textContent = 'E-posta servisine ulaşılamadı (ağ / tarayıcı engeli). VPN veya reklam engelleyiciyi kapatıp tekrar deneyin.';
                }
                if (!mailOk) {
                    var progressLine = 'Kod oluşturuldu; e-posta gönderiliyor… (sunucu SMTP birkaç saniye sürebilir)';
                    if (msgEl.textContent === progressLine || !msgEl.textContent) {
                        msgEl.textContent = 'Kod üretildi ancak e-posta gönderilemedi. Lütfen biraz sonra tekrar deneyin.';
                    }
                    msgEl.className = 'auth-error';
                    msgEl.style.display = 'block';
                    restoreForgotSendBtn();
                    return;
                }
                forgotPasswordEmail = email;
                try { sessionStorage.setItem(FS_FORGOT_EMAIL_KEY, email); } catch (eSe) {}
                document.getElementById('forgotStep1').style.display = 'none';
                document.getElementById('forgotStep2').style.display = 'block';
                msgEl.className = 'auth-success';
                msgEl.textContent = 'E-posta adresinize 6 haneli kod gönderildi.';
                msgEl.style.display = 'block';
            } catch (err) {
                console.error(err);
                msgEl.textContent = 'Kod kaydedilirken hata oluştu. Lütfen tekrar deneyin.';
                msgEl.className = 'auth-error';
                msgEl.style.display = 'block';
                restoreForgotSendBtn();
                return;
            }
            restoreForgotSendBtn();
        });

        document.getElementById('forgotVerifyCodeBtn').addEventListener('click', async function () {
            var code = document.getElementById('forgotCode').value.replace(/\D/g, '').trim();
            var msgEl = document.getElementById('forgotMessage');
            if (!msgEl) return;
            msgEl.style.display = 'none';
            var fromInput = (document.getElementById('forgotEmail') && document.getElementById('forgotEmail').value) ? document.getElementById('forgotEmail').value.trim().toLowerCase() : '';
            var fromSess = '';
            try { fromSess = (sessionStorage.getItem(FS_FORGOT_EMAIL_KEY) || '').trim().toLowerCase(); } catch (eSe) {}
            var em = (forgotPasswordEmail || fromInput || fromSess || '').trim().toLowerCase();
            if (!em || code.length !== 6) {
                msgEl.textContent = 'Önce «Kod Gönder» ile 6 haneli kodu alın; tarayıcı gizli pencerede veya eski oturumda docId yoksa yeni kod isteyin.';
                msgEl.style.display = 'block';
                msgEl.className = 'auth-error';
                return;
            }
            function showForgotResetLinkUi(resetLinkHref, emailAlsoSent) {
                msgEl.className = 'auth-success';
                msgEl.style.display = 'block';
                msgEl.innerHTML = '';
                var intro = document.createElement('p');
                intro.style.margin = '0 0 10px';
                intro.textContent = 'Kod doğru. Şifrenizi hemen sıfırlamak için aşağıdaki düğmeye tıklayın (bağlantı tek kullanımlık).';
                msgEl.appendChild(intro);
                if (emailAlsoSent) {
                    var note = document.createElement('p');
                    note.style.fontSize = '12px';
                    note.style.color = '#94a3b8';
                    note.style.margin = '0 0 12px';
                    note.textContent = 'İsterseniz aynı bağlantı e-postanıza da gönderilmeye çalışıldı (Spam / Gereksiz klasörüne düşebilir).';
                    msgEl.appendChild(note);
                }
                var a = document.createElement('a');
                a.href = resetLinkHref;
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.className = 'auth-submit fs-forgot-reset-link';
                a.style.display = 'inline-block';
                a.style.marginTop = '4px';
                var resetLinkLabel = 'Şifremi sıfırla — yeni sekmede aç';
                a.textContent = resetLinkLabel;
                a.setAttribute('role', 'button');
                a.setAttribute('tabindex', '0');
                a.addEventListener('mousedown', function () { a.classList.add('fs-forgot-reset-link--down'); });
                a.addEventListener('mouseup', function () { setTimeout(function () { a.classList.remove('fs-forgot-reset-link--down'); }, 80); });
                a.addEventListener('mouseleave', function () { a.classList.remove('fs-forgot-reset-link--down'); });
                a.addEventListener('touchstart', function () { a.classList.add('fs-forgot-reset-link--down'); }, { passive: true });
                a.addEventListener('touchend', function () { setTimeout(function () { a.classList.remove('fs-forgot-reset-link--down'); }, 80); });
                a.addEventListener('click', function () {
                    a.classList.add('fs-forgot-reset-link--busy');
                    a.textContent = 'Açılıyor…';
                    setTimeout(function () {
                        a.textContent = resetLinkLabel;
                        a.classList.remove('fs-forgot-reset-link--busy');
                    }, 450);
                });
                a.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        a.click();
                    }
                });
                msgEl.appendChild(a);
                try { sessionStorage.removeItem(FS_FORGOT_EMAIL_KEY); sessionStorage.removeItem(FS_FORGOT_DOCID_KEY); } catch (eSe) {}
            }
            async function afterVerifySuccess(verifyBody) {
                var rlink = verifyBody && verifyBody.resetLink ? String(verifyBody.resetLink).trim() : '';
                if (rlink.indexOf('https://') === 0) {
                    if (verifyBody.resetEmailSent && verifyBody.mailMessageId) {
                        try { console.info('Şifre sıfırlama e-postası SMTP messageId:', verifyBody.mailMessageId); } catch (eMid) {}
                    }
                    showForgotResetLinkUi(rlink, !!verifyBody.resetEmailSent);
                    return;
                }
                if (verifyBody && verifyBody.ok) {
                    try {
                        console.warn('verifyPasswordResetCode yanıtında resetLink yok — fonksiyon eski sürümde olabilir. Bilgisayarınızda: firebase deploy --only functions');
                    } catch (eW) {}
                }
                try {
                    await auth.sendPasswordResetEmail(em);
                    msgEl.className = 'auth-success';
                    msgEl.textContent = 'Kod doğru. Şifre sıfırlama bağlantısı Firebase üzerinden e-postanıza gönderildi; gelen kutusu ve spam’i kontrol edin. İleride bağlantıyı doğrudan bu pencerede görmek için Google Cloud’da güncel verifyPasswordResetCode fonksiyonunu deploy edin (cPanel / hosting ile ilgili değildir).';
                    msgEl.style.display = 'block';
                } catch (authErr) {
                    console.error(authErr);
                    var authMsg = (authErr && authErr.code === 'auth/user-not-found')
                        ? 'Kod doğru ancak bu e-posta ile kayıtlı hesap bulunamadı.'
                        : 'Kod doğrulandı fakat sıfırlama bağlantısı alınamadı. Cloud Function güncel mi kontrol edin.';
                    msgEl.className = 'auth-error';
                    msgEl.textContent = authMsg;
                    msgEl.style.display = 'block';
                }
                try { sessionStorage.removeItem(FS_FORGOT_EMAIL_KEY); sessionStorage.removeItem(FS_FORGOT_DOCID_KEY); } catch (eSe2) {}
                setTimeout(function () { closeForgotPasswordModal(); }, 4000);
            }
            // Doğrulama yalnızca Cloud Function (Admin SDK) ile — tarayıcıdan Firestore okuma yok, kurallara takılmaz
            var resp;
            var tRaw;
            try {
                resp = await fetch(RESET_CODE_VERIFY_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: em, code: code }),
                    mode: 'cors',
                    credentials: 'omit'
                });
                tRaw = await resp.text();
            } catch (netErr) {
                console.error('verifyPasswordResetCode ağ', netErr);
                var nmx = (netErr && netErr.message) ? String(netErr.message) : 'Bağlantı hatası';
                msgEl.textContent = 'Doğrulama sunucusuna ulaşılamadı: ' + nmx.slice(0, 140) + ' Reklam engeli / güvenlik eklentisi kapatıp tekrar deneyin. Mail geliyorsa bile verify fonksiyonu engellenmiş olabilir.';
                msgEl.className = 'auth-error';
                msgEl.style.display = 'block';
                return;
            }
            var body = {};
            try { if (tRaw) body = JSON.parse(tRaw); } catch (eJ) { body = {}; }
            if (!resp.ok || !body.ok) {
                try { console.error('verifyPasswordResetCode', resp.status, tRaw && tRaw.slice(0, 400)); } catch (eL) {}
                if (body.error === 'invalid_or_expired' || body.error === 'invalid_code') {
                    msgEl.textContent = 'Kod hatalı veya süresi dolmuş (1 saat). Tekrar «Kod Gönder» deyin.';
                } else if (body.error === 'invalid_email') {
                    msgEl.textContent = 'E-posta geçersiz.';
                } else if (body.error === 'auth_user_not_found') {
                    msgEl.textContent = 'Bu e-posta ile Firebase hesabı yok. Kayıt olmayı veya doğru adresi kullanmayı deneyin.';
                } else if (body.error === 'link_generation_failed') {
                    msgEl.textContent = 'Sıfırlama bağlantısı oluşturulamadı. Firebase → Authentication ve Authorized domains (www / kök alan) ayarlarını kontrol edin.';
                } else if (body.error === 'server_error') {
                    msgEl.textContent = 'Sunucu doğrulama hatası. Firebase → Functions → verifyPasswordResetCode günlüğüne bakın ve firebase deploy --only functions ile yayınlayın.';
                } else if (resp.status === 403 || resp.status === 401) {
                    msgEl.textContent = 'Doğrulama isteği reddedildi (HTTP ' + resp.status + ').';
                } else if (resp.status === 404) {
                    msgEl.textContent = 'verifyPasswordResetCode bulunamadı (404). Aynı projede functions deploy edildi mi? URL: us-central1-finans-sepeti.cloudfunctions.net';
                } else {
                    var hint = (body && body.error) ? (' (' + body.error + ')') : '';
                    msgEl.textContent = 'Doğrulama başarısız (HTTP ' + resp.status + ')' + hint + '.';
                }
                msgEl.className = 'auth-error';
                msgEl.style.display = 'block';
                return;
            }
            try {
                await afterVerifySuccess(body);
            } catch (finalErr) {
                console.error('forgotVerify tamamlanamadı', finalErr);
                msgEl.textContent = 'Kod sunucuda onaylandı ama işlem bitmedi: ' + String((finalErr && finalErr.message) || finalErr).slice(0, 140);
                msgEl.className = 'auth-error';
                msgEl.style.display = 'block';
            }
        });

        let profileSavedOnce = false;
        let profileEditMode = false;
        let currentProfileIsCorporate = false;
        const profileInputIds = ['profileUsername','profileAdSoyad','profileEmail','profileBiyografi','profileUniversite','profileKurum','profileMeslek','profileUnvan','profileSehir','profileDogumTarihi','profileSertifika','profileHobiler'];
        const TURKISH_CITIES = ['Adana','Adıyaman','Afyonkarahisar','Ağrı','Aksaray','Amasya','Ankara','Antalya','Ardahan','Artvin','Aydın','Balıkesir','Bartın','Batman','Bayburt','Bilecik','Bingöl','Bitlis','Bolu','Burdur','Bursa','Çanakkale','Çankırı','Çorum','Denizli','Diyarbakır','Düzce','Edirne','Elazığ','Erzincan','Erzurum','Eskişehir','Gaziantep','Giresun','Gümüşhane','Hakkari','Hatay','Iğdır','Isparta','İstanbul','İzmir','Kahramanmaraş','Karabük','Karaman','Kars','Kastamonu','Kayseri','Kırıkkale','Kırklareli','Kırşehir','Kilis','Kocaeli','Konya','Kütahya','Malatya','Manisa','Mardin','Mersin','Muğla','Muş','Nevşehir','Niğde','Ordu','Osmaniye','Rize','Sakarya','Samsun','Şanlıurfa','Siirt','Sinop','Sivas','Şırnak','Tekirdağ','Tokat','Trabzon','Tunceli','Uşak','Van','Yalova','Yozgat','Zonguldak'];

        function setProfileFormMode(isCorporate) {
            currentProfileIsCorporate = !!isCorporate;
            var titleEl = document.getElementById('profileInfoTitle');
            if (titleEl) titleEl.textContent = isCorporate ? 'Firma Bilgileri' : 'Kişisel Bilgiler';
            var labels = isCorporate
                ? { Username: 'Firma Kullanıcı Adı:', AdSoyad: 'Firma İsmi:', Email: 'Firma E-Mail:', Universite: 'Firma Sektör Bilgisi:', Kurum: 'Firma Faaliyet Alanları:', Meslek: 'Firma Adres:', Unvan: 'Firma İletişim Bilgileri:', DogumTarihi: 'Firma Kuruluş Yılı:' }
                : { Username: 'Kullanıcı Adı:', AdSoyad: 'Adı Soyadı:', Email: 'E-mail:', Universite: 'Üniversite:', Kurum: 'Çalıştığı Kurum/Firma:', Meslek: 'Meslek:', Unvan: 'Ünvan:', DogumTarihi: 'Doğum Tarihi:' };
            var placeholders = isCorporate
                ? { Username: 'Firma kullanıcı adı', AdSoyad: 'Firma ismi', Email: 'Firma e-posta', Universite: 'Sektör bilgisi', Kurum: 'Faaliyet alanları', Meslek: 'Adres', Unvan: 'İletişim bilgileri', DogumTarihi: 'Örn: 2010' }
                : { Username: '@nickname (örn: @emrekaraca)', AdSoyad: 'Adınız soyadınız', Email: 'E-posta adresiniz', Universite: 'Üniversite', Kurum: 'Kurum/Firma', Meslek: 'Meslek', Unvan: 'Ünvan', DogumTarihi: '' };
            ['Username','AdSoyad','Email','Universite','Kurum','Meslek','Unvan','DogumTarihi'].forEach(function(k) {
                var l = document.getElementById('profileLabel' + k);
                var i = document.getElementById('profile' + k);
                if (l) l.textContent = labels[k];
                if (i) { i.placeholder = placeholders[k]; if (k === 'DogumTarihi') i.type = isCorporate ? 'text' : 'date'; }
            });
            var showBireyselOnly = ['profileFieldBiyografi','profileFieldSehir','profileFieldSertifika','profileFieldHobiler'];
            showBireyselOnly.forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.style.display = isCorporate ? 'none' : '';
            });
        }

        function fillProfileCities() {
            const sel = document.getElementById('profileSehir');
            if (!sel) return;
            const currentVal = sel.value;
            sel.innerHTML = '<option value="">Şehir seçin</option>';
            TURKISH_CITIES.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
            if (currentVal && TURKISH_CITIES.includes(currentVal)) sel.value = currentVal;
        }

        function fillDetayliAramaCities() {
            const sel = document.getElementById('detayliAramaSehir');
            if (!sel || typeof TURKISH_CITIES === 'undefined') return;
            sel.innerHTML = '<option value="">Şehir seçin</option>';
            TURKISH_CITIES.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o); });
        }

        async function openProfileModal() {
            const user = auth.currentUser;
            if (!user) {
                alert('Profil için önce giriş yapmanız gerekiyor.');
                return;
            }
            fillProfileCities();
            document.getElementById('profileModal').classList.add('open');
            document.getElementById('profileModal').style.display = 'flex';
            profileEditMode = true;
            await loadProfileData();
            profileSetInputsEnabled(true);
            var saveBtns = document.getElementById('profileSaveBtns');
            var kaydetBtn = document.getElementById('profileKaydetBtn');
            if (saveBtns) { saveBtns.style.display = 'flex'; saveBtns.style.visibility = 'visible'; saveBtns.style.pointerEvents = 'auto'; }
            if (kaydetBtn) { kaydetBtn.disabled = false; kaydetBtn.style.cursor = 'pointer'; kaydetBtn.style.opacity = '1'; }
        }

        function closeProfileModal() {
            document.getElementById('profileModal').classList.remove('open');
            document.getElementById('profileModal').style.display = 'none';
            document.getElementById('profileRemoveConfirm').classList.remove('open');
        }

        async function loadProfileData() {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                var isCorporate = false;
                if (!snap.empty) {
                    const d = snap.docs[0].data();
                    isCorporate = d.memberType === 'corporate';
                    setProfileFormMode(isCorporate);
                    if (isCorporate) {
                        var un = (d.firmaKullaniciAdi || d.username || '').trim();
                        document.getElementById('profileUsername').value = un ? (un.startsWith('@') ? un : un) : '';
                        document.getElementById('profileAdSoyad').value = d.firmaIsmi || '';
                        document.getElementById('profileEmail').value = d.firmaEmail || d.email || user.email || '';
                        document.getElementById('profileDogumTarihi').value = d.firmaKurulusYili || '';
                        document.getElementById('profileUniversite').value = d.firmaSektor || '';
                        document.getElementById('profileKurum').value = d.firmaFaaliyetAlanlari || '';
                        document.getElementById('profileMeslek').value = d.firmaAdres || '';
                        document.getElementById('profileUnvan').value = d.firmaIletisim || '';
                    } else {
                        var un = (d.username || '').trim();
                        document.getElementById('profileUsername').value = un ? (un.startsWith('@') ? un : '@' + un) : '';
                        document.getElementById('profileAdSoyad').value = d.adSoyad || '';
                        document.getElementById('profileEmail').value = d.email || user.email || '';
                        document.getElementById('profileBiyografi').value = d.biography || '';
                        updateProfileBiyografiCount();
                        document.getElementById('profileUniversite').value = d.universite || '';
                        document.getElementById('profileKurum').value = d.kurum || '';
                        document.getElementById('profileMeslek').value = d.meslek || '';
                        document.getElementById('profileUnvan').value = d.unvan || '';
                        document.getElementById('profileSehir').value = d.sehir || '';
                        document.getElementById('profileDogumTarihi').value = d.dogumTarihi || '';
                        document.getElementById('profileSertifika').value = d.sertifikalar || '';
                        document.getElementById('profileHobiler').value = d.hobiler || '';
                    }
                    var photoToShow = d.photoUrl || (user.photoURL || '');
                    if (photoToShow) {
                        document.getElementById('profilePhotoImg').src = photoToShow;
                        document.getElementById('profilePhotoImg').style.display = 'block';
                        document.getElementById('profilePhotoPlaceholder').style.display = 'none';
                    } else {
                        document.getElementById('profilePhotoImg').src = '';
                        document.getElementById('profilePhotoImg').style.display = 'none';
                        document.getElementById('profilePhotoPlaceholder').style.display = 'block';
                    }
                } else {
                    setProfileFormMode(false);
                    document.getElementById('profileEmail').value = user.email || '';
                    document.getElementById('profileBiyografi').value = '';
                    updateProfileBiyografiCount();
                    profileClearInputs();
                    if (user.photoURL) {
                        document.getElementById('profilePhotoImg').src = user.photoURL;
                        document.getElementById('profilePhotoImg').style.display = 'block';
                        document.getElementById('profilePhotoPlaceholder').style.display = 'none';
                    }
                }
            } catch (e) { console.error('Profil yükleme:', e); }
        }

        function profileClearInputs() {
            profileInputIds.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                if (id === 'profileEmail') return;
                if (el.type === 'checkbox') el.checked = true;
                else el.value = '';
            });
            document.getElementById('profilePhotoImg').src = '';
            document.getElementById('profilePhotoImg').style.display = 'none';
            document.getElementById('profilePhotoPlaceholder').style.display = 'block';
        }

        function updateProfileBiyografiCount() {
            var el = document.getElementById('profileBiyografi');
            var cnt = document.getElementById('profileBiyografiCount');
            if (el && cnt) { var len = (el.value || '').length; cnt.textContent = len + '/120'; }
        }
        document.getElementById('profileBiyografi').addEventListener('input', updateProfileBiyografiCount);
        document.getElementById('profileBiyografi').addEventListener('change', updateProfileBiyografiCount);

        function profileSetInputsEnabled(enabled) {
            profileInputIds.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.disabled = !enabled;
            });
        }

        function profileDuzenle() {
            profileEditMode = true;
            profileSetInputsEnabled(true);
        }


        function dataURLToBlob(dataUrl) {
            var arr = dataUrl.split(',');
            var mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
            var bstr = atob(arr[1]);
            var n = bstr.length;
            var u8 = new Uint8Array(n);
            for (var i = 0; i < n; i++) u8[i] = bstr.charCodeAt(i);
            return new Blob([u8], { type: mime });
        }

        var MAX_USER_PHOTOS = 8;
        var MAX_USER_VIDEOS = 5;
        var MAX_VIDEO_DURATION_SEC = 15;
        /** Yorum videosu tarayıcıda yeniden kodlama — hız için VP8 + düşük çözünürlük + hızlı oynatma */
        var YORUM_VIDEO_ENCODE_MAX_WIDTH = 480;
        var YORUM_VIDEO_BITS_PER_SECOND = 480000;
        var YORUM_VIDEO_CAPTURE_FPS = 18;
        var YORUM_VIDEO_PLAYBACK_RATE = 2.25;
        var YORUM_VIDEO_ENCODE_SKIP_BYTES = 1400000;
        /** Firestore’dan gelen medya listesi (bazen eski kayıtlar veya istemciler farklı şekilde saklayabilir) */
        function normalizeMediaUrlsField(raw) {
            if (raw == null) return [];
            if (Array.isArray(raw)) {
                return raw.map(function(u) { return u != null ? String(u).trim() : ''; }).filter(Boolean);
            }
            if (typeof raw === 'object') {
                try {
                    return Object.keys(raw).sort(function(a, b) { return Number(a) - Number(b); }).map(function(k) {
                        return raw[k] != null ? String(raw[k]).trim() : '';
                    }).filter(Boolean);
                } catch (e) { return []; }
            }
            if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
            return [];
        }
        /**
         * Video URL’si: sorgu dizesi (?alt=media) varken $ ile biten desen kaçırılmamalı.
         * Firebase: .../o/posts%2Fuid%2Fdosya.webm?alt=media — path decode ile de kontrol.
         */
        function isVideoMediaUrl(url) {
            if (!url || typeof url !== 'string') return false;
            var s = url.trim();
            if (!s) return false;
            if (/\.(mp4|webm|ogg|mov|mkv|3gp)(\?|#|$)/i.test(s)) return true;
            try {
                if (/\.(mp4|webm|ogg|mov|mkv|3gp)(\?|#|$)/i.test(decodeURIComponent(s))) return true;
            } catch (e) {}
            var om = s.match(/\/o\/([^?#]+)(\?|#|$)/);
            if (om) {
                try {
                    var pathOnly = decodeURIComponent(om[1]);
                    if (/\.(mp4|webm|ogg|mov|mkv|3gp)$/i.test(pathOnly)) return true;
                } catch (e2) {}
            }
            return false;
        }
        var PROFILE_PHOTO_MAX_WIDTH = 400;
        var POST_PHOTO_MAX_WIDTH = 800;
        var IMAGE_QUALITY = 0.78;
        var YORUM_YAZ_AVATAR_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104"><circle cx="52" cy="52" r="52" fill="#1e3a5f"/><circle cx="52" cy="40" r="18" fill="#94a3b8"/><ellipse cx="52" cy="88" rx="32" ry="22" fill="#94a3b8"/></svg>');

        function compressImageBlob(source, maxWidth, quality) {
            quality = quality || IMAGE_QUALITY;
            maxWidth = maxWidth || POST_PHOTO_MAX_WIDTH;
            return new Promise(function(resolve, reject) {
                var img = new Image();
                var objectUrl = null;
                img.crossOrigin = 'anonymous';
                img.onload = function() {
                    var w = img.width, h = img.height;
                    if (w > maxWidth || h > maxWidth) {
                        if (w > h) { h = Math.round(h * maxWidth / w); w = maxWidth; }
                        else { w = Math.round(w * maxWidth / h); h = maxWidth; }
                    }
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    canvas.toBlob(function(blob) {
                        if (objectUrl) URL.revokeObjectURL(objectUrl);
                        if (blob) resolve(blob);
                        else reject(new Error('Sıkıştırma başarısız'));
                    }, 'image/jpeg', quality);
                };
                img.onerror = function() { if (objectUrl) URL.revokeObjectURL(objectUrl); reject(new Error('Resim yüklenemedi')); };
                if (typeof source === 'string') img.src = source;
                else if (source && source instanceof Blob) { objectUrl = URL.createObjectURL(source); img.src = objectUrl; }
                else reject(new Error('Geçersiz kaynak'));
            });
        }

        function getVideoDurationSec(file) {
            return new Promise(function(resolve, reject) {
                if (!file || !file.type.startsWith('video/')) { resolve(0); return; }
                var vid = document.createElement('video');
                vid.preload = 'metadata';
                var objectUrl = URL.createObjectURL(file);
                var finished = false;
                var to = setTimeout(function() {
                    if (finished) return;
                    finished = true;
                    try { URL.revokeObjectURL(objectUrl); } catch (e) {}
                    reject(new Error('Video metadata zaman aşımı'));
                }, 12000);
                vid.onloadedmetadata = function() {
                    if (finished) return;
                    finished = true;
                    clearTimeout(to);
                    var dur = vid.duration || 0;
                    try { URL.revokeObjectURL(objectUrl); } catch (e) {}
                    resolve(dur);
                };
                vid.onerror = function() {
                    if (finished) return;
                    finished = true;
                    clearTimeout(to);
                    try { URL.revokeObjectURL(objectUrl); } catch (e) {}
                    reject(new Error('Video süresi alınamadı'));
                };
                vid.src = objectUrl;
            });
        }

        function pickYorumVideoRecorderMime() {
            if (typeof MediaRecorder === 'undefined') return '';
            /* VP9 kalite verir ama kodlama yavaş; VP8 önce — kullanıcı bekleme süresi kısalır */
            var list = ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9,opus', 'video/webm'];
            for (var i = 0; i < list.length; i++) {
                if (MediaRecorder.isTypeSupported(list[i])) return list[i];
            }
            return '';
        }

        /** Tarayıcıda düşük çözünürlük / bitrate ile yeniden kodlar (Chrome/Edge/Firefox; Safari çoğu cihazda orijinal dosyaya düşer). */
        function compressYorumVideoForUpload(file, maxDurationSec, maxWidth, videoBitsPerSecond) {
            maxDurationSec = maxDurationSec || MAX_VIDEO_DURATION_SEC;
            maxWidth = maxWidth || YORUM_VIDEO_ENCODE_MAX_WIDTH;
            videoBitsPerSecond = videoBitsPerSecond || YORUM_VIDEO_BITS_PER_SECOND;
            return new Promise(function(resolve) {
                var settled = false;
                var encodeStopping = false;
                function settle(result) {
                    if (settled) return;
                    settled = true;
                    resolve(result);
                }
                var mime = pickYorumVideoRecorderMime();
                if (!file || !mime) {
                    settle({ file: file, compressed: false });
                    return;
                }
                var url = URL.createObjectURL(file);
                var video = document.createElement('video');
                video.src = url;
                video.muted = false;
                video.playsInline = true;
                video.setAttribute('playsinline', '');
                video.setAttribute('webkit-playsinline', '');
                video.crossOrigin = 'anonymous';
                var recorder = null;
                function fail() {
                    if (settled) return;
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e2) {}
                    settle({ file: file, compressed: false });
                }
                video.onerror = function() { fail(); };
                video.onloadedmetadata = function() {
                    try {
                        var vidDur = isFinite(video.duration) ? video.duration : maxDurationSec;
                        var encodeDur = Math.min(vidDur, maxDurationSec);
                        if (encodeDur <= 0.08) {
                            fail();
                            return;
                        }
                        var vw = video.videoWidth, vh = video.videoHeight;
                        if (!vw || !vh) {
                            fail();
                            return;
                        }
                        var cw = vw, ch = vh;
                        if (cw > maxWidth) {
                            ch = Math.round(ch * maxWidth / cw);
                            cw = maxWidth;
                        }
                        var canvas = document.createElement('canvas');
                        canvas.width = cw;
                        canvas.height = ch;
                        var ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
                        try { ctx.imageSmoothingEnabled = true; } catch (eSm) {}
                        var fps = YORUM_VIDEO_CAPTURE_FPS;
                        var canvasStream = canvas.captureStream(fps);
                        try {
                            var cap = video.captureStream();
                            var ats = cap.getAudioTracks();
                            for (var ai = 0; ai < ats.length; ai++) canvasStream.addTrack(ats[ai]);
                        } catch (capErr) { /* sessiz */ }
                        var recOpts = { mimeType: mime, videoBitsPerSecond: videoBitsPerSecond };
                        if (canvasStream.getAudioTracks && canvasStream.getAudioTracks().length) recOpts.audioBitsPerSecond = 48000;
                        try {
                            recorder = new MediaRecorder(canvasStream, recOpts);
                        } catch (eRec) {
                            try { recorder = new MediaRecorder(canvasStream); } catch (e2) {
                                fail();
                                return;
                            }
                        }
                        var chunks = [];
                        recorder.ondataavailable = function(e) {
                            if (e.data && e.data.size) chunks.push(e.data);
                        };
                        recorder.onerror = function() { fail(); };
                        recorder.onstop = function() {
                            try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e0) {}
                            try { URL.revokeObjectURL(url); } catch (e1) {}
                            if (!chunks.length) {
                                settle({ file: file, compressed: false });
                                return;
                            }
                            var blob = new Blob(chunks, { type: 'video/webm' });
                            var base = (file.name && file.name.replace(/\.[^.]+$/, '')) || 'video';
                            var outFile = new File([blob], base + '_yorum.webm', { type: 'video/webm' });
                            settle({ file: outFile, compressed: true });
                        };
                        function finishEncode() {
                            if (encodeStopping || settled) return;
                            encodeStopping = true;
                            try { video.pause(); } catch (vp) {}
                            try {
                                if (recorder && recorder.state === 'recording') recorder.stop();
                                else fail();
                            } catch (eStop) {
                                fail();
                            }
                        }
                        try {
                            recorder.start(400);
                        } catch (eStart) {
                            fail();
                            return;
                        }
                        video.currentTime = 0;
                        video.play().then(function() {
                            try {
                                video.playbackRate = YORUM_VIDEO_PLAYBACK_RATE;
                                if (!isFinite(video.playbackRate) || video.playbackRate < 1) video.playbackRate = 1;
                            } catch (ePR) {}
                            function frame() {
                                if (settled || encodeStopping) return;
                                if (video.currentTime >= encodeDur - 0.05 || video.ended) {
                                    finishEncode();
                                    return;
                                }
                                try { ctx.drawImage(video, 0, 0, cw, ch); } catch (de) {}
                                requestAnimationFrame(frame);
                            }
                            requestAnimationFrame(frame);
                        }).catch(function() { fail(); });
                    } catch (outer) {
                        fail();
                    }
                };
            });
        }

        function compressYorumVideoForUploadSafe(file, maxDurationSec, maxWidth, videoBitsPerSecond) {
            /* Hızlı oynatma ile süre kısalır; yine de düşük cihazlara pay bırak */
            var ms = 55000;
            return Promise.race([
                compressYorumVideoForUpload(file, maxDurationSec, maxWidth, videoBitsPerSecond),
                new Promise(function(resolve) {
                    setTimeout(function() {
                        resolve({ file: file, compressed: false, timedOut: true });
                    }, ms);
                })
            ]);
        }

        async function countUserPhotosAndVideos(uid) {
            var photos = 0, videos = 0;
            try {
                var snap = await db.collection('userPosts').where('userId', '==', uid).get();
                snap.docs.forEach(function(d) {
                    var urls = normalizeMediaUrlsField(d.data().mediaUrls);
                    urls.forEach(function(u) {
                        if (isVideoMediaUrl(u)) videos++;
                        else photos++;
                    });
                });
            } catch (e) {}
            return { photos: photos, videos: videos };
        }

        async function profileKaydet() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kayıt için giriş yapmanız gerekiyor.');
                return;
            }
            var kaydetBtn = document.getElementById('profileKaydetBtn');
            if (kaydetBtn && kaydetBtn.disabled) return;
            if (kaydetBtn) kaydetBtn.disabled = true;
            var rawUsername = (document.getElementById('profileUsername').value || '').trim().replace(/^@+/, '');
            var username = rawUsername.toLowerCase().replace(/[^a-z0-9_.]/g, '');
            if (rawUsername && !username) {
                if (kaydetBtn) kaydetBtn.disabled = false;
                alert('Kullanıcı adı sadece harf, rakam, nokta ve alt çizgi içerebilir.');
                return;
            }
            if (username) {
                var existingSnap = await db.collection('userProfiles').where('username', '==', username).get();
                var takenByOther = false;
                var conflictIds = [];
                existingSnap.forEach(function (d) {
                    var uid = (d.data() && d.data().userId) || '';
                    if (uid && uid !== user.uid) {
                        takenByOther = true;
                        conflictIds.push(d.id);
                    }
                });
                if (takenByOther) {
                    if (kaydetBtn) kaydetBtn.disabled = false;
                    try {
                        console.warn('[Profil] username çakışması:', username, 'Firestore belge id:', conflictIds.join(', '));
                    } catch (eC) {}
                    alert('Bu Kullanıcı Adı başka bir profilde kayıtlı. Firestore > userProfiles içinde "username" alanı tam olarak "' + username + '" olan belgeyi bulun (e-posta farklı olabilir); o belgeyi silin veya username alanını silin. (Konsolda belge id: ' + conflictIds.join(', ') + ')');
                    return;
                }
            }
            var imgSrc = document.getElementById('profilePhotoImg').src || '';
            var photoUrlToSave = '';
            if (imgSrc.startsWith('data:')) {
                if (typeof storage === 'undefined') {
                    if (kaydetBtn) kaydetBtn.disabled = false;
                    alert('Profil fotoğrafı kaydedilemiyor: Firebase Storage bağlantısı yok. Firebase Console\'da Storage\'ı açıp projenize ekleyin.');
                    return;
                }
                try {
                    var blob = await compressImageBlob(imgSrc, PROFILE_PHOTO_MAX_WIDTH, IMAGE_QUALITY);
                    var ref = storage.ref('profiles/' + user.uid + '/photo.jpg');
                    await ref.put(blob);
                    photoUrlToSave = await ref.getDownloadURL();
                } catch (err) {
                    console.error('Profil fotoğrafı yükleme:', err);
                    if (kaydetBtn) kaydetBtn.disabled = false;
                    var msg = (err && err.message) ? err.message : '';
                    var code = (err && err.code) ? err.code : '';
                    if (code === 'storage/unauthorized' || code === 'storage/canceled' || msg.indexOf('Permission') !== -1 || msg.indexOf('403') !== -1) {
                        msg = 'Storage izin hatası. Firebase Console > Storage > Rules sekmesine gidin, kuralları aşağıdaki gibi yapıp "Yayınla" deyin:\n\nmatch /profiles/{userId}/{allPaths=**} {\n  allow read, write: if request.auth != null && request.auth.uid == userId;\n}';
                    } else if (code === 'storage/retry-limit-exceeded' || msg.indexOf('network') !== -1) {
                        msg = 'Ağ hatası. İnternet bağlantınızı kontrol edip tekrar deneyin.';
                    }
                    alert('Profil fotoğrafı yüklenemedi.\n\nHata: ' + (msg || code || 'Bilinmeyen') + '\n\nFirebase Console\'da Storage > Rules bölümünden giriş yapan kullanıcıya yazma izni verin.');
                    return;
                }
            } else if (imgSrc && (imgSrc.startsWith('http://') || imgSrc.startsWith('https://'))) {
                photoUrlToSave = imgSrc;
            }
            var data;
            if (currentProfileIsCorporate) {
                data = {
                    userId: user.uid,
                    username: username || (document.getElementById('profileUsername').value || '').trim().replace(/^@+/, ''),
                    firmaKullaniciAdi: (document.getElementById('profileUsername').value || '').trim().replace(/^@+/, ''),
                    firmaIsmi: document.getElementById('profileAdSoyad').value.trim(),
                    firmaEmail: document.getElementById('profileEmail').value.trim(),
                    firmaKurulusYili: document.getElementById('profileDogumTarihi').value.trim(),
                    firmaSektor: document.getElementById('profileUniversite').value.trim(),
                    firmaFaaliyetAlanlari: document.getElementById('profileKurum').value.trim(),
                    firmaAdres: document.getElementById('profileMeslek').value.trim(),
                    firmaIletisim: document.getElementById('profileUnvan').value.trim(),
                    adSoyad: document.getElementById('profileAdSoyad').value.trim(),
                    email: document.getElementById('profileEmail').value.trim(),
                    photoUrl: photoUrlToSave,
                    memberType: 'corporate',
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
            } else {
                data = {
                    userId: user.uid,
                    username: username || '',
                    adSoyad: document.getElementById('profileAdSoyad').value.trim(),
                    email: document.getElementById('profileEmail').value.trim(),
                    biography: (document.getElementById('profileBiyografi').value || '').trim().substring(0, 120),
                    universite: document.getElementById('profileUniversite').value.trim(),
                    kurum: document.getElementById('profileKurum').value.trim(),
                    meslek: document.getElementById('profileMeslek').value.trim(),
                    unvan: document.getElementById('profileUnvan').value.trim(),
                    sehir: document.getElementById('profileSehir').value.trim(),
                    dogumTarihi: document.getElementById('profileDogumTarihi').value,
                    sertifikalar: document.getElementById('profileSertifika').value.trim(),
                    hobiler: document.getElementById('profileHobiler').value.trim(),
                    photoUrl: photoUrlToSave,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                };
            }
            try {
                const snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                if (!snap.empty) {
                    await db.collection('userProfiles').doc(snap.docs[0].id).update(data);
                } else {
                    data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
                    await db.collection('userProfiles').add(data);
                    if (typeof incrementTotalMemberCount === 'function') incrementTotalMemberCount();
                }
                if (kaydetBtn) kaydetBtn.disabled = false;
                closeProfileModal();
            } catch (e) {
                console.error('Profil kaydetme:', e);
                alert('Kayıt sırasında hata oluştu.');
                if (kaydetBtn) kaydetBtn.disabled = false;
            }
        }

        function profilePhotoAdd() {
            document.getElementById('profilePhotoInput').click();
        }

        document.getElementById('profilePhotoInput').addEventListener('change', async function(e) {
            const file = e.target.files && e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            const imgEl = document.getElementById('profilePhotoImg');
            const phEl = document.getElementById('profilePhotoPlaceholder');
            const reader = new FileReader();
            reader.onload = function() {
                imgEl.src = reader.result;
                imgEl.style.display = 'block';
                phEl.style.display = 'none';
            };
            reader.readAsDataURL(file);
            try {
                const user = auth.currentUser;
                if (user && typeof storage !== 'undefined') {
                    var blob = await compressImageBlob(file, PROFILE_PHOTO_MAX_WIDTH, IMAGE_QUALITY);
                    const ref = storage.ref('profiles/' + user.uid + '/photo.jpg');
                    await ref.put(blob);
                    const url = await ref.getDownloadURL();
                    imgEl.src = url;
                } else if (user && typeof storage === 'undefined') {
                    console.warn('Firebase Storage kullanılamıyor; fotoğraf Kaydet\'e basınca yüklenecek.');
                }
            } catch (err) {
                console.error('Storage yükleme:', err);
                var msg = (err && err.message) ? err.message : '';
                var code = (err && err.code) ? err.code : '';
                if (code === 'storage/unauthorized' || msg.indexOf('403') !== -1 || msg.indexOf('Permission') !== -1)
                    alert('Fotoğraf yüklenemedi: İzin hatası. Firebase Console > Storage > Rules bölümünde giriş yapan kullanıcıya izin verin (profiles/{userId} için read, write).');
                else
                    alert('Fotoğraf yüklenemedi: ' + (msg || code || 'Bağlantı veya izin kontrol edin.') + ' Kaydet butonuna basınca tekrar denenecek.');
            }
            e.target.value = '';
        });

        function profilePhotoRemoveConfirm() {
            document.getElementById('profileRemoveConfirm').classList.add('open');
        }

        function profilePhotoRemoveNo() {
            document.getElementById('profileRemoveConfirm').classList.remove('open');
        }

        async function profilePhotoRemoveYes() {
            document.getElementById('profileRemoveConfirm').classList.remove('open');
            document.getElementById('profilePhotoImg').src = '';
            document.getElementById('profilePhotoImg').style.display = 'none';
            document.getElementById('profilePhotoPlaceholder').style.display = 'block';
        }

        /* ARKADAŞLARIM */
        function friendsModalBack() {
            friendsSwitchTab('takip_edilen');
        }
        function friendsModalMinimize() {
            const inner = document.getElementById('friendsModalInner');
            if (inner) inner.classList.toggle('friends-small');
        }
        function friendsModalDock() {
            const modal = document.getElementById('friendsModal');
            const icon = document.getElementById('friendsDockIcon');
            if (!modal || !icon) return;
            const isDocked = modal.classList.toggle('friends-docked');
            icon.className = isDocked ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            icon.title = isDocked ? 'Yukarı aç' : 'Aşağı indir';
        }
        document.getElementById('friendsModal').querySelector('.friends-modal-header').addEventListener('click', function(e) {
            if (document.getElementById('friendsModal').classList.contains('friends-docked') && !e.target.closest('.friends-modal-header-btns')) friendsModalDock();
        });
        async function openFriendsModal() {
            const user = auth.currentUser;
            if (!user) { alert('Arkadaşlar için önce giriş yapmanız gerekiyor.'); return; }
            const modal = document.getElementById('friendsModal');
            const inner = document.getElementById('friendsModalInner');
            const icon = document.getElementById('friendsDockIcon');
            if (modal) { modal.classList.remove('friends-docked'); modal.classList.add('open'); modal.style.display = 'flex'; }
            if (inner) inner.classList.remove('friends-small');
            if (icon) { icon.className = 'fas fa-chevron-down'; icon.title = 'Aşağı indir / Yukarı aç'; }
            document.querySelector('.friends-tab[data-tab="takip_edilen"]').classList.add('active');
            document.querySelectorAll('.friends-tab').forEach(function(t){ if (t.getAttribute('data-tab') !== 'takip_edilen') t.classList.remove('active'); });
            document.getElementById('friendsListPanel').style.display = 'block';
            document.getElementById('friendsTakipciPanel').style.display = 'none';
            document.getElementById('friendsNotifyPanel').style.display = 'none';
            document.getElementById('friendsSearchPanel').style.display = 'none';
            await refreshFriendsBadge();
            await loadFriendsList();
            await loadFriendsNotifications();
        }

        function closeFriendsModal() {
            document.getElementById('friendsModal').classList.remove('open');
            document.getElementById('friendsModal').style.display = 'none';
        }

        function openDetayliAramaModal() {
            document.getElementById('detayliAramaModal').classList.add('open');
            document.getElementById('detayliAramaModal').style.display = 'flex';
            document.getElementById('detayliAramaList').innerHTML = '';
            document.getElementById('detayliAramaKurum').value = '';
            document.getElementById('detayliAramaUniversite').value = '';
            fillDetayliAramaCities();
            document.getElementById('detayliAramaSehir').value = '';
        }

        function closeDetayliAramaModal() {
            document.getElementById('detayliAramaModal').classList.remove('open');
            document.getElementById('detayliAramaModal').style.display = 'none';
        }

        function detayliAramaNormalize(str) {
            if (!str || typeof str !== 'string') return '';
            return str.trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
        }

        async function detayliAramaSearch() {
            const kurum = detayliAramaNormalize(document.getElementById('detayliAramaKurum').value || '');
            const universite = detayliAramaNormalize(document.getElementById('detayliAramaUniversite').value || '');
            const sehir = detayliAramaNormalize(document.getElementById('detayliAramaSehir').value || '');
            if (!kurum && !universite && !sehir) {
                alert('En az bir alan doldurun: Kurum/Firma, Üniversite veya Şehir.');
                return;
            }
            const user = auth.currentUser;
            if (!user) return;
            const listEl = document.getElementById('detayliAramaList');
            listEl.innerHTML = '<div class="friends-empty">Aranıyor...</div>';
            try {
                const blockedMeSnap = await db.collection('userBlocks').where('blockedUserId','==',user.uid).get();
                const blockedMeIds = new Set(blockedMeSnap.docs.map(d => d.data().userId));
                const snap = await db.collection('userProfiles').get();
                const results = snap.docs.filter(d => {
                    const p = d.data();
                    if (p.userId === user.uid) return false;
                    if (blockedMeIds.has(p.userId)) return false;
                    const k = detayliAramaNormalize(p.kurum || '');
                    const u = detayliAramaNormalize(p.universite || '');
                    const s = detayliAramaNormalize(p.sehir || '');
                    if (kurum && !k.includes(kurum)) return false;
                    if (universite && !u.includes(universite)) return false;
                    if (sehir && !s.includes(sehir)) return false;
                    return true;
                });
                listEl.innerHTML = '';
                if (results.length === 0) { listEl.innerHTML = '<div class="friends-empty">Sonuç bulunamadı.</div>'; return; }
                for (const d of results) {
                    const p = d.data();
                    const fid = p.userId;
                    const item = document.createElement('div');
                    item.className = 'detayli-arama-item';
                    item.innerHTML = '<img class="detayli-arama-item-avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><span class="detayli-arama-item-name">' + (p.adSoyad || 'İsimsiz') + '</span>';
                    item.onclick = function() { closeDetayliAramaModal(); viewFriendProfile(fid); };
                    listEl.appendChild(item);
                }
            } catch (e) { listEl.innerHTML = '<div class="friends-empty">Arama sırasında hata oluştu.</div>'; }
        }

        /* BİLDİRİMLER PANELİ */
        var notificationsPanelMinimized = false;
        function openNotificationsPanel() {
            var user = auth.currentUser;
            if (!user) { alert('Bildirimler için önce giriş yapmanız gerekiyor.'); return; }
            var modal = document.getElementById('notificationsPanelModal');
            var inner = document.getElementById('notificationsPanelInner');
            if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
            if (inner) inner.classList.remove('notifications-panel-small');
            notificationsPanelMinimized = false;
            var listEl = document.getElementById('notificationsPanelList');
            if (listEl) listEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            setTimeout(function() { loadAllNotificationsPanel(); }, 0);
        }
        function closeNotificationsPanel() {
            var modal = document.getElementById('notificationsPanelModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        function openAyarlarModal() {
            var modal = document.getElementById('ayarlarModal');
            if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
            ayarlarShowSection('gizlilik');
        }
        function closeAyarlarModal() {
            var modal = document.getElementById('ayarlarModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        function openKredilerPopup() {
            var popup = document.getElementById('kredilerPopup');
            var socialList = document.getElementById('socialNetworkList');
            if (popup) { popup.classList.add('open'); popup.style.display = 'flex'; popup.style.visibility = 'visible'; }
            if (socialList) socialList.classList.remove('open');
        }
        function closeKredilerPopup() {
            var popup = document.getElementById('kredilerPopup');
            if (popup) { popup.classList.remove('open'); popup.style.display = 'none'; }
        }
        var currentKredilerSection = 'hesaplama';
        var currentKullandigimView = 'form';
        var currentKullandigimEditId = null;
        var krediTuruListeEtiketleri = { ihtiyac: 'İhtiyaç Kredisi', tasit: 'Taşıt Kredisi', konut: 'Konut Kredisi', ticari: 'Ticari Kredi', kobi: 'Kobi Kredisi', proje: 'Proje Kredisi' };
        function kredilerPanelIds(panel) {
            var p = panel || 'hesaplama';
            return p === 'kullandigim' ? { paraBirimi:'kullandigimKrediParaBirimi', tarih:'kullandigimKrediTarih', turu:'kullandigimKrediTuru', tutar:'kullandigimKrediTutar', faiz:'kullandigimKrediFaizOrani', vade:'kullandigimKrediVade', aylikTaksit:'kullandigimKrediAylikTaksit', aylikFaiz:'kullandigimKrediAylikFaiz', toplamFaiz:'kullandigimKrediToplamFaiz', geriOdenecek:'kullandigimKrediGeriOdenecek', tbody:'kullandigimKrediItfaTableBody', grafikBtn:'kullandigimKrediGrafikAcBtn' } : { paraBirimi:'krediParaBirimi', tarih:'krediTarih', turu:'krediTuru', tutar:'krediTutar', faiz:'krediFaizOrani', vade:'krediVade', aylikTaksit:'krediAylikTaksit', aylikFaiz:'krediAylikFaiz', toplamFaiz:'krediToplamFaiz', geriOdenecek:'krediGeriOdenecek', tbody:'krediItfaTableBody', grafikBtn:'krediGrafikAcBtn' };
        }
        function openKredilerModal(sectionKey) {
            closeKredilerPopup();
            currentKredilerSection = sectionKey || 'hesaplama';
            currentKullandigimView = 'form';
            currentKullandigimEditId = null;
            var panelH = document.getElementById('kredilerPanelHesaplama');
            var panelK = document.getElementById('kredilerPanelKullandigim');
            if (panelH) { panelH.style.display = currentKredilerSection === 'hesaplama' ? '' : 'none'; panelH.style.visibility = currentKredilerSection === 'hesaplama' ? '' : 'hidden'; }
            if (panelK) { panelK.style.display = currentKredilerSection === 'kullandigim' ? '' : 'none'; panelK.style.visibility = currentKredilerSection === 'kullandigim' ? '' : 'hidden'; }
            var formView = document.getElementById('kullandigimFormView');
            var listView = document.getElementById('kullandigimListView');
            if (formView) formView.style.display = '';
            if (listView) listView.style.display = 'none';
            var kaydetBtn = document.getElementById('kullandigimKrediKaydetBtn');
            if (kaydetBtn) { kaydetBtn.textContent = ''; kaydetBtn.innerHTML = '<i class="fas fa-save"></i> Kaydet'; kaydetBtn.onclick = function() { kullandigimKrediKaydet(); }; }
            var modal = document.getElementById('kredilerModal');
            if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
            var contentWrap = document.querySelector('.krediler-content');
            if (contentWrap) contentWrap.scrollTop = 0;
            var ids = kredilerPanelIds(currentKredilerSection);
            var tutarEl = document.getElementById(ids.tutar);
            if (typeof formatKrediTutarBinlik === 'function' && tutarEl) formatKrediTutarBinlik(tutarEl);
            krediHesapla(currentKredilerSection);
        }
        function closeKredilerModal() {
            var modal = document.getElementById('kredilerModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        function kredilerModalGeri() {
            if (currentKredilerSection === 'kullandigim' && currentKullandigimView === 'list') {
                kullandigimListGeri();
                return;
            }
            closeKredilerModal();
            openKredilerPopup();
        }
        function kullandigimListGeri() {
            currentKullandigimView = 'form';
            var formView = document.getElementById('kullandigimFormView');
            var listView = document.getElementById('kullandigimListView');
            if (formView) formView.style.display = '';
            if (listView) listView.style.display = 'none';
        }
        async function openKullandigimKaydedilenler() {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) {
                alert('Kaydedilenleri görmek için giriş yapmanız gerekiyor.');
                return;
            }
            currentKullandigimView = 'list';
            var formView = document.getElementById('kullandigimFormView');
            var listView = document.getElementById('kullandigimListView');
            var container = document.getElementById('kullandigimListContainer');
            if (formView) formView.style.display = 'none';
            if (listView) listView.style.display = '';
            if (!container) return;
            container.innerHTML = '<p style="color:#8fd3ff; padding:16px;">Yükleniyor…</p>';
            try {
                var snap = await db.collection('userCredits').where('userId', '==', user.uid).get();
                var docs = snap.docs.slice();
                docs.sort(function(a, b) {
                    var ta = a.data().createdAt;
                    var tb = b.data().createdAt;
                    var ma = (ta && typeof ta.toMillis === 'function') ? ta.toMillis() : (ta || 0);
                    var mb = (tb && typeof tb.toMillis === 'function') ? tb.toMillis() : (tb || 0);
                    return mb - ma;
                });
                if (docs.length === 0) {
                    container.innerHTML = '<p style="color:#8fd3ff; padding:16px;">Henüz kayıtlı kredi yok. Kullandığım Krediler formunda hesaplama yapıp Kaydet ile ekleyebilirsiniz.</p>';
                    return;
                }
                var html = '';
                docs.forEach(function(doc) {
                    var d = doc.data();
                    var id = doc.id;
                    var turu = krediTuruListeEtiketleri[d.krediTuru] || d.krediTuru || 'Kredi';
                    var tutar = (d.tutar != null) ? Number(d.tutar).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
                    var tarih = (d.tarih || '').toString();
                    if (tarih.length >= 10) tarih = tarih.slice(8, 10) + '.' + tarih.slice(5, 7) + '.' + tarih.slice(0, 4);
                    var paraBirimi = (d.paraBirimi || 'TL').toString();
                    var baslik = turu + ' — ' + tutar + ' ' + paraBirimi + (tarih ? ' — ' + tarih : '');
                    html += '<div class="kullandigim-list-item" data-doc-id="' + id + '" style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; margin-bottom:8px; background:rgba(13,27,77,0.5); border:1px solid rgba(42,168,255,0.3); border-radius:10px;">';
                    html += '<span class="kullandigim-list-baslik" style="flex:1; color:#e0eaff; font-weight:500;">' + baslik + '</span>';
                    html += '<div class="kullandigim-list-actions" style="display:flex; gap:8px;">';
                    html += '<button type="button" class="kullandigim-btn-edit" onclick="editKullandigimKredi(\'' + id + '\')" title="Düzenle"><i class="fas fa-edit"></i> Düzenle</button>';
                    html += '<button type="button" class="kullandigim-btn-delete" onclick="deleteKullandigimKredi(\'' + id + '\')" title="Sil"><i class="fas fa-trash-alt"></i> Sil</button>';
                    html += '</div></div>';
                });
                container.innerHTML = html;
            } catch (err) {
                console.error(err);
                container.innerHTML = '<p style="color:#f87171; padding:16px;">Liste yüklenirken hata: ' + (err.message || 'Bilinmeyen hata') + '</p>';
            }
        }
        window.openKullandigimKaydedilenler = openKullandigimKaydedilenler;
        function deleteKullandigimKredi(docId) {
            if (!docId || !confirm('Bu kaydı silmek istediğinize emin misiniz? Nakit akış tablosundaki ilgili veri de güncellenecektir.')) return;
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) return;
            db.collection('userCredits').doc(docId).get().then(function(doc) {
                var tarih = doc.exists && doc.data().tarih ? String(doc.data().tarih).slice(0, 4) : null;
                return db.collection('userCredits').doc(docId).delete().then(function() {
                    if (tarih && typeof refreshCashFlowUsedCreditsForYear === 'function') refreshCashFlowUsedCreditsForYear(parseInt(tarih, 10));
                    openKullandigimKaydedilenler();
                });
            }).catch(function(err) {
                console.error(err);
                alert('Silme hatası: ' + (err.message || 'Bilinmeyen hata'));
            });
        }
        window.deleteKullandigimKredi = deleteKullandigimKredi;
        async function editKullandigimKredi(docId) {
            if (!docId) return;
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) return;
            try {
                var doc = await db.collection('userCredits').doc(docId).get();
                if (!doc.exists) {
                    alert('Kayıt bulunamadı.');
                    return;
                }
                var d = doc.data();
                currentKullandigimEditId = docId;
                var ids = kredilerPanelIds('kullandigim');
                var setEl = function(id, val) {
                    var el = document.getElementById(id);
                    if (el) { el.value = val != null ? String(val) : ''; }
                };
                setEl(ids.paraBirimi, d.paraBirimi || 'TL');
                setEl(ids.tarih, (d.tarih || '').toString().slice(0, 10));
                setEl(ids.turu, d.krediTuru || 'ihtiyac');
                var tutarNum = (d.tutar != null) ? Number(d.tutar) : 0;
                setEl(ids.tutar, tutarNum > 0 ? tutarNum.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(',', ',') : '');
                setEl(ids.faiz, d.faizOrani != null ? d.faizOrani : '');
                setEl(ids.vade, d.vade != null ? d.vade : '');
                setEl(ids.aylikTaksit, d.aylikTaksit != null ? d.aylikTaksit : '');
                setEl(ids.toplamFaiz, d.toplamFaiz != null ? d.toplamFaiz : '');
                setEl(ids.geriOdenecek, d.geriOdenecek != null ? d.geriOdenecek : '');
                if (typeof formatKrediTutarBinlik === 'function') {
                    var tutarEl = document.getElementById(ids.tutar);
                    if (tutarEl) formatKrediTutarBinlik(tutarEl);
                }
                if (Array.isArray(d.itfaPlan) && d.itfaPlan.length > 0) {
                    var tbody = document.getElementById(ids.tbody);
                    if (tbody) {
                        var fmt = function(x) { return Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
                        var rows = [];
                        d.itfaPlan.forEach(function(p, idx) {
                            var odeme = (p.anapara || 0) + (p.faiz || 0);
                            var tarihStr = (p.tarih || '').toString();
                            if (tarihStr.length >= 10) tarihStr = tarihStr.slice(8, 10) + '.' + tarihStr.slice(5, 7) + '.' + tarihStr.slice(0, 4);
                            rows.push('<tr><td>' + (idx + 1) + '</td><td>' + fmt(odeme) + '</td><td>' + fmt(p.anapara) + '</td><td>' + fmt(p.faiz) + '</td><td>—</td><td>' + tarihStr + '</td></tr>');
                        });
                        tbody.innerHTML = rows.join('');
                    }
                    var grafikBtn = document.getElementById(ids.grafikBtn);
                    if (grafikBtn) grafikBtn.disabled = false;
                }
                kullandigimListGeri();
                var kaydetBtn = document.getElementById('kullandigimKrediKaydetBtn');
                if (kaydetBtn) {
                    kaydetBtn.textContent = '';
                    kaydetBtn.innerHTML = '<i class="fas fa-save"></i> Güncelle';
                    kaydetBtn.onclick = function() { kullandigimKrediKaydet(); };
                }
            } catch (err) {
                console.error(err);
                alert('Düzenleme yüklenirken hata: ' + (err.message || 'Bilinmeyen hata'));
            }
        }
        window.editKullandigimKredi = editKullandigimKredi;
        function krediHesapla(panel) {
            var p = panel || 'hesaplama';
            var ids = kredilerPanelIds(p);
            var tutarEl = document.getElementById(ids.tutar);
            var faizEl = document.getElementById(ids.faiz);
            var vadeEl = document.getElementById(ids.vade);
            var aylikTaksitEl = document.getElementById(ids.aylikTaksit);
            var aylikFaizEl = document.getElementById(ids.aylikFaiz);
            var toplamFaizEl = document.getElementById(ids.toplamFaiz);
            var geriOdenecekEl = document.getElementById(ids.geriOdenecek);
            if (!tutarEl || !faizEl || !vadeEl || !aylikTaksitEl || !toplamFaizEl || !geriOdenecekEl) return;
            if (typeof formatKrediTutarBinlik === 'function') formatKrediTutarBinlik(tutarEl);
            var P = parseFloat(String(tutarEl.value).replace(/\./g, '').replace(',', '.').replace(/\s/g, '')) || 0;
            var faizAylik = parseFloat(String(faizEl.value).replace(',', '.').replace(/\s/g, '')) || 0;
            var n = parseInt(vadeEl.value, 10) || 0;
            var tbody = document.getElementById(ids.tbody);
            var tarihEl = document.getElementById(ids.tarih);
            if (P <= 0 || n <= 0) {
                aylikTaksitEl.value = ''; aylikTaksitEl.placeholder = '—';
                if (aylikFaizEl) { aylikFaizEl.value = ''; aylikFaizEl.placeholder = '—'; }
                toplamFaizEl.value = ''; toplamFaizEl.placeholder = '—';
                geriOdenecekEl.value = ''; geriOdenecekEl.placeholder = '—';
                if (tbody) { tbody.innerHTML = '<tr><td colspan="6" class="kredi-itfa-bos">Kredi tutarı, faiz oranı ve vade girip hesaplama yaptığınızda ödeme planı burada listelenecektir.</td></tr>'; }
                if (p === 'kullandigim') window.kullandigimKrediGrafikVerisi = null; else window.krediGrafikVerisi = null;
                var btn = document.getElementById(ids.grafikBtn);
                if (btn) btn.disabled = true;
                return;
            }
            function tarihSatir(ay) {
                var baslangic = tarihEl && tarihEl.value ? new Date(tarihEl.value + 'T12:00:00') : new Date();
                if (isNaN(baslangic.getTime())) baslangic = new Date();
                var d = new Date(baslangic.getFullYear(), baslangic.getMonth() + (ay - 1), baslangic.getDate());
                var gun = ('0' + d.getDate()).slice(-2);
                var ayStr = ('0' + (d.getMonth() + 1)).slice(-2);
                return gun + '.' + ayStr + '.' + d.getFullYear();
            }
            var r = faizAylik / 100;
            var A;
            if (r === 0) {
                A = P / n;
            } else {
                var q = Math.pow(1 + r, n);
                A = P * (r * q) / (q - 1);
            }
            var toplam = A * n;
            var toplamFaiz = toplam - P;
            var aylikFaizOrt = toplamFaiz / n;
            function fmt(x) { return Number(x).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
            aylikTaksitEl.value = fmt(A); aylikTaksitEl.placeholder = '';
            if (aylikFaizEl) { aylikFaizEl.value = fmt(aylikFaizOrt); aylikFaizEl.placeholder = ''; }
            toplamFaizEl.value = fmt(toplamFaiz); toplamFaizEl.placeholder = '';
            geriOdenecekEl.value = fmt(toplam); geriOdenecekEl.placeholder = '';
            if (tbody) {
                var balance = P;
                var sumAnapara = 0; var sumFaiz = 0;
                var rows = [];
                var aylikAnapara = [];
                var aylikFaiz = [];
                for (var ay = 1; ay <= n; ay++) {
                    var faiz = balance * r;
                    var anapara; var odeme;
                    if (ay === n) {
                        anapara = balance;
                        odeme = faiz + anapara;
                        balance = 0;
                    } else {
                        anapara = A - faiz;
                        odeme = A;
                        balance = balance - anapara;
                    }
                    sumAnapara += anapara; sumFaiz += faiz;
                    aylikAnapara.push(anapara);
                    aylikFaiz.push(faiz);
                    rows.push('<tr><td>' + ay + '</td><td>' + fmt(odeme) + '</td><td>' + fmt(anapara) + '</td><td>' + fmt(faiz) + '</td><td>' + fmt(balance) + '</td><td>' + tarihSatir(ay) + '</td></tr>');
                }
                rows.push('<tr class="kredi-itfa-toplam"><td>Toplam</td><td>' + fmt(sumAnapara + sumFaiz) + '</td><td>' + fmt(sumAnapara) + '</td><td>' + fmt(sumFaiz) + '</td><td>0,00</td><td>—</td></tr>');
                tbody.innerHTML = rows.join('');
                if (p === 'kullandigim') window.kullandigimKrediGrafikVerisi = { n: n, anapara: aylikAnapara, faiz: aylikFaiz, toplam: toplam }; else window.krediGrafikVerisi = { n: n, anapara: aylikAnapara, faiz: aylikFaiz, toplam: toplam };
                var btn = document.getElementById(ids.grafikBtn);
                if (btn) btn.disabled = false;
            }
        }
        function openKrediGrafikPencere(panel) {
            var p = panel || 'hesaplama';
            var v = p === 'kullandigim' ? window.kullandigimKrediGrafikVerisi : window.krediGrafikVerisi;
            if (!v || !v.n || !v.anapara || !v.faiz) {
                alert('Önce kredi hesaplaması yapın (Kredi Tutarı, Faiz Oranı ve Vade girin).');
                return;
            }
            var n = v.n;
            var anapara = v.anapara;
            var faiz = v.faiz;
            var P = 0;
            for (var idx = 0; idx < n; idx++) P += anapara[idx];
            var bakiye = [P];
            for (var idx = 0; idx < n; idx++) bakiye.push(bakiye[bakiye.length - 1] - anapara[idx]);
            var maxVal = 0;
            for (var i = 0; i < n; i++) { var t = anapara[i] + faiz[i]; if (t > maxVal) maxVal = t; }
            if (maxVal <= 0) maxVal = 1;
            var stepY = Math.pow(10, Math.floor(Math.log10(maxVal)));
            if (maxVal / stepY > 6) stepY *= 2;
            if (maxVal / stepY < 3 && stepY > 1) stepY /= 2;
            var yMax = Math.ceil((maxVal * 1.02) / stepY) * stepY;
            var yTicks = [];
            for (var vv = 0; vv <= yMax; vv += stepY) yTicks.push(vv);
            function fmtNum(x) { return Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 0, minimumFractionDigits: 0 }); }
            var chartW = 720;
            var chartH = 380;
            var chart2H = 280;
            var margin = { top: 48, right: 32, bottom: 52, left: 72 };
            var gW = chartW - margin.left - margin.right;
            var gH = chartH - margin.top - margin.bottom;
            var barGroupWidth = gW / n;
            var gap = Math.min(4, barGroupWidth * 0.12);
            var barWidth = (barGroupWidth - gap) / 2;
            var scaleY = gH / yMax;
            var yBase = chartH - margin.bottom;
            var css = 'body{margin:0;background:linear-gradient(165deg,#05103a 0%,#0a1645 50%,#05103a 100%);color:#fff;font-family:\'Segoe UI\',system-ui,sans-serif;padding:24px 16px 32px;min-height:100vh;}';
            css += '.card{background:rgba(13,27,77,0.4);border:1px solid rgba(42,168,255,0.2);border-radius:16px;padding:24px;margin-bottom:24px;box-shadow:0 8px 32px rgba(0,0,0,0.3);}';
            css += 'h1{text-align:center;font-size:20px;font-weight:700;margin:0 0 8px 0;letter-spacing:0.02em;color:#fff;}';
            css += '.sub{text-align:center;font-size:13px;color:#8fd3ff;margin-bottom:20px;opacity:0.9;}';
            css += '.legend{display:flex;justify-content:center;gap:28px;margin-bottom:20px;flex-wrap:wrap;}';
            css += '.legend span{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#e0eaff;}';
            css += '.legend i{width:16px;height:16px;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,0.25);}';
            css += 'svg{display:block;margin:0 auto;}';
            css += '.grid line{stroke:rgba(42,168,255,0.12);stroke-width:1;}';
            css += '.axis line{stroke:rgba(42,168,255,0.35);stroke-width:1.5;}';
            css += '.axis text{fill:#fff;font-size:11px;font-weight:500;}';
            css += '.y-label{fill:#b8dfff;font-size:12px;font-weight:600;}';
            css += '.x-label{fill:#b8dfff;font-size:12px;font-weight:600;}';
            css += '.bar-anapara{fill:url(#gradOrange);}';
            css += '.bar-faiz{fill:url(#gradGreen);}';
            css += '.chart-title{font-size:14px;font-weight:700;color:#8fd3ff;margin:0 0 16px 0;padding-left:4px;}';
            css += '.popup-header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:rgba(13,27,77,0.7);border-bottom:1px solid rgba(42,168,255,0.3);margin-bottom:20px;border-radius:10px;}';
            css += '.popup-header .popup-title{font-size:14px;font-weight:600;color:#8fd3ff;}';
            css += '.popup-header-btns{display:flex;align-items:center;gap:8px;}';
            css += '.popup-header-btns button{background:rgba(42,168,255,0.2);border:1px solid rgba(42,168,255,0.4);color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:6px;}';
            css += '.popup-header-btns button:hover{background:rgba(42,168,255,0.4);}';
            css += '.popup-header-btns .btn-close{padding:8px 12px;}';
            var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kredi Ödeme Grafiği</title><style>' + css + '</style></head><body>';
            html += '<div class="popup-header"><span class="popup-title">Kredi Ödeme Grafiği</span><div class="popup-header-btns"><button type="button" onclick="window.close()" title="Geri"><span style="margin-right:4px;">←</span> Geri</button><button type="button" class="btn-close" onclick="window.close()" title="Kapat">✕</button></div></div>';
            html += '<div class="card"><h1>Kredi Ödeme Planı</h1><p class="sub">Aylık Anapara ve Faiz Dağılımı</p><div class="legend"><span><i style="background:linear-gradient(135deg,#ff9f40,#ffb366);"></i> Anapara</span><span><i style="background:linear-gradient(135deg,#22c55e,#4ade80);"></i> Faiz</span></div>';
            html += '<svg width="' + chartW + '" height="' + chartH + '" viewBox="0 0 ' + chartW + ' ' + chartH + '">';
            html += '<defs><linearGradient id="gradOrange" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#e07820"/><stop offset="1" stop-color="#ff9f40"/></linearGradient>';
            html += '<linearGradient id="gradGreen" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#16a34a"/><stop offset="1" stop-color="#4ade80"/></linearGradient>';
            html += '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/></filter></defs>';
            for (var ti = 0; ti < yTicks.length; ti++) {
                var yy = yBase - yTicks[ti] * scaleY;
                if (yy >= margin.top - 2) {
                    html += '<line class="grid" x1="' + margin.left + '" y1="' + yy + '" x2="' + (chartW - margin.right) + '" y2="' + yy + '"/>';
                    html += '<text class="axis" x="' + (margin.left - 8) + '" y="' + (yy + 4) + '" text-anchor="end" fill="#ffffff">' + fmtNum(yTicks[ti]) + '</text>';
                }
            }
            html += '<line class="axis" x1="' + margin.left + '" y1="' + margin.top + '" x2="' + margin.left + '" y2="' + yBase + '"/>';
            html += '<line class="axis" x1="' + margin.left + '" y1="' + yBase + '" x2="' + (chartW - margin.right) + '" y2="' + yBase + '"/>';
            html += '<text class="y-label" x="' + (margin.left - 52) + '" y="' + (margin.top + gH/2) + '" text-anchor="middle" fill="#ffffff" transform="rotate(-90 ' + (margin.left - 52) + ' ' + (margin.top + gH/2) + ')">Toplam Tutar</text>';
            html += '<text class="x-label" x="' + (margin.left + gW/2) + '" y="' + (chartH - 12) + '" text-anchor="middle" fill="#ffffff">Vade (Ay)</text>';
            for (var i = 0; i < n; i++) {
                var x0 = margin.left + (i + 0.5) * (gW / n) - barGroupWidth / 2;
                var hAnapara = anapara[i] * scaleY;
                var hFaiz = faiz[i] * scaleY;
                if (hAnapara > 0.5) html += '<rect class="bar-anapara" rx="4" filter="url(#shadow)" x="' + x0 + '" y="' + (yBase - hAnapara) + '" width="' + barWidth + '" height="' + Math.max(0.5, hAnapara) + '"/>';
                if (hFaiz > 0.5) html += '<rect class="bar-faiz" rx="4" filter="url(#shadow)" x="' + (x0 + barWidth + gap) + '" y="' + (yBase - hFaiz) + '" width="' + barWidth + '" height="' + Math.max(0.5, hFaiz) + '"/>';
                var ax = margin.left + (i + 0.5) * (gW / n);
                var showAx = (n <= 24) || (i % Math.ceil(n / 24) === 0) || (i === n - 1);
                if (showAx) html += '<text class="axis" x="' + ax + '" y="' + (chartH - margin.bottom + 20) + '" text-anchor="middle" fill="#ffffff">' + (i + 1) + '</text>';
            }
            html += '</svg></div>';
            var m2 = { top: 40, right: 32, bottom: 44, left: 72 };
            var gW2 = chartW - m2.left - m2.right;
            var gH2 = chart2H - m2.top - m2.bottom;
            var maxB = P;
            var scaleB = gH2 / maxB;
            var pts = [];
            for (var j = 0; j < bakiye.length; j++) {
                var px = m2.left + (bakiye.length > 1 ? (j / (bakiye.length - 1)) * gW2 : 0);
                var py = chart2H - m2.bottom - bakiye[j] * scaleB;
                pts.push(px + ',' + py);
            }
            var areaD = 'M' + m2.left + ',' + (chart2H - m2.bottom) + ' L' + pts.join(' L') + ' L' + (m2.left + gW2) + ',' + (chart2H - m2.bottom) + ' Z';
            html += '<div class="card"><p class="chart-title">Kalan Bakiye (Aylara Göre)</p>';
            html += '<svg width="' + chartW + '" height="' + chart2H + '" viewBox="0 0 ' + chartW + ' ' + chart2H + '">';
            html += '<defs><linearGradient id="gradArea" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2aa8ff" stop-opacity="0.15"/><stop offset="1" stop-color="#2aa8ff" stop-opacity="0.5"/></linearGradient></defs>';
            var stepB = Math.pow(10, Math.floor(Math.log10(maxB)));
            if (maxB / stepB > 5) stepB *= 2;
            if (maxB / stepB < 2 && stepB > 1) stepB /= 2;
            var bMax = Math.ceil((maxB * 1.02) / stepB) * stepB;
            for (var vb = 0; vb <= bMax; vb += stepB) {
                var yb = chart2H - m2.bottom - (vb / bMax) * gH2;
                if (yb >= m2.top) html += '<line class="grid" x1="' + m2.left + '" y1="' + yb + '" x2="' + (chartW - m2.right) + '" y2="' + yb + '"/>';
                html += '<text class="axis" x="' + (m2.left - 8) + '" y="' + (yb + 4) + '" text-anchor="end" fill="#ffffff">' + fmtNum(vb) + '</text>';
            }
            html += '<line class="axis" x1="' + m2.left + '" y1="' + m2.top + '" x2="' + m2.left + '" y2="' + (chart2H - m2.bottom) + '"/>';
            html += '<line class="axis" x1="' + m2.left + '" y1="' + (chart2H - m2.bottom) + '" x2="' + (chartW - m2.right) + '" y2="' + (chart2H - m2.bottom) + '"/>';
            html += '<text class="y-label" x="' + (m2.left - 52) + '" y="' + (m2.top + gH2/2) + '" text-anchor="middle" fill="#ffffff" transform="rotate(-90 ' + (m2.left - 52) + ' ' + (m2.top + gH2/2) + ')">Kalan Bakiye</text>';
            html += '<text class="x-label" x="' + (m2.left + gW2/2) + '" y="' + (chart2H - 8) + '" text-anchor="middle" fill="#ffffff">Vade (Ay)</text>';
            html += '<path d="' + areaD + '" fill="url(#gradArea)"/>';
            html += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#2aa8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
            html += '</svg></div></body></html>';
            var w = window.open('', 'krediGrafik', 'width=780,height=920,scrollbars=yes,resizable=yes');
            w.document.write(html);
            w.document.close();
        }
        function krediItfaExcelIndir(panel) {
            var p = panel || 'hesaplama';
            var table = p === 'kullandigim' ? (function() { var tb = document.getElementById('kullandigimKrediItfaTableBody'); return tb ? tb.closest('table') : null; }()) : document.getElementById('krediItfaTable');
            if (!table) return;
            var tbody = table.querySelector('tbody');
            var thead = table.querySelector('thead tr');
            if (!thead || !tbody) return;
            var firstRow = tbody.querySelector('tr');
            if (firstRow && firstRow.querySelector('td[colspan]')) {
                alert('Önce kredi hesaplaması yapıp ödeme planını oluşturun.');
                return;
            }
            var headers = [];
            thead.querySelectorAll('th').forEach(function(th) { headers.push(th.textContent.trim()); });
            var rows = [];
            tbody.querySelectorAll('tr').forEach(function(tr) {
                var cells = tr.querySelectorAll('td');
                if (cells.length < 6) return;
                var row = [];
                cells.forEach(function(td) { row.push(td.textContent.trim().replace(/;/g, ',')); });
                rows.push(row);
            });
            var csv = '\uFEFF';
            csv += headers.join(';') + '\r\n';
            rows.forEach(function(row) { csv += row.join(';') + '\r\n'; });
            var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'kredi-itfa-tablosu.csv';
            a.click();
            URL.revokeObjectURL(a.href);
        }
        function krediItfaPDFIndir(panel) {
            var p = panel || 'hesaplama';
            var table = p === 'kullandigim' ? (function() { var tb = document.getElementById('kullandigimKrediItfaTableBody'); return tb ? tb.closest('table') : null; }()) : document.getElementById('krediItfaTable');
            if (!table) return;
            var tbody = table.querySelector('tbody');
            var thead = table.querySelector('thead tr');
            if (!thead || !tbody) return;
            var firstRow = tbody.querySelector('tr');
            if (firstRow && firstRow.querySelector('td[colspan]')) {
                alert('Önce kredi hesaplaması yapıp ödeme planını oluşturun.');
                return;
            }
            var headers = [];
            thead.querySelectorAll('th').forEach(function(th) { headers.push(th.textContent.trim()); });
            var body = [];
            tbody.querySelectorAll('tr').forEach(function(tr) {
                var cells = tr.querySelectorAll('td');
                if (cells.length < 6) return;
                var row = [];
                cells.forEach(function(td) { row.push(td.textContent.trim()); });
                body.push(row);
            });
            if (body.length === 0) return;
            try {
                var JsPDF = window.jspdf && window.jspdf.jsPDF;
                if (!JsPDF) {
                    ensureJspdfLoaded().then(function() { krediItfaPDFIndir(panel); }).catch(function() {
                        alert('PDF kütüphanesi yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
                    });
                    return;
                }
                var doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
                doc.setFontSize(14);
                doc.text('Kredi İtfa Tablosu (Ödeme Planı)', 14, 12);
                doc.setFontSize(9);
                doc.autoTable({
                    head: [headers],
                    body: body,
                    startY: 18,
                    margin: { left: 14 },
                    theme: 'grid',
                    headStyles: { fillColor: [13, 27, 77], textColor: 255 },
                    alternateRowStyles: { fillColor: [245, 248, 250] },
                    styles: { fontSize: 8, cellPadding: 3 }
                });
                doc.save('kredi-itfa-tablosu.pdf');
            } catch (e) {
                console.error(e);
                alert('PDF oluşturulurken hata: ' + (e.message || 'Bilinmeyen hata'));
            }
        }
        var krediTuruKayitEtiketleri = { ihtiyac: 'İhtiyaç Kredisi Kaydedilen', tasit: 'Taşıt Kredisi Kaydedilen', konut: 'Konut Kredisi Kaydedilen', ticari: 'Ticari Kredi Kaydedilen', kobi: 'Kobi Kredisi Kaydedilen', proje: 'Proje Kredisi Kaydedilen' };
        function krediItfaPlanHesapla(P, faizAylikYuzde, n, baslangicTarih) {
            var r = (parseFloat(String(faizAylikYuzde).replace(',', '.')) || 0) / 100;
            var A; var toplam = P * (1 + r * n);
            if (r === 0) {
                A = P / n;
            } else {
                var q = Math.pow(1 + r, n);
                A = P * (r * q) / (q - 1);
            }
            var plan = [];
            var balance = P;
            var baslangic = baslangicTarih ? new Date(baslangicTarih + 'T12:00:00') : new Date();
            if (isNaN(baslangic.getTime())) baslangic = new Date();
            for (var ay = 1; ay <= n; ay++) {
                var faiz = balance * r;
                var anapara;
                if (ay === n) {
                    anapara = balance;
                    balance = 0;
                } else {
                    anapara = A - faiz;
                    balance = balance - anapara;
                }
                var d = new Date(baslangic.getFullYear(), baslangic.getMonth() + (ay - 1), baslangic.getDate());
                var tarihStr = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
                plan.push({ ay: ay, tarih: tarihStr, anapara: Math.round(anapara * 100) / 100, faiz: Math.round(faiz * 100) / 100 });
            }
            return plan;
        }
        async function kullandigimKrediKaydet() {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) {
                alert('Kredi kaydetmek için önce giriş yapmanız gerekiyor.');
                return;
            }
            var tutarEl = document.getElementById('kullandigimKrediTutar');
            var faizEl = document.getElementById('kullandigimKrediFaizOrani');
            var vadeEl = document.getElementById('kullandigimKrediVade');
            var tarihEl = document.getElementById('kullandigimKrediTarih');
            var turuEl = document.getElementById('kullandigimKrediTuru');
            var aylikTaksitEl = document.getElementById('kullandigimKrediAylikTaksit');
            var toplamFaizEl = document.getElementById('kullandigimKrediToplamFaiz');
            var geriOdenecekEl = document.getElementById('kullandigimKrediGeriOdenecek');
            var paraBirimiEl = document.getElementById('kullandigimKrediParaBirimi');
            if (!tutarEl || !tarihEl || !turuEl) return;
            var tutarStr = String(tutarEl.value || '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
            var tutar = parseFloat(tutarStr);
            if (isNaN(tutar) || tutar <= 0) tutar = 0;
            tutar = Math.round(tutar * 100) / 100;
            var vade = parseInt(String(vadeEl ? vadeEl.value : ''), 10) || 0;
            var tarih = (tarihEl.value || '').trim();
            if (tutar <= 0 || vade <= 0) {
                alert('Kredi tutarı, faiz oranı ve vade girip hesaplama yaptıktan sonra Kaydet\'e tıklayın.');
                return;
            }
            if (!tarih || tarih.length < 10) {
                alert('Kredi kullandırım tarihini seçin (GG.AA.YYYY veya takvimden seçin).');
                return;
            }
            var krediTuru = (turuEl.value || 'ihtiyac').trim();
            var faizOrani = (faizEl && faizEl.value) ? String(faizEl.value).replace(',', '.').trim() : '';
            var aylikTaksit = (aylikTaksitEl && aylikTaksitEl.value) ? String(aylikTaksitEl.value).trim() : '';
            var toplamFaiz = (toplamFaizEl && toplamFaizEl.value) ? String(toplamFaizEl.value).trim() : '';
            var geriOdenecek = (geriOdenecekEl && geriOdenecekEl.value) ? String(geriOdenecekEl.value).trim() : '';
            var paraBirimi = (paraBirimiEl && paraBirimiEl.value) ? String(paraBirimiEl.value) : 'TL';
            var itfaPlan = krediItfaPlanHesapla(tutar, faizOrani, vade, tarih);
            var createdAtValue = null;
            if (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue && firebase.firestore.FieldValue.serverTimestamp) {
                createdAtValue = firebase.firestore.FieldValue.serverTimestamp();
            } else {
                createdAtValue = typeof Date.now === 'function' ? Date.now() : (new Date()).getTime();
            }
            try {
                if (typeof db === 'undefined') {
                    alert('Veritabanı bağlantısı yok. Lütfen sayfayı yenileyip tekrar deneyin.');
                    return;
                }
                var docData = {
                    userId: String(user.uid),
                    krediTuru: String(krediTuru),
                    tutar: Number(tutar),
                    tarih: String(tarih),
                    faizOrani: String(faizOrani || ''),
                    vade: Number(vade),
                    aylikTaksit: String(aylikTaksit || ''),
                    toplamFaiz: String(toplamFaiz || ''),
                    geriOdenecek: String(geriOdenecek || ''),
                    paraBirimi: String(paraBirimi || 'TL'),
                    itfaPlan: Array.isArray(itfaPlan) ? itfaPlan : []
                };
                if (createdAtValue !== null) docData.createdAt = createdAtValue;
                if (currentKullandigimEditId) {
                    delete docData.createdAt;
                    await db.collection('userCredits').doc(currentKullandigimEditId).update(docData);
                    currentKullandigimEditId = null;
                    var kaydetBtn = document.getElementById('kullandigimKrediKaydetBtn');
                    if (kaydetBtn) { kaydetBtn.textContent = ''; kaydetBtn.innerHTML = '<i class="fas fa-save"></i> Kaydet'; kaydetBtn.onclick = function() { kullandigimKrediKaydet(); }; }
                    alert('Kredi kaydı güncellendi. Nakit akış tablosu da güncellenecektir.');
                } else {
                    await db.collection('userCredits').add(docData);
                    var etiket = krediTuruKayitEtiketleri[krediTuru] || (krediTuru + ' Kaydedilen');
                    alert(etiket + ' olarak kaydedildi. Nakit akış tablosunda Kullandığım Krediler satırında takvime göre ilgili ay hücresine yansıyacaktır.');
                    if (typeof closeKredilerModal === 'function') closeKredilerModal();
                }
                var credYear = parseInt(String(tarih).slice(0, 4), 10);
                if (typeof refreshCashFlowUsedCreditsForYear === 'function') refreshCashFlowUsedCreditsForYear(credYear);
            } catch (err) {
                console.error(err);
                var msg = err.message || 'Bilinmeyen hata';
                if (msg.indexOf('permission') !== -1 || msg.indexOf('Permission') !== -1 || msg.indexOf('insufficient') !== -1) {
                    msg = 'Firebase izin hatası. Çözüm: 1) console.firebase.google.com adresine gidin. 2) Projenizi seçin. 3) Sol menüden Firestore Database > Kurallar. 4) Kurallar kutusunda diğer koleksiyonların olduğu yere şu satırları EKLEYIN (veya userCredits varsa aynı yapıda olduğundan emin olun):\n\n    match /userCredits/{docId} {\n      allow read, write: if request.auth != null;\n    }\n\n5) YAYINLA butonuna tıklayın. 6) Sayfayı yenileyip tekrar Kaydet deneyin.';
                }
                alert('Kayıt sırasında hata oluştu: ' + msg);
            }
        }
        window.kullandigimKrediKaydet = kullandigimKrediKaydet;
        function formatKrediTutarBinlik(el) {
            if (!el) return;
            var v = String(el.value || '').trim();
            var s = v.replace(/[^\d,]/g, '');
            var commaAt = s.indexOf(',');
            var intStr = commaAt >= 0 ? s.slice(0, commaAt).replace(/\D/g, '') : s.replace(/\D/g, '');
            var decStr = commaAt >= 0 ? s.slice(commaAt + 1).replace(/\D/g, '') : '';
            var withDots = '';
            for (var i = intStr.length - 1, count = 0; i >= 0; i--, count++) {
                if (count > 0 && count % 3 === 0) withDots = '.' + withDots;
                withDots = intStr.charAt(i) + withDots;
            }
            var formatted = withDots + (decStr ? ',' + decStr : '');
            if (formatted !== el.value) el.value = formatted;
        }
        window.formatKrediTutarBinlik = formatKrediTutarBinlik;
        function krediHesaplaEventleri() {
            function bindPanel(panel) {
                var ids = kredilerPanelIds(panel);
                var tutarEl = document.getElementById(ids.tutar);
                if (tutarEl) {
                    tutarEl.addEventListener('input', function() { formatKrediTutarBinlik(tutarEl); });
                    tutarEl.addEventListener('blur', function() { formatKrediTutarBinlik(tutarEl); });
                }
                [ids.paraBirimi, ids.tarih, ids.turu, ids.tutar, ids.faiz, ids.vade].forEach(function(id) {
                    var el = document.getElementById(id);
                    if (el) {
                        el.addEventListener('input', function() { krediHesapla(panel); });
                        el.addEventListener('change', function() { krediHesapla(panel); });
                    }
                });
            }
            bindPanel('hesaplama');
            bindPanel('kullandigim');
            var contentWrap = document.querySelector('.krediler-content');
            if (contentWrap) {
                contentWrap.addEventListener('input', function(e) {
                    var t = e.target;
                    if (!t || !t.id) return;
                    if (t.id === 'krediTutar' || t.id === 'kullandigimKrediTutar') { formatKrediTutarBinlik(t); }
                    if (['krediParaBirimi','krediTarih','krediTuru','krediTutar','krediFaizOrani','krediVade'].indexOf(t.id) !== -1) { krediHesapla('hesaplama'); return; }
                    if (['kullandigimKrediParaBirimi','kullandigimKrediTarih','kullandigimKrediTuru','kullandigimKrediTutar','kullandigimKrediFaizOrani','kullandigimKrediVade'].indexOf(t.id) !== -1) { krediHesapla('kullandigim'); }
                });
                contentWrap.addEventListener('change', function(e) {
                    var t = e.target;
                    if (!t || !t.id) return;
                    if (['krediParaBirimi','krediTarih','krediTuru','krediTutar','krediFaizOrani','krediVade'].indexOf(t.id) !== -1) { krediHesapla('hesaplama'); return; }
                    if (['kullandigimKrediParaBirimi','kullandigimKrediTarih','kullandigimKrediTuru','kullandigimKrediTutar','kullandigimKrediFaizOrani','kullandigimKrediVade'].indexOf(t.id) !== -1) { krediHesapla('kullandigim'); }
                });
            }
        }
        function krediHesaplaEventleriRun() {
            function run() { krediHesaplaEventleri(); }
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { whenIdle(run); });
            else whenIdle(run);
        }
        krediHesaplaEventleriRun();
        var kredilerSectionTitles = { hesaplama: 'Kredi Hesaplama Modülü', kullandigim: 'Kullandığım Krediler' };
        var kredilerSectionToPanelId = { hesaplama: 'Hesaplama', kullandigim: 'Kullandigim' };
        function kredilerShowSection(key) {
            document.querySelectorAll('.krediler-menu-item').forEach(function(el) { el.classList.remove('active'); });
            var item = document.querySelector('.krediler-menu-item[data-krediler="' + key + '"]');
            if (item) item.classList.add('active');
            document.querySelectorAll('.krediler-panel').forEach(function(el) { el.style.display = 'none'; });
            var panelId = kredilerSectionToPanelId[key] || 'Hesaplama';
            var panel = document.getElementById('kredilerPanel' + panelId);
            if (panel) { panel.style.display = 'block'; panel.style.visibility = 'visible'; }
            var contentWrap = document.querySelector('.krediler-content');
            if (contentWrap) contentWrap.scrollTop = 0;
            var subEl = document.getElementById('kredilerModalSubtitle');
            if (subEl) subEl.textContent = kredilerSectionTitles[key] || 'Kredi Hesaplama Modülü';
        }
        var ayarlarSectionTitles = { gizlilik: 'Profil Gizliliği', sifre: 'Şifre Değiştir', dil: 'Dil Seçenekleri', gorunum: 'Site Görünümü', uye: 'Site üyeliği kişi sayısı' };
        var ayarlarPanelIds = { gizlilik: 'Gizlilik', sifre: 'Sifre', dil: 'Dil', gorunum: 'Gorunum', uye: 'Uye' };
        function ayarlarShowSection(key) {
            document.querySelectorAll('.ayarlar-menu-item').forEach(function(el) { el.classList.remove('active'); });
            var item = document.querySelector('.ayarlar-menu-item[data-ayarlar="' + key + '"]');
            if (item) item.classList.add('active');
            document.querySelectorAll('.ayarlar-panel').forEach(function(el) { el.style.display = 'none'; });
            var panelId = ayarlarPanelIds[key] || 'Gizlilik';
            var panel = document.getElementById('ayarlarPanel' + panelId);
            if (panel) {
                panel.style.display = 'block';
                panel.style.visibility = 'visible';
            }
            var contentWrap = document.querySelector('.ayarlar-content');
            if (contentWrap) contentWrap.scrollTop = 0;
            var subEl = document.getElementById('ayarlarModalSubtitle');
            if (subEl) subEl.textContent = ayarlarSectionTitles[key] || 'Profil Gizliliği';
            if (key === 'dil') { ayarlarSelectedLang = getSiteLang(); document.querySelectorAll('.ayarlar-dil-item').forEach(function(el) { el.classList.remove('selected'); if (el.getAttribute('data-lang') === ayarlarSelectedLang) el.classList.add('selected'); }); }
            if (key === 'gizlilik') loadAyarlarGizlilikSelection();
            if (key === 'gorunum') { try { loadAyarlarGorunumSelection(); } catch (e) { console.error(e); } }
            if (key === 'uye') loadTotalMemberCount();
        }
        /* Üye sayacı: siteStats/counters.totalMembers. Firestore Rules'da siteStats koleksiyonu için okuma (read) ve yazma (write) izni verin. */
        var SITE_STATS_COUNTERS = 'siteStats/counters';
        async function loadTotalMemberCount() {
            var el = document.getElementById('totalMemberCount');
            if (!el) return;
            el.textContent = '…';
            try {
                var profilesSnap = await db.collection('userProfiles').get();
                var total = profilesSnap.size;
                var ref = db.collection('siteStats').doc('counters');
                await ref.set({ totalMembers: total }, { merge: true });
                el.textContent = String(total);
            } catch (e) {
                console.error('Üye sayısı yüklenemedi:', e);
                el.textContent = '—';
            }
        }
        function incrementTotalMemberCount() {
            db.collection('siteStats').doc('counters').set({ totalMembers: firebase.firestore.FieldValue.increment(1) }, { merge: true }).catch(function(e) { console.error('Üye sayacı güncellenemedi:', e); });
        }
        var ayarlarSelectedPrivacy = 'public';
        function loadAyarlarGizlilikSelection() {
            var user = auth.currentUser;
            if (!user) return;
            db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                var val = (snap.empty ? 'public' : (snap.docs[0].data().profilePrivacy || 'public'));
                ayarlarSelectedPrivacy = val;
                document.querySelectorAll('.ayarlar-gizlilik-item').forEach(function(el) { el.classList.toggle('selected', el.getAttribute('data-privacy') === val); });
                var msgEl = document.getElementById('ayarlarGizlilikMesaj');
                if (msgEl) { msgEl.textContent = ''; msgEl.className = 'ayarlar-mesaj'; }
            });
        }
        function ayarlarGizlilikSec(val) {
            ayarlarSelectedPrivacy = val;
            document.querySelectorAll('.ayarlar-gizlilik-item').forEach(function(el) { el.classList.toggle('selected', el.getAttribute('data-privacy') === val); });
        }
        async function ayarlarGizlilikKaydet() {
            var user = auth.currentUser;
            if (!user) return;
            var msgEl = document.getElementById('ayarlarGizlilikMesaj');
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'ayarlar-mesaj'; }
            try {
                var snap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (snap.empty) { if (msgEl) { msgEl.textContent = 'Profil kaydı bulunamadı.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
                await db.collection('userProfiles').doc(snap.docs[0].id).update({ profilePrivacy: ayarlarSelectedPrivacy });
                if (msgEl) { msgEl.textContent = 'Profil gizliliği kaydedildi.'; msgEl.className = 'ayarlar-mesaj success'; }
            } catch (e) {
                if (msgEl) { msgEl.textContent = 'Kaydedilirken hata oluştu.'; msgEl.className = 'ayarlar-mesaj error'; }
            }
        }
        window.ayarlarGizlilikSec = ayarlarGizlilikSec;
        window.ayarlarGizlilikKaydet = ayarlarGizlilikKaydet;
        var SITE_THEME_KEY = 'siteTheme';
        var ayarlarSelectedTheme = 'dark';
        function getSiteTheme() { try { return localStorage.getItem(SITE_THEME_KEY) || 'dark'; } catch (e) { return 'dark'; } }
        function applySiteTheme(theme) {
            if (theme === 'light') document.body.classList.add('theme-light');
            else document.body.classList.remove('theme-light');
        }
        function loadAyarlarGorunumSelection() {
            ayarlarSelectedTheme = getSiteTheme();
            document.querySelectorAll('.ayarlar-gorunum-item').forEach(function(el) { el.classList.toggle('selected', el.getAttribute('data-theme') === ayarlarSelectedTheme); });
            var msgEl = document.getElementById('ayarlarGorunumMesaj');
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'ayarlar-mesaj'; }
        }
        function ayarlarGorunumSec(theme) {
            ayarlarSelectedTheme = theme;
            document.querySelectorAll('.ayarlar-gorunum-item').forEach(function(el) { el.classList.toggle('selected', el.getAttribute('data-theme') === theme); });
        }
        function ayarlarGorunumKaydet() {
            try {
                localStorage.setItem(SITE_THEME_KEY, ayarlarSelectedTheme);
                applySiteTheme(ayarlarSelectedTheme);
                var msgEl = document.getElementById('ayarlarGorunumMesaj');
                if (msgEl) { msgEl.textContent = 'Site görünümü kaydedildi.'; msgEl.className = 'ayarlar-mesaj success'; }
            } catch (e) {
                var msgEl = document.getElementById('ayarlarGorunumMesaj');
                if (msgEl) { msgEl.textContent = 'Kaydedilirken hata oluştu.'; msgEl.className = 'ayarlar-mesaj error'; }
            }
        }
        window.ayarlarGorunumSec = ayarlarGorunumSec;
        window.ayarlarGorunumKaydet = ayarlarGorunumKaydet;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { applySiteTheme(getSiteTheme()); });
        } else {
            applySiteTheme(getSiteTheme());
        }
        async function ayarlarSifreKaydet() {
            var msgEl = document.getElementById('ayarlarSifreMesaj');
            var mevcut = (document.getElementById('ayarlarMevcutSifre') && document.getElementById('ayarlarMevcutSifre').value) || '';
            var yeni = (document.getElementById('ayarlarYeniSifre') && document.getElementById('ayarlarYeniSifre').value) || '';
            var tekrar = (document.getElementById('ayarlarTekrarSifre') && document.getElementById('ayarlarTekrarSifre').value) || '';
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'ayarlar-mesaj'; }
            if (!mevcut.trim()) { if (msgEl) { msgEl.textContent = 'Mevcut şifreyi girin.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
            if (!yeni.trim()) { if (msgEl) { msgEl.textContent = 'Yeni şifreyi girin.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
            if (yeni !== tekrar) { if (msgEl) { msgEl.textContent = 'Yeni şifre ve tekrar aynı olmalı.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
            if (yeni.length < 6) { if (msgEl) { msgEl.textContent = 'Yeni şifre en az 6 karakter olmalı.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
            var user = auth.currentUser;
            if (!user || !user.email) { if (msgEl) { msgEl.textContent = 'Giriş yapmış bir kullanıcı değilsiniz.'; msgEl.className = 'ayarlar-mesaj error'; } return; }
            var btn = document.querySelector('.ayarlar-kaydet-btn');
            if (btn) btn.disabled = true;
            try {
                var cred = firebase.auth.EmailAuthProvider.credential(user.email, mevcut);
                await user.reauthenticateWithCredential(cred);
                await user.updatePassword(yeni);
                if (msgEl) { msgEl.textContent = 'Şifreniz güncellendi. Bir sonraki girişte yeni şifrenizi kullanın.'; msgEl.className = 'ayarlar-mesaj success'; }
                if (document.getElementById('ayarlarMevcutSifre')) document.getElementById('ayarlarMevcutSifre').value = '';
                if (document.getElementById('ayarlarYeniSifre')) document.getElementById('ayarlarYeniSifre').value = '';
                if (document.getElementById('ayarlarTekrarSifre')) document.getElementById('ayarlarTekrarSifre').value = '';
            } catch (err) {
                console.error(err);
                var txt = 'İşlem sırasında hata oluştu.';
                if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') txt = 'Mevcut şifre hatalı.';
                else if (err.code === 'auth/weak-password') txt = 'Yeni şifre en az 6 karakter olmalı.';
                else if (err.code === 'auth/requires-recent-login') txt = 'Güvenlik için tekrar giriş yapıp deneyin.';
                if (msgEl) { msgEl.textContent = txt; msgEl.className = 'ayarlar-mesaj error'; }
            }
            if (btn) btn.disabled = false;
        }
        window.openAyarlarModal = openAyarlarModal;
        window.closeAyarlarModal = closeAyarlarModal;
        window.openKredilerPopup = openKredilerPopup;
        window.closeKredilerPopup = closeKredilerPopup;
        window.openKredilerModal = openKredilerModal;
        window.closeKredilerModal = closeKredilerModal;
        window.kredilerModalGeri = kredilerModalGeri;
        window.kullandigimListGeri = kullandigimListGeri;
        window.krediHesapla = krediHesapla;
        window.openKrediGrafikPencere = openKrediGrafikPencere;
        window.krediItfaExcelIndir = krediItfaExcelIndir;
        window.krediItfaPDFIndir = krediItfaPDFIndir;
        window.kredilerShowSection = kredilerShowSection;
        window.ayarlarShowSection = ayarlarShowSection;
        window.ayarlarSifreKaydet = ayarlarSifreKaydet;
        function notificationsPanelBack() {
            closeNotificationsPanel();
        }
        function notificationsPanelMinimize() {
            var inner = document.getElementById('notificationsPanelInner');
            if (inner) inner.classList.toggle('notifications-panel-small');
            notificationsPanelMinimized = !notificationsPanelMinimized;
        }
        function goToPostFromNotification(postId) {
            closeNotificationsPanel();
            if (!postId) return;
            window.pendingScrollToPostId = postId;
            openYorumlarimFeedModal();
            loadYorumlarimFeed();
        }
        function goToFriendRequestFromNotification() {
            closeNotificationsPanel();
            openFriendsModal();
            friendsSwitchTab('bildirimler');
        }
        function parseMentionUsernames(text) {
            if (!text || typeof text !== 'string') return [];
            var matches = text.match(/@([a-zA-Z0-9_.]+)/g);
            if (!matches) return [];
            var set = new Set();
            matches.forEach(function(m) { set.add(m.substring(1).toLowerCase()); });
            return Array.from(set);
        }
        async function createMentionNotifications(commentText, fromUserId, fromUserName, fromUserPhotoUrl, postId) {
            if (!commentText || !fromUserId || !postId) return;
            var usernames = parseMentionUsernames(commentText);
            if (usernames.length === 0) return;
            try {
                for (var i = 0; i < usernames.length; i++) {
                    var un = usernames[i];
                    var snap = await db.collection('userProfiles').where('username', '==', un).limit(1).get();
                    if (snap.empty) continue;
                    var toUserId = snap.docs[0].data().userId;
                    if (toUserId === fromUserId) continue;
                    await db.collection('mentionNotifications').add({
                        toUserId: toUserId,
                        fromUserId: fromUserId,
                        fromUserName: fromUserName || 'Kullanıcı',
                        fromUserPhotoUrl: fromUserPhotoUrl || '',
                        postId: postId,
                        commentText: (commentText || '').substring(0, 200),
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                }
            } catch (e) {
                console.warn('[mentionNotifications]', e);
            }
        }
        async function loadAllNotificationsPanel() {
            var user = auth.currentUser;
            var listEl = document.getElementById('notificationsPanelList');
            if (!user || !listEl) return;
            var dismissedKeys = new Set();
            var myPostIds = new Set();
            try {
                var _r = await Promise.all([
                    db.collection('notificationDismissed').where('userId', '==', user.uid).get(),
                    db.collection('userPosts').where('userId','==',user.uid).get()
                ]);
                _r[0].docs.forEach(function(d) { dismissedKeys.add(d.data().notificationKey || ''); });
                _r[1].docs.forEach(function(d){ myPostIds.add(d.id); });
            } catch (e) {}
            var items = [];
            try {
                var profileCache = {};
                var t = function(ts){ return ts && ts.toMillis ? ts.toMillis() : 0; };
                var friendReqSnap, repliesSnap, likeSnap, favSnap, quotesSnap, mentionSnap, meetingInviteSnap, liveStreamSnap;
                var _all = await Promise.all([
                    db.collection('friendRequests').where('toUserId','==',user.uid).where('status','==','pending').get(),
                    db.collection('postReplies').get(),
                    db.collection('postLikes').get(),
                    db.collection('postFavorites').get(),
                    db.collection('userPosts').where('quotedPostId','!=',null).get(),
                    db.collection('mentionNotifications').where('toUserId','==',user.uid).get(),
                    db.collection('meetingInvites').where('toUserId','==',user.uid).get(),
                    db.collection('liveStreamInvites').where('toUserId','==',user.uid).get()
                ]);
                friendReqSnap = _all[0]; repliesSnap = _all[1]; likeSnap = _all[2]; favSnap = _all[3]; quotesSnap = _all[4]; mentionSnap = _all[5]; meetingInviteSnap = _all[6]; liveStreamSnap = _all[7];
                var needProfileIds = new Set();
                var needPostIds = new Set();
                for (var i = 0; i < friendReqSnap.docs.length; i++) { var r = friendReqSnap.docs[i].data(); needProfileIds.add(r.fromUserId); }
                for (var j = 0; j < repliesSnap.docs.length; j++) {
                    var r = repliesSnap.docs[j].data();
                    if (myPostIds.has(r.postId) && r.userId !== user.uid) { needProfileIds.add(r.userId); needPostIds.add(r.postId); }
                }
                for (var k = 0; k < likeSnap.docs.length; k++) { var l = likeSnap.docs[k].data(); needPostIds.add(l.postId); needProfileIds.add(l.userId); }
                for (var f = 0; f < favSnap.docs.length; f++) { var fData = favSnap.docs[f].data(); needPostIds.add(fData.postId); needProfileIds.add(fData.userId); }
                for (var q = 0; q < quotesSnap.docs.length; q++) {
                    var qData = quotesSnap.docs[q].data();
                    if (qData.quotedPostId && myPostIds.has(qData.quotedPostId) && qData.userId !== user.uid) { needProfileIds.add(qData.userId); needPostIds.add(qData.quotedPostId); }
                }
                var profileIdsArr = Array.from(needProfileIds);
                var postIdsArr = Array.from(needPostIds);
                await Promise.all(profileIdsArr.map(function(uid) {
                    return db.collection('userProfiles').where('userId','==',uid).limit(1).get().then(function(snap) {
                        var o = { name: 'Kullanıcı', photo: '' };
                        if (!snap.empty) { var d = snap.docs[0].data(); o.name = d.adSoyad || o.name; o.photo = d.photoUrl || ''; }
                        profileCache[uid] = o;
                    });
                }));
                var postCache = {};
                await Promise.all(postIdsArr.map(function(pid) {
                    return db.collection('userPosts').doc(pid).get().then(function(snap) { postCache[pid] = snap; });
                }));
                for (var i = 0; i < friendReqSnap.docs.length; i++) {
                    var doc = friendReqSnap.docs[i];
                    var r = doc.data();
                    var when = r.createdAt ? t(r.createdAt) : 0;
                    var prof = profileCache[r.fromUserId] || { name: 'Kullanıcı', photo: '' };
                    items.push({ type: 'follow', when: when, userId: r.fromUserId, userName: prof.name, userPhoto: prof.photo, requestId: doc.id, notificationKey: 'follow_' + doc.id });
                }
                for (var j = 0; j < repliesSnap.docs.length; j++) {
                    var rDoc = repliesSnap.docs[j];
                    var r = rDoc.data();
                    if (!myPostIds.has(r.postId) || r.userId === user.uid) continue;
                    var when = r.createdAt ? t(r.createdAt) : 0;
                    var prof = profileCache[r.userId] || { name: 'Kullanıcı', photo: '' };
                    var postSnap = postCache[r.postId];
                    var postText = postSnap && postSnap.exists ? (postSnap.data().text || '').substring(0, 80) : '';
                    if (postText.length === 80) postText += '...';
                    items.push({ type: 'comment', when: when, userId: r.userId, userName: prof.name, userPhoto: prof.photo, postId: r.postId, snippet: postText, replyText: (r.text||'').substring(0,60), notificationKey: 'comment_' + rDoc.id });
                }
                for (var k = 0; k < likeSnap.docs.length; k++) {
                    var lDoc = likeSnap.docs[k];
                    var l = lDoc.data();
                    var postSnap = postCache[l.postId];
                    if (!postSnap || !postSnap.exists || postSnap.data().userId !== user.uid || l.userId === user.uid) continue;
                    var postData = postSnap.data();
                    var when = postData.createdAt ? t(postData.createdAt) : 0;
                    var prof = profileCache[l.userId] || { name: 'Kullanıcı', photo: '' };
                    var postText = (postData.text || '').substring(0, 80);
                    if (postText.length === 80) postText += '...';
                    items.push({ type: 'like', when: when, userId: l.userId, userName: prof.name, userPhoto: prof.photo, postId: l.postId, snippet: postText, notificationKey: 'like_' + lDoc.id });
                }
                for (var f = 0; f < favSnap.docs.length; f++) {
                    var fDoc = favSnap.docs[f];
                    var fData = fDoc.data();
                    var postSnap = postCache[fData.postId];
                    if (!postSnap || !postSnap.exists || postSnap.data().userId !== user.uid || fData.userId === user.uid) continue;
                    var postData = postSnap.data();
                    var when = postData.createdAt ? t(postData.createdAt) : 0;
                    var prof = profileCache[fData.userId] || { name: 'Kullanıcı', photo: '' };
                    var postText = (postData.text || '').substring(0, 80);
                    if (postText.length === 80) postText += '...';
                    items.push({ type: 'favorite', when: when, userId: fData.userId, userName: prof.name, userPhoto: prof.photo, postId: fData.postId, snippet: postText, notificationKey: 'favorite_' + fDoc.id });
                }
                for (var q = 0; q < quotesSnap.docs.length; q++) {
                    var qDoc = quotesSnap.docs[q];
                    var qData = qDoc.data();
                    if (!qData.quotedPostId || !myPostIds.has(qData.quotedPostId) || qData.userId === user.uid) continue;
                    var when = qData.createdAt ? t(qData.createdAt) : 0;
                    var prof = profileCache[qData.userId] || { name: 'Kullanıcı', photo: '' };
                    var origSnap = postCache[qData.quotedPostId];
                    var origText = origSnap && origSnap.exists ? (origSnap.data().text || '').substring(0, 80) : '';
                    if (origText.length === 80) origText += '...';
                    items.push({ type: 'quote', when: when, userId: qData.userId, userName: prof.name, userPhoto: prof.photo, postId: qData.quotedPostId, snippet: origText, notificationKey: 'quote_' + qDoc.id });
                }
                for (var m = 0; m < mentionSnap.docs.length; m++) {
                    var mDoc = mentionSnap.docs[m];
                    var mData = mDoc.data();
                    var when = mData.createdAt ? t(mData.createdAt) : 0;
                    items.push({ type: 'mention', when: when, userId: mData.fromUserId, userName: mData.fromUserName || 'Kullanıcı', userPhoto: mData.fromUserPhotoUrl || '', postId: mData.postId, snippet: (mData.commentText || '').substring(0, 80), notificationKey: 'mention_' + mDoc.id });
                }
                for (var mi = 0; mi < meetingInviteSnap.docs.length; mi++) {
                    var miDoc = meetingInviteSnap.docs[mi];
                    var miData = miDoc.data();
                    var when = miData.createdAt ? t(miData.createdAt) : 0;
                    items.push({ type: 'meeting_invite', when: when, userId: miData.fromUserId, userName: miData.fromUserName || 'Kullanıcı', userPhoto: miData.fromUserPhotoUrl || '', roomId: miData.roomId || '', konu: miData.konu || 'Toplantı', tarih: miData.tarih || '', saat: miData.saat || '', inviteId: miDoc.id, notificationKey: 'meeting_' + miDoc.id });
                }
                for (var ls = 0; ls < liveStreamSnap.docs.length; ls++) {
                    var lsDoc = liveStreamSnap.docs[ls];
                    var lsData = lsDoc.data();
                    var when = lsData.createdAt ? t(lsData.createdAt) : 0;
                    items.push({ type: 'live_stream_invite', when: when, userId: lsData.fromUserId, userName: lsData.fromUserName || 'Kullanıcı', userPhoto: lsData.fromUserPhotoUrl || '', roomId: lsData.roomId || '', inviteId: lsDoc.id, notificationKey: 'live_' + lsDoc.id });
                }
                items = items.filter(function(it) { return !dismissedKeys.has(it.notificationKey); });
                items.sort(function(a,b){ return b.when - a.when; });
                listEl.innerHTML = '';
                if (items.length === 0) { listEl.innerHTML = '<div class="friends-empty">Henüz bildirim yok.</div>'; refreshNotificationsPanelBadge(); return; }
                for (var n = 0; n < items.length; n++) {
                    var it = items[n];
                    var title = it.userName;
                    var desc = '';
                    var snippet = it.snippet || '';
                    if (it.type === 'follow') desc = 'Sizi takibe almak istiyor.';
                    else if (it.type === 'comment') desc = 'Yorumunuza yorum yaptı.' + (it.replyText ? ' "' + (it.replyText.replace(/"/g,'\'') + (it.replyText.length >= 60 ? '...' : '') + '"') : '');
                    else if (it.type === 'like') desc = 'Yorumunuzu veya paylaşımınızı beğendi.';
                    else if (it.type === 'favorite') desc = 'Yorum veya paylaşımınızı favorilerine ekledi.';
                    else if (it.type === 'quote') desc = 'Paylaşımınızı alıntıladı.';
                    else if (it.type === 'mention') desc = 'Sizi bir yorumda @ ile etiketledi.';
                    else if (it.type === 'meeting_invite') desc = 'Sizi toplantıya davet etti: ' + (it.konu || 'Toplantı').replace(/</g,'&lt;') + ' — ' + (it.tarih || '') + ' ' + (it.saat || '');
                    else if (it.type === 'live_stream_invite') desc = 'Sizi canlı yayına davet etti. Tıklayın, odaya otomatik alınacaksınız.';
                    var esc = function(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); };
                    var nKey = esc(it.notificationKey || '');
                    var nType = esc(it.type || '');
                    var nDocId = esc(it.inviteId || it.requestId || '');
                    var action = 'post';
                    var arg = '';
                    if (it.type === 'follow') { action = 'friendRequest'; arg = ''; }
                    else if (it.type === 'meeting_invite' && it.roomId) { action = 'meeting'; arg = esc(it.roomId); }
                    else if (it.type === 'live_stream_invite' && it.roomId) { action = 'liveMeeting'; arg = esc(it.roomId); }
                    else if (it.postId) { action = 'post'; arg = esc(it.postId); }
                    var onclick = "markNotificationViewedAndGo('" + nKey + "','" + nType + "','" + nDocId + "', this, '" + action + "', '" + arg + "')";
                    var div = document.createElement('div');
                    div.className = 'notification-panel-item' + (it.type === 'meeting_invite' ? ' notification-panel-item-meeting' : '') + (it.type === 'live_stream_invite' ? ' notification-panel-item-live-stream' : '');
                    div.setAttribute('onclick', onclick);
                    div.setAttribute('data-notification-key', it.notificationKey || '');
                    div.setAttribute('data-notification-type', it.type || '');
                    div.setAttribute('data-notification-docid', it.inviteId || it.requestId || '');
                    var meetingBtn = (it.type === 'meeting_invite' && it.roomId) ? '<button type="button" class="notification-panel-katil-btn" onclick="event.stopPropagation(); openMeetingInvite(\'' + (it.roomId || '').replace(/'/g,"\\'") + '\')">Katıl</button>' : '';
                    if (it.type === 'live_stream_invite' && it.roomId) meetingBtn = '<button type="button" class="notification-panel-katil-btn" onclick="event.stopPropagation(); closeNotificationsPanel(); openMeetingInvite(\'' + (it.roomId || '').replace(/'/g,"\\'") + '\')">Katıl</button>';
                    var trashBtn = '<button type="button" class="notification-panel-delete-btn" onclick="event.stopPropagation(); var d=this.closest(\'.notification-panel-item\'); if(d) deleteNotification(d.getAttribute(\'data-notification-key\'), d.getAttribute(\'data-notification-type\'), d.getAttribute(\'data-notification-docid\'), d);" title="Bildirimi sil"><i class="fas fa-trash-alt"></i> Sil</button>';
                    div.innerHTML = '<img class="notification-panel-item-avatar" src="' + (it.userPhoto || '').replace(/"/g,'&quot;') + '" onerror="this.style.display=\'none\'" alt=""><div class="notification-panel-item-body"><div class="notification-panel-item-title">' + (it.userName || 'Kullanıcı').replace(/</g,'&lt;') + '</div><div class="notification-panel-item-desc">' + (desc || '').replace(/</g,'&lt;') + '</div>' + (snippet ? '<div class="notification-panel-item-snippet">' + snippet.replace(/</g,'&lt;').replace(/"/g,'&quot;') + '</div>' : '') + meetingBtn + '</div>' + trashBtn;
                    listEl.appendChild(div);
                }
                refreshNotificationsPanelBadge();
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="friends-empty">Bildirimler yüklenirken hata oluştu.</div>';
            }
        }
        async function deleteNotification(notificationKey, type, docId, rowEl) {
            var user = auth.currentUser;
            if (!user || !notificationKey) return;
            try {
                await db.collection('notificationDismissed').add({ userId: user.uid, notificationKey: notificationKey });
                if (type === 'meeting_invite' && docId) await db.collection('meetingInvites').doc(docId).delete();
                if (type === 'live_stream_invite' && docId) await db.collection('liveStreamInvites').doc(docId).delete();
                if (rowEl && rowEl.parentNode) rowEl.remove();
                refreshNotificationsPanelBadge();
            } catch (e) { console.error(e); }
        }
        async function markNotificationAsViewed(notificationKey, type, docId, rowEl) {
            var user = auth.currentUser;
            if (!user || !notificationKey) return;
            try {
                await db.collection('notificationDismissed').add({ userId: user.uid, notificationKey: notificationKey });
                if (rowEl && rowEl.parentNode) rowEl.remove();
                refreshNotificationsPanelBadge();
            } catch (e) { console.error(e); }
        }
        async function markNotificationViewedAndGo(key, type, docId, rowEl, action, arg) {
            await markNotificationAsViewed(key, type, docId, rowEl);
            if (action === 'post' && arg) { closeNotificationsPanel(); goToPostFromNotification(arg); }
            else if (action === 'friendRequest') { closeNotificationsPanel(); goToFriendRequestFromNotification(); }
            else if (action === 'meeting' && arg) { closeNotificationsPanel(); if (typeof openMeetingInvite === 'function') openMeetingInvite(arg); else if (window.openMeetingInvite) window.openMeetingInvite(arg); }
            else if (action === 'liveMeeting' && arg) { closeNotificationsPanel(); if (typeof openMeetingInvite === 'function') openMeetingInvite(arg); else if (window.openMeetingInvite) window.openMeetingInvite(arg); }
        }
        window.markNotificationViewedAndGo = markNotificationViewedAndGo;
        async function getNotificationDismissedKeys() {
            var user = auth.currentUser;
            var keys = new Set();
            if (!user) return keys;
            try {
                var snap = await db.collection('notificationDismissed').where('userId', '==', user.uid).get();
                snap.docs.forEach(function(d) { keys.add(d.data().notificationKey || ''); });
            } catch (e) {}
            return keys;
        }
        async function refreshNotificationsPanelBadge() {
            var user = auth.currentUser;
            var badge = document.getElementById('notificationsPanelBadge');
            if (!user || !badge) return;
            try {
                var dismissedKeys = await getNotificationDismissedKeys();
                var count = 0;
                var reqSnap = await db.collection('friendRequests').where('toUserId','==',user.uid).where('status','==','pending').get();
                reqSnap.docs.forEach(function(d) { if (!dismissedKeys.has('follow_' + d.id)) count++; });
                var myPostsSnap = await db.collection('userPosts').where('userId','==',user.uid).get();
                var myPostIds = new Set(myPostsSnap.docs.map(function(d){ return d.id; }));
                var repliesSnap = await db.collection('postReplies').get();
                repliesSnap.docs.forEach(function(d){ var r = d.data(); if (myPostIds.has(r.postId) && r.userId !== user.uid && !dismissedKeys.has('comment_' + d.id)) count++; });
                var likeSnap = await db.collection('postLikes').get();
                for (var i = 0; i < likeSnap.docs.length; i++) {
                    var l = likeSnap.docs[i].data();
                    var lDoc = likeSnap.docs[i];
                    var postDoc = await db.collection('userPosts').doc(l.postId).get();
                    if (postDoc.exists && postDoc.data().userId === user.uid && l.userId !== user.uid && !dismissedKeys.has('like_' + lDoc.id)) count++;
                }
                var favSnap = await db.collection('postFavorites').get();
                for (var j = 0; j < favSnap.docs.length; j++) {
                    var f = favSnap.docs[j].data();
                    var fDoc = favSnap.docs[j];
                    var postDoc = await db.collection('userPosts').doc(f.postId).get();
                    if (postDoc.exists && postDoc.data().userId === user.uid && f.userId !== user.uid && !dismissedKeys.has('favorite_' + fDoc.id)) count++;
                }
                var quoteSnap = await db.collection('userPosts').where('quotedPostId','!=',null).get();
                quoteSnap.docs.forEach(function(d){ var q = d.data(); if (q.quotedPostId && myPostIds.has(q.quotedPostId) && q.userId !== user.uid && !dismissedKeys.has('quote_' + d.id)) count++; });
                var mentionSnap = await db.collection('mentionNotifications').where('toUserId','==',user.uid).get();
                mentionSnap.docs.forEach(function(d) { if (!dismissedKeys.has('mention_' + d.id)) count++; });
                var meetingInviteSnap = await db.collection('meetingInvites').where('toUserId','==',user.uid).get();
                meetingInviteSnap.docs.forEach(function(d) { if (!dismissedKeys.has('meeting_' + d.id)) count++; });
                var liveStreamInviteSnap = await db.collection('liveStreamInvites').where('toUserId','==',user.uid).get();
                liveStreamInviteSnap.docs.forEach(function(d) { if (!dismissedKeys.has('live_' + d.id)) count++; });
                if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = 'inline-flex'; badge.style.background = '#dc2626'; badge.style.color = '#fff'; }
                else badge.style.display = 'none';
            } catch (e) { if (badge) badge.style.display = 'none'; }
        }

        // ----- Ana Sayfam modal: büyük pencere, X / geri / alta indir, feed tarih/saate göre sıralı -----
        const ANA_SAYFAM_STORAGE = 'anaSayfamFeed';
        const ANA_SAYFAM_STATE = 'anaSayfamState';
        const ANA_SAYFAM_USER = 'anaSayfamUserId';
        var anaSayfamFirebasePosts = null;
        function getAnaSayfamUserId() {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (user) return user.uid;
            let id = localStorage.getItem(ANA_SAYFAM_USER);
            if (!id) { id = 'user_' + Date.now(); localStorage.setItem(ANA_SAYFAM_USER, id); }
            return id;
        }
        function getAnaSayfamState() {
            try { return JSON.parse(localStorage.getItem(ANA_SAYFAM_STATE) || '{}'); } catch (e) { return {}; }
        }
        function setAnaSayfamState(s) { localStorage.setItem(ANA_SAYFAM_STATE, JSON.stringify(s)); }
        function getAnaSayfamPosts() {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (user && anaSayfamFirebasePosts && Array.isArray(anaSayfamFirebasePosts)) return anaSayfamFirebasePosts;
            let raw = localStorage.getItem(ANA_SAYFAM_STORAGE);
            if (!raw) {
                var seed = [
                    { id: 'p1', authorName: 'Ayşe Yılmaz', authorId: 'u1', type: 'comment', text: 'Bugün piyasa yorumum: Dolar düşüşte kalabilir, portföyde nakit ağırlığını artırdım.', mediaUrls: [], createdAt: Date.now() - 3600000, likes: [], comments: [], favorites: [], quotedBy: [] },
                    { id: 'p2', authorName: 'Mehmet Kaya', authorId: 'u2', type: 'photo', text: 'Teknik analiz ekranından bir kare.', mediaUrls: ['https://picsum.photos/600/400'], createdAt: Date.now() - 7200000, likes: [], comments: [], favorites: [], quotedBy: [] },
                    { id: 'p3', authorName: 'Zeynep Akın', authorId: 'u3', type: 'comment', text: 'Kripto fırsatları hakkında ne düşünüyorsunuz? Özellikle altcoin seçiminde nelere dikkat ediyorsunuz?', mediaUrls: [], createdAt: Date.now() - 10800000, likes: [], comments: [], favorites: [], quotedBy: [] },
                    { id: 'p4', authorName: 'Can Demir', authorId: 'u4', type: 'video', text: 'Haftalık borsa değerlendirmesi.', mediaUrls: ['https://www.w3schools.com/html/mov_bbb.mp4'], createdAt: Date.now() - 14400000, likes: [], comments: [], favorites: [], quotedBy: [] },
                    { id: 'p5', authorName: 'Elif Şahin', authorId: 'u5', type: 'photo', text: '', mediaUrls: ['https://picsum.photos/500/350'], createdAt: Date.now() - 18000000, likes: [], comments: [], favorites: [], quotedBy: [] }
                ];
                localStorage.setItem(ANA_SAYFAM_STORAGE, JSON.stringify(seed));
                return seed;
            }
            try {
                var list = JSON.parse(raw);
                list.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
                return list;
            } catch (e) { return []; }
        }
        function setAnaSayfamPosts(posts) {
            posts.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
            localStorage.setItem(ANA_SAYFAM_STORAGE, JSON.stringify(posts));
        }
        async function loadAnaSayfamFromFirebase() {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) { anaSayfamFirebasePosts = []; renderAnaSayfamFeed(); return; }
            var feedEl = document.getElementById('anaSayfamFeed');
            if (feedEl) feedEl.innerHTML = '<div class="ana-sayfam-empty">Yükleniyor...</div>';
            try {
                /* Tüm üyelerin paylaşımları — Ana Sayfam herkese açık akış (tarihe göre) */
                var snap = await db.collection('userPosts').orderBy('createdAt', 'desc').limit(150).get();
                var allPosts = [];
                snap.docs.forEach(function(doc) {
                    var d = doc.data();
                    var createdAt = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : Date.now();
                    allPosts.push({
                        id: doc.id,
                        authorId: d.userId || '',
                        authorName: d.userName || 'Kullanıcı',
                        authorPhotoUrl: d.userPhotoUrl || '',
                        type: 'comment',
                        text: d.text || '',
                        mediaUrls: normalizeMediaUrlsField(d.mediaUrls),
                        createdAt: createdAt,
                        quotedPostId: d.quotedPostId || '',
                        quotedAuthor: '',
                        quotedText: d.quotedText || '',
                        likeCount: d.likeCount || 0,
                        commentCount: d.commentCount || 0,
                        comments: [],
                        _fromFirebase: true
                    });
                });
                allPosts.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
                var postIds = allPosts.map(function(p) { return p.id; });
                var repliesByPostId = {};
                postIds.forEach(function(pid) { repliesByPostId[pid] = []; });
                var chunkSize = 10;
                for (var c = 0; c < postIds.length; c += chunkSize) {
                    var chunk = postIds.slice(c, c + chunkSize);
                    if (chunk.length === 0) break;
                    var repliesSnap = await db.collection('postReplies').where('postId', 'in', chunk).get();
                    repliesSnap.docs.forEach(function(rDoc) {
                        var r = rDoc.data();
                        var postId = r.postId;
                        if (!repliesByPostId[postId]) repliesByPostId[postId] = [];
                        var createdAt = r.createdAt && r.createdAt.toMillis ? r.createdAt.toMillis() : Date.now();
                        repliesByPostId[postId].push({ authorId: r.userId || '', authorName: r.userName || 'Kullanıcı', authorPhotoUrl: r.userPhotoUrl || '', text: r.text || '', createdAt: createdAt });
                    });
                }
                for (var p = 0; p < allPosts.length; p++) {
                    var post = allPosts[p];
                    var list = repliesByPostId[post.id] || [];
                    list.sort(function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
                    post.comments = list;
                }
                anaSayfamFirebasePosts = allPosts;
                renderAnaSayfamFeed();
            } catch (e) {
                console.error('loadAnaSayfamFromFirebase', e);
                anaSayfamFirebasePosts = [];
                if (feedEl) feedEl.innerHTML = '<div class="ana-sayfam-empty">Yüklenemedi. Tekrar deneyin.</div>';
            }
        }
        function anaSayfamTimeAgo(ts) {
            var d = Date.now() - ts;
            if (d < 60000) return 'Az önce';
            if (d < 3600000) return Math.floor(d / 60000) + ' dk önce';
            if (d < 86400000) return Math.floor(d / 3600000) + ' sa önce';
            return Math.floor(d / 86400000) + ' gün önce';
        }
        function anaSayfamToggleLike(postId) {
            var posts = getAnaSayfamPosts();
            var post = posts.find(function(p) { return p.id === postId; });
            if (!post) return;
            if (post._fromFirebase) return;
            var uid = getAnaSayfamUserId();
            post.likes = post.likes || [];
            var i = post.likes.indexOf(uid);
            if (i >= 0) post.likes.splice(i, 1); else post.likes.push(uid);
            setAnaSayfamPosts(posts);
            renderAnaSayfamFeed();
        }
        function anaSayfamToggleFavorite(postId) {
            var posts = getAnaSayfamPosts();
            var post = posts.find(function(p) { return p.id === postId; });
            if (post && post._fromFirebase) return;
            var state = getAnaSayfamState();
            state.favorites = state.favorites || {};
            state.favorites[postId] = !state.favorites[postId];
            setAnaSayfamState(state);
            renderAnaSayfamFeed();
        }
        function anaSayfamAddComment(postId, text) {
            if (!text || !String(text).trim()) return;
            var posts = getAnaSayfamPosts();
            var post = posts.find(function(p) { return p.id === postId; });
            if (!post) return;
            if (post._fromFirebase) return;
            post.comments = post.comments || [];
            post.comments.push({ authorName: 'Sen', authorId: getAnaSayfamUserId(), text: String(text).trim(), createdAt: Date.now() });
            setAnaSayfamPosts(posts);
            var inp = document.querySelector('[data-ana-reply-input="' + postId + '"]');
            if (inp) inp.value = '';
            var comp = document.querySelector('[data-ana-reply-composer="' + postId + '"]');
            if (comp) comp.classList.remove('open');
            renderAnaSayfamFeed();
        }
        async function anaSayfamAddCommentFirebase(postId, text, cardOrBtn) {
            text = String(text || '').trim();
            if (!text) return;
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) { alert('Yorum yazmak için giriş yapın.'); return; }
            if (typeof db === 'undefined' || !db) { alert('Şu an yorum gönderilemiyor.'); return; }
            var card = cardOrBtn && cardOrBtn.classList && cardOrBtn.classList.contains('ana-sayfam-post-card') ? cardOrBtn : (document.getElementById('anaSayfamFeed') && document.querySelector('#anaSayfamFeed .ana-sayfam-post-card[data-post-id="' + postId + '"]'));
            var userName = user.displayName || 'Kullanıcı';
            var userPhotoUrl = user.photoURL || '';
            try {
                var profSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!profSnap.empty) { var d = profSnap.docs[0].data(); userName = d.adSoyad || userName; userPhotoUrl = d.photoUrl || userPhotoUrl; }
                await db.collection('postReplies').add({ postId: postId, userId: user.uid, userName: userName, userPhotoUrl: userPhotoUrl, text: text, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                if (typeof createMentionNotifications === 'function') await createMentionNotifications(text, user.uid, userName, userPhotoUrl, postId).catch(function() {});
                await db.collection('userPosts').doc(postId).set({ commentCount: firebase.firestore.FieldValue.increment(1) }, { merge: true });
            } catch (e) {
                console.error('anaSayfamAddCommentFirebase', e);
                alert('Yorum gönderilemedi. Lütfen tekrar deneyin.');
                return;
            }
            var ta = document.querySelector('[data-ana-reply-input="' + postId + '"]');
            if (ta) ta.value = '';
            var comp = document.querySelector('[data-ana-reply-composer="' + postId + '"]');
            if (comp) comp.classList.remove('open');
            if (!card) return;
            var countBtn = card.querySelector('[data-ana-action="comment"]');
            if (countBtn) {
                var countSpan = countBtn.querySelector('.count');
                if (countSpan) countSpan.textContent = (parseInt(countSpan.textContent, 10) || 0) + 1;
            }
            var repliesWrap = card.querySelector('.ana-sayfam-post-replies');
            var composer = card.querySelector('[data-ana-reply-composer="' + postId + '"]');
            if (!repliesWrap) {
                repliesWrap = document.createElement('div');
                repliesWrap.className = 'ana-sayfam-post-replies';
                if (composer) card.insertBefore(repliesWrap, composer);
                else card.appendChild(repliesWrap);
            }
            var rText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var uidEsc = (user.uid || '').replace(/'/g, "\\'");
            var nameEsc = (userName || 'Kullanıcı').replace(/</g, '&lt;').replace(/'/g, "\\'");
            var replyAvatarSrc = (userPhotoUrl && String(userPhotoUrl).trim()) ? String(userPhotoUrl).replace(/"/g, '&quot;') : ('https://ui-avatars.com/api/?name=' + encodeURIComponent(userName || '') + '&background=1e3a5f&color=2aa8ff');
            var item = document.createElement('div');
            item.className = 'ana-sayfam-reply-item';
            item.innerHTML = '<img class="ana-sayfam-reply-avatar" src="' + replyAvatarSrc + '" onerror="this.style.display=\'none\'" alt=""/><div><button type="button" class="ana-sayfam-reply-name-link" onclick="event.preventDefault();event.stopPropagation();if(typeof goToUserProfile===\'function\')goToUserProfile(\'' + uidEsc + '\');" title="Profile git"><span class="ana-sayfam-reply-name">' + nameEsc + '</span></button><div class="ana-sayfam-reply-text">' + rText + '</div><div class="ana-sayfam-reply-time">Az önce</div></div>';
            repliesWrap.appendChild(item);
        }
        function anaSayfamAddQuote(postId) {
            var posts = getAnaSayfamPosts();
            var original = posts.find(function(p) { return p.id === postId; });
            if (!original) return;
            if (original._fromFirebase === true && typeof openYorumYazModalForQuote === 'function') {
                openYorumYazModalForQuote(postId, original.text || '');
                return;
            }
            var text = prompt('Alıntı yorumunuzu yazın:');
            if (!text || !String(text).trim()) return;
            var newPost = {
                id: 'p' + Date.now(),
                authorName: 'Sen',
                authorId: getAnaSayfamUserId(),
                type: 'comment',
                text: String(text).trim(),
                mediaUrls: [],
                createdAt: Date.now(),
                likes: [], comments: [], favorites: [], quotedBy: [],
                quotedPostId: original.id,
                quotedAuthor: original.authorName,
                quotedText: (original.text || '').slice(0, 120) + (original.text && original.text.length > 120 ? '...' : '')
            };
            original.quotedBy = original.quotedBy || [];
            original.quotedBy.push(newPost.id);
            posts.unshift(newPost);
            setAnaSayfamPosts(posts);
            renderAnaSayfamFeed();
        }
        function anaSayfamToggleReply(postId) {
            var el = document.querySelector('[data-ana-reply-composer="' + postId + '"]');
            if (el) el.classList.toggle('open');
        }
        function renderAnaSayfamFeed() {
            var posts = getAnaSayfamPosts();
            var state = getAnaSayfamState();
            var uid = getAnaSayfamUserId();
            var feedEl = document.getElementById('anaSayfamFeed');
            if (!feedEl) return;
            if (!posts.length) {
                feedEl.innerHTML = '<div class="ana-sayfam-empty">Henüz paylaşım yok. Takip ettiğiniz kişilerin ve sizin paylaşımlarınız burada görünür.</div>';
                return;
            }
            feedEl.innerHTML = posts.map(function(p) {
                var fromFb = p._fromFirebase === true;
                var likeCount = fromFb ? (p.likeCount || 0) : (p.likes || []).length;
                var comments = p.comments || [];
                var commentCount = comments.length > 0 ? comments.length : (fromFb ? (p.commentCount || 0) : (p.comments || []).length);
                var liked = fromFb ? false : (p.likes || []).indexOf(uid) >= 0;
                var favorited = (state.favorites || {})[p.id];
                var typeLabel = p.type === 'photo' ? 'Fotoğraf' : p.type === 'video' ? 'Video' : 'Yorum';
                var mediaHtml = '';
                var anaMedia = normalizeMediaUrlsField(p.mediaUrls);
                if (anaMedia.length) {
                    mediaHtml = '<div class="ana-sayfam-post-media">' + anaMedia.map(function(url) {
                        if (isVideoMediaUrl(url)) return '<video src="' + url.replace(/"/g, '&quot;') + '" controls playsinline preload="metadata" controlsList="nodownload" style="max-width:100%; max-height:280px; border-radius:8px;"></video>';
                        return '<img src="' + url.replace(/"/g, '&quot;') + '" alt="" style="max-width:100%; max-height:280px; border-radius:8px;">';
                    }).join('') + '</div>';
                }
                var quotedHtml = '';
                if (p.quotedPostId && (p.quotedAuthor || p.quotedText)) {
                    quotedHtml = '<div class="ana-sayfam-post-quoted"><strong>' + (p.quotedAuthor || 'Alıntı') + '</strong><br/>' + (p.quotedText || '') + '</div>';
                }
                var authorId = p.authorId || '';
                var fallbackAvatar = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(p.authorName || '') + '&background=1e3a5f&color=2aa8ff';
                var postAvatarSrc = (p.authorPhotoUrl && String(p.authorPhotoUrl).trim()) ? String(p.authorPhotoUrl).replace(/"/g, '&quot;') : fallbackAvatar;
                var repliesHtml = comments.length ? '<div class="ana-sayfam-post-replies">' + comments.map(function(c) {
                    var cId = c.authorId || '';
                    var cAvatar = (c.authorPhotoUrl && String(c.authorPhotoUrl).trim()) ? String(c.authorPhotoUrl).replace(/"/g, '&quot;') : ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.authorName || '') + '&background=1e3a5f&color=2aa8ff');
                    if (cId) return '<div class="ana-sayfam-reply-item"><img class="ana-sayfam-reply-avatar" src="' + cAvatar + '" onerror="this.style.display=\'none\'" alt=""/><div><button type="button" class="ana-sayfam-reply-name-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(cId).replace(/'/g, "\\'") + '\');" title="Profile git"><span class="ana-sayfam-reply-name">' + (c.authorName || 'Kullanıcı') + '</span></button><div class="ana-sayfam-reply-text">' + (c.text || '').replace(/</g, '&lt;') + '</div><div class="ana-sayfam-reply-time">' + anaSayfamTimeAgo(c.createdAt) + '</div></div></div>';
                    return '<div class="ana-sayfam-reply-item"><img class="ana-sayfam-reply-avatar" src="' + cAvatar + '" onerror="this.style.display=\'none\'" alt=""/><div><div class="ana-sayfam-reply-name">' + (c.authorName || 'Kullanıcı') + '</div><div class="ana-sayfam-reply-text">' + (c.text || '').replace(/</g, '&lt;') + '</div><div class="ana-sayfam-reply-time">' + anaSayfamTimeAgo(c.createdAt) + '</div></div></div>';
                }).join('') + '</div>' : '';
                var postHeadContent = authorId ? '<button type="button" class="ana-sayfam-post-head-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(authorId).replace(/'/g, "\\'") + '\');" title="Profile git"><img class="ana-sayfam-post-avatar" src="' + postAvatarSrc + '" onerror="this.onerror=null;this.src=\'' + fallbackAvatar.replace(/'/g, "\\'") + '\'" alt=""/><div><div class="ana-sayfam-post-name">' + (p.authorName || 'Kullanıcı') + ' <span class="ana-sayfam-post-type-badge">' + typeLabel + '</span></div><div class="ana-sayfam-post-time">' + anaSayfamTimeAgo(p.createdAt) + '</div></div></button>' : '<img class="ana-sayfam-post-avatar" src="' + postAvatarSrc + '" onerror="this.onerror=null;this.src=\'' + fallbackAvatar.replace(/'/g, "\\'") + '\'" alt=""/><div><div class="ana-sayfam-post-name">' + (p.authorName || 'Kullanıcı') + ' <span class="ana-sayfam-post-type-badge">' + typeLabel + '</span></div><div class="ana-sayfam-post-time">' + anaSayfamTimeAgo(p.createdAt) + '</div></div>';
                var quoteBtnExtra = fromFb ? ' data-ana-from-firebase="1" data-ana-quoted-text="' + (p.text || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').substring(0, 200) + '"' : '';
                return '<article class="ana-sayfam-post-card" data-post-id="' + p.id + '"' + (fromFb ? ' data-ana-from-firebase="1"' : '') + '>' +
                    '<div class="ana-sayfam-post-head">' + postHeadContent + '</div>' +
                    (p.text ? '<div class="ana-sayfam-post-text">' + (p.text || '').replace(/</g, '&lt;') + '</div>' : '') +
                    quotedHtml + mediaHtml +
                    '<div class="ana-sayfam-post-actions">' +
                    '<button type="button" class="ana-sayfam-post-action ' + (liked ? 'active' : '') + '" data-ana-action="like" data-ana-post-id="' + p.id + '"' + (fromFb ? ' data-ana-from-firebase="1"' : '') + '><i class="fas fa-heart"></i> <span class="count">' + likeCount + '</span> Beğeni</button>' +
                    '<button type="button" class="ana-sayfam-post-action" data-ana-action="comment" data-ana-post-id="' + p.id + '"><i class="fas fa-comment"></i> <span class="count">' + commentCount + '</span> Yorum</button>' +
                    '<button type="button" class="ana-sayfam-post-action ' + (favorited ? 'favorited' : '') + '" data-ana-action="favorite" data-ana-post-id="' + p.id + '"' + (fromFb ? ' data-ana-from-firebase="1"' : '') + '><i class="fas fa-star"></i> Favoriler</button>' +
                    '<button type="button" class="ana-sayfam-post-action" data-ana-action="quote" data-ana-post-id="' + p.id + '" title="Alıntıla"' + quoteBtnExtra + '><span class="ana-sayfam-quote-symbol">\u2B80</span></button>' +
                    '</div>' +
                    '<div class="ana-sayfam-reply-composer" data-ana-reply-composer="' + p.id + '"><textarea placeholder="Yorum yazın..." data-ana-reply-input="' + p.id + '"></textarea><button type="button" class="ana-sayfam-reply-send" data-ana-send-reply="' + p.id + '">Gönder</button></div>' +
                    repliesHtml + '</article>';
            }).join('');
            feedEl.querySelectorAll('[data-ana-action="like"]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var postId = this.getAttribute('data-ana-post-id');
                    if (this.getAttribute('data-ana-from-firebase') === '1' && typeof yorumPostLike === 'function') yorumPostLike(postId, this);
                    else anaSayfamToggleLike(postId);
                });
            });
            feedEl.querySelectorAll('[data-ana-action="favorite"]').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var postId = this.getAttribute('data-ana-post-id');
                    if (this.getAttribute('data-ana-from-firebase') === '1' && typeof yorumPostFavorite === 'function') yorumPostFavorite(postId, this);
                    else anaSayfamToggleFavorite(postId);
                });
            });
            feedEl.querySelectorAll('[data-ana-action="quote"]').forEach(function(btn) {
                btn.addEventListener('click', function() { anaSayfamAddQuote(this.getAttribute('data-ana-post-id')); });
            });
            feedEl.querySelectorAll('[data-ana-action="comment"]').forEach(function(btn) {
                btn.addEventListener('click', function() { anaSayfamToggleReply(this.getAttribute('data-ana-post-id')); });
            });
            (function bindAnaSayfamSendOnce() {
                if (feedEl._anaSayfamSendBound) return;
                feedEl._anaSayfamSendBound = true;
                feedEl.addEventListener('click', function(ev) {
                    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-ana-send-reply]') : null;
                    if (!btn) return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    var postId = btn.getAttribute('data-ana-send-reply');
                    if (!postId) return;
                    var ta = document.querySelector('[data-ana-reply-input="' + postId + '"]');
                    var text = ta ? ta.value : '';
                    var posts = getAnaSayfamPosts();
                    var post = posts.find(function(p) { return p.id === postId; });
                    var isFirebase = post && post._fromFirebase === true;
                    var card = document.getElementById('anaSayfamFeed') && document.querySelector('#anaSayfamFeed .ana-sayfam-post-card[data-post-id="' + postId + '"]');
                    if (isFirebase) anaSayfamAddCommentFirebase(postId, text, card);
                    else anaSayfamAddComment(postId, text);
                });
            })();
        }
        function openAnaSayfamModal() {
            var modal = document.getElementById('anaSayfamModal');
            var icon = document.getElementById('anaSayfamDockIcon');
            if (modal) {
                modal.classList.remove('ana-sayfam-docked');
                modal.classList.add('open');
                modal.style.display = 'flex';
            }
            if (icon) { icon.className = 'fas fa-chevron-down'; icon.title = 'Ekranı alta indir'; }
            if (typeof auth !== 'undefined' && auth.currentUser) loadAnaSayfamFromFirebase();
            else renderAnaSayfamFeed();
        }
        function closeAnaSayfamModal() {
            var modal = document.getElementById('anaSayfamModal');
            if (modal) { modal.classList.remove('open', 'ana-sayfam-docked'); modal.style.display = 'none'; }
            var icon = document.getElementById('anaSayfamDockIcon');
            if (icon) { icon.className = 'fas fa-chevron-down'; }
        }
        function toggleAnaSayfamDock() {
            var modal = document.getElementById('anaSayfamModal');
            var icon = document.getElementById('anaSayfamDockIcon');
            if (!modal || !icon) return;
            var isDocked = modal.classList.toggle('ana-sayfam-docked');
            icon.className = isDocked ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
            icon.title = isDocked ? 'Yukarı aç' : 'Ekranı alta indir';
        }
        document.getElementById('anaSayfamModal').addEventListener('click', function(e) {
            if (this.classList.contains('ana-sayfam-docked') && !e.target.closest('.ana-sayfam-header-btns')) toggleAnaSayfamDock();
        });

        async function refreshFriendsBadge() {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const snap = await db.collection('friendRequests').where('toUserId','==',user.uid).where('status','==','pending').get();
                const badge = document.getElementById('friendsBadge');
                if (snap.size > 0) { badge.textContent = snap.size; badge.style.display = 'inline-flex'; }
                else { badge.style.display = 'none'; }
                const notifyEl = document.getElementById('friendsNotifyCount');
                if (snap.size > 0) { notifyEl.textContent = snap.size; notifyEl.style.display = 'inline'; }
                else { notifyEl.style.display = 'none'; }
            } catch (e) {}
        }

        function friendsSwitchTab(tab) {
            document.querySelectorAll('.friends-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.friends-tab[data-tab="' + tab + '"]')?.classList.add('active');
            document.getElementById('friendsListPanel').style.display = tab === 'takip_edilen' ? 'block' : 'none';
            document.getElementById('friendsTakipciPanel').style.display = tab === 'takipci' ? 'block' : 'none';
            document.getElementById('friendsNotifyPanel').style.display = tab === 'bildirimler' ? 'block' : 'none';
            document.getElementById('friendsSearchPanel').style.display = tab === 'arama' ? 'block' : 'none';
            if (tab === 'takip_edilen') loadFriendsList();
            else if (tab === 'takipci') loadFriendsTakipciList();
            else if (tab === 'bildirimler') loadFriendsNotifications();
        }

        async function loadFriendsList() {
            const user = auth.currentUser;
            const cnt = document.getElementById('friendsListContainer');
            cnt.innerHTML = '';
            if (!user) return;
            try {
                const snap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','accepted').get();
                if (snap.empty) { cnt.innerHTML = '<div class="friends-empty">Henüz kimseyi takip etmiyorsunuz. Arama veya profil sayfalarından Takip Et ile ekleyebilirsiniz.</div>'; return; }
                const ids = snap.docs.map(d => d.data().toUserId);
                const profilesSnap = await db.collection('userProfiles').get();
                const profiles = {};
                profilesSnap.docs.forEach(d => { const p = d.data(); if (p.userId) profiles[p.userId] = p; });
                ids.forEach(fid => {
                    const p = profiles[fid] || {};
                    const card = document.createElement('div');
                    card.className = 'friend-card';
                    card.innerHTML = '<div class="friend-card-actions"><button type="button" class="friend-btn friend-btn-view" onclick="viewFriendProfile(\'' + fid + '\')">Profil</button><button type="button" class="friend-btn friend-btn-unfollow" onclick="friendUnfollow(\'' + fid + '\'); loadFriendsList();">Takipten Çık</button><button type="button" class="friend-btn friend-btn-msg" onclick="friendMessage(\'' + fid + '\')">Mesaj At</button></div><div class="friend-card-body"><button type="button" class="friend-card-profile-link" onclick="event.preventDefault();event.stopPropagation();viewFriendProfile(\'' + (fid || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="friend-card-avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="friend-card-info"><div class="friend-card-name">' + (p.adSoyad || 'İsimsiz') + '</div><div class="friend-card-email">' + (p.email || '') + '</div></div></button></div>';
                    cnt.appendChild(card);
                });
            } catch (e) { cnt.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>'; }
        }

        async function loadFriendsTakipciList() {
            const user = auth.currentUser;
            const cnt = document.getElementById('friendsTakipciContainer');
            if (!cnt) return;
            cnt.innerHTML = '';
            if (!user) return;
            try {
                const snap = await db.collection('friendRequests').where('toUserId','==',user.uid).where('status','==','accepted').get();
                if (snap.empty) { cnt.innerHTML = '<div class="friends-empty">Sizi takip eden kimse yok.</div>'; return; }
                const ids = snap.docs.map(d => d.data().fromUserId);
                const profilesSnap = await db.collection('userProfiles').get();
                const profiles = {};
                profilesSnap.docs.forEach(d => { const p = d.data(); if (p.userId) profiles[p.userId] = p; });
                const myFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','accepted').get();
                const myFollowIds = new Set(myFollowsSnap.docs.map(d => d.data().toUserId));
                const pendingSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','pending').get();
                const pendingIds = new Set(pendingSnap.docs.map(d => d.data().toUserId));
                ids.forEach(fid => {
                    const p = profiles[fid] || {};
                    const isFollow = myFollowIds.has(fid);
                    const isPending = pendingIds.has(fid);
                    var btn = '';
                    if (isFollow) btn = '<span style="color:#16a34a;font-weight:700;">Takip ettiğim</span>';
                    else if (isPending) btn = '<span style="color:#fbbf24;">Beklemede</span>';
                    else btn = '<button type="button" class="friend-btn friend-btn-add" onclick="friendAdd(\'' + fid + '\'); loadFriendsTakipciList();">Takip Et</button>';
                    const card = document.createElement('div');
                    card.className = 'friend-card';
                    card.innerHTML = '<div class="friend-card-actions"><button type="button" class="friend-btn friend-btn-view" onclick="viewFriendProfile(\'' + fid + '\')">Profil</button>' + btn + '<button type="button" class="friend-btn friend-btn-msg" onclick="friendMessage(\'' + fid + '\')">Mesaj At</button></div><div class="friend-card-body"><button type="button" class="friend-card-profile-link" onclick="event.preventDefault();event.stopPropagation();viewFriendProfile(\'' + (fid || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="friend-card-avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="friend-card-info"><div class="friend-card-name">' + (p.adSoyad || 'İsimsiz') + '</div><div class="friend-card-email">' + (p.email || '') + '</div></div></button></div>';
                    cnt.appendChild(card);
                });
            } catch (e) { cnt.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>'; }
        }

        async function loadFriendsNotifications() {
            const user = auth.currentUser;
            const cnt = document.getElementById('friendsNotifyContainer');
            cnt.innerHTML = '';
            if (!user) return;
            try {
                const snap = await db.collection('friendRequests').where('toUserId','==',user.uid).where('status','==','pending').get();
                if (snap.empty) { cnt.innerHTML = '<div class="friends-empty">Bekleyen takip isteğiniz yok.</div>'; return; }
                for (const doc of snap.docs) {
                    const r = doc.data();
                    const profSnap = await db.collection('userProfiles').where('userId','==',r.fromUserId).limit(1).get();
                    const p = profSnap.empty ? {} : profSnap.docs[0].data();
                    const card = document.createElement('div');
                    card.className = 'friend-card';
                    card.innerHTML = '<div class="friend-card-actions"><button type="button" class="friend-btn friend-btn-accept" onclick="friendAccept(\'' + doc.id + '\',\'' + r.fromUserId + '\')">Kabul Et</button><button type="button" class="friend-btn friend-btn-reject" onclick="friendReject(\'' + doc.id + '\')">Red</button></div><div class="friend-card-body"><button type="button" class="friend-card-profile-link" onclick="event.preventDefault();event.stopPropagation();viewFriendProfile(\'' + (r.fromUserId || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="friend-card-avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="friend-card-info"><div class="friend-card-name">' + (p.adSoyad || 'İsimsiz') + ' sizi takip etmek istiyor</div><div class="friend-card-email">' + (p.email || '') + '</div></div></button></div>';
                    cnt.appendChild(card);
                }
                await refreshFriendsBadge();
            } catch (e) { cnt.innerHTML = '<div class="friends-empty">Bekleyen takip isteği yok veya hata oluştu.</div>'; }
        }

        async function friendsSearch() {
            const q = document.getElementById('friendsSearchInput').value.trim().toLowerCase();
            if (!q) { alert('Kullanıcı Adı, Adı Soyadı veya E-mail girin.'); return; }
            const user = auth.currentUser;
            if (!user) return;
            const cnt = document.getElementById('friendsSearchContainer');
            cnt.innerHTML = '<div class="friends-empty">Aranıyor...</div>';
            friendsSwitchTab('arama');
            try {
                const blockedMeSnap = await db.collection('userBlocks').where('blockedUserId','==',user.uid).get();
                const blockedMeIds = new Set(blockedMeSnap.docs.map(d => d.data().userId));
                const snap = await db.collection('userProfiles').get();
                const qClean = q.replace(/^@+/, '');
                const results = snap.docs.filter(d => {
                    const p = d.data();
                    if (p.userId === user.uid) return false;
                    if (blockedMeIds.has(p.userId)) return false;
                    const ad = (p.adSoyad || '').toLowerCase();
                    const em = (p.email || '').toLowerCase();
                    const un = (p.username || '').toLowerCase();
                    return ad.includes(q) || em.includes(q) || un.includes(qClean);
                });
                cnt.innerHTML = '';
                if (results.length === 0) { cnt.innerHTML = '<div class="friends-empty">Sonuç bulunamadı.</div>'; return; }
                const myFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','accepted').get();
                const myFollowIds = new Set(myFollowsSnap.docs.map(d => d.data().toUserId));
                const pendingSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','pending').get();
                const pendingIds = new Set(pendingSnap.docs.map(d => d.data().toUserId));
                for (const d of results) {
                    const p = d.data();
                    const fid = p.userId;
                    const isFriend = myFollowIds.has(fid);
                    const isPending = pendingIds.has(fid);
                    let btn = '';
                    if (isFriend) btn = '<span style="color:#16a34a;">Takip ediyorsunuz</span>';
                    else if (isPending) btn = '<span style="color:#fbbf24;">Beklemede</span>';
                    else btn = '<button type="button" class="friend-btn friend-btn-add" onclick="friendAdd(\'' + fid + '\')">Takip Et</button>';
                    const card = document.createElement('div');
                    card.className = 'friend-card';
                    card.innerHTML = '<div class="friend-card-actions"><button type="button" class="friend-btn friend-btn-view" onclick="viewFriendProfile(\'' + fid + '\')">Profil</button>' + btn + '<button type="button" class="friend-btn friend-btn-msg" onclick="friendMessage(\'' + fid + '\'); closeFriendProfileView();">Mesaj At</button></div><div class="friend-card-body"><button type="button" class="friend-card-profile-link" onclick="event.preventDefault();event.stopPropagation();viewFriendProfile(\'' + (fid || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="friend-card-avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="friend-card-info"><div class="friend-card-name">' + (p.adSoyad || 'İsimsiz') + '</div><div class="friend-card-email">' + (p.email || '') + '</div></div></button></div>';
                    cnt.appendChild(card);
                }
            } catch (e) { cnt.innerHTML = '<div class="friends-empty">Arama sırasında hata oluştu.'; }
        }

        async function friendAdd(toUserId) {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const pendingSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('toUserId','==',toUserId).where('status','==','pending').get();
                if (!pendingSnap.empty) { alert('Zaten takip isteği gönderdiniz.'); return; }
                const acceptedSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('toUserId','==',toUserId).where('status','==','accepted').get();
                if (!acceptedSnap.empty) { alert('Zaten bu kişiyi takip ediyorsunuz.'); return; }
                const profSnap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                const p = profSnap.empty ? {} : profSnap.docs[0].data();
                await db.collection('friendRequests').add({
                    fromUserId: user.uid,
                    toUserId: toUserId,
                    status: 'pending',
                    fromUserName: p.adSoyad || '',
                    fromPhotoUrl: p.photoUrl || '',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                showToast('Takip isteği gönderildi.');
                var searchInput = document.getElementById('friendsSearchInput');
                if (searchInput && searchInput.value.trim()) await friendsSearch();
                await refreshFriendsBadge();
            } catch (e) { alert('İstek gönderilemedi.'); }
        }

        async function friendAccept(requestId, fromUserId) {
            const user = auth.currentUser;
            if (!user) return;
            try {
                await db.collection('friendRequests').doc(requestId).update({ status: 'accepted' });
                await loadFriendsNotifications();
                await loadFriendsList();
                await refreshFriendsBadge();
            } catch (e) { alert('Kabul edilemedi.'); }
        }

        async function friendReject(requestId) {
            try {
                await db.collection('friendRequests').doc(requestId).update({ status: 'rejected' });
                await loadFriendsNotifications();
                await refreshFriendsBadge();
            } catch (e) {}
        }

        async function friendUnfollow(friendId) {
            var user = auth.currentUser;
            if (!user) return;
            if (!confirm('Bu kişiyi takipten çıkarmak istediğinize emin misiniz? Artık takip ettikleriniz listesinde görünmeyecek.')) return;
            try {
                var snap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('toUserId','==',friendId).where('status','==','accepted').get();
                var batch = db.batch();
                snap.docs.forEach(function(d){ batch.delete(d.ref); });
                await batch.commit();
                viewFriendProfile(friendId);
                await loadFriendsList();
                await refreshFriendsBadge();
            } catch (e) { alert('Takipten çıkarma işlemi yapılamadı.'); }
        }

        async function friendBlock(friendId) {
            var user = auth.currentUser;
            if (!user) return;
            try {
                await db.collection('userBlocks').add({ userId: user.uid, blockedUserId: friendId });
                viewFriendProfile(friendId);
            } catch (e) { alert('Engelleme işlemi yapılamadı.'); }
        }

        async function friendUnblock(friendId) {
            var user = auth.currentUser;
            if (!user) return;
            try {
                var snap = await db.collection('userBlocks').where('userId','==',user.uid).where('blockedUserId','==',friendId).get();
                var batch = db.batch();
                snap.docs.forEach(function(d){ batch.delete(d.ref); });
                await batch.commit();
                viewFriendProfile(friendId);
            } catch (e) { alert('Engel kaldırılamadı.'); }
        }

        var currentViewedFriendId = null;
        var currentViewedProfileIsCorporate = false;
        var currentViewedCanSeeContent = true;

        async function openMyProfileView() {
            const user = auth.currentUser;
            if (!user) { alert('Profil için önce giriş yapmanız gerekiyor.'); return; }
            var snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
            if (snap.empty) {
                openProfileModal();
                return;
            }
            viewFriendProfile(user.uid);
        }

        function goToUserProfile(userId) {
            if (!userId) return;
            var friendsModal = document.getElementById('friendsModal');
            if (friendsModal && !friendsModal.classList.contains('open')) {
                if (typeof openFriendsModal === 'function') openFriendsModal();
                setTimeout(function() {
                    if (typeof viewFriendProfile === 'function') viewFriendProfile(userId);
                }, 150);
            } else {
                if (typeof viewFriendProfile === 'function') viewFriendProfile(userId);
            }
        }
        window.goToUserProfile = goToUserProfile;

        async function viewFriendProfile(friendId) {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const snap = await db.collection('userProfiles').where('userId','==',friendId).limit(1).get();
                if (snap.empty) { alert('Profil bulunamadı.'); return; }
                const p = snap.docs[0].data();
                currentViewedFriendId = friendId;
                var isOwnProfile = (friendId === user.uid);

                var displayName = p.username || p.adSoyad || p.firmaKullaniciAdi || p.firmaIsmi || (isOwnProfile ? 'Profilim' : 'Profil');
                document.getElementById('friendProfileViewTitle').textContent = displayName;
                var kariyerTab = document.querySelector('.friend-profile-tab[data-tab="kariyer"]');
                if (kariyerTab) kariyerTab.textContent = (p.memberType === 'corporate') ? 'İş İlanları' : 'Kariyer';
                var photoEl = document.getElementById('friendProfilePhoto');
                var placeEl = document.getElementById('friendProfilePhotoPlaceholder');
                if (p.photoUrl) { photoEl.src = p.photoUrl; photoEl.style.display = 'block'; placeEl.style.display = 'none'; } else { photoEl.style.display = 'none'; placeEl.style.display = 'flex'; }
                document.getElementById('friendProfileName').textContent = (p.memberType === 'corporate' ? (p.firmaIsmi || p.firmaKullaniciAdi) : p.adSoyad) || p.username || 'Ad Soyad';
                var sectionTitleEl = document.getElementById('friendProfileSectionTitle');
                if (sectionTitleEl) { sectionTitleEl.textContent = displayName; sectionTitleEl.style.display = 'block'; }

                var myFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','accepted').get();
                var theirFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',friendId).where('status','==','accepted').get();
                var theirFollowersSnap = await db.collection('friendRequests').where('toUserId','==',friendId).where('status','==','accepted').get();
                var profilePrivacy = p.profilePrivacy || 'public';
                var isFollower = theirFollowersSnap.docs.some(function(d){ return d.data().fromUserId === user.uid; });
                currentViewedCanSeeContent = isOwnProfile || profilePrivacy === 'public' || (profilePrivacy === 'followers' && isFollower);
                var tabsEl = document.querySelector('.friend-profile-tabs');
                if (tabsEl) tabsEl.style.display = currentViewedCanSeeContent ? '' : 'none';
                var mySet = new Set(myFollowsSnap.docs.map(function(d){ return d.data().toUserId; }));
                var theirSet = new Set(theirFollowsSnap.docs.map(function(d){ return d.data().toUserId; }));
                var ortak = 0; mySet.forEach(function(id){ if(theirSet.has(id)) ortak++; });
                if (isOwnProfile) {
                    document.getElementById('friendProfileOrtak').textContent = myFollowsSnap.size;
                } else {
                    document.getElementById('friendProfileOrtak').textContent = ortak;
                }
                document.getElementById('friendProfileTakip').textContent = theirFollowsSnap.size;
                document.getElementById('friendProfileTakipci').textContent = theirFollowersSnap.size;

                var bioEl = document.getElementById('friendProfileBio');
                if (bioEl) {
                    var bioText = (p.biography || '').trim();
                    bioEl.textContent = bioText;
                    bioEl.style.display = bioText ? 'block' : 'none';
                }

                var actionsHtml = '';
                if (isOwnProfile) {
                    actionsHtml = '<div class="friend-profile-actions-row"><button type="button" class="friend-btn friend-btn-view" onclick="closeFriendProfileView(); openProfileModal();">Profili Düzenle</button></div>';
                } else {
                    var isFriend = mySet.has(friendId);
                    var pendingSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('toUserId','==',friendId).where('status','==','pending').get();
                    var isPending = !pendingSnap.empty;
                    var blockSnap = await db.collection('userBlocks').where('userId','==',user.uid).where('blockedUserId','==',friendId).limit(1).get();
                    var isBlocked = !blockSnap.empty;
                    var row1 = '';
                    if (isFriend) row1 = '<span style="color:#16a34a;font-weight:700;">Takip ettiğim</span>';
                    else if (isPending) row1 = '<span style="color:#fbbf24;">Beklemede</span>';
                    else row1 = '<button type="button" class="friend-btn friend-btn-add" onclick="friendAdd(\'' + friendId + '\'); viewFriendProfile(\'' + friendId + '\');">Takip Et</button>';
                    row1 += '<button type="button" class="friend-btn friend-btn-msg" onclick="friendMessage(\'' + friendId + '\'); closeFriendProfileView();">Mesaj</button>';
                    var row2 = '';
                    if (isFriend) row2 += '<button type="button" class="friend-btn friend-btn-unfollow" onclick="friendUnfollow(\'' + friendId + '\');">Takipten Çık</button>';
                    if (isBlocked) row2 += '<button type="button" class="friend-btn friend-btn-block" onclick="friendUnblock(\'' + friendId + '\'); viewFriendProfile(\'' + friendId + '\');">Engeli Kaldır</button>';
                    else row2 += '<button type="button" class="friend-btn friend-btn-block" onclick="friendBlock(\'' + friendId + '\'); viewFriendProfile(\'' + friendId + '\');">Engelle</button>';
                    actionsHtml = '<div class="friend-profile-actions-row">' + row1 + '</div>';
                    if (row2) actionsHtml += '<div class="friend-profile-actions-row">' + row2 + '</div>';
                }
                document.getElementById('friendProfileActions').innerHTML = actionsHtml;

                document.querySelectorAll('.friend-profile-tab').forEach(function(t){ t.classList.remove('active'); if(t.getAttribute('data-tab')==='kisisel') t.classList.add('active'); });
                var bodyEl = document.getElementById('friendProfileViewBody');
                if (bodyEl) bodyEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
                document.getElementById('friendProfileViewModal').classList.add('open');
                document.getElementById('friendProfileViewModal').style.display = 'flex';
                await loadFriendProfileTabContent(friendId, 'kisisel');
            } catch (e) { alert('Profil yüklenemedi.'); }
        }
        window.viewFriendProfile = viewFriendProfile;

        var friendProfileStatListData = [];
        var friendProfileStatSearchMode = '';

        function closeFriendListWindow() {
            var m = document.getElementById('friendListWindowModal');
            if (m) { m.classList.remove('open'); m.style.display = 'none'; }
        }

        async function openFriendProfileStatSearch(mode) {
            var friendId = currentViewedFriendId;
            if (!friendId) return;
            var user = auth.currentUser;
            if (!user) return;
            friendProfileStatSearchMode = mode;
            var titles = { ortak: 'Ortak Tak', takip: 'Takip Edilen', takipci: 'Takipçi' };
            document.getElementById('friendListWindowTitle').textContent = titles[mode] || 'Liste';
            var inp = document.getElementById('friendListWindowSearchInput');
            inp.value = '';
            inp.placeholder = mode === 'ortak' ? 'Ortak takipte ara...' : (mode === 'takip' ? 'Takip ettiklerinde ara...' : 'Takipçilerde ara...');

            var ids = [];
            if (mode === 'ortak') {
                var myFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',user.uid).where('status','==','accepted').get();
                var theirFollowsSnap = await db.collection('friendRequests').where('fromUserId','==',friendId).where('status','==','accepted').get();
                var mySet = new Set(myFollowsSnap.docs.map(function(d){ return d.data().toUserId; }));
                theirFollowsSnap.docs.forEach(function(d){ var id = d.data().toUserId; if (mySet.has(id)) ids.push(id); });
            } else if (mode === 'takip') {
                var theirSnap = await db.collection('friendRequests').where('fromUserId','==',friendId).where('status','==','accepted').get();
                ids = theirSnap.docs.map(function(d){ return d.data().toUserId; });
            } else if (mode === 'takipci') {
                var followersSnap = await db.collection('friendRequests').where('toUserId','==',friendId).where('status','==','accepted').get();
                ids = followersSnap.docs.map(function(d){ return d.data().fromUserId; });
            }
            friendProfileStatListData = [];
            for (var i = 0; i < ids.length; i++) {
                var snap = await db.collection('userProfiles').where('userId','==',ids[i]).limit(1).get();
                if (!snap.empty) { var d = snap.docs[0].data(); d.userId = ids[i]; friendProfileStatListData.push(d); }
            }
            renderFriendListWindowList(friendProfileStatListData);
            var modal = document.getElementById('friendListWindowModal');
            modal.classList.add('open');
            modal.style.display = 'flex';
            setTimeout(function(){ inp.focus(); }, 100);
        }

        function filterFriendListWindow() {
            var q = (document.getElementById('friendListWindowSearchInput').value || '').toLowerCase().trim();
            if (!q) { renderFriendListWindowList(friendProfileStatListData); return; }
            var filtered = friendProfileStatListData.filter(function(p) {
                var ad = (p.adSoyad || '').toLowerCase();
                var em = (p.email || '').toLowerCase();
                return ad.indexOf(q) !== -1 || em.indexOf(q) !== -1;
            });
            renderFriendListWindowList(filtered);
        }

        function renderFriendListWindowList(list) {
            var el = document.getElementById('friendListWindowList');
            if (!el) return;
            if (list.length === 0) { el.innerHTML = '<div class="friends-empty" style="padding:16px;">Kimse bulunamadı.</div>'; return; }
            el.innerHTML = list.map(function(p) {
                var uid = (p.userId || '').replace(/'/g, "\\'");
                var name = (p.adSoyad || 'İsimsiz').replace(/</g,'&lt;');
                var img = p.photoUrl ? '<img src="' + p.photoUrl.replace(/"/g,'&quot;') + '" alt="">' : '<div style="width:44px;height:44px;border-radius:50%;background:#1e3a5f;color:#8fd3ff;display:flex;align-items:center;justify-content:center;font-size:12px;">Foto</div>';
                return '<div class="friend-list-window-list-item" onclick="closeFriendListWindow(); viewFriendProfile(\'' + uid + '\');">' + img + '<span>' + name + '</span></div>';
            }).join('');
        }

        var friendProfileTabOverlaySwipeStartX = 0;
        function openFriendProfileTabOverlay(tabName) {
            var overlay = document.getElementById('friendProfileTabOverlay');
            var titleEl = document.getElementById('friendProfileTabOverlayTitle');
            var tabLabels = { kisisel: 'Kişisel Bilgiler', yorumlar: 'Yorumlar', foto: 'Fotoğraflar', video: 'Videolar', kariyer: currentViewedProfileIsCorporate ? 'İş İlanları' : 'Kariyer' };
            if (overlay && titleEl) {
                titleEl.textContent = tabLabels[tabName] || tabName;
                overlay.classList.add('open');
                overlay.style.display = 'flex';
                overlay.setAttribute('aria-hidden', 'false');
            }
        }
        function closeFriendProfileTabOverlay() {
            var overlay = document.getElementById('friendProfileTabOverlay');
            if (overlay) {
                overlay.classList.remove('open');
                overlay.style.display = 'none';
                overlay.setAttribute('aria-hidden', 'true');
            }
        }
        function initFriendProfileTabOverlaySwipe() {
            var overlay = document.getElementById('friendProfileTabOverlay');
            if (!overlay) return;
            overlay.addEventListener('touchstart', function(ev) {
                if (ev.touches && ev.touches[0]) friendProfileTabOverlaySwipeStartX = ev.touches[0].clientX;
            }, { passive: true });
            overlay.addEventListener('touchend', function(ev) {
                if (!overlay.classList.contains('open')) return;
                if (ev.changedTouches && ev.changedTouches[0]) {
                    var delta = ev.changedTouches[0].clientX - friendProfileTabOverlaySwipeStartX;
                    if (delta > 60) closeFriendProfileTabOverlay();
                }
            }, { passive: true });
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { whenIdle(initFriendProfileTabOverlaySwipe); });
        else whenIdle(initFriendProfileTabOverlaySwipe);
        if (typeof window !== 'undefined') window.closeFriendProfileTabOverlay = closeFriendProfileTabOverlay;
        function friendProfileSwitchTab(tabName) {
            document.querySelectorAll('.friend-profile-tab').forEach(function(t){ t.classList.toggle('active', t.getAttribute('data-tab')===tabName); });
            if (!currentViewedFriendId) return;
            openFriendProfileTabOverlay(tabName);
            loadFriendProfileTabContent(currentViewedFriendId, tabName, document.getElementById('friendProfileTabOverlayBody'));
        }

        async function loadFriendProfileTabContent(friendId, tabName, targetBody) {
            var body = targetBody || document.getElementById('friendProfileViewBody');
            if (!body) return;
            body.classList.remove('friend-profile-yorumlar-list');
            if (!currentViewedCanSeeContent) {
                body.innerHTML = '<div class="friends-empty" style="padding:24px;text-align:center;color:#8fd3ff;">Bu kullanıcı profilini gizlemiş. Kişisel bilgiler, yorumlar, fotoğraflar, videolar ve kariyer bilgileri görüntülenemez.</div>';
                return;
            }
            body.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            if (tabName === 'kisisel') {
                var snap = await db.collection('userProfiles').where('userId','==',friendId).limit(1).get();
                var p = snap.empty ? {} : snap.docs[0].data();
                var isCorp = p.memberType === 'corporate';
                if (isCorp) {
                    var sectionTitle = 'Firma Bilgileri';
                    body.innerHTML = '<div class="profile-info-area"><h3 class="friend-profile-body-section">' + sectionTitle + '</h3>' +
                        '<div class="profile-field"><label>Firma Kullanıcı Adı</label><span>' + (p.firmaKullaniciAdi || p.username || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma İsmi</label><span>' + (p.firmaIsmi || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma E-Mail</label><span>' + (p.firmaEmail || p.email || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma Kuruluş Yılı</label><span>' + (p.firmaKurulusYili || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma Sektör Bilgisi</label><span>' + (p.firmaSektor || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma Faaliyet Alanları</label><span>' + (p.firmaFaaliyetAlanlari || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma Adres</label><span>' + (p.firmaAdres || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Firma İletişim Bilgileri</label><span>' + (p.firmaIletisim || '-') + '</span></div></div>';
                } else {
                    var usernameDisplay = (p.username || '').trim() ? ('@' + (p.username || '').replace(/</g, '&lt;')) : '-';
                    body.innerHTML = '<div class="profile-info-area"><h3 class="friend-profile-body-section">Kariyer</h3>' +
                        '<div class="profile-field"><label>Kullanıcı Adı</label><span>' + usernameDisplay + '</span></div>' +
                        '<div class="profile-field"><label>Adı Soyadı</label><span>' + (p.adSoyad || '-') + '</span></div>' +
                        '<div class="profile-field"><label>E-mail</label><span>' + (p.email || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Üniversite</label><span>' + (p.universite || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Kurum/Firma</label><span>' + (p.kurum || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Meslek</label><span>' + (p.meslek || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Ünvan</label><span>' + (p.unvan || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Şehir</label><span>' + (p.sehir || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Doğum Tarihi</label><span>' + (p.dogumTarihi || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Sertifikalar</label><span>' + (p.sertifikalar || '-') + '</span></div>' +
                        '<div class="profile-field"><label>Hobiler</label><span>' + (p.hobiler || '-') + '</span></div></div>';
                }
                return;
            }
            if (tabName === 'yorumlar') {
                await loadFriendProfileYorumlarTab(friendId, body);
                return;
            }
            if (tabName === 'foto' || tabName === 'video') {
                var postsSnap = await db.collection('userPosts').where('userId','==',friendId).get();
                var list = postsSnap.docs.map(function(d){ var x = d.data(); x.id = d.id; return x; });
                list.sort(function(a,b){ var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0; var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0; return tb - ta; });
                var html = '';
                list.forEach(function(post) {
                    var mediaUrls = normalizeMediaUrlsField(post.mediaUrls);
                    var videoUrls = mediaUrls.filter(function(u){ return isVideoMediaUrl(u); });
                    var photoUrls = mediaUrls.filter(function(u){ return !isVideoMediaUrl(u); });
                    if (tabName === 'foto' && photoUrls.length === 0) return;
                    if (tabName === 'video' && videoUrls.length === 0) return;
                    var dateStr = '';
                    if (post.createdAt && post.createdAt.toDate) dateStr = post.createdAt.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
                    var mediaHtml = '';
                    if (tabName === 'foto') {
                        photoUrls.forEach(function(url){ mediaHtml += '<img src="' + url.replace(/"/g,'&quot;') + '" alt="" class="post-media">'; });
                    } else {
                        videoUrls.forEach(function(url){ mediaHtml += '<video src="' + url.replace(/"/g,'&quot;') + '" controls class="post-media"></video>'; });
                    }
                    html += '<div class="friend-profile-post-item"><div class="friend-profile-post-date">' + dateStr + '</div><div class="post-text">' + (post.text || '').replace(/</g,'&lt;') + '</div><div class="post-media">' + mediaHtml + '</div></div>';
                });
                body.innerHTML = html || '<div class="friends-empty">Henüz içerik yok.</div>';
                return;
            }
            if (tabName === 'kariyer') {
                var user = auth.currentUser;
                var snap = await db.collection('userProfiles').where('userId','==',friendId).limit(1).get();
                var p = snap.empty ? {} : snap.docs[0].data();
                var docRef = snap.empty ? null : snap.docs[0].ref;
                var isCorporate = p.memberType === 'corporate';
                var sectionTitle = isCorporate ? 'İş İlanları' : 'Kariyer';
                if (user && user.uid === friendId) {
                    if (isCorporate) {
                        var jobPdfUrl = p.jobPostingPdfUrl || p.careerCvFileUrl || '';
                        body.innerHTML = '<div class="friend-profile-kariyer-editor"><h3 class="friend-profile-body-section">' + sectionTitle + '</h3>' +
                            '<p class="friend-profile-kariyer-desc">İş ilanınızı PDF olarak yükleyin. Tüm bireysel ve kurumsal kullanıcılar bu ilanı görebilir.</p>' +
                            '<div class="kariyer-file-row"><button type="button" class="friend-btn friend-btn-view" onclick="document.getElementById(\'friendProfileJobPdfFile\').click()"><i class="fas fa-paperclip"></i> İş ilanı PDF yükle</button><input type="file" id="friendProfileJobPdfFile" accept=".pdf">' +
                            '<span id="friendProfileJobPdfFileName" style="color:#8fd3ff;font-size:12px;"></span></div>' +
                            '<div class="kariyer-btns"><button type="button" class="friend-btn friend-btn-add" id="friendProfileJobPdfSave" onclick="saveFriendProfileJobPdf()">Kaydet</button><button type="button" class="friend-btn friend-btn-reject" id="friendProfileJobPdfDel" onclick="deleteFriendProfileJobPdf()" style="' + (jobPdfUrl ? '' : 'display:none') + '">Sil</button></div></div>';
                        document.getElementById('friendProfileJobPdfFile').addEventListener('change', function(){ document.getElementById('friendProfileJobPdfFileName').textContent = this.files.length ? this.files[0].name : ''; });
                    } else {
                        body.innerHTML = '<div class="friend-profile-kariyer-editor">' +
                            '<textarea id="friendProfileCvText" placeholder="Özgeçmiş metninizi yazın...">' + (p.careerCvText || '') + '</textarea>' +
                            '<div class="kariyer-file-row"><button type="button" class="friend-btn friend-btn-view" onclick="document.getElementById(\'friendProfileCvFile\').click()"><i class="fas fa-paperclip"></i> Word, Excel veya PDF ekle</button><input type="file" id="friendProfileCvFile" accept=".doc,.docx,.xls,.xlsx,.pdf">' +
                            '<span id="friendProfileCvFileName" style="color:#8fd3ff;font-size:12px;"></span></div>' +
                            '<div class="kariyer-btns"><button type="button" class="friend-btn friend-btn-add" id="friendProfileCvSave" onclick="saveFriendProfileCv()">Kaydet</button><button type="button" class="friend-btn friend-btn-reject" id="friendProfileCvDel" onclick="deleteFriendProfileCv()" style="' + (p.careerCvText || p.careerCvFileUrl ? '' : 'display:none') + '">Sil</button></div></div>';
                        document.getElementById('friendProfileCvFile').addEventListener('change', function(){ document.getElementById('friendProfileCvFileName').textContent = this.files.length ? this.files[0].name : ''; });
                    }
                } else {
                    var pdfUrl = isCorporate ? (p.jobPostingPdfUrl || p.careerCvFileUrl) : p.careerCvFileUrl;
                    var linkHtml = pdfUrl ? '<p><a href="' + pdfUrl + '" target="_blank" rel="noopener">' + (isCorporate ? 'İş ilanı PDF\'ini aç / indir' : 'Özgeçmiş dosyasını aç / indir') + '</a></p>' : '';
                    var emptyMsg = isCorporate ? 'Henüz iş ilanı eklenmemiş.' : 'Özgeçmiş eklenmemiş.';
                    body.innerHTML = '<div class="friend-profile-kariyer-view"><h3 class="friend-profile-body-section">' + sectionTitle + '</h3>' + (p.careerCvText && !isCorporate ? '<pre style="white-space:pre-wrap;word-break:break-word;">' + (p.careerCvText || '').replace(/</g,'&lt;') + '</pre>' : '') + linkHtml + (!p.careerCvText && !pdfUrl ? '<div class="friends-empty">' + emptyMsg + '</div>' : '') + '</div>';
                }
                return;
            }
            body.innerHTML = '<div class="friends-empty">İçerik yok.</div>';
        }

        async function loadFriendProfileYorumlarTab(friendId, targetBody) {
            var body = targetBody || document.getElementById('friendProfileViewBody');
            if (!body) return;
            body.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            var user = auth.currentUser;
            if (!user) { body.innerHTML = '<div class="friends-empty">Giriş yapın.</div>'; return; }
            try {
                var profileSnap = await db.collection('userProfiles').where('userId', '==', friendId).limit(1).get();
                var userName = 'İsimsiz';
                var userPhotoUrl = '';
                if (!profileSnap.empty) { var pp = profileSnap.docs[0].data(); userName = pp.adSoyad || userName; userPhotoUrl = pp.photoUrl || ''; }
                var postsSnap = await db.collection('userPosts').where('userId', '==', friendId).get();
                var allDocs = postsSnap.docs.slice();
                allDocs.sort(function(a, b) {
                    var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return tb - ta;
                });
                var likedSet = new Set();
                var favSet = new Set();
                var likeSnap = await db.collection('postLikes').where('userId', '==', user.uid).get();
                likeSnap.docs.forEach(function(d) { likedSet.add(d.data().postId); });
                var favSnap = await db.collection('postFavorites').where('userId', '==', user.uid).get();
                favSnap.docs.forEach(function(d) { favSet.add(d.data().postId); });
                var fallbackSets = await getReactionFallbackSets(user);
                fallbackSets.liked.forEach(function(pid) { likedSet.add(pid); });
                fallbackSets.favorite.forEach(function(pid) { favSet.add(pid); });
                if (allDocs.length === 0) { body.innerHTML = '<div class="friends-empty">Henüz yorum yok.</div>'; return; }
                body.innerHTML = '';
                body.classList.add('friend-profile-yorumlar-list');
                for (var i = 0; i < allDocs.length; i++) {
                    var doc = allDocs[i];
                    var d = doc.data();
                    var data = {
                        text: d.text,
                        mediaUrls: normalizeMediaUrlsField(d.mediaUrls),
                        createdAt: d.createdAt,
                        likeCount: d.likeCount || 0,
                        commentCount: d.commentCount || 0,
                        favoriteCount: d.favoriteCount || 0,
                        shareCount: d.shareCount || 0,
                        quoteCount: d.quoteCount || 0,
                        quotedText: d.quotedText,
                        quotedPostId: d.quotedPostId,
                        userName: userName,
                        userPhotoUrl: userPhotoUrl
                    };
                    var card = renderYorumPostCard(doc.id, data, likedSet.has(doc.id), favSet.has(doc.id), false, friendId);
                    var composerDiv = document.createElement('div');
                    composerDiv.className = 'yorum-reply-composer';
                    composerDiv.setAttribute('data-post-id', doc.id);
                    composerDiv.innerHTML = '<textarea placeholder="Yanıt yazın..." rows="2"></textarea><button type="button" class="yorum-reply-send">Gönder</button>';
                    var ta = composerDiv.querySelector('textarea');
                    var sendBtn = composerDiv.querySelector('.yorum-reply-send');
                    sendBtn.addEventListener('click', function(pid, cardEl, textareaEl, countBtn) {
                        return function() {
                            var txt = (textareaEl.value || '').trim();
                            if (!txt) return;
                            textareaEl.value = '';
                            submitYorumReply(pid, txt, cardEl, countBtn);
                        };
                    }(doc.id, card, ta, card.querySelector('[data-action="comment"]')));
                    card.appendChild(composerDiv);
                    var repliesSnap = await db.collection('postReplies').where('postId', '==', doc.id).get();
                    var repliesSorted = repliesSnap.docs.slice().sort(function(a, b) {
                        var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                        var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                        return ta - tb;
                    });
                    if (repliesSorted.length > 0) {
                        var repliesDiv = document.createElement('div');
                        repliesDiv.className = 'yorum-post-replies';
                        var titleEl = document.createElement('div');
                        titleEl.className = 'yorum-post-replies-title';
                        titleEl.textContent = 'Yorumlar (' + repliesSorted.length + ')';
                        repliesDiv.appendChild(titleEl);
                        repliesSorted.forEach(function(rDoc) {
                            var r = rDoc.data();
                            var rt = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                            var rText = (r.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                            var replyUserId = r.userId || '';
                            var item = document.createElement('div');
                            item.className = 'yorum-reply-item';
                            if (replyUserId) {
                                item.innerHTML = '<button type="button" class="yorum-reply-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(replyUserId).replace(/'/g, "\\'") + '\');" title="Profile git"><img class="yorum-reply-avatar" src="' + (r.userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div class="yorum-reply-body"><button type="button" class="yorum-reply-profile-link yorum-reply-name-btn" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(replyUserId).replace(/'/g, "\\'") + '\');" title="Profile git"><span class="yorum-reply-name">' + (r.userName || 'Kullanıcı') + '</span></button><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                            } else {
                                item.innerHTML = '<img class="yorum-reply-avatar" src="' + (r.userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="yorum-reply-body"><div class="yorum-reply-name">' + (r.userName || 'Kullanıcı') + '</div><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                            }
                            repliesDiv.appendChild(item);
                        });
                        card.appendChild(repliesDiv);
                    }
                    body.appendChild(card);
                }
            } catch (e) {
                console.error(e);
                body.innerHTML = '<div class="friends-empty">Yüklenemedi.</div>';
            }
        }

        async function saveFriendProfileCv() {
            var user = auth.currentUser;
            if (!user || currentViewedFriendId !== user.uid) return;
            var text = document.getElementById('friendProfileCvText').value || '';
            var fileInput = document.getElementById('friendProfileCvFile');
            var file = fileInput.files && fileInput.files[0];
            try {
                var snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                var docId = snap.empty ? null : snap.docs[0].id;
                var update = { careerCvText: text };
                if (file) {
                    var ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
                    if (!['doc','docx','xls','xlsx','pdf'].includes(ext)) ext = 'pdf';
                    var ref = storage.ref('careers/' + user.uid + '/cv.' + ext);
                    await ref.put(file);
                    update.careerCvFileUrl = await ref.getDownloadURL();
                }
                if (docId) await db.collection('userProfiles').doc(docId).update(update);
                else { update.userId = user.uid; await db.collection('userProfiles').add(update); incrementTotalMemberCount(); }
                fileInput.value = ''; document.getElementById('friendProfileCvFileName').textContent = '';
                document.getElementById('friendProfileCvDel').style.display = 'inline-block';
                loadFriendProfileTabContent(user.uid, 'kariyer');
            } catch (e) { alert('Kaydetme hatası: ' + (e.message || '')); }
        }

        async function deleteFriendProfileCv() {
            var user = auth.currentUser;
            if (!user || currentViewedFriendId !== user.uid) return;
            if (!confirm('Özgeçmiş dosyasını silmek istediğinize emin misiniz?')) return;
            try {
                var snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                if (!snap.empty) await db.collection('userProfiles').doc(snap.docs[0].id).update({ careerCvText: '', careerCvFileUrl: '' });
                loadFriendProfileTabContent(user.uid, 'kariyer');
                document.getElementById('friendProfileCvDel').style.display = 'none';
            } catch (e) { alert('Silme hatası.'); }
        }

        async function saveFriendProfileJobPdf() {
            var user = auth.currentUser;
            if (!user || currentViewedFriendId !== user.uid) return;
            var fileInput = document.getElementById('friendProfileJobPdfFile');
            var file = fileInput && fileInput.files && fileInput.files[0];
            if (!file || !file.type || file.type !== 'application/pdf') {
                alert('Lütfen PDF dosyası seçin.');
                return;
            }
            try {
                var ref = storage.ref('careers/' + user.uid + '/job.pdf');
                await ref.put(file);
                var url = await ref.getDownloadURL();
                var snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                if (!snap.empty) await db.collection('userProfiles').doc(snap.docs[0].id).update({ jobPostingPdfUrl: url });
                else { await db.collection('userProfiles').add({ userId: user.uid, jobPostingPdfUrl: url, memberType: 'corporate', createdAt: firebase.firestore.FieldValue.serverTimestamp() }); }
                fileInput.value = ''; var nameEl = document.getElementById('friendProfileJobPdfFileName'); if (nameEl) nameEl.textContent = '';
                var delBtn = document.getElementById('friendProfileJobPdfDel'); if (delBtn) delBtn.style.display = 'inline-block';
                loadFriendProfileTabContent(user.uid, 'kariyer');
            } catch (e) { alert('Yükleme hatası: ' + (e.message || '')); }
        }

        async function deleteFriendProfileJobPdf() {
            var user = auth.currentUser;
            if (!user || currentViewedFriendId !== user.uid) return;
            if (!confirm('İş ilanı PDF\'ini silmek istediğinize emin misiniz?')) return;
            try {
                var snap = await db.collection('userProfiles').where('userId','==',user.uid).limit(1).get();
                if (!snap.empty) await db.collection('userProfiles').doc(snap.docs[0].id).update({ jobPostingPdfUrl: '' });
                loadFriendProfileTabContent(user.uid, 'kariyer');
                var delBtn = document.getElementById('friendProfileJobPdfDel'); if (delBtn) delBtn.style.display = 'none';
            } catch (e) { alert('Silme hatası.'); }
        }
        window.saveFriendProfileJobPdf = saveFriendProfileJobPdf;
        window.deleteFriendProfileJobPdf = deleteFriendProfileJobPdf;

        function closeFriendProfileView() {
            currentViewedFriendId = null;
            document.getElementById('friendProfileViewModal').classList.remove('open');
            document.getElementById('friendProfileViewModal').style.display = 'none';
        }

        function friendMessage(friendId) {
            closeFriendProfileView();
            openMessagesModal(friendId);
        }

        /* FORUM – başlık "Forum"; # ile konu açma, herkes görür; konuya tıklayınca yorum alanı Gönder/İptal */
        var forumCurrentTopicId = null;

        function openForumModal() {
            var user = auth.currentUser;
            if (!user) { alert('Forum için önce giriş yapmanız gerekiyor.'); return; }
            var modal = document.getElementById('forumModal');
            if (!modal) return;
            modal.classList.add('open');
            modal.style.display = 'flex';
            document.getElementById('forumMainView').style.display = 'block';
            document.getElementById('forumThreadView').classList.remove('open');
            document.getElementById('forumBackBtn').style.display = 'none';
            forumCurrentTopicId = null;
            document.getElementById('forumNewTopicInput').value = '';
            document.getElementById('forumReplyInput').value = '';
            loadForumTopics();
        }

        function closeForumModal() {
            var modal = document.getElementById('forumModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
            forumCurrentTopicId = null;
        }

        async function loadForumTopics() {
            var listEl = document.getElementById('forumTopicList');
            if (!listEl) return;
            listEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var snap = await db.collection('forumTopics').orderBy('createdAt', 'desc').get();
                if (snap.empty) { listEl.innerHTML = '<div class="friends-empty">Henüz konu açılmamış. Yukarıdan # ile konu başlığı oluşturun.</div>'; return; }
                listEl.innerHTML = '';
                snap.docs.forEach(function(d) {
                    var t = d.data();
                    var dateStr = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                    var div = document.createElement('div');
                    div.className = 'forum-topic-item';
                    div.setAttribute('data-topic-id', d.id);
                    div.innerHTML = '<h4>#' + (t.title || '').replace(/</g, '&lt;') + '</h4><div class="meta">' + (t.createdByName || 'Kullanıcı') + ' · ' + dateStr + '</div>';
                    div.onclick = function() { openForumThread(d.id, t.title || ''); };
                    listEl.appendChild(div);
                });
            } catch (e) { listEl.innerHTML = '<div class="friends-empty">Konular yüklenemedi.</div>'; }
        }

        async function submitNewForumTopic() {
            var user = auth.currentUser;
            if (!user) return;
            var ta = document.getElementById('forumNewTopicInput');
            var text = (ta && ta.value) ? ta.value.trim() : '';
            var match = text.match(/#\s*([^\s#]+(?:\s+[^\s#]+)*)/);
            var title = match ? match[1].trim() : text.replace(/^#\s*/, '').trim();
            if (!title) { alert('Konu başlığı girin. Örnek: #altın'); return; }
            var userName = user.displayName || 'Kullanıcı';
            var profSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
            if (!profSnap.empty) userName = profSnap.docs[0].data().adSoyad || userName;
            await db.collection('forumTopics').add({
                title: title,
                createdBy: user.uid,
                createdByName: userName,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            ta.value = '';
            loadForumTopics();
        }

        function forumModalBackFromThread() {
            document.getElementById('forumMainView').style.display = 'block';
            document.getElementById('forumThreadView').classList.remove('open');
            document.getElementById('forumBackBtn').style.display = 'none';
            forumCurrentTopicId = null;
            document.getElementById('forumReplyInput').value = '';
            loadForumTopics();
        }

        function openForumThread(topicId, topicTitle) {
            forumCurrentTopicId = topicId;
            document.getElementById('forumMainView').style.display = 'none';
            document.getElementById('forumThreadView').classList.add('open');
            document.getElementById('forumBackBtn').style.display = 'inline-flex';
            document.getElementById('forumThreadTitle').textContent = '#' + (topicTitle || '');
            document.getElementById('forumReplyInput').value = '';
            loadForumComments(topicId);
        }

        async function loadForumComments(topicId) {
            var listEl = document.getElementById('forumCommentsList');
            if (!listEl) return;
            listEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var snap = await db.collection('forumComments').where('topicId', '==', topicId).get();
                var docs = snap.docs.slice();
                docs.sort(function(a, b) {
                    var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return ta - tb;
                });
                if (docs.length === 0) { listEl.innerHTML = '<div class="friends-empty">Henüz yorum yok. Aşağıdan yorum yazabilirsiniz.</div>'; return; }
                var user = auth.currentUser;
                listEl.innerHTML = '';
                docs.forEach(function(d) {
                    var c = d.data();
                    var dateStr = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                    var textEsc = (c.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    var isMine = user && c.userId === user.uid;
                    var delBtn = isMine ? '<button type="button" class="forum-comment-delete" onclick="deleteForumComment(\'' + d.id.replace(/'/g, "\\'") + '\')" title="Yorumu sil"><i class="fas fa-trash-alt"></i> Sil</button>' : '';
                    var div = document.createElement('div');
                    div.className = 'forum-comment';
                    div.innerHTML = '<div class="forum-comment-head"><img class="forum-comment-avatar" src="' + (c.userPhotoUrl || '').replace(/"/g, '&quot;') + '" onerror="this.style.display=\'none\'" alt=""><div class="forum-comment-head-text"><div class="forum-comment-name">' + (c.userName || 'Kullanıcı').replace(/</g, '&lt;') + '</div><div class="forum-comment-time">' + dateStr + '</div></div>' + delBtn + '</div><div class="forum-comment-text">' + textEsc + '</div>';
                    listEl.appendChild(div);
                });
            } catch (e) { console.error(e); listEl.innerHTML = '<div class="friends-empty">Yorumlar yüklenemedi: ' + (e.message || '') + '</div>'; }
        }

        async function submitForumComment() {
            var user = auth.currentUser;
            if (!user || !forumCurrentTopicId) { alert('Giriş yapın veya konu seçin.'); return; }
            var ta = document.getElementById('forumReplyInput');
            var text = (ta && ta.value) ? ta.value.trim() : '';
            if (!text) { alert('Yorum yazın.'); return; }
            try {
                var userName = user.displayName || 'Kullanıcı';
                var userPhotoUrl = user.photoURL || '';
                var profSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!profSnap.empty) { var p = profSnap.docs[0].data(); userName = p.adSoyad || userName; userPhotoUrl = p.photoUrl || userPhotoUrl; }
                await db.collection('forumComments').add({
                    topicId: forumCurrentTopicId,
                    userId: user.uid,
                    userName: userName,
                    userPhotoUrl: userPhotoUrl,
                    text: text,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                ta.value = '';
                await loadForumComments(forumCurrentTopicId);
            } catch (e) {
                console.error(e);
                alert('Yorum gönderilemedi: ' + (e.message || 'Lütfen tekrar deneyin.'));
            }
        }

        async function deleteForumComment(commentId) {
            var user = auth.currentUser;
            if (!user || !forumCurrentTopicId) return;
            if (!commentId) return;
            if (!confirm('Bu yorumu silmek istediğinize emin misiniz?')) return;
            try {
                await db.collection('forumComments').doc(commentId).delete();
                await loadForumComments(forumCurrentTopicId);
            } catch (e) {
                console.error(e);
                alert('Yorum silinemedi: ' + (e.message || ''));
            }
        }

        function cancelForumReply() {
            document.getElementById('forumReplyInput').value = '';
        }

        /* Kariyerim – profil özgeçmişi görüntüleme + dosya indir */
        function openKariyerimModal() {
            var user = auth.currentUser;
            if (!user) { alert('Kariyerim için önce giriş yapmanız gerekiyor.'); return; }
            var modal = document.getElementById('kariyerimModal');
            if (!modal) return;
            modal.classList.add('open');
            modal.style.display = 'flex';
            loadKariyerimContent();
        }

        function closeKariyerimModal() {
            var modal = document.getElementById('kariyerimModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }

        async function loadKariyerimContent() {
            var body = document.getElementById('kariyerimBody');
            if (!body) return;
            body.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            var user = auth.currentUser;
            if (!user) { body.innerHTML = '<div class="friends-empty">Giriş yapın.</div>'; return; }
            try {
                var snap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                var p = snap.empty ? {} : (snap.docs[0].data());
                var textHtml = p.careerCvText ? '<div class="kariyerim-text">' + (p.careerCvText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</div>' : '';
                var fileUrl = p.careerCvFileUrl || '';
                var downloadHtml = '';
                if (fileUrl) {
                    var isPdf = /\.pdf$/i.test(fileUrl);
                    var btnLabel = isPdf ? 'PDF İndir' : 'Dosyayı İndir';
                    downloadHtml = '<div class="kariyerim-download"><a href="' + fileUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" download><i class="fas fa-download"></i> ' + btnLabel + '</a></div>';
                }
                if (!textHtml && !downloadHtml) body.innerHTML = '<div class="friends-empty">Henüz özgeçmiş eklenmemiş. Profilim &gt; Kariyer sekmesinden ekleyebilirsiniz.</div>';
                else body.innerHTML = textHtml + downloadHtml;
            } catch (e) { body.innerHTML = '<div class="friends-empty">Yüklenemedi.</div>'; }
        }

        /* MESAJLARIM */
        let currentMessagesPeerId = null;
        var pendingMessagesInitialText = '';
        let messagesUnsubscribe = null;
        var EMOJI_ARR = ['😀','😃','😄','😁','😅','😂','😊','😇','🙂','😉','😌','😍','😘','😋','😜','🤔','😐','😏','😒','🙄','😬','😔','😢','😭','😱','😡','❤️','💛','💚','💙','💜','👍','👎','👌','✌️','🙏','⭐','✨','🔥','💯','✅','❌','🎉','🙈','🙉','🙊','😺','💔','💕','💖','🤞','👋','💪','🌟','💫','😎','🤗','😴','😷','🎊','📌','🔔','💬','📷','🎵','🏠','❤','🧡','💛','💚','💙','💜','🖤','🤍','👏','🙌','🤝','💼','📁','🎯','🚀','⚡','🔒','🔓','♥','♦','♣','♠','✔','✖','➡','⬅','⬆','⬇'];

        function messagesPanelsSetView(view) {
            var panels = document.querySelector('.messages-panels');
            if (!panels) return;
            panels.classList.remove('messages-show-list', 'messages-show-chat');
            if (view === 'list') panels.classList.add('messages-show-list');
            else if (view === 'chat') panels.classList.add('messages-show-chat');
        }
        function openMessagesModal(openWithUserId, initialMessageText) {
            const user = auth.currentUser;
            if (!user) { alert('Mesajlar için önce giriş yapmanız gerekiyor.'); return; }
            pendingMessagesInitialText = (initialMessageText && String(initialMessageText)) || '';
            const modal = document.getElementById('messagesModal');
            const inner = document.getElementById('messagesModalInner');
            const icon = document.getElementById('messagesDockIcon');
            if (modal) { modal.classList.remove('messages-docked'); modal.classList.add('open'); modal.style.display = 'flex'; }
            if (inner) inner.classList.remove('messages-small');
            if (icon) { icon.className = 'fas fa-chevron-down'; }
            document.getElementById('messagesEmptyState').style.display = 'flex';
            document.getElementById('messagesChatArea').style.display = 'none';
            currentMessagesPeerId = null;
            messagesPanelsSetView('list');
            loadMessagesConversations();
            refreshMessagesBadge();
            if (openWithUserId) setTimeout(function() { openChatWith(openWithUserId); }, 300);
        }
        function closeMessagesModal() {
            document.getElementById('messagesModal').classList.remove('open');
            document.getElementById('messagesModal').style.display = 'none';
            if (messagesUnsubscribe) messagesUnsubscribe();
        }
        function messagesModalBack() {
            currentMessagesPeerId = null;
            openChatWith(null);
            var emptyEl = document.getElementById('messagesEmptyState');
            var chatEl = document.getElementById('messagesChatArea');
            if (emptyEl) emptyEl.style.display = 'flex';
            if (chatEl) chatEl.style.display = 'none';
            messagesPanelsSetView('list');
        }
        window.messagesModalBack = messagesModalBack;
        window.openMessagesModal = openMessagesModal;
        window.closeMessagesModal = closeMessagesModal;
        window.messagesModalMinimize = messagesModalMinimize;
        window.messagesModalDock = messagesModalDock;
        window.messagesSearchUser = messagesSearchUser;
        document.addEventListener('click', function(ev) {
            var t = ev.target;
            if (!t) return;
            var modal = document.getElementById('messagesModal');
            if (!modal || !modal.classList.contains('open')) return;
            var header = modal.querySelector('.messages-modal-header');
            if (!header) return;
        }, true);
        function messagesModalMinimize() { document.getElementById('messagesModalInner').classList.toggle('messages-small'); }
        function messagesModalDock() {
            const modal = document.getElementById('messagesModal');
            const icon = document.getElementById('messagesDockIcon');
            if (!modal || !icon) return;
            const isDocked = modal.classList.toggle('messages-docked');
            icon.className = isDocked ? 'fas fa-chevron-up' : 'fas fa-chevron-down';
        }
        function attachMessagesBackButton() {
            var messagesModalEl = document.getElementById('messagesModal');
            if (!messagesModalEl) return;
            var messagesHeader = messagesModalEl.querySelector('.messages-modal-header');
            if (!messagesHeader) return;
            messagesHeader.addEventListener('click', function(e) {
                if (messagesModalEl.classList.contains('messages-docked') && !e.target.closest('.friends-modal-header-btns') && !e.target.closest('.messages-header-title')) messagesModalDock();
            });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { whenIdle(attachMessagesBackButton); });
        } else {
            whenIdle(attachMessagesBackButton);
        }
        var messagesConvListEl = document.getElementById('messagesConvList');
        var messagesConvTouchStart = { x: 0, y: 0 };
        var MESSAGES_CONV_TAP_THRESHOLD = 12;
        if (messagesConvListEl) {
            messagesConvListEl.addEventListener('touchstart', function(ev) {
                if (ev.touches.length) {
                    messagesConvTouchStart.x = ev.touches[0].clientX;
                    messagesConvTouchStart.y = ev.touches[0].clientY;
                }
            }, { passive: true });
            messagesConvListEl.addEventListener('touchend', function(ev) {
                if (ev.target.closest('.messages-conv-delete-btn') || ev.target.closest('.messages-conv-profile-link')) return;
                var item = ev.target.closest('.messages-conv-item');
                if (!item || !item.getAttribute('data-peer-id')) return;
                if (!ev.changedTouches.length) return;
                var t = ev.changedTouches[0];
                var dx = Math.abs(t.clientX - messagesConvTouchStart.x);
                var dy = Math.abs(t.clientY - messagesConvTouchStart.y);
                if (dx <= MESSAGES_CONV_TAP_THRESHOLD && dy <= MESSAGES_CONV_TAP_THRESHOLD) {
                    ev.preventDefault();
                    openChatWith(item.getAttribute('data-peer-id'));
                }
            }, { passive: false });
        }
        var messagesPanelsSwipeStart = { x: 0, y: 0 };
        var messagesPanelsEl = document.querySelector('.messages-panels');
        if (messagesPanelsEl) {
            messagesPanelsEl.addEventListener('touchstart', function(ev) {
                if (ev.touches.length) {
                    messagesPanelsSwipeStart.x = ev.touches[0].clientX;
                    messagesPanelsSwipeStart.y = ev.touches[0].clientY;
                }
            }, { passive: true });
            messagesPanelsEl.addEventListener('touchend', function(ev) {
                if (!ev.changedTouches.length || !window.matchMedia('(max-width: 768px)').matches) return;
                var t = ev.changedTouches[0];
                var deltaX = t.clientX - messagesPanelsSwipeStart.x;
                var deltaY = t.clientY - messagesPanelsSwipeStart.y;
                var absX = Math.abs(deltaX);
                var absY = Math.abs(deltaY);
                if (absX >= 60 && absX >= absY * 1.5) {
                    if (deltaX > 0) messagesPanelsSetView('list');
                    else messagesPanelsSetView('chat');
                }
            }, { passive: true });
        }

        function buildEmojiPanel() {
            const panel = document.getElementById('messagesEmojiPanel');
            if (panel.innerHTML) return;
            EMOJI_ARR.forEach(function(emoji) {
                const span = document.createElement('span');
                span.textContent = emoji;
                span.onclick = function() { const ta = document.getElementById('messagesTextInput'); ta.value += emoji; ta.focus(); };
                panel.appendChild(span);
            });
        }
        function toggleMessagesEmoji() {
            const panel = document.getElementById('messagesEmojiPanel');
            buildEmojiPanel();
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }

        async function deleteConversation(peerId) {
            const user = auth.currentUser;
            if (!user || !peerId) return;
            if (!confirm('Bu sohbetin tüm mesajları silinecek. Emin misiniz?')) return;
            try {
                const [sentSnap, receivedSnap] = await Promise.all([
                    db.collection('messages').where('fromUserId', '==', user.uid).get(),
                    db.collection('messages').where('toUserId', '==', user.uid).get()
                ]);
                const sentIds = sentSnap.docs.filter(d => d.data().toUserId === peerId).map(d => d.id);
                const receivedIds = receivedSnap.docs.filter(d => d.data().fromUserId === peerId).map(d => d.id);
                const docIds = [...sentIds, ...receivedIds];
                if (docIds.length === 0) { loadMessagesConversations(); return; }
                const BATCH = 500;
                for (let i = 0; i < docIds.length; i += BATCH) {
                    const batch = db.batch();
                    docIds.slice(i, i + BATCH).forEach(id => batch.delete(db.collection('messages').doc(id)));
                    await batch.commit();
                }
                if (currentMessagesPeerId === peerId) {
                    currentMessagesPeerId = null;
                    document.getElementById('messagesEmptyState').style.display = 'flex';
                    document.getElementById('messagesChatArea').style.display = 'none';
                    messagesPanelsSetView('list');
                }
                loadMessagesConversations();
                refreshMessagesBadge();
            } catch (e) {
                console.error(e);
                alert('Sohbet silinirken hata oluştu. Lütfen tekrar deneyin.');
            }
        }

        async function loadMessagesConversations() {
            const user = auth.currentUser;
            if (!user) return;
            const cnt = document.getElementById('messagesConvList');
            cnt.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                const sent = await db.collection('messages').where('fromUserId', '==', user.uid).get();
                const received = await db.collection('messages').where('toUserId', '==', user.uid).get();
                const map = {};
                sent.docs.forEach(d => { const dta = d.data(); const other = dta.toUserId; const t = dta.createdAt && dta.createdAt.toMillis ? dta.createdAt.toMillis() : 0; if (!map[other] || (map[other].last && map[other].last.toMillis ? t > map[other].last.toMillis() : t > 0)) map[other] = { last: dta.createdAt, lastText: (dta.text || '').substring(0, 40), unreadCount: 0 }; });
                received.docs.forEach(d => { const dta = d.data(); const other = dta.fromUserId; const t = dta.createdAt && dta.createdAt.toMillis ? dta.createdAt.toMillis() : 0; if (!map[other]) map[other] = { last: dta.createdAt, lastText: (dta.text || '').substring(0, 40), unreadCount: 0 }; else if (map[other].last && map[other].last.toMillis && t > map[other].last.toMillis()) { map[other].last = dta.createdAt; map[other].lastText = (dta.text || '').substring(0, 40); } map[other].unreadCount = (map[other].unreadCount || 0) + (dta.read === false ? 1 : 0); });
                const peerIds = Object.keys(map);
                if (peerIds.length === 0) { cnt.innerHTML = '<div class="friends-empty">Henüz sohbet yok. Arama yapıp Mesaj At ile başlayın.</div>'; return; }
                const profsSnap = await db.collection('userProfiles').get();
                const profs = {}; profsSnap.docs.forEach(d => { const x = d.data(); if (x.userId) profs[x.userId] = x; });
                const sorted = peerIds.sort((a, b) => {
                    const ta = map[a].last && map[a].last.toMillis ? map[a].last.toMillis() : 0;
                    const tb = map[b].last && map[b].last.toMillis ? map[b].last.toMillis() : 0;
                    return tb - ta;
                });
                cnt.innerHTML = '';
                sorted.forEach(peerId => {
                    const p = profs[peerId] || {};
                    const m = map[peerId];
                    const unreadCount = m.unreadCount || 0;
                    const lastTime = m.last && m.last.toDate ? m.last.toDate() : null;
                    const timeStr = lastTime ? (lastTime.toLocaleDateString('tr-TR') + ' ' + lastTime.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })) : '';
                    const div = document.createElement('div');
                    div.className = 'messages-conv-item' + (unreadCount > 0 ? ' unread' : '');
                    div.setAttribute('data-peer-id', peerId);
                    div.setAttribute('role', 'button');
                    div.setAttribute('tabindex', '0');
                    const badgeHtml = unreadCount > 0 ? '<span class="messages-conv-unread-badge">' + (unreadCount > 99 ? '99+' : unreadCount) + '</span>' : '';
                    div.innerHTML = '<button type="button" class="messages-conv-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + (peerId || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div class="messages-conv-item-text"><button type="button" class="messages-conv-profile-link messages-conv-name-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + (peerId || '').replace(/'/g, "\\'") + '\');" title="Profile git"><span class="name">' + (p.adSoyad || 'İsimsiz') + '</span></button><div class="last">' + (m.lastText || '') + ' · ' + timeStr + '</div></div>' + badgeHtml + '<button type="button" class="messages-conv-delete-btn" title="Sohbeti sil"><i class="fas fa-trash-alt"></i></button>';
                    div.onclick = function(ev) { if (!ev.target.closest('.messages-conv-delete-btn') && !ev.target.closest('.messages-conv-profile-link')) openChatWith(peerId); };
                    div.onkeydown = function(ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (document.activeElement && !document.activeElement.classList.contains('messages-conv-delete-btn')) openChatWith(peerId); } };
                    var delBtn = div.querySelector('.messages-conv-delete-btn');
                    delBtn.onclick = function(ev) { ev.stopPropagation(); ev.preventDefault(); deleteConversation(peerId); };
                    delBtn.addEventListener('touchend', function(ev) { ev.preventDefault(); ev.stopPropagation(); deleteConversation(peerId); }, { passive: false });
                    cnt.appendChild(div);
                });
            } catch (e) {
                cnt.innerHTML = '<div class="friends-empty">Sohbetler yüklenemedi. Lütfen daha sonra tekrar deneyin.</div>';
                console.error(e);
            }
        }

        async function messagesSearchUser() {
            const q = document.getElementById('messagesSearchInput').value.trim().toLowerCase();
            if (!q) { alert('Adı Soyadı veya E-mail girin.'); return; }
            const user = auth.currentUser;
            if (!user) return;
            const cnt = document.getElementById('messagesSearchResults');
            const title = document.getElementById('messagesSearchResultsTitle');
            cnt.innerHTML = '<div class="friends-empty">Aranıyor...</div>';
            title.style.display = 'block';
            try {
                const snap = await db.collection('userProfiles').get();
                const results = snap.docs.filter(d => {
                    const p = d.data();
                    if (p.userId === user.uid) return false;
                    const ad = (p.adSoyad || '').toLowerCase();
                    const em = (p.email || '').toLowerCase();
                    return ad.includes(q) || em.includes(q);
                });
                cnt.innerHTML = '';
                if (results.length === 0) { cnt.innerHTML = '<div class="friends-empty">Sonuç yok.</div>'; return; }
                results.forEach(d => {
                    const p = d.data();
                    const fid = p.userId;
                    const div = document.createElement('div');
                    div.className = 'messages-conv-item';
                    div.style.display = 'flex';
                    div.innerHTML = '<button type="button" class="messages-conv-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + (fid || '').replace(/'/g, "\\'") + '\');" title="Profile git"><img class="avatar" src="' + (p.photoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div><button type="button" class="messages-conv-profile-link messages-conv-name-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + (fid || '').replace(/'/g, "\\'") + '\');" title="Profile git"><span class="name">' + (p.adSoyad || 'İsimsiz') + '</span></button><div class="last">' + (p.email || '') + '</div></div><button type="button" class="msg-at-btn">Mesaj At</button>';
                    div.querySelector('.msg-at-btn').onclick = function(ev) { ev.stopPropagation(); openChatWith(fid); };
                    cnt.appendChild(div);
                });
            } catch (e) { cnt.innerHTML = '<div class="friends-empty">Arama hatası.</div>'; }
        }

        async function openChatWith(peerId) {
            const user = auth.currentUser;
            if (!user) return;
            currentMessagesPeerId = peerId || null;
            if (!peerId) {
                document.getElementById('messagesEmptyState').style.display = 'flex';
                document.getElementById('messagesChatArea').style.display = 'none';
                return;
            }
            document.getElementById('messagesEmptyState').style.display = 'none';
            document.getElementById('messagesChatArea').style.display = 'flex';
            messagesPanelsSetView('chat');
            const snap = await db.collection('userProfiles').where('userId', '==', peerId).limit(1).get();
            const name = snap.empty ? 'Kullanıcı' : (snap.docs[0].data().adSoyad || snap.docs[0].data().email || 'Kullanıcı');
            var headerEl = document.getElementById('messagesChatHeader');
            if (headerEl) headerEl.innerHTML = '<button type="button" class="messages-chat-header-profile-link" onclick="event.preventDefault();goToUserProfile(\'' + (peerId || '').replace(/'/g, "\\'") + '\');" title="Profile git">' + (name || 'Kullanıcı').replace(/</g, '&lt;') + '</button> ile sohbet';
            loadMessagesFor(peerId);
            if (messagesUnsubscribe) messagesUnsubscribe();
            function onUpdate() {
                if (currentMessagesPeerId !== peerId) return;
                loadMessagesFor(peerId);
            }
            var unsubSent = db.collection('messages').where('fromUserId', '==', user.uid).onSnapshot(onUpdate);
            var unsubReceived = db.collection('messages').where('toUserId', '==', user.uid).onSnapshot(onUpdate);
            messagesUnsubscribe = function() { unsubSent(); unsubReceived(); };
            if (pendingMessagesInitialText) {
                var ta = document.getElementById('messagesTextInput');
                if (ta) { ta.value = pendingMessagesInitialText; pendingMessagesInitialText = ''; }
            }
        }

        function renderMessagesList(docs, myUid, peerId) {
            const list = document.getElementById('messagesList');
            list.innerHTML = '';
            docs.forEach(d => {
                const data = d.data();
                const isSent = data.fromUserId === myUid;
                const time = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                const text = (data.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                let body = '';
                if (data.imageUrl) {
                    var imgUrlEsc = (data.imageUrl || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    body += '<button type="button" class="msg-photo-wrap" data-msg-image-url="' + imgUrlEsc + '" title="Fotoğrafı büyüt"><img class="msg-photo" src="' + imgUrlEsc + '" alt=""></button>';
                }
                if (text) body += '<div>' + text + '</div>';
                if (data.audioUrl) body += ' <button type="button" class="msg-play-voice" data-audio-url="' + (data.audioUrl || '').replace(/"/g, '&quot;') + '" title="Tıkla: sesi dinle">🔊 Dinle</button>';
                const bubble = document.createElement('div');
                bubble.className = 'msg-bubble ' + (isSent ? 'sent' : 'received');
                bubble.innerHTML = (body || '<div></div>') + '<div class="msg-time">' + time + '</div>';
                list.appendChild(bubble);
            });
            list.scrollTop = list.scrollHeight;
        }

        async function loadMessagesFor(peerId) {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const [sentSnap, receivedSnap] = await Promise.all([
                    db.collection('messages').where('fromUserId', '==', user.uid).get(),
                    db.collection('messages').where('toUserId', '==', user.uid).get()
                ]);
                const sentWithPeer = sentSnap.docs.filter(d => d.data().toUserId === peerId);
                const receivedFromPeer = receivedSnap.docs.filter(d => d.data().fromUserId === peerId);
                const merged = [...sentWithPeer, ...receivedFromPeer].sort((a, b) => {
                    const ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    const tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return ta - tb;
                });
                renderMessagesList(merged, user.uid, peerId);
                const batch = db.batch();
                receivedFromPeer.forEach(d => { if (!d.data().read) batch.update(db.collection('messages').doc(d.id), { read: true }); });
                if (receivedFromPeer.length > 0) await batch.commit();
                refreshMessagesBadge();
            } catch (e) {
                console.error(e);
                var list = document.getElementById('messagesList');
                list.innerHTML = '<div class="friends-empty">Mesajlar yüklenemedi. Lütfen daha sonra tekrar deneyin.</div>';
            }
        }

        var messagesPendingPhotoFile = null;
        var messagesPendingPhotoUrl = null;
        function messagesClearPendingPhoto() {
            messagesPendingPhotoFile = null;
            if (messagesPendingPhotoUrl) { try { URL.revokeObjectURL(messagesPendingPhotoUrl); } catch (e) {} messagesPendingPhotoUrl = null; }
            var prev = document.getElementById('messagesPhotoPreview');
            var img = document.getElementById('messagesPhotoPreviewImg');
            if (prev) prev.style.display = 'none';
            if (img) img.src = '';
            var inp = document.getElementById('messagesPhotoInput');
            if (inp) inp.value = '';
        }
        async function sendMessage() {
            const user = auth.currentUser;
            if (!user || !currentMessagesPeerId) return;
            if (messagesMicRecording) { messagesMicStopAndSend(); return; }
            if (messagesMicPendingBlob) { messagesMicSendPending(); return; }
            const ta = document.getElementById('messagesTextInput');
            var text = (ta && ta.value) ? ta.value.trim() : '';
            var hasPhoto = !!messagesPendingPhotoFile;
            if (!text && !hasPhoto) return;
            if (ta) ta.value = '';
            var list = document.getElementById('messagesList');
            var now = new Date();
            var timeStr = now.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
            var bubble = document.createElement('div');
            bubble.className = 'msg-bubble sent';
            if (hasPhoto) {
                bubble.innerHTML = '<div class="msg-photo-sending">📷 Fotoğraf gönderiliyor...</div>' + (text ? '<div>' + (text.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</div>' : '') + '<div class="msg-time">' + timeStr + '</div>';
            } else {
                bubble.innerHTML = '<div>' + (text.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</div><div class="msg-time">' + timeStr + '</div>';
            }
            list.appendChild(bubble);
            list.scrollTop = list.scrollHeight;
            var fileToUpload = messagesPendingPhotoFile;
            messagesClearPendingPhoto();
            try {
                if (fileToUpload) {
                    var stor = (typeof firebase !== 'undefined' && firebase.storage) ? firebase.storage() : (typeof storage !== 'undefined' ? storage : null);
                    if (!stor) throw new Error('Depolama kullanılamıyor. Sayfayı yenileyin.');
                    var ext = (fileToUpload.name && fileToUpload.name.split('.').length > 1) ? fileToUpload.name.split('.').pop().replace(/[^a-z0-9]/gi, '') : 'jpg';
                    if (!ext) ext = 'jpg';
                    var ref = stor.ref('messages/' + user.uid + '/' + Date.now() + '.' + ext);
                    await ref.put(fileToUpload, { contentType: fileToUpload.type || 'image/jpeg' });
                    var imageUrl = await ref.getDownloadURL();
                    await db.collection('messages').add({
                        fromUserId: user.uid,
                        toUserId: currentMessagesPeerId,
                        text: text || '',
                        imageUrl: imageUrl,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        read: false
                    });
                } else {
                    await db.collection('messages').add({
                        fromUserId: user.uid,
                        toUserId: currentMessagesPeerId,
                        text: text,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        read: false
                    });
                }
                loadMessagesFor(currentMessagesPeerId);
                loadMessagesConversations();
            } catch (e) {
                console.error('Mesaj gönderimi hatası', e);
                bubble.remove();
                var errMsg = (e && (e.code || e.message)) ? (e.code + ': ' + e.message) : 'Mesaj gönderilemedi. Lütfen tekrar deneyin.';
                if (e && e.code === 'storage/unauthorized') errMsg = 'Fotoğraf yükleme yetkisi yok. Firebase Storage kurallarında messages/ yoluna yazma izni verin.';
                if (e && e.code === 'permission-denied') errMsg = 'Mesaj kaydı yetkisi yok. Firestore messages koleksiyonunda imageUrl alanına izin verin.';
                alert(errMsg);
            }
        }
        document.getElementById('messagesTextInput').addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
        });

        var messagesMicRecording = null;
        var messagesMicStream = null;
        var messagesMicChunks = null;
        var messagesMicStartTime = 0;
        var messagesMicPendingBlob = null;
        var messagesMicPendingDuration = 0;
        function messagesMicStopAndSend() {
            if (!messagesMicRecording) return;
            var btn = document.getElementById('messagesMicBtn');
            var ind = document.getElementById('messagesRecordingIndicator');
            messagesMicRecording.stop();
            messagesMicRecording = null;
            if (messagesMicStream) { messagesMicStream.getTracks().forEach(function(t) { t.stop(); }); messagesMicStream = null; }
            btn.classList.remove('messages-mic-recording');
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.title = 'Bir kez bas: kayda başla, tekrar bas: metin alanına yükle';
            if (ind) ind.style.display = 'none';
            var chunks = messagesMicChunks;
            messagesMicChunks = null;
            var duration = (Date.now() - messagesMicStartTime) / 1000;
            if (!chunks || chunks.length === 0 || duration < 0.5) { if (duration > 0 && duration < 0.5) alert('Ses çok kısa. En az yarım saniye kaydedin.'); return; }
            var blob = new Blob(chunks, { type: 'audio/webm' });
            var user = auth.currentUser;
            if (!user || !currentMessagesPeerId) return;
            var ref = storage.ref('voice/' + user.uid + '/' + Date.now() + '.webm');
            ref.put(blob).then(function() { return ref.getDownloadURL(); }).then(function(url) {
                db.collection('messages').add({ fromUserId: user.uid, toUserId: currentMessagesPeerId, text: '🎤 Sesli mesaj', audioUrl: url, createdAt: firebase.firestore.FieldValue.serverTimestamp(), read: false });
                loadMessagesFor(currentMessagesPeerId);
                loadMessagesConversations();
            }).catch(function(err) { console.error(err); alert('Ses yüklenemedi.'); });
        }
        function messagesMicStopAndDiscard() {
            if (!messagesMicRecording) return;
            var btn = document.getElementById('messagesMicBtn');
            var ind = document.getElementById('messagesRecordingIndicator');
            messagesMicRecording.stop();
            messagesMicRecording = null;
            if (messagesMicStream) { messagesMicStream.getTracks().forEach(function(t) { t.stop(); }); messagesMicStream = null; }
            messagesMicChunks = null;
            btn.classList.remove('messages-mic-recording');
            btn.innerHTML = '<i class="fas fa-microphone"></i>';
            btn.title = 'Bir kez bas: kayda başla, tekrar bas: metin alanına yükle';
            if (ind) ind.style.display = 'none';
        }
        function messagesMicStopAndLoadIntoComposer() {
            if (!messagesMicRecording) return;
            messagesMicRecording.stop();
            messagesMicRecording = null;
        }
        function messagesMicClearPending() {
            messagesMicPendingBlob = null;
            messagesMicPendingDuration = 0;
            var pendingEl = document.getElementById('messagesPendingVoice');
            if (pendingEl) pendingEl.style.display = 'none';
        }
        function messagesMicSendPending() {
            if (!messagesMicPendingBlob || !auth.currentUser || !currentMessagesPeerId) return;
            var blob = messagesMicPendingBlob;
            messagesMicClearPending();
            var ref = storage.ref('voice/' + auth.currentUser.uid + '/' + Date.now() + '.webm');
            ref.put(blob).then(function() { return ref.getDownloadURL(); }).then(function(url) {
                db.collection('messages').add({ fromUserId: auth.currentUser.uid, toUserId: currentMessagesPeerId, text: '🎤 Sesli mesaj', audioUrl: url, createdAt: firebase.firestore.FieldValue.serverTimestamp(), read: false });
                loadMessagesFor(currentMessagesPeerId);
                loadMessagesConversations();
            }).catch(function(err) { console.error(err); alert('Ses yüklenemedi.'); });
        }
        var micBtn = document.getElementById('messagesMicBtn');
        if (micBtn) {
            micBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                if (messagesMicRecording) { messagesMicStopAndLoadIntoComposer(); return; }
                if (!currentMessagesPeerId) { alert('Önce bir sohbet seçin.'); return; }
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Tarayıcınız ses kaydını desteklemiyor.'); return; }
                navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
                    messagesMicStream = stream;
                    var recorder = new (window.MediaRecorder || window.webkitMediaRecorder)(stream);
                    messagesMicChunks = [];
                    messagesMicStartTime = Date.now();
                    recorder.ondataavailable = function(e) { if (e.data.size) messagesMicChunks.push(e.data); };
                    recorder.onstop = function() {
                        var chunks = messagesMicChunks;
                        messagesMicChunks = null;
                        var duration = (Date.now() - messagesMicStartTime) / 1000;
                        if (messagesMicStream) { messagesMicStream.getTracks().forEach(function(t) { t.stop(); }); messagesMicStream = null; }
                        var btn = document.getElementById('messagesMicBtn');
                        var ind = document.getElementById('messagesRecordingIndicator');
                        btn.classList.remove('messages-mic-recording');
                        btn.innerHTML = '<i class="fas fa-microphone"></i>';
                        btn.title = 'Bir kez bas: kayda başla, tekrar bas: metin alanına yükle';
                        if (ind) ind.style.display = 'none';
                        if (chunks && chunks.length > 0 && duration >= 0.3) {
                            messagesMicPendingBlob = new Blob(chunks, { type: 'audio/webm' });
                            messagesMicPendingDuration = duration;
                            var pendingEl = document.getElementById('messagesPendingVoice');
                            var textEl = document.getElementById('messagesPendingVoiceText');
                            if (textEl) textEl.textContent = 'Sesli mesaj hazır (' + duration.toFixed(1) + ' sn). Gönder butonuna basarak karşı tarafa gönderin.';
                            if (pendingEl) pendingEl.style.display = 'flex';
                        } else if (duration > 0 && duration < 0.3) alert('Ses çok kısa. Biraz daha konuşup tekrar mikrofona basın.');
                    };
                    recorder.start();
                    messagesMicRecording = recorder;
                    micBtn.innerHTML = '<i class="fas fa-stop"></i>';
                    micBtn.title = 'Kayıt yapılıyor. Tekrar bas: metin alanına yükle';
                    micBtn.classList.add('messages-mic-recording');
                    var ind = document.getElementById('messagesRecordingIndicator');
                    if (ind) ind.style.display = 'flex';
                }).catch(function() { alert('Mikrofon izni gerekli.'); });
            });
            micBtn.addEventListener('contextmenu', function(ev) { ev.preventDefault(); });
        }
        var messagesPendingVoiceCancel = document.getElementById('messagesPendingVoiceCancel');
        if (messagesPendingVoiceCancel) messagesPendingVoiceCancel.addEventListener('click', function() { messagesMicClearPending(); });

        var messagesAttachBtn = document.getElementById('messagesAttachBtn');
        var messagesPhotoInput = document.getElementById('messagesPhotoInput');
        if (messagesAttachBtn && messagesPhotoInput) {
            messagesAttachBtn.addEventListener('click', function(ev) { ev.preventDefault(); if (currentMessagesPeerId) messagesPhotoInput.click(); else alert('Önce bir sohbet seçin.'); });
        }
        if (messagesPhotoInput) {
            messagesPhotoInput.addEventListener('change', function(e) {
                var files = e.target.files;
                if (!files || !files.length) return;
                var f = files[0];
                var t = (f.type || '').toLowerCase();
                if (t.indexOf('image/') !== 0) { alert('Lütfen bir fotoğraf seçin.'); e.target.value = ''; return; }
                messagesPendingPhotoFile = f;
                messagesPendingPhotoUrl = URL.createObjectURL(f);
                var prev = document.getElementById('messagesPhotoPreview');
                var img = document.getElementById('messagesPhotoPreviewImg');
                if (img) img.src = messagesPendingPhotoUrl;
                if (prev) prev.style.display = 'flex';
                e.target.value = '';
            });
        }
        var messagesPhotoPreviewRemove = document.getElementById('messagesPhotoPreviewRemove');
        if (messagesPhotoPreviewRemove) messagesPhotoPreviewRemove.addEventListener('click', function() { messagesClearPendingPhoto(); });

        function openMessagesImageLightbox(url) {
            var lb = document.getElementById('messagesImageLightbox');
            var img = document.getElementById('messagesImageLightboxImg');
            if (lb && img) { img.src = url || ''; lb.style.display = 'flex'; }
        }
        function closeMessagesImageLightbox() {
            var lb = document.getElementById('messagesImageLightbox');
            var img = document.getElementById('messagesImageLightboxImg');
            if (lb) lb.style.display = 'none';
            if (img) img.src = '';
        }
        var messagesImageLb = document.getElementById('messagesImageLightbox');
        if (messagesImageLb) {
            messagesImageLb.addEventListener('click', function(ev) { if (ev.target === messagesImageLb || ev.target.closest('.messages-image-lightbox-close')) closeMessagesImageLightbox(); });
            var messagesImageLbImg = document.getElementById('messagesImageLightboxImg');
            if (messagesImageLbImg) messagesImageLbImg.addEventListener('click', function(ev) { ev.stopPropagation(); });
        }

        var messagesListEl = document.getElementById('messagesList');
        if (messagesListEl) messagesListEl.addEventListener('click', function(ev) {
            var photoWrap = ev.target.closest('.msg-photo-wrap');
            if (photoWrap) {
                ev.preventDefault();
                var url = photoWrap.getAttribute('data-msg-image-url') || (photoWrap.querySelector('img') && photoWrap.querySelector('img').src);
                if (url) openMessagesImageLightbox(url);
                return;
            }
            var btn = ev.target.closest('.msg-play-voice');
            if (!btn) return;
            ev.preventDefault();
            var url = btn.getAttribute('data-audio-url');
            if (url) { var a = new Audio(url); a.play().catch(function() {}); }
        });

        async function refreshMessagesBadge() {
            const user = auth.currentUser;
            if (!user) return;
            try {
                const snap = await db.collection('messages').where('toUserId', '==', user.uid).get();
                const fromIds = new Set();
                snap.docs.forEach(d => { if (d.data().read === false) fromIds.add(d.data().fromUserId); });
                const n = fromIds.size;
                const badge = document.getElementById('messagesBadge');
                const badgeH = document.getElementById('messagesBadgeHeader');
                if (n > 0) { badge.textContent = n; badge.style.display = 'inline-flex'; if (badgeH) { badgeH.textContent = n; badgeH.style.display = 'inline'; } }
                else { badge.style.display = 'none'; if (badgeH) badgeH.style.display = 'none'; }
            } catch (e) { console.error(e); }
        }

        auth.onAuthStateChanged(function(u) {
            if (u) { refreshFriendsBadge(); refreshMessagesBadge(); refreshNotificationsPanelBadge(); }
        });

        /* ---------- YORUMLARIM: Yorum Yaz modal, Yorumlarım feed (sol menüde başlıklar) ---------- */
        function toggleYorumlarimDropdown(ev) { if (ev) ev.stopPropagation(); }
        function closeYorumlarimDropdown() { }
        function toggleYorumlarimPanel(ev) { if (ev) ev.stopPropagation(); }
        function closeYorumlarimPanel() { }

        var yorumYazMediaFiles = [];
        var yorumYazQuotedPostId = null;
        var yorumYazQuotedText = '';
        /** Video/foto dosyası seçildikten sonra sıkıştırma/önizleme bitene kadar true (mobilde erken Gönder sorununu önler) */
        var yorumYazMediaPrepareBusy = false;
        function yorumYazSyncSendButtonState() {
            var btn = document.getElementById('yorumYazSendBtn');
            if (!btn || btn.getAttribute('data-fs-submitting') === '1') return;
            if (yorumYazMediaPrepareBusy) {
                btn.disabled = true;
                btn.textContent = 'Hazırlanıyor...';
                return;
            }
            btn.disabled = false;
            btn.textContent = yorumYazQuotedPostId ? 'Paylaş' : 'Gönder';
        }
        function yorumYazEndSubmittingUi(btn) {
            if (btn) btn.removeAttribute('data-fs-submitting');
            yorumYazSyncSendButtonState();
        }
        function showYorumYazHata(metin) {
            var el = document.getElementById('yorumYazHata');
            if (el) { el.textContent = metin || ''; el.style.display = metin ? 'block' : 'none'; }
        }
        function applyYorumYazHeaderFromUserProfile(snap, user) {
            if (!user) return;
            var d = (!snap || snap.empty) ? {} : snap.docs[0].data();
            var rawUn = (d.username || '').trim().replace(/^@+/, '');
            var username = rawUn.toLowerCase().replace(/[^a-z0-9_.]/g, '');
            if (rawUn && !username) username = rawUn;
            var name = d.adSoyad || user.displayName || 'Kullanıcı';
            var photo = (d.photoUrl || user.photoURL || '').trim();
            var av = document.getElementById('yorumYazAvatar');
            var handleEl = document.getElementById('yorumYazHandle');
            var nameEl = document.getElementById('yorumYazName');
            if (!av || !nameEl) return;
            av.src = photo || YORUM_YAZ_AVATAR_PLACEHOLDER;
            av.alt = name;
            av.style.display = 'block';
            av.classList.toggle('yorum-yaz-avatar--placeholder', !photo);
            if (handleEl) {
                if (username) {
                    handleEl.textContent = '@' + username;
                    handleEl.style.display = 'block';
                    nameEl.textContent = name;
                } else {
                    handleEl.textContent = '';
                    handleEl.style.display = 'none';
                    nameEl.textContent = name;
                }
            }
        }
        function openYorumYazModal() {
            var user = auth.currentUser;
            if (!user) { alert('Yorum yazmak için giriş yapın.'); return; }
            showYorumYazHata('');
            yorumYazQuotedPostId = null;
            yorumYazQuotedText = '';
            document.getElementById('yorumYazQuotePreview').style.display = 'none';
            document.getElementById('yorumYazText').value = '';
            document.getElementById('yorumYazText').placeholder = 'Ne düşünüyorsunuz?';
            var sendB = document.getElementById('yorumYazSendBtn');
            if (sendB) sendB.removeAttribute('data-fs-submitting');
            yorumYazMediaPrepareBusy = false;
            yorumYazMediaFiles = [];
            renderYorumYazMediaList();
            yorumYazSyncSendButtonState();
            applyYorumYazHeaderFromUserProfile(null, user);
            db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                applyYorumYazHeaderFromUserProfile(snap, user);
            }).catch(function() {
                applyYorumYazHeaderFromUserProfile(null, user);
            });
            document.getElementById('yorumYazModal').classList.add('open');
            document.getElementById('yorumYazModal').style.display = 'flex';
        }
        function openYorumYazModalForQuote(postId, quotedText) {
            var user = auth.currentUser;
            if (!user) { alert('Alıntı yapmak için giriş yapın.'); return; }
            yorumYazQuotedPostId = postId;
            yorumYazQuotedText = (quotedText || '').substring(0, 300);
            document.getElementById('yorumYazQuotePreview').style.display = 'flex';
            document.getElementById('yorumYazQuoteText').textContent = yorumYazQuotedText + (yorumYazQuotedText.length >= 300 ? '...' : '');
            document.getElementById('yorumYazText').value = '';
            document.getElementById('yorumYazText').placeholder = 'Alıntı yorumunuzu yazın...';
            var sendQ = document.getElementById('yorumYazSendBtn');
            if (sendQ) sendQ.removeAttribute('data-fs-submitting');
            yorumYazMediaPrepareBusy = false;
            yorumYazMediaFiles = [];
            renderYorumYazMediaList();
            yorumYazSyncSendButtonState();
            applyYorumYazHeaderFromUserProfile(null, user);
            db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                applyYorumYazHeaderFromUserProfile(snap, user);
            }).catch(function() {
                applyYorumYazHeaderFromUserProfile(null, user);
            });
            document.getElementById('yorumYazModal').classList.add('open');
            document.getElementById('yorumYazModal').style.display = 'flex';
        }
        function yorumYazClearQuote() {
            yorumYazQuotedPostId = null;
            yorumYazQuotedText = '';
            document.getElementById('yorumYazQuotePreview').style.display = 'none';
            yorumYazSyncSendButtonState();
            document.getElementById('yorumYazText').placeholder = 'Ne düşünüyorsunuz?';
        }
        function closeYorumYazModal() {
            showYorumYazHata('');
            yorumYazQuotedPostId = null;
            yorumYazQuotedText = '';
            yorumYazMediaPrepareBusy = false;
            document.getElementById('yorumYazQuotePreview').style.display = 'none';
            var sc = document.getElementById('yorumYazSendBtn');
            if (sc) sc.removeAttribute('data-fs-submitting');
            document.getElementById('yorumYazModal').classList.remove('open');
            document.getElementById('yorumYazModal').style.display = 'none';
            setYorumlarimActiveBaslik('');
            var inp = document.getElementById('yorumYazFileInput');
            if (inp) inp.value = '';
            yorumYazSyncSendButtonState();
        }
        function setYorumlarimActiveBaslik(which) {
            var yz = document.getElementById('yorumYazBaslik');
            var ym = document.getElementById('yorumlarimBaslik');
            if (yz) yz.classList.toggle('active', which === 'yorumYaz');
            if (ym) ym.classList.toggle('active', which === 'yorumlarim');
        }
        function renderYorumYazMediaList() {
            var container = document.getElementById('yorumYazMediaList');
            container.innerHTML = '';
            yorumYazMediaFiles.forEach(function(item, idx) {
                var wrap = document.createElement('div');
                var mime = item.mimeType || (item.file && item.file.type) || '';
                var name = item.fileName || (item.file && item.file.name) || '';
                var isImg = (mime.indexOf('image/') === 0) || /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
                if (isImg) {
                    wrap.className = 'yorum-yaz-media-item';
                    var img = document.createElement('img');
                    img.src = item.url;
                    wrap.appendChild(img);
                } else {
                    wrap.className = 'yorum-yaz-media-item yorum-yaz-media-player';
                    var vid = document.createElement('video');
                    vid.src = item.url;
                    vid.controls = true;
                    vid.controlsList = 'nodownload';
                    vid.setAttribute('playsinline', '');
                    wrap.appendChild(vid);
                }
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'yorum-yaz-media-remove';
                btn.title = 'Kaldır';
                btn.innerHTML = '&times;';
                btn.onclick = function(ev) { ev.preventDefault(); ev.stopPropagation(); yorumYazMediaFiles.splice(idx, 1); renderYorumYazMediaList(); };
                wrap.appendChild(btn);
                container.appendChild(wrap);
            });
        }
        var yorumYazFileInputLastOpen = 0;
        document.getElementById('yorumYazAddMedia').addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            var now = Date.now();
            if (now - yorumYazFileInputLastOpen < 800) return;
            yorumYazFileInputLastOpen = now;
            var inp = document.getElementById('yorumYazFileInput');
            if (inp) inp.click();
        });
        document.getElementById('yorumYazFileInput').addEventListener('change', async function(e) {
            var files = e.target.files;
            if (!files || !files.length) return;
            yorumYazMediaPrepareBusy = true;
            yorumYazSyncSendButtonState();
            try {
                var curPhotos = 0, curVideos = 0;
                yorumYazMediaFiles.forEach(function(item) {
                    var m = item.mimeType || (item.file && item.file.type) || '';
                    var n = item.fileName || (item.file && item.file.name) || '';
                    if (m.indexOf('video/') === 0 || /\.(mp4|webm|mov|ogg|mkv|3gp)$/i.test(n)) curVideos++; else curPhotos++;
                });
                for (var i = 0; i < files.length; i++) {
                    var f = files[i];
                    var fType = (f.type || '').toLowerCase();
                    var fName = (f.name || '');
                    var asVideo = fType.indexOf('video/') === 0 || /\.(mp4|webm|mov|ogg|mkv|3gp)$/i.test(fName);
                    var asImage = fType.indexOf('image/') === 0 || /\.(jpg|jpeg|png|gif|webp)$/i.test(fName);
                    if (!asVideo && !asImage) continue;
                    if (asVideo) {
                        if (curVideos >= MAX_USER_VIDEOS) { alert('En fazla ' + MAX_USER_VIDEOS + ' video yükleyebilirsiniz.'); continue; }
                        try {
                            var dur = await getVideoDurationSec(f);
                            if (dur > MAX_VIDEO_DURATION_SEC) { alert('Videolar en fazla ' + MAX_VIDEO_DURATION_SEC + ' saniye olmalı. Bu video ' + Math.ceil(dur) + ' sn.'); continue; }
                            /* Küçük MP4/WebM/quicktime — yeniden kodlama atlanır; ağır veya tuhaf codec yine işlenir */
                            var fMime = ((f && f.type) ? f.type : '').toLowerCase();
                            var skipTranscode = !!(f && f.size > 0 && f.size <= YORUM_VIDEO_ENCODE_SKIP_BYTES && (fMime.indexOf('video/mp4') === 0 || fMime.indexOf('video/webm') === 0 || fMime.indexOf('video/quicktime') === 0));
                            if (!skipTranscode) {
                                var comp = await compressYorumVideoForUploadSafe(f, MAX_VIDEO_DURATION_SEC, YORUM_VIDEO_ENCODE_MAX_WIDTH, YORUM_VIDEO_BITS_PER_SECOND);
                                f = comp.file;
                            }
                        } catch (err) {
                            alert('Video hazırlanamadı (süre okunamadı). Başka bir dosya deneyin.');
                            continue;
                        }
                        curVideos++;
                    } else if (asImage) {
                        if (curPhotos >= MAX_USER_PHOTOS) { alert('En fazla ' + MAX_USER_PHOTOS + ' fotoğraf yükleyebilirsiniz.'); continue; }
                        curPhotos++;
                    }
                    var url = URL.createObjectURL(f);
                    var mimeType = (f && f.type) ? f.type : (asVideo ? 'video/webm' : 'image/jpeg');
                    var dispName = (f && f.name) ? f.name : (asVideo ? 'video.webm' : 'image.jpg');
                    yorumYazMediaFiles.push({ file: f, url: url, fileName: dispName, mimeType: mimeType });
                }
                renderYorumYazMediaList();
            } finally {
                yorumYazMediaPrepareBusy = false;
                yorumYazSyncSendButtonState();
            }
        });

        function readFileAsBlob(file) {
            return new Promise(function(resolve, reject) {
                if (!file || typeof file.slice !== 'function') { reject(new Error('Dosya yok')); return; }
                var reader = new FileReader();
                reader.onload = function() { resolve(new Blob([reader.result], { type: file.type || 'application/octet-stream' })); };
                reader.onerror = function() { reject(reader.error || new Error('Dosya okunamadı')); };
                reader.readAsArrayBuffer(file);
            });
        }
        function submitYorum() {
            var user = auth.currentUser;
            if (!user) { alert('Giriş yapın.'); return; }
            if (yorumYazMediaPrepareBusy) {
                showYorumYazHata('Dosya hazırlanıyor. Önizleme göründükten sonra Gönder\'e basın.');
                alert('Video veya fotoğraf hâlâ hazırlanıyor. Önizleme geldikten sonra tekrar deneyin.');
                return;
            }
            var textEl = document.getElementById('yorumYazText');
            var text = (textEl && textEl.value) ? textEl.value.trim() : '';
            if (!text && (!yorumYazMediaFiles || yorumYazMediaFiles.length === 0)) { alert('Metin veya fotoğraf/video ekleyin.'); return; }
            var btn = document.getElementById('yorumYazSendBtn');
            if (btn) {
                btn.setAttribute('data-fs-submitting', '1');
                btn.disabled = true;
                btn.textContent = 'Gönderiliyor...';
            }
            var uploadRejectFn = null;
            var sendTimeout = setTimeout(function() {
                sendTimeout = null;
                yorumYazEndSubmittingUi(btn);
                if (typeof uploadRejectFn === 'function') uploadRejectFn(new Error('İşlem zaman aşımına uğradı'));
                alert('İşlem zaman aşımına uğradı. Bağlantıyı kontrol edip tekrar deneyin.');
            }, 120000);
            function clearSendTimeout() { if (sendTimeout) { clearTimeout(sendTimeout); sendTimeout = null; } }
            /* Listeyi hemen klonla – mobilde başka işlemler diziyi temizleyebilir, video kaybolmasın */
            var list = (yorumYazMediaFiles || []).slice(0);
            var mediaListEl = document.getElementById('yorumYazMediaList');
            if (mediaListEl && mediaListEl.children.length > 0 && list.length === 0) {
                clearSendTimeout();
                yorumYazEndSubmittingUi(btn);
                var msg = 'Medya eklendi ama yüklenemedi. Videoyu kaldırıp tekrar ekleyin (ataç → video seç) ve hemen Gönder\'e basın.';
                showYorumYazHata(msg);
                alert(msg);
                return;
            }
            /* Storage yalnızca foto/video varken gerekli; sadece metin gönderisinde zorunlu değil */
            var stor = (typeof firebase !== 'undefined' && firebase.storage) ? firebase.storage() : (typeof storage !== 'undefined' ? storage : null);
            if (list.length > 0 && !stor) { clearSendTimeout(); yorumYazEndSubmittingUi(btn); alert('Depolama kullanılamıyor. Fotoğraf/video yüklemek için sayfayı yenileyin.'); return; }
            /* Gönder anında dosyayı Blob'a oku (mobilde File referansı kaybolmasın diye) */
            function buildUploadItems() {
                if (list.length === 0) return Promise.resolve([]);
                return Promise.all(list.map(function(el) {
                    var mime = el.mimeType || (el.file && el.file.type) || '';
                    var name = (el.fileName || (el.file && el.file.name) || '').trim();
                    var isV = mime.indexOf('video/') === 0 || /\.(mp4|webm|mov|ogg|mkv|3gp)$/i.test(name);
                    var data = el.blob || (el.file && el.file.size > 0 ? el.file : null);
                    if (data) return Promise.resolve({ data: data, isVideo: isV, mimeType: mime || (isV ? 'video/mp4' : 'image/jpeg'), fileName: name });
                    if (el.file) return readFileAsBlob(el.file).then(function(blob) { return { data: blob, isVideo: isV, mimeType: mime || (isV ? 'video/mp4' : 'image/jpeg'), fileName: name }; });
                    return Promise.reject(new Error('Medya yüklenemedi. Videoyu kaldırıp tekrar ekleyin (ataç → video seç).'));
                }));
            }
            buildUploadItems().then(function(uploadItems) {
                var newPhotos = 0, newVideos = 0;
                for (var uv = 0; uv < uploadItems.length; uv++) { if (uploadItems[uv].isVideo) newVideos++; else newPhotos++; }
                function doUpload(index, collectedUrls, done) {
                    if (index >= uploadItems.length) return done(null, collectedUrls);
                    var it = uploadItems[index];
                    if (!it.data || (it.data.size !== undefined && it.data.size === 0)) {
                        clearSendTimeout();
                        yorumYazEndSubmittingUi(btn);
                        showYorumYazHata('Medya dosyası boş veya okunamadı. Videoyu tekrar seçip deneyin.');
                        return done(new Error('Medya dosyası boş veya okunamadı'));
                    }
                    var ext = (it.fileName && it.fileName.split('.').length > 1) ? it.fileName.split('.').pop().replace(/[^a-z0-9]/gi, '') : '';
                    if (!ext) ext = it.isVideo ? 'mp4' : 'jpg';
                    if (it.isVideo) {
                        var mt = String(it.mimeType || '').toLowerCase();
                        var fnLow = String(it.fileName || '').toLowerCase();
                        if (mt.indexOf('video/webm') === 0 || fnLow.indexOf('.webm') !== -1) ext = 'webm';
                        else if (mt.indexOf('video/quicktime') === 0 || /\.(mov|qt)$/.test(fnLow)) ext = 'mov';
                        else if (mt.indexOf('video/mp4') === 0 || fnLow.indexOf('.mp4') !== -1) ext = 'mp4';
                    }
                    var path = 'posts/' + user.uid + '/' + Date.now() + '_' + index + '.' + ext;
                    var ref = stor.ref(path);
                    var metaCt = it.mimeType;
                    if (it.isVideo) {
                        if (!metaCt || metaCt.indexOf('video/') !== 0) {
                            if (ext === 'webm') metaCt = 'video/webm';
                            else if (ext === 'mov') metaCt = 'video/quicktime';
                            else metaCt = 'video/mp4';
                        }
                    }
                    var meta = { contentType: metaCt };
                    ref.put(it.data, meta).then(function() { return ref.getDownloadURL(); }).then(function(url) {
                        if (!url || typeof url !== 'string' || !String(url).trim()) {
                            clearSendTimeout();
                            yorumYazEndSubmittingUi(btn);
                            showYorumYazHata('Dosya yüklendi ancak indirme bağlantısı alınamadı. Tekrar deneyin.');
                            return done(new Error('getDownloadURL boş'));
                        }
                        collectedUrls.push(String(url).trim());
                        doUpload(index + 1, collectedUrls, done);
                    }).catch(function(err) {
                        console.error('Yorum yükleme hatası', err);
                        clearSendTimeout();
                        yorumYazEndSubmittingUi(btn);
                        var errMsg = (err && (err.code || err.message)) ? (err.code + ': ' + err.message) : 'Yükleme başarısız';
                        showYorumYazHata('Video yüklenemedi: ' + errMsg);
                        done(err || new Error(errMsg));
                    });
                }
                function savePost(mediaUrls) {
                    var quotedId = yorumYazQuotedPostId;
                    var quotedTxt = yorumYazQuotedText || '';
                    db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                        var userName = user.displayName || 'Kullanıcı';
                        var userPhotoUrl = user.photoURL || '';
                        if (!snap.empty) { var d = snap.docs[0].data(); userName = d.adSoyad || userName; userPhotoUrl = d.photoUrl || userPhotoUrl; }
                        var payload = {
                            userId: user.uid,
                            userName: userName,
                            userPhotoUrl: userPhotoUrl,
                            text: text || '',
                            mediaUrls: normalizeMediaUrlsField(mediaUrls),
                            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                            likeCount: 0,
                            commentCount: 0,
                            favoriteCount: 0,
                            shareCount: 0,
                            quoteCount: 0
                        };
                        if (quotedId) {
                            payload.quotedPostId = quotedId;
                            payload.quotedText = quotedTxt.substring(0, 200);
                        }
                        return db.collection('userPosts').add(payload).then(function(docRef) {
                            var newPostId = docRef.id;
                            Promise.resolve(createMentionNotifications(text, user.uid, userName, userPhotoUrl, newPostId)).catch(function(mErr) {
                                console.warn('[Yorum] mention bildirimi tamamlanamadı', mErr);
                            });
                            return newPostId;
                        });
                    }).then(function(newPostId) {
                        clearSendTimeout();
                        yorumYazEndSubmittingUi(btn);
                        if (quotedId) {
                            return db.collection('userPosts').doc(quotedId).update({ quoteCount: firebase.firestore.FieldValue.increment(1) }).then(function() {
                        closeYorumYazModal();
                            if (document.getElementById('yorumlarimFeedModal').classList.contains('open')) loadYorumlarimFeed();
                            if (typeof loadAnaSayfamFromFirebase === 'function') loadAnaSayfamFromFirebase();
                            if (document.getElementById('videolarimModal') && document.getElementById('videolarimModal').classList.contains('open') && typeof loadVideolarimContent === 'function') loadVideolarimContent();
                            refreshNotificationsPanelBadge();
                        }).catch(function(updateErr) {
                            console.warn('quoteCount güncellenemedi', updateErr);
                            closeYorumYazModal();
                            if (document.getElementById('yorumlarimFeedModal').classList.contains('open')) loadYorumlarimFeed();
                            if (typeof loadAnaSayfamFromFirebase === 'function') loadAnaSayfamFromFirebase();
                            if (document.getElementById('videolarimModal') && document.getElementById('videolarimModal').classList.contains('open') && typeof loadVideolarimContent === 'function') loadVideolarimContent();
                            refreshNotificationsPanelBadge();
                        });
                    }
                    closeYorumYazModal();
                    if (document.getElementById('yorumlarimFeedModal').classList.contains('open')) loadYorumlarimFeed();
                    if (typeof loadAnaSayfamFromFirebase === 'function') loadAnaSayfamFromFirebase();
                    if (document.getElementById('videolarimModal') && document.getElementById('videolarimModal').classList.contains('open') && typeof loadVideolarimContent === 'function') loadVideolarimContent();
                    refreshNotificationsPanelBadge();
                    }).catch(function(err) {
                        console.error(err);
                        clearSendTimeout();
                        yorumYazEndSubmittingUi(btn);
                        alert('Kayıt hatası: ' + (err && err.message ? err.message : 'Tekrar deneyin.'));
                    });
                }
                var countPromise = countUserPhotosAndVideos(user.uid);
                var uploadPromise = new Promise(function(resolve, reject) {
                    uploadRejectFn = reject;
                    if (uploadItems.length === 0) { resolve([]); return; }
                    doUpload(0, [], function(err, urls) { if (err) reject(err); else resolve(urls || []); });
                });
                Promise.all([countPromise, uploadPromise]).then(function(results) {
                    var counts = results[0];
                    var mediaUrls = results[1];
                    if (counts.photos + newPhotos > MAX_USER_PHOTOS) {
                        clearSendTimeout(); yorumYazEndSubmittingUi(btn);
                        alert('En fazla ' + MAX_USER_PHOTOS + ' fotoğraf yükleyebilirsiniz.');
                        return;
                    }
                    if (counts.videos + newVideos > MAX_USER_VIDEOS) {
                        clearSendTimeout(); yorumYazEndSubmittingUi(btn);
                        alert('En fazla ' + MAX_USER_VIDEOS + ' video yükleyebilirsiniz.');
                        return;
                    }
                    /* Video/foto yüklenemediyse gönderiyi kaydetme – Fotograflarım’da “yüklenmemiş” görünmesin */
                    if (uploadItems.length > 0 && mediaUrls.length === 0) {
                        clearSendTimeout(); yorumYazEndSubmittingUi(btn);
                        showYorumYazHata('Medya yüklenemedi. Gönderi kaydedilmedi. Bağlantıyı kontrol edip tekrar deneyin.');
                        alert('Video/fotoğraf yüklenemedi, gönderi kaydedilmedi. Lütfen tekrar deneyin.');
                        return;
                    }
                    savePost(mediaUrls);
                }).catch(function(err) {
                    console.error(err);
                    clearSendTimeout();
                    yorumYazEndSubmittingUi(btn);
                    var msg = err && err.message ? ('Video yüklenemedi: ' + err.message) : 'Kota veya yükleme hatası. Tekrar deneyin.';
                    showYorumYazHata(msg);
                    alert(msg);
                });
            }).catch(function(err) {
                console.error(err);
                clearSendTimeout();
                yorumYazEndSubmittingUi(btn);
                var msg = (err && err.message) ? err.message : 'Medya yüklenemedi. Videoyu kaldırıp tekrar ekleyin (ataç → video seç).';
                showYorumYazHata(msg);
                alert(msg);
            });
        }

        (function bindYorumYazSendButtonOnce() {
            var el = document.getElementById('yorumYazSendBtn');
            if (!el || el.dataset.fsBoundSubmit === '1') return;
            el.dataset.fsBoundSubmit = '1';
            el.addEventListener('click', function(ev) {
                ev.preventDefault();
                submitYorum();
            });
        })();

        function openYorumlarimFeedModal() {
            var user = auth.currentUser;
            if (!user) { alert('Giriş yapın.'); return; }
            document.getElementById('yorumlarimFeedModal').classList.add('open');
            document.getElementById('yorumlarimFeedModal').style.display = 'flex';
            loadYorumlarimFeed();
        }
        function closeYorumlarimFeedModal() {
            document.getElementById('yorumlarimFeedModal').classList.remove('open');
            document.getElementById('yorumlarimFeedModal').style.display = 'none';
            setYorumlarimActiveBaslik('');
        }

        function openFotograflarimModal() {
            var user = auth.currentUser;
            if (!user) { alert('Fotoğraflarınızı görmek için giriş yapın.'); return; }
            document.getElementById('fotograflarimModal').classList.add('open');
            document.getElementById('fotograflarimModal').style.display = 'flex';
            loadFotograflarimContent();
        }
        document.addEventListener('click', function fotograflarimDocClick(ev) {
            var modal = document.getElementById('fotograflarimModal');
            if (!modal || !modal.classList.contains('open')) return;
            var body = document.getElementById('fotograflarimBody');
            if (!body || !body.contains(ev.target)) return;
            var item = ev.target.closest('.fotograflarim-item');
            if (!item) return;
            if (ev.target.closest('.fotograflarim-item-delete')) {
                ev.preventDefault(); ev.stopPropagation();
                var postId = item.getAttribute('data-post-id');
                var mediaUrl = item.getAttribute('data-media-url');
                if (postId && mediaUrl && typeof deleteFotograflarimMedia === 'function') deleteFotograflarimMedia(postId, mediaUrl);
                return;
            }
            ev.preventDefault(); ev.stopPropagation();
            var img = item.querySelector('img');
            var src = (img && (img.getAttribute('data-src') || img.src)) ? (img.getAttribute('data-src') || img.src) : '';
            if (src && typeof openFotograflarimLightbox === 'function') openFotograflarimLightbox(src);
        });
        function closeFotograflarimModal() {
            document.getElementById('fotograflarimModal').classList.remove('open');
            document.getElementById('fotograflarimModal').style.display = 'none';
        }
        function openVideolarimModal() {
            var modal = document.getElementById('videolarimModal');
            if (!modal) return;
            modal.classList.add('open');
            modal.style.display = 'flex';
            var user = auth.currentUser;
            if (!user) {
                var body = document.getElementById('videolarimBody');
                if (body) body.innerHTML = '<div class="friends-empty">Videolarınızı görmek için giriş yapın.</div>';
                return;
            }
            loadVideolarimContent();
        }
        function closeVideolarimModal() {
            var modal = document.getElementById('videolarimModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
            closeVideolarimMediaPlayer();
        }
        window.openVideolarimModal = openVideolarimModal;
        window.closeVideolarimModal = closeVideolarimModal;

        function formatVideolarimPlayerTime(sec) {
            if (!isFinite(sec) || sec < 0) sec = 0;
            var m = Math.floor(sec / 60);
            var s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }
        function ensureVideolarimPlayerUi() {
            if (window._videolarimPlayerUiBound) return;
            window._videolarimPlayerUiBound = true;
            var modal = document.getElementById('videolarimPlayerModal');
            var vid = document.getElementById('videolarimPlayerVideo');
            var playBtn = document.getElementById('videolarimPlayerPlayPause');
            var playIco = document.getElementById('videolarimPlayerPlayIcon');
            var rewBtn = document.getElementById('videolarimPlayerRew');
            var fwdBtn = document.getElementById('videolarimPlayerFwd');
            var seek = document.getElementById('videolarimPlayerSeek');
            var timeLbl = document.getElementById('videolarimPlayerTimeLbl');
            var closeBtn = document.getElementById('videolarimPlayerClose');
            var back = modal && modal.querySelector('.videolarim-player-backdrop');
            if (!modal || !vid || !playBtn || !seek) return;
            function syncPlayIcon() {
                if (!playIco) return;
                playIco.className = vid.paused ? 'fas fa-play' : 'fas fa-pause';
            }
            function updateSeekFromVideo() {
                var d = vid.duration;
                if (!isFinite(d) || d <= 0) return;
                seek.value = String(vid.currentTime / d);
                if (timeLbl) timeLbl.textContent = formatVideolarimPlayerTime(vid.currentTime) + ' / ' + formatVideolarimPlayerTime(d);
            }
            vid.addEventListener('play', syncPlayIcon);
            vid.addEventListener('pause', syncPlayIcon);
            vid.addEventListener('timeupdate', updateSeekFromVideo);
            vid.addEventListener('loadedmetadata', function() {
                seek.value = '0';
                if (timeLbl) timeLbl.textContent = '0:00 / ' + formatVideolarimPlayerTime(vid.duration);
            });
            vid.addEventListener('ended', syncPlayIcon);
            playBtn.addEventListener('click', function(e) {
                e.preventDefault();
                if (vid.paused) vid.play().catch(function() {});
                else vid.pause();
            });
            rewBtn && rewBtn.addEventListener('click', function(e) {
                e.preventDefault();
                vid.currentTime = Math.max(0, vid.currentTime - 10);
                updateSeekFromVideo();
            });
            fwdBtn && fwdBtn.addEventListener('click', function(e) {
                e.preventDefault();
                var d = vid.duration;
                if (isFinite(d)) vid.currentTime = Math.min(d, vid.currentTime + 10);
                else vid.currentTime = vid.currentTime + 10;
                updateSeekFromVideo();
            });
            seek.addEventListener('input', function() {
                var d = vid.duration;
                if (!isFinite(d) || d <= 0) return;
                vid.currentTime = parseFloat(seek.value) * d;
                if (timeLbl) timeLbl.textContent = formatVideolarimPlayerTime(vid.currentTime) + ' / ' + formatVideolarimPlayerTime(d);
            });
            closeBtn && closeBtn.addEventListener('click', function(e) { e.preventDefault(); closeVideolarimMediaPlayer(); });
            back && back.addEventListener('click', function() { closeVideolarimMediaPlayer(); });
        }
        function openVideolarimMediaPlayer(url) {
            if (!url) return;
            ensureVideolarimPlayerUi();
            var modal = document.getElementById('videolarimPlayerModal');
            var vid = document.getElementById('videolarimPlayerVideo');
            if (!modal || !vid) return;
            closeVideolarimMediaPlayer();
            vid.src = url;
            vid.playsInline = true;
            try { vid.play().catch(function() {}); } catch (e) {}
            modal.style.display = 'flex';
            modal.classList.add('open');
            modal.setAttribute('aria-hidden', 'false');
        }
        function closeVideolarimMediaPlayer() {
            var modal = document.getElementById('videolarimPlayerModal');
            var vid = document.getElementById('videolarimPlayerVideo');
            if (vid) {
                try { vid.pause(); } catch (e) {}
                vid.removeAttribute('src');
                try { vid.load(); } catch (e2) {}
            }
            if (modal) {
                modal.style.display = 'none';
                modal.classList.remove('open');
                modal.setAttribute('aria-hidden', 'true');
            }
        }
        window.openVideolarimMediaPlayer = openVideolarimMediaPlayer;
        window.closeVideolarimMediaPlayer = closeVideolarimMediaPlayer;
        async function loadVideolarimContent() {
            var user = auth.currentUser;
            var body = document.getElementById('videolarimBody');
            if (!user || !body) { if (body) body.innerHTML = ''; return; }
            body.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var html = await getVideolarimHtml(user.uid);
                body.innerHTML = html || '<div class="friends-empty">Henüz video yüklemediniz. Yorum Yaz ile paylaştığınız videolar burada görünür.</div>';
                bindVideolarimEvents();
            } catch (e) {
                body.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>';
            }
        }
        async function getVideolarimHtml(uid) {
            var postsSnap = await db.collection('userPosts').where('userId', '==', uid).get();
            var list = postsSnap.docs.map(function(d) { var x = d.data(); x.id = d.id; return x; });
            list.sort(function(a, b) { var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0; var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0; return tb - ta; });
            var html = '';
            list.forEach(function(post) {
                var mediaUrls = normalizeMediaUrlsField(post.mediaUrls);
                var videoUrls = mediaUrls.filter(function(u) { return isVideoMediaUrl(u); });
                if (videoUrls.length === 0) return;
                var dateStr = post.createdAt && post.createdAt.toDate ? post.createdAt.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
                var text = post.text || '';
                var textEsc = text.replace(/</g, '&lt;').replace(/"/g, '&quot;').substring(0, 120);
                videoUrls.forEach(function(url) {
                    var urlEsc = (url || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    html += '<div class="videolarim-item" data-post-id="' + (post.id || '').replace(/"/g, '&quot;') + '" data-media-url="' + urlEsc + '"><button type="button" class="videolarim-item-delete" title="Sil"><i class="fas fa-trash-alt"></i></button><div class="videolarim-item-thumb"><video src="' + url.replace(/"/g, '&quot;') + '" playsinline preload="metadata" muted class="videolarim-thumb-video"></video><span class="videolarim-thumb-play" aria-hidden="true"><i class="fas fa-play"></i></span></div><div class="videolarim-item-date">' + dateStr + '</div>' + (textEsc ? '<div class="videolarim-item-text">' + textEsc + (text.length > 120 ? '...' : '') + '</div>' : '') + '</div>';
                });
            });
            return html;
        }
        function bindVideolarimEvents() {
            var body = document.getElementById('videolarimBody');
            if (!body) return;
            if (body._videolarimBound) return;
            body._videolarimBound = true;
            body.addEventListener('click', function(ev) {
                var del = ev.target.closest('.videolarim-item-delete');
                if (del) {
                    ev.preventDefault(); ev.stopPropagation();
                    var item = del.closest('.videolarim-item');
                    if (item) {
                        var postId = item.getAttribute('data-post-id');
                        var mediaUrl = item.getAttribute('data-media-url');
                        if (postId && mediaUrl) deleteVideolarimMedia(postId, mediaUrl);
                    }
                    return;
                }
                var item = ev.target.closest('.videolarim-item');
                if (item) {
                    var mediaUrl = item.getAttribute('data-media-url');
                    if (mediaUrl) {
                        ev.preventDefault(); ev.stopPropagation();
                        openVideolarimMediaPlayer(mediaUrl);
                    }
                }
            });
        }
        async function deleteVideolarimMedia(postId, mediaUrl) {
            if (!postId || !mediaUrl || !confirm('Bu videoyu silmek istediğinize emin misiniz?')) return;
            try {
                var ref = db.collection('userPosts').doc(postId);
                var snap = await ref.get();
                if (!snap.exists) { loadVideolarimContent(); return; }
                var data = snap.data();
                var urls = normalizeMediaUrlsField(data.mediaUrls).filter(function(u) { return u !== mediaUrl; });
                await ref.update({ mediaUrls: urls });
                loadVideolarimContent();
            } catch (e) {
                console.error(e);
                alert('Silinirken hata: ' + (e.message || ''));
            }
        }
        async function loadYorumlarimVideolarList() {
            var user = auth.currentUser;
            var container = document.getElementById('yorumlarimVideolarList');
            if (!user || !container) return;
            try {
                var html = await getVideolarimHtml(user.uid);
                container.innerHTML = html || '<p class="friends-empty" style="grid-column:1/-1;padding:12px;color:#8fd3ff;font-size:13px;">Henüz video yok. Yorum Yaz ile eklediğiniz videolar burada görüntülenir.</p>';
            } catch (e) {
                container.innerHTML = '<p class="friends-empty" style="grid-column:1/-1;padding:12px;color:#94a3b8;">Yüklenemedi.</p>';
            }
        }
        async function loadFotograflarimContent() {
            var user = auth.currentUser;
            var body = document.getElementById('fotograflarimBody');
            if (!user) { body.innerHTML = ''; return; }
            body.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var postsSnap = await db.collection('userPosts').where('userId','==',user.uid).get();
                var list = postsSnap.docs.map(function(d){ var x = d.data(); x.id = d.id; return x; });
                list.sort(function(a,b){ var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0; var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0; return tb - ta; });
                var html = '';
                list.forEach(function(post) {
                    var mediaUrls = normalizeMediaUrlsField(post.mediaUrls);
                    var photoUrls = mediaUrls.filter(function(u){ return !isVideoMediaUrl(u); });
                    if (photoUrls.length === 0) return;
                    var dateStr = post.createdAt && post.createdAt.toDate ? post.createdAt.toDate().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
                    var textEsc = (post.text || '').replace(/</g,'&lt;').replace(/"/g,'&quot;').substring(0, 120);
                    photoUrls.forEach(function(url) {
                        var urlEsc = (url || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                        var imgSrc = url.replace(/"/g, '&quot;');
                        html += '<div class="fotograflarim-item" data-post-id="' + (post.id || '').replace(/"/g,'&quot;') + '" data-media-url="' + urlEsc + '"><button type="button" class="fotograflarim-item-delete" title="Sil" aria-label="Sil">&#128465;</button><div class="fotograflarim-item-inner"><img src="' + imgSrc + '" alt="" data-src="' + urlEsc + '"></div><div class="fotograflarim-item-date">' + dateStr + '</div>' + (textEsc ? '<div class="fotograflarim-item-text">' + textEsc + (post.text.length > 120 ? '...' : '') + '</div>' : '') + '</div>';
                    });
                });
                body.innerHTML = html || '<div class="friends-empty">Henüz fotoğraf yüklemediniz. Yorum Yaz ile paylaştığınız fotoğraflar burada ve profil sayfanızdaki Fotoğraflar sekmesinde görünür.</div>';
                if (html) bindFotograflarimEvents();
            } catch (e) {
                body.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>';
            }
        }
        function bindFotograflarimEvents() {
            var body = document.getElementById('fotograflarimBody');
            if (!body) return;
            if (body._fotograflarimBound) return;
            body._fotograflarimBound = true;
            body.addEventListener('click', function(ev) {
                var item = ev.target.closest('.fotograflarim-item');
                if (!item) return;
                if (ev.target.closest('.fotograflarim-item-delete')) {
                    ev.preventDefault(); ev.stopPropagation();
                    var postId = item.getAttribute('data-post-id');
                    var mediaUrl = item.getAttribute('data-media-url');
                    if (postId && mediaUrl) deleteFotograflarimMedia(postId, mediaUrl);
                    return;
                }
                ev.preventDefault(); ev.stopPropagation();
                var img = item.querySelector('img');
                var src = (img && (img.getAttribute('data-src') || img.src)) ? (img.getAttribute('data-src') || img.src) : '';
                if (src) openFotograflarimLightbox(src);
            });
        }
        function openFotograflarimLightbox(src) {
            var lb = document.getElementById('fotograflarimLightbox');
            var lbImg = document.getElementById('fotograflarimLightboxImg');
            if (lb && lbImg) { lbImg.src = src; lb.style.display = 'flex'; }
        }
        function closeFotograflarimLightbox(ev) {
            if (ev && ev.target && ev.target.id === 'fotograflarimLightboxImg') return;
            var lb = document.getElementById('fotograflarimLightbox');
            if (lb) lb.style.display = 'none';
        }
        window.closeFotograflarimLightbox = closeFotograflarimLightbox;
        async function deleteFotograflarimMedia(postId, mediaUrl) {
            if (!postId || !mediaUrl || !confirm('Bu fotoğrafı silmek istediğinize emin misiniz?')) return;
            try {
                var ref = db.collection('userPosts').doc(postId);
                var snap = await ref.get();
                if (!snap.exists) { loadFotograflarimContent(); return; }
                var data = snap.data();
                var urls = normalizeMediaUrlsField(data.mediaUrls).filter(function(u) { return u !== mediaUrl; });
                await ref.update({ mediaUrls: urls });
                loadFotograflarimContent();
            } catch (e) {
                console.error(e);
                alert('Silinirken hata: ' + (e.message || ''));
            }
        }

        function openBegendiklerimModal() {
            var user = auth.currentUser;
            if (!user) { alert('Beğendiklerinizi görmek için giriş yapın.'); return; }
            document.getElementById('begendiklerimModal').classList.add('open');
            document.getElementById('begendiklerimModal').style.display = 'flex';
            loadBegendiklerimFeed();
        }
        function closeBegendiklerimModal() {
            document.getElementById('begendiklerimModal').classList.remove('open');
            document.getElementById('begendiklerimModal').style.display = 'none';
        }
        function reactionStorageKey(uid, type) {
            return 'finanssepeti:' + String(type || 'liked') + ':' + String(uid || '');
        }
        function getLocalReactionSet(uid, type) {
            var set = new Set();
            if (!uid) return set;
            try {
                var raw = localStorage.getItem(reactionStorageKey(uid, type));
                var arr = raw ? JSON.parse(raw) : [];
                if (Array.isArray(arr)) arr.forEach(function(v) { if (v) set.add(v); });
            } catch (e) {}
            return set;
        }
        function saveLocalReactionSet(uid, type, setObj) {
            if (!uid) return;
            try { localStorage.setItem(reactionStorageKey(uid, type), JSON.stringify(Array.from(setObj || []))); } catch (e) {}
        }
        function reactionTimeStorageKey(uid, type) {
            return 'finanssepeti:' + String(type || 'liked') + ':time:' + String(uid || '');
        }
        function getLocalReactionTimeMap(uid, type) {
            var out = {};
            if (!uid) return out;
            try {
                var raw = localStorage.getItem(reactionTimeStorageKey(uid, type));
                var obj = raw ? JSON.parse(raw) : {};
                if (obj && typeof obj === 'object') out = obj;
            } catch (e) {}
            return out;
        }
        function saveLocalReactionTimeMap(uid, type, mapObj) {
            if (!uid) return;
            try { localStorage.setItem(reactionTimeStorageKey(uid, type), JSON.stringify(mapObj || {})); } catch (e) {}
        }
        async function ensureReactionProfile(user) {
            if (!user || !db) return null;
            try {
                var snap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!snap.empty) return { ref: snap.docs[0].ref, data: snap.docs[0].data() || {} };
                var base = { userId: user.uid, email: user.email || '', likedPostIds: [], favoritePostIds: [] };
                var ref = await db.collection('userProfiles').add(base);
                return { ref: ref, data: base };
            } catch (e) { return null; }
        }
        async function getReactionFallbackSets(user) {
            var out = { liked: new Set(), favorite: new Set() };
            if (!user || !user.uid) return out;
            out.liked = getLocalReactionSet(user.uid, 'liked');
            out.favorite = getLocalReactionSet(user.uid, 'favorite');
            var prof = await ensureReactionProfile(user);
            if (!prof || !prof.data) return out;
            var liked = Array.isArray(prof.data.likedPostIds) ? prof.data.likedPostIds : [];
            var fav = Array.isArray(prof.data.favoritePostIds) ? prof.data.favoritePostIds : [];
            liked.forEach(function(v) { if (v) out.liked.add(v); });
            fav.forEach(function(v) { if (v) out.favorite.add(v); });
            saveLocalReactionSet(user.uid, 'liked', out.liked);
            saveLocalReactionSet(user.uid, 'favorite', out.favorite);
            return out;
        }
        async function getReactionCountMap(collectionName, postIds) {
            var out = {};
            if (!postIds || !postIds.length) return out;
            var clean = postIds.filter(function(v) { return !!v; });
            for (var i = 0; i < clean.length; i += 10) {
                var chunk = clean.slice(i, i + 10);
                try {
                    var snap = await db.collection(collectionName).where('postId', 'in', chunk).get();
                    snap.docs.forEach(function(d) {
                        var pid = d.data().postId;
                        if (!pid) return;
                        out[pid] = (out[pid] || 0) + 1;
                    });
                } catch (e) {}
            }
            return out;
        }
        async function loadBegendiklerimFeed() {
            var user = auth.currentUser;
            var listEl = document.getElementById('begendiklerimList');
            if (!user) { listEl.innerHTML = ''; return; }
            listEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var likeSnap = await db.collection('postLikes').where('userId','==',user.uid).get();
                var postIds = likeSnap.docs.map(function(d){ return d.data().postId; });
                var fallbackSets = await getReactionFallbackSets(user);
                fallbackSets.liked.forEach(function(pid) { if (postIds.indexOf(pid) === -1) postIds.push(pid); });
                if (postIds.length === 0) { listEl.innerHTML = '<div class="friends-empty">Henüz beğendiğiniz paylaşım yok.</div>'; return; }
                var likedAtMap = {};
                likeSnap.docs.forEach(function(d) {
                    var dd = d.data() || {};
                    var pid = dd.postId;
                    if (!pid) return;
                    var t = 0;
                    if (dd.createdAt && dd.createdAt.toMillis) t = dd.createdAt.toMillis();
                    else if (dd.createdAtMs) t = Number(dd.createdAtMs) || 0;
                    if (!likedAtMap[pid] || t > likedAtMap[pid]) likedAtMap[pid] = t;
                });
                var localLikedAt = getLocalReactionTimeMap(user.uid, 'liked');
                Object.keys(localLikedAt).forEach(function(pid) {
                    if (!likedAtMap[pid] || Number(localLikedAt[pid]) > likedAtMap[pid]) likedAtMap[pid] = Number(localLikedAt[pid]) || 0;
                });
                var favSnap = await db.collection('postFavorites').where('userId','==',user.uid).get();
                var favSet = new Set(favSnap.docs.map(function(d){ return d.data().postId; }));
                fallbackSets.favorite.forEach(function(pid) { favSet.add(pid); });
                var likeCountMap = await getReactionCountMap('postLikes', postIds);
                var favCountMap = await getReactionCountMap('postFavorites', postIds);
                var posts = [];
                for (var i = 0; i < postIds.length; i++) {
                    var doc = await db.collection('userPosts').doc(postIds[i]).get();
                    if (!doc.exists) continue;
                    var data = doc.data();
                    data.id = doc.id;
                    var authorId = data.userId;
                    var profSnap = await db.collection('userProfiles').where('userId','==',authorId).limit(1).get();
                    if (!profSnap.empty) {
                        var p = profSnap.docs[0].data();
                        data.userName = p.adSoyad || data.userName || 'İsimsiz';
                        data.userPhotoUrl = p.photoUrl || data.userPhotoUrl || '';
                    } else {
                        data.userName = data.userName || 'İsimsiz';
                        data.userPhotoUrl = data.userPhotoUrl || '';
                    }
                    data.likeCount = likeCountMap[data.id] || Number(data.likeCount || 0);
                    data.favoriteCount = favCountMap[data.id] || Number(data.favoriteCount || 0);
                    if (fallbackSets.liked.has(data.id) && data.likeCount <= 0) data.likeCount = 1;
                    data._reactionAt = likedAtMap[data.id] || 0;
                    posts.push(data);
                }
                posts.sort(function(a,b){ return Number(b._reactionAt || 0) - Number(a._reactionAt || 0); });
                listEl.innerHTML = '';
                for (var j = 0; j < posts.length; j++) {
                    var postData = posts[j];
                    var postId = postData.id;
                    var card = renderYorumPostCard(postId, postData, true, favSet.has(postId));
                    card.setAttribute('data-list-context', 'liked');
                    listEl.appendChild(card);
                }
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>';
            }
        }

        function openFavorilerimModal() {
            var user = auth.currentUser;
            if (!user) { alert('Favorilerinizi görmek için giriş yapın.'); return; }
            document.getElementById('favorilerimModal').classList.add('open');
            document.getElementById('favorilerimModal').style.display = 'flex';
            loadFavorilerimFeed();
        }
        function closeFavorilerimModal() {
            document.getElementById('favorilerimModal').classList.remove('open');
            document.getElementById('favorilerimModal').style.display = 'none';
        }

        function formatMeetingId(num) {
            var s = String(num).replace(/\D/g, '');
            if (s.length >= 10) s = s.substring(0, 10);
            if (s.length <= 3) return s;
            if (s.length <= 6) return s.substring(0, 3) + ' ' + s.substring(3);
            return s.substring(0, 3) + ' ' + s.substring(3, 6) + ' ' + s.substring(6, 10);
        }
        function openToplantilarimModal() {
            var modal = document.getElementById('toplantilarimModal');
            if (!modal) return;
            modal.classList.add('open');
            modal.style.display = 'flex';
            var user = auth.currentUser;
            var nameEl = document.getElementById('toplantilarimUserName');
            var avatarEl = document.getElementById('toplantilarimAvatar');
            var placeholderEl = document.getElementById('toplantilarimAvatarPlaceholder');
            var pmidEl = document.getElementById('toplantilarimPMID');
            if (pmidEl) pmidEl.textContent = user ? '...' : '—';
            if (nameEl) nameEl.textContent = user && user.displayName ? user.displayName : 'Kullanıcı';
            if (user && user.photoURL && avatarEl) {
                avatarEl.src = user.photoURL;
                avatarEl.style.display = 'block';
                if (placeholderEl) placeholderEl.style.display = 'none';
            }
            if (user && typeof db !== 'undefined') {
                db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                    var data = snap.empty ? null : snap.docs[0].data();
                    var docRef = snap.empty ? null : snap.docs[0].ref;
                    if (!snap.empty && nameEl) nameEl.textContent = (data && data.adSoyad) ? data.adSoyad : nameEl.textContent;
                    var photo = (data && data.photoUrl) ? data.photoUrl : '';
                    if (photo && avatarEl) { avatarEl.src = photo; avatarEl.style.display = 'block'; if (placeholderEl) placeholderEl.style.display = 'none'; }
                    var meetingId = (data && data.personalMeetingId) ? data.personalMeetingId : null;
                    if (!meetingId) {
                        meetingId = String(Math.floor(1000000000 + Math.random() * 9000000000)).substring(0, 10);
                        var update = { personalMeetingId: meetingId };
                        if (docRef) {
                            docRef.update(update).then(function() {
                                if (pmidEl) pmidEl.textContent = formatMeetingId(meetingId);
                            });
                        } else {
                            update.userId = user.uid;
                            db.collection('userProfiles').add(update).then(function() {
                                incrementTotalMemberCount();
                                if (pmidEl) pmidEl.textContent = formatMeetingId(meetingId);
                            });
                        }
                    } else {
                        if (pmidEl) pmidEl.textContent = formatMeetingId(meetingId);
                    }
                });
            }
            var copyBtn = document.getElementById('toplantilarimCopyPMID');
            if (copyBtn && !copyBtn._bound) {
                copyBtn._bound = true;
                copyBtn.addEventListener('click', function() {
                    var el = document.getElementById('toplantilarimPMID');
                    var text = (el && el.textContent) ? el.textContent.replace(/\s/g, '') : '';
                    if (text && text !== '...' && text !== '—' && navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(function() { alert('Toplantı kimliği kopyalandı.'); }).catch(function() { alert('Kopyalama desteklenmiyor.'); });
                    } else if (text && text !== '...' && text !== '—') { alert('Toplantı kimliği: ' + text); }
                });
            }
            var hostBtn = document.getElementById('toplantilarimHostBtn');
            if (hostBtn && !hostBtn._hostBound) {
                hostBtn._hostBound = true;
                hostBtn.addEventListener('click', function() {
                    if (typeof openOturumSahibiToplanti === 'function') openOturumSahibiToplanti();
                });
            }
        }
        function closeToplantilarimModal() {
            var modal = document.getElementById('toplantilarimModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        function openKatilPencere() {
            var m = document.getElementById('toplantiKatilModal');
            if (m) { m.classList.add('open'); m.style.display = 'flex'; }
            var inp = document.getElementById('toplantiKatilRoomInput');
            var pwd = document.getElementById('toplantiKatilPasswordInput');
            if (inp) inp.value = '';
            if (pwd) pwd.value = '';
        }
        function closeToplantiKatilModal() {
            var m = document.getElementById('toplantiKatilModal');
            if (m) { m.classList.remove('open'); m.style.display = 'none'; }
        }
        function submitToplantiKatil() {
            var inp = document.getElementById('toplantiKatilRoomInput');
            var pwd = document.getElementById('toplantiKatilPasswordInput');
            var roomRaw = (inp && inp.value) ? inp.value.trim() : '';
            var roomId = roomRaw.replace(/\s/g, '');
            if (!roomId) { alert('Toplantı odası kimliğini veya bağlantı adını girin (örn. FinansSepeti-xxx).'); return; }
            if (roomId.indexOf('FinansSepeti-') !== 0) roomId = 'FinansSepeti-' + roomId;
            var password = (pwd && pwd.value) ? pwd.value.trim() : '';
            closeToplantiKatilModal();
            openMeetingInvite(roomId, false, { password: password, isLiveStream: false });
        }
        async function openOturumSahibiToplanti() {
            var user = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || null;
            var database = (typeof db !== 'undefined' && db) ? db : (typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore()) || null;
            if (!user) { alert('Toplantı odasını açmak için giriş yapın.'); return; }
            if (!database) { alert('Veritabanı hazır değil. Sayfayı yenileyip tekrar deneyin.'); return; }
            try {
                var snap = await database.collection('userMeetings').where('userId', '==', user.uid).get();
                if (snap.empty) { alert('Henüz oluşturduğunuz bir toplantı yok. Önce Planlama ile toplantı oluşturun.'); return; }
                var docs = snap.docs.slice();
                docs.sort(function(a, b) { var ta = (a.data().createdAt && a.data().createdAt.toMillis) ? a.data().createdAt.toMillis() : 0; var tb = (b.data().createdAt && b.data().createdAt.toMillis) ? b.data().createdAt.toMillis() : 0; return tb - ta; });
                var doc = docs[0];
                var data = doc.data();
                var roomId = data.roomId || ('FinansSepeti-' + doc.id);
                var beklemeOdasi = !!data.beklemeOdasi;
                if (typeof openMeetingInvite === 'function') {
                    openMeetingInvite(roomId, true, { enableLobby: beklemeOdasi, isLiveStream: false });
                } else {
                    alert('Toplantı modülü yüklenmedi. Sayfayı yenileyin.');
                }
            } catch (e) {
                console.error(e);
                alert('Toplantı bilgisi yüklenemedi. Tekrar deneyin.');
            }
        }
        window.openOturumSahibiToplanti = openOturumSahibiToplanti;
        var jitsiMeetingApi = null;
        async function loadJitsiDavetlilerPanel(roomId) {
            var listEl = document.getElementById('jitsiDavetlilerList');
            if (!listEl || !roomId || typeof db === 'undefined') return;
            listEl.innerHTML = '<div class="jitsi-invite-sidebar-desc" style="padding:8px 0;">Yükleniyor...</div>';
            try {
                var snap = await db.collection('meetingInvites').where('roomId', '==', roomId).get();
                var byUser = {};
                (snap.docs || []).forEach(function(d) {
                    var dta = d.data();
                    var uid = dta.toUserId;
                    if (uid && !byUser[uid]) byUser[uid] = { toUserId: uid, docId: d.id, konu: dta.konu, tarih: dta.tarih, saat: dta.saat };
                });
                var userIds = Object.keys(byUser);
                if (userIds.length === 0) {
                    listEl.innerHTML = '<div class="jitsi-invite-sidebar-desc" style="padding:8px 0;">Bu toplantıya davet edilen kimse yok.</div>';
                    return;
                }
                var names = {};
                var profSnap = await db.collection('userProfiles').get();
                profSnap.docs.forEach(function(d) {
                    var dta = d.data();
                    var uid = dta.userId;
                    if (uid) names[uid] = (dta.adSoyad || dta.kullaniciAdi || '').trim() || (dta.email || '').trim() || 'Kullanıcı';
                });
                listEl.innerHTML = '';
                userIds.forEach(function(uid) {
                    var label = names[uid] || uid || 'Kullanıcı';
                    var div = document.createElement('div');
                    div.className = 'jitsi-davetli-item';
                    var span = document.createElement('span');
                    span.className = 'jitsi-davetli-label';
                    span.textContent = label;
                    var btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'jitsi-davetli-ekle-btn';
                    btn.setAttribute('data-to-user-id', uid);
                    btn.setAttribute('data-room-id', roomId);
                    btn.innerHTML = '<i class="fas fa-user-plus"></i> Ekle';
                    btn.onclick = function() { jitsiDavetliEkle(uid, roomId); };
                    div.appendChild(span);
                    div.appendChild(btn);
                    listEl.appendChild(div);
                });
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="jitsi-invite-sidebar-desc" style="padding:8px 0;color:#f87171;">Liste yüklenemedi.</div>';
            }
        }
        window.loadJitsiDavetlilerPanel = loadJitsiDavetlilerPanel;
        async function jitsiDavetliEkle(toUserId, roomId) {
            if (!toUserId || !roomId || typeof db === 'undefined' || !auth || !auth.currentUser) return;
            var user = auth.currentUser;
            var fromUserName = user.displayName || (user.email ? user.email.split('@')[0] : '') || 'Kullanıcı';
            var fromUserPhotoUrl = user.photoURL || '';
            try {
                var orgSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!orgSnap.empty) { var o = orgSnap.docs[0].data(); fromUserName = (o.adSoyad || o.kullaniciAdi || fromUserName).trim() || fromUserName; fromUserPhotoUrl = o.photoUrl || fromUserPhotoUrl; }
            } catch (e) {}
            try {
                await db.collection('meetingInvites').add({
                    toUserId: toUserId,
                    fromUserId: user.uid,
                    fromUserName: fromUserName,
                    fromUserPhotoUrl: fromUserPhotoUrl,
                    roomId: roomId,
                    konu: 'Toplantıya katıl',
                    tarih: '',
                    saat: '',
                    aciklama: 'Oturum sahibi sizi toplantı odasına davet etti. Katıl butonuna tıklayın.',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                var listEl = document.getElementById('jitsiDavetlilerList');
                if (listEl) {
                    var btn = listEl.querySelector('.jitsi-davetli-ekle-btn[data-to-user-id="' + toUserId + '"]');
                    if (btn) { btn.innerHTML = '<i class="fas fa-check"></i> Gönderildi'; btn.disabled = true; btn.classList.add('jitsi-davetli-ekle-sent'); }
                }
            } catch (e) {
                console.error(e);
                alert('Davet gönderilemedi. Tekrar deneyin.');
            }
        }
        window.jitsiDavetliEkle = jitsiDavetliEkle;
        function openMeetingInvite(roomId, isBroadcaster, options) {
            if (!roomId) return;
            options = options || {};
            var room = String(roomId).replace(/[^a-zA-Z0-9\-]/g, '') || 'FinansSepetiMeeting';
            if (closeJitsiMeetingModal) closeJitsiMeetingModal();
            var modal = document.getElementById('jitsiMeetingModal');
            var container = document.getElementById('jitsiEmbedContainer');
            var labelEl = document.getElementById('jitsiMeetingRoomLabel');
            if (!modal || !container) return;
            if (labelEl) labelEl.textContent = 'Oda: ' + room;
            modal.classList.add('open');
            modal.style.display = 'flex';
            var jitsiInviteInput = document.getElementById('jitsiInviteAramaInput');
            var jitsiInviteList = document.getElementById('jitsiInviteSonucList');
            if (jitsiInviteInput) jitsiInviteInput.value = '';
            if (jitsiInviteList) jitsiInviteList.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:12px;font-size:13px;color:#94a3b8;">@kullaniciadi, ad soyad veya e-posta ile ara. Davet Gönder ile bildirim gider.</div>';
            var jitsiMesajPanel = document.getElementById('jitsiCanliYayinMesajPanel');
            if (jitsiMesajPanel) jitsiMesajPanel.style.display = 'none';
            window.currentJitsiRoomId = room;
            window.currentJitsiIsBroadcaster = !!isBroadcaster;
            var jitsiInviteSection = document.getElementById('jitsiInviteSection');
            if (jitsiInviteSection) jitsiInviteSection.style.display = (!!isBroadcaster) ? '' : 'none';
            var jitsiDavetlilerSection = document.getElementById('jitsiDavetlilerSection');
            var isMeetingHost = !!isBroadcaster && !options.isLiveStream;
            if (jitsiDavetlilerSection) jitsiDavetlilerSection.style.display = isMeetingHost ? '' : 'none';
            if (isMeetingHost && typeof loadJitsiDavetlilerPanel === 'function') loadJitsiDavetlilerPanel(room);
            var sohbetList = document.getElementById('jitsiYayinSohbetList');
            var sohbetInput = document.getElementById('jitsiYayinSohbetInput');
            if (sohbetList) sohbetList.innerHTML = '';
            if (sohbetInput) sohbetInput.value = '';
            var sohbetSection = document.getElementById('jitsiYayinSohbetSection');
            if (sohbetSection) sohbetSection.style.display = '';
            if (typeof startJitsiYayinSohbetListener === 'function') startJitsiYayinSohbetListener(room);
            var origin = window.location.origin;
            var pathDir = (window.location.pathname || '/').replace(/[^/]*$/, '') || '/';
            var newUrl = origin + pathDir.replace(/\/$/, '') + '/?room=' + encodeURIComponent(room) + '#canli-yayin';
            if (typeof history !== 'undefined' && history.pushState) history.pushState({ canliYayin: true, room: room }, '', newUrl);
            var jitsiDomain = (typeof window.JITSI_MEET_DOMAIN === 'string' && window.JITSI_MEET_DOMAIN) ? window.JITSI_MEET_DOMAIN : 'meet.jit.si';
            var jitsiRetriedWithInit7 = (openMeetingInvite._retriedInit7 === true);
            var isLiveStream = options.isLiveStream !== false && !!isBroadcaster;
            var meetingPassword = options.password || '';
            var enableLobby = !!options.enableLobby;
            if (typeof JitsiMeetExternalAPI !== 'undefined') {
                try {
                    container.innerHTML = '';
                    var displayName = (auth.currentUser && (auth.currentUser.displayName || auth.currentUser.email)) ? (auth.currentUser.displayName || auth.currentUser.email).split('@')[0] : 'Katilimci';
                    var isHost = !!isBroadcaster;
                    var res = window.preferredJitsiResolution || 720;
                    var config = {
                        startWithAudioMuted: false,
                        startWithVideoMuted: false,
                        prejoinPageEnabled: false,
                        enableWelcomePage: false,
                        enablePrejoin: false,
                        disableDeepLinking: true,
                        resolution: res
                    };
                    if (meetingPassword) config.password = meetingPassword;
                    if (enableLobby) config.enableLobby = true;
                    if (isLiveStream && isHost) {
                        config.lastN = 0;
                        config.disableFilmstrip = true;
                        config.startWithAudioMuted = false;
                        config.startWithVideoMuted = false;
                    }
                    var interfaceConfig = { SHOW_JITSI_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false };
                    var restrictGuest = isLiveStream && !isHost;
                    if (restrictGuest) {
                        config.toolbarButtons = ['hangup', 'chat'];
                        config.disableInviteFunctions = true;
                        interfaceConfig.TOOLBAR_BUTTONS = ['hangup', 'chat'];
                        interfaceConfig.SETTINGS_SECTIONS = [];
                        interfaceConfig.HIDE_INVITE_MORE_HEADER = true;
                    }
                    jitsiMeetingApi = new JitsiMeetExternalAPI(jitsiDomain, {
                        roomName: room,
                        subject: room,
                        width: '100%',
                        height: '100%',
                        parentNode: container,
                        configOverwrite: config,
                        interfaceConfigOverwrite: interfaceConfig,
                        userInfo: { displayName: displayName }
                    });
                    updateJitsiResolutionButtons(res);
                    jitsiMeetingApi.on('connectionFailed', function() {
                        if (container && !container.querySelector('iframe')) return;
                        if (!jitsiRetriedWithInit7 && jitsiDomain === 'meet.jit.si') {
                            openMeetingInvite._retriedInit7 = true;
                            if (jitsiMeetingApi && typeof jitsiMeetingApi.dispose === 'function') { try { jitsiMeetingApi.dispose(); } catch (e) {} jitsiMeetingApi = null; }
                            container.innerHTML = '';
                            window.JITSI_MEET_DOMAIN = 'meet.init7.net';
                            openMeetingInvite(roomId, isBroadcaster, options);
                            return;
                        }
                        var msg = document.createElement('p');
                        msg.style.cssText = 'color:#f87171;padding:20px;text-align:center;';
                        msg.textContent = 'Sunucu bağlantısı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
                        container.appendChild(msg);
                    });
                    window.jitsiParticipantsMap = {};
                    function renderJitsiOnlineList() {
                        var listEl = document.getElementById('jitsiOnlineList');
                        var countEl = document.getElementById('jitsiOnlineCount');
                        if (!listEl) return;
                        var map = window.jitsiParticipantsMap || {};
                        var ids = Object.keys(map);
                        if (countEl) countEl.textContent = ids.length;
                        listEl.innerHTML = '';
                        ids.forEach(function(id) {
                            var name = (map[id] || 'Katılımcı').replace(/</g, '&lt;');
                            var div = document.createElement('div');
                            div.className = 'jitsi-online-list-item';
                            div.innerHTML = '<i class="fas fa-circle"></i><span>' + name + '</span>';
                            listEl.appendChild(div);
                        });
                        if (ids.length === 0) listEl.innerHTML = '<div class="jitsi-invite-sidebar-desc" style="padding:8px 0;">Henüz kimse yok.</div>';
                    }
                    jitsiMeetingApi.on('participantJoined', function(ev) {
                        var p = (ev && ev.participant) ? ev.participant : ev;
                        var id = (p && p.id) ? String(p.id) : (p && p.jid ? String(p.jid) : '');
                        var name = (p && p.displayName) ? String(p.displayName) : (p && p.name ? String(p.name) : 'Katılımcı');
                        if (id) { window.jitsiParticipantsMap[id] = name; renderJitsiOnlineList(); }
                    });
                    jitsiMeetingApi.on('participantLeft', function(ev) {
                        var p = (ev && ev.participant) ? ev.participant : ev;
                        var id = (p && p.id) ? String(p.id) : (p && p.jid ? String(p.jid) : '');
                        if (id && window.jitsiParticipantsMap) { delete window.jitsiParticipantsMap[id]; renderJitsiOnlineList(); }
                    });
                    jitsiMeetingApi.on('videoConferenceJoined', function(ev) {
                        var p = (ev && ev.participant) ? ev.participant : ev;
                        var id = (p && p.id) ? String(p.id) : (p && p.jid ? String(p.jid) : '');
                        var name = (p && p.displayName) ? String(p.displayName) : (p && p.name ? String(p.name) : displayName);
                        if (id) { window.jitsiParticipantsMap[id] = name; renderJitsiOnlineList(); }
                        if (jitsiMeetingApi && typeof jitsiMeetingApi.getParticipantsInfo === 'function') {
                            try {
                                var infos = jitsiMeetingApi.getParticipantsInfo();
                                if (Array.isArray(infos)) infos.forEach(function(pi) { if (pi && pi.participantId) window.jitsiParticipantsMap[pi.participantId] = (pi.displayName || pi.name || 'Katılımcı'); });
                                renderJitsiOnlineList();
                            } catch (err) {}
                        }
                    });
                } catch (e) {
                    container.innerHTML = '<p style="color:#8fd3ff;padding:20px;">Oda açılamadı. Sayfayı yenileyin veya tekrar deneyin.</p>';
                }
            } else {
                container.innerHTML = '<p style="color:#8fd3ff;padding:20px;">Jitsi yükleniyor...</p>';
                var s = document.createElement('script');
                s.src = 'https://' + jitsiDomain + '/external_api.js';
                s.onload = function() { openMeetingInvite(roomId, isBroadcaster, options); };
                s.onerror = function() {
                    container.innerHTML = '<p style="color:#f87171;padding:20px;text-align:center;">Jitsi sunucusu yüklenemedi (Not found). Sayfayı yenileyin veya daha sonra tekrar deneyin.</p>';
                };
                document.head.appendChild(s);
            }
        }
        window.openMeetingInvite = openMeetingInvite;
        function closeJitsiMeetingModal() {
            if (jitsiMeetingApi && typeof jitsiMeetingApi.dispose === 'function') { try { jitsiMeetingApi.dispose(); } catch (e) {} jitsiMeetingApi = null; }
            window.jitsiParticipantsMap = {};
            var listEl = document.getElementById('jitsiOnlineList');
            var countEl = document.getElementById('jitsiOnlineCount');
            if (listEl) listEl.innerHTML = '';
            if (countEl) countEl.textContent = '0';
            var container = document.getElementById('jitsiEmbedContainer');
            if (container) container.innerHTML = '';
            var modal = document.getElementById('jitsiMeetingModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
            if (typeof jitsiSohbetUnsubscribe === 'function') { jitsiSohbetUnsubscribe(); jitsiSohbetUnsubscribe = null; }
            window.currentJitsiRoomId = null;
            if (typeof history !== 'undefined' && history.replaceState) history.replaceState({}, '', (window.location.pathname || '/') + (window.location.search || '').replace(/\?room=[^&]+&?|&?room=[^&]+/g, '').replace(/^&/, '?') || (window.location.pathname || '/'));
        }
        window.closeJitsiMeetingModal = closeJitsiMeetingModal;
        window.preferredJitsiResolution = 720;
        function updateJitsiResolutionButtons(activeRes) {
            var btns = document.querySelectorAll('.jitsi-resolution-btn');
            btns.forEach(function(btn) {
                var r = parseInt(btn.getAttribute('data-res'), 10);
                if (r === activeRes) btn.classList.add('active'); else btn.classList.remove('active');
            });
        }
        function setJitsiResolution(res) {
            if (res !== 480 && res !== 720 && res !== 1080) return;
            window.preferredJitsiResolution = res;
            updateJitsiResolutionButtons(res);
            if (jitsiMeetingApi && typeof jitsiMeetingApi.executeCommand === 'function') {
                try {
                    jitsiMeetingApi.executeCommand('overwriteConfig', { resolution: res });
                } catch (e) { console.warn('Çözünürlük güncellenemedi:', e); }
            }
        }
        var jitsiSohbetUnsubscribe = null;
        function startJitsiYayinSohbetListener(roomId) {
            if (!roomId) return;
            var firestore = (typeof db !== 'undefined' && db) ? db : (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null);
            if (!firestore) return;
            if (jitsiSohbetUnsubscribe) { jitsiSohbetUnsubscribe(); jitsiSohbetUnsubscribe = null; }
            var listEl = document.getElementById('jitsiYayinSohbetList');
            if (!listEl) return;
            listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:8px;font-size:12px;color:#94a3b8;">Sohbet yükleniyor...</div>';
            jitsiSohbetUnsubscribe = firestore.collection('liveStreamChat').where('roomId', '==', roomId).onSnapshot(function(snap) {
                if (!listEl) return;
                listEl.innerHTML = '';
                var docs = (snap.docs || []).slice();
                docs.sort(function(a, b) {
                    var ta = a.data().createdAt ? (a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0) : 0;
                    var tb = b.data().createdAt ? (b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0) : 0;
                    return ta - tb;
                });
                docs.forEach(function(doc) {
                    var d = doc.data();
                    var name = (d.fromUserName || 'Kullanıcı').replace(/</g, '&lt;');
                    var text = (d.text || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
                    var div = document.createElement('div');
                    div.className = 'jitsi-yayin-sohbet-msg';
                    div.innerHTML = '<div class="jitsi-yayin-sohbet-msg-name">' + name + '</div><div class="jitsi-yayin-sohbet-msg-text">' + text + '</div>';
                    listEl.appendChild(div);
                });
                if (docs.length === 0) listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:8px;font-size:12px;color:#94a3b8;">Henüz mesaj yok. İlk mesajı siz yazın.</div>';
                listEl.scrollTop = listEl.scrollHeight;
            }, function(err) {
                if (listEl) listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:8px;font-size:12px;color:#f87171;">Sohbet yüklenemedi. Giriş yaptığınızdan emin olun. Firebase Console → Firestore → Kurallar bölümünde liveStreamChat için read/write izni verin.</div>';
                console.error('Jitsi sohbet listener hatası:', err);
            });
        }
        async function jitsiYayinSohbetGonder() {
            var user = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
            var roomId = window.currentJitsiRoomId;
            var input = document.getElementById('jitsiYayinSohbetInput');
            if (!input) return;
            var text = (input.value || '').trim();
            if (!text) return;
            if (!user) { alert('Mesaj göndermek için giriş yapın.'); return; }
            if (!roomId) { alert('Oda bilgisi yok. Sayfayı yenileyip tekrar katılın.'); return; }
            var firestore = (typeof db !== 'undefined' && db) ? db : (typeof firebase !== 'undefined' && firebase.firestore) ? firebase.firestore() : null;
            if (!firestore) { alert('Veritabanı bağlantısı yok. Sayfayı yenileyin.'); return; }
            var fromUserName = user.displayName || (user.email ? user.email.split('@')[0] : '') || 'Katılımcı';
            var fromUserPhotoUrl = user.photoURL || '';
            input.value = '';
            try {
                var profSnap = await firestore.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!profSnap.empty) { var p = profSnap.docs[0].data(); fromUserName = p.adSoyad || p.username || fromUserName; fromUserPhotoUrl = p.photoUrl || fromUserPhotoUrl; }
                await firestore.collection('liveStreamChat').add({
                    roomId: roomId,
                    fromUserId: user.uid,
                    fromUserName: fromUserName,
                    fromUserPhotoUrl: fromUserPhotoUrl,
                    text: text,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) {
                console.error('Sohbet gönderim hatası:', e);
                if (input) input.value = text;
                var msg = 'Mesaj gönderilemedi.';
                if (e && e.code === 'permission-denied') msg = 'Mesaj gönderilemedi: Yetki hatası. Firebase Console → Firestore → Kurallar\'da liveStreamChat için allow read, write: if request.auth != null; ekleyin.';
                else if (e && e.message) msg = 'Mesaj gönderilemedi: ' + (e.message || '').substring(0, 80);
                alert(msg);
            }
        }
        window.jitsiYayinSohbetGonder = jitsiYayinSohbetGonder;

        /* ---------- CANLI YAYINLARIM ---------- */
        var currentCanliYayinRoomId = null;
        var canliYayinAramaTimer = null;
        function openCanliYayinlarimModal(fromInvitePage) {
            var user = auth.currentUser;
            if (!user) { alert('Canlı yayın için giriş yapın.'); return; }
            if (typeof db === 'undefined') { alert('Veritabanı hazır değil.'); return; }
            if (!currentCanliYayinRoomId) currentCanliYayinRoomId = 'Canli-' + user.uid + '-' + Date.now();
            var modal = document.getElementById('canliYayinlarimModal');
            var uyariEl = document.getElementById('canliYayinUyari');
            if (uyariEl) uyariEl.style.display = 'block';
            if (modal) { modal.classList.add('open'); modal.style.display = 'flex'; }
            canliYayinMesajTargetUserId = null;
        }
        function closeCanliYayinlarimModal() {
            var modal = document.getElementById('canliYayinlarimModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        async function canliYayinAra() {
            var q = (document.getElementById('canliYayinAramaInput') && document.getElementById('canliYayinAramaInput').value) || '';
            q = q.trim().toLowerCase();
            var listEl = document.getElementById('canliYayinAramaSonucList');
            var user = auth.currentUser;
            if (!listEl || !user || typeof db === 'undefined') return;
            if (q.length < 2) {
                listEl.innerHTML = '<div class="canli-yayinlarim-empty">En az 2 karakter yazın.</div>';
                return;
            }
            listEl.innerHTML = '<div class="canli-yayinlarim-empty">Aranıyor...</div>';
            try {
                var snap = await db.collection('userProfiles').limit(150).get();
                var matches = [];
                snap.docs.forEach(function(doc) {
                    var d = doc.data();
                    var uid = d.userId;
                    if (uid === user.uid) return;
                    var un = (d.username || '').toLowerCase();
                    var ad = (d.adSoyad || '').toLowerCase();
                    var em = (d.email || '').toLowerCase();
                    if (un.indexOf(q) >= 0 || ad.indexOf(q) >= 0 || em.indexOf(q) >= 0) matches.push({ userId: uid, username: d.username, adSoyad: d.adSoyad, email: d.email, photoUrl: d.photoUrl || '' });
                });
                listEl.innerHTML = '';
                if (matches.length === 0) { listEl.innerHTML = '<div class="canli-yayinlarim-empty">Sonuç bulunamadı.</div>'; return; }
                matches.forEach(function(m) {
                    var div = document.createElement('div');
                    div.className = 'canli-yayinlarim-sonuc-item';
                    var name = (m.adSoyad || m.username || m.email || 'Kullanıcı').replace(/</g, '&lt;');
                    var meta = [m.username ? '@' + String(m.username).replace(/</g, '&lt;') : '', m.email || ''].filter(Boolean).join(' · ');
                    var uid = m.userId.replace(/'/g, "\\'");
                    var nameSafe = (m.adSoyad || m.username || m.email || 'Kullanıcı').replace(/"/g, '&quot;');
                    div.innerHTML = '<img src="' + (m.photoUrl || '').replace(/"/g, '&quot;') + '" onerror="this.style.display=\'none\'" alt=""><div class="canli-yayinlarim-sonuc-item-body"><div class="canli-yayinlarim-sonuc-item-name">' + name + '</div><div class="canli-yayinlarim-sonuc-item-meta">' + meta.replace(/</g, '&lt;') + '</div></div><div class="canli-yayinlarim-sonuc-btns"><button type="button" class="canli-yayinlarim-mesaj-btn" data-mesaj-uid="' + uid + '" data-mesaj-name="' + nameSafe + '" onclick="canliYayinMesajAt(this)">Mesaj at</button><button type="button" class="canli-yayinlarim-davet-btn" onclick="canliYayinDavetGonder(\'' + uid + '\')">Davet Gönder</button></div>';
                    listEl.appendChild(div);
                });
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="canli-yayinlarim-empty">Arama sırasında hata oluştu.</div>';
            }
        }
        var canliYayinMesajTargetUserId = null;
        function canliYayinMesajAt(btnEl) {
            if (!btnEl || !btnEl.getAttribute) return;
            var toUserId = btnEl.getAttribute('data-mesaj-uid');
            var toUserName = (btnEl.getAttribute('data-mesaj-name') || '').replace(/&quot;/g, '"') || 'Seçilen';
            canliYayinMesajTargetUserId = toUserId;
            var panel = document.getElementById('canliYayinMesajPanel');
            var label = document.getElementById('canliYayinMesajKisiAdi');
            var ta = document.getElementById('canliYayinMesajText');
            if (label) label.textContent = toUserName;
            if (ta) {
                var base = window.location.origin + (window.location.pathname || '/').replace(/[^/]*$/, '') || '/';
                var link = base.replace(/\/$/, '') + '/?room=' + encodeURIComponent(currentCanliYayinRoomId || '') + '#canli-yayin';
                ta.value = currentCanliYayinRoomId ? ('Canlı yayına davet: ' + link) : '';
                ta.placeholder = 'Toplantı linkini buraya yapıştırın veya metin yazın...';
            }
            if (panel) panel.style.display = 'block';
        }
        function canliYayinMesajPanelKapat() {
            canliYayinMesajTargetUserId = null;
            var panel = document.getElementById('canliYayinMesajPanel');
            var ta = document.getElementById('canliYayinMesajText');
            if (panel) panel.style.display = 'none';
            if (ta) ta.value = '';
        }
        async function canliYayinMesajGonder() {
            var user = auth.currentUser;
            if (!user || !canliYayinMesajTargetUserId || typeof db === 'undefined') return;
            var ta = document.getElementById('canliYayinMesajText');
            var text = (ta && ta.value && ta.value.trim()) || '';
            if (!text) { alert('Mesaj yazın veya toplantı linkini yapıştırın.'); return; }
            try {
                await db.collection('messages').add({
                    fromUserId: user.uid,
                    toUserId: canliYayinMesajTargetUserId,
                    text: text,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    read: false
                });
                if (typeof refreshMessagesBadge === 'function') refreshMessagesBadge();
                canliYayinMesajPanelKapat();
                alert('Mesaj gönderildi.');
            } catch (e) { console.error(e); alert('Mesaj gönderilemedi.'); }
        }
        async function canliYayinDavetGonder(toUserId) {
            if (!toUserId) return;
            var user = auth.currentUser;
            if (!user || typeof db === 'undefined') {
                alert('Giriş yapın ve sayfayı yenileyin.');
                return;
            }
            if (toUserId === user.uid) return;
            var fromUserName = user.displayName || 'Kullanıcı';
            var fromUserPhotoUrl = user.photoURL || '';
            try {
                var orgSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!orgSnap.empty) { var o = orgSnap.docs[0].data(); fromUserName = o.adSoyad || fromUserName; fromUserPhotoUrl = o.photoUrl || fromUserPhotoUrl; }
                var roomId = window.currentJitsiRoomId || currentCanliYayinRoomId;
                if (window.currentJitsiRoomId) {
                    await db.collection('meetingInvites').add({
                        toUserId: toUserId,
                        fromUserId: user.uid,
                        fromUserName: fromUserName,
                        fromUserPhotoUrl: fromUserPhotoUrl,
                        roomId: roomId,
                        konu: 'Toplantıya katıl',
                        tarih: '',
                        saat: '',
                        aciklama: 'Sizi toplantı odasına davet etti. Bildirimlere tıklayıp Katıl ile görüntülü/sesli katılabilirsiniz.',
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                    alert('Davet gönderildi. Kişi Bildirimler\'e girip toplantı bildirimine tıklayarak odanıza katılabilir (mikrofon ve kamera açık).');
                } else if (currentCanliYayinRoomId) {
                    await db.collection('liveStreamInvites').add({
                        toUserId: toUserId,
                        fromUserId: user.uid,
                        fromUserName: fromUserName,
                        fromUserPhotoUrl: fromUserPhotoUrl,
                        roomId: currentCanliYayinRoomId,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                    alert('Davet gönderildi. Kişi Bildirimler bölümünden canlı yayına katılabilir.');
                } else {
                    alert('Önce toplantı odasını açın (Oturum Sahibi) veya canlı yayın başlatın.');
                }
            } catch (e) { console.error(e); alert('Davet gönderilemedi.'); }
        }
        window.canliYayinDavetGonder = canliYayinDavetGonder;
        async function canliYayinTakipcilerimeDavet() {
            var user = auth.currentUser;
            if (!user || !currentCanliYayinRoomId || typeof db === 'undefined') return;
            var btn = document.getElementById('canliYayinTakipcilerimeDavetBtn');
            var jitsiDavetBtn = document.getElementById('jitsiTakipcilerimeDavetBtn');
            if (btn) btn.disabled = true;
            if (jitsiDavetBtn) jitsiDavetBtn.disabled = true;
            try {
                var snap = await db.collection('friendRequests').where('toUserId', '==', user.uid).where('status', '==', 'accepted').get();
                var fromUserName = user.displayName || 'Kullanıcı';
                var fromUserPhotoUrl = user.photoURL || '';
                var orgSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!orgSnap.empty) { var o = orgSnap.docs[0].data(); fromUserName = o.adSoyad || fromUserName; fromUserPhotoUrl = o.photoUrl || fromUserPhotoUrl; }
                var count = 0;
                for (var i = 0; i < snap.docs.length; i++) {
                    var toUserId = snap.docs[i].data().fromUserId;
                    if (toUserId === user.uid) continue;
                    await db.collection('liveStreamInvites').add({
                        toUserId: toUserId,
                        fromUserId: user.uid,
                        fromUserName: fromUserName,
                        fromUserPhotoUrl: fromUserPhotoUrl,
                        roomId: currentCanliYayinRoomId,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }
                if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                alert('Takipçilerinize davet gönderildi. (' + count + ' kişi)');
            } catch (e) { console.error(e); alert('Davetler gönderilemedi.'); }
            var jitsiDavetBtn = document.getElementById('jitsiTakipcilerimeDavetBtn');
            if (jitsiDavetBtn) jitsiDavetBtn.disabled = false;
            if (btn) btn.disabled = false;
        }
        var canliYayinAramaTimerJitsi = null;
        async function canliYayinAraJitsiSidebar() {
            var q = (document.getElementById('jitsiInviteAramaInput') && document.getElementById('jitsiInviteAramaInput').value) || '';
            q = q.trim().toLowerCase();
            if (q.indexOf('@') === 0) q = q.substring(1);
            var listEl = document.getElementById('jitsiInviteSonucList');
            var user = auth.currentUser;
            if (!listEl || !user || typeof db === 'undefined') return;
            if (q.length < 1) {
                listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:12px;font-size:13px;color:#94a3b8;">@kullaniciadi, ad soyad veya e-posta yazın.</div>';
                return;
            }
            listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:12px;font-size:13px;color:#94a3b8;">Aranıyor...</div>';
            try {
                var snap = await db.collection('userProfiles').limit(500).get();
                var words = q.split(/\s+/).filter(function(w) { return w.length > 0; });
                var matches = [];
                snap.docs.forEach(function(doc) {
                    var d = doc.data();
                    var uid = d.userId;
                    if (uid === user.uid) return;
                    var un = (d.username || '').toLowerCase();
                    var ad = (d.adSoyad || '').toLowerCase();
                    var em = (d.email || '').toLowerCase();
                    var disp = (d.displayName || '').toLowerCase();
                    var allText = un + ' ' + ad + ' ' + em + ' ' + disp;
                    var match = words.length > 0 && words.every(function(w) { return allText.indexOf(w) >= 0; });
                    if (match) matches.push({ userId: uid, username: d.username, adSoyad: d.adSoyad, email: d.email, photoUrl: d.photoUrl || '' });
                });
                matches.sort(function(a, b) {
                    var au = (a.username || '').toLowerCase();
                    var bu = (b.username || '').toLowerCase();
                    var aExact = (au === q) ? 1 : 0;
                    var bExact = (bu === q) ? 1 : 0;
                    if (bExact !== aExact) return bExact - aExact;
                    return 0;
                });
                listEl.innerHTML = '';
                if (matches.length === 0) { listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:12px;font-size:13px;color:#94a3b8;">Sonuç bulunamadı. @kullaniciadi, ad soyad veya e-posta ile deneyin.</div>'; return; }
                matches.forEach(function(m) {
                    if (!m.userId) return;
                    var div = document.createElement('div');
                    div.className = 'canli-yayinlarim-sonuc-item jitsi-invite-row';
                    div.setAttribute('data-user-id', m.userId);
                    var name = (m.adSoyad || m.username || m.email || 'Kullanıcı').replace(/</g, '&lt;');
                    var meta = [m.username ? '@' + String(m.username).replace(/</g, '&lt;') : '', m.email || ''].filter(Boolean).join(' · ');
                    var nameSafe = (m.adSoyad || m.username || m.email || 'Kullanıcı').replace(/"/g, '&quot;');
                    var safeUid = (m.userId || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
                    div.innerHTML = '<img src="' + (m.photoUrl || '').replace(/"/g, '&quot;') + '" onerror="this.style.display=\'none\'" alt=""><div class="canli-yayinlarim-sonuc-item-body"><div class="canli-yayinlarim-sonuc-item-name">' + name + '</div><div class="canli-yayinlarim-sonuc-item-meta">' + meta.replace(/</g, '&lt;') + '</div></div><div class="canli-yayinlarim-sonuc-btns"><button type="button" class="canli-yayinlarim-mesaj-btn" data-mesaj-uid="' + safeUid + '" data-mesaj-name="' + nameSafe + '">Mesaj at</button><button type="button" class="canli-yayinlarim-davet-btn" data-davet-uid="' + safeUid + '">Davet Gönder</button></div>';
                    var davetBtn = div.querySelector('.canli-yayinlarim-davet-btn');
                    var mesajBtn = div.querySelector('.canli-yayinlarim-mesaj-btn');
                    if (davetBtn) {
                        davetBtn.addEventListener('click', function(ev) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            canliYayinDavetGonder(m.userId);
                        });
                    }
                    if (mesajBtn) {
                        mesajBtn.addEventListener('click', function(ev) {
                            ev.preventDefault();
                            ev.stopPropagation();
                            canliYayinMesajAtJitsi(mesajBtn);
                        });
                    }
                    div.addEventListener('click', function(e) {
                        if (e.target.closest('.canli-yayinlarim-sonuc-btns')) return;
                        canliYayinDavetGonder(m.userId);
                    });
                    listEl.appendChild(div);
                });
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="canli-yayinlarim-empty" style="padding:12px;font-size:13px;color:#94a3b8;">Arama sırasında hata oluştu.</div>';
            }
        }
        function canliYayinMesajAtJitsi(btnEl) {
            if (!btnEl || !btnEl.getAttribute) return;
            var toUserId = btnEl.getAttribute('data-mesaj-uid');
            if (!toUserId) return;
            var toUserName = (btnEl.getAttribute('data-mesaj-name') || '').replace(/&quot;/g, '"') || 'Seçilen';
            canliYayinMesajTargetUserId = toUserId;
            var label = document.getElementById('jitsiCanliYayinMesajKisiAdi');
            var ta = document.getElementById('jitsiCanliYayinMesajText');
            var panel = document.getElementById('jitsiCanliYayinMesajPanel');
            if (label) label.textContent = toUserName;
            if (ta) {
                var roomId = window.currentJitsiRoomId || currentCanliYayinRoomId;
                var path = (window.location.pathname || '/').replace(/\/$/, '') || '';
                var link = (window.location.origin || '') + path + (roomId ? ('?room=' + encodeURIComponent(roomId) + '#canli-yayin') : '');
                ta.value = roomId ? ('Toplantıya davet: ' + link) : '';
            }
            if (panel) panel.style.display = 'block';
        }
        function canliYayinMesajPanelKapatJitsi() {
            canliYayinMesajTargetUserId = null;
            var panel = document.getElementById('jitsiCanliYayinMesajPanel');
            var ta = document.getElementById('jitsiCanliYayinMesajText');
            if (panel) panel.style.display = 'none';
            if (ta) ta.value = '';
        }
        async function canliYayinMesajGonderFromJitsi() {
            var user = auth.currentUser;
            if (!user || !canliYayinMesajTargetUserId || typeof db === 'undefined') return;
            var ta = document.getElementById('jitsiCanliYayinMesajText');
            var text = (ta && ta.value && ta.value.trim()) || '';
            if (!text) { alert('Mesaj yazın veya toplantı linkini yapıştırın.'); return; }
            try {
                await db.collection('messages').add({
                    fromUserId: user.uid,
                    toUserId: canliYayinMesajTargetUserId,
                    text: text,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    read: false
                });
                if (typeof refreshMessagesBadge === 'function') refreshMessagesBadge();
                canliYayinMesajPanelKapatJitsi();
                alert('Mesaj gönderildi.');
            } catch (e) { console.error(e); alert('Mesaj gönderilemedi.'); }
        }
        (function initCanliYayinArama() {
            var input = document.getElementById('canliYayinAramaInput');
            if (input) {
                input.addEventListener('input', function() {
                    clearTimeout(canliYayinAramaTimer);
                    canliYayinAramaTimer = setTimeout(canliYayinAra, 350);
                });
                input.addEventListener('keydown', function(e) { if (e.key === 'Enter') canliYayinAra(); });
            }
            var jitsiInput = document.getElementById('jitsiInviteAramaInput');
            if (jitsiInput) {
                jitsiInput.addEventListener('input', function() {
                    clearTimeout(canliYayinAramaTimerJitsi);
                    canliYayinAramaTimerJitsi = setTimeout(canliYayinAraJitsiSidebar, 350);
                });
                jitsiInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') canliYayinAraJitsiSidebar(); });
            }
            var jitsiSonucList = document.getElementById('jitsiInviteSonucList');
            if (jitsiSonucList && !jitsiSonucList._davetDelegationBound) {
                jitsiSonucList._davetDelegationBound = true;
                jitsiSonucList.addEventListener('click', function(e) {
                    var davetBtn = e.target.closest('.canli-yayinlarim-davet-btn');
                    if (davetBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        var uid = davetBtn.getAttribute('data-davet-uid');
                        if (uid) canliYayinDavetGonder(uid);
                        return;
                    }
                    var mesajBtn = e.target.closest('.canli-yayinlarim-mesaj-btn');
                    if (mesajBtn) {
                        e.preventDefault();
                        e.stopPropagation();
                        canliYayinMesajAtJitsi(mesajBtn);
                    }
                });
            }
            if (!document._jitsiDavetDocumentDelegation) {
                document._jitsiDavetDocumentDelegation = true;
                document.addEventListener('click', function(e) {
                    var davetBtn = e.target.closest('.canli-yayinlarim-davet-btn');
                    if (!davetBtn) return;
                    var list = document.getElementById('jitsiInviteSonucList');
                    if (!list || !list.contains(davetBtn)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    var uid = davetBtn.getAttribute('data-davet-uid');
                    if (!uid) { var row = davetBtn.closest('[data-user-id]'); uid = row ? row.getAttribute('data-user-id') : ''; }
                    if (uid) canliYayinDavetGonder(uid);
                }, true);
            }
            var sohbetInput = document.getElementById('jitsiYayinSohbetInput');
            var sohbetForm = document.getElementById('jitsiYayinSohbetForm');
            if (sohbetInput) {
                sohbetInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); if (typeof jitsiYayinSohbetGonder === 'function') jitsiYayinSohbetGonder(); } });
                sohbetInput.addEventListener('touchstart', function() { sohbetInput.focus(); }, { passive: true });
            }
            if (sohbetForm && !sohbetForm._sohbetBound) {
                sohbetForm._sohbetBound = true;
                sohbetForm.addEventListener('submit', function(e) {
                    e.preventDefault();
                    if (typeof jitsiYayinSohbetGonder === 'function') jitsiYayinSohbetGonder();
                    return false;
                });
            }
            var sohbetGonderBtn = document.getElementById('jitsiYayinSohbetGonder');
            if (sohbetGonderBtn && !sohbetGonderBtn._sohbetBound) {
                sohbetGonderBtn._sohbetBound = true;
                sohbetGonderBtn.addEventListener('click', function(e) { e.preventDefault(); if (typeof jitsiYayinSohbetGonder === 'function') jitsiYayinSohbetGonder(); });
                sohbetGonderBtn.addEventListener('touchend', function(e) { e.preventDefault(); if (typeof jitsiYayinSohbetGonder === 'function') jitsiYayinSohbetGonder(); }, { passive: false });
            }
        })();

        function openToplantiPlanlaPanel() {
            var panel = document.getElementById('toplantiPlanlaPanel');
            if (!panel) return;
            if (typeof history !== 'undefined' && history.pushState) {
                history.pushState({ toplantiPlanla: true }, '', (window.location.pathname || '/') + '#toplanti-planla');
            }
            panel.classList.add('open');
            panel.style.display = 'flex';
            var user = auth.currentUser;
            var pmidDisplay = document.getElementById('toplantiPlanlaPMIDDisplay');
            if (pmidDisplay) {
                var dashPmid = document.getElementById('toplantilarimPMID');
                if (dashPmid && dashPmid.textContent && dashPmid.textContent !== '...' && dashPmid.textContent !== '—') {
                    pmidDisplay.textContent = dashPmid.textContent.trim();
                } else if (user && typeof db !== 'undefined') {
                    db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                        var mid = (snap.empty || !snap.docs[0].data().personalMeetingId) ? '—' : formatMeetingId(snap.docs[0].data().personalMeetingId);
                        if (pmidDisplay) pmidDisplay.textContent = mid;
                    });
                } else pmidDisplay.textContent = '—';
            }
        }
        function closeToplantiPlanlaPanel() {
            var panel = document.getElementById('toplantiPlanlaPanel');
            if (panel) {
                panel.classList.remove('open');
                panel.style.display = 'none';
            }
            if (typeof history !== 'undefined' && history.replaceState && window.location.hash === '#toplanti-planla') {
                history.replaceState({}, '', (window.location.pathname || '/') + (window.location.search || ''));
            }
        }
        window.addEventListener('popstate', function(e) {
            var panel = document.getElementById('toplantiPlanlaPanel');
            if (panel && panel.classList.contains('open')) {
                panel.classList.remove('open');
                panel.style.display = 'none';
            }
        });
        function isEmailLike(str) {
            return typeof str === 'string' && str.indexOf('@') >= 0 && str.indexOf('@') === str.lastIndexOf('@') && str.length > 5 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
        }
        async function resolveDavetlilerToUserIdsAndEmails(davetlilerStr) {
            if (!davetlilerStr || typeof db === 'undefined') return { userIds: [], emailOnly: [], mailtoEmails: [] };
            var tokens = davetlilerStr.split(/[\s,;]+/).map(function(s){ return s.trim(); }).filter(Boolean);
            var userIds = [];
            var emailOnly = [];
            var mailtoEmails = [];
            var seenUid = new Set();
            var seenEmail = new Set();
            for (var i = 0; i < tokens.length; i++) {
                var token = tokens[i];
                var normalized = token.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.@-]/g, '');
                if (!normalized) continue;
                var uid = null;
                var emailForMailto = null;
                if (token.indexOf('@') >= 0 && token.indexOf('@') === token.lastIndexOf('@') && token.length > 3) {
                    try {
                        var email = token.toLowerCase().trim();
                        if (isEmailLike(token)) emailForMailto = email;
                        var snap = await db.collection('userProfiles').where('email', '==', email).limit(1).get();
                        if (!snap.empty) uid = snap.docs[0].data().userId;
                        else if (isEmailLike(token) && !seenEmail.has(email)) { seenEmail.add(email); emailOnly.push(email); }
                    } catch (e) { if (isEmailLike(token)) { var e2 = token.toLowerCase().trim(); if (!seenEmail.has(e2)) { seenEmail.add(e2); emailOnly.push(e2); } emailForMailto = e2; } }
                }
                if (!uid && normalized) {
                    var un = normalized.replace(/@/g, '');
                    if (un) {
                        var snap = await db.collection('userProfiles').where('username', '==', un).limit(1).get();
                        if (!snap.empty) uid = snap.docs[0].data().userId;
                    }
                }
                if (uid && !seenUid.has(uid)) { seenUid.add(uid); userIds.push(uid); }
                if (emailForMailto && mailtoEmails.indexOf(emailForMailto) === -1) mailtoEmails.push(emailForMailto);
            }
            return { userIds: userIds, emailOnly: emailOnly, mailtoEmails: mailtoEmails };
        }
        async function resolveDavetlilerToUserIds(davetlilerStr) {
            var r = await resolveDavetlilerToUserIdsAndEmails(davetlilerStr);
            return r.userIds;
        }
        var toplantiPlanlaFormEl = document.getElementById('toplantiPlanlaForm');
        if (toplantiPlanlaFormEl) {
            toplantiPlanlaFormEl.addEventListener('submit', function(e) {
                e.preventDefault();
                var user = auth.currentUser;
                if (!user || typeof db === 'undefined') {
                    alert('Kaydetmek için giriş yapın.');
                    return;
                }
                var konu = (document.getElementById('toplantiPlanlaKonu') && document.getElementById('toplantiPlanlaKonu').value) || '';
                var aciklama = (document.getElementById('toplantiPlanlaAciklama') && document.getElementById('toplantiPlanlaAciklama').value) || '';
                var tarih = (document.getElementById('toplantiPlanlaTarih') && document.getElementById('toplantiPlanlaTarih').value) || '';
                var saat = (document.getElementById('toplantiPlanlaSaat') && document.getElementById('toplantiPlanlaSaat').value) || '';
                var saatDeger = (document.getElementById('toplantiPlanlaSaatDeger') && document.getElementById('toplantiPlanlaSaatDeger').value) || '0';
                var dakika = (document.getElementById('toplantiPlanlaDakika') && document.getElementById('toplantiPlanlaDakika').value) || '40';
                var saatDilimi = (document.getElementById('toplantiPlanlaSaatDilimi') && document.getElementById('toplantiPlanlaSaatDilimi').value) || '';
                var yineleme = (document.getElementById('toplantiPlanlaYineleme') && document.getElementById('toplantiPlanlaYineleme').value) || '';
                var davetliler = (document.getElementById('toplantiPlanlaDavetliler') && document.getElementById('toplantiPlanlaDavetliler').value) || '';
                var kimlikRadios = document.querySelectorAll('input[name="toplantiKimlik"]');
                var toplantiKimlik = 'otomatik';
                if (kimlikRadios && kimlikRadios.length) { for (var r = 0; r < kimlikRadios.length; r++) { if (kimlikRadios[r].checked) { toplantiKimlik = kimlikRadios[r].value; break; } } }
                var sablon = (document.getElementById('toplantiPlanlaSablon') && document.getElementById('toplantiPlanlaSablon').value) || '';
                var parola = (document.getElementById('toplantiPlanlaParola') && document.getElementById('toplantiPlanlaParola').value) || '';
                var beklemeOdasi = !!(document.getElementById('toplantiPlanlaBeklemeOdasi') && document.getElementById('toplantiPlanlaBeklemeOdasi').checked);
                var sifreleme = (document.getElementById('toplantiPlanlaSifreleme') && document.getElementById('toplantiPlanlaSifreleme').value) || 'advanced';
                var hostVideo = !!(document.getElementById('toplantiPlanlaHostVideo') && document.getElementById('toplantiPlanlaHostVideo').checked);
                var katilimciVideo = !!(document.getElementById('toplantiPlanlaKatilimciVideo') && document.getElementById('toplantiPlanlaKatilimciVideo').checked);
                var payload = {
                    userId: user.uid,
                    konu: konu,
                    aciklama: aciklama,
                    tarih: tarih,
                    saat: saat,
                    sureSaat: parseInt(saatDeger, 10) || 0,
                    sureDakika: parseInt(dakika, 10) || 40,
                    saatDilimi: saatDilimi,
                    yineleme: yineleme,
                    davetliler: davetliler,
                    toplantiKimlik: toplantiKimlik,
                    sablon: sablon,
                    parola: parola,
                    beklemeOdasi: beklemeOdasi,
                    sifreleme: sifreleme,
                    hostVideo: hostVideo,
                    katilimciVideo: katilimciVideo,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                };
                (async function() {
                    try {
                        var resolved = await resolveDavetlilerToUserIdsAndEmails(davetliler);
                        var inviteeIds = resolved.userIds;
                        var emailOnlyList = resolved.emailOnly || [];
                        var docRef = await db.collection('userMeetings').add(payload);
                        var roomId = 'FinansSepeti-' + docRef.id;
                        await docRef.update({ roomId: roomId });
                        var fromUserName = user.displayName || 'Kullanıcı';
                        var fromUserPhotoUrl = user.photoURL || '';
                        var orgSnap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                        if (!orgSnap.empty) { var o = orgSnap.docs[0].data(); fromUserName = o.adSoyad || fromUserName; fromUserPhotoUrl = o.photoUrl || fromUserPhotoUrl; }
                        for (var k = 0; k < inviteeIds.length; k++) {
                            if (inviteeIds[k] === user.uid) continue;
                            await db.collection('meetingInvites').add({
                                toUserId: inviteeIds[k],
                                fromUserId: user.uid,
                                fromUserName: fromUserName,
                                fromUserPhotoUrl: fromUserPhotoUrl,
                                meetingId: docRef.id,
                                roomId: roomId,
                                konu: konu,
                                tarih: tarih,
                                saat: saat,
                                aciklama: (aciklama || '').substring(0, 200),
                                createdAt: firebase.firestore.FieldValue.serverTimestamp()
                            });
                        }
                        if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                        var meetingLink = window.location.origin + (window.location.pathname || '/') + '#toplanti-join-' + encodeURIComponent(roomId);
                        var mailtoEmailsList = resolved.mailtoEmails || emailOnlyList || [];
                        if (mailtoEmailsList.length === 0 && davetliler && /@/.test(davetliler)) {
                            var rawEmails = davetliler.match(/[^\s,;]+@[^\s,;]+\.[^\s,;]+/g) || [];
                            rawEmails.forEach(function(e) { e = e.trim().toLowerCase(); if (e && mailtoEmailsList.indexOf(e) === -1) mailtoEmailsList.push(e); });
                        }
                        if (mailtoEmailsList.length > 0) {
                            var subject = 'Toplantı daveti: ' + (konu || 'Toplantı');
                            var body = 'Merhaba,\n\nSizi bir toplantıya davet ediyorum.\n\nToplantı: ' + (konu || 'Toplantı') + '\nTarih/Saat: ' + (tarih || '') + ' ' + (saat || '') + '\n\nToplantıya katılmak için aşağıdaki bağlantıya tıklayın (finanssepeti.net üzerinden toplantı odasına gireceksiniz):\n\n' + meetingLink + '\n\nSaygılarımla.';
                            var mailto = 'mailto:' + (mailtoEmailsList.join(';')) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
                            try {
                                var a = document.createElement('a');
                                a.href = mailto;
                                a.style.display = 'none';
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            } catch (e2) {
                                window.location.href = mailto;
                            }
                        }
                        var msg = 'Toplantı kaydedildi.';
                        if (inviteeIds.length) msg += ' Site kullanıcılarına bildirim gönderildi.';
                        if (mailtoEmailsList.length) msg += ' E-posta istemciniz açıldı; alıcılar otomatik eklendi, maili gönderin.';
                        msg += ' Plan Bilgilerini Görüntüle ile takip edebilirsiniz.';
                        alert(msg);
                        closeToplantiPlanlaPanel();
                    } catch (err) {
                        console.error(err);
                        alert('Kayıt sırasında hata oluştu. Tekrar deneyin.');
                    }
                })();
            });
        }

        function openPlanBilgileriModal() {
            var modal = document.getElementById('planBilgileriModal');
            if (!modal) return;
            var user = auth.currentUser;
            if (!user) { alert('Plan bilgilerini görmek için giriş yapın.'); return; }
            modal.classList.add('open');
            modal.style.display = 'flex';
            loadPlanBilgileri();
        }
        function closePlanBilgileriModal() {
            var modal = document.getElementById('planBilgileriModal');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
        }
        async function loadPlanBilgileri() {
            var listEl = document.getElementById('planBilgileriList');
            var user = auth.currentUser;
            if (!listEl || !user || typeof db === 'undefined') return;
            listEl.innerHTML = '<div class="plan-bilgileri-empty">Yükleniyor...</div>';
            try {
                var snap = await db.collection('userMeetings').where('userId', '==', user.uid).get();
                if (snap.empty) {
                    listEl.innerHTML = '<div class="plan-bilgileri-empty">Henüz kaydedilmiş toplantı yok. Toplantılarım &gt; Planla ile toplantı planlayıp kaydedin.</div>';
                    return;
                }
                var docs = snap.docs.slice();
                docs.sort(function(a, b) {
                    var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return tb - ta;
                });
                listEl.innerHTML = '';
                docs.forEach(function(doc) {
                    var d = doc.data();
                    var tarihSaat = (d.tarih || '') + ' ' + (d.saat || '');
                    var sure = (d.sureSaat || 0) + ' sa ' + (d.sureDakika || 0) + ' dk';
                    var created = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().toLocaleString('tr-TR') : '';
                    var roomId = d.roomId || '';
                    var toplantiAcBtn = roomId ? '<p style="margin-top:10px;"><button type="button" class="plan-bilgileri-katil-btn" onclick="openMeetingInvite(\'' + roomId.replace(/'/g, "\\'") + '\')">Toplantıyı Aç / Katıl</button></p>' : '';
                    var card = document.createElement('div');
                    card.className = 'plan-bilgileri-card';
                    card.innerHTML = '<h4>' + (d.konu || 'Toplantı').replace(/</g, '&lt;') + '</h4>' +
                        (d.aciklama ? '<p>' + (d.aciklama || '').substring(0, 200).replace(/</g, '&lt;') + (d.aciklama.length > 200 ? '...' : '') + '</p>' : '') +
                        '<p><strong>Tarih / Saat:</strong> ' + (tarihSaat || '—').replace(/</g, '&lt;') + '</p>' +
                        '<p><strong>Süre:</strong> ' + sure + '</p>' +
                        (d.saatDilimi ? '<p><strong>Saat dilimi:</strong> ' + String(d.saatDilimi).replace(/</g, '&lt;') + '</p>' : '') +
                        (d.yineleme ? '<p><strong>Yineleme:</strong> ' + (d.yineleme === 'daily' ? 'Günlük' : d.yineleme === 'weekly' ? 'Haftalık' : d.yineleme === 'monthly' ? 'Aylık' : d.yineleme) + '</p>' : '') +
                        (d.davetliler ? '<p><strong>Davetliler:</strong> ' + String(d.davetliler).replace(/</g, '&lt;').substring(0, 100) + '</p>' : '') +
                        (d.parola ? '<p><strong>Parola:</strong> ' + String(d.parola).replace(/</g, '&lt;') + '</p>' : '') +
                        '<p class="plan-bilgileri-meta">Kayıt: ' + created + '</p>' + toplantiAcBtn;
                    listEl.appendChild(card);
                });
            } catch (err) {
                console.error(err);
                listEl.innerHTML = '<div class="plan-bilgileri-empty">Yüklenirken hata oluştu. Tekrar deneyin.</div>';
            }
        }

        async function loadFavorilerimFeed() {
            var user = auth.currentUser;
            var listEl = document.getElementById('favorilerimList');
            if (!user) { listEl.innerHTML = ''; return; }
            listEl.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var favSnap = await db.collection('postFavorites').where('userId','==',user.uid).get();
                var postIds = favSnap.docs.map(function(d){ return d.data().postId; });
                var fallbackSets = await getReactionFallbackSets(user);
                fallbackSets.favorite.forEach(function(pid) { if (postIds.indexOf(pid) === -1) postIds.push(pid); });
                if (postIds.length === 0) { listEl.innerHTML = '<div class="friends-empty">Henüz favorilere eklediğiniz paylaşım yok.</div>'; return; }
                var favAtMap = {};
                favSnap.docs.forEach(function(d) {
                    var dd = d.data() || {};
                    var pid = dd.postId;
                    if (!pid) return;
                    var t = 0;
                    if (dd.createdAt && dd.createdAt.toMillis) t = dd.createdAt.toMillis();
                    else if (dd.createdAtMs) t = Number(dd.createdAtMs) || 0;
                    if (!favAtMap[pid] || t > favAtMap[pid]) favAtMap[pid] = t;
                });
                var localFavAt = getLocalReactionTimeMap(user.uid, 'favorite');
                Object.keys(localFavAt).forEach(function(pid) {
                    if (!favAtMap[pid] || Number(localFavAt[pid]) > favAtMap[pid]) favAtMap[pid] = Number(localFavAt[pid]) || 0;
                });
                var likeSnap = await db.collection('postLikes').where('userId','==',user.uid).get();
                var likedSet = new Set(likeSnap.docs.map(function(d){ return d.data().postId; }));
                fallbackSets.liked.forEach(function(pid) { likedSet.add(pid); });
                var likeCountMap = await getReactionCountMap('postLikes', postIds);
                var favCountMap = await getReactionCountMap('postFavorites', postIds);
                var posts = [];
                for (var i = 0; i < postIds.length; i++) {
                    var doc = await db.collection('userPosts').doc(postIds[i]).get();
                    if (!doc.exists) continue;
                    var data = doc.data();
                    data.id = doc.id;
                    var authorId = data.userId;
                    var profSnap = await db.collection('userProfiles').where('userId','==',authorId).limit(1).get();
                    if (!profSnap.empty) {
                        var p = profSnap.docs[0].data();
                        data.userName = p.adSoyad || data.userName || 'İsimsiz';
                        data.userPhotoUrl = p.photoUrl || data.userPhotoUrl || '';
                    } else {
                        data.userName = data.userName || 'İsimsiz';
                        data.userPhotoUrl = data.userPhotoUrl || '';
                    }
                    data.likeCount = likeCountMap[data.id] || Number(data.likeCount || 0);
                    data.favoriteCount = favCountMap[data.id] || Number(data.favoriteCount || 0);
                    if (fallbackSets.favorite.has(data.id) && data.favoriteCount <= 0) data.favoriteCount = 1;
                    data._reactionAt = favAtMap[data.id] || 0;
                    posts.push(data);
                }
                posts.sort(function(a,b){ return Number(b._reactionAt || 0) - Number(a._reactionAt || 0); });
                listEl.innerHTML = '';
                for (var j = 0; j < posts.length; j++) {
                    var postData = posts[j];
                    var postId = postData.id;
                    var card = renderYorumPostCard(postId, postData, likedSet.has(postId), true, false, postData.userId);
                    card.setAttribute('data-list-context', 'favorite');
                    listEl.appendChild(card);
                }
            } catch (e) {
                console.error(e);
                listEl.innerHTML = '<div class="friends-empty">Yüklenirken hata oluştu.</div>';
            }
        }

        async function loadYorumlarimFeed() {
            var user = auth.currentUser;
            if (!user) return;
            loadYorumlarimVideolarList();
            var list = document.getElementById('yorumlarimFeedList');
            list.innerHTML = '<div class="friends-empty">Yükleniyor...</div>';
            try {
                var postsSnap = await db.collection('userPosts').where('userId', '==', user.uid).get();
                var allDocs = postsSnap.docs.slice();
                var pendingId = window.pendingScrollToPostId;
                if (pendingId && !allDocs.some(function(d) { return d.id === pendingId; })) {
                    var pendingSnap = await db.collection('userPosts').doc(pendingId).get();
                    if (pendingSnap.exists && pendingSnap.data().userId === user.uid) { allDocs.unshift(pendingSnap); }
                }
                allDocs.sort(function(a, b) {
                    var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return tb - ta;
                });
                var likedSet = new Set();
                var favSet = new Set();
                var likeSnap = await db.collection('postLikes').where('userId', '==', user.uid).get();
                likeSnap.docs.forEach(function(d) { likedSet.add(d.data().postId); });
                var favSnap = await db.collection('postFavorites').where('userId', '==', user.uid).get();
                favSnap.docs.forEach(function(d) { favSet.add(d.data().postId); });
                var fallbackSets = await getReactionFallbackSets(user);
                fallbackSets.liked.forEach(function(pid) { likedSet.add(pid); });
                fallbackSets.favorite.forEach(function(pid) { favSet.add(pid); });
                if (allDocs.length === 0) { list.innerHTML = '<div class="friends-empty">Henüz yorumunuz yok. Yorum Yaz ile ilk yorumu siz atın.</div>'; window.pendingScrollToPostId = null; return; }
                list.innerHTML = '';
                for (var i = 0; i < allDocs.length; i++) {
                    var doc = allDocs[i];
                    var dData = doc.data();
                    var isOwnPost = dData.userId === user.uid;
                    var card = renderYorumPostCard(doc.id, dData, likedSet.has(doc.id), favSet.has(doc.id), isOwnPost, dData.userId);
                    var composerDiv = document.createElement('div');
                    composerDiv.className = 'yorum-reply-composer';
                    composerDiv.setAttribute('data-post-id', doc.id);
                    composerDiv.innerHTML = '<textarea placeholder="Yanıt yazın..." rows="2"></textarea><button type="button" class="yorum-reply-send">Gönder</button>';
                    var ta = composerDiv.querySelector('textarea');
                    var sendBtn = composerDiv.querySelector('.yorum-reply-send');
                    sendBtn.addEventListener('click', function(pid, cardEl, textareaEl, countBtn) {
                        return function() {
                            var txt = (textareaEl.value || '').trim();
                            if (!txt) return;
                            textareaEl.value = '';
                            submitYorumReply(pid, txt, cardEl, countBtn);
                        };
                    }(doc.id, card, ta, card.querySelector('[data-action="comment"]')));
                    card.appendChild(composerDiv);
                    var repliesSnap = await db.collection('postReplies').where('postId', '==', doc.id).get();
                    var repliesSorted = repliesSnap.docs.slice().sort(function(a, b) {
                        var ta = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                        var tb = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                        return ta - tb;
                    });
                    if (repliesSorted.length > 0) {
                        var repliesDiv = document.createElement('div');
                        repliesDiv.className = 'yorum-post-replies';
                        var titleEl = document.createElement('div');
                        titleEl.className = 'yorum-post-replies-title';
                        titleEl.textContent = 'Yorumlar (' + repliesSorted.length + ')';
                        repliesDiv.appendChild(titleEl);
                        repliesSorted.forEach(function(rDoc) {
                            var r = rDoc.data();
                            var rt = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
                            var rText = (r.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                            var replyUserId = r.userId || '';
                            var item = document.createElement('div');
                            item.className = 'yorum-reply-item';
                            if (replyUserId) {
                                item.innerHTML = '<button type="button" class="yorum-reply-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(replyUserId).replace(/'/g, "\\'") + '\');" title="Profile git"><img class="yorum-reply-avatar" src="' + (r.userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div class="yorum-reply-body"><button type="button" class="yorum-reply-profile-link yorum-reply-name-btn" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(replyUserId).replace(/'/g, "\\'") + '\');" title="Profile git"><span class="yorum-reply-name">' + (r.userName || 'Kullanıcı') + '</span></button><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                            } else {
                                item.innerHTML = '<img class="yorum-reply-avatar" src="' + (r.userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div class="yorum-reply-body"><div class="yorum-reply-name">' + (r.userName || 'Kullanıcı') + '</div><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                            }
                            repliesDiv.appendChild(item);
                        });
                        card.appendChild(repliesDiv);
                    }
                    list.appendChild(card);
                }
                if (window.pendingScrollToPostId) {
                    var cardEl = list.querySelector('.yorum-post-card[data-post-id="' + window.pendingScrollToPostId + '"]');
                    if (cardEl) { cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
                    window.pendingScrollToPostId = null;
                }
            } catch (e) {
                console.error(e);
                list.innerHTML = '<div class="friends-empty">Yüklenemedi.</div>';
                window.pendingScrollToPostId = null;
            }
        }

        function renderYorumPostCard(postId, data, isLiked, isFav, showDeleteBtn, authorUserId) {
            isLiked = !!isLiked;
            isFav = !!isFav;
            showDeleteBtn = !!showDeleteBtn;
            var cu = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : null;
            if (cu && cu.uid) {
                var localLiked = getLocalReactionSet(cu.uid, 'liked');
                var localFav = getLocalReactionSet(cu.uid, 'favorite');
                if (localLiked.has(postId)) isLiked = true;
                if (localFav.has(postId)) isFav = true;
                if (localLiked.has(postId) && !(Number(data.likeCount || 0) > 0)) data.likeCount = 1;
                if (localFav.has(postId) && !(Number(data.favoriteCount || 0) > 0)) data.favoriteCount = 1;
            }
            var card = document.createElement('div');
            card.className = 'yorum-post-card';
            card.setAttribute('data-post-id', postId);
            var timeStr = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '';
            var textEsc = (data.text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
            var mediaHtml = '';
            var mediaList = normalizeMediaUrlsField(data.mediaUrls);
            if (mediaList.length) {
                mediaList.forEach(function(url) {
                    var urlEsc = (url || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
                    if (isVideoMediaUrl(url)) mediaHtml += '<video src="' + urlEsc + '" controls playsinline preload="metadata" controlsList="nodownload" style="max-width:100%; max-height:280px; border-radius:8px;"></video>';
                    else mediaHtml += '<img src="' + urlEsc + '" alt="" style="max-width:100%; max-height:280px; border-radius:8px;">';
                });
            }
            var likeCls = isLiked ? 'yorum-post-action active' : 'yorum-post-action';
            var favCls = isFav ? 'yorum-post-action active' : 'yorum-post-action';
            var quotedHtml = (data.quotedText || data.quotedPostId) ? '<div class="yorum-post-quoted"><strong>Alıntı</strong><div>' + (data.quotedText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 200) + (data.quotedText && data.quotedText.length > 200 ? '...' : '') + '</div></div>' : '';
            var deleteBtnHtml = showDeleteBtn ? '<button type="button" class="yorum-post-delete-btn yorum-post-action" data-action="delete" data-post-id="' + (postId || '').replace(/"/g, '&quot;') + '" title="Yorumu sil"><i class="fas fa-trash-alt"></i></button>' : '';
            var headAuthorHtml = '<img class="yorum-post-avatar" src="' + (data.userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""><div><div class="yorum-post-name">' + (data.userName || 'İsimsiz') + (data.quotedPostId ? ' <span style="font-size:11px;color:#8fd3ff;">(Alıntı)</span>' : '') + '</div><div class="yorum-post-time">' + timeStr + '</div></div>';
            if (authorUserId) {
                headAuthorHtml = '<button type="button" class="yorum-post-head-profile-link" onclick="event.preventDefault();event.stopPropagation();if(typeof goToUserProfile===\'function\')goToUserProfile(\'' + String(authorUserId).replace(/'/g, "\\'") + '\');" title="Profile git">' + headAuthorHtml + '</button>';
            }
            card.innerHTML = '<div class="yorum-post-head">' + deleteBtnHtml + headAuthorHtml + '</div>' + quotedHtml + '<div class="yorum-post-text">' + textEsc + '</div><div class="yorum-post-media">' + mediaHtml + '</div><div class="yorum-post-actions"><button type="button" class="' + likeCls + '" data-action="like" data-post-id="' + postId + '"><i class="fas fa-heart"></i><span class="count">' + (data.likeCount || 0) + '</span></button><button type="button" class="yorum-post-action" data-action="comment" data-post-id="' + postId + '"><i class="fas fa-comment"></i><span class="count">' + (data.commentCount || 0) + '</span></button><button type="button" class="' + favCls + '" data-action="favorite" data-post-id="' + postId + '"><i class="fas fa-star"></i><span class="count">' + (data.favoriteCount || 0) + '</span></button><button type="button" class="yorum-post-action" data-action="share" data-post-id="' + postId + '"><i class="fas fa-share-alt"></i><span class="count">' + (data.shareCount || 0) + '</span></button><button type="button" class="yorum-post-action" data-action="quote" data-post-id="' + postId + '" title="Alıntıla"><span class="yorum-post-quote-symbol">\u2B80</span><span class="count">' + (data.quoteCount || 0) + '</span></button></div>';
            return card;
        }
        document.addEventListener('click', function yorumPostActionDelegation(ev) {
            if (ev.target && (ev.target.closest('.yorum-post-head-profile-link') || ev.target.closest('.yorum-reply-profile-link'))) return;
            var btn = ev.target && ev.target.closest ? ev.target.closest('.yorum-post-card [data-action]') : null;
            if (!btn || !btn.getAttribute('data-action')) return;
            if (btn.dataset && btn.dataset.busy === '1') return;
            var action = btn.getAttribute('data-action');
            var pid = btn.getAttribute('data-post-id');
            if (!action || !pid) return;
            ev.preventDefault();
            ev.stopPropagation();
            btn.dataset.busy = '1';
            var card = btn.closest('.yorum-post-card');
            var ctx = card ? (card.getAttribute('data-list-context') || '') : '';
            var done = Promise.resolve();
            if (action === 'like') done = Promise.resolve(yorumPostLike(pid, btn));
            else if (action === 'comment') { yorumPostComment(pid, btn); done = Promise.resolve(); }
            else if (action === 'favorite') done = Promise.resolve(yorumPostFavorite(pid, btn));
            else if (action === 'share') { yorumPostShare(pid, btn); done = Promise.resolve(); }
            else if (action === 'quote') { yorumPostQuote(pid, btn); done = Promise.resolve(); }
            else if (action === 'delete') done = Promise.resolve(deleteYorumPost(pid, btn));
            done.finally(function() {
                btn.dataset.busy = '0';
                if (ctx === 'liked') {
                    if (!btn.classList.contains('active')) {
                        var listEl = document.getElementById('begendiklerimList');
                        if (card && listEl && listEl.contains(card)) card.remove();
                        if (listEl && listEl.querySelectorAll('.yorum-post-card').length === 0) listEl.innerHTML = '<div class="friends-empty">Henüz beğendiğiniz paylaşım yok.</div>';
                    } else {
                        loadBegendiklerimFeed();
                    }
                } else if (ctx === 'favorite') {
                    if (!btn.classList.contains('active')) {
                        var listFav = document.getElementById('favorilerimList');
                        if (card && listFav && listFav.contains(card)) card.remove();
                        if (listFav && listFav.querySelectorAll('.yorum-post-card').length === 0) listFav.innerHTML = '<div class="friends-empty">Henüz favorilere eklediğiniz paylaşım yok.</div>';
                    } else {
                        loadFavorilerimFeed();
                    }
                }
            });
        });

        async function yorumPostLike(postId, btnEl) {
            var firestore = typeof firebase !== 'undefined' && firebase.firestore;
            var authObj = typeof firebase !== 'undefined' && firebase.auth && firebase.auth();
            var user = authObj ? authObj.currentUser : (typeof auth !== 'undefined' ? auth.currentUser : null);
            if (!user) { alert('Beğenmek için giriş yapın.'); return; }
            if (!firestore || !db) { alert('Beğeni işlemi şu an kullanılamıyor.'); return; }
            var countEl = btnEl && btnEl.querySelector ? btnEl.querySelector('.count') : null;
            var localLiked = getLocalReactionSet(user.uid, 'liked');
            var localLikedAt = getLocalReactionTimeMap(user.uid, 'liked');
            var wasLiked = localLiked.has(postId) || (btnEl && btnEl.classList && btnEl.classList.contains('active'));
            var makeLiked = !wasLiked;
            if (makeLiked) localLiked.add(postId); else localLiked.delete(postId);
            saveLocalReactionSet(user.uid, 'liked', localLiked);
            if (makeLiked) localLikedAt[postId] = Date.now(); else delete localLikedAt[postId];
            saveLocalReactionTimeMap(user.uid, 'liked', localLikedAt);
            if (btnEl) btnEl.classList.toggle('active', makeLiked);
            if (countEl) {
                var curr = parseInt(countEl.textContent, 10) || 0;
                countEl.textContent = String(makeLiked ? Math.max(1, curr + 1) : Math.max(0, curr - 1));
            }
            try {
                var ref = db.collection('userPosts').doc(postId);
                var postSnap = await ref.get();
                if (!postSnap.exists) { alert('Bu paylaşım bulunamadı.'); return; }
                var idKey = postId + '_' + user.uid;
                var prof = await ensureReactionProfile(user);
                try {
                    var likeSnap = await db.collection('postLikes').where('idKey', '==', idKey).get();
                    if (!makeLiked && !likeSnap.empty) await likeSnap.docs[0].ref.delete();
                    if (makeLiked && likeSnap.empty) await db.collection('postLikes').add({
                        postId: postId, userId: user.uid, idKey: idKey,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAtMs: Date.now()
                    });
                    try { await ref.set({ likeCount: firebase.firestore.FieldValue.increment(makeLiked ? 1 : -1) }, { merge: true }); } catch (eSet1) {}
                } catch (ePrimary) {}
                if (prof && prof.ref) {
                    try {
                        await prof.ref.set({
                            likedPostIds: makeLiked
                                ? firebase.firestore.FieldValue.arrayUnion(postId)
                                : firebase.firestore.FieldValue.arrayRemove(postId)
                        }, { merge: true });
                    } catch (eProfile) {}
                }
            } catch (e) {
                console.error('yorumPostLike', e);
            }
        }
        function yorumPostComment(postId, btnEl) {
            var card = btnEl.closest('.yorum-post-card');
            if (card) {
                var composer = card.querySelector('.yorum-reply-composer');
                var ta = composer ? composer.querySelector('textarea') : null;
                if (ta) { ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
            }
        }
        function submitYorumReply(postId, text, cardEl, countBtn) {
            var user = auth.currentUser;
            if (!user || !text) return;
            var userName = user.displayName || 'Kullanıcı';
            var userPhotoUrl = user.photoURL || '';
            db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get().then(function(snap) {
                if (!snap.empty) { var d = snap.docs[0].data(); userName = d.adSoyad || userName; userPhotoUrl = d.photoUrl || userPhotoUrl; }
                return db.collection('postReplies').add({ postId: postId, userId: user.uid, userName: userName, userPhotoUrl: userPhotoUrl, text: text, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function() {
                    return createMentionNotifications(text, user.uid, userName, userPhotoUrl, postId);
                });
            }).then(function() {
                return db.collection('userPosts').doc(postId).update({ commentCount: firebase.firestore.FieldValue.increment(1) });
            }).then(function() {
                if (countBtn) countBtn.querySelector('.count').textContent = parseInt(countBtn.querySelector('.count').textContent, 10) + 1;
                var repliesWrap = cardEl.querySelector('.yorum-post-replies');
                if (repliesWrap) {
                    var titleEl = repliesWrap.querySelector('.yorum-post-replies-title');
                    var n = (repliesWrap.querySelectorAll('.yorum-reply-item').length || 0) + 1;
                    if (titleEl) titleEl.textContent = 'Yorumlar (' + n + ')';
                    var item = document.createElement('div');
                    item.className = 'yorum-reply-item';
                    var now = new Date();
                    var rt = now.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
                    var rText = (text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    item.innerHTML = '<button type="button" class="yorum-reply-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(user.uid).replace(/'/g, "\\'") + '\');" title="Profile git"><img class="yorum-reply-avatar" src="' + (userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div class="yorum-reply-body"><button type="button" class="yorum-reply-profile-link yorum-reply-name-btn" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(user.uid).replace(/'/g, "\\'") + '\');" title="Profile git"><span class="yorum-reply-name">' + (userName || 'Kullanıcı') + '</span></button><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                    repliesWrap.appendChild(item);
                } else {
                    var repliesDiv = document.createElement('div');
                    repliesDiv.className = 'yorum-post-replies';
                    var titleEl = document.createElement('div');
                    titleEl.className = 'yorum-post-replies-title';
                    titleEl.textContent = 'Yorumlar (1)';
                    repliesDiv.appendChild(titleEl);
                    var item = document.createElement('div');
                    item.className = 'yorum-reply-item';
                    var now = new Date();
                    var rt = now.toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' });
                    var rText = (text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
                    item.innerHTML = '<button type="button" class="yorum-reply-profile-link" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(user.uid).replace(/'/g, "\\'") + '\');" title="Profile git"><img class="yorum-reply-avatar" src="' + (userPhotoUrl || '') + '" onerror="this.style.display=\'none\'" alt=""></button><div class="yorum-reply-body"><button type="button" class="yorum-reply-profile-link yorum-reply-name-btn" onclick="event.preventDefault();event.stopPropagation();goToUserProfile(\'' + String(user.uid).replace(/'/g, "\\'") + '\');" title="Profile git"><span class="yorum-reply-name">' + (userName || 'Kullanıcı') + '</span></button><div class="yorum-reply-text">' + rText + '</div><div class="yorum-reply-time">' + rt + '</div></div>';
                    repliesDiv.appendChild(item);
                    var composer = cardEl.querySelector('.yorum-reply-composer');
                    if (composer && composer.nextSibling) cardEl.insertBefore(repliesDiv, composer.nextSibling);
                    else cardEl.appendChild(repliesDiv);
                }
            }).catch(function(e) { console.error(e); });
        }
        async function yorumPostFavorite(postId, btnEl) {
            var authObj = typeof firebase !== 'undefined' && firebase.auth && firebase.auth();
            var user = authObj ? authObj.currentUser : (typeof auth !== 'undefined' ? auth.currentUser : null);
            if (!user) { alert('Favorilere eklemek için giriş yapın.'); return; }
            if (!db) { alert('Favori işlemi şu an kullanılamıyor.'); return; }
            var countEl = btnEl && btnEl.querySelector ? btnEl.querySelector('.count') : null;
            var localFav = getLocalReactionSet(user.uid, 'favorite');
            var localFavAt = getLocalReactionTimeMap(user.uid, 'favorite');
            var wasFav = localFav.has(postId) || (btnEl && btnEl.classList && btnEl.classList.contains('active'));
            var makeFav = !wasFav;
            if (makeFav) localFav.add(postId); else localFav.delete(postId);
            saveLocalReactionSet(user.uid, 'favorite', localFav);
            if (makeFav) localFavAt[postId] = Date.now(); else delete localFavAt[postId];
            saveLocalReactionTimeMap(user.uid, 'favorite', localFavAt);
            if (btnEl) btnEl.classList.toggle('active', makeFav);
            if (countEl) {
                var curr = parseInt(countEl.textContent, 10) || 0;
                countEl.textContent = String(makeFav ? Math.max(1, curr + 1) : Math.max(0, curr - 1));
            }
            try {
                var ref = db.collection('userPosts').doc(postId);
                var postSnap = await ref.get();
                if (!postSnap.exists) { alert('Bu paylaşım bulunamadı.'); return; }
                var idKey = postId + '_' + user.uid;
                var prof = await ensureReactionProfile(user);
                try {
                    var favSnap = await db.collection('postFavorites').where('idKey', '==', idKey).get();
                    if (!makeFav && !favSnap.empty) await favSnap.docs[0].ref.delete();
                    if (makeFav && favSnap.empty) await db.collection('postFavorites').add({
                        postId: postId, userId: user.uid, idKey: idKey,
                        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                        createdAtMs: Date.now()
                    });
                    try { await ref.set({ favoriteCount: firebase.firestore.FieldValue.increment(makeFav ? 1 : -1) }, { merge: true }); } catch (eSet3) {}
                } catch (ePrimary) {}
                if (prof && prof.ref) {
                    try {
                        await prof.ref.set({
                            favoritePostIds: makeFav
                                ? firebase.firestore.FieldValue.arrayUnion(postId)
                                : firebase.firestore.FieldValue.arrayRemove(postId)
                        }, { merge: true });
                    } catch (eProfile) {}
                }
            } catch (e) {
                console.error('yorumPostFavorite', e);
            }
        }
        function yorumPostShare(postId, btnEl) {
            var card = btnEl.closest('.yorum-post-card');
            var text = card ? card.querySelector('.yorum-post-text') ? card.querySelector('.yorum-post-text').innerText : '' : '';
            var shareUrl = window.location.href;
            var shareText = text ? (text.substring(0, 100) + (text.length > 100 ? '...' : '')) + ' ' + shareUrl : shareUrl;
            var choice = confirm('E-posta ile paylaşmak için Tamam, WhatsApp ile paylaşmak için İptal\'e basın.');
            if (choice) {
                window.location.href = 'mailto:?body=' + encodeURIComponent(shareText);
            } else {
                window.open('https://wa.me/?text=' + encodeURIComponent(shareText), '_blank');
            }
            db.collection('userPosts').doc(postId).update({ shareCount: firebase.firestore.FieldValue.increment(1) }).then(function() {
                btnEl.querySelector('.count').textContent = parseInt(btnEl.querySelector('.count').textContent, 10) + 1;
            });
        }
        function yorumPostQuote(postId, btnEl) {
            var user = auth.currentUser;
            if (!user) return;
            var card = btnEl.closest('.yorum-post-card');
            var quotedText = card && card.querySelector('.yorum-post-text') ? card.querySelector('.yorum-post-text').innerText : '';
            openYorumYazModalForQuote(postId, quotedText);
        }

        async function deleteYorumPost(postId, btnEl) {
            var user = typeof auth !== 'undefined' && auth.currentUser;
            if (!user) { alert('Silmek için giriş yapın.'); return; }
            if (!postId) return;
            if (!confirm('Bu yorumu silmek istediğinize emin misiniz?')) return;
            var card = btnEl && btnEl.closest ? btnEl.closest('.yorum-post-card') : null;
            var list = document.getElementById('yorumlarimFeedList');
            try {
                var docSnap = await db.collection('userPosts').doc(postId).get();
                if (!docSnap.exists) {
                    if (card && list && card.parentNode === list) { card.remove(); }
                    return;
                }
                var data = docSnap.data();
                if (data.userId !== user.uid) {
                    alert('Sadece kendi yorumunuzu silebilirsiniz.');
                    return;
                }
                await db.collection('userPosts').doc(postId).delete();
                var quotedPostId = data.quotedPostId || null;
                if (quotedPostId) {
                    try {
                        await db.collection('userPosts').doc(quotedPostId).update({ quoteCount: firebase.firestore.FieldValue.increment(-1) });
                    } catch (quoteErr) {
                        console.warn('quoteCount güncellenemedi', quoteErr);
                    }
                }
                if (card && list && card.parentNode === list) {
                    card.remove();
                    if (list.querySelectorAll('.yorum-post-card').length === 0)
                        list.innerHTML = '<div class="friends-empty">Henüz yorumunuz yok. Yorum Yaz ile ilk yorumu siz atın.</div>';
                }
            } catch (e) {
                console.error('deleteYorumPost', e);
                var msg = (e && e.message) ? e.message : 'Yorum silinirken hata oluştu.';
                if (msg.indexOf('permission') !== -1 || msg.indexOf('Permission') !== -1) msg = 'Bu yorumu silme yetkiniz yok veya oturum süreniz dolmuş olabilir.';
                alert('Yorum silinirken hata: ' + msg);
            }
        }
        if (typeof window !== 'undefined') window.deleteYorumPost = deleteYorumPost;

        async function saveDailyPortfolio() {
            const user = auth.currentUser;
            const msgEl = document.getElementById('invMessage');
            msgEl.style.display = 'none';
            msgEl.textContent = '';
            msgEl.className = 'inv-error';

            if (!user) {
                msgEl.textContent = 'Kayıt için önce giriş yapmanız gerekiyor.';
                msgEl.style.display = 'block';
                return;
            }

            const symbol = document.getElementById('invSymbol').value.trim();
            const amount = parseFormattedNumber(document.getElementById('invAmount').value);
            const unitVal = document.getElementById('invUnitPrice').value;
            let unitPrice = parseFormattedNumber(unitVal);
            let total = parseFormattedNumber(document.getElementById('invTotal').value);
            const date = document.getElementById('invDate').value;
            const category = currentInvestmentCategory || 'GENEL';

            if (!symbol || !date) {
                msgEl.textContent = 'Lütfen ürün/sembol ve tarih alanlarını doldurun.';
                msgEl.style.display = 'block';
                return;
            }
            if (amount <= 0) {
                msgEl.textContent = 'Lütfen miktar girin (0\'dan büyük olmalı).';
                msgEl.style.display = 'block';
                return;
            }
            if (unitPrice <= 0 && total <= 0) {
                msgEl.textContent = 'Lütfen birim fiyat veya toplam tutar girin (en az biri 0\'dan büyük olmalı).';
                msgEl.style.display = 'block';
                return;
            }
            if (unitPrice > 0 && total <= 0) total = amount * unitPrice;
            if (total > 0 && unitPrice <= 0) unitPrice = total / amount;

            var usdTryVal = null;
            var usdTryEl = document.getElementById('invUsdTry');
            if (usdTryEl && usdTryEl.parentNode && usdTryEl.parentNode.style.display !== 'none') {
                var u = parseFormattedNumber(usdTryEl.value);
                if (u > 0) usdTryVal = u;
            }
            var docData = {
                userId: user.uid,
                category,
                symbol,
                amount,
                unitPrice,
                total,
                date,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            if (usdTryVal != null) docData.usdTry = usdTryVal;

            try {
                await db.collection('dailyPortfolios').add(docData);
                msgEl.className = 'inv-success';
                msgEl.textContent = 'Kayıt başarıyla günlük portföye eklendi. Veriler Portföyüm > Günlük Portföyüm içinde Excel tablosu olarak görünecektir.';
                msgEl.style.display = 'block';
                loadDailyPortfolio();
            } catch (err) {
                console.error(err);
                msgEl.textContent = 'Kayıt sırasında hata oluştu.';
                msgEl.style.display = 'block';
            }
        }

        async function loadDailyPortfolio() {
            const user = auth.currentUser;
            const container = document.getElementById('portfolioDailyContent') || document.getElementById('portfolioContent');
            if (!container) return;

            if (!user) {
                container.innerHTML = 'Günlük portföyü görmek için lütfen giriş yapın.';
                return;
            }

            try {
                var snap = await db.collection('dailyPortfolios')
                    .where('userId', '==', user.uid)
                    .get();

                var rows = [];
                snap.forEach(function(doc) {
                    var d = doc.data();
                    d._id = doc.id;
                    rows.push(d);
                });
                rows.sort(function(a, b) {
                    var da = (a.date || '').replace(/-/g, '');
                    var db = (b.date || '').replace(/-/g, '');
                    return db.localeCompare(da);
                });
                rows = rows.slice(0, 500);

                if (rows.length === 0) {
                    container.innerHTML = '<p style="color:#94a3b8;">Henüz günlük portföy kaydınız bulunmuyor. &quot;Yatırım Ekle&quot; ile kayıt ekleyebilirsiniz.</p>';
                    return;
                }

                var toplamTutar = 0;
                rows.forEach(function(d) { toplamTutar += Number(d.total) || 0; });
                var html = '<div class="portfolio-table-wrap"><table class="portfolio-list"><thead><tr><th>Tarih</th><th>Kategori</th><th>Ürün / Sembol</th><th>Miktar</th><th>Birim Fiyat</th><th>Toplam Yatırım Tutarı</th><th>İşlemler</th></tr></thead><tbody>';
                rows.forEach(function(d) {
                    var docId = d._id || '';
                    html += '<tr data-doc-id="' + docId + '"><td>' + formatDateTR(d.date) + '</td><td>' + (d.category || '-').toString() + '</td><td>' + (d.symbol || '-').toString() + '</td><td>' + (d.amount || 0).toLocaleString('tr-TR') + '</td><td>' + (d.unitPrice || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}) + '</td><td>' + (d.total || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td class="portfolio-actions"><button type="button" class="portfolio-action-btn sil" title="Sil" onclick="deletePortfolioRow(this)"><i class="fas fa-trash-alt"></i> Sil</button> <button type="button" class="portfolio-action-btn duzenle" title="Düzenle" onclick="editPortfolioRow(this)"><i class="fas fa-edit"></i> Düzenle</button> <button type="button" class="portfolio-action-btn kaydet" title="Kaydet" style="display:none" onclick="savePortfolioRow(this)"><i class="fas fa-save"></i> Kaydet</button></td></tr>';
                });
                html += '</tbody><tfoot><tr class="portfolio-total-row"><td colspan="5" style="text-align:right;">Toplam Tutar</td><td>' + toplamTutar.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td></td></tr></tfoot></table></div>';
                container.innerHTML = html;
            } catch (err) {
                console.error(err);
                container.innerHTML = 'Portföy verileri yüklenirken hata oluştu: ' + (err.message || err);
            }
        }

        let cachedDailyRows = [];

        async function loadMonthlyPortfolioList(year, month) {
            const user = auth.currentUser;
            const container = document.getElementById('portfolioMonthlyContent');
            if (!container) return;
            if (!user) {
                container.innerHTML = 'Giriş yapın.';
                return;
            }
            try {
                const snap = await db.collection('dailyPortfolios')
                    .where('userId', '==', user.uid)
                    .get();
                const monthStr = String(month).padStart(2, '0');
                const prefix = year + '-' + monthStr;
                const rows = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    d._id = doc.id;
                    const date = d.date || '';
                    if (date.startsWith(prefix)) rows.push(d);
                });
                rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                cachedDailyRows = rows;
                renderPortfolioTable(container, rows);
            } catch (err) {
                console.error(err);
                container.innerHTML = 'Veriler yüklenirken hata oluştu.';
            }
        }

        async function loadYearlyPortfolioList() {
            const user = auth.currentUser;
            const container = document.getElementById('portfolioYearlyContent');
            const yearSel = document.getElementById('portfolioYearSelect');
            if (!container || !yearSel) return;
            if (!user) {
                container.innerHTML = 'Giriş yapın.';
                return;
            }
            const year = parseInt(yearSel.value, 10);
            try {
                const snap = await db.collection('dailyPortfolios')
                    .where('userId', '==', user.uid)
                    .get();
                const rows = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    d._id = doc.id;
                    const date = d.date || '';
                    if (date.startsWith(String(year))) rows.push(d);
                });
                rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
                window.cachedYearlyRows = rows;
                renderYearlyPortfolioTable(container, rows, '');
            } catch (err) {
                console.error(err);
                container.innerHTML = 'Veriler yüklenirken hata oluştu.';
            }
        }

        function formatDateTR(iso) {
            if (!iso) return '-';
            var p = (iso + '').split('-');
            if (p.length !== 3) return iso;
            return p[2] + '.' + p[1] + '.' + p[0];
        }

        function renderYearlyPortfolioTable(container, rows, filterValue) {
            if (!container) return;
            var fullRows = window.cachedYearlyRows || rows || [];
            filterValue = (filterValue || '').trim();
            var filtered = fullRows;
            if (filterValue) {
                var q = filterValue.toLowerCase();
                filtered = fullRows.filter(function(d) { return (d.symbol || '').toLowerCase().indexOf(q) !== -1; });
            }
            if (filtered.length === 0) {
                container.innerHTML = '<p style="color:#94a3b8;">Bu dönemde kayıt bulunmuyor.' + (filterValue ? ' Filtreyle eşleşen kayıt yok.' : '') + '</p>';
                return;
            }
            var avgCostBySymbol = {};
            fullRows.forEach(function(d) {
                var sym = (d.symbol || '-').toString().trim();
                if (!avgCostBySymbol[sym]) { avgCostBySymbol[sym] = { total: 0, amount: 0 }; }
                avgCostBySymbol[sym].total += Number(d.total) || 0;
                avgCostBySymbol[sym].amount += Number(d.amount) || 0;
            });
            Object.keys(avgCostBySymbol).forEach(function(sym) {
                var t = avgCostBySymbol[sym];
                avgCostBySymbol[sym] = t.amount > 0 ? t.total / t.amount : 0;
            });
            var toplamTutar = 0;
            filtered.forEach(function(d) { toplamTutar += Number(d.total) || 0; });
            var filterValEsc = (filterValue || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var html = '<div class="portfolio-table-wrap portfolio-yearly-wrap"><div class="yearly-portfolio-filter-bar"><label for="yearlyPortfolioSymbolFilter">Ürün / Sembol</label><input type="text" id="yearlyPortfolioSymbolFilter" class="yearly-portfolio-filter-input" placeholder="Filtrele..." value="' + filterValEsc + '" title="Ürün/sembole göre filtrele" /></div><table class="portfolio-list portfolio-yearly-table"><thead><tr><th>Tarih</th><th>Kategori</th><th>Ürün / Sembol</th><th>Ortalama Maliyet</th><th>Miktar</th><th>Birim Fiyat</th><th>Toplam Yatırım Tutarı</th><th>İşlemler</th></tr></thead><tbody>';
            filtered.forEach(function(d) {
                var docId = d._id || '';
                var sym = (d.symbol || '-').toString().trim();
                var avgCost = avgCostBySymbol[sym] || 0;
                html += '<tr data-doc-id="' + docId + '"><td>' + formatDateTR(d.date) + '</td><td>' + (d.category || '-') + '</td><td>' + (d.symbol || '-') + '</td><td>' + avgCost.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}) + '</td><td>' + (d.amount || 0).toLocaleString('tr-TR') + '</td><td>' + (d.unitPrice || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}) + '</td><td>' + (d.total || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td class="portfolio-actions"><button type="button" class="portfolio-action-btn sil" title="Sil" onclick="deletePortfolioRow(this)"><i class="fas fa-trash-alt"></i> Sil</button> <button type="button" class="portfolio-action-btn duzenle" title="Düzenle" onclick="editPortfolioRow(this)"><i class="fas fa-edit"></i> Düzenle</button> <button type="button" class="portfolio-action-btn kaydet" title="Kaydet" style="display:none" onclick="savePortfolioRow(this)"><i class="fas fa-save"></i> Kaydet</button></td></tr>';
            });
            html += '</tbody><tfoot><tr class="portfolio-total-row"><td colspan="6" style="text-align:right;">Toplam Tutar</td><td>' + toplamTutar.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td></td></tr></tfoot></table></div>';
            container.innerHTML = html;
            var filterInput = document.getElementById('yearlyPortfolioSymbolFilter');
            if (filterInput) {
                filterInput.oninput = filterInput.onchange = function() {
                    var val = this.value || '';
                    renderYearlyPortfolioTable(container, fullRows, val);
                };
            }
        }

        function renderPortfolioTable(container, rows) {
            if (!rows || rows.length === 0) {
                container.innerHTML = '<p style="color:#94a3b8;">Bu dönemde kayıt bulunmuyor.</p>';
                return;
            }
            var toplamTutar = 0;
            rows.forEach(function(d) { toplamTutar += Number(d.total) || 0; });
            var html = '<div class="portfolio-table-wrap"><table class="portfolio-list"><thead><tr><th>Tarih</th><th>Kategori</th><th>Ürün / Sembol</th><th>Miktar</th><th>Birim Fiyat</th><th>Toplam Yatırım Tutarı</th><th>İşlemler</th></tr></thead><tbody>';
            rows.forEach(function(d) {
                var docId = d._id || '';
                html += '<tr data-doc-id="' + docId + '"><td>' + formatDateTR(d.date) + '</td><td>' + (d.category || '-') + '</td><td>' + (d.symbol || '-') + '</td><td>' + (d.amount || 0).toLocaleString('tr-TR') + '</td><td>' + (d.unitPrice || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}) + '</td><td>' + (d.total || 0).toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td class="portfolio-actions"><button type="button" class="portfolio-action-btn sil" title="Sil" onclick="deletePortfolioRow(this)"><i class="fas fa-trash-alt"></i> Sil</button> <button type="button" class="portfolio-action-btn duzenle" title="Düzenle" onclick="editPortfolioRow(this)"><i class="fas fa-edit"></i> Düzenle</button> <button type="button" class="portfolio-action-btn kaydet" title="Kaydet" style="display:none" onclick="savePortfolioRow(this)"><i class="fas fa-save"></i> Kaydet</button></td></tr>';
            });
            html += '</tbody><tfoot><tr class="portfolio-total-row"><td colspan="5" style="text-align:right;">Toplam Tutar</td><td>' + toplamTutar.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2}) + '</td><td></td></tr></tfoot></table></div>';
            container.innerHTML = html;
        }

        function getDocIdFromRow(btn) {
            var tr = btn.closest('tr');
            return tr ? tr.getAttribute('data-doc-id') : '';
        }

        async function deletePortfolioRow(btn) {
            var docId = getDocIdFromRow(btn);
            if (!docId) return;
            if (!confirm('Bu satırı silmek istediğinize emin misiniz?')) return;
            var user = auth.currentUser;
            if (!user) { alert('Giriş yapın.'); return; }
            try {
                await db.collection('dailyPortfolios').doc(docId).delete();
                loadDailyPortfolio();
                var monthlyArea = document.getElementById('portfolioMonthlyListArea');
                if (monthlyArea && monthlyArea.style.display !== 'none') {
                    var yearSel = document.getElementById('portfolioMonthlyYearSelect');
                    var title = document.getElementById('portfolioMonthlyTitle');
                    if (yearSel && title) {
                        var m = title.textContent.split(' ');
                        var monthNames = {'Ocak':1,'Şubat':2,'Mart':3,'Nisan':4,'Mayıs':5,'Haziran':6,'Temmuz':7,'Ağustos':8,'Eylül':9,'Ekim':10,'Kasım':11,'Aralık':12};
                        var month = monthNames[m[0]];
                        var year = parseInt(m[1], 10);
                        if (month && year) loadMonthlyPortfolioList(year, month);
                    }
                }
                var yearlyContent = document.getElementById('portfolioYearlyContent');
                if (yearlyContent && yearlyContent.querySelector('table')) loadYearlyPortfolioList();
            } catch (err) {
                console.error(err);
                alert('Silme sırasında hata oluştu.');
            }
        }

        function editPortfolioRow(btn) {
            var tr = btn.closest('tr');
            if (!tr) return;
            var cells = tr.querySelectorAll('td');
            if (cells.length < 7) return;
            var isYearly = (cells.length === 8);
            var docId = tr.getAttribute('data-doc-id');
            tr.setAttribute('data-editing', '1');
            var dateStr = (cells[0].textContent || '').trim();
            var dateParts = dateStr.split('.');
            var dateVal = dateParts.length === 3 ? dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0] : '';
            var catVal = (cells[1].textContent || '').trim();
            var symVal = (cells[2].textContent || '').trim();
            var amtIdx = isYearly ? 4 : 3;
            var unitIdx = isYearly ? 5 : 4;
            var totalIdx = isYearly ? 6 : 5;
            var amtVal = (cells[amtIdx].textContent || '').replace(/\./g,'').replace(',','.').trim();
            var unitVal = (cells[unitIdx].textContent || '').replace(/\./g,'').replace(',','.').trim();
            var totalVal = (cells[totalIdx].textContent || '').replace(/\./g,'').replace(',','.').trim();
            cells[0].innerHTML = '<input type="date" class="portfolio-edit-input" data-field="date" value="' + (dateVal || '') + '" />';
            cells[1].innerHTML = '<input type="text" class="portfolio-edit-input" data-field="category" value="' + (catVal || '').replace(/"/g,'&quot;') + '" />';
            cells[2].innerHTML = '<input type="text" class="portfolio-edit-input" data-field="symbol" value="' + (symVal || '').replace(/"/g,'&quot;') + '" />';
            if (isYearly) cells[3].innerHTML = '<span class="portfolio-edit-readonly">—</span>';
            cells[amtIdx].innerHTML = '<input type="number" class="portfolio-edit-input" data-field="amount" step="0.0001" value="' + (amtVal || '') + '" />';
            cells[unitIdx].innerHTML = '<input type="number" class="portfolio-edit-input" data-field="unitPrice" step="0.0001" value="' + (unitVal || '') + '" />';
            cells[totalIdx].innerHTML = '<input type="number" class="portfolio-edit-input" data-field="total" step="0.01" value="' + (totalVal || '') + '" />';
            btn.style.display = 'none';
            tr.querySelector('.portfolio-action-btn.kaydet').style.display = 'inline-flex';
        }

        async function savePortfolioRow(btn) {
            var tr = btn.closest('tr');
            if (!tr) return;
            var docId = tr.getAttribute('data-doc-id');
            if (!docId) return;
            var user = auth.currentUser;
            if (!user) { alert('Giriş yapın.'); return; }
            var dateInput = tr.querySelector('input[data-field="date"]');
            var catInput = tr.querySelector('input[data-field="category"]');
            var symInput = tr.querySelector('input[data-field="symbol"]');
            var amtInput = tr.querySelector('input[data-field="amount"]');
            var unitInput = tr.querySelector('input[data-field="unitPrice"]');
            var totalInput = tr.querySelector('input[data-field="total"]');
            var date = dateInput ? dateInput.value : '';
            var category = catInput ? catInput.value.trim() : '';
            var symbol = symInput ? symInput.value.trim() : '';
            var amount = parseFloat(amtInput ? amtInput.value.replace(',','.') : '0') || 0;
            var unitPrice = parseFloat(unitInput ? unitInput.value.replace(',','.') : '0') || 0;
            var total = parseFloat(totalInput ? totalInput.value.replace(',','.') : '0') || 0;
            if (!date || !symbol || amount <= 0) {
                alert('Tarih, ürün/sembol ve miktar zorunludur.');
                return;
            }
            if (unitPrice <= 0 && total <= 0) {
                alert('Birim fiyat veya toplam tutar girilmelidir.');
                return;
            }
            if (unitPrice > 0 && total <= 0) total = amount * unitPrice;
            if (total > 0 && unitPrice <= 0) unitPrice = total / amount;
            try {
                await db.collection('dailyPortfolios').doc(docId).update({
                    category: category || 'GENEL',
                    symbol,
                    amount,
                    unitPrice,
                    total,
                    date
                });
                loadDailyPortfolio();
                var monthlyArea = document.getElementById('portfolioMonthlyListArea');
                if (monthlyArea && monthlyArea.style.display !== 'none') {
                    var yearSel = document.getElementById('portfolioMonthlyYearSelect');
                    var title = document.getElementById('portfolioMonthlyTitle');
                    if (yearSel && title) {
                        var m = title.textContent.split(' ');
                        var monthNames = {'Ocak':1,'Şubat':2,'Mart':3,'Nisan':4,'Mayıs':5,'Haziran':6,'Temmuz':7,'Ağustos':8,'Eylül':9,'Ekim':10,'Kasım':11,'Aralık':12};
                        var month = monthNames[m[0]];
                        var year = parseInt(m[1], 10);
                        if (month && year) loadMonthlyPortfolioList(year, month);
                    }
                }
                var yearlyContent = document.getElementById('portfolioYearlyContent');
                if (yearlyContent && yearlyContent.querySelector('table')) loadYearlyPortfolioList();
            } catch (err) {
                console.error(err);
                alert('Kaydetme sırasında hata oluştu.');
            }
        }

        async function saveYearlyPortfolio() {
            const user = auth.currentUser;
            if (!user) {
                alert('Kaydetmek için giriş yapın.');
                return;
            }
            const yearSel = document.getElementById('portfolioYearSelect');
            const year = yearSel ? parseInt(yearSel.value, 10) : new Date().getFullYear();
            const rows = window.cachedYearlyRows || [];
            if (rows.length === 0) {
                alert('Bu yıla ait kayıt bulunmuyor.');
                return;
            }
            try {
                const batch = db.batch();
                rows.forEach((row, idx) => {
                    const ref = db.collection('yearlyPortfolios').doc(user.uid + '_' + year + '_' + idx);
                    batch.set(ref, {
                        userId: user.uid,
                        year,
                        ...row,
                        savedAt: firebase.firestore.FieldValue.serverTimestamp()
                    });
                });
                await batch.commit();
                alert('Yıllık portföy kaydedildi.');
            } catch (err) {
                console.error(err);
                alert('Kayıt sırasında hata oluştu.');
            }
        }

        function exportPortfolioToExcel(type) {
            const user = auth.currentUser;
            if (!user) {
                alert('Excel indirmek için giriş yapın.');
                return;
            }
            let rows = [];
            if (type === 'daily') {
                const container = document.getElementById('portfolioDailyContent');
                if (!container) return;
                const tbody = container.querySelector('table tbody');
                if (!tbody) { alert('İndirilecek veri yok.'); return; }
                tbody.querySelectorAll('tr').forEach(tr => {
                    const cells = tr.querySelectorAll('td');
                    if (cells.length >= 6) rows.push([cells[0].textContent, cells[1].textContent, cells[2].textContent, cells[3].textContent, cells[4].textContent, cells[5].textContent]);
                });
            } else if (type === 'monthly') {
                rows = cachedDailyRows.map(d => [d.date || '', d.category || '', d.symbol || '', (d.amount || 0).toLocaleString('tr-TR'), (d.unitPrice || 0).toLocaleString('tr-TR'), (d.total || 0).toLocaleString('tr-TR')]);
            } else if (type === 'yearly') {
                var yearlyRows = window.cachedYearlyRows || [];
                var avgBySym = {};
                yearlyRows.forEach(function(d) {
                    var s = (d.symbol || '-').toString().trim();
                    if (!avgBySym[s]) avgBySym[s] = { t: 0, a: 0 };
                    avgBySym[s].t += Number(d.total) || 0;
                    avgBySym[s].a += Number(d.amount) || 0;
                });
                Object.keys(avgBySym).forEach(function(s) { avgBySym[s] = avgBySym[s].a > 0 ? (avgBySym[s].t / avgBySym[s].a) : 0; });
                rows = yearlyRows.map(d => {
                    var s = (d.symbol || '-').toString().trim();
                    var avg = avgBySym[s] || 0;
                    return [d.date || '', d.category || '', d.symbol || '', avg.toLocaleString('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4}), (d.amount || 0).toLocaleString('tr-TR'), (d.unitPrice || 0).toLocaleString('tr-TR'), (d.total || 0).toLocaleString('tr-TR')];
                });
            }
            if (rows.length === 0) {
                alert('İndirilecek veri yok.');
                return;
            }
            var header = type === 'yearly' ? ['Tarih', 'Kategori', 'Ürün/Sembol', 'Ortalama Maliyet', 'Miktar', 'Birim Fiyat', 'Toplam'] : ['Tarih', 'Kategori', 'Ürün/Sembol', 'Miktar', 'Birim Fiyat', 'Toplam'];
            const csvContent = '\uFEFF' + [header.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = (type === 'daily' ? 'gunluk' : type === 'monthly' ? 'aylik' : 'yillik') + '-portfoy-' + new Date().toISOString().slice(0,10) + '.csv';
            link.click();
            URL.revokeObjectURL(link.href);
        }

        async function ensureUserProfileForSearch(user) {
            if (!user) return;
            try {
                const snap = await db.collection('userProfiles').where('userId', '==', user.uid).limit(1).get();
                if (!snap.empty) return;
                await db.collection('userProfiles').add({
                    userId: user.uid,
                    email: user.email || '',
                    adSoyad: user.displayName || (user.email ? user.email.split('@')[0] : '') || 'Kullanıcı',
                    photoUrl: user.photoURL || '',
                    friendsListVisible: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                if (typeof incrementTotalMemberCount === 'function') incrementTotalMemberCount();
            } catch (e) { console.error('Profil oluşturma:', e); }
        }

        (function stripNavHash() {
            var h = (window.location.hash || '').replace(/^#/, '');
            if (h === 'mesajlar' || h === 'profil' || h === 'ana-sayfa' || h === 'kisi-ara') {
                if (typeof history !== 'undefined' && history.replaceState) {
                    history.replaceState({}, '', (window.location.pathname || '/') + (window.location.search || ''));
                }
            }
            if (h === 'canli-yayin') {
                var roomParam = new URLSearchParams(window.location.search).get('room');
                if (roomParam && typeof roomParam === 'string') {
                    var cleaned = roomParam.replace(/[^a-zA-Z0-9\-]/g, '');
                    if (cleaned) currentCanliYayinRoomId = cleaned;
                }
            }
        })();
        function tryOpenToplantiJoinLink() {
            var h = (window.location.hash || '').replace(/^#/, '');
            var prefix = 'toplanti-join-';
            if (h.indexOf(prefix) !== 0) {
                var b = document.getElementById('toplantiDavetBanner');
                if (b) b.style.display = 'none';
                return;
            }
            var roomId = h.slice(prefix.length);
            try { roomId = decodeURIComponent(roomId); } catch (e) {}
            roomId = (roomId || '').replace(/[^a-zA-Z0-9\-]/g, '') || '';
            if (!roomId) return;
            var banner = document.getElementById('toplantiDavetBanner');
            var btn = document.getElementById('toplantiDavetBannerBtn');
            if (banner && btn) {
                banner.style.display = 'block';
                btn.onclick = function() {
                    if (typeof openMeetingInvite === 'function') openMeetingInvite(roomId);
                    banner.style.display = 'none';
                    if (typeof history !== 'undefined' && history.replaceState) history.replaceState({}, '', (window.location.pathname || '/') + (window.location.search || ''));
                };
                return;
            }
            if (typeof openMeetingInvite === 'function') {
                openMeetingInvite(roomId);
                if (typeof history !== 'undefined' && history.replaceState) history.replaceState({}, '', (window.location.pathname || '/') + (window.location.search || ''));
            }
        }
        function tryOpenCanliYayinInviteModal() {
            var h = (window.location.hash || '').replace(/^#/, '');
            if (h !== 'canli-yayin' || !auth.currentUser) return;
            var roomParam = new URLSearchParams(window.location.search).get('room');
            var room = (roomParam && String(roomParam).replace(/[^a-zA-Z0-9\-]/g, '')) || '';
            if (room && typeof openMeetingInvite === 'function') {
                openMeetingInvite(room, false);
                return;
            }
            if (typeof openCanliYayinlarimModal === 'function') {
                openCanliYayinlarimModal(true);
                if (typeof history !== 'undefined' && history.replaceState) history.replaceState({}, '', (window.location.pathname || '/'));
            }
        }
        /* Sosyal Ağ menü tıklamaları için fonksiyonları global (window) yap */
        window.openMyProfileView = openMyProfileView;
        window.openAnaSayfamModal = openAnaSayfamModal;
        window.openFriendsModal = openFriendsModal;
        window.openNotificationsPanel = openNotificationsPanel;
        window.toggleYorumlarimDropdown = toggleYorumlarimDropdown;
        window.toggleYorumlarimPanel = toggleYorumlarimPanel;
        window.closeYorumlarimPanel = closeYorumlarimPanel;
        window.closeYorumlarimDropdown = closeYorumlarimDropdown;
        window.openYorumYazModal = openYorumYazModal;
        window.submitYorum = submitYorum;
        window.closeYorumYazModal = closeYorumYazModal;
        window.yorumYazClearQuote = yorumYazClearQuote;
        window.openYorumlarimFeedModal = openYorumlarimFeedModal;
        window.setYorumlarimActiveBaslik = setYorumlarimActiveBaslik;
        window.yorumYazDurum = function() {
            var n = typeof yorumYazMediaFiles !== 'undefined' ? yorumYazMediaFiles.length : 0;
            var stor = typeof firebase !== 'undefined' && firebase.storage ? firebase.storage() : null;
            var msg = 'Yorum Yaz durum: ' + n + ' medya ekli. Storage: ' + (stor ? 'var' : 'yok');
            if (typeof console !== 'undefined' && console.log) console.log(msg);
            return msg;
        };
        window.openBegendiklerimModal = openBegendiklerimModal;
        window.openFotograflarimModal = openFotograflarimModal;
        window.openVideolarimModal = openVideolarimModal;
        window.openFavorilerimModal = openFavorilerimModal;
        window.openForumModal = openForumModal;
        window.openKariyerimModal = openKariyerimModal;
        window.openToplantilarimModal = openToplantilarimModal;
        window.openCanliYayinlarimModal = openCanliYayinlarimModal;
        window.openMeetingInvite = openMeetingInvite;
        window.openOturumSahibiToplanti = openOturumSahibiToplanti;
        window.closeToplantiKatilModal = closeToplantiKatilModal;
        window.submitToplantiKatil = submitToplantiKatil;
        auth.onAuthStateChanged(user => {
            console.log('Auth state:', user ? user.email : 'Çıkış');
            updateAuthButtons(user);
            if (user) {
                try { sessionStorage.removeItem('fs_ios_redirect_retry_reloaded'); } catch (e0) {}
                /* Mobil tarayıcıda getRedirectResult bazen DOMContentLoaded’dan sonra oturumu tamamlar; yedek tamamlayıcı */
                try {
                    setTimeout(function() { tryFinishGoogleRedirectFromAuthState(); }, 180);
                    setTimeout(function() { tryFinishGoogleRedirectFromAuthState(); }, 1400);
                } catch (eTry) {}
                try { if (typeof fsSetGoogleLoginUiBusy === 'function') fsSetGoogleLoginUiBusy(false); } catch (eBusy) {}
                ensureUserProfileForSearch(user);
                loadDailyPortfolio();
                if (typeof loadTotalMemberCount === 'function') loadTotalMemberCount();
                if (typeof refreshNotificationsPanelBadge === 'function') refreshNotificationsPanelBadge();
                tryOpenCanliYayinInviteModal();
                tryOpenToplantiJoinLink();
            } else {
                try { window.__fsGoogleRedirectFinalizeDone = false; } catch (eD) {}
                try { sessionStorage.removeItem('fs_ios_post_auth_reloaded'); } catch (e) {}
                try { sessionStorage.removeItem('fs_ios_redirect_retry_reloaded'); } catch (e2) {}
            }
        });
        setTimeout(tryOpenCanliYayinInviteModal, 500);
        setTimeout(tryOpenToplantiJoinLink, 300);
        window.addEventListener('hashchange', function() { tryOpenToplantiJoinLink(); });