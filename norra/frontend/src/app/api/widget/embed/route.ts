import { NextResponse } from 'next/server';

/**
 * The one line a customer pastes into their own site:
 *
 *   <script src="https://<host>/api/widget/embed" data-agent="<agentId>" async></script>
 *
 * It injects a floating launcher and an iframe pointing at /widget/[agentId].
 * The origin is read from the script's own `src`, never hard-coded, so the
 * exact same snippet works from a preview deployment or the production
 * domain without the customer having to know which.
 *
 * Deliberately vanilla JS, not a bundle: the whole thing is a button and an
 * iframe, and a build step would be more machinery than the feature.
 */
export const dynamic = 'force-dynamic';

const SCRIPT = `(function () {
  if (window.__norraWidgetLoaded) return;
  window.__norraWidgetLoaded = true;

  var current = document.currentScript;
  var agentId = current && current.getAttribute('data-agent');
  if (!agentId) {
    console.error('[norra] widget script is missing data-agent="<agent id>"');
    return;
  }
  var origin = new URL(current.src, window.location.href).origin;

  var launcher = document.createElement('button');
  launcher.setAttribute('aria-label', 'Chat öffnen');
  launcher.textContent = '💬';
  launcher.style.cssText =
    'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:999px;' +
    'border:none;background:#16352a;color:#fff;font-size:22px;cursor:pointer;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.22);z-index:2147483000;';

  var frame = document.createElement('iframe');
  frame.title = 'Chat';
  frame.src = origin + '/widget/' + encodeURIComponent(agentId);
  frame.style.cssText =
    'position:fixed;right:20px;bottom:88px;width:376px;height:600px;max-height:calc(100vh - 110px);' +
    'border:none;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);z-index:2147483000;' +
    'display:none;background:#fff;color-scheme:light dark;';

  function layout() {
    var narrow = window.innerWidth < 480;
    frame.style.width = narrow ? '100vw' : '376px';
    frame.style.height = narrow ? '100vh' : '600px';
    frame.style.right = narrow ? '0' : '20px';
    frame.style.bottom = narrow ? '0' : '88px';
    frame.style.borderRadius = narrow ? '0' : '16px';
  }
  layout();
  window.addEventListener('resize', layout);

  var open = false;
  launcher.addEventListener('click', function () {
    open = !open;
    frame.style.display = open ? 'block' : 'none';
    launcher.textContent = open ? '✕' : '💬';
    launcher.setAttribute('aria-label', open ? 'Chat schließen' : 'Chat öffnen');
  });

  document.body.appendChild(frame);
  document.body.appendChild(launcher);
})();`;

export async function GET(): Promise<Response> {
  return new NextResponse(SCRIPT, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // A launcher script is static per deploy; a short cache keeps repeat
      // page loads from re-fetching it while still picking up a redeploy soon.
      'cache-control': 'public, max-age=300',
    },
  });
}
