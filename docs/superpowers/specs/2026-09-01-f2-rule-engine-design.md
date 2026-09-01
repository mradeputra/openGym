# F2 — Rule Engine Tiered (Coach Hints)

**Bagian dari:** openGym Coach Features (lihat `2026-09-01-opengym-coach-features-design.md`)
**Status:** Draft
**Effort:** Sedang

---

## 1. Tujuan

Menambahkan **deteksi** dan **saran deterministic** untuk empat edge case progressive overload dari proposal GymTrainer — sebagai coach hint yang bisa diaudit, bukan otomatisasi yang mengambil alih keputusan.

**Keputusan kunci:** rule = **saran** (coach hint), bukan auto-apply. User tetap memegang keputusan akhir. Hint muncul **hanya di `FinishSummary`** (post-workout) — tidak mengganggu alur logging di tengah sesi.

---

## 2. Konteks: apa yang sudah ada di `progression.js`

`progression.js` sudah punya:
- `readSession` — membaca session jujur (set hit/miss, target reps).
- `stallCount` — counter miss beruntun.
- `nextPrescription` — prescription (up/hold/deload) berdasar policy (linear/greyskull/double/time).
- `POLICIES` — policy untuk progression.

**Gap:** policy `double` hanya membaca "semua set capai target → naik beban; miss → hold/deload". Ini **tidak tiered**:
- Plateau 3 vs 4 vs 5+ minggu → aksi beda (spec GymTrainer).
- Rep drop 1x vs 2x vs 3x → aksi beda.
- Set variance (12-10-8 saat target 12) → tidak diinterpretasi; double progression menganggapnya "miss".

**F2 menambahkan lapisan deteksi ini** di atas prescription yang sudah ada, tanpa mengubah perilaku progression yang ada.

---

## 3. Aturan

Menggunakan data yang sudah tersedia: `S.workouts`, `entries[].sets[]`, `target` (prescription), `effort` (RIR/RPE opsional).

### Rule A — Set variance checker

- **Kondisi:** dalam satu session, set tidak konsisten (misal 12-10-8 saat target 12).
- **Interpretasi:** membuat `double` progression ambigu — "semua set capai target" tidak bisa dibaca.
- **Saran:** HOLD (target belum tercapai) vs UP (semua set capai). Mengoreksi interpretasi data terlebih dahulu sebelum rule lain.

### Rule B — Rep drop tiered

- **Kondisi:** reps working set turun vs minggu sebelumnya.
- **Tier:**
  - 1x drop → **Ulangi beban yang sama minggu depan** (`repeat`)
  - 2x drop berturut-turut → **Deload 10%** (`deload`)
  - 3x drop berturut-turut → **Evaluasi: substitusi exercise atau periksa program** (`evaluate`)
- **Dasar:** `readSession`/`stallCount` di `progression.js` (sudah ada).

### Rule C — Plateau tiered

- **Kondisi:** progression stagnan di angka sama.
- **Tier:**
  - 3 minggu → **Coba intensity technique** (rest-pause / drop set) (`technique`)
  - 4 minggu → **Substitusi ke exercise variasi otot sama** (`substitute`)
  - 5+ minggu → **Deload penuh seminggu** (`full-deload`)
- **Dasar:** `stallCount` + window mingguan.

### Rule D — Exercise substitution (bantuan, bukan auto)

- Saat user substitusi exercise (misal bench → DB press), bantu starting weight via **equivalence**.
- Untuk katalog: gunakan hubungan otot (`musclesOf`) — exercise yang melatih otot sama (primary sama) sebagai basis carry-over.
- Untuk custom: mode kalibrasi — saran "1-2 set di sesi pertama, catat dan kalibrasi".

### Prioritas Rule (bila multiple fire)

`set-variance` → `rep-drop` → `plateau` → `substitution`

Rasional (dari GymTrainer): set-variance mengoreksi interpretasi data; rep-drop paling akut (single-week signal); plateau multi-week; substitution adalah user action.

---

## 4. Bentuk Output: Coach Hint

```typescript
type CoachHint = {
  ruleId: 'set-variance' | 'rep-drop' | 'plateau' | 'substitution'
  tier: 1 | 2 | 3
  severity: 'info' | 'action' | 'warning'
  exerciseId: string
  messageKey: string        // i18n key (English source)
  params: Record<string, unknown>   // untuk t() args
  suggestedAction?: 'repeat' | 'deload' | 'substitute' | 'technique' | 'calibrate' | 'full-deload'
  reasoning: string[]       // facts, untuk AI Explainer (F3) & audit
}
```

**Di mana muncul:** **Utama — `FinishSummary` (post-workout)**, karena data session final baru lengkap setelah workout ditulis (lihat §5.5). **Tidak** muncul di tengah sesi (Workout.jsx) di MVP ini — menambahkan hint di tengah logging berisiko mengganggu alur cepat pencatatan; ini bisa jadi fase lanjutan. Keputusan ini mengunci scope: hanya `FinishSummary` yang menyentuh rule engine di MVP.

---

## 5. Implementasi

### 5.1 File baru

| File | Isi |
|---|---|
| `frontend/src/lib/coach.js` | Pure module. Input: `S` (state) + context. Output: `CoachHint[]`. Tanpa HTTP/DB. (Pola `progression.js`.) |
| `frontend/src/lib/coach.test.js` | Unit test skenario GymTrainer (12+ scenario) |

### 5.2 File berubah

| File | Perubahan |
|---|---|
| `frontend/src/sheets.jsx` (`FinishSummary`) | Panggil `coachHints(S, w)` setelah workout ditulis; render kartu hint. |
| `frontend/src/sheets.jsx` (`doFinishWorkout`) | Hitung hint saat workout final ditulis; simpan hasil untuk FinishSummary. |

### 5.3 Struktur `coach.js`

```js
// Coach hints: deterministic decision support on top of progression.
// Pure function of workout history — same philosophy as progression.js.

export function coachHints(S, workout) {
  const hints = []
  for (const entry of workout.entries) {
    const h = evaluateEntry(S, entry)
    if (h) hints.push(h)
  }
  return sortHints(hints)   // per priority: set-variance → rep-drop → plateau → substitution
}
```

---

## 6. Testing

Unit test skenario (dari GymTrainer):

| # | Skenario | Input | Expected |
|---|---|---|---|
| 1 | Target capai semua set | 3x12 @40kg, range 8-12 | UP |
| 2 | Set variance | 12-10-8 @40kg | HOLD |
| 3 | Rep drop 1x | 3x11→3x9 | repeat |
| 4 | Rep drop 2x | 3x11→3x9→3x8 | deload 10% |
| 5 | Rep drop 3x | turun 3 mgg | evaluate |
| 6 | Plateau 3 mgg | same 3x10, 3 sesi | technique |
| 7 | Plateau 4 mgg | same 3x10, 4 sesi | substitute |
| 8 | Plateau 5+ mgg | same 3x10, 5+ sesi | full deload |
| 9 | Substitute katalog | bench → DB press | equivalence via musclesOf |
| 10 | Substitute custom | custom exercise | calibrate |
| 11 | Fatigue pattern | set drop >20% berturut 2 mgg | add rest / -5% |
| 12 | Custom + rep drop | custom exercise + rep drop 2x | deload 10% |

---

## 7. Out-of-Scope

- Auto-apply rekomendasi (tanpa persetujuan user) — semua saran butuh konfirmasi.
- Hint di tengah sesi (Workout.jsx) — fase lanjutan.
- Rekomendasi "Terapkan/Abaikan" + adoption tracking — bisa jadi fitur terpisah (feedback loop), bukan bagian F2.
