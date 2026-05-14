(function() {
    function sma(values, period) {
        var out = new Array(values.length).fill(null);
        if (!values || values.length < period) return out;
        var sum = 0;
        for (var i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= period) sum -= values[i - period];
            if (i >= period - 1) out[i] = sum / period;
        }
        return out;
    }

    function ema(values, period) {
        var out = new Array(values.length).fill(null);
        if (!values || !values.length) return out;
        var k = 2 / (period + 1);
        var prev = values[0];
        out[0] = prev;
        for (var i = 1; i < values.length; i++) {
            prev = (values[i] * k) + (prev * (1 - k));
            out[i] = prev;
        }
        return out;
    }

    function rsi(values, period) {
        var out = new Array(values.length).fill(null);
        if (!values || values.length <= period) return out;
        var gain = 0, loss = 0;
        for (var i = 1; i <= period; i++) {
            var diff = values[i] - values[i - 1];
            if (diff >= 0) gain += diff; else loss += Math.abs(diff);
        }
        var avgGain = gain / period;
        var avgLoss = loss / period;
        out[period] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
        for (var j = period + 1; j < values.length; j++) {
            var d = values[j] - values[j - 1];
            avgGain = ((avgGain * (period - 1)) + Math.max(d, 0)) / period;
            avgLoss = ((avgLoss * (period - 1)) + Math.max(-d, 0)) / period;
            out[j] = avgLoss === 0 ? 100 : (100 - (100 / (1 + (avgGain / avgLoss))));
        }
        return out;
    }

    function bollinger(values, period, mult) {
        var mid = sma(values, period);
        var upper = new Array(values.length).fill(null);
        var lower = new Array(values.length).fill(null);
        for (var i = period - 1; i < values.length; i++) {
            var m = mid[i];
            if (m == null) continue;
            var sumSq = 0;
            for (var j = i - period + 1; j <= i; j++) {
                var diff = values[j] - m;
                sumSq += diff * diff;
            }
            var sd = Math.sqrt(sumSq / period);
            upper[i] = m + (mult * sd);
            lower[i] = m - (mult * sd);
        }
        return { mid: mid, upper: upper, lower: lower };
    }

    function macd(values) {
        var ema12 = ema(values, 12);
        var ema26 = ema(values, 26);
        var line = new Array(values.length).fill(null);
        for (var i = 0; i < values.length; i++) {
            if (ema12[i] == null || ema26[i] == null) continue;
            line[i] = ema12[i] - ema26[i];
        }
        var signal = ema(line.map(function(v) { return v == null ? 0 : v; }), 9);
        var hist = new Array(values.length).fill(null);
        for (var k = 0; k < values.length; k++) {
            if (line[k] == null || signal[k] == null) continue;
            hist[k] = line[k] - signal[k];
        }
        return { line: line, signal: signal, hist: hist };
    }

    function obv(candles) {
        var out = new Array(candles.length).fill(0);
        for (var i = 1; i < candles.length; i++) {
            var prev = candles[i - 1].close;
            var cur = candles[i].close;
            var vol = candles[i].volume || 0;
            if (cur > prev) out[i] = out[i - 1] + vol;
            else if (cur < prev) out[i] = out[i - 1] - vol;
            else out[i] = out[i - 1];
        }
        return out;
    }

    function kdj(candles, period) {
        var K = new Array(candles.length).fill(null);
        var D = new Array(candles.length).fill(null);
        var J = new Array(candles.length).fill(null);
        var k = 50, d = 50;
        for (var i = period - 1; i < candles.length; i++) {
            var hh = -Infinity, ll = Infinity;
            for (var j = i - period + 1; j <= i; j++) {
                if (candles[j].high > hh) hh = candles[j].high;
                if (candles[j].low < ll) ll = candles[j].low;
            }
            var rsv = hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100;
            k = (2 / 3) * k + (1 / 3) * rsv;
            d = (2 / 3) * d + (1 / 3) * k;
            var jv = 3 * k - 2 * d;
            K[i] = k; D[i] = d; J[i] = jv;
        }
        return { K: K, D: D, J: J };
    }

    function fibLevels(candles, lookback) {
        var start = Math.max(0, candles.length - lookback);
        var hi = -Infinity, lo = Infinity;
        for (var i = start; i < candles.length; i++) {
            if (candles[i].high > hi) hi = candles[i].high;
            if (candles[i].low < lo) lo = candles[i].low;
        }
        var range = hi - lo;
        return {
            low: lo,
            high: hi,
            l382: hi - (range * 0.382),
            l5: hi - (range * 0.5),
            l618: hi - (range * 0.618)
        };
    }

    function supportResistance(candles, lookback) {
        var start = Math.max(0, candles.length - lookback);
        var support = Infinity, resistance = -Infinity;
        for (var i = start; i < candles.length; i++) {
            if (candles[i].low < support) support = candles[i].low;
            if (candles[i].high > resistance) resistance = candles[i].high;
        }
        return { support: support, resistance: resistance };
    }

    function highestHigh(candles, from, to) {
        var h = -Infinity;
        for (var i = from; i <= to; i++) if (candles[i] && candles[i].high > h) h = candles[i].high;
        return h;
    }

    function lowestLow(candles, from, to) {
        var l = Infinity;
        for (var i = from; i <= to; i++) if (candles[i] && candles[i].low < l) l = candles[i].low;
        return l;
    }

    function isPivotHigh(candles, i, left, right) {
        if (i - left < 0 || i + right >= candles.length) return false;
        var p = candles[i].high;
        for (var a = i - left; a <= i + right; a++) {
            if (a === i) continue;
            if (candles[a].high >= p) return false;
        }
        return true;
    }

    function isPivotLow(candles, i, left, right) {
        if (i - left < 0 || i + right >= candles.length) return false;
        var p = candles[i].low;
        for (var a = i - left; a <= i + right; a++) {
            if (a === i) continue;
            if (candles[a].low <= p) return false;
        }
        return true;
    }

    function fallingStreak(candles, i, n) {
        if (i - n + 1 < 1) return false;
        for (var k = i - n + 1; k <= i; k++) {
            if (!(candles[k].close < candles[k - 1].close)) return false;
        }
        return true;
    }

    function risingStreak(candles, i, n) {
        if (i - n + 1 < 1) return false;
        for (var k = i - n + 1; k <= i; k++) {
            if (!(candles[k].close > candles[k - 1].close)) return false;
        }
        return true;
    }

    function linearSlope(values, from, to) {
        if (from < 0 || to <= from) return 0;
        var n = to - from + 1;
        var sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
        for (var i = 0; i < n; i++) {
            var x = i;
            var y = values[from + i];
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }
        var denom = (n * sumXX - sumX * sumX) || 1e-9;
        return (n * sumXY - sumX * sumY) / denom;
    }

    function detectWedgeState(candles, i) {
        if (i < 35) return { risingWedge: false, fallingWedge: false };
        var start = i - 30;
        var highs = [], lows = [];
        for (var a = start; a <= i; a++) { highs.push(candles[a].high); lows.push(candles[a].low); }
        var sh = linearSlope(highs, 0, highs.length - 1);
        var sl = linearSlope(lows, 0, lows.length - 1);
        var highRange = Math.max.apply(null, highs) - Math.min.apply(null, highs);
        var lowRange = Math.max.apply(null, lows) - Math.min.apply(null, lows);
        var converging = Math.abs(highRange - lowRange) / Math.max(1e-9, Math.max(highRange, lowRange)) < 0.45;
        return {
            risingWedge: converging && sh > 0 && sl > 0 && sl > sh,
            fallingWedge: converging && sh < 0 && sl < 0 && sl > sh
        };
    }

    function detectTrendBreaks(candles, i) {
        if (i < 26) return { upBreak: false, downBreak: false };
        var start = i - 20;
        var highs = [], lows = [];
        for (var a = start; a <= i - 1; a++) { highs.push(candles[a].high); lows.push(candles[a].low); }
        var expRes = highs[highs.length - 1] + linearSlope(highs, 0, highs.length - 1);
        var expSup = lows[lows.length - 1] + linearSlope(lows, 0, lows.length - 1);
        return {
            upBreak: candles[i].close > expRes && candles[i - 1].close <= highs[highs.length - 1],
            downBreak: candles[i].close < expSup && candles[i - 1].close >= lows[lows.length - 1]
        };
    }

    function detectClassicPatterns(candles, i) {
        if (i < 60) return { cupHandleBull: false, inverseCupHandleBear: false, hnsBear: false, invHnsBull: false };
        var from = i - 55;
        var mid = from + 27;
        var leftHigh = highestHigh(candles, from, from + 12);
        var rightHigh = highestHigh(candles, i - 12, i);
        var centerLow = lowestLow(candles, mid - 8, mid + 8);
        var centerHigh = highestHigh(candles, mid - 8, mid + 8);
        var leftLow = lowestLow(candles, from, from + 12);
        var rightLow = lowestLow(candles, i - 12, i);
        var shoulderBalance = Math.abs(leftHigh - rightHigh) / Math.max(1e-9, (leftHigh + rightHigh) / 2) < 0.05;
        var troughBalance = Math.abs(leftLow - rightLow) / Math.max(1e-9, (leftLow + rightLow) / 2) < 0.06;
        var cupHandleBull = centerLow < leftLow && centerLow < rightLow && candles[i].close > rightHigh * 0.99;
        var inverseCupHandleBear = centerHigh > leftHigh && centerHigh > rightHigh && candles[i].close < rightLow * 1.01;
        var hnsBear = shoulderBalance && centerHigh > leftHigh * 1.02 && centerHigh > rightHigh * 1.02 && candles[i].close < Math.min(leftLow, rightLow);
        var invHnsBull = troughBalance && centerLow < leftLow * 0.98 && centerLow < rightLow * 0.98 && candles[i].close > Math.max(leftHigh, rightHigh);
        return { cupHandleBull: cupHandleBull, inverseCupHandleBear: inverseCupHandleBear, hnsBear: hnsBear, invHnsBull: invHnsBull };
    }

    function detectGannBias(candles, i) {
        if (i < 12) return { gannBull: false, gannBear: false };
        var base = candles[i - 8].close || candles[i - 8].open;
        var slope = (candles[i].close - base) / 8;
        var angle45 = base / 100;
        return {
            gannBull: slope > angle45 * 0.15 && candles[i].close > candles[i - 1].high,
            gannBear: slope < -angle45 * 0.15 && candles[i].close < candles[i - 1].low
        };
    }

    function normalizeSignalSequence(signals, profile) {
        if (!signals || signals.length <= 1) return signals || [];
        var out = [];
        // Geçmişte sinyal yoğunluğunu korumak için minimum sadeleştirme.
        var minGap = Math.max(2, Math.floor((profile.cooldownStep || 20) / 16));
        for (var i = 0; i < signals.length; i++) {
            var s = signals[i];
            if (!out.length) { out.push(s); continue; }
            var last = out[out.length - 1];
            var gap = (s.time || 0) - (last.time || 0);
            if (s.side === last.side) {
                // Aynı yönde sık gelen sinyallerden daha kaliteli olanı tut.
                var sRank = (s.strength === 'strong' ? 2 : 1) * 1000 + (s.score || 0);
                var lRank = (last.strength === 'strong' ? 2 : 1) * 1000 + (last.score || 0);
                var betterPrice = (s.side === 'buy') ? ((s.price || 0) <= (last.price || 0)) : ((s.price || 0) >= (last.price || 0));
                if (sRank > lRank || (gap <= minGap && betterPrice)) out[out.length - 1] = s;
                continue;
            }
            // Zıt yön sinyalleri mümkün olduğunca kalsın; yalnızca aynı/çok yakın mumda sadeleştir.
            if (gap <= minGap) {
                var sW = (s.strength === 'strong' ? 3 : 1) + (s.score || 0) / 10;
                var lW = (last.strength === 'strong' ? 3 : 1) + (last.score || 0) / 10;
                if (sW > lW) out[out.length - 1] = s;
                continue;
            }
            out.push(s);
        }
        return out;
    }

    function keepBestSwingExtremes(signals) {
        if (!signals || signals.length <= 1) return signals || [];
        var out = [];
        function rank(v) { return (v && v.strength === 'strong' ? 2000 : 1000) + (v && v.score ? v.score : 0); }
        function pickBetter(a, b) {
            if (!a) return b;
            if (!b) return a;
            if (a.side !== b.side) return b;
            var ar = rank(a), br = rank(b);
            if (a.side === 'buy') {
                // Al için daha dip fiyatı tercih et; eşitlikte skor güçlü olanı al.
                if ((b.price || 0) < (a.price || 0)) return b;
                if ((b.price || 0) === (a.price || 0) && br >= ar) return b;
                return ar > br ? a : b;
            }
            // Sat için daha tepe fiyatı tercih et; eşitlikte skor güçlü olanı al.
            if ((b.price || 0) > (a.price || 0)) return b;
            if ((b.price || 0) === (a.price || 0) && br >= ar) return b;
            return ar > br ? a : b;
        }
        var pending = null;
        for (var i = 0; i < signals.length; i++) {
            var s = signals[i];
            if (!pending) { pending = s; continue; }
            if (s.side === pending.side) {
                pending = pickBetter(pending, s);
                continue;
            }
            out.push(pending);
            pending = s;
        }
        if (pending) out.push(pending);
        return out;
    }

    function enforcePriceSideDiscipline(signals, candles, profile) {
        if (!signals || !signals.length || !candles || !candles.length) return signals || [];
        var byTime = {};
        for (var i = 0; i < candles.length; i++) byTime[String(candles[i].time)] = i;
        var out = [];
        for (var s = 0; s < signals.length; s++) {
            var sig = signals[s];
            var idx = byTime[String(sig.time)];
            if (idx == null) { out.push(sig); continue; }
            var from = Math.max(0, idx - Math.max(20, profile.extremeWindow || 60));
            var lo = lowestLow(candles, from, idx);
            var hi = highestHigh(candles, from, idx);
            var rng = Math.max(1e-9, hi - lo);
            var px = (sig.side === 'buy') ? (sig.price || candles[idx].low || candles[idx].close) : (sig.price || candles[idx].high || candles[idx].close);
            var pos = (px - lo) / rng; // 0=dip, 1=tepe
            var buyHardMax = Math.min(0.42, (profile.bottomZoneMax || 0.30) + 0.08);
            var sellHardMin = Math.max(0.58, (profile.topZoneMin || 0.72) - 0.08);
            var nearLow = lo > 0 && px <= lo * (1 + (profile.extremeTol || 0.006) * 1.25);
            var nearHigh = hi > 0 && px >= hi * (1 - (profile.extremeTol || 0.006) * 1.25);
            if (sig.side === 'buy') {
                if (pos <= buyHardMax || nearLow) out.push(sig);
                continue;
            }
            if (pos >= sellHardMin || nearHigh) out.push(sig);
        }
        return out;
    }

    function injectMissedSwingOpportunities(signals, candles, profile, buyScoreByTime, sellScoreByTime) {
        if (!signals || !candles || candles.length < 40) return signals || [];
        var out = (signals || []).slice().sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
        var idxByTime = {};
        for (var i = 0; i < candles.length; i++) idxByTime[String(candles[i].time)] = i;
        var sideTimes = { buy: [], sell: [] };
        for (var s = 0; s < out.length; s++) {
            var sig = out[s];
            if (idxByTime[String(sig.time)] != null) sideTimes[sig.side].push(idxByTime[String(sig.time)]);
        }
        var minGapBars = Math.max(4, Math.floor((profile.cooldownStep || 12) / 2));
        function hasNear(side, idx) {
            var arr = sideTimes[side] || [];
            for (var k = 0; k < arr.length; k++) if (Math.abs(arr[k] - idx) <= minGapBars) return true;
            return false;
        }
        function addSig(sig, idx) {
            out.push(sig);
            if (!sideTimes[sig.side]) sideTimes[sig.side] = [];
            sideTimes[sig.side].push(idx);
        }
        for (var j = Math.max(10, profile.pivotLeft + 2); j < candles.length - Math.max(3, profile.pivotRight + 1); j++) {
            var c = candles[j];
            var from = Math.max(0, j - Math.max(24, Math.floor((profile.extremeWindow || 60) / 2)));
            var hi = highestHigh(candles, from, j);
            var lo = lowestLow(candles, from, j);
            var rng = Math.max(1e-9, hi - lo);
            var pos = (c.close - lo) / rng; // 0=dip 1=tepe
            var buyScore = buyScoreByTime[String(c.time)] || 0;
            var sellScore = sellScoreByTime[String(c.time)] || 0;
            var pivotL = isPivotLow(candles, j, profile.pivotLeft, profile.pivotRight);
            var pivotH = isPivotHigh(candles, j, profile.pivotLeft, profile.pivotRight);
            var buyOk = pivotL && pos <= Math.min(0.40, (profile.bottomZoneMax || 0.30) + 0.12) && buyScore >= Math.max(4, (profile.step || 7) - 2);
            var sellOk = pivotH && pos >= Math.max(0.60, (profile.topZoneMin || 0.72) - 0.12) && sellScore >= Math.max(4, (profile.step || 7) - 2);
            if (buyOk && !hasNear('buy', j)) {
                addSig({ time: c.time, price: c.low, side: 'buy', strength: 'step', label: 'AL', score: buyScore }, j);
            }
            if (sellOk && !hasNear('sell', j)) {
                addSig({ time: c.time, price: c.high, side: 'sell', strength: 'step', label: 'SAT', score: sellScore }, j);
            }
        }
        out.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
        return out;
    }

    function getIntervalProfile(interval) {
        var iv = String(interval || '60').toUpperCase();
        if (iv === '1' || iv === '1M') {
            return {
                strong: 10,
                step: 8,
                pivotLeft: 8,
                pivotRight: 5,
                cooldownStrong: 12,
                cooldownStep: 18,
                extremeWindow: 72,
                extremeTol: 0.0055,
                drawdownStrongMin: 0.022,
                bottomZoneMax: 0.22,
                topZoneMin: 0.78,
                swingTol: 0.0022,
                precisionTol: 0.0022
            };
        }
        if (iv === '60' || iv === '1H') {
            return {
                strong: 9,
                step: 7,
                pivotLeft: 7,
                pivotRight: 4,
                cooldownStrong: 10,
                cooldownStep: 14,
                extremeWindow: 56,
                extremeTol: 0.0058,
                drawdownStrongMin: 0.02,
                bottomZoneMax: 0.26,
                topZoneMin: 0.74,
                swingTol: 0.0028,
                precisionTol: 0.0028
            };
        }
        if (iv === '120' || iv === '2H') {
            return {
                strong: 9,
                step: 7,
                pivotLeft: 7,
                pivotRight: 4,
                cooldownStrong: 10,
                cooldownStep: 14,
                extremeWindow: 60,
                extremeTol: 0.0058,
                drawdownStrongMin: 0.02,
                bottomZoneMax: 0.25,
                topZoneMin: 0.75,
                swingTol: 0.0026,
                precisionTol: 0.0026
            };
        }
        if (iv === '240' || iv === '4H') {
            return {
                strong: 11,
                step: 9,
                pivotLeft: 8,
                pivotRight: 5,
                cooldownStrong: 10,
                cooldownStep: 14,
                extremeWindow: 60,
                extremeTol: 0.006,
                drawdownStrongMin: 0.02,
                bottomZoneMax: 0.20,
                topZoneMin: 0.80,
                swingTol: 0.0022,
                precisionTol: 0.0019
            };
        }
        if (iv === 'D' || iv === '1D') {
            return {
                strong: 10,
                step: 8,
                pivotLeft: 9,
                pivotRight: 5,
                cooldownStrong: 14,
                cooldownStep: 20,
                extremeWindow: 90,
                extremeTol: 0.007,
                drawdownStrongMin: 0.02,
                bottomZoneMax: 0.24,
                topZoneMin: 0.76,
                swingTol: 0.0032,
                precisionTol: 0.0028
            };
        }
        if (iv === 'W' || iv === '1W') {
            return {
                strong: 11,
                step: 9,
                pivotLeft: 10,
                pivotRight: 6,
                cooldownStrong: 16,
                cooldownStep: 24,
                extremeWindow: 100,
                extremeTol: 0.0075,
                drawdownStrongMin: 0.022,
                bottomZoneMax: 0.22,
                topZoneMin: 0.78,
                swingTol: 0.0035,
                precisionTol: 0.0032
            };
        }
        if (iv === 'M' || iv === '1M') {
            return {
                strong: 11,
                step: 9,
                pivotLeft: 10,
                pivotRight: 6,
                cooldownStrong: 18,
                cooldownStep: 26,
                extremeWindow: 120,
                extremeTol: 0.008,
                drawdownStrongMin: 0.024,
                bottomZoneMax: 0.21,
                topZoneMin: 0.79,
                swingTol: 0.004,
                precisionTol: 0.0036
            };
        }
        return {
            strong: 8,
            step: 6,
            pivotLeft: 5,
            pivotRight: 3,
            cooldownStrong: 8,
            cooldownStep: 12,
            extremeWindow: 48,
            extremeTol: 0.006,
            drawdownStrongMin: 0.02,
            bottomZoneMax: 0.3,
            topZoneMin: 0.72,
            swingTol: 0.0035,
            precisionTol: 0.0035
        };
    }

    function intervalToSeconds(interval) {
        var v = String(interval || '60').toUpperCase();
        if (v === '1') return 60;
        if (v === '60') return 3600;
        if (v === '120') return 7200;
        if (v === '240') return 14400;
        if (v === 'D' || v === '1D') return 86400;
        if (v === 'W' || v === '1W') return 604800;
        if (v === 'M' || v === '1M') return 2592000;
        return 3600;
    }

    function analyze(candles, opts) {
        opts = opts || {};
        if (!candles || candles.length < 80) return { signals: [], lastSignal: null, summary: 'Yeterli veri yok' };
        var profile = getIntervalProfile(opts.interval);
        var iv = String(opts.interval || '60').toUpperCase();
        var close = candles.map(function(c) { return c.close; });
        var ma50 = sma(close, 50);
        var ma200 = sma(close, 200);
        var r = rsi(close, 14);
        var bb = bollinger(close, 20, 2);
        var m = macd(close);
        var o = obv(candles);
        var k = kdj(candles, 9);
        var sr = supportResistance(candles, 120);
        var fib = fibLevels(candles, 120);
        var signals = [];
        var buyScoreByTime = {};
        var sellScoreByTime = {};

        var lastBuyIdx = -999;
        var lastSellIdx = -999;
        for (var i = 50; i < candles.length; i++) {
            var c = candles[i];
            var recentFrom = Math.max(0, i - 24);
            var recentRes = highestHigh(candles, recentFrom, i);
            var recentSup = lowestLow(candles, recentFrom, i);
            var range = Math.max(1e-9, (recentRes - recentSup));
            var rangePos = (c.close - recentSup) / range; // 0=dip, 1=tepe
            var nearSupport = c.close <= (sr.support * 1.025) || c.close <= (recentSup * 1.015) || c.close <= fib.l618;
            var nearResistance = c.close >= (sr.resistance * 0.975) || c.close >= (recentRes * 0.99) || c.close >= fib.l382;
            var maTrendDown = ma50[i] != null && ma200[i] != null && ma50[i] < ma200[i];
            var maTrendUp = ma50[i] != null && ma200[i] != null && ma50[i] > ma200[i];
            var maCrossUp = i > 0 && ma50[i - 1] != null && ma200[i - 1] != null && ma50[i] != null && ma200[i] != null && ma50[i - 1] <= ma200[i - 1] && ma50[i] > ma200[i];
            var maCrossDown = i > 0 && ma50[i - 1] != null && ma200[i - 1] != null && ma50[i] != null && ma200[i] != null && ma50[i - 1] >= ma200[i - 1] && ma50[i] < ma200[i];
            var macdUp = m.hist[i] != null && m.hist[i] > 0;
            var macdDown = m.hist[i] != null && m.hist[i] < 0;
            var macdFlipUp = i > 0 && m.hist[i - 1] != null && m.hist[i] != null && m.hist[i - 1] <= 0 && m.hist[i] > 0;
            var macdFlipDown = i > 0 && m.hist[i - 1] != null && m.hist[i] != null && m.hist[i - 1] >= 0 && m.hist[i] < 0;
            var obvUp = i > 3 && o[i] > o[i - 3];
            var obvDown = i > 3 && o[i] < o[i - 3];
            var kdjBuy = k.J[i] != null && k.J[i] < 20;
            var kdjSell = k.J[i] != null && k.J[i] > 80;
            var rsiVal = r[i];
            var pivotHigh = isPivotHigh(candles, i, profile.pivotLeft, profile.pivotRight);
            var pivotLow = isPivotLow(candles, i, profile.pivotLeft, profile.pivotRight);
            var bearishBreak = i > 0 && c.close < candles[i - 1].low;
            var bullishBreak = i > 0 && c.close > candles[i - 1].high;
            var confirmBull = i > 0 && c.close > candles[i - 1].high;
            var confirmBear = i > 0 && c.close < candles[i - 1].low;
            var body = Math.abs((c.close || 0) - (c.open || 0));
            var upperWick = Math.max(0, (c.high || 0) - Math.max(c.open || 0, c.close || 0));
            var lowerWick = Math.max(0, Math.min(c.open || 0, c.close || 0) - (c.low || 0));
            var rejectionTop = upperWick > (body * 1.25) && upperWick > 0;
            var rejectionBottom = lowerWick > (body * 1.25) && lowerWick > 0;
            var harshDownMove = fallingStreak(candles, i, 3);
            var harshUpMove = risingStreak(candles, i, 3);
            var rsiRecovering = rsiVal != null && i > 0 && r[i - 1] != null && rsiVal > r[i - 1];
            var rsiWeakening = rsiVal != null && i > 0 && r[i - 1] != null && rsiVal < r[i - 1];
            var recentHi20 = highestHigh(candles, Math.max(0, i - 20), i);
            var drawdown20 = recentHi20 > 0 ? ((recentHi20 - c.close) / recentHi20) : 0;
            var topZone = rangePos >= (profile.topZoneMin || 0.72);
            var bottomZone = rangePos <= (profile.bottomZoneMax || 0.3);

            // "Gerçek dip/tepe" tespiti: son extremeWindow içinde en düşük/en yüksek penceresinden sapma toleransı.
            var exStart = Math.max(0, i - profile.extremeWindow);
            var localLow = lowestLow(candles, exStart, i);
            var localHigh = highestHigh(candles, exStart, i);
            var bottomExtremeZone = (localLow > 0) && (c.low <= localLow * (1 + profile.extremeTol));
            var topExtremeZone = (localHigh > 0) && (c.high >= localHigh * (1 - profile.extremeTol));
            var wedge = detectWedgeState(candles, i);
            var trendBreak = detectTrendBreaks(candles, i);
            var patterns = detectClassicPatterns(candles, i);
            var gann = detectGannBias(candles, i);
            var swingLookback = Math.min(36, Math.max(16, profile.extremeWindow / 2));
            var swingFrom = Math.max(0, i - swingLookback);
            var swingHigh = highestHigh(candles, swingFrom, i);
            var swingLow = lowestLow(candles, swingFrom, i);
            var swingTol = profile.swingTol || 0.0035;
            var nearSwingHigh = swingHigh > 0 && c.high >= swingHigh * (1 - swingTol);
            var nearSwingLow = swingLow > 0 && c.low <= swingLow * (1 + swingTol);
            var localLowDist = swingLow > 0 ? Math.abs(c.low - swingLow) / swingLow : 1;
            var localHighDist = swingHigh > 0 ? Math.abs(c.high - swingHigh) / swingHigh : 1;
            var precisionTol = profile.precisionTol || 0.0035;
            var dipPrecisionOk = nearSwingLow || bottomExtremeZone || localLowDist <= precisionTol;
            var topPrecisionOk = nearSwingHigh || topExtremeZone || localHighDist <= precisionTol;
            var bullishReversal = confirmBull || macdFlipUp || rejectionBottom || (rsiRecovering && rsiVal != null && rsiVal < 45);
            var bearishReversal = confirmBear || macdFlipDown || rejectionTop || (rsiWeakening && rsiVal != null && rsiVal > 55);

            // Retest dip/tepe tespiti: aynı seviyeye ikinci gelişlerde sinyal kaçmasın.
            var retestWindow = Math.min(120, Math.max(40, profile.extremeWindow + 20));
            var tol = 0.008; // ~%0.8 seviye toleransı
            var retestLow = false;
            var retestHigh = false;
            if (pivotLow) {
                for (var rl = Math.max(profile.pivotLeft + 2, i - retestWindow); rl < i - profile.pivotRight - 1; rl++) {
                    if (!isPivotLow(candles, rl, profile.pivotLeft, profile.pivotRight)) continue;
                    var baseLow = candles[rl].low;
                    if (baseLow > 0 && Math.abs(c.low - baseLow) / baseLow <= tol) { retestLow = true; break; }
                }
            }
            if (pivotHigh) {
                for (var rh = Math.max(profile.pivotLeft + 2, i - retestWindow); rh < i - profile.pivotRight - 1; rh++) {
                    if (!isPivotHigh(candles, rh, profile.pivotLeft, profile.pivotRight)) continue;
                    var baseHigh = candles[rh].high;
                    if (baseHigh > 0 && Math.abs(c.high - baseHigh) / baseHigh <= tol) { retestHigh = true; break; }
                }
            }

            var buyScore = 0;
            if (nearSupport) buyScore += 2;
            if (rsiVal != null && rsiVal < 35) buyScore += 2;
            if (bb.lower[i] != null && c.close <= bb.lower[i]) buyScore += 1;
            if (macdUp) buyScore += 1;
            if (macdFlipUp) buyScore += 1;
            if (obvUp) buyScore += 1;
            if (kdjBuy) buyScore += 1;
            if (maTrendDown) buyScore += 1;
            if (maCrossUp) buyScore += 2;
            if (pivotLow) buyScore += 2;
            if (rejectionBottom) buyScore += 1;
            if (bullishBreak) buyScore += 1;
            if (confirmBull) buyScore += 2;
            if (rsiRecovering) buyScore += 1;
            if (harshDownMove) buyScore -= 2;
            if (wedge.fallingWedge) buyScore += 2;
            if (trendBreak.upBreak) buyScore += 2;
            if (patterns.cupHandleBull) buyScore += 2;
            if (patterns.invHnsBull) buyScore += 3;
            if (gann.gannBull) buyScore += 1;
            if (retestLow) buyScore += 2;
            // Tepe bölgesinde güçlü al yanılsamasını sert azalt.
            if (nearResistance && !bottomZone) buyScore -= 4;
            if (topZone) buyScore -= 2;
            if (wedge.risingWedge) buyScore -= 2;
            if (patterns.hnsBear || patterns.inverseCupHandleBear) buyScore -= 2;
            buyScoreByTime[String(c.time)] = buyScore;

            var sellScore = 0;
            if (nearResistance) sellScore += 2;
            if (rsiVal != null && rsiVal > 65) sellScore += 2;
            if (bb.upper[i] != null && c.close >= bb.upper[i]) sellScore += 1;
            if (macdDown) sellScore += 1;
            if (macdFlipDown) sellScore += 1;
            if (obvDown) sellScore += 1;
            if (kdjSell) sellScore += 1;
            if (maTrendUp) sellScore += 1;
            if (maCrossDown) sellScore += 2;
            if (pivotHigh) sellScore += 2;
            if (rejectionTop) sellScore += 1;
            if (bearishBreak) sellScore += 1;
            if (confirmBear) sellScore += 2;
            if (rsiWeakening) sellScore += 1;
            if (harshUpMove) sellScore -= 2;
            if (wedge.risingWedge) sellScore += 2;
            if (trendBreak.downBreak) sellScore += 2;
            if (patterns.hnsBear) sellScore += 3;
            if (patterns.inverseCupHandleBear) sellScore += 2;
            if (gann.gannBear) sellScore += 1;
            if (retestHigh) sellScore += 2;
            if (wedge.fallingWedge) sellScore -= 2;
            if (patterns.cupHandleBull || patterns.invHnsBull) sellScore -= 2;
            sellScoreByTime[String(c.time)] = sellScore;

            var strongThreshold = profile.strong;
            var stepThreshold = profile.step;

            var strongBuyGate = confirmBull || macdFlipUp || maCrossUp || trendBreak.upBreak || patterns.invHnsBull;
            var strongSellGate = confirmBear || macdFlipDown || maCrossDown || trendBreak.downBreak || patterns.hnsBear;
            var stepBuyGate = (nearSupport && rsiVal != null && rsiVal < 40) || confirmBull || macdFlipUp || trendBreak.upBreak;
            var stepSellGate = (nearResistance && rsiVal != null && rsiVal > 60) || confirmBear || macdFlipDown || trendBreak.downBreak;
            // Güçlü AL için aşırı dip + olumsuzluğun geri dönmesi şartı
            var strongBuyContextOk = bottomExtremeZone && drawdown20 >= profile.drawdownStrongMin && !nearResistance;
            if (maTrendDown) strongBuyContextOk = strongBuyContextOk && confirmBull && macdFlipUp;
            // Güçlü SAT için tepe/direnç bağlamı şartı
            var strongSellContextOk = (topExtremeZone || nearResistance);

            var stepBuyContextOk = bottomZone && !nearResistance && (rsiVal == null || rsiVal <= 45);
            var stepSellContextOk = topZone && !nearSupport && (rsiVal == null || rsiVal >= 55);
            // Fiyat bandı disiplin filtresi:
            // AL dip bölgesi dışında üretilmesin, SAT tepe bölgesi dışında üretilmesin.
            var buyHardBandOk = bottomZone || bottomExtremeZone || nearSwingLow || (localLowDist <= precisionTol * 0.9);
            var sellHardBandOk = topZone || topExtremeZone || nearSwingHigh || (localHighDist <= precisionTol * 0.9);
            // 4 saatlikte daha sert: AL alt bölge, SAT üst bölge zorunlu.
            if (iv === '240' || iv === '4H') {
                buyHardBandOk = buyHardBandOk && (rangePos <= 0.32 || bottomExtremeZone);
                sellHardBandOk = sellHardBandOk && (rangePos >= 0.68 || topExtremeZone);
            }
            // Zıt sinyalleri bölgeye göre veto et: dipte SAT, tepede AL üretme.
            if (bottomExtremeZone) {
                sellScore -= 4;
                stepSellContextOk = false;
                strongSellContextOk = false;
            }
            if (topExtremeZone) {
                buyScore -= 4;
                stepBuyContextOk = false;
                strongBuyContextOk = false;
            }

            // Erken sinyal filtresi: yükseliş devam ederken erken SAT, düşüş devam ederken erken AL'i azalt.
            var prev3 = candles[Math.max(0, i - 3)];
            var upMomentum = !!prev3 && c.close >= (prev3.close || c.close) * 0.997;
            var downMomentum = !!prev3 && c.close <= (prev3.close || c.close) * 1.003;
            if (upMomentum && !topExtremeZone && !rejectionTop) {
                sellScore -= 2;
                stepSellContextOk = stepSellContextOk && nearResistance;
                strongSellContextOk = strongSellContextOk && nearSwingHigh;
            }
            if (downMomentum && !bottomExtremeZone && !rejectionBottom) {
                buyScore -= 2;
                stepBuyContextOk = stepBuyContextOk && nearSupport;
                strongBuyContextOk = strongBuyContextOk && nearSwingLow;
            }

            // Her mumda sinyal yerine, pivot dip/tepe ve formasyon kırılımlarında sinyal üret.
            // Dip/tepe dönüşlerinde güçlü sinyalin görünürlüğünü artırmak için
            // aşırı bölgede eşikleri 1 puan esnet.
            var strongBuyThreshold = bottomExtremeZone ? (strongThreshold - 1) : strongThreshold;
            var strongSellThreshold = topExtremeZone ? (strongThreshold - 1) : strongThreshold;

            var forceStrongBuyAtExtreme = pivotLow && bottomExtremeZone && strongBuyGate && !nearResistance
                && (buyScore >= Math.max(stepThreshold, strongBuyThreshold - 1));
            var forceStrongSellAtExtreme = pivotHigh && topExtremeZone && strongSellGate
                && (sellScore >= Math.max(stepThreshold, strongSellThreshold - 1));
            var forceBuyOnRetest = pivotLow && retestLow && bullishReversal && buyScore >= Math.max(stepThreshold - 1, 4) && dipPrecisionOk;
            var forceSellOnRetest = pivotHigh && retestHigh && bearishReversal && sellScore >= Math.max(stepThreshold - 1, 4) && topPrecisionOk;
            var tightLow = localLowDist <= 0.0018;
            var tightHigh = localHighDist <= 0.0018;
            var forceSellOnSwingTop = nearSwingHigh && !bottomZone && bearishReversal && (rejectionTop || tightHigh) && sellScore >= Math.max(stepThreshold - 1, 4) && topPrecisionOk;
            var forceBuyOnSwingBottom = nearSwingLow && !topZone && bullishReversal && (rejectionBottom || tightLow) && buyScore >= Math.max(stepThreshold - 1, 4) && dipPrecisionOk;

            if ((pivotLow && dipPrecisionOk && buyScore >= strongBuyThreshold && strongBuyGate && strongBuyContextOk && bullishReversal && (i - lastBuyIdx) >= profile.cooldownStrong) ||
                (forceStrongBuyAtExtreme && (i - lastBuyIdx) >= profile.cooldownStrong)) {
                if (buyHardBandOk) {
                    signals.push({ time: c.time, price: c.low, side: 'buy', strength: 'strong', label: 'AL', score: buyScore });
                    lastBuyIdx = i;
                }
            } else if ((forceBuyOnRetest || forceBuyOnSwingBottom) && (i - lastBuyIdx) >= Math.max(3, Math.floor(profile.cooldownStep / 2))) {
                if (buyHardBandOk) {
                    signals.push({ time: c.time, price: c.low, side: 'buy', strength: 'step', label: 'AL', score: buyScore });
                    lastBuyIdx = i;
                }
            } else if (pivotLow && dipPrecisionOk && bullishReversal && buyScore >= (stepThreshold - 1) && stepBuyGate && stepBuyContextOk && (i - lastBuyIdx) >= Math.max(4, Math.floor(profile.cooldownStep / 2))) {
                // Ara diplerde de AL göster (geçmiş mum görünürlüğü).
                if (buyHardBandOk) {
                    signals.push({ time: c.time, price: c.low, side: 'buy', strength: 'step', label: 'AL', score: buyScore });
                    lastBuyIdx = i;
                }
            }

            if ((pivotHigh && topPrecisionOk && sellScore >= strongSellThreshold && strongSellGate && strongSellContextOk && bearishReversal && (i - lastSellIdx) >= profile.cooldownStrong) ||
                (forceStrongSellAtExtreme && (i - lastSellIdx) >= profile.cooldownStrong)) {
                if (sellHardBandOk) {
                    signals.push({ time: c.time, price: c.high, side: 'sell', strength: 'strong', label: 'SAT', score: sellScore });
                    lastSellIdx = i;
                }
            } else if ((forceSellOnRetest || forceSellOnSwingTop) && (i - lastSellIdx) >= Math.max(3, Math.floor(profile.cooldownStep / 2))) {
                if (sellHardBandOk) {
                    signals.push({ time: c.time, price: c.high, side: 'sell', strength: 'step', label: 'SAT', score: sellScore });
                    lastSellIdx = i;
                }
            } else if (pivotHigh && topPrecisionOk && bearishReversal && sellScore >= (stepThreshold - 1) && stepSellGate && stepSellContextOk && (i - lastSellIdx) >= Math.max(4, Math.floor(profile.cooldownStep / 2))) {
                // Ara tepelerde de SAT göster (geçmiş mum görünürlüğü).
                if (sellHardBandOk) {
                    signals.push({ time: c.time, price: c.high, side: 'sell', strength: 'step', label: 'SAT', score: sellScore });
                    lastSellIdx = i;
                }
            }
        }

        var filtered = [];
        var lastByTime = {};
        for (var s = 0; s < signals.length; s++) {
            var key = String(signals[s].time) + ':' + signals[s].side;
            if (!lastByTime[key] || signals[s].score > lastByTime[key].score) lastByTime[key] = signals[s];
        }
        Object.keys(lastByTime).forEach(function(kv) { filtered.push(lastByTime[kv]); });
        filtered.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });

        // Profesyonel zorunlu kural:
        // Son penceredeki en dipte GUCLU AL, en tepede GUCLU SAT görünmeli.
        var enforceStart = Math.max(0, candles.length - profile.extremeWindow);
        var minIdx = enforceStart;
        var maxIdx = enforceStart;
        for (var e = enforceStart + 1; e < candles.length; e++) {
            if (candles[e].low < candles[minIdx].low) minIdx = e;
            if (candles[e].high > candles[maxIdx].high) maxIdx = e;
        }
        var minCandle = candles[minIdx];
        var maxCandle = candles[maxIdx];
        var minTime = minCandle && minCandle.time;
        var maxTime = maxCandle && maxCandle.time;
        var minBuyScore = buyScoreByTime[String(minTime)] || 0;
        var maxSellScore = sellScoreByTime[String(maxTime)] || 0;
        var nearStrongThreshold = Math.max(stepThreshold, strongThreshold - 2);

        if (minTime != null && minBuyScore >= nearStrongThreshold) {
            // En dipte ters (sell) sinyalleri temizle.
            filtered = filtered.filter(function(sig) { return !(sig.time === minTime && sig.side === 'sell'); });
            var hasStrongBuyAtLow = filtered.some(function(sig) { return sig.time === minTime && sig.side === 'buy' && sig.strength === 'strong'; });
            if (!hasStrongBuyAtLow) {
                // Varsa aynı mumdaki buy step'i strong'a yükselt; yoksa yeni strong ekle.
                var upgraded = false;
                for (var ub = 0; ub < filtered.length; ub++) {
                    if (filtered[ub].time === minTime && filtered[ub].side === 'buy') {
                        filtered[ub].strength = 'strong';
                        filtered[ub].label = 'AL';
                        filtered[ub].score = Math.max(filtered[ub].score || 0, minBuyScore);
                        upgraded = true;
                        break;
                    }
                }
                if (!upgraded) filtered.push({ time: minTime, price: minCandle.low, side: 'buy', strength: 'strong', label: 'AL', score: minBuyScore });
            }
        }
        // Ek güvence: Son pencerede AL varsa ama gerçek dip mumunda yoksa,
        // AL'ı en dip muma taşı (yüksekten AL hatasını azalt).
        if (minTime != null) {
            var buyInWindow = filtered.filter(function(sig) { return sig.side === 'buy' && (sig.time || 0) >= (candles[enforceStart] && candles[enforceStart].time || 0); });
            var hasBuyAtMin = buyInWindow.some(function(sig) { return sig.time === minTime; });
            if (!hasBuyAtMin && buyInWindow.length) {
                var nearest = buyInWindow[0];
                for (var nb = 1; nb < buyInWindow.length; nb++) {
                    if (Math.abs((buyInWindow[nb].time || 0) - minTime) < Math.abs((nearest.time || 0) - minTime)) nearest = buyInWindow[nb];
                }
                for (var rb = 0; rb < filtered.length; rb++) {
                    if (filtered[rb] === nearest) {
                        filtered[rb] = {
                            time: minTime,
                            price: minCandle.low,
                            side: 'buy',
                            strength: 'strong',
                            label: 'AL',
                            score: Math.max(nearest.score || 0, minBuyScore || 0)
                        };
                        break;
                    }
                }
            }
        }

        if (maxTime != null && maxSellScore >= nearStrongThreshold) {
            // En tepede ters (buy) sinyalleri temizle.
            filtered = filtered.filter(function(sig) { return !(sig.time === maxTime && sig.side === 'buy'); });
            var hasStrongSellAtHigh = filtered.some(function(sig) { return sig.time === maxTime && sig.side === 'sell' && sig.strength === 'strong'; });
            if (!hasStrongSellAtHigh) {
                var upgradedSell = false;
                for (var us = 0; us < filtered.length; us++) {
                    if (filtered[us].time === maxTime && filtered[us].side === 'sell') {
                        filtered[us].strength = 'strong';
                        filtered[us].label = 'SAT';
                        filtered[us].score = Math.max(filtered[us].score || 0, maxSellScore);
                        upgradedSell = true;
                        break;
                    }
                }
                if (!upgradedSell) filtered.push({ time: maxTime, price: maxCandle.high, side: 'sell', strength: 'strong', label: 'SAT', score: maxSellScore });
            }
        }

        filtered.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
        filtered = enforcePriceSideDiscipline(filtered, candles, profile);
        filtered = injectMissedSwingOpportunities(filtered, candles, profile, buyScoreByTime, sellScoreByTime);
        filtered = enforcePriceSideDiscipline(filtered, candles, profile);
        filtered = normalizeSignalSequence(filtered, profile);
        filtered = keepBestSwingExtremes(filtered);

        // Olası gelecek sinyalleri (puan farkına göre projeksiyon).
        // Not: Grafikte çift SAT/AL görünmesine neden olmaması için
        // varsayılan olarak kapalı. Gerekirse tekrar açılabilir.
        var enableFutureProjection = false;
        var lastIdx = candles.length - 1;
        var lastCandle = candles[lastIdx];
        if (enableFutureProjection && lastCandle && isFinite(lastCandle.time)) {
            var futureStep = intervalToSeconds(opts.interval);
            var lastBuyScore = buyScoreByTime[String(lastCandle.time)] || 0;
            var lastSellScore = sellScoreByTime[String(lastCandle.time)] || 0;
            var diff = lastBuyScore - lastSellScore;
            if (diff >= 2) {
                filtered.push({
                    time: Number(lastCandle.time) + futureStep,
                    price: lastCandle.low,
                    side: 'buy',
                    strength: 'step',
                    label: 'AL?',
                    score: lastBuyScore
                });
            } else if (diff <= -2) {
                filtered.push({
                    time: Number(lastCandle.time) + futureStep,
                    price: lastCandle.high,
                    side: 'sell',
                    strength: 'step',
                    label: 'SAT?',
                    score: lastSellScore
                });
            }
        }

        filtered.sort(function(a, b) { return (a.time || 0) - (b.time || 0); });
        var last = filtered.length ? filtered[filtered.length - 1] : null;

        return {
            signals: filtered,
            lastSignal: last,
            summary: last ? (last.label + ' (skor: ' + last.score + ')') : 'Sinyal yok'
        };
    }

    var _finansTeknikEngine = { analyze: analyze };
    if (typeof globalThis !== "undefined") globalThis.teknikSinyalEngine = _finansTeknikEngine;
    if (typeof window !== "undefined") window.teknikSinyalEngine = _finansTeknikEngine;
})();

if (typeof module !== "undefined" && module.exports) {
  var _exp =
    (typeof globalThis !== "undefined" && globalThis.teknikSinyalEngine) ||
    (typeof window !== "undefined" && window.teknikSinyalEngine) ||
    null;
  module.exports =
    _exp || { analyze: function () { return { signals: [], lastSignal: null, summary: "Yeterli veri yok" }; } };
}

