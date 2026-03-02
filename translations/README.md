# SoundCloner v2 — Translation System

## 📁 Files

| File | Language | Direction |
|------|----------|-----------|
| `en.json` | English | LTR |
| `es.json` | Español (Spanish) | LTR |
| `fr.json` | Français (French) | LTR |
| `pt.json` | Português (Portuguese) | LTR |
| `de.json` | Deutsch (German) | LTR |
| `it.json` | Italiano (Italian) | LTR |
| `ru.json` | Русский (Russian) | LTR |
| `ar.json` | العربية (Arabic) | **RTL** |
| `ja.json` | 日本語 (Japanese) | LTR |
| `ko.json` | 한국어 (Korean) | LTR |
| `zh.json` | 中文 (Mandarin) | LTR |
| `hi.json` | हिन्दी (Hindi) | LTR |
| `index.json` | Language registry | — |

## 🔧 How to Integrate

### Step 1: Add `data-i18n` attributes to your HTML

Every visible text element gets a `data-i18n` attribute matching a key in the JSON:

```html
<!-- Before -->
<span>Artists</span>

<!-- After -->
<span data-i18n="nav_artists">Artists</span>
```

For placeholders:
```html
<input data-i18n-placeholder="search_placeholder" placeholder="Search artists...">
```

### Step 2: Add the language switcher dropdown to your header

```html
<div class="lang-switch" id="langSwitch">
  <button class="lang-switch-btn" id="langSwitchBtn">
    <img src="https://flagcdn.com/w40/us.png" id="langSwitchFlag" alt="">
    <span id="langSwitchLabel">EN</span>
  </button>
  <div class="lang-switch-list" id="langSwitchList"></div>
</div>
```

### Step 3: Load translations and apply

```javascript
// Translation store
let translations = {};
let currentLang = localStorage.getItem('sc-lang') || 'en';

// Load a language
async function loadLang(code) {
  if (!translations[code]) {
    const res = await fetch(`./translations/${code}.json`);
    translations[code] = await res.json();
  }
  return translations[code];
}

// Apply translations to the DOM
async function applyLang(code) {
  const t = await loadLang(code);
  currentLang = code;
  localStorage.setItem('sc-lang', code);

  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });

  // Placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (t[key]) el.placeholder = t[key];
  });

  // HTML direction (for Arabic)
  document.documentElement.dir = t._dir || 'ltr';

  // Update switcher button
  updateSwitcherBtn(code);
}

// Build the language switcher dropdown
async function buildLangSwitcher() {
  const idx = await (await fetch('./translations/index.json')).json();
  const list = document.getElementById('langSwitchList');

  idx.languages.forEach(lang => {
    const item = document.createElement('div');
    item.className = 'lang-switch-item';
    item.innerHTML = `<img src="https://flagcdn.com/w40/${lang.flag}.png" alt="${lang.name}"> ${lang.native}`;
    item.addEventListener('click', () => {
      applyLang(lang.code);
      list.classList.remove('open');
    });
    list.appendChild(item);
  });
}

// Initialize
buildLangSwitcher();
applyLang(currentLang);
```

### Step 4: Handle RTL for Arabic

The `_dir` field in each JSON tells you the text direction. When Arabic is selected, you apply `dir="rtl"` to the root element. You may also want to flip certain flex layouts:

```css
[dir="rtl"] .some-row { flex-direction: row-reverse; }
[dir="rtl"] .some-text { text-align: right; }
```

## 🔑 Key Naming Convention

Keys follow this pattern: `{section}_{element}`

- `nav_*` — Navigation tabs
- `header_*` — Top header stats
- `rail_*` — Genre rail filters
- `vibe_*` — Vibe filter tags
- `artists_hero_*` — Artists tab hero section
- `card_*` — Artist/blueprint card actions
- `blueprints_*` — Blueprints tab
- `batch_*` — Batch tab (largest section)
- `favorites_*` — Favorites tab
- `analyse_*` — Analyse tab
- `master_*` — Master tab
- `footer_*` — Footer bar

## ➕ Adding a New Language

1. Copy `en.json` as your starting template
2. Translate all values (keep keys the same)
3. Set `_lang` to the native name
4. Set `_dir` to `"rtl"` if needed, otherwise `"ltr"`
5. Save as `{code}.json` (e.g. `tr.json` for Turkish)
6. Add entry to `index.json`

## 📝 Notes

- **en.json** is the master/complete file — all ~180 keys
- Some translation files (ko, de, zh) have fewer keys — they'll fall back to English for missing keys
- Emojis in keys (🎨, 🧠, etc.) are preserved across all languages
- The `batch_gemini_help_3b` and similar keys keep English UI labels ("Get API Key") since those are what users see on the actual websites
