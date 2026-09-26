import { useEffect, useState } from 'preact/hooks';
import { FACTIONS, PERSONAS, type Faction, type Persona } from '@aurane/protocol';
import { connect, createGuest, fetchPublicConfig, loginWithPasskey, passkeysSupported, redeem, startEmailLogin, verifyEmailLogin } from '../net.js';
import { lang, setLang, t, tError } from '../i18n/index.js';
import { useSig } from './useSig.js';
import { InstallButton } from './bits.js';

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
  const [mail, setMail] = useState<'off' | 'address' | 'code'>('off');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const l = useSig(lang);
  useEffect(() => { void fetchPublicConfig().then((c) => setRequireInvite(c.requireInvite)); }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await createGuest(name.trim(), faction, persona, invite.trim() || undefined); connect(); } catch (err) { setError(tError((err as Error).message)); } finally { setBusy(false); }
  };
  const signIn = async () => {
    setBusy(true); setError(null);
    const r = await loginWithPasskey();
    setBusy(false);
    if (r.ok) connect();
    else if (r.reason !== 'cancelled') setError(r.reason === 'no colony this season' ? t('noColonyThisSeason') : t('signInFailed').replace('{r}', tError(r.reason ?? '')));
  };
  const askCode = async (e: Event) => {
    e.preventDefault(); setBusy(true); setError(null);
    const h = await startEmailLogin(email.trim(), l);
    setBusy(false);
    if (!h) { setError(t('signInFailed').replace('{r}', '')); return; }
    setHandle(h); setCode(''); setMail('code');
  };
  const useCode = async (e: Event) => {
    e.preventDefault(); if (!handle) return;
    setBusy(true); setError(null);
    const r = await verifyEmailLogin(handle, code);
    setBusy(false);
    if (r.ok) connect();
    else setError(r.reason === 'no colony this season' ? t('noColonyThisSeason') : tError(r.reason ?? ''));
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
        {passkeysSupported() && <button type="button" class="passkey" disabled={busy} onClick={() => void signIn()}>{t('signInPasskey')}</button>}
        {mail === 'off' ? <button type="button" class="passkey" disabled={busy} onClick={() => { setMail('address'); setError(null); }}>{t('signInEmail')}</button> : (
          <div class="join emailform">
            {mail === 'address' ? (
              <>
                <p class="muted small">{t('signInEmailHelp')}</p>
                <label>{t('emailAddress')}<input type="email" inputMode="email" autoComplete="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} autoFocus /></label>
                <div class="actions"><button type="button" disabled={busy || !email.includes('@')} onClick={(e) => void askCode(e)}>{t('sendCode')}</button><button type="button" onClick={() => setMail('off')}>{t('cancel')}</button></div>
              </>
            ) : (
              <>
                <p class="muted small">{t('signInEmailSent')}</p>
                <label>{t('typeCode')}<input class="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} autoFocus /></label>
                <div class="actions"><button type="button" class="primary" disabled={busy || code.replace(/\D/g, '').length !== 6} onClick={(e) => void useCode(e)}>{t('openColony')}</button><button type="button" onClick={() => setMail('address')}>{t('back')}</button></div>
              </>
            )}
          </div>
        )}
        <p class="muted small"><button type="button" class="link" onClick={() => setJoining(!joining)}>{t('haveColony')}</button></p>
        <InstallButton compact />
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
