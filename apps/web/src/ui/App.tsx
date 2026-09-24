import { useEffect } from 'preact/hooks';
import { connect, getToken, joinCodeFromUrl, redeem, status, toast, view } from '../net.js';
import { useSig } from './useSig.js';
import { Landing } from './Landing.js';
import { Game } from './Game.js';

export function App() {
  const st = useSig(status);
  const v = useSig(view);
  useEffect(() => {
    const code = joinCodeFromUrl();
    if (code) {
      history.replaceState(null, '', location.pathname + location.search);
      void redeem(code).then(() => connect()).catch((e: Error) => { toast.value = { text: e.message, kind: 'err' }; if (getToken()) connect(); });
      return;
    }
    if (getToken()) connect();
  }, []);
  if (!getToken() || st === 'idle') return <Landing />;
  if (!v) return <div class="splash"><div class="spinner" /></div>;
  return <Game />;
}
