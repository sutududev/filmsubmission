-- Titles core table
CREATE TABLE IF NOT EXISTS titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'incomplete',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Profile metadata for a title (1:1)
CREATE TABLE IF NOT EXISTS title_profiles (
  title_id INTEGER PRIMARY KEY,
  sales_title TEXT,
  synopsis TEXT,
  genres TEXT,
  keywords TEXT,
  format TEXT,                  -- Movie, Series, Short, etc.
  spoken_language TEXT,
  dubbed_languages TEXT,
  caption_languages TEXT,
  origin_country TEXT,
  runtime_minutes INTEGER,
  release_date TEXT,            -- ISO date string
  rating_system TEXT,           -- MPAA, BBFC, etc.
  rating TEXT,                  -- e.g., PG-13
  production_company TEXT,
  website TEXT,
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Cast & Crew
CREATE TABLE IF NOT EXISTS cast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  UNIQUE(title_id, name, role),
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crew (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  department TEXT,              -- Director, Producer, Writer, DP, Editor, Composer
  UNIQUE(title_id, name, department),
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Festivals & Awards
CREATE TABLE IF NOT EXISTS festivals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  festival_name TEXT NOT NULL,
  laurel_url TEXT,              -- optional artwork URL
  award TEXT,                   -- Winner, Official Selection, etc.
  year INTEGER,
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Artwork assets
CREATE TABLE IF NOT EXISTS artworks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  kind TEXT NOT NULL,           -- portrait_2_3, portrait_3_4, landscape_16_9, landscape_16_9_textless, landscape_16_6, landscape_4_3, landscape_2_1, poster, banner, key_art
  r2_key TEXT,                  -- key in R2
  url TEXT,                     -- optional external URL fallback
  status TEXT DEFAULT 'missing',-- missing | uploaded | approved | rejected
  notes TEXT,
  UNIQUE(title_id, kind),
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Caption files
CREATE TABLE IF NOT EXISTS captions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  language TEXT NOT NULL,       -- ISO 639-1 code (en, es, vi)
  kind TEXT DEFAULT 'subtitles',-- subtitles | captions | sdh
  r2_key TEXT,
  url TEXT,
  status TEXT DEFAULT 'missing',
  UNIQUE(title_id, language, kind),
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Avails (Rights)
CREATE TABLE IF NOT EXISTS avails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  license_type TEXT NOT NULL,   -- avod | svod | tvod
  territories TEXT NOT NULL,    -- comma-separated ISO-3166-1 alpha-2 or 'worldwide'
  start_date TEXT NOT NULL,
  end_date TEXT,
  exclusive INTEGER DEFAULT 0,  -- boolean 0/1
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Documents (Chain of Title & Deliverables)
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  doc_type TEXT NOT NULL,       -- copyright_reg, chain_of_title, eo_insurance, music_cue_sheet, composer_agreement, talent_release, location_release, underlying_rights, w9_w8, trailer_prores, screener, qc_report, metadata_sheet, poster_psd, key_art_psd, delivery_schedule, other
  r2_key TEXT,
  url TEXT,
  status TEXT DEFAULT 'missing',-- missing | uploaded | approved | rejected
  notes TEXT,
  UNIQUE(title_id, doc_type),
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Licenses with channels/partners
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER NOT NULL,
  channel TEXT,                 -- e.g., Amazon Prime Video, Tubi
  rights_granted TEXT,          -- Non-Exclusive Worldwide AVOD etc.
  revenue_terms TEXT,           -- e.g., 80/20 revsplit after fees
  start_date TEXT,
  end_date TEXT,
  agreement_url TEXT,
  status TEXT DEFAULT 'draft',
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE CASCADE
);

-- Distribution updates/events
CREATE TABLE IF NOT EXISTS updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER,
  event_type TEXT NOT NULL,     -- created_title, artwork_uploaded, captions_uploaded, submitted_to_channel, accepted_by_channel, rejected_by_channel, published, statement_posted
  info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE SET NULL
);

-- Statements (Financial)
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_id INTEGER,
  channel TEXT,
  period_start TEXT,
  period_end TEXT,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  report_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (title_id) REFERENCES titles(id) ON DELETE SET NULL
);
