with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

start = html.find('    // ===== Hero Pixel Logo =====')
end = html.find('    // ===== Photo Wall =====')

new_func = """    // ===== Hero Pixel Logo =====
    (function initPixelLogo() {
      const sourceImg = document.getElementById('heroLogoImg');
      const container = document.getElementById('heroPixelLogo');
      if (!sourceImg || !container) return;

      const ICONS = ['\u2764\uFE0F','\uD83D\uDC8E','\uD83D\uDCA1','\uD83D\uDE04','\u26A1','\uD83C\uDFAF','\uD83D\uDE80','\uD83C\uDF1F'];
      let iconIdx = 0;
      const DOT  = 5;
      const STEP = 6;
      const LEFT_OFFSET = 0.08;

      function colColor(xRatio) {
        if (xRatio < 0.10) return '#60a5fa';
        if (xRatio < 0.58) return '#e2e8f0';
        if (xRatio < 0.84) return '#93c5fd';
        return '#7dd3fc';
      }

      function isHeartArea(xRatio, yRatio) {
        return xRatio < 0.10 && yRatio < 0.35;
      }

      function build(img) {
        const SAMPLE_W = 400;
        const SAMPLE_H = Math.round(SAMPLE_W * img.naturalHeight / img.naturalWidth);
        const oc = document.createElement('canvas');
        oc.width  = SAMPLE_W;
        oc.height = SAMPLE_H;
        const ctx = oc.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
        const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

        container.innerHTML = '';
        const dispW = Math.min(480, Math.round(window.innerWidth * 0.42));
        const dispH = Math.round(dispW * SAMPLE_H / SAMPLE_W);
        const offsetPx = Math.round(dispW * LEFT_OFFSET);

        const wrap = document.createElement('div');
        wrap.style.cssText = `position:relative;width:${dispW}px;height:${dispH}px;margin:0 auto;`;

        for (let sy = 0; sy < SAMPLE_H; sy += STEP) {
          for (let sx = 0; sx < SAMPLE_W; sx += STEP) {
            const idx = (sy * SAMPLE_W + sx) * 4;
            if (data[idx + 3] < 80) continue;
            const xRatio = sx / SAMPLE_W;
            const yRatio = sy / SAMPLE_H;
            if (isHeartArea(xRatio, yRatio)) continue;
            const dx = Math.round(xRatio * dispW) - offsetPx;
            const dy = Math.round(yRatio * dispH);
            if (dx < 0 || dx > dispW) continue;
            const dot = document.createElement('div');
            dot.style.cssText = `position:absolute;left:${dx}px;top:${dy}px;width:${DOT}px;height:${DOT}px;border-radius:1px;background:${colColor(xRatio)};animation:pxFloat ${(2.5+Math.random()).toFixed(2)}s ease-in-out ${(Math.random()*2).toFixed(2)}s infinite;`;
            wrap.appendChild(dot);
          }
        }

        const iconEl = document.createElement('div');
        iconEl.style.cssText = `position:absolute;left:2px;top:2px;font-size:${Math.round(dispH*0.30)}px;line-height:1;cursor:pointer;user-select:none;filter:drop-shadow(0 2px 6px rgba(0,0,0,.5));transition:transform .2s;z-index:2;`;
        iconEl.textContent = ICONS[iconIdx];
        iconEl.title = '\u9EDE\u64CA\u5207\u63DB\u5716\u793A';
        iconEl.addEventListener('click', () => {
          iconIdx = (iconIdx + 1) % ICONS.length;
          iconEl.textContent = ICONS[iconIdx];
        });
        iconEl.addEventListener('mouseenter', () => iconEl.style.transform = 'scale(1.3)');
        iconEl.addEventListener('mouseleave', () => iconEl.style.transform = '');
        wrap.appendChild(iconEl);
        container.appendChild(wrap);
      }

      if (sourceImg.complete && sourceImg.naturalWidth > 0) {
        build(sourceImg);
      } else {
        sourceImg.addEventListener('load', () => build(sourceImg));
      }
    })();

"""

result = html[:start] + new_func + html[end:]
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(result)
print('Done')
