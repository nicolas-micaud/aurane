import { useEffect } from 'preact/hooks';
import { connect, getToken, status, view } from '../net.js';
import { useSig } from './useSig.js';
import { Landing } from './Landing.js';
import { Game } from './Game.js';

export function App() {
  const st = useSig(status);
  const v = useSig(view);
  useEffect(() => { if (getToken()) connect(); }, []);
  if (!getToken() || st === 'idle') return <Landing />;
  if (!v) return <div class="splash"><div class="spinner" /></div>;
  return <Game />;
}
