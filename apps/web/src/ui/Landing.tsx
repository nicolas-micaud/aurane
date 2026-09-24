import { useEffect, useState } from 'preact/hooks';
import { FACTIONS, PERSONAS, type Faction, type Persona } from '@aurane/protocol';
import { connect, createGuest, fetchPublicConfig, redeem } from '../net.js';
import { lang, setLang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';

export function Landing() {
  const [name, setName] = useState('');
  const [faction, setFaction] = useState<Faction>('guild');
  const [persona, setPersona] = useState<Persona>('oriel');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState('');
  const [requireInvite, setRequireInvite] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const l = useSig(lang);
  useEffect(() => { void fetchPublicConfig().then((c) => setRequireInvite(c.requireInvite)); }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await createGuest(name.trim(), faction, persona, invite.trim() || undefined); connect(); } catch (err) { setError(tError((err as Error).message)); } finally { setBusy(false); }
  };
  const join = async (e: Event) => {
    e.preventDefault();
    const code = joinCode.trim().replace(/^.*#join=/, '');
    if (!code) return;
    setBusy(true); setError(null);
    try { await redeem(decodeURIComponent(code)); connect(); } catch (err) { setError(tError((err as Error).message)); } finally { setBusy(false); }
  };

  return (
    <div class="landing">
      <div class="lang"><button class={l === 'fr' ? 'on' : ''} onClick={() => setLang('fr')}>FR</button><button class={l === 'en' ? 'on' : ''} onClick={() => setLang('en')}>EN</button></div>
      <img src="/icon.svg" alt="" class="logo" />
      <h1>Aurane</h1>
      <p class="tagline">{t('tagline')}</p>
      <p class="subtitle">{t('subtitle')}</p>
      <form onSubmit={submit} class="card">
        <label>{t('yourName')}<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} minLength={2} maxLength={32} required autoFocus /></label>
        {requireInvite && <label>{t('inviteCode')}<input value={invite} onInput={(e) => setInvite((e.target as HTMLInputElement).value)} placeholder="AUR-XXXXXXXX" maxLength={40} required /></label>}
        <fieldset>
          <legend>{t('faction')}</legend>
          <div class="choices">
            {FACTIONS.map((f) => (
              <button type="button" key={f} class={`choice f-${f} ${faction === f ? 'on' : ''}`} onClick={() => setFaction(f)}>
                <b>{t(f)}</b><small>{t(`${f}Desc`)}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>{t('general')}</legend>
          <div class="choices">
            {PERSONAS.map((p) => (
              <button type="button" key={p} class={`choice ${persona === p ? 'on' : ''}`} onClick={() => setPersona(p)}>
                <b>{t(p)}</b><small>{t(`${p}Desc`)}</small>
              </button>
            ))}
          </div>
        </fieldset>
        {error && <p class="error">{error}</p>}
        <button class="primary" disabled={busy || name.trim().length < 2 || (requireInvite && invite.trim().length < 4)}>{t('play')}</button>
        <p class="muted small"><button type="button" class="link" onClick={() => setJoining(!joining)}>{t('haveColony')}</button></p>
        {joining && (
          <div class="join">
            <label>{t('pasteLink')}<input value={joinCode} onInput={(e) => setJoinCode((e.target as HTMLInputElement).value)} placeholder="https://play.playaurane.com/#join=…" /></label>
            <button type="button" disabled={busy || !joinCode.trim()} onClick={(e) => void join(e)}>{t('openColony')}</button>
          </div>
        )}
      </form>
    </div>
  );
}
