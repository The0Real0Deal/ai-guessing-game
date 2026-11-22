import { useState } from 'react';
import {
  clearRuntimeSupabaseConfig,
  getSupabaseConfig,
  saveRuntimeSupabaseConfig,
} from '../lib/supabaseClient';
import { getSyncMode } from '../lib/gameService';

export function SyncStatusBadge() {
  const mode = getSyncMode();
  const [open, setOpen] = useState(false);
  const existing = getSupabaseConfig();
  const [url, setUrl] = useState(existing.url);
  const [anonKey, setAnonKey] = useState(existing.anonKey);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !anonKey.trim()) return;
    saveRuntimeSupabaseConfig(url, anonKey);
    window.location.reload();
  };

  const handleClear = () => {
    clearRuntimeSupabaseConfig();
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        className={`sync-pill ${mode === 'supabase' ? 'sync-cloud' : 'sync-local'}`}
        onClick={() => setOpen(true)}
        title="הגדרות סנכרון בזמן אמת"
      >
        <span className="sync-dot" />
        {mode === 'supabase' ? 'סנכרון ענן חי (Supabase)' : 'מצב מקומי (הגדר ענן ל-Vercel)'}
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>☁️ הגדרות סנכרון בזמן אמת (Supabase + Vercel)</h3>
              <button type="button" className="btn-icon-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            {mode === 'supabase' ? (
              <div className="sync-info-box success">
                <strong>✅ מחובר ל-Supabase Realtime!</strong>
                <p>
                  כל הטלפונים, לוח המארח והמסך הראשי מסונכרנים בזמן אמת דרך הענן — מוכן ל-Vercel מכל מקום בעולם.
                </p>
              </div>
            ) : (
              <div className="sync-info-box warn">
                <strong>⚡ פועל כרגע במצב מקומי (ללא Supabase)</strong>
                <p>
                  במצב זה המשחק מסתנכרן בין טאבים באותו דפדפן (וב-<code>npm run dev</code> גם בין מכשירים באותו Wi-Fi).
                  כדי לשחק מכל טלפון בפריסה ב-Vercel, חברו פרויקט Supabase חינמי והגדירו את משתני הסביבה{' '}
                  <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> ו-<code dir="ltr">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (או הזינו כאן לבדיקה מהירה).
                </p>
              </div>
            )}

            <form className="stack-form" onSubmit={handleSave}>
              <div className="field-group">
                <label htmlFor="sb-url">Supabase Project URL</label>
                <input
                  id="sb-url"
                  type="url"
                  dir="ltr"
                  placeholder="https://xxxxx.supabase.co"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label htmlFor="sb-key">Supabase Anon Public Key</label>
                <input
                  id="sb-key"
                  type="password"
                  dir="ltr"
                  placeholder="eyJhbGciOi..."
                  value={anonKey}
                  onChange={(e) => setAnonKey(e.target.value)}
                  required
                />
              </div>

              <div className="modal-actions">
                <button type="submit" className="btn-brutal btn-green">
                  שמור והתחבר לענן
                </button>
                {localStorage.getItem('catgame_supabase_url') && (
                  <button type="button" className="btn-brutal btn-white" onClick={handleClear}>
                    חזור למצב מקומי
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
