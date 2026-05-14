/**
 * Gram altın/gümüş TL: RN’den enjekte edilen günlük seri + Lightweight Charts.
 * WebView içinde Yahoo fetch yok (CORS / engel); imleç fiyatı postMessage ile döner.
 */

export function buildGramTlChartHtmlWithSeries(tvSymbol: string, seriesJson: string): string {
  const symJson = JSON.stringify(tvSymbol);
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <script src="https://unpkg.com/lightweight-charts@4.2.3/dist/lightweight-charts.standalone.production.js"></script>
  <style>
    html, body { margin: 0; height: 100%; background: #0f172a; }
    #hint { color: #94a3b8; padding: 8px 10px; font-family: system-ui, -apple-system, Segoe UI, sans-serif; font-size: 13px; border-bottom: 1px solid #1e293b; }
    #chart { position: absolute; left: 0; right: 0; top: 42px; bottom: 0; }
  </style>
</head>
<body>
  <div id="hint">İmleci hareket ettirin · TRY/gram</div>
  <div id="chart"></div>
  <script>
(function () {
  var TV_SYM = ${symJson};
  var SERIES = ${seriesJson};

  function post(o) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({ source: 'gramTlTv' }, o)));
      }
    } catch (e) {}
  }

  function timeToDayKey(t) {
    if (t == null) return null;
    if (typeof t === 'string') return t;
    if (typeof t === 'number') return String(t);
    if (typeof t === 'object' && t.year != null && t.month != null && t.day != null) {
      var mo = ('0' + t.month).slice(-2);
      var da = ('0' + t.day).slice(-2);
      return t.year + '-' + mo + '-' + da;
    }
    return null;
  }

  function run() {
    if (!SERIES || !Array.isArray(SERIES) || !SERIES.length || typeof LightweightCharts === 'undefined') {
      document.getElementById('hint').textContent = 'Grafik verisi yok.';
      post({ event: 'error', message: 'no_series' });
      return;
    }
    var lineData = SERIES.map(function (r) {
      return { time: r.time, value: r.value };
    });
    var el = document.getElementById('chart');
    var chart = LightweightCharts.createChart(el, {
      layout: {
        background: { type: 'solid', color: '#0f172a' },
        textColor: '#cbd5e1',
      },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155' },
      crosshair: { mode: 1 },
    });
    var series = chart.addLineSeries({ color: '#fbbf24', lineWidth: 2 });
    series.setData(lineData);
    chart.timeScale().fitContent();
    document.getElementById('hint').textContent = TV_SYM + ' — imleç fiyatı (TRY/gram)';

    var last = lineData[lineData.length - 1];
    if (last && typeof last.value === 'number' && isFinite(last.value)) {
      post({ event: 'crosshair', price: last.value, time: timeToDayKey(last.time) });
    }

    chart.subscribeCrosshairMove(function (param) {
      var price = null;
      var t = null;
      try {
        if (param && param.time != null) t = timeToDayKey(param.time);
        if (param && param.seriesData) {
          var pt = param.seriesData.get(series);
          if (pt && typeof pt.value === 'number' && isFinite(pt.value)) price = pt.value;
        }
      } catch (e) {}
      if (price != null) post({ event: 'crosshair', price: price, time: t });
    });
  }
  run();
})();
  </script>
</body>
</html>`;
}
