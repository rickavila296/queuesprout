export const THEME_STORAGE_KEY = 'qs-theme';

/**
 * Runs in <head> before paint: applies the saved theme (light, dark or system)
 * so there is no flash of the wrong theme. See Next's "preventing flash" guide.
 */
const script = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
