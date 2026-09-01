# F1 — Peta Otot → Filter Exercise

**Bagian dari:** openGym Coach Features (lihat `2026-09-01-opengym-coach-features-design.md`)
**Status:** Draft
**Effort:** Kecil

---

## 1. Tujuan

User melihat grafik tubuh (BodyMap), mengklik otot (misal "Biceps"), dan Library/ExercisePicker menampilkan **semua exercise yang melatih otot itu** — termasuk yang `bp`-nya berbeda tapi `musclesOf()` menandai otot itu sebagai primary atau secondary.

**Akar masalah yang diselesaikan:** openGym punya katalog lengkap (1.324 exercise, identik dengan upstream), tapi Library & ExercisePicker hanya memfilter `bp` (body part) + `eq` (equipment) + search nama/tag/desc. **Tidak ada filter berdasarkan otot yang dilatih.**

Contoh: user mau latihan *rear deltoid*. Filter "shoulders" menampilkan body-part shoulders, tapi latihan yang melatih rear delts dari body-part lain (row, face pull) tidak muncul — padahal ada di katalog. User menyerah → bikin custom exercise padahal exercise-nya sudah ada.

---

## 2. Perilaku

- Di `Library` dan `ExercisePicker`, tambahkan **mode toggle otot** — BodyMap kecil yang bisa di-klik.
- Klik otot `slug` → filter exercise dengan `musclesOf(ex)[slug] > 0`.
- Klik lagi otot yang sama (atau tombol "All") → clear filter.
- Otot yang dipilih → hasil **disortir**: exercise dengan otot itu sebagai **primary** (`tg`) lebih dulu, secondary (`sm`) menyusul.
- **Interaksi dengan filter yang ada:** filter otot `AND` dengan `bp`, `eq`, search (berlaku bersamaan). Sortir primary-first berlaku saat filter otot aktif.
- Exercise custom: `musclesOf()` sudah menangani (fallback ke `BY_BODYPART`), jadi otomatis ikut — custom exercise dengan `tg` kosong tetap muncul sesuai body part.
- BodyMap **tidak berubah** — pakai `onMuscle`/`selected` yang sudah ada. Yang berubah adalah **view yang memakainya** (Library, ExercisePicker).

---

## 3. Implementasi

### 3.1 File berubah

| File | Perubahan |
|---|---|
| `frontend/src/views/Library.jsx` | Tambah state `muscle`; filter `base` tambah kondisi otot; render BodyMap saat mode otot aktif; tombol toggle; sortir primary-first |
| `frontend/src/sheets.jsx` (`ExercisePicker`) | Sama seperti Library: state `muscle` + filter + BodyMap |
| `frontend/src/lib/exercises.js` | Tambah helper `byMuscle(list, slug)` dan `sortByMusclePrimary(list, slug)` (pure, bisa di-test) |
| `frontend/src/lib/exercises.test.js` | Unit test helper |

### 3.2 Helper baru di `lib/exercises.js`

```js
import { musclesOf } from './muscles.js'

// Filter: exercises whose musclesOf map includes the slug.
export function byMuscle(list, slug) {
  return list.filter(e => musclesOf(e)[slug] > 0)
}

// Sort: exercises training the muscle as PRIMARY (tg) first, secondary (sm) after.
// Both sides of the comparator keep working when musclesOf falls back to BY_BODYPART.
export function sortByMusclePrimary(list, slug) {
  const prim = new Set()
  list.forEach(e => {
    const m = musclesOf(e)
    if (m[slug] >= 1) prim.add(e.id)   // primary = full weight from tg
  })
  return [...list].sort((a, b) =>
    (prim.has(b.id) ? 1 : 0) - (prim.has(a.id) ? 1 : 0))
}
```

### 3.3 Reuse (tidak berubah)

`BodyMap`, `musclesOf`, `MUSCLES`, `MUSCLE_NAME`, `loadOf` — semua sudah ada dan di-export.

---

## 4. Data Flow

```
User klik otot "biceps" di BodyMap
  → setMuscle('biceps')
  → base = allExercises(S).filter(e => byMuscle([e], 'biceps'))   // musclesOf(e).biceps > 0
  → sortir primary-first via sortByMusclePrimary
  → equipment filter tetap berlaku (eqOpts dihitung dari hasil terfilter)
  → tampil di list
```

Klik ulang otot yang sama → `setMuscle(null)` → kembali ke daftar penuh.

---

## 5. Testing

### Unit (`lib/exercises.test.js`)

- `byMuscle` benar: bench press → chest (primary) + biceps/deltoids (secondary) muncul saat slug chest/biceps/deltoids.
- `sortByMusclePrimary` benar: untuk slug biceps, row (tg=biceps) lebih dulu dari bench (biceps sekunder).
- Custom exercise (tanpa `tg`) → fallback `BY_BODYPART`, muncul di filter body part-nya.
- Exercise dengan otot tidak dikenali → tidak masuk hasil.

### Manual

- Klik tiap otot di BodyMap Library → daftar wajar, tidak ada error.
- Kombinasi filter otot + equipment + search berjalan bersamaan.
- Clear filter → kembali ke semua.

---

## 6. Out-of-Scope

- BodyMap di halaman Stats tidak berubah (sudah ada).
- Filter otot multi-seleksi (misal "biceps AND triceps") — YAGNI untuk MVP, cukup satu otot aktif.
- Highlight otot yang sudah dilatih di Library (konsep beda dari filter — itu fungsi Stats).
