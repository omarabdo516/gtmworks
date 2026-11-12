/* Runs in <head> before first paint: reads language, theme and motion from the saved choice, or from the address when it
   carries one, so there is no flash. The address only seeds the saved choice and is then dropped from the bar, so a
   later switch is never overruled by an old address (back button included). Without storage the address carries them.
   The static <html lang="ar" dir="rtl"> in each file satisfies ci.sh's check on design/*.html; this script sets the real values. */
(function () {
  var q = new URLSearchParams(location.search), r = document.documentElement, store = false;
  try { localStorage.setItem('proto.probe', '1'); localStorage.removeItem('proto.probe'); store = true; } catch (e) { /* no storage */ }
  function saved(k) { try { return localStorage.getItem('proto.' + k); } catch (e) { return null; } }
  function keep(k, v) { try { localStorage.setItem('proto.' + k, v); } catch (e) { /* no storage */ }}
  var lang = (q.get('lang') || saved('lang')) === 'ar' ? 'ar' : 'en';
  var choice = q.get('theme') || saved('theme') || 'device';
  if (['light', 'dark', 'device'].indexOf(choice) < 0) choice = 'device';
  var motion = (q.get('motion') || saved('motion')) === 'reduce' ? 'reduce' : 'full';
  r.lang = lang;
  r.dir = lang === 'ar' ? 'rtl' : 'ltr';
  r.dataset.themeChoice = choice;
  r.dataset.theme = choice === 'device' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : choice;
  if (q.get('bare')) r.dataset.bare = '';
  if (motion === 'reduce') r.dataset.reduceMotion = '';
  if (store) {
    var seeded = false, now = { lang: lang, theme: choice, motion: motion };
    Object.keys(now).forEach(function (k) { if (q.has(k)) { keep(k, now[k]); q.delete(k); seeded = true; } });
    if (seeded) { try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) { /* keep the address */ } }
  }
})();
