/**
 * Troubleshooting checklist shown when the camera or microphone fails.
 * Covers the usual causes: embedded previews that block devices, a blocked
 * browser permission, Windows privacy switches and a webcam busy in another app.
 */
export function DeviceHelp({ device = 'camera & microphone' }: { device?: string }) {
  const embedded = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();
  const url = `${location.protocol}//${location.host}${location.pathname}`;
  return (
    <div className="devhelp">
      <div className="devhelp__title">How to fix the {device}</div>
      <ol>
        <li className={embedded ? 'is-key' : ''}>
          <b>Use a normal browser window.</b> Built-in previews (like an editor's browser panel) block the webcam and mic. Open{' '}
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>{' '}
          in <b>Chrome</b> or <b>Edge</b>.
        </li>
        <li>
          <b>Allow access:</b> click the camera/lock icon at the left of the address bar → <i>Camera</i> and <i>Microphone</i> → <b>Allow</b>, then press <b>Retry</b>.
        </li>
        <li>
          <b>Windows privacy:</b> Settings → Privacy &amp; security → <b>Camera</b> (and <b>Microphone</b>) → turn on <i>Camera access</i>, <i>Let apps access your camera</i> and{' '}
          <i>Let desktop apps access your camera</i>.
        </li>
        <li>
          <b>Close other apps</b> that may be using the webcam (Teams, Zoom, Discord, OBS, the Camera app…), then Retry.
        </li>
        <li>
          Laptop with a <b>camera privacy switch / F-key</b>? Make sure it's on. Still nothing: reload the page.
        </li>
      </ol>
    </div>
  );
}
