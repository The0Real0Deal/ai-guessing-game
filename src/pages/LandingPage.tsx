import { useNavigate } from 'react-router-dom';
import { Monitor, SlidersHorizontal, Smartphone, Sparkles } from 'lucide-react';
import { SyncStatusBadge } from '../components/SyncStatusBadge';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="landing-shell">
      <div className="landing-top-strip">
        <SyncStatusBadge />
      </div>

      <section className="stage-card landing-hero-card">
        <div className="sticker-tag tag-yellow">משחק המסיבות הכי מצחיק בסלון ⚡</div>
        <h1 className="mega-title">מה הבוט צייר?! 🤖🎨</h1>
        <p className="hero-subtitle">
          כל שחקן מקבל מילה סודית בנייד ושולח פרומפט יצירתי, המארח מייצר את התמונה ב-Gemini ומדביק בשנייה,
          וכולם צועקים ניחושים יחד מול המסך הראשי!
        </p>

        <div className="role-grid-3">
          <button
            id="btn-role-host"
            type="button"
            className="role-card role-host"
            onClick={() => navigate('/host')}
          >
            <span className="role-badge">לפטופ / מסך שני פרטי</span>
            <span className="role-icon-wrap icon-coral">
              <SlidersHorizontal size={32} strokeWidth={2.5} />
            </span>
            <span className="role-title">לוח בקרת מארח</span>
            <span className="role-desc">
              בניית קטגוריות ומילים, צפייה בפרומפטים, הדבקת תמונות מ-Gemini והענקת נקודות
            </span>
          </button>

          <button
            id="btn-role-screen"
            type="button"
            className="role-card role-screen"
            onClick={() => navigate('/screen')}
          >
            <span className="role-badge">טלוויזיה / מקרן (ציבורי)</span>
            <span className="role-icon-wrap icon-yellow">
              <Monitor size={32} strokeWidth={2.5} />
            </span>
            <span className="role-title">מסך ראשי להקרנה</span>
            <span className="role-desc">
              קוד QR להצטרפות, תצוגת התמונות לניחוש, טיימר דרמטי, טבלת ניקוד וגמר עם קונפטי
            </span>
          </button>

          <button
            id="btn-role-player"
            type="button"
            className="role-card role-player"
            onClick={() => navigate('/play')}
          >
            <span className="role-badge">סמארטפון אישי</span>
            <span className="role-icon-wrap icon-blue">
              <Smartphone size={32} strokeWidth={2.5} />
            </span>
            <span className="role-title">הצטרפות כשחקן</span>
            <span className="role-desc">
              סרקו QR או הזינו קוד חדר, קבלו מילה סודית ושלחו את הפרומפט הכי פרוע שלכם
            </span>
          </button>
        </div>

        <div className="how-it-works-strip">
          <div className="how-step">
            <span className="how-num">1</span>
            <span>המארח מקים קטגוריות ופותח את המסך הראשי לטלוויזיה</span>
          </div>
          <div className="how-step">
            <span className="how-num">2</span>
            <span>השחקנים סורקים QR, מקבלים מילה סודית ושולחים פרומפט</span>
          </div>
          <div className="how-step">
            <span className="how-num">3</span>
            <span>המארח מדביק תמונות מ-Gemini ב-Ctrl+V — ומתחילים לנחש בקול!</span>
          </div>
        </div>

        <div className="landing-footnote">
          <Sparkles size={16} />
          <span>טיפ למארח: פתחו את <strong>לוח בקרת המארח</strong> אצלכם בלפטופ, ומשם לחצו כפתור אחד לפתיחת <strong>המסך הראשי</strong> בטלוויזיה!</span>
        </div>
      </section>
    </div>
  );
}
