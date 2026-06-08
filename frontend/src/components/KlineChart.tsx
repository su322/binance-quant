import { useEffect, useRef, useImperativeHandle, forwardRef, memo } from 'react';
import {
  createChart, IChartApi, ISeriesApi, IPriceLine,
  CandlestickSeries, HistogramSeries,
} from 'lightweight-charts';
import type { Kline } from '../types';

function toSeconds(ts: string | number): number {
  if (typeof ts === 'string') return new Date(ts).getTime() / 1000;
  return ts > 1e11 ? ts / 1000 : ts;
}

export interface KlineChartHandle {
  updateKline: (k: Kline) => void;
  scrollToLatest: () => void;
  loadMoreData: (prepended: Kline[]) => void;
}

export interface EventLine {
  price: number;
  title: string;
  side: string;
  color?: string;
}

interface Props {
  data: Kline[];
  height?: number;
  symbol?: string;
  onLoadMore?: (oldestTimestamp: number) => void;
  eventLines?: EventLine[];
}

const KlineChart = memo(forwardRef<KlineChartHandle, Props>(({ data, height = 500, symbol = '', onLoadMore, eventLines }, ref) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
  const isLoadingMore = useRef(false);
  const oldestTimeRef = useRef(0);
  const lastLoadTimeRef = useRef(0);
  const priceLineRef = useRef<IPriceLine | null>(null);
  const eventPriceLinesRef = useRef<IPriceLine[]>([]);
  const latestLabelRef = useRef<HTMLDivElement | null>(null);
  const latestPriceRef = useRef(0);
  const positionLabelRef = useRef<() => void>(() => {});
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;
  const skipChartRecreateRef = useRef(false);
  const dataRef = useRef<Kline[]>([]);
  const fitZoomedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    updateKline(k: Kline) {
      const series = candleSeriesRef.current;
      const volSeries = volumeSeriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart) return;

      const time = toSeconds(k.timestamp) as any;
      series.update({
        time,
        open: k.open, high: k.high, low: k.low, close: k.close,
      });
      volSeries?.update({
        time,
        value: k.volume,
        color: k.close >= k.open ? '#26a69a26' : '#ef535026',
      });

      // Update latest price line
      if (priceLineRef.current) series.removePriceLine(priceLineRef.current);
      priceLineRef.current = series.createPriceLine({
        price: k.close,
        color: '#7c7cff',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
      });
      latestPriceRef.current = k.close;
      if (latestLabelRef.current) {
        latestLabelRef.current.textContent = k.close.toFixed(2);
      }
      positionLabelRef.current();

      if (headerRef.current) {
        const priceEl = headerRef.current.querySelector('.last-price');
        const changeEl = headerRef.current.querySelector('.price-change');
        if (priceEl) priceEl.textContent = k.close.toFixed(2);
        if (changeEl && data.length > 1) {
          const prev = data[data.length - 2].close;
          const pct = ((k.close - prev) / prev * 100).toFixed(2);
          changeEl.textContent = `${Number(pct) >= 0 ? '+' : ''}${pct}%`;
          changeEl.className = `price-change ${Number(pct) >= 0 ? 'up' : 'down'}`;
        }
      }
    },
    scrollToLatest() {
      const chart = chartRef.current;
      if (!chart || data.length === 0) return;
      const latest = toSeconds(data[data.length - 1].timestamp);
      const range = chart.timeScale().getVisibleRange();
      if (!range) { chart.timeScale().scrollToRealTime(); return; }
      const width = Number(range.to) - Number(range.from);
      chart.timeScale().setVisibleRange({
        from: (Number(latest) - width) as any,
        to: latest as any,
      });
    },
    loadMoreData(prepended: Kline[]) {
      skipChartRecreateRef.current = true;
      const full = [...prepended, ...dataRef.current];
      dataRef.current = full;
      const cs = candleSeriesRef.current;
      const vs = volumeSeriesRef.current;
      if (cs) {
        cs.setData(full.map(k => ({
          time: toSeconds(k.timestamp) as any,
          open: k.open, high: k.high, low: k.low, close: k.close,
        })));
      }
      if (vs) {
        vs.setData(full.map(k => ({
          time: toSeconds(k.timestamp) as any,
          value: k.volume,
          color: k.close >= k.open ? '#26a69a26' : '#ef535026',
        })));
      }
      oldestTimeRef.current = toSeconds(full[0].timestamp);
    },
  }));

  useEffect(() => {
    // If data was just prepended via loadMoreData, skip chart destroy/recreate
    if (skipChartRecreateRef.current) {
      skipChartRecreateRef.current = false;
      dataRef.current = data; // sync ref from state update
      return;
    }

    if (!containerRef.current || data.length === 0) return;
    isLoadingMore.current = false;

    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: '#14142a' },
        textColor: '#8a8a9e',
        panes: {
          separatorColor: '#2a2a44',
          separatorHoverColor: '#4c4c6e',
          enableResize: true,
        },
      },
      grid: { vertLines: { color: '#1e1e3a' }, horzLines: { color: '#1e1e3a' } },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a2a44',
        tickMarkFormatter: (time: any, tickMarkType: any) => {
          const d = new Date((time as number) * 1000);
          const MM = String(d.getMonth() + 1).padStart(2, '0');
          const DD = String(d.getDate()).padStart(2, '0');
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          if (tickMarkType === 0) return String(d.getFullYear());
          if (tickMarkType === 1) return `${d.getFullYear()}-${MM}`;
          if (tickMarkType === 2) return `${MM}-${DD}`;
          return `${hh}:${mm}`;
        },
      },
      rightPriceScale: { borderColor: '#2a2a44' },
      crosshair: { mode: 0 },
      localization: {
        locale: 'zh-CN',
        timeFormatter: (time: number) => {
          const d = new Date((time as number) * 1000);
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hh}:${mm}`;
        },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
      lastValueVisible: false,
      priceLineVisible: false,
    }, 0);

    // Price line for latest price
    const latestPrice = data[data.length - 1].close;
    priceLineRef.current = candleSeries.createPriceLine({
      price: latestPrice,
      color: '#7c7cff',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
    });

    // Create price lines for pending event orders
    (eventLines || []).forEach(line => {
      const pl = candleSeries.createPriceLine({
        price: line.price,
        color: '#f0ad4e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: line.title,
      });
      eventPriceLinesRef.current.push(pl);
    });

    chart.addPane();
    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
    }, 1);
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0, bottom: 0 },
    });

    chart.panes()[0].setStretchFactor(3);
    chart.panes()[1].setStretchFactor(1);

    const candleData = data.map(k => ({
      time: toSeconds(k.timestamp) as any,
      open: k.open, high: k.high, low: k.low, close: k.close,
    }));
    candleSeries.setData(candleData);

    const volumeData = data.map(k => ({
      time: toSeconds(k.timestamp) as any,
      value: k.volume,
      color: k.close >= k.open ? '#26a69a26' : '#ef535026',
    }));
    volSeries.setData(volumeData);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volSeries;
    latestPriceRef.current = data[data.length - 1].close;
    dataRef.current = data;

    // Position latest-price label at correct Y on the right axis
    const positionLabel = () => {
      const series = candleSeriesRef.current;
      const label = latestLabelRef.current;
      const container = containerRef.current;
      const chart = chartRef.current;
      if (!series || !label || !container || !chart) return;

      const priceScale = series.priceScale();
      const range = priceScale.getVisibleRange();
      if (!range || range.to <= range.from) return;

      const price = latestPriceRef.current;
      const paneHeight = chart.panes()[0].getHeight();
      const coord = ((range.to - price) / (range.to - range.from)) * paneHeight;

      const headerEl = wrapperRef.current?.querySelector('.chart-header');
      const hh = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const labelH = label.offsetHeight || 20;

      if (price >= range.from && price <= range.to) {
        label.style.display = 'none';
      } else if (price > range.to) {
        label.style.display = 'block';
        label.style.top = hh + 'px';
        label.classList.add('at-top');
        label.classList.remove('at-bottom');
      } else {
        label.style.display = 'block';
        label.style.top = (hh + paneHeight - labelH - 4) + 'px';
        label.classList.add('at-bottom');
        label.classList.remove('at-top');
      }
    };
    positionLabelRef.current = positionLabel;
    positionLabel();

    // Track oldest loaded time for lazy loading
    if (data.length > 0) {
      oldestTimeRef.current = toSeconds(data[0].timestamp);
    }

    // Restore saved visible range or fit content
    if (savedRangeRef.current) {
      const w = savedRangeRef.current.to - savedRangeRef.current.from;
      const shift = w * 0.03;
      chart.timeScale().setVisibleRange({
        from: (savedRangeRef.current.from + shift) as any,
        to: (savedRangeRef.current.to + shift) as any,
      });
      savedRangeRef.current = null;
    } else {
      // Default: show ~120 candles for a readable view
      const latestTime = toSeconds(data[data.length - 1].timestamp);
      const oldestTime = toSeconds(data[0].timestamp);
      const avgInterval = (latestTime - oldestTime) / Math.max(1, data.length - 1);
      const targetCandles = 120;
      const from = Math.min(latestTime, Math.max(latestTime - avgInterval * targetCandles, oldestTime));
      chart.timeScale().setVisibleRange({ from: from as any, to: latestTime as any });
    }

    // Detect scroll near left edge → load more data
    const scrollHandler = (range: any) => {
      positionLabel();
      if (!range || oldestTimeRef.current === 0) return;
      const now = Date.now();
      if (isLoadingMore.current || now - lastLoadTimeRef.current < 8000) return;
      const from = Number(range.from);
      const width = Number(range.to) - from;
      if (from <= oldestTimeRef.current + width * 0.1) {
        isLoadingMore.current = true;
        lastLoadTimeRef.current = now;
        const vis = chart.timeScale().getVisibleRange();
        if (vis) savedRangeRef.current = { from: Number(vis.from), to: Number(vis.to) };
        onLoadMoreRef.current?.(oldestTimeRef.current);
      }
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(scrollHandler);

    // Tooltip
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    wrapperRef.current?.appendChild(tooltip);

    // Latest-price label
    const latestLabel = document.createElement('div');
    latestLabel.className = 'chart-latest-label';
    latestLabel.textContent = data[data.length - 1].close.toFixed(2);
    latestLabel.style.display = 'none';
    wrapperRef.current?.appendChild(latestLabel);
    latestLabelRef.current = latestLabel;

    const headerEl = wrapperRef.current?.querySelector('.chart-header');
    const headerHeight = headerEl ? headerEl.getBoundingClientRect().height : 0;

    chart.subscribeCrosshairMove((param: any) => {
      if (!param.time || !param.point || param.point.x < 0) {
        tooltip.style.display = 'none';
        return;
      }
      const cd = param.seriesData.get(candleSeries);
      if (!cd) { tooltip.style.display = 'none'; return; }

      const vd = param.seriesData.get(volSeries);
      tooltip.style.display = 'block';
      tooltip.innerHTML = `
        <div class="tt-row"><span class="tt-label">开</span><span class="tt-val">${cd.open.toFixed(2)}</span></div>
        <div class="tt-row"><span class="tt-label">高</span><span class="tt-val">${cd.high.toFixed(2)}</span></div>
        <div class="tt-row"><span class="tt-label">低</span><span class="tt-val">${cd.low.toFixed(2)}</span></div>
        <div class="tt-row"><span class="tt-label">收</span><span class="tt-val">${cd.close.toFixed(2)}</span></div>
        <div class="tt-row tt-vol"><span class="tt-label">量</span><span class="tt-val">${vd ? (vd.value / 1).toFixed(0) : '-'}</span></div>
      `;

      const wr = wrapperRef.current!;
      const wrw = wr.clientWidth;
      let left = param.point.x + 15;
      let top = param.point.y + headerHeight - 55;
      if (left + 120 > wrw) left = param.point.x - 130;
      if (top < 5) top = 5;
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    });

    const observer = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    observer.observe(container);

    return () => {
      if (skipChartRecreateRef.current) {
        // loadMoreData already updated the chart, keep it alive
        chart.timeScale().unsubscribeVisibleTimeRangeChange(scrollHandler);
        observer.disconnect();
        tooltip.remove();
        latestLabel.remove();
        latestLabelRef.current = null;
        // Don't null chart/series refs — they're still valid
        return;
      }
      chart.timeScale().unsubscribeVisibleTimeRangeChange(scrollHandler);
      observer.disconnect();
      try { chart.remove(); } catch (_) {}
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      eventPriceLinesRef.current = [];
      tooltip.remove();
      latestLabel.remove();
      latestLabelRef.current = null;
      priceLineRef.current = null;
    };
  }, [data, height]);

  // Multiple price lines for pending event orders
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    eventPriceLinesRef.current.forEach(line => series.removePriceLine(line));
    eventPriceLinesRef.current = [];
    (eventLines || []).forEach(line => {
      const pl = series.createPriceLine({
        price: line.price,
        color: line.color || '#f0ad4e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: line.title,
      });
      eventPriceLinesRef.current.push(pl);
    });
  }, [eventLines]);

  if (data.length === 0) {
    return (
      <div ref={wrapperRef} className="chart-wrapper">
        <div ref={headerRef} className="chart-header">
          <span className="chart-symbol">{symbol}</span>
          <span className="last-price">-</span>
        </div>
        <div ref={containerRef} style={{ width: '100%', height }} />
      </div>
    );
  }

  const last = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : null;
  const change = prev ? ((last.close - prev.close) / prev.close * 100).toFixed(2) : null;

  return (
    <div ref={wrapperRef} className="chart-wrapper">
      <div ref={headerRef} className="chart-header">
        <span className="chart-symbol">{symbol}</span>
        <span className="last-price">{last ? last.close.toFixed(2) : '-'}</span>
        {change !== null && (
          <span className={`price-change ${Number(change) >= 0 ? 'up' : 'down'}`}>
            {Number(change) >= 0 ? '+' : ''}{change}%
          </span>
        )}
        <span className="chart-ohlcv">
          O {last.open.toFixed(2)} H {last.high.toFixed(2)} L {last.low.toFixed(2)} C {last.close.toFixed(2)}
        </span>
        <button className="latest-btn" onClick={() => { const c = chartRef.current; if (!c || data.length === 0) return; const lt = toSeconds(data[data.length - 1].timestamp); const r = c.timeScale().getVisibleRange(); if (!r) return; const w = Number(r.to) - Number(r.from); c.timeScale().setVisibleRange({ from: (Number(lt) - w) as any, to: lt as any }); }} title="回到最新">
          ↻
        </button>
        <button className="latest-btn" onClick={() => {
          const c = chartRef.current;
          if (!c || data.length === 0) return;
          if (fitZoomedRef.current) {
            // Zoom back to ~120 candles
            const lt = toSeconds(data[data.length - 1].timestamp);
            const ot = toSeconds(data[0].timestamp);
            const avg = (lt - ot) / Math.max(1, data.length - 1);
            const from = Math.min(lt, Math.max(lt - avg * 120, ot));
            c.timeScale().setVisibleRange({ from: from as any, to: lt as any });
          } else {
            c.timeScale().fitContent();
          }
          fitZoomedRef.current = !fitZoomedRef.current;
        }} title="自适应">
          ⛶
        </button>
      </div>
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}));

KlineChart.displayName = 'KlineChart';
export default KlineChart;
