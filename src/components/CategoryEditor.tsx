import { Plus, Sparkles, Trash2 } from 'lucide-react';
import {
  calculateRoundPlan,
  generateId,
  PRESET_CATEGORY_PACKS,
} from '../lib/gameLogic';
import type { Category } from '../lib/types';

interface CategoryEditorProps {
  categories: Category[];
  onChange: (next: Category[]) => void;
  connectedPlayerCount?: number;
}

export function CategoryEditor({
  categories,
  onChange,
  connectedPlayerCount,
}: CategoryEditorProps) {
  const addCategory = () => {
    onChange([
      ...categories,
      {
        id: generateId('cat'),
        name: `קטגוריה ${categories.length + 1}`,
        words: [],
      },
    ]);
  };

  const removeCategory = (id: string) => {
    onChange(categories.filter((c) => c.id !== id));
  };

  const updateCategoryName = (id: string, name: string) => {
    onChange(categories.map((c) => (c.id === id ? { ...c, name } : c)));
  };

  const updateCategoryWordsText = (id: string, rawText: string) => {
    const words = rawText.split('\n');
    onChange(categories.map((c) => (c.id === id ? { ...c, words } : c)));
  };

  const loadPresetPack = (packIndex: number, mode: 'replace' | 'append') => {
    const pack = PRESET_CATEGORY_PACKS[packIndex];
    if (!pack) return;
    const built: Category[] = pack.categories.map((c) => ({
      id: generateId('cat'),
      name: c.name,
      words: [...c.words],
    }));
    onChange(mode === 'replace' ? built : [...categories, ...built]);
  };

  const basePlan = calculateRoundPlan(categories, connectedPlayerCount || 4);
  const previewCounts = [3, 4, 5, 6];

  return (
    <div className="category-editor">
      <div className="preset-bar">
        <span className="preset-label">
          <Sparkles size={16} />
          <span>חבילות מוכנות להשראה:</span>
        </span>
        <div className="preset-buttons">
          {PRESET_CATEGORY_PACKS.map((pack, idx) => (
            <button
              key={pack.label}
              type="button"
              className="btn-mini-brutal"
              onClick={() => loadPresetPack(idx, idx === 0 ? 'replace' : 'append')}
              title={idx === 0 ? 'מחליף לחבילת מסיבה מלאה' : 'מוסיף לקטגוריות הקיימות'}
            >
              {pack.emoji} {pack.label}
            </button>
          ))}
        </div>
      </div>

      <div className="categories-list">
        {categories.map((cat, idx) => {
          const validCount = cat.words.map((w) => w.trim()).filter(Boolean).length;
          return (
            <div key={cat.id} className="category-card">
              <div className="category-card-head">
                <span className="cat-index-badge">#{idx + 1}</span>
                <input
                  type="text"
                  className="cat-name-input"
                  placeholder="שם הקטגוריה (למשל: חיות עם מקצועות)"
                  value={cat.name}
                  onChange={(e) => updateCategoryName(cat.id, e.target.value)}
                  required
                />
                <span className="cat-count-pill">{validCount} מילים</span>
                {categories.length > 1 && (
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => removeCategory(cat.id)}
                    title="מחק קטגוריה"
                    aria-label="מחק קטגוריה"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <textarea
                rows={4}
                className="cat-words-textarea"
                placeholder="הזינו מילה או ביטוי בכל שורה..."
                value={cat.words.join('\n')}
                onChange={(e) => updateCategoryWordsText(cat.id, e.target.value)}
              />
            </div>
          );
        })}
      </div>

      <button type="button" className="btn-brutal btn-white btn-add-cat" onClick={addCategory}>
        <Plus size={18} />
        <span>הוסף קטגוריה חדשה</span>
      </button>

      {/* Dynamic Round Formula Preview */}
      <div className="round-formula-box">
        <div className="formula-top">
          <strong>🧮 חישוב סיבובים אוטומטי:</strong>
          <span>
            סה״כ <strong>{basePlan.totalWords}</strong> מילים ייחודיות ב-<strong>{basePlan.categoryCount}</strong> קטגוריות
          </span>
        </div>

        {connectedPlayerCount !== undefined ? (
          <div className="formula-live">
            {connectedPlayerCount === 0 ? (
              <span>ברגע שיצטרפו שחקנים, מספר הסיבובים יחושב אוטומטית ({basePlan.totalWords} ÷ מספר השחקנים).</span>
            ) : basePlan.canStart ? (
              <span>
                <strong>{basePlan.totalWords}</strong> מילים ÷ <strong>{connectedPlayerCount}</strong> שחקנים ={' '}
                <strong className="formula-highlight">{basePlan.totalRounds} סיבובים מלאים!</strong>
                {basePlan.leftoverWords > 0 && (
                  <span className="formula-leftover">
                    {' '}({basePlan.leftoverWords === 1 ? 'מילה 1 תישאר בצד' : `${basePlan.leftoverWords} מילים יישארו בצד`})
                  </span>
                )}
              </span>
            ) : (
              <span className="formula-warn">
                ⚠️ יש {basePlan.totalWords} מילים ו-{connectedPlayerCount} שחקנים — הוסיפו עוד{' '}
                {connectedPlayerCount - basePlan.totalWords} מילים לפחות לסיבוב אחד!
              </span>
            )}
          </div>
        ) : (
          <div className="formula-matrix">
            {previewCounts.map((pc) => {
              const p = calculateRoundPlan(categories, pc);
              return (
                <div key={pc} className="formula-chip">
                  <span>{pc} שחקנים</span>
                  <strong>{p.totalRounds} סיבובים</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
