import { useEffect, useState } from 'preact/hooks';
import { FACTIONS, PERSONAS, type Faction, type Persona } from '@aurane/protocol';
import { connect, createGuest, fetchPublicConfig, foundColony, loginWithPasskey, passkeysSupported, redeem, startEmailLogin, verifyEmailLogin, type FoundOffer, type SignInResult } from '../net.js';
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
  /** A returning account with no colony this season: the founding form, prefilled, no invitation. */
  const [returning, setReturning] = useState<FoundOffer | null>(null);
  const l = useSig(lang);
  useEffect(() => { void fetchPublicConfig().then((c) => setRequireInvite(c.requireInvite)); }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (returning) await foundColony(returning.ticket, name.trim(), faction, persona);
      else await createGuest(name.trim(), faction, persona, invite.trim() || undefined);
      connect();
    } catch (err) {
      const reason = (err as Error).message;
      if (reason === 'ticket expired or used') setReturning(null);
      setError(tError(reason));
    } finally { setBusy(false); }
  };
  /** After a sign-in: the colony opens, or a returning account gets the founding form. */
  const signedIn = (r: SignInResult, failed: (reason: string) => string) => {
    if (r.ok) { connect(); return; }
    if (r.found) {
      setReturning(r.found);
      if (r.found.previous) { setName(r.found.previous.name); setFaction(r.found.previous.faction); setPersona(r.found.previous.persona); }
      setMail('off'); setJoining(false);
      return;
    }
    setError(r.reason === 'no colony this season' ? t('noColonyThisSeason') : failed(r.reason ?? ''));
  };
  const signIn = async () => {
    setBusy(true); setError(null);
    const r = await loginWithPasskey();
    setBusy(false);
    if (r.ok || r.reason !== 'cancelled') signedIn(r, (reason) => t('signInFailed').replace('{r}', tError(reason)));
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
    signedIn(r, tError);
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
        {returning && (
          <div class="returning">
            <b>{t('returningTitle')}</b>
            <p>{returning.remembers ? t('returningRemembers') : t('returningFresh')}</p>
          </div>
        )}
        <label>{t('yourName')}<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} minLength={2} maxLength={32} required autoFocus /></label>
        {requireInvite && !returning && <label>{t('inviteCode')}<input value={invite} onInput={(e) => setInvite((e.target as HTMLInputElement).value)} placeholder="AUR-XXXXXXXX" maxLength={40} required /></label>}
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
        <button class="primary" disabled={busy || name.trim().length < 2 || (requireInvite && !returning && invite.trim().length < 4)}>{returning ? t('returningFound') : t('play')}</button>
        {returning && <p class="muted small"><button type="button" class="link" onClick={() => { setReturning(null); setName(''); setError(null); }}>{t('returningOther')}</button></p>}
        {!returning && <>
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
        </>}
      </form>
    </div>
  );
}
